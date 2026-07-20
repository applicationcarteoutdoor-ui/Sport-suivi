// lib/bus.js — emetteur d'evenements minimal.
// C'est le SEUL canal d'invalidation entre couches : la direction des dependances
// (lib <- data <- domain <- ui <- views) interdit tout appel remontant. Une couche basse
// signale, une couche haute ecoute. Aucun cycle ESM possible par construction.

/** @type {Map<string, Set<Function>>} */
const abonnes = new Map();

/**
 * Abonne un ecouteur a un type d'evenement.
 * @param {string} type
 * @param {(payload: any) => void} fn
 * @returns {() => void} desabonnement, idempotent (appelable plusieurs fois sans effet de bord)
 */
export function on(type, fn) {
  let jeu = abonnes.get(type);
  if (!jeu) { jeu = new Set(); abonnes.set(type, jeu); }
  jeu.add(fn);
  return () => {
    const courant = abonnes.get(type);
    if (!courant) return;
    courant.delete(fn);
    // Une vue demontee laisse sinon une entree vide par type d'evenement traverse.
    if (courant.size === 0) abonnes.delete(type);
  };
}

/**
 * Notifie tous les abonnes d'un type.
 * @param {string} type
 * @param {any} [payload]
 */
export function emit(type, payload) {
  const jeu = abonnes.get(type);
  if (!jeu || jeu.size === 0) return;
  // ⚠ Copie du jeu AVANT iteration : un abonne a parfaitement le droit de se desabonner
  //    (ou d'en abonner un autre) pendant sa propre notification — muter le Set en cours
  //    d'iteration donnerait un ordre de notification imprevisible.
  for (const fn of Array.from(jeu)) {
    try {
      fn(payload);
    } catch (err) {
      // ⚠ Un abonne qui leve ne doit JAMAIS empecher les suivants d'etre notifies : sur
      //    'serie:validee', une exception dans le toast priverait la vue de son invalidation
      //    et l'ecran mentirait sur des donnees pourtant deja persistees.
      console.error('[bus] abonne en echec sur « ' + type + ' »', err);
    }
  }
}
