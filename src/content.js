// Content script SpoilGuard — pur câblage DOM.
// Toute la décision vit dans des libs testées : pack.js, matcher.js, safeTitle.js,
// extract.js, reprocess.js. Ici on ne fait qu'observer le DOM et appliquer/révéler
// le voile, synchrone, avant paint.
import { TDF_2026 } from './lib/pack.js';
import { shouldVeil } from './lib/matcher.js';
import { buildLocalSafeTitle } from './lib/safeTitle.js';
import { extractCard, CARD_SELECTOR } from './lib/extract.js';
import { decideReprocess, decideAgeUpdate } from './lib/reprocess.js';

const pack = TDF_2026;
// Page /watch : le h1 principal spoile aussi. On le traite comme une pseudo-carte
// (même logique shouldVeil + titre neutre + dblclic) via un sélecteur dédié. On ne
// touche JAMAIS au lecteur (#movie_player) : notre voile ne cible que ytd-watch-metadata.
const WATCH_SELECTOR = 'ytd-watch-metadata';
const WATCH_AGE_RE = /il y a|\bago\b/i;

function isWatchCard(card) {
  return !!card.matches?.(WATCH_SELECTOR);
}

// Extraction spécifique à la pseudo-carte /watch (structure différente des cartes de
// liste). videoId est un simple sentinelle « présence du titre » : shouldVeil ne s'en
// sert pas, il ne sert qu'au garde « carte pas encore peuplée » de processCard.
function extractWatchCard(card) {
  const titleEl = card.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string',
  );
  const title = titleEl?.textContent.trim() || '';
  const cn = card.querySelector('ytd-channel-name #text');
  const channel =
    (cn?.textContent || '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || '';
  let ageText = null;
  for (const s of card.querySelectorAll('ytd-watch-info-text span')) {
    if (WATCH_AGE_RE.test(s.textContent)) {
      ageText = s.textContent.trim() || null;
      break;
    }
  }
  return { videoId: title ? 'watch' : null, title, channel, ageText, titleEl };
}

// Sélectionne le bon extracteur selon le type de nœud (liste vs page /watch).
function extractAny(card) {
  return isWatchCard(card) ? extractWatchCard(card) : extractCard(card);
}
// Garde-fou principal contre le re-traitement ; doublé de l'attribut data-spoilguard
// (utile pour le debug/inspection et survivant si la carte est clonée sans le WeakSet).
const processed = new WeakSet();
// Handlers dblclick par carte → permet de garantir un seul listener (anti-accumulation)
// et de le détacher proprement au reset/à la révélation.
const dblHandlers = new WeakMap();

// Retrouve l'élément titre d'une carte (les deux familles de markup de liste + le
// h1 de la pseudo-carte /watch, pour que stripVeil/reveal retrouvent le bon nœud).
function findTitleEl(card) {
  return card.querySelector(
    '#video-title, .ytLockupMetadataViewModelTitle, h1.ytd-watch-metadata yt-formatted-string',
  );
}

// Attache le listener dblclick une seule fois par carte (correctif anti-accumulation).
function attachReveal(card, titleEl) {
  if (dblHandlers.has(card)) return; // déjà voilée avec un listener → ne pas empiler
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    reveal(card, titleEl);
  };
  dblHandlers.set(card, { el: titleEl, handler });
  titleEl.addEventListener('dblclick', handler);
}

function detachReveal(card) {
  const rec = dblHandlers.get(card);
  if (rec) {
    rec.el.removeEventListener('dblclick', rec.handler);
    dblHandlers.delete(card);
  }
}

// Retire nos décorations d'une carte voilée.
//   restoreText=true  (révélation, même vidéo) → on remet le titre ET l'aria d'origine.
//   restoreText=false (recyclage YouTube)      → on NE remet PAS le texte (YouTube a
//                       déjà écrit le nouveau titre : le restaurer l'écraserait) et on
//                       retire simplement notre aria (le nom accessible retombe sur le
//                       nouveau texte, avant que processCard ne re-voile si besoin).
function stripVeil(card, titleEl, restoreText) {
  const el = titleEl || findTitleEl(card);
  if (el) {
    if (restoreText && el.dataset.spoilguardOriginal != null) {
      el.textContent = el.dataset.spoilguardOriginal;
    }
    if (el.dataset.spoilguardAriaHad != null) {
      if (restoreText && el.dataset.spoilguardAriaHad === '1') {
        el.setAttribute('aria-label', el.dataset.spoilguardAriaOriginal ?? '');
      } else {
        el.removeAttribute('aria-label');
      }
      delete el.dataset.spoilguardAriaHad;
      delete el.dataset.spoilguardAriaOriginal;
    }
    el.classList.remove('spoilguard-safe-title');
    el.removeAttribute('title');
    delete el.dataset.spoilguardOriginal;
    delete el.dataset.spoilguardSafe;
  }
  card.classList.remove('spoilguard-veiled');
  detachReveal(card);
}

