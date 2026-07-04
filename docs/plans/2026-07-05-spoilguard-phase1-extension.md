# SpoilGuard Phase 1 — Extension Chrome « chaînes connues » Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extension Chrome MV3 qui voile instantanément (titre + miniature) toute vidéo récente des chaînes à risque du Tour de France 2026, sans backend ni LLM — utilisable en local dès la fin du plan.

**Architecture:** Content script sur youtube.com avec MutationObserver ; toute la logique de décision (pack en dur, matching chaîne, parsing d'âge, extraction de carte) vit dans des modules purs testés unitairement ; le content script n'est que du câblage DOM. Bundle esbuild (les content scripts MV3 ne supportent pas les modules ES). Design complet : `docs/plans/2026-07-04-spoilguard-design.md`.

**Tech Stack:** JavaScript (pas de TS en phase 1 — YAGNI), esbuild, vitest + jsdom, Manifest V3.

**Règle métier centrale (rappel design) :**
```
SI  chaîne ∈ pack.channels  ET  vidéo < 72h  → voiler avant paint, sans réseau
SINON SI titre matche pack.lexicon          → voiler aussi (phase 1 : même traitement)
Titre voilé = "🛡️ Tour de France – vidéo d'il y a Xh" (généré localement)
Badge 🛡️ cliquable → révèle titre + miniature d'origine
```

---

## Task 1: Scaffold du projet

**Files:**
- Create: `package.json`, `.gitignore`, `manifest.json`, `assets/icon128.png`

**Step 1: Init npm + deps**

```bash
cd ~/Desktop/spoilguard
npm init -y
npm i -D esbuild vitest jsdom
```

**Step 2: `package.json` — scripts** (fusionner dans le fichier généré)

```json
{
  "name": "spoilguard",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild src/content.js --bundle --outfile=dist/content.js && cp src/veil.css dist/veil.css",
    "watch": "esbuild src/content.js --bundle --outfile=dist/content.js --watch",
    "test": "vitest run"
  }
}
```

**Step 3: `.gitignore`**

```
node_modules/
dist/
```

**Step 4: `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "SpoilGuard",
  "version": "0.1.0",
  "description": "Masque les spoilers de résultats sportifs sur YouTube (Tour de France 2026).",
  "icons": { "128": "assets/icon128.png" },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*"],
      "js": ["dist/content.js"],
      "css": ["dist/veil.css"],
      "run_at": "document_start"
    }
  ]
}
```

`run_at: document_start` est essentiel : l'observer doit être en place avant le premier paint.

**Step 5: Icône placeholder**

```bash
mkdir -p assets src dist
# N'importe quel PNG 128x128 fait l'affaire (ex: emoji bouclier exporté, ou :)
python3 -c "import struct,zlib;d=zlib.compress(b'\x00'+b'\x1e\x64\x8f\xff'*128+(b'\x00'+b'\x1e\x64\x8f\xff'*128)*127);open('assets/icon128.png','wb').write(b'\x89PNG\r\n\x1a\n'+b''.join(struct.pack('>I',len(c))+t+c+struct.pack('>I',zlib.crc32(t+c)) for t,c in [(b'IHDR',struct.pack('>IIBBBBB',128,128,8,6,0,0,0)),(b'IDAT',d),(b'IEND',b'')]))"
```

**Step 6: Vérifier que le build tourne (content.js vide pour l'instant)**

```bash
echo "console.log('[SpoilGuard] loaded');" > src/content.js
touch src/veil.css
npm run build
```
Expected: `dist/content.js` et `dist/veil.css` créés, exit 0.

**Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold extension MV3 (esbuild + vitest)"
```

---

## Task 2: Pack Tour de France 2026 (données en dur)

**Files:**
- Create: `src/lib/pack.js`

**Step 1: Écrire le pack** (pas de test — données pures ; les noms de chaînes seront vérifiés en Task 7 sur YouTube réel et ajustés si besoin)

```js
export const TDF_2026 = {
  id: 'tdf-2026',
  label: 'Tour de France',
  emoji: '🚴',
  maxAgeHours: 72,
  // Noms de chaînes normalisés en minuscules, comparés via includes()
  channels: [
    'tour de france',
    'eurosport france',
    'eurosport',
    'france tv sport',
    'france.tv slash sport',
    'la chaine l\'équipe',
    'l\'équipe',
    'cycling pro net',
    'lanterne rouge',
    'velon cc',
  ],
  // Longue traîne : titres matchant ces mots chez n'importe quelle chaîne
  lexicon: [
    'tour de france', 'tdf', 'maillot jaune', 'étape', 'etape', 'stage',
    'peloton', 'échappée', 'echappee', 'pogacar', 'pogačar', 'vingegaard',
    'evenepoel', 'contre-la-montre', 'clm', 'grand départ',
  ],
};
```

**Step 2: Commit**

```bash
git add src/lib/pack.js && git commit -m "feat: pack Tour de France 2026 en dur"
```

---

## Task 3: Matcher (chaîne à risque, âge, lexique)

**Files:**
- Create: `src/lib/matcher.js`
- Test: `tests/matcher.test.js`

**Step 1: Écrire les tests qui échouent**

```js
import { describe, it, expect } from 'vitest';
import { isHighRiskChannel, parseAgeHours, matchesLexicon, shouldVeil } from '../src/lib/matcher.js';
import { TDF_2026 } from '../src/lib/pack.js';

describe('isHighRiskChannel', () => {
  it('matche insensible à la casse', () =>
    expect(isHighRiskChannel('Eurosport France', TDF_2026)).toBe(true));
  it('matche un nom partiel (badge vérifié, suffixes)', () =>
    expect(isHighRiskChannel('france.tv Slash Sport', TDF_2026)).toBe(true));
  it('ne matche pas une chaîne quelconque', () =>
    expect(isHighRiskChannel('Sylvain Lemaire', TDF_2026)).toBe(false));
});

describe('parseAgeHours', () => {
  it('parse les heures FR', () => expect(parseAgeHours('il y a 10 heures')).toBe(10));
  it('parse les jours FR', () => expect(parseAgeHours('il y a 2 jours')).toBe(48));
  it('parse les minutes FR comme <1h', () => expect(parseAgeHours('il y a 35 minutes')).toBe(0));
  it('parse l\'anglais', () => expect(parseAgeHours('10 hours ago')).toBe(10));
  it('parse "1 day ago"', () => expect(parseAgeHours('1 day ago')).toBe(24));
  it('semaines/mois/ans = vieux', () => expect(parseAgeHours('il y a 3 semaines')).toBe(504));
  it('inconnu → null (prudence: on voile)', () => expect(parseAgeHours('Diffusé il y a peu')).toBe(null));
});

describe('matchesLexicon', () => {
  it('matche un mot du lexique dans le titre', () =>
    expect(matchesLexicon('Résumé étape 14 - quelle journée !', TDF_2026)).toBe(true));
  it('ne matche pas un titre hors sujet', () =>
    expect(matchesLexicon('La chute de Fitness Park expliquée', TDF_2026)).toBe(false));
});

describe('shouldVeil', () => {
  it('chaîne à risque + récent → true', () =>
    expect(shouldVeil({ channel: 'Eurosport', ageText: 'il y a 1 jour', title: 'peu importe' }, TDF_2026)).toBe(true));
  it('chaîne à risque + vieux → false', () =>
    expect(shouldVeil({ channel: 'Eurosport', ageText: 'il y a 3 semaines', title: 'x' }, TDF_2026)).toBe(false));
  it('chaîne à risque + âge illisible → true (prudence)', () =>
    expect(shouldVeil({ channel: 'Eurosport', ageText: '???', title: 'x' }, TDF_2026)).toBe(true));
  it('chaîne inconnue + titre lexique + récent → true', () =>
    expect(shouldVeil({ channel: 'Un Vlogueur', ageText: 'il y a 5 heures', title: 'Le maillot jaune change !' }, TDF_2026)).toBe(true));
  it('chaîne inconnue + titre neutre → false', () =>
    expect(shouldVeil({ channel: 'Swapn', ageText: 'il y a 2 j', title: 'Fitness Park' }, TDF_2026)).toBe(false));
});
```

**Step 2: Vérifier l'échec** — Run: `npm test` — Expected: FAIL (module inexistant).

**Step 3: Implémentation minimale**

```js
// src/lib/matcher.js
export function isHighRiskChannel(channelName, pack) {
  const c = (channelName || '').toLowerCase().trim();
  return pack.channels.some((known) => c.includes(known));
}

const AGE_UNITS = [
  [/minute/i, 0], [/\bmin\b/i, 0], [/seconde|second/i, 0],
  [/heure|hour|\bh\b/i, 1], [/jour|day|\bj\b/i, 24],
  [/semaine|week/i, 168], [/mois|month/i, 720], [/\ban[s]?\b|year/i, 8760],
];

export function parseAgeHours(ageText) {
  const m = (ageText || '').match(/(\d+)\s*(\p{L}+)/u);
  if (!m) return null;
  const n = Number(m[1]);
  for (const [re, mult] of AGE_UNITS) if (re.test(m[2])) return n * mult;
  return null;
}

export function matchesLexicon(title, pack) {
  const t = (title || '').toLowerCase();
  return pack.lexicon.some((w) => t.includes(w));
}

export function shouldVeil({ channel, ageText, title }, pack) {
  const age = parseAgeHours(ageText);
  const recent = age === null || age < pack.maxAgeHours; // âge illisible → prudence
  if (!recent) return false;
  return isHighRiskChannel(channel, pack) || matchesLexicon(title, pack);
}
```

**Step 4: Vérifier le passage** — Run: `npm test` — Expected: PASS (15 tests).

**Step 5: Commit**

```bash
git add src/lib/matcher.js tests/matcher.test.js
git commit -m "feat: matcher chaînes à risque + âge + lexique (TDD)"
```

---

## Task 4: Titre voilé local

**Files:**
- Create: `src/lib/safeTitle.js`
- Test: `tests/safeTitle.test.js`

**Step 1: Test qui échoue**

```js
import { it, expect } from 'vitest';
import { buildLocalSafeTitle } from '../src/lib/safeTitle.js';
import { TDF_2026 } from '../src/lib/pack.js';

it('construit un titre neutre avec âge', () =>
  expect(buildLocalSafeTitle(TDF_2026, 'il y a 10 heures'))
    .toBe('🛡️ 🚴 Tour de France – vidéo (il y a 10 heures)'));
it('sans âge lisible, reste générique', () =>
  expect(buildLocalSafeTitle(TDF_2026, null))
    .toBe('🛡️ 🚴 Tour de France – vidéo récente'));
```

**Step 2: Run `npm test`** — Expected: FAIL.

**Step 3: Implémentation**

```js
export function buildLocalSafeTitle(pack, ageText) {
  const suffix = ageText ? `vidéo (${ageText.trim()})` : 'vidéo récente';
  return `🛡️ ${pack.emoji} ${pack.label} – ${suffix}`;
}
```

**Step 4: Run `npm test`** — Expected: PASS. **Step 5: Commit** `feat: titre voilé local`.

---

## Task 5: Extraction des cartes vidéo (fixtures DOM réelles)

**Files:**
- Create: `tests/fixtures/` (HTML copié depuis YouTube réel), `src/lib/extract.js`
- Test: `tests/extract.test.js`

**Step 1: Capturer les fixtures.** Ouvrir youtube.com dans Chrome (accueil + une recherche « tour de france résumé » + une page /watch), DevTools → clic droit sur un élément carte → Copy outerHTML. Sauver dans :
- `tests/fixtures/rich-item.html` (`ytd-rich-item-renderer`, accueil)
- `tests/fixtures/video-renderer.html` (`ytd-video-renderer`, recherche)
- `tests/fixtures/compact.html` (`ytd-compact-video-renderer` OU `yt-lockup-view-model`, sidebar /watch)

⚠️ Le markup YouTube 2026 peut différer de ce plan : **les sélecteurs de `extract.js` doivent être écrits d'après les fixtures capturées**, pas d'après le plan. Ceux ci-dessous sont le point de départ attendu.

**Step 2: Test qui échoue** (adapter les valeurs attendues au contenu réel des fixtures)

```js
import { it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { extractCard, CARD_SELECTOR } from '../src/lib/extract.js';

function load(name) {
  const html = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return new JSDOM(html).window.document.body.firstElementChild;
}

for (const f of ['rich-item.html', 'video-renderer.html', 'compact.html']) {
  it(`extrait videoId/titre/chaîne/âge depuis ${f}`, () => {
    const card = load(f);
    const info = extractCard(card);
    expect(info.videoId).toMatch(/^[\w-]{11}$/);
    expect(info.title.length).toBeGreaterThan(3);
    expect(info.channel.length).toBeGreaterThan(1);
    // ageText peut être null sur certains layouts, mais doit exister sur au moins un fixture
  });
}
it('expose un sélecteur combiné pour l\'observer', () =>
  expect(CARD_SELECTOR).toContain('ytd-rich-item-renderer'));
```

**Step 3: Run `npm test`** — Expected: FAIL.

**Step 4: Implémentation (point de départ — ajuster aux fixtures)**

```js
// src/lib/extract.js
export const CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'yt-lockup-view-model',
].join(',');

export function extractCard(card) {
  const link = card.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
  const href = link?.getAttribute('href') || '';
  const videoId = (href.match(/[?&]v=([\w-]{11})/) || href.match(/shorts\/([\w-]{11})/))?.[1] || null;

  const titleEl = card.querySelector('#video-title, yt-formatted-string#video-title, .yt-lockup-metadata-view-model__title');
  const channelEl = card.querySelector('ytd-channel-name #text, .yt-content-metadata-view-model__metadata-text');
  const ageEl = [...card.querySelectorAll('#metadata-line span, .yt-content-metadata-view-model__metadata-text')]
    .find((s) => /il y a|ago/i.test(s.textContent));

  return {
    videoId,
    title: titleEl?.textContent.trim() || '',
    channel: channelEl?.textContent.trim() || '',
    ageText: ageEl?.textContent.trim() || null,
    titleEl,
  };
}
```

**Step 5: Run `npm test`** — Expected: PASS. **Step 6: Commit** `feat: extraction cartes vidéo + fixtures YouTube réelles`.

---

## Task 6: Content script — observer, voile, révélation

**Files:**
- Modify: `src/content.js` (remplace le console.log)
- Create: `src/veil.css`

Logique pure déjà testée ; ce fichier n'est que du câblage → vérification manuelle en Task 7. Pas de flash possible : YouTube peuple ses cartes en JS après `document_start`, notre observer synchrone voit chaque carte au moment de son insertion, avant le paint du frame.

**Step 1: `src/veil.css`**

```css
.spoilguard-veiled #video-title,
.spoilguard-veiled .yt-lockup-metadata-view-model__title {
  color: transparent !important;
  position: relative;
}
.spoilguard-veiled img,
.spoilguard-veiled ytd-thumbnail,
.spoilguard-veiled yt-thumbnail-view-model {
  filter: blur(16px) !important;
}
/* Coupe le preview vidéo au survol (spoil aussi) */
.spoilguard-veiled ytd-thumbnail-overlay-inline-playback-renderer,
.spoilguard-veiled video { display: none !important; }
.spoilguard-safe-title { color: var(--yt-spec-text-primary, #f1f1f1) !important; }
```

**Step 2: `src/content.js`**

```js
import { TDF_2026 } from './lib/pack.js';
import { shouldVeil } from './lib/matcher.js';
import { buildLocalSafeTitle } from './lib/safeTitle.js';
import { extractCard, CARD_SELECTOR } from './lib/extract.js';

const pack = TDF_2026;
const processed = new WeakSet();

function veil(card, info) {
  card.classList.add('spoilguard-veiled');
  if (info.titleEl) {
    if (!info.titleEl.dataset.spoilguardOriginal)
      info.titleEl.dataset.spoilguardOriginal = info.title;
    info.titleEl.textContent = buildLocalSafeTitle(pack, info.ageText);
    info.titleEl.classList.add('spoilguard-safe-title');
    info.titleEl.title = 'SpoilGuard — double-clic pour révéler';
    info.titleEl.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      info.titleEl.textContent = info.titleEl.dataset.spoilguardOriginal;
      card.classList.remove('spoilguard-veiled');
    }, { once: true });
  }
}

function processCard(card) {
  if (processed.has(card)) return;
  const info = extractCard(card);
  if (!info.videoId || !info.title) return; // carte pas encore peuplée, on repassera
  processed.add(card);
  if (shouldVeil(info, pack)) veil(card, info);
}

function scan(root) {
  if (root.matches?.(CARD_SELECTOR)) processCard(root);
  root.querySelectorAll?.(CARD_SELECTOR).forEach(processCard);
}

new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
    // YouTube recycle les cartes : un changement de titre = nouvelle vidéo dans la même carte
    if (m.type === 'characterData' || m.type === 'attributes') {
      const card = m.target.nodeType === 1 ? m.target.closest?.(CARD_SELECTOR) : null;
      if (card) { processed.delete?.(card); processCard(card); }
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

if (document.body) scan(document.body);
console.log('[SpoilGuard] actif —', pack.label);
```

Note : `WeakSet` n'a pas de `delete` conditionnel exotique — `processed.delete(card)` existe et suffit ; le recyclage de cartes est LE bug classique de ce genre d'extension, d'où le handler characterData.

**Step 3: Build** — Run: `npm run build` — Expected: exit 0.

**Step 4: Commit** `feat: content script — observer, voile titre+miniature, dblclic pour révéler`.

---

## Task 7: Vérification manuelle sur YouTube réel + ajustements

**Step 1: Charger l'extension.** `chrome://extensions` → mode développeur → « Charger l'extension non empaquetée » → `~/Desktop/spoilguard`.

**Step 2: Checklist de vérification** (créer TodoWrite pour chaque item) :

- [ ] Accueil YouTube : une vidéo récente d'Eurosport/France TV Sport apparaît voilée (titre 🛡️, miniature floue) **sans flash du vrai titre** (recharger plusieurs fois pour vérifier).
- [ ] Recherche « tour de france 2026 résumé » : cartes résultats voilées.
- [ ] Page /watch d'une vidéo quelconque : les recommandations sidebar liées au Tour sont voilées.
- [ ] Titre longue traîne (chaîne non listée, mot du lexique) : voilé.
- [ ] Vidéo Eurosport > 72h : PAS voilée.
- [ ] Vidéo hors sujet (tech, musique) : intacte.
- [ ] Double-clic sur un titre voilé : révèle titre + miniature.
- [ ] Scroll infini : les nouvelles cartes arrivent voilées.
- [ ] Navigation SPA (clic vidéo → retour accueil) : le voile fonctionne toujours.
- [ ] Console : pas d'erreurs `[SpoilGuard]` ni d'erreurs YouTube nouvelles.

**Step 3: Ajuster.** Les noms exacts de chaînes (pack.js) et les sélecteurs (extract.js) seront probablement à corriger ici — refléter chaque correction dans les fixtures/tests, re-run `npm test`.

**Step 4: Commit final**

```bash
git add -A && git commit -m "fix: ajustements sélecteurs/pack après vérification sur YouTube réel"
```

---

## Hors scope Phase 1 (plans séparés, après validation en conditions réelles pendant le Tour)

- **Phase 2** : backend Hono sur VPS + Cerebras gpt-oss-120b + cache Postgres partagé (`POST /classify`, `GET /competitions`) — les titres voilés génériques deviennent des `safeTitle` propres, la longue traîne devient sémantique.
- **Phase 3** : companion web app Vite/React (`GET /feed/:competitionId`) pour mobile.
- **Phase 4** : catalogue multi-compétitions + page d'options + fenêtre de révélation 10 min.
- **Phase 5** : publication Chrome Web Store.
