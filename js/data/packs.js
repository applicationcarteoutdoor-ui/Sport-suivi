// data/packs.js — PACKS : regroupement VISUEL des exercices pour la selection par icones.
//
// Un pack est une facon de RANGER des exercices, jamais une propriete des exercices. Rien n'est
// stocke sur l'Exercice : le pack est DERIVE de `materiel` et de `mode`, deux champs qui existent
// deja et que schema.js valide. Dupliquer l'information sur l'exercice creerait un second point
// de verite a maintenir en base chez tous les utilisateurs installes, pour zero gain.
//
// ⚠ Ce module est PUREMENT DERIVATIF : il ne teste jamais un mode pour en deduire un
//   comportement de calcul ou de saisie (ce privilege reste a MODES dans schema.js). Il ne fait
//   que ranger des icones dans des tiroirs. Aucun agregat, aucune charge, aucune metrique.
//
// ⚠ INVARIANT CENTRAL : packDeLExercice() est TOTALE et DETERMINISTE. Tout exercice tombe dans
//   exactement UN pack, y compris un exercice cree par l'utilisateur avec une combinaison
//   materiel/mode que le catalogue livre n'utilise pas. Un exercice sans pack serait invisible
//   dans l'ecran de selection : il existerait en base, compterait dans les statistiques, et
//   l'utilisateur ne pourrait plus jamais l'ajouter a une seance.

// ─────────────────────────────────────────────────────────────────────────────
// La table des packs
// ─────────────────────────────────────────────────────────────────────────────
// `materiels` : valeurs de MATERIELS (schema.js) que ce pack revendique. Les listes sont
//               DISJOINTES — c'est ce qui rend la resolution non ambigue. Ajouter un materiel a
//               deux packs casserait l'invariant ci-dessus en silence : verifierPacks() le
//               detecte.
// `modes`     : modes de MODES effectivement rencontres dans ce pack. Indicatif et affiche
//               (« Durée », « Cardio ») ; ne pilote aucun calcul.
// `icone`     : nom du pictogramme dans js/ui/icons.js. Prefixe 'pack-' pour ne jamais entrer en
//               collision avec les icones d'exercices, dont le nom est l'id prive de son prefixe.
// `ordre`     : ordre d'apparition dans le defilement horizontal. Espace de 10 pour pouvoir
//               inserer un pack plus tard sans renumeroter les autres.
export const PACKS = [
  {
    id: 'poids-du-corps',
    nom: 'Poids du corps',
    icone: 'poids-du-corps',
    description: 'Sans charge : tractions, pompes, dips',
    ordre: 10,
    // Elastique et sangles sont ici plutot que dans un pack a deux entrees : un pack presque vide
    // occupe autant de place a l'ecran qu'un pack rempli, pour beaucoup moins d'utilite.
    materiels: ['aucun', 'barre-traction', 'barres-paralleles', 'banc', 'elastique', 'sangles'],
    modes: ['poids-du-corps']
  },
  {
    id: 'halteres',
    nom: 'Haltères',
    icone: 'halteres',
    description: 'Charges libres tenues à la main',
    ordre: 20,
    materiels: ['halteres', 'kettlebell'],
    modes: ['charge']
  },
  {
    id: 'barre',
    nom: 'Barres',
    icone: 'barre',
    description: 'Les gros mouvements à la barre',
    ordre: 30,
    materiels: ['barre'],
    modes: ['charge']
  },
  {
    id: 'poulie',
    nom: 'Poulies',
    icone: 'poulie',
    description: 'Tension continue au câble',
    ordre: 40,
    materiels: ['poulie'],
    modes: ['charge']
  },
  {
    id: 'machine',
    nom: 'Machines',
    icone: 'machine',
    description: 'Guidé, noté en crans',
    ordre: 50,
    materiels: ['machine'],
    modes: ['machine', 'charge']
  },
  {
    id: 'cardio',
    nom: 'Cardio',
    icone: 'cardio',
    description: 'Durée et distance, jamais des kilos',
    ordre: 60,
    materiels: ['tapis-de-course', 'velo', 'rameur', 'elliptique', 'corde-a-sauter'],
    modes: ['cardio']
  },
  {
    id: 'gainage',
    nom: 'Gainage',
    icone: 'gainage',
    description: 'Positions tenues, chronométrées',
    ordre: 70,
    // Volontairement vide : le gainage ne se reconnait pas a son materiel (la planche ne demande
    // rien, la suspension demande une barre de traction) mais a son mode 'temps'. C'est le seul
    // pack defini par le mode, et packDeLExercice() le tranche AVANT de regarder le materiel.
    materiels: [],
    modes: ['temps']
  }
];

export const PACKS_PAR_ID = new Map(PACKS.map((p) => [p.id, p]));

// Pack de repli, utilise quand aucune regle ne tranche. « Poids du corps » et non « Machines » :
// un exercice mal renseigne est plus souvent un mouvement libre qu'une machine, et surtout ce
// pack est le premier a l'ecran, donc le plus facile a retrouver.
export const PACK_PAR_DEFAUT = 'poids-du-corps';

// Index materiel -> packId, construit UNE fois au chargement. Sans lui, chaque resolution
// parcourrait les 7 packs et leurs listes : packDeLExercice est appelee une fois par exercice a
// chaque ouverture du selecteur, soit 40 fois minimum sur le catalogue livre.
const PACK_PAR_MATERIEL = new Map();
for (const pack of PACKS) {
  for (const materiel of pack.materiels) PACK_PAR_MATERIEL.set(materiel, pack.id);
}

