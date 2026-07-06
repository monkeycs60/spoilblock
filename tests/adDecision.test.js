import { describe, it, expect } from 'vitest';
import { shouldVeilAd } from '../src/lib/adDecision.js';
import { mergePacks, TDF_2026, WIMBLEDON_2026 } from '../src/lib/pack.js';

describe('shouldVeilAd — pré-filtre lexical des pubs', () => {
  const tdf = mergePacks(['tdf-2026']);

  it('textContent contenant un mot du lexique → voile (true)', () =>
    expect(shouldVeilAd('Suivez le maillot jaune en direct sur notre chaîne', tdf)).toBe(true));

  it('match insensible à la casse (comme matchesLexicon)', () =>
    expect(shouldVeilAd('POGACAR revient sur son étape', tdf)).toBe(true));

  it('texte publicitaire neutre (aucun mot du lexique) → ne voile pas (false)', () =>
    expect(shouldVeilAd('Abonnez-vous à notre offre streaming ce mois-ci', tdf)).toBe(false));

  it('mot d’une AUTRE compétition non active → ne voile pas', () =>
    expect(shouldVeilAd('Ne manquez rien de Wimbledon et Alcaraz', tdf)).toBe(false));

  it('pack multi-compétitions : match sur l’un des lexiques actifs', () => {
    const merged = mergePacks(['tdf-2026', 'wimbledon-2026']);
    expect(shouldVeilAd('Regardez Alcaraz sur le gazon', merged)).toBe(true);
    expect(shouldVeilAd('Le peloton attaque dans la montée', merged)).toBe(true);
  });

  it('texte vide / null → false (jamais de sur-masquage)', () => {
    expect(shouldVeilAd('', tdf)).toBe(false);
    expect(shouldVeilAd(null, tdf)).toBe(false);
    expect(shouldVeilAd(undefined, tdf)).toBe(false);
  });

  it('pack vide (aucune compétition active) → false même si le texte mentionne du sport', () => {
    const empty = mergePacks([]);
    expect(shouldVeilAd('maillot jaune étape pogacar', empty)).toBe(false);
  });

  it('pack absent / malformé → false (défensif)', () => {
    expect(shouldVeilAd('maillot jaune', null)).toBe(false);
    expect(shouldVeilAd('maillot jaune', {})).toBe(false);
    expect(shouldVeilAd('maillot jaune', { lexicon: null })).toBe(false);
  });

  it('accepte un pack membre brut (lexicon direct)', () =>
    expect(shouldVeilAd('yellow jersey highlights', TDF_2026)).toBe(true));

  it('WIMBLEDON_2026 brut : match sur son propre lexique', () =>
    expect(shouldVeilAd('Djokovic en demi-finale', WIMBLEDON_2026)).toBe(true));
});
