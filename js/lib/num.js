// lib/num.js — nombres au format français.
// Aucune connaissance du domaine : ni kilos, ni répétitions, seulement des nombres.

/**
 * Analyse une saisie utilisateur en nombre.
 * Accepte la virgule ET le point : sur un clavier système, un téléphone français propose la
 * virgule et un pavé numérique le point — refuser l'un des deux rendrait la saisie impossible
 * sur la moitié des appareils.
 * Les espaces, y compris l'espace insécable recopié d'un collage, sont ignorés.
 *
 * @returns {number|null} null si la chaîne n'est pas un nombre entier ou décimal complet
 */
export function parseFr(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (typeof s !== 'string') return null;

  const nettoye = s.replace(/[\s  ]/g, '').replace(',', '.');
  if (nettoye === '' || nettoye === '.' || nettoye === '-' || nettoye === '+') return null;

  // Contrôle explicite plutôt que Number() seul : Number('0x1f'), Number('1e5') et
  // Number('Infinity') renvoient un nombre, ce qui laisserait passer des saisies absurdes.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(nettoye)) return null;

  const n = Number(nettoye);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formate un nombre à la française : virgule décimale, AUCUN séparateur de milliers.
 * Le séparateur de milliers est écarté volontairement : sur une ligne de série, « 1 250 kg »
 * se coupe en fin de ligne et se relit « 1 » puis « 250 ».
 *
 * @param {number} n
 * @param {number} [dec] nombre de décimales. Omis : jusqu'à 2, zéros de queue supprimés.
 */
export function formatFr(n, dec) {
  if (n == null || !Number.isFinite(n)) return '';

  let texte;
  if (dec == null) {
    texte = String(Math.round(n * 100) / 100);
    // String() peut produire une notation exponentielle sur les très petits nombres :
    // on repasse alors par un format fixe, illisible autrement.
    if (texte.includes('e') || texte.includes('E')) texte = n.toFixed(2);
  } else {
    texte = n.toFixed(dec);
  }
  return texte.replace('.', ',');
}

/** Nombre de décimales significatives d'un pas (1,25 -> 2). */
function nbDecimales(pas) {
  const texte = String(Math.abs(pas));
  const point = texte.indexOf('.');
  return point === -1 ? 0 : texte.length - point - 1;
}

/**
 * Arrondit une valeur au multiple de `pas` le plus proche.
 * ⚠ Les pas décimaux (1,25 kg pour les mini-disques) rendent `Math.round(v/pas)*pas`
 * faux : 49 × 1.25 vaut 61.24999999999999 en binaire, et la valeur affichée « 61,25 »
 * deviendrait « 61,249999 » puis dériverait à chaque appui sur +.
 * On travaille donc en entiers, à l'échelle des décimales du pas.
 */
export function arrondiAuPas(v, pas) {
  if (v == null || !Number.isFinite(v)) return null;
  if (!Number.isFinite(pas) || pas <= 0) return v;

  const facteur = 10 ** nbDecimales(pas);
  const pasEntier = Math.round(pas * facteur);
  const valEntier = Math.round(v * facteur);
  if (pasEntier === 0) return v;

  return (Math.round(valEntier / pasEntier) * pasEntier) / facteur;
}

/**
 * Durée en 'M:SS' sous une heure, 'H:MM:SS' au-delà.
 * Le minuteur de repos et une sortie cardio d'1 h 02 partagent ce formateur : les minutes ne
 * sont complétées à deux chiffres que lorsqu'une heure les précède.
 */
export function formatDuree(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';

  const total = Math.max(0, Math.round(sec));
  const heures = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secondes = total % 60;

  const ss = String(secondes).padStart(2, '0');
  if (heures > 0) return `${heures}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/**
 * Allure en 'M:SS' (par kilomètre). Toujours DÉRIVÉE, jamais saisie ni stockée.
 * Les minutes ne sont pas plafonnées à 60 : une allure de marche lente reste lisible en
 * « 14:30 », alors qu'un passage en heures serait incompréhensible sur ce format.
 */
export function formatAllure(secParKm) {
  if (secParKm == null || !Number.isFinite(secParKm) || secParKm <= 0) return '';

  const total = Math.round(secParKm);
  const minutes = Math.floor(total / 60);
  const secondes = total % 60;
  return `${minutes}:${String(secondes).padStart(2, '0')}`;
}
