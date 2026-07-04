// Content script SpoilGuard — pur câblage DOM.
// Toute la décision vit dans des libs testées : pack.js, matcher.js, safeTitle.js, extract.js.
// Ici on ne fait qu'observer le DOM et appliquer/révéler le voile, synchrone, avant paint.
import { TDF_2026 } from './lib/pack.js';
import { shouldVeil } from './lib/matcher.js';
import { buildLocalSafeTitle } from './lib/safeTitle.js';
import { extractCard, CARD_SELECTOR } from './lib/extract.js';

const pack = TDF_2026;
// Garde-fou principal contre le re-traitement ; doublé de l'attribut data-spoilguard
// (utile pour le debug/inspection et survivant si la carte est clonée sans le WeakSet).
const processed = new WeakSet();

// Retrouve l'élément titre d'une carte (les deux familles de markup).
function findTitleEl(card) {
  return card.querySelector('#video-title, .ytLockupMetadataViewModelTitle');
}

// Remet une carte dans son état d'origine (révélation ou recyclage YouTube).
function resetCard(card, titleEl) {
  const el = titleEl || findTitleEl(card);
  if (el && el.dataset.spoilguardOriginal != null) {
    el.textContent = el.dataset.spoilguardOriginal;
  }
  if (el) {
    el.classList.remove('spoilguard-safe-title');
    delete el.dataset.spoilguardOriginal;
    delete el.dataset.spoilguardSafe;
  }
  card.classList.remove('spoilguard-veiled');
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
  titleEl.textContent = safe;
  titleEl.classList.add('spoilguard-safe-title');
  titleEl.title = 'SpoilGuard — double-clic pour révéler';
  titleEl.addEventListener(
    'dblclick',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetCard(card, titleEl);
    },
    { once: true },
  );
}

function processCard(card) {
  if (processed.has(card)) return;
  const info = extractCard(card);
  if (!info.videoId || !info.title) return; // carte pas encore peuplée, on repassera
  processed.add(card);
  if (shouldVeil(info, pack)) {
    veil(card, info);
    card.setAttribute('data-spoilguard', 'veiled');
  } else {
    card.setAttribute('data-spoilguard', 'clean');
  }
}

// YouTube recycle ses cartes : le titre d'une carte déjà traitée peut changer pour
// une NOUVELLE vidéo. Mais NOTRE propre écriture du titre voilé déclenche aussi une
// mutation characterData → sans garde-fou, boucle infinie. On compare donc le texte
// courant à la signature du titre voilé : identique = notre écriture (ignorer),
// différent = vrai recyclage (repartir de zéro et re-traiter).
function handleTextChange(card) {
  const titleEl = findTitleEl(card);
  const current = (titleEl?.textContent || '').trim();
  const ourSafe = (titleEl?.dataset.spoilguardSafe || '').trim();
  if (titleEl && ourSafe && current === ourSafe) return; // notre propre écriture
  processed.delete(card);
  card.removeAttribute('data-spoilguard');
  resetCard(card, titleEl);
  processCard(card);
}

function scan(root) {
  if (root.matches?.(CARD_SELECTOR)) processCard(root);
  root.querySelectorAll?.(CARD_SELECTOR).forEach(processCard);
}

new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
    if (m.type === 'characterData') {
      // La cible d'une mutation characterData est le nœud texte → remonter au parent.
      const card = m.target.parentElement?.closest?.(CARD_SELECTOR);
      if (card) handleTextChange(card);
    }
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

if (document.body) scan(document.body);
console.log('[SpoilGuard] actif —', pack.label);
