import { describe, it, expect } from 'vitest';
import { dayStamp, formatBadge, recordBlocked, ID_CAP } from '../src/lib/badgeCount.js';

// badgeCount.js — logique pure du compteur de spoilers bloqués :
//   - dayStamp    : tampon de jour local 'YYYY-MM-DD' (cohérent avec ce que lit popup.js)
//   - formatBadge : texte du badge ('' si 0, '999+' au-delà de 999, sinon String(n))
//   - recordBlocked : réducteur pur (reset journalier + dédup par videoId + cap)

describe('dayStamp — tampon de jour local YYYY-MM-DD', () => {
  it('formate une date fixe en YYYY-MM-DD (composantes locales, zéro-paddées)', () => {
    // 5 juillet 2026 à midi local → pas d'ambiguïté de bord de journée.
    const d = new Date(2026, 6, 5, 12, 0, 0);
    expect(dayStamp(d)).toBe('2026-07-05');
  });

  it('zéro-padde mois et jour à un chiffre', () => {
    const d = new Date(2026, 0, 3, 9, 0, 0);
    expect(dayStamp(d)).toBe('2026-01-03');
  });

  it('sans argument → chaîne YYYY-MM-DD du jour', () => {
    expect(dayStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('correspond au format en-CA que tolère popup.js', () => {
    const d = new Date(2026, 10, 21, 15, 30, 0);
    expect(dayStamp(d)).toBe(d.toLocaleDateString('en-CA'));
  });
});

describe('formatBadge — texte du badge', () => {
  it('0 ou moins → chaîne vide (badge effacé)', () => {
    expect(formatBadge(0)).toBe('');
    expect(formatBadge(-3)).toBe('');
  });

  it('valeur non finie / non numérique → chaîne vide', () => {
    expect(formatBadge(NaN)).toBe('');
    expect(formatBadge(undefined)).toBe('');
    expect(formatBadge(null)).toBe('');
  });

  it('1..999 → le nombre tel quel', () => {
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(42)).toBe('42');
    expect(formatBadge(999)).toBe('999');
  });

  it('au-delà de 999 → "999+"', () => {
    expect(formatBadge(1000)).toBe('999+');
    expect(formatBadge(54321)).toBe('999+');
  });

  it('tronque une valeur décimale', () => {
    expect(formatBadge(12.9)).toBe('12');
  });
});

describe('recordBlocked — reset journalier + dédup par videoId', () => {
  const TODAY = '2026-07-05';

  it('premier blocage du jour sur un état vide → count 1, videoId enregistré, added', () => {
    const out = recordBlocked(undefined, 'aaaaaaaaaaa', TODAY);
    expect(out.count).toBe(1);
    expect(out.date).toBe(TODAY);
    expect(out.ids).toEqual(['aaaaaaaaaaa']);
    expect(out.added).toBe(true);
  });

  it('deux videoIds distincts le même jour → count 2', () => {
    const s1 = recordBlocked(undefined, 'aaaaaaaaaaa', TODAY);
    const s2 = recordBlocked(s1, 'bbbbbbbbbbb', TODAY);
    expect(s2.count).toBe(2);
    expect(s2.ids).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(s2.added).toBe(true);
  });

  it('même videoId re-bloqué le même jour → pas de changement (dédup), added false', () => {
    const s1 = recordBlocked(undefined, 'aaaaaaaaaaa', TODAY);
    const s2 = recordBlocked(s1, 'aaaaaaaaaaa', TODAY);
    expect(s2.count).toBe(1);
    expect(s2.ids).toEqual(['aaaaaaaaaaa']);
    expect(s2.added).toBe(false);
  });

  it('nouveau jour → reset complet (count 0 puis 1) et registre repart de zéro', () => {
    const prev = { date: '2026-07-04', count: 7, ids: ['x', 'y', 'aaaaaaaaaaa'] };
    const out = recordBlocked(prev, 'aaaaaaaaaaa', TODAY);
    expect(out.date).toBe(TODAY);
    expect(out.count).toBe(1); // reset à 0 puis +1 (l'id d'hier ne compte plus)
    expect(out.ids).toEqual(['aaaaaaaaaaa']);
    expect(out.added).toBe(true);
  });

  it('videoId invalide (vide/null) → pas de comptage, added false', () => {
    const s1 = recordBlocked(undefined, '', TODAY);
    expect(s1.count).toBe(0);
    expect(s1.added).toBe(false);
    const s2 = recordBlocked(undefined, null, TODAY);
    expect(s2.count).toBe(0);
    expect(s2.added).toBe(false);
  });

  it('videoId invalide un nouveau jour → applique quand même le reset de date', () => {
    const prev = { date: '2026-07-04', count: 9, ids: ['x'] };
    const out = recordBlocked(prev, '', TODAY);
    expect(out.date).toBe(TODAY);
    expect(out.count).toBe(0);
    expect(out.ids).toEqual([]);
    expect(out.added).toBe(false);
  });

  it('borne le registre à ID_CAP (éviction FIFO des plus anciens) sans casser le comptage', () => {
    let state = { date: TODAY, count: ID_CAP, ids: [] };
    for (let i = 0; i < ID_CAP; i++) state.ids.push('id' + i);
    const out = recordBlocked(state, 'freshvideo01', TODAY);
    expect(out.ids.length).toBe(ID_CAP);
    expect(out.ids[out.ids.length - 1]).toBe('freshvideo01'); // le neuf est présent
    expect(out.ids[0]).toBe('id1'); // le plus ancien (id0) a été évincé
    expect(out.count).toBe(ID_CAP + 1);
    expect(out.added).toBe(true);
  });

  it('ne mute pas l’état passé en entrée (retourne un nouvel objet)', () => {
    const prev = { date: TODAY, count: 1, ids: ['aaaaaaaaaaa'] };
    const out = recordBlocked(prev, 'bbbbbbbbbbb', TODAY);
    expect(prev.count).toBe(1);
    expect(prev.ids).toEqual(['aaaaaaaaaaa']);
    expect(out).not.toBe(prev);
  });

  it('tolère un état partiel/corrompu (champs manquants) → repart proprement', () => {
    const out = recordBlocked({ date: TODAY }, 'aaaaaaaaaaa', TODAY);
    expect(out.count).toBe(1);
    expect(out.ids).toEqual(['aaaaaaaaaaa']);
  });
});
