// src/lib/matcher.js
export function isHighRiskChannel(channelName, pack) {
  const c = (channelName || '').toLowerCase().trim();
  return pack.channels.some((known) => c.includes(known));
}

// Unités d'âge multilingues (YouTube affiche l'âge dans la langue de l'UI).
// parseAgeHours isole d'abord le PREMIER « nombre + mot » de la chaîne d'âge (déjà
// pré-extraite en amont), puis teste ce MOT capturé — jamais la ligne entière — contre
// ces motifs. Le mot d'unité suit TOUJOURS le nombre dans les langues gérées :
//   « il y a 2 heures » / « 2 hours ago » (FR/EN), « hace 2 horas » (ES),
//   « vor 2 Stunden » (DE), « 2 ore fa » (IT), « há 2 dias » (PT), « 2 uur geleden » (NL).
// Les préfixes (vor / hace / há / « il y a ») et suffixes (ago / fa / geleden) tombent
// hors capture — seule reste l'unité juste après le nombre.
// Pièges regex (cf. \bago\b / Santiago ailleurs) : le mot est isolé (\p{L}+), mais on
// ancre malgré tout chaque radical par \b à GAUCHE (préfixe du mot ciblé, plurales
// couvertes) pour ne jamais mordre dans un mot plus long — « ore » ne doit pas matcher
// « before », « tag » ne doit pas matcher « vintage », « uur » est ancré des deux côtés.
// On n'emploie aucun radical court non ancré (« or » vit dans l'italien « giorno »,
// « an » dans « année »…). Multiplicateur = heures.
const AGE_UNITS = [
  // secondes → 0  (FR seconde, EN second(s), IT secondi, ES/PT segundos, NL seconden, DE Sekunden)
  [/\bsecond|\bseconde|\bsegund|\bsekund/i, 0],
  // minutes → 0  (FR/EN minute(s), ES minutos, IT minuti, PT minutos, NL minuten/minuut, DE Minuten)
  [/\bminu/i, 0], [/\bmin\b/i, 0],
  // heures → 1  (FR heure, EN hour, ES/PT hora(s), IT ora/ore, NL uur, DE Stunde(n))
  [/\bheure|\bhour|\bhora|\buur\b|\bstund|\bora\b|\bore\b|\bh\b/i, 1],
  // jours → 24  (FR jour, EN day, ES día(s), PT dia(s), IT giorno/giorni, NL dag(en), DE Tag(e/en))
  [/\bjour|\bday|\bd[ií]a|\bgiorn|\bdag|\btag|\bj\b/i, 24],
  // semaines → 168  (FR semaine, EN week, ES/PT semana(s), IT settimana/e, NL week/weken, DE Woche(n))
  [/\bsemaine|\bsemana|\bsettiman|\bweek|\bweken|\bwoch/i, 168],
  // mois → 720  (FR mois, EN month, ES mes(es), PT mês/meses, IT mese/mesi, NL maand(en), DE Monat(e/en))
  [/\bmois|\bmonth|\bm[eê]s|\bmaand|\bmonat/i, 720],
  // années → 8760  (FR an(s)/année, EN year, ES año(s), IT anno/anni, PT ano(s), NL jaar/jaren, DE Jahr(e/en))
  [/\ban[s]?\b|\bann|\bañ|\banos?\b|\byear|\bjaar|\bjaren|\bjahr/i, 8760],
];

// Attend une chaîne d'âge déjà isolée (« il y a 10 heures », « 2 hours ago »), pas une ligne de métadonnées composite type « 1,2 M de vues • il y a 10 heures ».
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
