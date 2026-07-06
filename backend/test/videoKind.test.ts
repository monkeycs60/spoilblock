import { describe, it, expect } from 'vitest';
import { kind } from '../src/lib/videoKind';

describe('kind — détection recap multilingue', () => {
  it('classe les formats « résumé » (fr, avec/sans accent, version longue)', () => {
    expect(kind('🚴 Tour de France 2026 – Résumé étape 2')).toBe('recap');
    expect(kind('🚴 Tour de France 2026 – Résumé long étape 2')).toBe('recap');
    expect(kind('resume etape 2')).toBe('recap'); // sans accent
    expect(kind('Le film de l\'étape 3')).toBe('recap');
  });

  it('classe « temps forts » (fr) et « highlights » (en) — faux négatifs évités', () => {
    expect(kind('🚴 Tour de France 2026 – Temps forts étape 5')).toBe('recap');
    expect(kind('Stage 5 Highlights')).toBe('recap');
    expect(kind('STAGE 5 HIGHLIGHTS')).toBe('recap'); // casse
    expect(kind('Stage 5 Summary')).toBe('recap');
    expect(kind('Stage 5 Recap')).toBe('recap');
  });

  it('classe les autres langues (es/it/de)', () => {
    expect(kind('Resumen etapa 5')).toBe('recap');
    expect(kind('Riassunto tappa 5')).toBe('recap');
    expect(kind('Zusammenfassung Etappe 5')).toBe('recap');
  });

  it('classe « other » les analyses, interviews et présentations d\'étape', () => {
    expect(kind('🚴 Tour de France 2026 – Analyse étape 2')).toBe('other');
    expect(kind('🚴 Tour de France 2026 – Interview / Réactions')).toBe('other');
    expect(kind('Débrief étape 2 : on refait la course')).toBe('other');
    expect(kind('Présentation du parcours étape 6')).toBe('other');
    expect(kind('Stage 6 preview: the route')).toBe('other');
  });

  it('« other » pour un titre vide/absent', () => {
    expect(kind('')).toBe('other');
    expect(kind(undefined as unknown as string)).toBe('other');
  });
});
