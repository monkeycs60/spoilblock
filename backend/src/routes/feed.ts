// GET /feed/:competitionId — voir « Contrat d'API » (Phase 3) du plan phase 2-4.
//
// Agrège les flux RSS publics YouTube des chaînes à risque d'une compétition,
// passe les titres par le MÊME pipeline classify (+ cache) que /classify, et
// renvoie une liste de vidéos SANS spoiler.
//
// GARANTIE FORTE : le titre ORIGINAL d'une vidéo spoiler n'est JAMAIS renvoyé.
// - spoiler=true  → safeTitle = titre réécrit (ou générique).
// - spoiler=false → safeTitle = titre original (déjà sûr).
// Aucun `originalTitle` n'est jamais exposé : rien n'est « révélable » côté web
// (un spoiler ne doit jamais l'être, un non-spoiler n'a rien à révéler).

import { Hono } from 'hono';
import { TTLCache, classificationKey } from '../lib/cache';
import { createRateLimiter, type RateLimiter } from '../lib/rateLimit';
import { getCompetition, type Competition } from '../data/competitions';
import {
  createRssClient,
  resolveChannelId,
  isGeneralistChannel,
  titleMatchesLexicon,
  type RssEntry,
} from '../lib/rss';
import { captureServerEvent, BACKEND_DISTINCT_ID } from '../lib/posthog';
import type { Classification, ClassifyFn, Video } from '../lib/classifier';
import { kind, type VideoKind } from '../lib/videoKind';

/** Une vidéo telle que renvoyée par /feed (jamais de titre original révélable). */
export type FeedVideo = {
  videoId: string;
  safeTitle: string;
  publishedAt: string;
  channel: string;
  /**
   * true = titre réécrit / voilé. Sur la companion AUCUNE miniature YouTube n'est
   * jamais chargée (même pour un non-spoiler : une miniature au titre neutre peut
   * montrer le vainqueur) ; ce flag ne sert plus qu'au badge « protégé ».
   */
  spoiler: boolean;
  /**
   * Type de contenu déduit du titre AFFICHÉ (voir lib/videoKind) : 'recap' pour un
   * résumé / temps forts / highlights, 'other' pour le reste (interviews, analyses…).
   * Le front met en avant le 1er 'recap' du feed trié (« Résumé du jour »).
   */
  kind: VideoKind;
};

export type FeedResponse = { videos: FeedVideo[] };

/**
 * Valeur mise en cache : la réponse publique + le nombre de spoilers voilés
 * (compteur interne, jamais exposé au client) pour émettre `feed_served` avec un
 * décompte exact même sur un cache hit.
 */
type CachedFeed = { response: FeedResponse; spoilers: number };

export type FeedRouteDeps = {
  /** Même classifieur que /classify (injecté via app.ts). */
  classify: ClassifyFn;
  /** Cache de classification PARTAGÉ avec /classify (par videoId, TTL 24 h). */
  cache?: TTLCache<Classification>;
  /** Rate limiter partagé (injectable pour tests). */
  rateLimiter?: RateLimiter;
  rateLimit?: { limit?: number; windowMs?: number };
  /** Récupération des entrées d'une chaîne (injectable pour mock RSS en test). */
  fetchChannelFeed?: (channelId: string) => Promise<RssEntry[]>;
  /** Cache de la réponse assemblée (par competitionId, TTL 10 min). */
  feedCache?: TTLCache<CachedFeed>;
  /** Horloge injectable (ms epoch) pour la fenêtre de fraîcheur — pinnable en test. */
  now?: () => number;
};

/** Nombre max de vidéos renvoyées (aligné sur la limite de batch classify). */
const MAX_VIDEOS = 30;
/** TTL du cache de réponse assemblée. */
const FEED_TTL_MS = 10 * 60 * 1000; // 10 min
/** Garde-fou anti-flooding sur un safeTitle (identique à /classify). */
const SAFE_TITLE_MAX = 300;

function genericSafeTitle(comp: Competition): string {
  return `${comp.emoji} ${comp.label} – contenu récent`;
}

function clientIp(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const parts = header.split(',');
  return parts[parts.length - 1].trim() || fallback;
}

/** ms depuis epoch d'une date ISO, 0 si absente/invalide (tri robuste). */
function toMillis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * true si la vidéo date de ≤ maxAgeHours par rapport à `nowMs`. Une date absente ou
 * illisible est considérée NON fraîche (exclue) : le feed companion doit montrer « le
 * résumé de la DERNIÈRE étape/course », pas les archives — mieux vaut rien qu'une
 * vidéo dont on ne peut pas garantir la fraîcheur.
 */
function isFresh(publishedAt: string, maxAgeHours: number, nowMs: number): boolean {
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= maxAgeHours * 60 * 60 * 1000;
}

