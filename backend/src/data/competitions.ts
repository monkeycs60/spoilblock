// Catalogue des compétitions suivies par SpoilGuard.
// Source de vérité des « packs » (chaînes à risque + lexique) — l'extension en
// garde une copie en dur comme fallback offline (voir GET /competitions).

export type Competition = {
  /** Identifiant stable utilisé par l'API (ex. "tdf-2026"). */
  id: string;
  /** Nom lisible affiché à l'utilisateur. */
  label: string;
  /** Emoji préfixant les safeTitle de cette compétition. */
  emoji: string;
  /** false = compétition connue mais désactivée (hors saison, WIP). */
  active: boolean;
  /** Une vidéo de ces chaînes datant de < maxAgeHours est voilée d'office. */
  maxAgeHours: number;
  /** Noms de chaînes normalisés en minuscules, comparés via includes(). */
  channels: string[];
  /** Longue traîne : titres matchant ces mots chez n'importe quelle chaîne. */
  lexicon: string[];
};

export const TDF_2026: Competition = {
  id: 'tdf-2026',
  label: 'Tour de France',
  emoji: '🚴',
  active: true,
  maxAgeHours: 72,
  // Recopié depuis src/lib/pack.js (pack de l'extension) — même contenu.
  channels: [
    'tour de france',
    'eurosport france',
    'eurosport',
    'france tv sport',
    'france.tv slash sport',
    "la chaine l'équipe",
    "l'équipe",
    'cycling pro net',
    'lanterne rouge',
    'velon cc',
    // Chaînes internationales (vérifiées 2026-07-06 : @handle via UA Googlebot → channelId,
    // puis RSS feeds/videos.xml validé, <name> confronté). Spécialisées cyclisme → aussi
    // dans CHANNEL_ID_MAP (feed companion) :
    'flobikes',
    'gcn racing',
    // Généralistes multi-sports → pré-filtre extension seulement (âge < 72h + LLM derrière) ;
    // volontairement HORS CHANNEL_ID_MAP pour ne pas polluer le feed RSS de la companion :
    'nbc sports',
    'tnt sports',
    'itv sport',
    'rtbfsport',
    'srf sport',
  ],
  lexicon: [
    'tour de france', 'tdf', 'maillot jaune', 'étape', 'etape', 'stage',
    'peloton', 'échappée', 'echappee', 'pogacar', 'pogačar', 'vingegaard',
    'evenepoel', 'contre-la-montre', 'clm', 'grand départ',
    // Vocabulaire multilingue (es/it/de/nl/en). « rit » (nl) et « GC » écartés :
    // substrings trop courts/ambigus (includes() → faux positifs). « stage »/« peloton » déjà là.
    'etapa', 'tappa', 'etappe', 'klassement',
    'stage winner', 'yellow jersey', 'maglia gialla', 'gelbes trikot',
    'highlights', 'recap', 'resumen', 'zusammenfassung',
  ],
};

export const WIMBLEDON_2026: Competition = {
  id: 'wimbledon-2026',
  label: 'Wimbledon',
  emoji: '🎾',
  active: true,
  // Période indicative : fin juin → mi-juillet 2026 (tournoi ~2 semaines).
  maxAgeHours: 72,
  // Recopié dans src/lib/pack.js (fallback offline de l'extension) — même contenu.
  channels: [
    'bein sports france',
    'wimbledon',
    'eurosport france',
    'eurosport',
    // Ajouts internationaux (vérifiés 2026-07-06). Spécialisées tennis → CHANNEL_ID_MAP :
    'tennis tv',
    'sky sport tennis',
    // Généraliste sport (US) → pré-filtre extension seulement (hors feed) :
    'espn',
    // BBC (@BBC) écartée : chaîne généraliste (news/divertissement), pas « sport-only » →
    // trop de faux positifs si voilée < 72h. Le tennis BBC n'est pas sur @BBC de toute façon.
  ],
  lexicon: [
    'wimbledon', 'djokovic', 'alcaraz', 'sinner', 'swiatek', 'sabalenka',
    'demi-finale', 'demi finale', 'quart de finale', 'quarts de finale',
    '3ème tour', '3eme tour', 'tie-break', 'tie break', 'gazon',
    'grand chelem', 'break', 'set decisif', 'set décisif',
    // Vocabulaire anglophone (sobre, termes spécifiques au tournoi) :
    'semifinal', 'semifinals', 'quarterfinal', 'quarterfinals',
    'centre court', 'grass court', 'grand slam',
  ],
};

export const F1_2026: Competition = {
  id: 'f1-2026',
  label: 'Formule 1',
  emoji: '🏎️',
  active: true,
  // Période indicative : saison mars → décembre 2026 (un GP ~tous les 1-2 weekends).
  maxAgeHours: 72,
  // Recopié dans src/lib/pack.js (fallback offline de l'extension) — même contenu.
  channels: [
    'formula 1',
    'canal+ sport',
    'canal+',
    // Ajouts internationaux (vérifiés 2026-07-06). Spécialisée F1 → CHANNEL_ID_MAP :
    'sky sports f1',
    // Généraliste sport (US, diffuseur F1) → pré-filtre extension seulement (hors feed) :
    'espn',
    // Écartées : Motorsport.com / @MotorsportNetwork (multi-séries : IndyCar, WEC, MotoGP…
    // → polluerait), ServusTV (chaîne généraliste autrichienne, pas sport-only).
  ],
  lexicon: [
    'f1', 'formule 1', 'formula 1', 'grand prix', 'gp de', 'gp d\'',
    'verstappen', 'leclerc', 'hamilton', 'norris', 'piastri', 'russell',
    'pole position', 'pole', 'qualifs', 'qualifications', 'sprint',
    'podium', 'grille de départ', 'grille de depart',
    // Vocabulaire multilingue (en/es/it/de). « podium »/« pole » déjà présents ;
    // termes cyrilliques (« чемпион ») écartés (on reste en alphabet latin) :
    'qualifying', 'race highlights', 'gran premio', 'grosser preis',
    'formula uno', 'fastest lap',
  ],
};

/** Catalogue complet (actives + inactives). */
export const COMPETITIONS: Competition[] = [TDF_2026, WIMBLEDON_2026, F1_2026];

const BY_ID = new Map(COMPETITIONS.map((c) => [c.id, c]));

/** Renvoie une compétition par id, ou undefined si inconnue. */
export function getCompetition(id: string): Competition | undefined {
  return BY_ID.get(id);
}

/** Résout une liste d'ids en compétitions connues (ignore les inconnues). */
export function resolveCompetitions(ids: string[]): Competition[] {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((c): c is Competition => c !== undefined);
}
