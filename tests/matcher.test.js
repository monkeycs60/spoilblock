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