export function createFeedRoute(deps: FeedRouteDeps) {
  const cache = deps.cache ?? new TTLCache<Classification>();
  const rateLimiter =
    deps.rateLimiter ?? createRateLimiter(deps.rateLimit ?? { limit: 60, windowMs: 60_000 });
  const feedCache = deps.feedCache ?? new TTLCache<CachedFeed>({ ttlMs: FEED_TTL_MS });
  const fetchChannelFeed =
    deps.fetchChannelFeed ?? createRssClient().fetchChannelFeed;
  const now = deps.now ?? Date.now;

  const app = new Hono();

  app.get('/:competitionId', async (c) => {
    const ip = clientIp(c.req.header('x-forwarded-for'), 'unknown');
    if (!rateLimiter.check(ip)) {
      return c.json({ error: 'rate_limited', message: 'Trop de requêtes, réessayez dans une minute.' }, 429);
    }

    const competitionId = c.req.param('competitionId');
    const comp = getCompetition(competitionId);
    if (!comp) {
      return c.json({ error: 'unknown_competition', message: `Compétition inconnue : ${competitionId}` }, 404);
    }

    // Réponse assemblée en cache 10 min.
    const cached = feedCache.get(competitionId);
    if (cached) {
      c.header('X-Feed-Cache', 'hit');
      captureServerEvent('feed_served', BACKEND_DISTINCT_ID, {
        competitionId,
        videos: cached.response.videos.length,
        spoilers: cached.spoilers,
      });
      return c.json(cached.response);
    }

    // 1. Résolution des chaînes → channelIds (dédupliqués, ignore les inconnues).
    //    On garde par channelId son caractère « généraliste » (une chaîne mono-
    //    thématique ET généraliste étant impossible, OR suffit si plusieurs noms
    //    pointent le même id).
    const generalistById = new Map<string, boolean>();
    for (const name of comp.channels) {
      const id = resolveChannelId(name);
      if (id === undefined) continue;
      generalistById.set(id, (generalistById.get(id) ?? false) || isGeneralistChannel(name));
    }

    // 2. Récupération parallèle des flux RSS (un échec n'interrompt rien). Pour une
    //    chaîne GÉNÉRALISTE (multi-sports), on ne garde de son flux que les vidéos
    //    dont le titre matche le lexique du pack demandé — sinon un feed « Tour de
    //    France » remonterait le foot d'Eurosport. Les chaînes spécialisées passent
    //    sans filtre (tout leur flux concerne déjà la compétition).
    const feeds = await Promise.all(
      [...generalistById].map(async ([id, generalist]) => {
        const channelEntries = await fetchChannelFeed(id);
        return generalist
          ? channelEntries.filter((e) => titleMatchesLexicon(e.title, comp.lexicon))
          : channelEntries;
      })
    );
    const entries = feeds.flat();

    // 3. Dédup par videoId (une même vidéo peut apparaître sur 2 flux), fenêtre de
    //    FRAÎCHEUR (≤ maxAgeHours : « le résumé de la DERNIÈRE étape », pas les
    //    archives), tri par date décroissante, puis 30 max.
    const nowMs = now();
    const byVideo = new Map<string, RssEntry>();
    for (const e of entries) {
      if (!byVideo.has(e.videoId)) byVideo.set(e.videoId, e);
    }
    const sorted = [...byVideo.values()]
      .filter((e) => isFresh(e.publishedAt, comp.maxAgeHours, nowMs))
      .sort((a, b) => toMillis(b.publishedAt) - toMillis(a.publishedAt))
      .slice(0, MAX_VIDEOS);

    // 4. Classification via le pipeline partagé (mêmes cache-hit/miss que /classify).
    const misses: Video[] = [];
    const classifications = new Map<string, Classification>();
    // Clé de cache scopée par compétition (= [competitionId] pour un feed) : un
    // résultat posé par une AUTRE compétition ne peut pas fuiter ici (C1).
    for (const e of sorted) {
      const hit = cache.get(classificationKey([competitionId], e.videoId));
      if (hit) classifications.set(e.videoId, hit);
      else misses.push({ videoId: e.videoId, title: e.title, channel: e.channel });
    }
    if (misses.length > 0) {
      const fresh = await deps.classify([competitionId], misses);
      for (const r of fresh) {
        // un repli ne pollue pas le cache 24 h
        if (!r.fallback) cache.set(classificationKey([competitionId], r.videoId), r);
        classifications.set(r.videoId, r);
      }
    }

    // Event produit : le passage LLM déclenché par ce feed (compteurs seulement).
    captureServerEvent('classify_batch', BACKEND_DISTINCT_ID, {
      competitions: [competitionId],
      hits: sorted.length - misses.length,
      misses: misses.length,
      source: 'feed',
    });

    // 5. Assemblage SANS jamais exposer le titre original d'un spoiler.
    let spoilers = 0;
    const videos: FeedVideo[] = sorted.map((e) => {
      const r =
        classifications.get(e.videoId) ??
        ({ videoId: e.videoId, spoiler: true, safeTitle: null } as Classification);

      if (r.spoiler) {
        spoilers += 1;
        const safeTitle = (r.safeTitle ?? genericSafeTitle(comp)).slice(0, SAFE_TITLE_MAX);
        return {
          videoId: e.videoId,
          safeTitle,
          publishedAt: e.publishedAt,
          channel: e.channel,
          spoiler: true,
          // Type déduit du titre AFFICHÉ (le safeTitle réécrit).
          kind: kind(safeTitle),
        };
      }
      // Non-spoiler : le titre original est sûr → il devient directement le safeTitle.
      return {
        videoId: e.videoId,
        safeTitle: e.title,
        publishedAt: e.publishedAt,
        channel: e.channel,
        spoiler: false,
        // Type déduit du titre AFFICHÉ (= le titre original, déjà sûr).
        kind: kind(e.title),
      };
    });

    const response: FeedResponse = { videos };
    feedCache.set(competitionId, { response, spoilers }, FEED_TTL_MS);
    c.header('X-Feed-Cache', 'miss');
    captureServerEvent('feed_served', BACKEND_DISTINCT_ID, {
      competitionId,
      videos: videos.length,
      spoilers,
    });
    return c.json(response);
  });

  return app;
}
