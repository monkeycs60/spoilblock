import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';

const app = createApp({ classify: async () => [] });

describe('GET /competitions', () => {
  it('renvoie le catalogue avec tdf-2026', async () => {
    const res = await app.request('/competitions');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.competitions)).toBe(true);
    const tdf = body.competitions.find((c: { id: string }) => c.id === 'tdf-2026');
    expect(tdf).toMatchObject({
      id: 'tdf-2026',
      label: 'Tour de France',
      emoji: '🚴',
      active: true,
      maxAgeHours: 72,
    });
    expect(tdf.channels).toContain('tour de france');
    expect(tdf.lexicon).toContain('maillot jaune');
  });

  it('expose feedAvailable (au moins une chaîne mappée) pour chaque compétition', async () => {
    const res = await app.request('/competitions');
    const body = await res.json() as any;
    for (const c of body.competitions) {
      expect(typeof c.feedAvailable).toBe('boolean');
    }
    // tdf/wimbledon/f1 ont toutes des chaînes mappées → feed disponible.
    const byId = Object.fromEntries(body.competitions.map((c: any) => [c.id, c]));
    expect(byId['tdf-2026'].feedAvailable).toBe(true);
    expect(byId['wimbledon-2026'].feedAvailable).toBe(true);
    expect(byId['f1-2026'].feedAvailable).toBe(true);
  });

  it('expose les nouveaux packs worldcup-2026 (actif) et vuelta-2026 (inactif), feed disponible', async () => {
    const res = await app.request('/competitions');
    const body = await res.json() as any;
    // 5 compétitions au catalogue (tdf, wimbledon, f1, worldcup, vuelta).
    expect(body.competitions).toHaveLength(5);
    const byId = Object.fromEntries(body.competitions.map((c: any) => [c.id, c]));

    expect(byId['worldcup-2026']).toMatchObject({
      label: 'Coupe du monde',
      emoji: '⚽',
      active: true,
      maxAgeHours: 72,
      feedAvailable: true, // fifa / espn fc / beIN / eurosport france… mappées
    });
    expect(byId['worldcup-2026'].channels).toContain('fifa');
    expect(byId['worldcup-2026'].lexicon).toContain('coupe du monde');

    expect(byId['vuelta-2026']).toMatchObject({
      label: 'La Vuelta',
      emoji: '🚴',
      active: false, // hors saison (août-septembre 2026) — s'activera via les options
      maxAgeHours: 72,
      feedAvailable: true, // la vuelta + chaînes cyclisme mappées
    });
    expect(byId['vuelta-2026'].channels).toContain('la vuelta');
    expect(byId['vuelta-2026'].lexicon).toContain('maillot rojo');
  });
});

describe('GET /health', () => {
  it('répond ok avec uptime', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe('number');
  });
});
