// Décision pure de re-traitement d'une carte YouTube quand une mutation childList
// touche son sous-arbre (YouTube peuple ou recycle un titre via remplacement de
// nœuds, pas via characterData). Aucune manipulation DOM ici : le câblage vit
// dans content.js. Sorties :
//   'ignore'  → ne rien faire (notre propre écriture, carte stable, ou carte
//               révélée dont la vidéo n'a pas changé)
//   'reset'   → carte recyclée pour une AUTRE vidéo : tout réinitialiser puis retraiter
//   'process' → carte encore jamais traitée : la traiter
//
// `safeTitle` est la signature mémorisée pour une carte déjà traitée :
//   - carte voilée → le titre neutre injecté (dataset.spoilguardSafe / sig)
//   - carte clean  → son titre d'origine inchangé
// Comparer le titre courant à cette signature distingue notre écriture / un état
// stable (identique) d'un vrai recyclage YouTube (différent).
export function decideReprocess({ isProcessed, currentTitle, safeTitle, revealed, revealedTitle }) {
  const current = (currentTitle ?? '').trim();

  // Une carte révélée par l'utilisateur reste révélée tant que YouTube ne l'a pas
  // recyclée pour une autre vidéo. Ce cas prime sur tout le reste (même une
  // signature voilée résiduelle) : on compare au titre mémorisé à la révélation.
  if (revealed) {
    return current === (revealedTitle ?? '').trim() ? 'ignore' : 'reset';
  }

  // Jamais traitée → laisser processCard décider (voile / clean / carte pas encore peuplée).
  if (!isProcessed) return 'process';

  // Déjà traitée : signature identique = état stable (dont notre propre écriture
  // childList-silencieuse) ; différente = carte recyclée → repartir de zéro.
  return current === (safeTitle ?? '').trim() ? 'ignore' : 'reset';
}

// Décision pure de réévaluation d'une carte VOILÉE quand son âge affiché arrive ou
// change après coup. Contexte du bug « sur-voile » : processCard peut voiler une carte
// par prudence (ageText null car #metadata-line pas encore peuplé). Quand les
// métadonnées arrivent (mutation childList), le chemin normal conclut 'ignore' (le
// titre courant est notre titre neutre == signature) et l'âge réel n'est jamais
// reconsidéré. Ici on décide, à partir de l'âge stocké au moment du voile et de l'âge
// fraîchement extrait, s'il faut rejouer shouldVeil (le rejeu lui-même vit dans le
// câblage : ré-extraction + shouldVeil + dé-voile/refresh).
//   storedAge : dataset.spoilguardAge posé au voile ('' si l'âge était alors illisible)
//   newAge    : ageText ré-extrait (null si toujours illisible)
// Sorties :
//   'none'       → âge absent, vide, ou identique au stocké → ne rien faire
//   'reevaluate' → âge réel et différent du stocké → rejouer la décision de voile
export function decideAgeUpdate({ storedAge, newAge }) {
  if (newAge == null) return 'none'; // âge toujours illisible → prudence maintenue
  const fresh = String(newAge).trim();
  if (fresh === '') return 'none';
  const stored = (storedAge ?? '').trim();
  return fresh === stored ? 'none' : 'reevaluate';
}
