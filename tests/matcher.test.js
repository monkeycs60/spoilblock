import { describe, it, expect } from 'vitest';
import { isHighRiskChannel, parseAgeHours, matchesLexicon, shouldVeil } from '../src/lib/matcher.js';
import { TDF_2026, WIMBLEDON_2026, F1_2026 } from '../src/lib/pack.js';

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
  it('parse les mois FR', () => expect(parseAgeHours('il y a 1 mois')).toBe(720));
  it('parse les ans FR', () => expect(parseAgeHours('il y a 1 an')).toBe(8760));
  it('parse l\'abréviation "h"', () => expect(parseAgeHours('il y a 1 h')).toBe(1));
  it('parse le préfixe "Streamed"', () => expect(parseAgeHours('Streamed 2 hours ago')).toBe(2));
  it('inconnu → null (prudence: on voile)', () => expect(parseAgeHours('Diffusé il y a peu')).toBe(null));
});

describe('parseAgeHours — espagnol (hace X …)', () => {
  it('minutos → <1h', () => expect(parseAgeHours('hace 5 minutos')).toBe(0));
  it('hora → 1', () => expect(parseAgeHours('hace 1 hora')).toBe(1));
  it('horas → n', () => expect(parseAgeHours('hace 6 horas')).toBe(6));
  it('día → 24', () => expect(parseAgeHours('hace 1 día')).toBe(24));
  it('días → n*24', () => expect(parseAgeHours('hace 3 días')).toBe(72));
  it('semana → 168', () => expect(parseAgeHours('hace 1 semana')).toBe(168));
  it('semanas → n*168', () => expect(parseAgeHours('hace 2 semanas')).toBe(336));
  it('mes → 720', () => expect(parseAgeHours('hace 1 mes')).toBe(720));
  it('meses → n*720', () => expect(parseAgeHours('hace 4 meses')).toBe(2880));
  it('año → 8760', () => expect(parseAgeHours('hace 1 año')).toBe(8760));
  it('años → n*8760', () => expect(parseAgeHours('hace 2 años')).toBe(17520));
});

describe('parseAgeHours — allemand (vor X …, préfixe avant le nombre)', () => {
  it('Minuten → <1h', () => expect(parseAgeHours('vor 5 Minuten')).toBe(0));
  it('Stunde → 1', () => expect(parseAgeHours('vor 1 Stunde')).toBe(1));
  it('Stunden → n', () => expect(parseAgeHours('vor 8 Stunden')).toBe(8));
  it('Tag → 24', () => expect(parseAgeHours('vor 1 Tag')).toBe(24));
  it('Tagen → n*24', () => expect(parseAgeHours('vor 2 Tagen')).toBe(48));
  it('Woche → 168', () => expect(parseAgeHours('vor 1 Woche')).toBe(168));
  it('Wochen → n*168', () => expect(parseAgeHours('vor 3 Wochen')).toBe(504));
  it('Monat → 720', () => expect(parseAgeHours('vor 1 Monat')).toBe(720));
  it('Monaten → n*720', () => expect(parseAgeHours('vor 5 Monaten')).toBe(3600));
  it('Jahr → 8760', () => expect(parseAgeHours('vor 1 Jahr')).toBe(8760));
  it('Jahren → n*8760', () => expect(parseAgeHours('vor 2 Jahren')).toBe(17520));
});

describe('parseAgeHours — italien (X … fa, « fa » APRÈS le mot d\'unité)', () => {
  it('minuti → <1h', () => expect(parseAgeHours('5 minuti fa')).toBe(0));
  it('ora → 1', () => expect(parseAgeHours('1 ora fa')).toBe(1));
  it('ore → n', () => expect(parseAgeHours('7 ore fa')).toBe(7));
  it('giorno → 24', () => expect(parseAgeHours('1 giorno fa')).toBe(24));
  it('giorni → n*24', () => expect(parseAgeHours('2 giorni fa')).toBe(48));
  it('settimana → 168', () => expect(parseAgeHours('1 settimana fa')).toBe(168));
  it('settimane → n*168', () => expect(parseAgeHours('3 settimane fa')).toBe(504));
  it('mese → 720', () => expect(parseAgeHours('1 mese fa')).toBe(720));
  it('mesi → n*720', () => expect(parseAgeHours('6 mesi fa')).toBe(4320));
  it('anno → 8760', () => expect(parseAgeHours('1 anno fa')).toBe(8760));
  it('anni → n*8760', () => expect(parseAgeHours('2 anni fa')).toBe(17520));
  // Piège : « ore » (heures) ne doit PAS matcher dans « giorno » (jour) via un « or » nu.
  it('giorno reste un jour, pas une heure', () => expect(parseAgeHours('3 giorni fa')).toBe(72));
});

