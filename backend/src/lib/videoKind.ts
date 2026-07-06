// Détection du TYPE de vidéo à partir du titre AFFICHÉ (companion « appli résumés »).
//
// La companion met en avant LA vidéo résumé la plus récente (« Résumé du jour »)
// puis regroupe les autres résumés, et enfin « le reste » (interviews, analyses…).
// La détection est faite ICI, côté serveur, pour être testable et partagée : la
// route /feed annote chaque vidéo d'un `kind`, le front n'a plus qu'à trier.
//
// On classe sur le titre AFFICHÉ (safeTitle pour un spoiler — le titre réécrit par
// le LLM porte le format « Résumé étape N » / « Stage N Highlights » — ; titre
// original pour un non-spoiler). But : ne JAMAIS rater un vrai résumé (faux négatif)
// tout en gardant « Analyse » / « Interview / Réactions » hors de la catégorie recap.

export type VideoKind = 'recap' | 'other';

/**
 * Termes « résumé » multilingues (fr/en/es/it/de). Comparés sur une forme
 * NORMALISÉE (accents retirés + minuscules), donc écrits SANS accent ici :
 * « résumé » → « resume », « résumé long » couvert par « resume ».
 * Volontairement EXCLUS : « analyse/débrief/décryptage » et « interview/réactions »
 * ne sont pas des résumés (ils appartiennent à « autour de la course »).
 */
const RECAP_TERMS = [
  'resume',          // fr « résumé » / « résumé long »
  'resumen',         // es
  'riassunto',       // it
  'zusammenfassung', // de
  'highlights',      // en
  'temps forts',     // fr
  'summary',         // en
  'recap',           // en / fr
  'le film de',      // fr « le film de l'étape »
];

const RECAP_RE = new RegExp('(' + RECAP_TERMS.join('|') + ')');

/** Minuscule + retrait des diacritiques (é → e) pour un match accent-insensible. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * 'recap' si le titre affiché désigne un résumé / temps forts / highlights ;
 * 'other' sinon (interview, analyse, présentation d'étape, sujet annexe…).
 */
export function kind(title: string): VideoKind {
  if (!title) return 'other';
  return RECAP_RE.test(normalize(title)) ? 'recap' : 'other';
}
