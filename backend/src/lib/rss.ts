// Récupération et parsing des flux RSS publics YouTube (par chaîne).
//
// YouTube expose pour chaque chaîne un flux Atom sans quota ni clé :
//   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
//
// PROBLÈME : nos packs (src/data/competitions.ts) stockent des NOMS de chaînes,
// pas des channel_id. La résolution nom→channelId par scraping de
// https://www.youtube.com/@handle est fragile (mur de consentement, 302, HTML
// volatile). SOLUTION RETENUE : une table de correspondance STATIQUE, chaque id
// ayant été vérifié en récupérant son flux RSS (auteur + <entry> conformes).
//
// Parsing XML volontairement minimal (regex/indexOf, zéro dépendance) : le format
// des flux YouTube est stable et restreint. On extrait, par <entry> :
//   yt:videoId, title, published, et le nom de chaîne (auteur au niveau du flux).

import { TTLCache } from './cache';

/** Une entrée de flux RSS normalisée. */
export type RssEntry = {
  videoId: string;
  title: string;
  /** Date de publication ISO 8601 (telle que fournie par YouTube). */
  publishedAt: string;
  /** Nom de la chaîne (auteur du flux). */
  channel: string;
};

/** Implémentation de fetch injectable (pour tests). */
export type FetchImpl = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Entrée de la table de correspondance chaîne → flux RSS. */
export type ChannelEntry = {
  /** channelId YouTube (UC…), validé via feeds/videos.xml. */
  id: string;
  /**
   * true = chaîne MULTI-SPORTS / multi-sujets (Eurosport, beIN, L'Équipe, france tv…).
   * Son flux RSS mélange les disciplines : dans le feed companion, on ne garde donc
   * QUE ses vidéos dont le titre matche le lexique du pack demandé (voir feed.ts),
   * sinon un feed « Tour de France » se met à remonter du foot. Le flag est global à
   * la chaîne ; la pertinence se juge toujours par rapport au pack effectivement demandé.
   * Les chaînes mono-thématiques (Velon, Tennis TV, FIFA, La Vuelta…) n'ont pas ce flag
   * et passent sans filtre.
   */
  generalist?: boolean;
};

/**
 * Table statique NOM DE CHAÎNE (normalisé, minuscules) → { channelId, generalist? }.
 *
 * Chaque channelId a été vérifié en récupérant
 * https://www.youtube.com/feeds/videos.xml?channel_id=UC... et en confrontant
 * le <name> du flux au nom attendu. Les clés correspondent aux noms présents
 * dans `channels` des packs (src/data/competitions.ts).
 *
 * Note : les chaînes officielles saisonnières (Tour de France, La Vuelta, La chaîne
 * l'Équipe) peuvent avoir un flux temporairement vide hors compétition — l'id reste valide.
 */
