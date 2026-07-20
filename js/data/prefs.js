// data/prefs.js — preferences utilisateur, miroir localStorage sous la cle 'muscu:prefs'.
//
// Lecture SYNCHRONE et sans echec : boot.js applique le theme AVANT toute ouverture d'IndexedDB
// (etape 2 de la chaine d'amorcage). Une lecture asynchrone provoquerait un flash de theme clair
// sur un telephone en mode sombre, et un stockage indisponible ne doit jamais empecher
// l'application de demarrer — d'ou le repli systematique sur les valeurs par defaut.

import { CLES, PREFS_DEFAUT } from '../config.js';
import { emit } from '../lib/bus.js';

// ⚠ `dernierExportAt` est ajoute ici et non dans config.PREFS_DEFAUT : il n'est pas une
//   preference reglable mais une trace ecrite par data/backup.js (uniquement sur un export
//   REELLEMENT abouti). Il vit avec les prefs parce qu'il doit rester lisible meme quand IDB
//   est mort — c'est exactement la situation ou le rappel « exporte tes donnees » compte le plus.
export const DEFAUTS = Object.freeze({
  ...PREFS_DEFAUT,
  dernierExportAt: null
});

// Cache memoire. Les prefs sont lues a chaque rendu de ligne (son, vibration, clavier systeme) :
// re-parser le JSON a chaque lecture serait gratuit en correction mais pas en fluidite.
let cache = null;

/** true si la valeur a le meme type que le defaut : une pref corrompue ne doit pas se propager. */
function typeCompatible(valeur, defaut) {
  if (defaut === null) return true;            // champs a defaut null : tout type est admis
  if (valeur === null) return true;            // null est toujours une remise a zero valide
  return typeof valeur === typeof defaut;
}

/**
 * Lit les preferences, TOUJOURS completes.
 * Les champs absents ou de type incompatible sont remplaces par leur valeur par defaut : un
 * `reposParDefautSec` valant la chaine "120" alimenterait ensuite un `finAt` NaN et le minuteur
 * de repos afficherait un tiret pour toujours.
 *
 * @returns {Object} copie des preferences (mutable sans effet de bord)
 */
export function lire() {
  if (cache) return { ...cache };

  let stocke = null;
  try {
    const brut = localStorage.getItem(CLES.prefs);
    if (brut) stocke = JSON.parse(brut);
  } catch (_) {
    // Stockage indisponible (navigation privee) ou JSON tronque : on repart des defauts.
    stocke = null;
  }

  const prefs = { ...DEFAUTS };
  if (stocke && typeof stocke === 'object') {
    for (const cle of Object.keys(DEFAUTS)) {
      if (!Object.prototype.hasOwnProperty.call(stocke, cle)) continue;
      if (!typeCompatible(stocke[cle], DEFAUTS[cle])) continue;
      prefs[cle] = stocke[cle];
    }
  }
  // ⚠ Les cles inconnues du fichier stocke sont VOLONTAIREMENT abandonnees : une pref retiree
  //   d'une version anterieure ne doit pas ressurgir a l'export et voyager d'appareil en appareil.

  cache = prefs;
  return { ...prefs };
}

/**
 * Applique un patch partiel et persiste.
 * @param {Object} patch sous-ensemble des cles de DEFAUTS ; les autres sont ignorees
 * @returns {Object} les preferences completes apres application
 */
export function ecrire(patch) {
  const avant = lire();
  const apres = { ...avant };

  if (patch && typeof patch === 'object') {
    for (const cle of Object.keys(patch)) {
      // Filtre sur DEFAUTS : sans lui, un objet d'import mal forme injecterait des cles
      // arbitraires qui seraient ensuite reexportees a chaque sauvegarde.
      if (!Object.prototype.hasOwnProperty.call(DEFAUTS, cle)) continue;
      apres[cle] = patch[cle];
    }
  }

  cache = apres;

  try {
    localStorage.setItem(CLES.prefs, JSON.stringify(apres));
  } catch (err) {
    // Quota depasse : les prefs restent appliquees EN MEMOIRE pour la session en cours. Perdre un
    // reglage de theme au prochain lancement est benin ; refuser le changement ne l'est pas.
    emit('prefs:non-persistees', { erreur: err });
  }

  // Seul canal d'invalidation entre couches : ui/ et views/ reagissent a cet evenement
  // (bascule de theme, activation du wake lock) sans que data/ ne connaisse le DOM.
  emit('prefs:modifiees', { prefs: { ...apres }, patch: patch || {} });
  return { ...apres };
}

/**
 * Remet toutes les preferences a leur valeur par defaut.
 * Utilise par l'ecran de secours et par l'import en strategie « remplacer ».
 */
export function reinitialiser() {
  cache = null;
  try { localStorage.removeItem(CLES.prefs); } catch (_) { /* rien a faire */ }
  const prefs = lire();
  emit('prefs:modifiees', { prefs: { ...prefs }, patch: {} });
  return prefs;
}

/** Vide le cache memoire. A appeler apres une ecriture externe de la cle (import). */
export function invalider() {
  cache = null;
}