// Révélation par l'utilisateur : on découvre le vrai titre et on marque la carte
// comme révélée. Elle reste dans `processed` : on ne la re-voilera pas tant que la
// vidéo ne change pas (comparaison au titre mémorisé ici).
function reveal(card, titleEl) {
  const el = titleEl || findTitleEl(card);
  stripVeil(card, el, true);
  card.dataset.spoilguardRevealed = '1';
  card.dataset.spoilguardRevealedTitle = (el?.textContent || '').trim();
  card.setAttribute('data-spoilguard', 'revealed');
}

// Reset complet : carte recyclée pour une autre vidéo. On efface tout état (WeakSet,
// attributs data-*, classes, listener) SANS restaurer de texte périmé, puis
// processCard réévaluera le nouveau contenu.
function fullReset(card) {
  stripVeil(card, findTitleEl(card), false);
  processed.delete(card);
  card.removeAttribute('data-spoilguard');
  delete card.dataset.spoilguardSig;
  delete card.dataset.spoilguardAge;
  delete card.dataset.spoilguardRevealed;
  delete card.dataset.spoilguardRevealedTitle;
}

function veil(card, info) {
  card.classList.add('spoilguard-veiled');
  const titleEl = info.titleEl;
  if (!titleEl) return;

  if (titleEl.dataset.spoilguardOriginal == null) {
    titleEl.dataset.spoilguardOriginal = info.title;
  }
  const safe = buildLocalSafeTitle(pack, info.ageText);
  // On mémorise le texte injecté : sert de signature pour distinguer NOTRE écriture
  // (à ignorer) d'un vrai changement de titre par YouTube (recyclage → re-traiter).
  titleEl.dataset.spoilguardSafe = safe;
  // Sauvegarde de l'aria-label d'origine puis neutralisation : sans ça le vrai titre
  // fuite aux lecteurs d'écran (le nom accessible de l'ancre) malgré le voile visuel.
  if (titleEl.dataset.spoilguardAriaHad == null) {
    const origAria = titleEl.getAttribute('aria-label');
    if (origAria != null) titleEl.dataset.spoilguardAriaOriginal = origAria;
    titleEl.dataset.spoilguardAriaHad = origAria != null ? '1' : '0';
  }
  titleEl.setAttribute('aria-label', safe);
  titleEl.textContent = safe;
  titleEl.classList.add('spoilguard-safe-title');
  titleEl.title = 'SpoilGuard — double-clic pour révéler';
  // Mémorise l'âge utilisé pour la décision : permet de détecter, quand les
  // métadonnées arrivent après coup, que l'âge réel diffère (correctif sur-voile).
  card.dataset.spoilguardAge = info.ageText ?? '';
  attachReveal(card, titleEl);
}

function processCard(card) {
  if (processed.has(card)) return;
  // Carte révélée mais hors WeakSet (nav SPA : le DOM survit, le WeakSet non).
  // On respecte la révélation tant que la vidéo n'a pas changé ; sinon recyclage.
  if (card.dataset.spoilguardRevealed === '1') {
    const current = (findTitleEl(card)?.textContent || '').trim();
    if (current === (card.dataset.spoilguardRevealedTitle || '')) return;
    fullReset(card);
  }
  const info = extractAny(card);
  if (!info.videoId || !info.title) return; // carte pas encore peuplée, on repassera
  processed.add(card);
  if (shouldVeil(info, pack)) {
    veil(card, info);
    card.setAttribute('data-spoilguard', 'veiled');
  } else {
    card.setAttribute('data-spoilguard', 'clean');
  }
  // Signature de l'état stable : titre voilé injecté (voilée) ou titre d'origine
  // (clean). Sert de référence anti-boucle / détection de recyclage côté observer.
  card.dataset.spoilguardSig = (findTitleEl(card)?.textContent || '').trim();
}