export const CHANNEL_ID_MAP: Record<string, ChannelEntry> = {
  'tour de france': { id: 'UCZF_0TqrblIsnmArWyWIg0A' }, // auteur RSS: « tourdefrance » (mono-cyclisme)
  'eurosport france': { id: 'UCozt5iXNqmhU1I7tcjJ0UFQ', generalist: true }, // « Eurosport France » (multi-sports)
  'france tv sport': { id: 'UCh4o9ioiqbUveUrCLP8Wv6A', generalist: true }, // auteur RSS: « france tv » (multi-sports)
  'france.tv slash sport': { id: 'UCh4o9ioiqbUveUrCLP8Wv6A', generalist: true },
  "la chaine l'équipe": { id: 'UC6vcN22Apu8HakHBVa28sWw', generalist: true }, // « La chaîne l'équipe » (multi-sports)
  "l'équipe": { id: 'UC6vcN22Apu8HakHBVa28sWw', generalist: true },
  'cycling pro net': { id: 'UCAKkRVGHv4uHTM5S2jSzLDQ' }, // « Cycling Pro Net » (mono-cyclisme)
  'lanterne rouge': { id: 'UC77UtoyivVHkpApL0wGfH5w' }, // « Lanterne Rouge » (mono-cyclisme)
  'velon cc': { id: 'UCcbBlBEtCZ2lX7bodgi02Xg' }, // auteur RSS: « Velon » (mono-cyclisme)
  // Ajoutés le 2026-07-05 : channelId extrait de https://www.youtube.com/@handle
  // (User-Agent Googlebot) puis VALIDÉ via feeds/videos.xml?channel_id=… (15 <entry>,
  // <name> conforme). Chaînes Wimbledon/F1.
  'bein sports france': { id: 'UCfj4kQ6_mYO5r4hzX5KloVw', generalist: true }, // @beinsportsfrance → « beIN SPORTS France » (multi-sports)
  'wimbledon': { id: 'UCNa8NxMgSm7m4Ii9d4QGk1Q' },          // @Wimbledon → « Wimbledon » (mono-tennis)
  'formula 1': { id: 'UCB_qr75-ydFVKSF9Dmo6izg' },          // @Formula1 → « FORMULA 1 » (mono-F1)
  'canal+ sport': { id: 'UC8ggH3zU61XO0nMskSQwZdA', generalist: true }, // @CANALPlusSport → « CANAL+ Sport » (multi-sports : F1, foot, rugby…)
  // Chaînes internationales SPÉCIALISÉES ajoutées le 2026-07-06 : channelId extrait de
  // https://www.youtube.com/@handle (UA Googlebot, via "externalId"/canonical) puis VALIDÉ
  // via feeds/videos.xml?channel_id=… (15 <entry>, <name> conforme). Seules les chaînes
  // mono-thématiques figurent ici : leur flux RSS ne parle QUE de la compétition, donc il
  // peut alimenter le feed companion sans le polluer.
  'flobikes': { id: 'UCljVdpux_uz7NydDWYEeSIA' },           // @FloBikes → « FloBikes » (cyclisme US)
  'gcn racing': { id: 'UCu7phdCr-raU7OaJfEpHZww' },         // @gcnracing → « GCN Racing » (cyclisme)
  'tennis tv': { id: 'UCbcxFkd6B9xUU54InHv4Tig' },          // @TennisTV → « Tennis TV »
  'sky sport tennis': { id: 'UC7bfeZHiUlQO32O32qlMZXg' },   // @SkySportTennis → « Sky Sport Tennis » (IT)
  'sky sports f1': { id: 'UC3kxJQ9RfaS5CKeYbbFMi4Q' },      // @SkySportsF1 → « Sky Sports F1 » (UK)
  // Chaînes Coupe du monde / La Vuelta ajoutées le 2026-07-06 (même méthode : @handle via UA
  // Googlebot → externalId → RSS validé). FIFA et ESPN FC sont MONO-FOOT (tout leur flux parle
  // de foot / Coupe du monde) → pas de flag generalist. La Vuelta est mono-cyclisme (flux vide
  // hors saison août-sept, id valide) :
  'fifa': { id: 'UCpcTrCXblq78GZrTUTLWeBw' },               // @FIFA → « FIFA » (mono-foot, contenu Coupe du monde)
  'espn fc': { id: 'UC6c1z7bA__85CIWZ_jpCK-Q' },            // @ESPNFC → « ESPN FC » (mono-foot)
  'la vuelta': { id: 'UCrQIsqw3kkzMAVDtD5DjNRw' },          // @VueltaEspana → « vueltaespana » (mono-cyclisme)
  // Non mappées volontairement : « eurosport » (nu) et « canal+ » (nu) sont des
  // catch-all redondants — les chaînes officielles France ci-dessus couvrent le risque.
  // TF1 (@TF1, id UC26vXhYofHiZDM2ar1zUuwQ) ÉCARTÉE comme la BBC : chaîne GÉNÉRALISTE
  // grand public (son flux RSS remonte Star Academy, divertissement, séries…), PAS
  // sport-only → la mapper polluerait le feed même avec le filtre lexique, et sur-voilerait
  // côté extension. Le foot de TF1 est de toute façon couvert par FIFA / beIN / france tv.
  // De même, les chaînes GÉNÉRALISTES multi-sports ajoutées aux packs (nbc sports, tnt sports,
  // itv sport, rtbfsport, srf sport, espn) NE sont PAS mappées : leur flux RSS est multi-sports
  // et polluerait le feed companion. Elles servent au seul pré-filtre extension (âge < 72h + LLM).
};

/** Résout un nom de chaîne (tel qu'en pack) en channelId, ou undefined si inconnu. */
export function resolveChannelId(channelName: string): string | undefined {
  return CHANNEL_ID_MAP[channelName.trim().toLowerCase()]?.id;
}

/**
 * true si la chaîne est marquée « généraliste » (multi-sports) dans CHANNEL_ID_MAP.
 * Utilisé par /feed pour n'accepter d'une telle chaîne que les vidéos matchant le
 * lexique du pack demandé. Chaîne inconnue ou spécialisée → false.
 */