describe('parseAgeHours — portugais (há X …)', () => {
  it('minutos → <1h', () => expect(parseAgeHours('há 5 minutos')).toBe(0));
  it('hora → 1', () => expect(parseAgeHours('há 1 hora')).toBe(1));
  it('horas → n', () => expect(parseAgeHours('há 9 horas')).toBe(9));
  it('dia → 24', () => expect(parseAgeHours('há 1 dia')).toBe(24));
  it('dias → n*24', () => expect(parseAgeHours('há 2 dias')).toBe(48));
  it('semana → 168', () => expect(parseAgeHours('há 1 semana')).toBe(168));
  it('semanas → n*168', () => expect(parseAgeHours('há 2 semanas')).toBe(336));
  it('mês → 720', () => expect(parseAgeHours('há 1 mês')).toBe(720));
  it('meses → n*720', () => expect(parseAgeHours('há 3 meses')).toBe(2160));
  it('ano → 8760', () => expect(parseAgeHours('há 1 ano')).toBe(8760));
  it('anos → n*8760', () => expect(parseAgeHours('há 2 anos')).toBe(17520));
});

describe('parseAgeHours — néerlandais (X … geleden)', () => {
  it('minuten → <1h', () => expect(parseAgeHours('5 minuten geleden')).toBe(0));
  it('minuut → <1h', () => expect(parseAgeHours('1 minuut geleden')).toBe(0));
  it('uur → 1 (mot ancré, invariant singulier/pluriel)', () => expect(parseAgeHours('1 uur geleden')).toBe(1));
  it('uur pluriel → n', () => expect(parseAgeHours('10 uur geleden')).toBe(10));
  it('dag → 24', () => expect(parseAgeHours('1 dag geleden')).toBe(24));
  it('dagen → n*24', () => expect(parseAgeHours('2 dagen geleden')).toBe(48));
  it('week → 168', () => expect(parseAgeHours('1 week geleden')).toBe(168));
  it('weken → n*168', () => expect(parseAgeHours('3 weken geleden')).toBe(504));
  it('maand → 720', () => expect(parseAgeHours('1 maand geleden')).toBe(720));
  it('maanden → n*720', () => expect(parseAgeHours('5 maanden geleden')).toBe(3600));
  it('jaar → 8760', () => expect(parseAgeHours('1 jaar geleden')).toBe(8760));
  it('jaren → n*8760', () => expect(parseAgeHours('2 jaren geleden')).toBe(17520));
});

describe('parseAgeHours — pièges regex inter-langues', () => {
  // « uur » ancré des deux côtés : ne doit pas matcher un mot plus long.
  it('« duurzame » (mot plus long) → pas une heure → null', () =>
    expect(parseAgeHours('2 duurzame dingen')).toBe(null));
  // « ore » ancré : ne mord pas dans « before ».
  it('« before » ne matche pas « ore »', () => expect(parseAgeHours('2 before something')).toBe(null));
  // « tag » ancré à gauche : ne matche pas « vintage ».
  it('« vintage » ne matche pas « tag »', () => expect(parseAgeHours('2 vintage cars')).toBe(null));
  // « an » n'est capturé que comme mot entier, pas dans « année » (→ radical ann = years).
  it('« année » FR → 8760 (radical ann)', () => expect(parseAgeHours('il y a 1 année')).toBe(8760));
});

describe('matchesLexicon', () => {
  it('matche un mot du lexique dans le titre', () =>
    expect(matchesLexicon('Résumé étape 14 - quelle journée !', TDF_2026)).toBe(true));
  it('ne matche pas un titre hors sujet', () =>
    expect(matchesLexicon('La chute de Fitness Park expliquée', TDF_2026)).toBe(false));

  // Couverture multilingue (packs internationaux) : es/it/de/nl/en.
  it('TDF : matche l\'espagnol (« Etapa 2 resumen »)', () =>
    expect(matchesLexicon('Etapa 2 resumen', TDF_2026)).toBe(true));
  it('TDF : matche l\'anglais (« Stage 2 highlights »)', () =>
    expect(matchesLexicon('Stage 2 highlights', TDF_2026)).toBe(true));
  it('TDF : matche l\'italien/allemand (« Tappa 2 — gelbes Trikot »)', () =>
    expect(matchesLexicon('Tappa 2 — gelbes Trikot', TDF_2026)).toBe(true));
  it('Wimbledon : matche l\'anglais (« Semifinal on Centre Court »)', () =>
    expect(matchesLexicon('Semifinal on Centre Court', WIMBLEDON_2026)).toBe(true));
  it('F1 : matche l\'anglais (« Qualifying report »)', () =>
    expect(matchesLexicon('Qualifying report', F1_2026)).toBe(true));
  it('F1 : matche l\'italien/allemand (« Gran Premio — fastest lap »)', () =>
    expect(matchesLexicon('Gran Premio — fastest lap', F1_2026)).toBe(true));
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
