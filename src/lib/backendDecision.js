// Décision pure : que faire d'une carte DÉJÀ voilée par le pré-filtre (Phase 1)
// lorsque la réponse du backend arrive (via le service worker). Aucune manipulation
// DOM ici — le câblage vit dans content.js. Le service worker et le content script ne
// communiquent que par messages ; cette fonction ne connaît que des données brutes.
//
// `result` est l'entrée du tableau `results` renvoyé par le backend pour ce videoId :
//   { videoId, spoiler: true, safeTitle: '...' }  → vraie carte spoiler, titre neutre backend
//   { videoId, spoiler: false }                   → faux positif du pré-filtre → dé-voiler
//   { videoId, unavailable: true }                → backend indispo/timeout → garder le voile Phase 1
//   null / undefined                              → pas de réponse exploitable → ne rien faire
//
// Chaque résultat backend porte aussi `publishedAt` (ISO string | null) : la date de
// publication réelle de la vidéo. On l'exploite pour lever le sur-voile des vieilles
// vidéos quand l'âge affiché dans le DOM n'était pas parsable au moment du voilage.
//
// `maxAgeHours` (seuil de la compétition, ex. 72) et `now` (Date.now()) sont passés en
// paramètres → la fonction reste PURE et déterministe (aucun accès à l'horloge interne).
//
// État de la carte au moment où la réponse arrive (elle a pu changer entre-temps) :
//   veiled   : la carte porte TOUJOURS notre voile générique (data-spoilguard === 'veiled')
//   revealed : l'utilisateur a révélé la carte (dblclic) entre-temps → on respecte son geste
//   videoId  : le videoId courant de la carte (recyclage YouTube → ne pas appliquer une
//              réponse périmée destinée à l'ancienne vidéo)
//
// Sorties :
//   'noop'       → ne rien faire (indispo, réponse périmée, carte révélée ou plus voilée…)
//   'unveil'     → dé-voiler définitivement + marquer clean (spoiler:false, faux positif)
//   'unveil-old' → dé-voiler définitivement une vraie carte spoiler mais TROP VIEILLE
//                  (publiée depuis > maxAgeHours) : plus aucun risque de spoil
//   'retitle'    → remplacer le titre générique par le safeTitle backend (spoiler:true + safeTitle)
export function backendDecision({ result, veiled, revealed, videoId, maxAgeHours, now }) {
  if (!result) return 'noop';
  if (result.unavailable) return 'noop';

  // Réponse destinée à une autre vidéo (carte recyclée depuis l'envoi) → ignorer.
  if (result.videoId != null && videoId != null && result.videoId !== videoId) {
    return 'noop';
  }

  // L'utilisateur a révélé la carte entre-temps : son geste prime, on n'y touche plus.
  if (revealed) return 'noop';

  // La carte n'est plus voilée (déjà dé-voilée, recyclée, révélée…) → rien à faire.
  if (!veiled) return 'noop';

  // Faux positif du pré-filtre : dé-voilement normal, prioritaire (la règle « vieille
  // vidéo » ci-dessous ne concerne QUE les vraies cartes spoiler).
  if (result.spoiler === false) return 'unveil';

  if (result.spoiler === true) {
    // Règle « vieille vidéo » : le backend confirme le spoiler, MAIS si la vidéo est
    // publiée depuis plus longtemps que le seuil de la compétition, elle ne présente
    // plus de risque (le sur-voile venait d'un âge DOM non parsable au voilage). Cette
    // règle des 72h PRIME sur le retitrage du verdict spoiler.
    if (isOlderThanMax(result.publishedAt, now, maxAgeHours)) return 'unveil-old';

    const safe = typeof result.safeTitle === 'string' ? result.safeTitle.trim() : '';
    // Titre neutre backend disponible → le substituer ; sinon le voile générique Phase 1
    // reste (aucune régression, dégradation gracieuse).
    return safe ? 'retitle' : 'noop';
  }

  return 'noop';
}

// Âge (now - publishedAt) strictement supérieur à maxAgeHours ? Fonction totale et
// défensive : publishedAt absent/null/non parsable, ou paramètres now/maxAgeHours non
// fournis → false (comportement inchangé, on retombe sur retitle/noop). Frontière EXACTE :
// un âge égal à maxAgeHours n'est PAS « plus vieux » (strictement >).
function isOlderThanMax(publishedAt, now, maxAgeHours) {
  if (typeof publishedAt !== 'string' || !publishedAt) return false;
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeHours)) return false;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return false;
  const ageHours = (now - published) / 3_600_000;
  return ageHours > maxAgeHours;
}
