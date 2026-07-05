// Logique pure du compteur de spoilers bloqués du jour (badge de l'action).
// Aucune API chrome ici : le câblage (storage.local + chrome.action) vit dans
// background.js. Le compteur est écrit sous les clés que LIT popup.js
// (dailyBlockedCount / dailyBlockedDate) ; la date utilise le format 'YYYY-MM-DD'
// local, l'un des formats que tolère popup.todayMatches (en-CA).

export const BADGE_MAX = 999;
// Registre journalier des videoIds déjà comptés, borné pour rester léger en storage.
export const ID_CAP = 2000;

// Tampon de jour LOCAL 'YYYY-MM-DD' (composantes locales, pas UTC : on veut la
// bascule de journée du fuseau de l'utilisateur). Déterministe et testable.
export function dayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Texte du badge : '' pour effacer (0 ou invalide), '999+' au-delà du plafond,
// sinon le nombre entier.
export function formatBadge(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  const n = Math.floor(count);
  return n > BADGE_MAX ? `${BADGE_MAX}+` : String(n);
}

// Réducteur pur d'un blocage. `state` = snapshot persisté
// { date, count, ids } (ids = videoIds déjà comptés aujourd'hui). Retourne TOUJOURS
// un nouvel objet { date, count, ids, added } :
//   - reset journalier si `today` diffère de la date stockée (count→0, ids→[]) ;
//   - dédup par videoId : un id déjà compté aujourd'hui n'incrémente pas (added=false) ;
//   - videoId absent/vide → aucun comptage (mais le reset de date s'applique) ;
//   - cap léger : le registre est borné à ID_CAP (éviction FIFO des plus anciens).
export function recordBlocked(state, videoId, today) {
  const day = today || dayStamp();
  const src = state || {};
  let date = src.date;
  let count = Number.isFinite(src.count) ? src.count : 0;
  let ids = Array.isArray(src.ids) ? src.ids : [];

  // Nouveau jour → tout repart de zéro (le compteur ne porte que sur aujourd'hui).
  if (date !== day) {
    date = day;
    count = 0;
    ids = [];
  }

  // videoId invalide ou déjà compté aujourd'hui → aucun changement de comptage.
  if (!videoId || ids.includes(videoId)) {
    return { date, count, ids: ids.slice(), added: false };
  }

  let nextIds = ids.concat(videoId);
  if (nextIds.length > ID_CAP) nextIds = nextIds.slice(nextIds.length - ID_CAP);
  return { date, count: count + 1, ids: nextIds, added: true };
}
