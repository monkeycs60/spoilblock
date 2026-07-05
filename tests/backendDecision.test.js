import { describe, it, expect } from 'vitest';
import { backendDecision } from '../src/lib/backendDecision.js';

const veiledCard = { veiled: true, revealed: false, videoId: 'abc' };

describe('backendDecision — réponses backend sur une carte voilée', () => {
  it("spoiler:false → 'unveil' (faux positif du pré-filtre)", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc', spoiler: false } }),
    ).toBe('unveil'));

  it("spoiler:true + safeTitle → 'retitle'", () =>
    expect(
      backendDecision({
        ...veiledCard,
        result: { videoId: 'abc', spoiler: true, safeTitle: '🚴 Résumé étape 2' },
      }),
    ).toBe('retitle'));

  it("spoiler:true sans safeTitle → 'noop' (voile générique conservé)", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc', spoiler: true } }),
    ).toBe('noop'));

  it("spoiler:true + safeTitle vide/espaces → 'noop'", () =>
    expect(
      backendDecision({
        ...veiledCard,
        result: { videoId: 'abc', spoiler: true, safeTitle: '   ' },
      }),
    ).toBe('noop'));

  it("unavailable:true → 'noop' (dégradation gracieuse)", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc', unavailable: true } }),
    ).toBe('noop'));
});

describe('backendDecision — réponse absente ou malformée', () => {
  it("result null → 'noop'", () =>
    expect(backendDecision({ ...veiledCard, result: null })).toBe('noop'));

  it("result undefined → 'noop'", () =>
    expect(backendDecision({ ...veiledCard, result: undefined })).toBe('noop'));

  it("result sans champ spoiler → 'noop'", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc' } }),
    ).toBe('noop'));
});

describe('backendDecision — état de carte modifié depuis l\'envoi', () => {
  it("carte révélée par l'utilisateur → 'noop' même si spoiler:false", () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: true,
        videoId: 'abc',
        result: { videoId: 'abc', spoiler: false },
      }),
    ).toBe('noop'));

  it("carte révélée → 'noop' même si spoiler:true + safeTitle", () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: true,
        videoId: 'abc',
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X' },
      }),
    ).toBe('noop'));

  it("carte plus voilée (dé-voilée entre-temps) → 'noop'", () =>
    expect(
      backendDecision({
        veiled: false,
        revealed: false,
        videoId: 'abc',
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X' },
      }),
    ).toBe('noop'));

  it("réponse pour une AUTRE vidéo (carte recyclée) → 'noop'", () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: false,
        videoId: 'nouveau',
        result: { videoId: 'abc', spoiler: false },
      }),
    ).toBe('noop'));

  it('videoId manquant côté carte → applique quand même (pas de discriminant)', () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: false,
        videoId: null,
        result: { videoId: 'abc', spoiler: false },
      }),
    ).toBe('unveil'));

  it('videoId manquant côté résultat → applique quand même', () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: false,
        videoId: 'abc',
        result: { spoiler: false },
      }),
    ).toBe('unveil'));
});

describe("backendDecision — règle 'unveil-old' (vieille vidéo via publishedAt)", () => {
  const HOUR = 3_600_000;
  const NOW = Date.parse('2026-07-06T12:00:00.000Z');
  const MAX = 72; // seuil de la compétition
  const isoAgo = (hours) => new Date(NOW - hours * HOUR).toISOString();
  const base = { veiled: true, revealed: false, videoId: 'abc', maxAgeHours: MAX, now: NOW };

  it('spoiler:true + publiée bien avant le seuil → unveil-old', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X', publishedAt: isoAgo(100) },
      }),
    ).toBe('unveil-old'));

  it("unveil-old prime même SANS safeTitle (règle des 72h > retitrage)", () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: true, publishedAt: isoAgo(200) },
      }),
    ).toBe('unveil-old'));

  it('frontière EXACTE 72h (âge == maxAgeHours) → PAS unveil-old → retitle', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X', publishedAt: isoAgo(72) },
      }),
    ).toBe('retitle'));

  it('juste au-delà de 72h (72h + 1s) → unveil-old', () =>
    expect(
      backendDecision({
        ...base,
        result: {
          videoId: 'abc',
          spoiler: true,
          safeTitle: 'X',
          publishedAt: new Date(NOW - MAX * HOUR - 1000).toISOString(),
        },
      }),
    ).toBe('unveil-old'));

  it('juste en deçà de 72h (71h59) → retitle (toujours un risque de spoil)', () =>
    expect(
      backendDecision({
        ...base,
        result: {
          videoId: 'abc',
          spoiler: true,
          safeTitle: 'X',
          publishedAt: new Date(NOW - MAX * HOUR + 60_000).toISOString(),
        },
      }),
    ).toBe('retitle'));

  it('publishedAt null → comportement inchangé (retitle si safeTitle)', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X', publishedAt: null },
      }),
    ).toBe('retitle'));

  it('publishedAt null + pas de safeTitle → noop (inchangé)', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: true, publishedAt: null },
      }),
    ).toBe('noop'));

  it('publishedAt absent → comportement inchangé (retitle)', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X' },
      }),
    ).toBe('retitle'));

  it('publishedAt non parsable → comportement inchangé (retitle)', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X', publishedAt: 'pas-une-date' },
      }),
    ).toBe('retitle'));

  it('spoiler:false prioritaire → unveil (normal) même si publiée avant le seuil', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', spoiler: false, publishedAt: isoAgo(500) },
      }),
    ).toBe('unveil'));

  it('now/maxAgeHours non fournis → défensif : pas de unveil-old (retitle)', () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: false,
        videoId: 'abc',
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X', publishedAt: isoAgo(500) },
      }),
    ).toBe('retitle'));

  it("carte révélée entre-temps → noop, même vieille vidéo (geste utilisateur prime)", () =>
    expect(
      backendDecision({
        ...base,
        revealed: true,
        result: { videoId: 'abc', spoiler: true, publishedAt: isoAgo(500) },
      }),
    ).toBe('noop'));

  it('carte plus voilée → noop, même vieille vidéo', () =>
    expect(
      backendDecision({
        ...base,
        veiled: false,
        result: { videoId: 'abc', spoiler: true, publishedAt: isoAgo(500) },
      }),
    ).toBe('noop'));

  it("réponse pour une autre vidéo → noop, même vieille vidéo", () =>
    expect(
      backendDecision({
        ...base,
        videoId: 'nouveau',
        result: { videoId: 'abc', spoiler: true, publishedAt: isoAgo(500) },
      }),
    ).toBe('noop'));

  it('unavailable prime sur unveil-old → noop', () =>
    expect(
      backendDecision({
        ...base,
        result: { videoId: 'abc', unavailable: true, spoiler: true, publishedAt: isoAgo(500) },
      }),
    ).toBe('noop'));
});
