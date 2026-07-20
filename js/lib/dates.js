// lib/dates.js — dates de regroupement, TOUTES LOCALES.
// Invariant du projet : une dayKey 'YYYY-MM-DD' se compare en chaîne.
// L'ordre lexicographique EST l'ordre chronologique — d'où le zéro de tête obligatoire.

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

const deuxChiffres = (n) => String(n).padStart(2, '0');

/**
 * Clé de jour LOCALE.
 * ⚠ JAMAIS toISOString() : celui-ci convertit en UTC. Une séance terminée à 23 h en France
 * (UTC+2) serait rangée au lendemain, et le tonnage de la semaine tomberait dans la mauvaise
 * semaine. On lit donc getFullYear/getMonth/getDate, qui sont locaux par définition.
 *
 * @param {Date|number|string} [d] date, epoch ms, ou dayKey déjà formée
 * @returns {string} 'YYYY-MM-DD'
 */
export function dayKey(d = new Date()) {
  if (typeof d === 'string') {
    // Déjà une dayKey : on la renvoie telle quelle plutôt que de la faire transiter par
    // new Date('2026-07-19'), que la spec interprète en UTC (décalage d'un jour à l'ouest).
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

/** Décompose une dayKey en nombres. Renvoie null si la chaîne est invalide. */
function decomposer(cle) {
  if (typeof cle !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cle);
  if (!m) return null;
  return { annee: +m[1], mois: +m[2], jour: +m[3] };
}

/**
 * '2026-03-12' -> '12/03'
 * Format court des étiquettes de courbe : quatre au maximum sur 360 px, jamais inclinées.
 */
export function formatCourt(cle) {
  const p = decomposer(cle);
  if (!p) return '';
  return `${deuxChiffres(p.jour)}/${deuxChiffres(p.mois)}`;
}

/** '2026-07-12' -> '12 juillet 2026' */
export function formatLong(cle) {
  const p = decomposer(cle);
  if (!p) return '';
  return `${p.jour} ${MOIS[p.mois - 1]} ${p.annee}`;
}

/** '2026-07-12' -> 'juillet 2026' — titre de groupe dans l'historique. */
export function moisDe(cle) {
  const p = decomposer(cle);
  if (!p) return '';
  return `${MOIS[p.mois - 1]} ${p.annee}`;
}

/** '2026-07-12' -> '2026-07' — clé de regroupement mensuel, comparable en chaîne. */
export function cleMois(cle) {
  const p = decomposer(cle);
  if (!p) return '';
  return `${p.annee}-${deuxChiffres(p.mois)}`;
}

/**
 * Recule de `n` mois en conservant le jour quand c'est possible.
 * Le jour est plafonné au dernier jour du mois cible : sans ce plafond, le 31 mai moins
 * 3 mois donnerait le 3 mars (débordement du 31 février), soit une borne postérieure à celle
 * attendue — la plage « 3 mois » perdrait deux jours de séances.
 */
function reculerDeMois(date, n) {
  const annee = date.getFullYear();
  const mois = date.getMonth() - n;
  const dernierJour = new Date(annee, mois + 1, 0).getDate();
  return new Date(annee, mois, Math.min(date.getDate(), dernierJour));
}

/**
 * Plage temporelle des courbes de progression.
 * @param {'3m'|'1a'|'tout'} nom
 * @returns {{ nom: string, debut: string, libelle: string }}
 *
 * `debut` est TOUJOURS une chaîne, comparée telle quelle : `if (s.date < plage.debut) continue`.
 * Pour 'tout', la chaîne vide est la borne inférieure absolue de l'ordre lexicographique — le
 * test est donc toujours faux, sans cas particulier chez l'appelant.
 */
export function plage(nom, aujourdHui = new Date()) {
  switch (nom) {
    case '3m':
      return { nom: '3m', debut: dayKey(reculerDeMois(aujourdHui, 3)), libelle: '3 mois' };
    case '1a':
      return { nom: '1a', debut: dayKey(reculerDeMois(aujourdHui, 12)), libelle: '1 an' };
    case 'tout':
    default:
      return { nom: 'tout', debut: '', libelle: 'Tout' };
  }
}

/** Nombre de jours entre deux dayKey (b − a). Renvoie null si l'une est invalide. */
export function joursEntre(a, b) {
  const pa = decomposer(a);
  const pb = decomposer(b);
  if (!pa || !pb) return null;
  // Minuit local des deux côtés : la différence en ms est un multiple exact de 24 h, sauf
  // changement d'heure — d'où l'arrondi plutôt qu'une division sèche.
  const da = new Date(pa.annee, pa.mois - 1, pa.jour);
  const db = new Date(pb.annee, pb.mois - 1, pb.jour);
  return Math.round((db - da) / 86400000);
}
