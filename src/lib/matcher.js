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