// Repli par mode, quand le materiel est absent, inconnu, ou revendique par aucun pack.
// 'charge' tombe sur les halteres : c'est le materiel le plus courant d'un exercice charge cree
// a la main, et le pack le plus fourni apres le poids du corps.
const PACK_PAR_MODE = {
  'poids-du-corps': 'poids-du-corps',
  'charge': 'halteres',
  'machine': 'machine',
  'temps': 'gainage',
  'cardio': 'cardio'
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pack d'un exercice. Total : retourne toujours un id de pack existant.
 *
 * L'ORDRE DES REGLES EST LE CONTRAT, il ne se reorganise pas :
 *   1. mode 'cardio'  → cardio.  La course a pied a le materiel 'aucun' ; sans cette regle en
 *      premier elle atterrirait dans « Poids du corps », entre les pompes et les dips.
 *   2. mode 'temps'   → gainage. La suspension a la barre a le materiel 'barre-traction' ; sans
 *      cette regle avant le materiel, elle quitterait le gainage pour le poids du corps.
 *   3. materiel revendique par un pack → ce pack. Le cas general des 31 autres exercices livres.
 *   4. repli par mode, puis PACK_PAR_DEFAUT.
 *
 * @param {object} exercice un Exercice au sens de schema.js (seuls mode et materiel sont lus)
 * @returns {string} un id present dans PACKS_PAR_ID
 */
export function packDeLExercice(exercice) {
  const ex = exercice || {};

  if (ex.mode === 'cardio') return 'cardio';
  if (ex.mode === 'temps') return 'gainage';

  const parMateriel = PACK_PAR_MATERIEL.get(ex.materiel);
  if (parMateriel) return parMateriel;

  return PACK_PAR_MODE[ex.mode] || PACK_PAR_DEFAUT;
}

// Comparateur de noms. localeCompare en 'fr' et non un `<` brut : « Élévations latérales » se
// rangerait apres « Vélo » dans l'ordre des points de code, l'utilisateur cherchant a la lettre E
// ne le trouverait jamais. `numeric` range « Pompes 2 » avant « Pompes 10 » pour les exercices
// personnels numerotes.
const collateur = typeof Intl !== 'undefined' && Intl.Collator
  ? new Intl.Collator('fr', { sensitivity: 'base', numeric: true })
  : null;

function comparerParNom(a, b) {
  const na = (a && a.nom) || '';
  const nb = (b && b.nom) || '';
  if (collateur) return collateur.compare(na, nb);
  return na.localeCompare(nb, 'fr');
}

/**
 * Exercices d'un pack, tries par nom.
 *
 * ⚠ Ne filtre PAS les exercices archives : c'est a l'appelant de decider. L'ecran de selection
 *   passe la liste active, l'ecran de gestion des exercices passe tout. Trancher ici obligerait
 *   le second a contourner la fonction.
 *
 * @param {string} packId
 * @param {Array<object>} exercices
 * @returns {Array<object>} nouveau tableau, l'entree n'est jamais triee en place
 */
export function exercicesDuPack(packId, exercices) {
  if (!PACKS_PAR_ID.has(packId)) return [];
  const liste = Array.isArray(exercices) ? exercices : [];
  return liste
    .filter((e) => e && packDeLExercice(e) === packId)
    .sort(comparerParNom);
}

/**
 * Nombre d'exercices par pack.
 *
 * ⚠ TOUS les packs sont presents dans le resultat, ceux a zero compris : l'UI affiche « 0 » sur
 *   la carte plutot que de la faire disparaitre. Un pack qui s'evanouit fait croire a un bug, et
 *   deplace toutes les cartes voisines sous le doigt de l'utilisateur.
 *
 * @param {Array<object>} exercices
 * @returns {Object<string, number>}
 */
export function compterParPack(exercices) {
  const compte = {};
  for (const pack of PACKS) compte[pack.id] = 0;
  for (const e of Array.isArray(exercices) ? exercices : []) {
    if (!e) continue;
    const id = packDeLExercice(e);
    compte[id] = (compte[id] || 0) + 1;
  }
  return compte;
}

/**
 * Verifie les invariants de la table des packs. Destine a tests.html : une liste de materiels
 * revendiquee par deux packs rendrait packDeLExercice dependante de l'ordre de PACKS, et le jour
 * ou quelqu'un reordonne les cartes a l'ecran, des exercices changeraient de tiroir.
 *
 * @returns {string[]} liste vide si tout va bien
 */
export function verifierPacks() {
  const erreurs = [];
  const vus = new Set();
  const ids = new Set();
  for (const pack of PACKS) {
    if (ids.has(pack.id)) erreurs.push('pack en double : ' + pack.id);
    ids.add(pack.id);
    for (const materiel of pack.materiels) {
      if (vus.has(materiel)) erreurs.push('materiel revendique deux fois : ' + materiel);
      vus.add(materiel);
    }
  }
  for (const cible of Object.values(PACK_PAR_MODE)) {
    if (!ids.has(cible)) erreurs.push('repli par mode vers un pack inexistant : ' + cible);
  }
  if (!ids.has(PACK_PAR_DEFAUT)) erreurs.push('PACK_PAR_DEFAUT inexistant : ' + PACK_PAR_DEFAUT);
  return erreurs;
}
