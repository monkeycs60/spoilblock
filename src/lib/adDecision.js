// Décision pure : une carte SPONSORISÉE (renderer publicitaire) doit-elle être voilée ?
// Contexte : les pubs YouTube (ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,
// ytd-promoted-sparkles-web-renderer…) n'ont ni videoId fiable ni entrée backend. On ne
// peut donc pas leur appliquer la classification LLM. Traitement pragmatique et sûr :
// pré-filtre LEXICAL uniquement, sur le textContent AGRÉGÉ du bloc pub, contre le lexique
// du pack fusionné actif. Aucune manipulation DOM ici — le câblage vit dans content.js.
import { matchesLexicon } from './matcher.js';

// `text` : textContent agrégé du bloc pub. `pack` : pack fusionné actif (state.merged).
// Retourne true (→ floutter le bloc) uniquement si un mot du lexique apparaît dans le
// texte. Pack absent / lexique vide (aucune compétition active) → false : on ne voile
// jamais une pub sans signal explicite (pas de sur-masquage des annonces neutres).
export function shouldVeilAd(text, pack) {
  if (!pack || !Array.isArray(pack.lexicon) || pack.lexicon.length === 0) return false;
  return matchesLexicon(text, pack);
}