export function isGeneralistChannel(channelName: string): boolean {
  return CHANNEL_ID_MAP[channelName.trim().toLowerCase()]?.generalist === true;
}

/**
 * true si `title` contient (insensible à la casse) au moins un mot du `lexicon`.
 * Transposition TS de matchesLexicon (extension, src/lib/matcher.js) : matching par
 * simple includes() — le lexique est déjà normalisé en minuscules, on abaisse quand même
 * le titre ET chaque mot par prudence. Sert au filtre « chaîne généraliste » de /feed.
 */
export function titleMatchesLexicon(title: string, lexicon: string[]): boolean {
  const t = (title ?? '').toLowerCase();
  return lexicon.some((w) => t.includes(w.toLowerCase()));
}

/** Déséchappe les entités XML courantes rencontrées dans les titres YouTube. */
function unescapeXml(s: string): string {
  return s
    // Déballage CDATA en premier : le contenu y est littéral (ni entités ni balises).
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Entités hexadécimales (&#x27;, &#xE9;…) avant les décimales.
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // en dernier pour ne pas ré-interpréter les autres
}

/** Extrait le contenu d'une balise `<tag>...</tag>` (première occurrence) dans un fragment. */
function tag(fragment: string, name: string): string | null {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = fragment.indexOf(open);
  if (start === -1) return null;
  const end = fragment.indexOf(close, start + open.length);
  if (end === -1) return null;
  return fragment.slice(start + open.length, end);
}

/**
 * Parse un flux Atom YouTube en entrées normalisées.
 * Le nom de chaîne provient de l'`<author><name>` situé AVANT la première `<entry>`
 * (niveau flux), commun à toutes les vidéos.
 */
export function parseFeed(xml: string): RssEntry[] {
  const firstEntry = xml.indexOf('<entry>');
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const channel = unescapeXml((tag(head, 'name') ?? '').trim());

  const entries: RssEntry[] = [];
  let cursor = firstEntry;
  while (cursor !== -1) {
    const end = xml.indexOf('</entry>', cursor);
    if (end === -1) break;
    const chunk = xml.slice(cursor, end);

    const videoId = tag(chunk, 'yt:videoId');
    const title = tag(chunk, 'title');
    const published = tag(chunk, 'published');
    if (videoId && title) {
      entries.push({
        videoId: videoId.trim(),
        title: unescapeXml(title.trim()),
        publishedAt: (published ?? '').trim(),
        channel,
      });
    }

    cursor = xml.indexOf('<entry>', end);
  }
  return entries;
}

const FEED_URL = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

// Certaines chaînes ne servent le flux qu'avec un User-Agent « navigateur ».
const UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export type RssClient = {
  /** Entrées d'une chaîne (cache 10 min). [] si la chaîne est vide ou en erreur. */
  fetchChannelFeed: (channelId: string) => Promise<RssEntry[]>;
};

export type RssClientOptions = {
  /** fetch injectable (défaut : global fetch avec UA navigateur). */
  fetchImpl?: FetchImpl;
  /** Cache par channelId (injectable pour tests). */
  cache?: TTLCache<RssEntry[]>;
  /** TTL du cache par chaîne (défaut 10 min). */
  ttlMs?: number;
};

const DEFAULT_RSS_TTL_MS = 10 * 60 * 1000; // 10 min

/**
 * Construit un client RSS avec cache in-memory 10 min par chaîne.
 * Un échec réseau ne remonte jamais : on renvoie [] (le feed reste servi).
 */
export function createRssClient(options: RssClientOptions = {}): RssClient {
  const doFetch: FetchImpl =
    options.fetchImpl ??
    ((url) => fetch(url, { headers: { 'User-Agent': UA } }));
  const cache = options.cache ?? new TTLCache<RssEntry[]>({ ttlMs: options.ttlMs ?? DEFAULT_RSS_TTL_MS });
  const ttlMs = options.ttlMs ?? DEFAULT_RSS_TTL_MS;

  return {
    async fetchChannelFeed(channelId: string): Promise<RssEntry[]> {
      const cached = cache.get(channelId);
      if (cached) return cached;

      try {
        const res = await doFetch(FEED_URL(channelId));
        if (!res.ok) {
          console.error(`[rss] ${channelId} HTTP ${res.status}`);
          return [];
        }
        const xml = await res.text();
        const entries = parseFeed(xml);
        cache.set(channelId, entries, ttlMs);
        return entries;
      } catch (err) {
        console.error(`[rss] échec ${channelId}:`, err);
        return [];
      }
    },
  };
}