// Appelé quand une mutation (childList ou characterData) touche une carte déjà vue.
// La décision est déléguée à decideReprocess (pure, testée) ; on n'exécute ici que
// l'effet DOM correspondant.
function reprocessCard(card) {
  const titleEl = findTitleEl(card);
  const decision = decideReprocess({
    isProcessed: processed.has(card),
    currentTitle: (titleEl?.textContent || '').trim(),
    safeTitle: card.dataset.spoilguardSig || '',
    revealed: card.dataset.spoilguardRevealed === '1',
    revealedTitle: card.dataset.spoilguardRevealedTitle || '',
  });
  if (decision === 'ignore') {
    // La carte est stable pour decideReprocess, MAIS si elle est voilée son âge a pu
    // arriver/​changer depuis la pose du voile → réévaluer (correctif sur-voile).
    maybeUpdateVeiledAge(card, titleEl);
    return;
  }
  if (decision === 'reset') fullReset(card);
  processCard(card);
}

// Correctif « sur-voile des vieilles vidéos ». processCard peut voiler par prudence
// une carte dont #metadata-line n'est pas encore peuplé (ageText null → « vidéo
// récente »). Quand les métadonnées arrivent, decideReprocess conclut 'ignore' (le
// titre courant est notre titre neutre) et l'âge réel n'est jamais reconsidéré. Ici,
// sur une carte voilée, on ré-extrait l'âge ; s'il est réel et différent du stocké on
// rejoue shouldVeil : dé-voile complet si la vidéo n'est en fait pas récente, sinon
// simple rafraîchissement du titre neutre (l'âge affiché a changé).
function maybeUpdateVeiledAge(card, titleEl) {
  if (card.dataset.spoilguard !== 'veiled') return;
  const el = titleEl || findTitleEl(card);
  if (!el || el.dataset.spoilguardSafe == null) return; // pas (ou plus) notre voile
  const info = extractAny(card);
  const verdict = decideAgeUpdate({
    storedAge: card.dataset.spoilguardAge || '',
    newAge: info.ageText,
  });
  if (verdict !== 'reevaluate') return;

  const original = el.dataset.spoilguardOriginal ?? info.title;
  const stillVeil = shouldVeil(
    { channel: info.channel, ageText: info.ageText, title: original },
    pack,
  );
  if (!stillVeil) {
    // Faux positif : la vidéo n'est pas récente → dé-voile complet, carte clean.
    stripVeil(card, el, true);
    processed.add(card); // reste traitée : ne pas re-voiler à la prochaine mutation
    card.setAttribute('data-spoilguard', 'clean');
    card.dataset.spoilguardSig = (findTitleEl(card)?.textContent || '').trim();
    delete card.dataset.spoilguardAge;
  } else {
    // Toujours à voiler mais l'âge affiché a changé → rafraîchir le titre neutre,
    // la signature anti-boucle et l'âge stocké (sinon rejeu à l'infini).
    const safe = buildLocalSafeTitle(pack, info.ageText);
    el.dataset.spoilguardSafe = safe;
    el.setAttribute('aria-label', safe);
    el.textContent = safe;
    card.dataset.spoilguardSig = safe;
    card.dataset.spoilguardAge = info.ageText ?? '';
  }
}

function scan(root) {
  if (root.matches?.(CARD_SELECTOR) || root.matches?.(WATCH_SELECTOR)) processCard(root);
  root.querySelectorAll?.(CARD_SELECTOR).forEach(processCard);
  root.querySelectorAll?.(WATCH_SELECTOR).forEach(processCard);
}

// Remonte de la cible d'une mutation (souvent un nœud texte) à la carte qui la contient.
function cardOf(target) {
  const el = target.nodeType === 1 ? target : target.parentElement;
  return el?.closest?.(`${CARD_SELECTOR},${WATCH_SELECTOR}`) || null;
}

new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'childList') {
      for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
      // Les titres YouTube sont peuplés/recyclés en remplaçant des nœuds (childList),
      // pas via characterData. Si la mutation vise l'intérieur d'une carte connue,
      // on relance la décision de re-traitement.
      const card = cardOf(m.target);
      if (card) reprocessCard(card);
    } else if (m.type === 'characterData') {
      // Filet complémentaire : édition in-place d'un nœud texte existant.
      const card = cardOf(m.target);
      if (card) reprocessCard(card);
    }
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

if (document.body) scan(document.body);
console.log('[SpoilGuard] actif —', pack.label);
