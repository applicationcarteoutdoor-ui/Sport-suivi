// data/store.js — état mémoire et SOURCE DE VÉRITÉ UNIQUE de l'application.
//
// Trois règles qui expliquent tout le fichier :
//
// 1. Les vues ne lisent JAMAIS IndexedDB. Elles lisent le store, qui est synchrone. Une vue qui
//    lirait la base ferait apparaître deux copies de la même séance, et la plus lente gagnerait.
// 2. Toute mutation passe par commit(). Une seule porte d'écriture, donc un seul endroit où
//    l'on persiste, un seul endroit où l'on notifie.
// 3. L'invalidation passe par bus.emit, jamais par un appel direct à une vue. La direction des
//    dépendances (lib <- data <- domain <- ui <- views) l'interdit : data ne connaît aucune vue.
//
// Ce module ne calcule rien du domaine : il ne sait ni ce qu'est un 1RM ni comment valider une
// série. Il reçoit des objets déjà construits par domain/session.js et les rend durables.

import { SCHEMA_VERSION, META_ID, MAX_SEANCES_EN_COURS } from '../config.js';
import * as idb from '../lib/idb.js';
import * as bus from '../lib/bus.js';
import { dayKey, joursEntre } from '../lib/dates.js';
import {
  estComptable, valider,
  estSeanceComptable, estSeanceEnCours,
  estRoutine, suppressionDurePermise, origineModele,
  nouveauModele, dupliquerModele
} from './schema.js';

// catalog.js, templates.js et hot.js sont importés en NAMESPACE et appelés défensivement.
// Raison : ce sont trois modules voisins dont l'absence ou la dérive d'un nom d'export ne doit
// pas empêcher l'application de démarrer. Perdre la synchronisation du catalogue livré dégrade
// l'expérience ; ne pas démarrer du tout fait perdre l'accès à trois ans de séances.
import * as catalogue from './catalog.js';
import * as templates from './templates.js';
import * as hot from './hot.js';
import * as prefs from './prefs.js';

// Au-delà de ce délai, une séance restée « en-cours » ne se reprend plus en silence : reprendre
// une séance d'avant-hier ajouterait des séries d'aujourd'hui à la date d'avant-hier, et le
// dérivé le plus consulté de l'application — « dernière fois » — mentirait durablement.
const SEUIL_REPRISE_SILENCIEUSE_MS = 6 * 60 * 60 * 1000;

// Plafond de durée d'une séance à la clôture rétroactive : on ne compte pas comme temps
// d'entraînement les heures pendant lesquelles le téléphone était dans une poche.
const MARGE_APRES_DERNIERE_SERIE_SEC = 10 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// État
// ─────────────────────────────────────────────────────────────────────────────

let db = null;

const etat = {
  exercices: new Map(),
  modeles: new Map(),
  lieux: new Map(),
  // Les séances terminées n'arrivent qu'avec chargerHistorique(). Les séances EN COURS, elles,
  // sont présentes dès l'initialisation : l'écran de séance ne doit pas attendre l'historique.
  seances: new Map(),
  meta: null,
  // ── v2 : plusieurs séances en cours simultanément ──────────────────────────
  // La collection est la vérité. `seanceActiveId` n'est plus « la séance », c'est seulement la
  // DERNIÈRE TOUCHÉE — celle sur laquelle porte l'écran de séance. Distinguer les deux est ce
  // qui permet de garder toute l'API v1 (`seanceActive()`) sans mentir : elle rend toujours
  // quelque chose de sensé, simplement ce n'est plus la seule possible.
  seancesEnCoursIds: new Set(),
  seanceActiveId: null,
  historiqueCharge: false
};

let promesseHistorique = null;

function exigerDb() {
  if (!db) throw new Error('store : initialiser(db) n\'a pas été appelé.');
  return db;
}

// Copie profonde. Le store rend des objets tels quels aux vues pour rester rapide, mais tout ce
// qu'il PERSISTE est cloné : une vue qui garderait une référence sur une série et la muterait
// après coup ferait diverger la mémoire de la base sans passer par commit().
function copie(v) {
  if (v == null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v); } catch (e) { /* objet non clonable : repli JSON */ }
  }
  return JSON.parse(JSON.stringify(v));
}

function trierParNom(a, b) {
  return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecteurs — synchrones, sans I/O, appelables depuis n'importe quel rendu
// ─────────────────────────────────────────────────────────────────────────────

export function exercices() {
  return Array.from(etat.exercices.values()).sort(trierParNom);
}

export function exercice(id) {
  return etat.exercices.get(id) || null;
}

export function modeles() {
  return Array.from(etat.modeles.values()).sort(trierParNom);
}

export function modele(id) {
  return etat.modeles.get(id) || null;
}

/** Routines créées par l'utilisateur, triées par nom. Sous-ensemble de modeles(). */
export function routines() {
  return modeles().filter(estRoutine);
}

/** Modèles livrés avec l'application (data/templates.js), triés par nom. */
export function modelesLivres() {
  return modeles().filter((m) => !estRoutine(m));
}

export function lieux() {
  return Array.from(etat.lieux.values()).sort(trierParNom);
}

export function lieu(id) {
  return etat.lieux.get(id) || null;
}

/** Séances connues, antichronologiques. Vide (hors séance active) tant que 'historique:pret'
 *  n'a pas été émis : c'est volontaire, l'écran s'affiche sans attendre. */
export function seances() {
  return Array.from(etat.seances.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.startedAt || 0) - (a.startedAt || 0);
  });
}

export function seance(id) {
  return etat.seances.get(id) || null;
}

/**
 * Toutes les séances actuellement « en-cours », de la plus récemment commencée à la plus
 * ancienne. Disponible dès initialiser() : elles sont chargées par leurs ids, sans balayer
 * l'historique.
 * @returns {object[]}
 */
export function seancesEnCours() {
  const liste = [];
  for (const id of etat.seancesEnCoursIds) {
    const s = etat.seances.get(id);
    if (estSeanceEnCours(s)) liste.push(s);
  }
  return liste.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

/**
 * La séance sur laquelle porte l'écran de séance : la DERNIÈRE TOUCHÉE.
 * CONSERVÉE telle quelle depuis la v1 — tout le code existant continue de fonctionner. Quand
 * plusieurs séances sont ouvertes, c'est activer(id) qui choisit laquelle elle désigne.
 * @returns {object|null}
 */
export function seanceActive() {
  const s = etat.seanceActiveId ? etat.seances.get(etat.seanceActiveId) : null;
  return estSeanceEnCours(s) ? s : null;
}

/**
 * Désigne la séance sur laquelle porte l'écran de séance.
 * Passe par commit() comme toute mutation : l'id actif est persisté dans meta, sinon rouvrir
 * l'application ramènerait l'écran sur une autre séance que celle qu'on regardait.
 * @param {string} seanceId
 * @returns {Promise<{seance:object}>}
 */
export function activer(seanceId) {
  return commit('seance:activer', { id: seanceId });
}

export function meta() {
  return etat.meta;
}

export function historiquePret() {
  return etat.historiqueCharge;
}

// ─────────────────────────────────────────────────────────────────────────────
// Poids de corps mémorisé (v7)
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ LOGIQUE UNIQUE, partagée par l'accueil, le composeur et l'écran de séance. Trois copies
//   locales avaient déjà divergé : le composeur gardait la règle « poids du jour seulement » et
//   redemandait le poids à chaque séance composée — exactement le bug que la v6 devait éliminer.

export const VALIDITE_POIDS_JOURS = 14;

/**
 * Dernier poids de corps connu, toutes sources confondues : les séances en mémoire ET la trace
 * des prefs (posée par la feuille de poids de séance et par la pesée des réglages — le magasin
 * IndexedDB `poids` n'est pas chargé en mémoire, la trace le représente).
 * @returns {{kg: number, date: string}|null}
 */
export function dernierPoidsConnu() {
  let meilleur = null;
  for (const s of seances()) {
    if (!s || !Number.isFinite(s.poidsDeCorpsKg) || !s.date) continue;
    if (!meilleur || s.date > meilleur.date) meilleur = { kg: s.poidsDeCorpsKg, date: s.date };
  }
  const trace = prefs.lire().dernierPoids;
  if (trace && Number.isFinite(trace.kg) && trace.date && (!meilleur || trace.date > meilleur.date)) {
    meilleur = { kg: trace.kg, date: trace.date };
  }
  return meilleur;
}

/**
 * Poids à geler sur une séance qui démarre, ou null au-delà de 14 jours — c'est le null qui
 * fait s'ouvrir la feuille de saisie de l'écran de séance, laquelle se pré-remplit alors avec
 * dernierPoidsConnu(), jamais avec un défaut arbitraire.
 */
export function poidsPourNouvelleSeance() {
  const dernier = dernierPoidsConnu();
  if (!dernier) return null;
  return joursEntre(dernier.date, dayKey()) <= VALIDITE_POIDS_JOURS ? dernier.kg : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Charge tout ce dont le premier écran a besoin : exercices, modèles, lieux, meta, séance active.
 * PAS l'historique — il peut peser plusieurs mégaoctets et n'est nécessaire à aucun des deux
 * écrans de démarrage. Voir chargerHistorique().
 *
 * @param {IDBDatabase} base
 */
export async function initialiser(base) {
  if (!base) throw new Error('store.initialiser : base IndexedDB manquante.');
  db = base;

  etat.meta = (await idb.get(db, 'meta', META_ID)) || null;
  if (!etat.meta) {
    // Première ouverture. C'est ici, et nulle part ailleurs, que meta naît : migrations.js
    // refuse explicitement d'écrire sur une base neuve.
    etat.meta = { id: META_ID, schemaVersion: SCHEMA_VERSION, lastPerf: {}, dernierExportAt: null, createdAt: Date.now() };
    await idb.put(db, 'meta', etat.meta);
  }
  if (!etat.meta.lastPerf) etat.meta.lastPerf = {};

  const exercicesEnBase = (await idb.getAll(db, 'exercices')) || [];
  const apresSynchro = await synchroniserCatalogue(exercicesEnBase);
  for (const ex of apresSynchro) etat.exercices.set(ex.id, ex);

  const modelesEnBase = (await idb.getAll(db, 'modeles')) || [];
  for (const m of modelesEnBase) etat.modeles.set(m.id, m);
  await semerModelesLivres();

  for (const l of (await idb.getAll(db, 'lieux')) || []) etat.lieux.set(l.id, l);

  // Séances en cours : lues par leurs ids, jamais par un balayage de l'historique. Le seul
  // autre moyen de les trouver serait de charger toutes les séances — exactement ce que cette
  // étape évite. `seanceActiveId` est réuni aux ids de la collection : une base v1 non encore
  // migrée, ou un meta réparé à la main, ne porte que lui.
  const idsCandidats = [];
  for (const id of (etat.meta.seancesEnCoursIds || [])) {
    if (id && idsCandidats.indexOf(id) === -1) idsCandidats.push(id);
  }
  if (etat.meta.seanceActiveId && idsCandidats.indexOf(etat.meta.seanceActiveId) === -1) {
    idsCandidats.push(etat.meta.seanceActiveId);
  }

  let etatSeancesADeriver = false;
  for (const id of idsCandidats) {
    const s = await idb.get(db, 'seances', id);
    if (estSeanceEnCours(s)) {
      etat.seances.set(s.id, s);
      etat.seancesEnCoursIds.add(s.id);
    } else {
      // Référence morte (séance terminée ou abandonnée depuis un autre onglet, ou supprimée) :
      // on la nettoie plutôt que de laisser l'accueil proposer de reprendre une séance qui
      // n'existe plus.
      etatSeancesADeriver = true;
    }
  }

  // La dernière touchée reste la dernière touchée si elle est toujours ouverte ; sinon la plus
  // récemment commencée parmi celles qui restent.
  const encore = seancesEnCours();
  const actifValide = etat.meta.seanceActiveId && etat.seancesEnCoursIds.has(etat.meta.seanceActiveId);
  etat.seanceActiveId = actifValide ? etat.meta.seanceActiveId : ((encore[0] && encore[0].id) || null);

  if (etatSeancesADeriver || etat.seanceActiveId !== (etat.meta.seanceActiveId || null)) {
    await ecrireEtatSeances();
  }

  bus.emit('store:pret', {
    exercices: etat.exercices.size,
    modeles: etat.modeles.size,
    seancesEnCours: etat.seancesEnCoursIds.size
  });
  return etat.meta;
}

/**
 * Synchronise le catalogue livré avec ce qui est en base, puis persiste le delta.
 * Le format de retour de catalog.synchroniser() est normalisé ici : ce module est écrit par
 * ailleurs et peut rendre soit la liste complète, soit un objet. On n'écrit que ce qui a
 * réellement changé — réécrire 40 exercices identiques à chaque démarrage use le stockage
 * flash pour rien et fait mentir updatedAt.
 */
async function synchroniserCatalogue(existants) {
  let resultat = null;
  try {
    resultat = typeof catalogue.synchroniser === 'function' ? catalogue.synchroniser(existants) : null;
  } catch (err) {
    console.error('[store] synchronisation du catalogue en échec, exercices en base conservés', err);
  }

  let tous = existants;
  let aEcrire = [];

  if (Array.isArray(resultat)) {
    // Liste COMPLÈTE : on ne réécrit que ce qui a réellement changé.
    tous = resultat;
    const avant = new Map(existants.map((e) => [e.id, e]));
    aEcrire = tous.filter((e) => {
      const precedent = avant.get(e.id);
      return !precedent || JSON.stringify(precedent) !== JSON.stringify(e);
    });
  } else if (resultat && typeof resultat === 'object') {
    // Forme réelle de catalog.synchroniser() : le DELTA seul, { crees, misAJour }.
    // On accepte aussi la liste sous 'exercices' ou l'alias 'majs' : ce contrat est le point de
    // couture entre deux modules, et s'y tromper vide silencieusement le catalogue — l'écran
    // « aucun exercice » sans la moindre erreur en console.
    if (Array.isArray(resultat.exercices)) {
      tous = resultat.exercices;
      const avant = new Map(existants.map((e) => [e.id, e]));
      aEcrire = tous.filter((e) => {
        const precedent = avant.get(e.id);
        return !precedent || JSON.stringify(precedent) !== JSON.stringify(e);
      });
    } else {
      const crees = Array.isArray(resultat.crees) ? resultat.crees : [];
      const majs = Array.isArray(resultat.misAJour) ? resultat.misAJour
        : Array.isArray(resultat.majs) ? resultat.majs : [];
      aEcrire = crees.concat(majs);
      if (aEcrire.length) {
        const index = new Map(existants.map((e) => [e.id, e]));
        for (const e of aEcrire) index.set(e.id, e);
        tous = Array.from(index.values());
      }
    }
  }

  if (aEcrire.length) await idb.putBatch(db, 'exercices', aEcrire);
  return tous;
}

/**
 * Insère les modèles livrés, UNE SEULE FOIS dans la vie de la base.
 * Le drapeau est nécessaire : sans lui, archiver ou supprimer un modèle livré le ferait
 * réapparaître au démarrage suivant. Un modèle est une INTENTION, elle appartient à
 * l'utilisateur dès la première ouverture.
 */
async function semerModelesLivres() {
  if (etat.meta.modelesSemes === true) return;

  const livres = Array.isArray(templates.MODELES) ? templates.MODELES : [];
  const manquants = livres.filter((m) => m && m.id && !etat.modeles.has(m.id)).map(copie);
  if (manquants.length) {
    await idb.putBatch(db, 'modeles', manquants);
    for (const m of manquants) etat.modeles.set(m.id, m);
  }
  await ecrireMeta({ modelesSemes: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Historique — tâche de fond
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Charge toutes les séances en arrière-plan et émet 'historique:pret'.
 * Appelée sans await par boot.js : l'écran est déjà peint quand elle démarre. Les vues qui en
 * dépendent (historique, progression) s'abonnent à l'événement et se remplissent à son arrivée.
 *
 * @returns {Promise<{ok:boolean, nombre:number, erreur?:Error}>}
 */
export function chargerHistorique() {
  // Idempotente : l'accueil, l'historique et la progression peuvent l'appeler toutes les trois
  // au même moment sans provoquer trois balayages complets de la base.
  if (promesseHistorique) return promesseHistorique;

  promesseHistorique = (async () => {
    try {
      const toutes = (await idb.getAll(exigerDb(), 'seances')) || [];
      for (const s of toutes) {
        // Une séance EN COURS déjà en mémoire fait autorité sur sa copie en base : elle peut
        // avoir reçu des séries pendant ce chargement, et l'écraser ici les perdrait à l'écran.
        if (etat.seancesEnCoursIds.has(s.id)) continue;
        etat.seances.set(s.id, s);
      }
      etat.historiqueCharge = true;

      // Auto-réparation : les séances restées « en-cours » que meta ne référençait pas (miroir
      // chaud effacé, meta perdue, écriture interrompue) sont retrouvées ici, une fois
      // l'historique complet connu. Depuis la v2 elles sont TOUTES adoptées, pas seulement la
      // plus récente : en oublier une revenait à la rendre invisible et non terminable.
      const retrouvees = toutes
        .filter((s) => estSeanceEnCours(s) && !etat.seancesEnCoursIds.has(s.id))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (retrouvees.length) {
        for (const s of retrouvees) etat.seancesEnCoursIds.add(s.id);
        if (!etat.seanceActiveId) etat.seanceActiveId = retrouvees[0].id;
        try { await ecrireEtatSeances(); } catch (err) { console.warn('[store] meta non mis à jour après auto-réparation', err); }
        for (const s of retrouvees) bus.emit('seance:retrouvee', { seance: s });
      }

      const charge = { ok: true, nombre: etat.seances.size };
      bus.emit('historique:pret', charge);
      return charge;
    } catch (err) {
      // ⚠ On n'émet pas de rejet non géré : une tâche de fond lancée sans await ferait remonter
      // un « unhandled rejection » à chaque ouverture hors-ligne. Les vues sont notifiées de
      // l'échec par le même événement, et affichent un état d'erreur au lieu d'attendre à vide.
      console.error('[store] chargement de l\'historique en échec', err);
      promesseHistorique = null; // un nouvel essai reste possible
      const charge = { ok: false, nombre: 0, erreur: err };
      bus.emit('historique:pret', charge);
      return charge;
    }
  })();

  return promesseHistorique;
}

// ─────────────────────────────────────────────────────────────────────────────
// meta
// ─────────────────────────────────────────────────────────────────────────────

async function ecrireMeta(patch) {
  etat.meta = Object.assign({}, etat.meta, patch, { id: META_ID });
  await idb.put(exigerDb(), 'meta', etat.meta);
  return etat.meta;
}

/**
 * Persiste l'état de la collection de séances en cours : ses ids ET la dernière touchée.
 *
 * ⚠ LES DEUX ENSEMBLE, toujours. Écrire l'un sans l'autre laisse une fenêtre où meta désigne
 * comme active une séance absente de la collection : au redémarrage suivant, l'écran de séance
 * ouvrirait une séance que l'accueil ne liste pas. Un seul appel, un seul fait.
 */
async function ecrireEtatSeances() {
  // Le Set est sérialisé en tableau : IndexedDB clone par l'algorithme de clonage structuré, qui
  // sait stocker un Set — mais un tableau reste lisible dans un export JSON, et l'export est le
  // seul filet de sécurité réel de l'utilisateur.
  return ecrireMeta({
    seancesEnCoursIds: Array.from(etat.seancesEnCoursIds),
    seanceActiveId: etat.seanceActiveId || null
  });
}

/** Retire une séance de la collection des « en-cours » et réélit la dernière touchée si besoin.
 *  Ne persiste rien : l'appelant décide du moment, parce qu'il connaît l'ordre des écritures. */
function retirerDesEnCours(id) {
  etat.seancesEnCoursIds.delete(id);
  if (etat.seanceActiveId === id) {
    const restantes = seancesEnCours();
    etat.seanceActiveId = (restantes[0] && restantes[0].id) || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// lastPerf — SEUL dérivé persisté
// ─────────────────────────────────────────────────────────────────────────────
// Il existe pour une seule raison : que l'écran de séance affiche « Dernière fois : 8×+10 · … »
// sans attendre le chargement de l'historique. Il est intégralement reconstructible
// (recalculerDerives), donc jamais critique : le perdre coûte un rappel manquant, pas une donnée.

// On ne recopie que les champs de valeur, plus `done` et `kind`. Garder les Series entières
// ferait grossir meta de plusieurs dizaines de kilo-octets, relus et réécrits à chaque clôture.
//
// ⚠ `done` et `kind` sont INDISPENSABLES malgré leur air de métadonnée : le consommateur
//    (domain/prefill.js) refiltre ces séries par estComptable(), qui exige done === true et
//    kind !== 'echauffement'. Les omettre ne casse rien visiblement — ça vide silencieusement
//    le niveau ② du pré-remplissage et le rappel « Dernière fois », c'est-à-dire le cœur de la
//    valeur de l'écran séance. Coût réel : ~30 octets par série.
function trimSerie(s) {
  return {
    reps: s.reps, chargeKg: s.chargeKg, lestKg: s.lestKg,
    valeur: s.valeur, dureeSec: s.dureeSec, distanceM: s.distanceM,
    done: s.done, kind: s.kind
  };
}

function perfDepuis(s, entree) {
  const comptables = (entree.series || []).filter(estComptable);
  if (!comptables.length) return null;
  return {
    date: s.date,
    seanceId: s.id,
    entreeId: entree.id,
    startedAt: s.startedAt || 0,
    modeUtilise: entree.modeUtilise,
    series: comptables.map(trimSerie)
  };
}

// Une perf n'en remplace une autre que si elle est POSTÉRIEURE. Sans ce test, éditer une séance
// vieille de six mois écraserait le rappel par des charges de l'an dernier.
function plusRecente(a, b) {
  if (!b) return true;
  if (a.date !== b.date) return a.date > b.date;
  return (a.startedAt || 0) >= (b.startedAt || 0);
}

function fusionnerLastPerf(existant, s) {
  const sortie = Object.assign({}, existant || {});
  for (const entree of s.entrees || []) {
    if (!entree || !entree.exerciceId) continue;
    const perf = perfDepuis(s, entree);
    if (perf && plusRecente(perf, sortie[entree.exerciceId])) sortie[entree.exerciceId] = perf;
  }
  return sortie;
}

/**
 * Reconstruit meta.lastPerf par balayage complet de l'historique.
 * Aucun cache à invalider ailleurs : c'est précisément parce que ce dérivé est reconstructible
 * en quelques millisecondes qu'on peut se permettre de le persister sans le protéger.
 */
export async function recalculerDerives() {
  if (!etat.historiqueCharge) await chargerHistorique();

  // Ordre chronologique croissant : la dernière écriture pour un exercice donné est donc,
  // par construction, sa perf la plus récente. Aucune comparaison n'est nécessaire.
  // ⚠ estSeanceComptable, et non `statut === 'terminee'` : une séance ABANDONNÉE contient de
  // vraies séries faites, mais elle n'alimente ni les courbes, ni les records, ni le rappel
  // « Dernière fois ». Un abandon est un fait d'entraînement, pas une performance de référence.
  const ordonnees = Array.from(etat.seances.values())
    .filter(estSeanceComptable)
    .sort((a, b) => (a.date === b.date ? (a.startedAt || 0) - (b.startedAt || 0) : (a.date < b.date ? -1 : 1)));

  let lastPerf = {};
  for (const s of ordonnees) lastPerf = fusionnerLastPerf(lastPerf, s);

  await ecrireMeta({ lastPerf });
  bus.emit('derives:recalcules', { exercices: Object.keys(lastPerf).length, seances: ordonnees.length });
  return lastPerf;
}

/** Dernière performance connue pour un exercice, ou null. Lecture synchrone : c'est ce qui
 *  permet à l'écran de séance de peindre le rappel dès le premier rendu. */
export function dernierePerf(exerciceId) {
  const table = (etat.meta && etat.meta.lastPerf) || {};
  return table[exerciceId] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistance d'une séance
// ─────────────────────────────────────────────────────────────────────────────

function marquer(s) {
  const copieSeance = copie(s);
  copieSeance.updatedAt = Date.now();
  // Filet : une séance sans date locale valide deviendrait invisible dans l'historique et dans
  // toutes les plages de progression, sans jamais lever d'erreur.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(copieSeance.date || '')) copieSeance.date = dayKey(new Date(copieSeance.startedAt || Date.now()));
  return copieSeance;
}

// On valide sans bloquer : refuser une écriture au milieu d'une séance ferait perdre la série
// que l'utilisateur vient de faire, ce qui est bien pire que de stocker un champ douteux.
function avertirSiInvalide(objet, type) {
  const v = valider(objet, type);
  if (!v.ok) console.warn('[store] ' + type + ' incomplet : ' + v.erreurs.join(' · '), objet);
  return v.ok;
}

async function enregistrerSeance(s) {
  const finale = marquer(s);
  avertirSiInvalide(finale, 'seance');
  await idb.put(exigerDb(), 'seances', finale);
  etat.seances.set(finale.id, finale);
  return finale;
}

/**
 * Relit ce qui vient d'être écrit et le compare.
 * ⚠ Une transaction IndexedDB peut se valider puis être perdue : quota atteint en arrière-plan,
 * base évincée par le système, disque plein. C'est le seul moment de l'application où l'on
 * s'apprête à DÉTRUIRE la copie de secours (le miroir chaud) — donc le seul où une vérification
 * se justifie. Si elle échoue, on lève avant la purge : le miroir survit, la reprise au prochain
 * démarrage retrouve la séance.
 */
async function relireEtVerifier(attendue) {
  let relue = null;
  try {
    relue = await idb.get(exigerDb(), 'seances', attendue.id);
  } catch (err) {
    const e = new Error('La séance a été écrite mais n\'a pas pu être relue : ' + err.message +
      ' Vos données sont conservées dans le cache de reprise.');
    e.code = 'RELECTURE_ECHOUEE';
    e.cause = err;
    throw e;
  }

  const compter = (s) => (s.entrees || []).reduce((n, e) => n + ((e.series || []).length), 0);
  const conforme = relue &&
    relue.statut === attendue.statut &&
    relue.updatedAt === attendue.updatedAt &&
    (relue.entrees || []).length === (attendue.entrees || []).length &&
    compter(relue) === compter(attendue);

  if (!conforme) {
    const e = new Error('La séance « ' + attendue.id + ' » n\'a pas été enregistrée correctement. ' +
      'Vos données sont conservées dans le cache de reprise : ne fermez pas l\'application, ' +
      'exportez-les depuis les réglages.');
    e.code = 'RELECTURE_ECHOUEE';
    throw e;
  }
  return relue;
}

function purgerMiroir() {
  // Défensif : hot.js appartient à un autre module et le miroir n'est qu'un cache. Échouer à
  // l'effacer laisse au pire une proposition de reprise sur une séance déjà terminée, que
  // reprendreSeance() écarte de toute façon en testant `statut`.
  try { hot.purger && hot.purger(); } catch (err) { console.warn('[store] purge du miroir chaud impossible', err); }
}

/**
 * Purge le miroir chaud SEULEMENT s'il ne reflète plus rien.
 *
 * ⚠ v2 : clore une séance ne purge plus le miroir inconditionnellement. Le miroir reflète la
 * séance ACTIVE (voir MAX_SEANCES_MIROIR dans config.js) ; s'il en reste d'autres ouvertes, le
 * purger ferait perdre la reprise de la séance vers laquelle on vient de basculer. On ne purge
 * donc que si le miroir pointe sur la séance qu'on vient de fermer, ou s'il n'y a plus rien.
 */
function purgerMiroirSiOrphelin(idFerme) {
  if (etat.seancesEnCoursIds.size === 0) { purgerMiroir(); return; }
  let reflete = null;
  try { reflete = typeof hot.lire === 'function' ? hot.lire() : null; } catch (err) { reflete = null; }
  if (reflete && reflete.seanceId === idFerme) purgerMiroir();
}

// Durée réelle d'une séance : plafonnée à la dernière série validée + 10 min. Sans ce plafond,
// une séance oubliée ouverte toute la nuit afficherait « 9 h 47 » et fausserait toutes les
// statistiques de durée moyenne.
function calculerDuree(s, endedAt) {
  const debut = s.startedAt || endedAt;
  const brute = Math.max(0, Math.round((endedAt - debut) / 1000));
  const dernierAt = dernierHorodatage(s);
  if (!dernierAt) return brute;
  const plafond = Math.max(0, Math.round((dernierAt - debut) / 1000)) + MARGE_APRES_DERNIERE_SERIE_SEC;
  return Math.min(brute, plafond);
}

function dernierHorodatage(s) {
  let max = 0;
  for (const e of s.entrees || []) {
    for (const serie of e.series || []) {
      if (serie.done === true && typeof serie.at === 'number' && serie.at > max) max = serie.at;
    }
  }
  return max || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// commit — l'unique porte d'écriture
// ─────────────────────────────────────────────────────────────────────────────

// Table d'opérations plutôt qu'un switch : ajouter un type se fait en ajoutant une ligne, et
// la liste des mutations possibles de l'application se lit d'un coup d'œil.
const OPERATIONS = {

  // ── Exercices ───────────────────────────────────────────────────────────
  'exercice:enregistrer': async ({ exercice: ex }) => {
    const copieEx = copie(ex);
    copieEx.updatedAt = Date.now();
    // ⚠ Marque l'exercice comme intouchable pour la synchronisation du catalogue livré : sans
    // cela, corriger l'incrément d'un exercice du catalogue serait annulé au prochain démarrage.
    if (String(copieEx.id).startsWith('cat:')) copieEx.userModified = true;
    avertirSiInvalide(copieEx, 'exercice');
    await idb.put(exigerDb(), 'exercices', copieEx);
    etat.exercices.set(copieEx.id, copieEx);
    return { exercice: copieEx };
  },

  // ⚠ JAMAIS de suppression dure : des séances de 2023 référencent cet id à vie. Une entrée de
  // séance dont l'exercice a disparu perdrait son mode, donc l'interprétation de ses séries.
  'exercice:archiver': async ({ id, archived = true }) => {
    const ex = etat.exercices.get(id);
    if (!ex) throw new Error('exercice:archiver — id inconnu : ' + id);
    const maj = Object.assign(copie(ex), {
      archived: archived === true,
      archivedAt: archived === true ? Date.now() : null,
      userModified: true,
      updatedAt: Date.now()
    });
    await idb.put(exigerDb(), 'exercices', maj);
    etat.exercices.set(maj.id, maj);
    return { exercice: maj };
  },

  // ── Modèles ─────────────────────────────────────────────────────────────
  'modele:enregistrer': async ({ modele: m }) => {
    const copieM = copie(m);
    copieM.updatedAt = Date.now();
    avertirSiInvalide(copieM, 'modele');
    await idb.put(exigerDb(), 'modeles', copieM);
    etat.modeles.set(copieM.id, copieM);
    return { modele: copieM };
  },

  'modele:archiver': async ({ id, archived = true }) => {
    const m = etat.modeles.get(id);
    if (!m) throw new Error('modele:archiver — id inconnu : ' + id);
    const maj = Object.assign(copie(m), { archived: archived === true, updatedAt: Date.now() });
    await idb.put(exigerDb(), 'modeles', maj);
    etat.modeles.set(maj.id, maj);
    return { modele: maj };
  },

  // ── Routines (modèles créés par l'utilisateur) ──────────────────────────
  // Une routine EST un Modèle : même magasin, même forme, même snapshot au lancement d'une
  // séance. Seule son ORIGINE diffère, et avec elle une règle : une routine se supprime, un
  // modèle livré s'archive. Ces quatre opérations existent séparément de 'modele:enregistrer'
  // pour que cette règle soit appliquée à l'écriture et non laissée à la vigilance des vues.

  'routine:creer': async ({ routine, nom, description, dureeEstimeeMin, items }) => {
    // On accepte soit une routine déjà fabriquée, soit ses champs bruts : la feuille de création
    // n'a aucune raison de connaître schema.nouveauModele.
    const brute = routine || { nom, description, dureeEstimeeMin, items };
    // ⚠ origine forcée : une routine créée ici est une routine, quel que soit ce qu'on a passé.
    //   Sans cette contrainte, un appelant distrait créerait un « modèle livré » local que rien
    //   ne saurait plus supprimer.
    const creee = nouveauModele(Object.assign({}, brute, { origine: 'utilisateur', id: null }));
    avertirSiInvalide(creee, 'modele');
    await idb.put(exigerDb(), 'modeles', creee);
    etat.modeles.set(creee.id, creee);
    return { modele: creee, routine: creee };
  },

  'routine:modifier': async ({ modele: m, routine }) => {
    const source = m || routine;
    if (!source || !source.id) throw new Error('routine:modifier — routine sans id.');
    const existante = etat.modeles.get(source.id);
    // Modifier un modèle LIVRÉ est permis — c'est une intention, elle appartient à l'utilisateur
    // dès la première ouverture — mais cela n'en fait pas une routine : l'origine est préservée.
    const origine = origineModele(existante || source);
    const maj = Object.assign(copie(source), { origine, updatedAt: Date.now() });
    avertirSiInvalide(maj, 'modele');
    await idb.put(exigerDb(), 'modeles', maj);
    etat.modeles.set(maj.id, maj);
    return { modele: maj, routine: maj };
  },

  // Dupliquer produit TOUJOURS une routine utilisateur, même à partir d'un modèle livré : c'est
  // le geste par lequel « les 6 modèles livrés » deviennent « mes séances types ».
  'routine:dupliquer': async ({ id, nom }) => {
    const source = etat.modeles.get(id);
    if (!source) throw new Error('routine:dupliquer — id inconnu : ' + id);
    const copieRoutine = dupliquerModele(source, { nom });
    avertirSiInvalide(copieRoutine, 'modele');
    await idb.put(exigerDb(), 'modeles', copieRoutine);
    etat.modeles.set(copieRoutine.id, copieRoutine);
    return { modele: copieRoutine, routine: copieRoutine, source };
  },

  /**
   * Supprime une routine. SUPPRESSION DURE, et c'est délibéré.
   *
   * Une routine est une INTENTION, pas un fait : les séances déjà faites en portent une COPIE
   * INTÉGRALE dans `modeleSnapshot`, figée au lancement. Supprimer la routine ne retire donc
   * strictement rien à l'historique — le détail d'une séance de mars affichera toujours le
   * programme tel qu'il était en mars.
   *
   * ⚠ Un modèle LIVRÉ est refusé : il s'archive (commit 'modele:archiver'). Le supprimer ne
   *   servirait à rien de toute façon — mais surtout, l'archivage est réversible et la
   *   suppression ne l'est pas.
   */
  'routine:supprimer': async ({ id }) => {
    const m = etat.modeles.get(id);
    if (!m) throw new Error('routine:supprimer — id inconnu : ' + id);
    if (!suppressionDurePermise(m)) {
      throw new Error(
        'Ce modèle est livré avec l\'application : il ne se supprime pas, il s\'archive. ' +
        'Vous pouvez le retirer de l\'accueil en l\'archivant.'
      );
    }
    await idb.del(exigerDb(), 'modeles', id);
    etat.modeles.delete(id);
    return { id, modele: m, routine: m };
  },

  // ── Lieux ───────────────────────────────────────────────────────────────
  'lieu:enregistrer': async ({ lieu: l }) => {
    const copieL = copie(l);
    avertirSiInvalide(copieL, 'lieu');
    await idb.put(exigerDb(), 'lieux', copieL);
    etat.lieux.set(copieL.id, copieL);
    return { lieu: copieL };
  },

  'lieu:archiver': async ({ id, archived = true }) => {
    const l = etat.lieux.get(id);
    if (!l) throw new Error('lieu:archiver — id inconnu : ' + id);
    const maj = Object.assign(copie(l), { archived: archived === true });
    await idb.put(exigerDb(), 'lieux', maj);
    etat.lieux.set(maj.id, maj);
    return { lieu: maj };
  },

  // ── Poids de corps ──────────────────────────────────────────────────────
  // La date EST la clé primaire : une re-saisie du jour écrase, elle n'empile pas.
  'poids:enregistrer': async ({ poids }) => {
    const copieP = copie(poids);
    avertirSiInvalide(copieP, 'poids');
    await idb.put(exigerDb(), 'poids', copieP);
    return { poids: copieP };
  },

  // ── Séances ─────────────────────────────────────────────────────────────
  // ⚠ v2 : démarrer une séance n'exige PLUS qu'aucune autre ne soit en cours. Plusieurs séances
  // peuvent vivre en parallèle — un programme de force le matin et du cardio le soir sont deux
  // séances, pas une. Seul demeure un plafond, pour que l'accueil reste lisible.
  'seance:demarrer': async ({ seance: s }) => {
    const dejaOuverte = etat.seancesEnCoursIds.has(s.id);
    if (!dejaOuverte && etat.seancesEnCoursIds.size >= MAX_SEANCES_EN_COURS) {
      throw new Error(
        MAX_SEANCES_EN_COURS + ' séances sont déjà en cours. Terminez-en une ou abandonnez-la ' +
        'avant d\'en démarrer une autre.'
      );
    }
    const enregistree = await enregistrerSeance(s);
    etat.seancesEnCoursIds.add(enregistree.id);
    // La séance qu'on vient de démarrer est, par définition, la dernière touchée.
    etat.seanceActiveId = enregistree.id;
    // meta porte les ids des séances en cours pour que le démarrage suivant les retrouve SANS
    // charger tout l'historique.
    await ecrireEtatSeances();
    return { seance: enregistree };
  },

  // Désigne la séance sur laquelle porte l'écran de séance. N'écrit AUCUNE séance : changer de
  // séance active ne doit pas toucher à leur `updatedAt`, sinon basculer d'un onglet à l'autre
  // ferait croire à l'import « fusionner » que les deux ont été modifiées.
  'seance:activer': async ({ id }) => {
    const s = etat.seances.get(id) || (await idb.get(exigerDb(), 'seances', id));
    if (!estSeanceEnCours(s)) throw new Error('seance:activer — aucune séance en cours sous cet id : ' + id);
    etat.seances.set(s.id, s);
    etat.seancesEnCoursIds.add(s.id);
    etat.seanceActiveId = s.id;
    await ecrireEtatSeances();
    return { seance: s };
  },

  // Écriture durable d'une séance en cours. Appelée à chaque série validée : c'est le chemin
  // chaud de l'application. Le miroir chaud, lui, appartient à la vue — elle seule connaît le
  // brouillon et le volet ouvert, que ce module écraserait s'il écrivait le miroir lui-même.
  'seance:mettre-a-jour': async ({ seance: s }) => {
    const enregistree = await enregistrerSeance(s);
    // Filet : une séance en cours qui n'était pas encore dans la collection (reprise depuis le
    // miroir chaud, meta perdue) y entre ici. On ne réécrit meta QUE dans ce cas : ce commit est
    // appelé à chaque série validée, y ajouter une écriture meta systématique doublerait le coût
    // du chemin le plus chaud de l'application.
    if (estSeanceEnCours(enregistree) && !etat.seancesEnCoursIds.has(enregistree.id)) {
      etat.seancesEnCoursIds.add(enregistree.id);
      if (!etat.seanceActiveId) etat.seanceActiveId = enregistree.id;
      try { await ecrireEtatSeances(); } catch (err) { console.warn('[store] meta non mis à jour (reconstructible)', err); }
    }
    return { seance: enregistree };
  },

  'seance:terminer': async ({ seance: s, endedAt, retroactif = false }) => {
    const source = s || seanceActive();
    if (!source) throw new Error('seance:terminer — aucune séance à terminer.');

    // Clôture rétroactive : la fin est le dernier fait connu, pas l'instant où l'utilisateur
    // s'en aperçoit. Dater la fin de maintenant inventerait des heures d'entraînement.
    const fin = retroactif
      ? (dernierHorodatage(source) || source.startedAt || Date.now())
      : (endedAt || Date.now());

    const finale = copie(source);
    finale.statut = 'terminee';
    finale.endedAt = fin;
    finale.dureeSec = calculerDuree(finale, fin);
    finale.repos = null; // un repos en cours n'a plus de sens une fois la séance close

    const ecrite = await enregistrerSeance(finale);

    // ⚠ ORDRE NON NÉGOCIABLE : écrire, RELIRE ET VÉRIFIER, et seulement ensuite purger le
    // miroir chaud. C'est le moment de toute l'application où perdre la séance coûterait le
    // plus cher — une heure de salle déjà faite, non reproductible.
    await relireEtVerifier(ecrite);

    retirerDesEnCours(ecrite.id);
    purgerMiroirSiOrphelin(ecrite.id);

    // lastPerf et l'état des séances sont mis à jour APRÈS la purge, et leur échec ne remonte
    // pas : les deux sont reconstructibles (recalculerDerives, et le balayage de
    // chargerHistorique qui réadopte toute séance restée « en-cours »).
    try {
      etat.meta = Object.assign({}, etat.meta, { lastPerf: fusionnerLastPerf(etat.meta.lastPerf, ecrite) });
      await ecrireEtatSeances();
    } catch (err) {
      console.warn('[store] meta non mis à jour après la clôture (dérivé reconstructible)', err);
    }

    return { seance: ecrite, seancesEnCours: seancesEnCours() };
  },

  /**
   * Abandonner une séance en cours. CE N'EST PAS LA TERMINER.
   *
   * La séance est CONSERVÉE et reste visible dans l'historique, marquée comme abandonnée :
   * constater qu'on a lâché une séance est une information d'entraînement, la faire disparaître
   * serait effacer un fait. Mais elle n'entre dans AUCUN agrégat — ni courbe, ni tonnage, ni
   * record, ni rappel « Dernière fois ». C'est toute la différence avec 'terminee', et c'est la
   * raison pour laquelle lastPerf n'est PAS alimenté ici.
   *
   * La durée est calculée comme à la clôture : plafonnée à la dernière série + 10 min. Une
   * séance abandonnée l'est presque toujours en s'en apercevant plus tard.
   */
  'seance:abandonner': async ({ seance: s, id, at, motif = null }) => {
    const source = s || etat.seances.get(id) || (id ? await idb.get(exigerDb(), 'seances', id) : seanceActive());
    if (!source) throw new Error('seance:abandonner — aucune séance à abandonner.');
    if (!estSeanceEnCours(source)) {
      throw new Error('seance:abandonner — cette séance n\'est pas en cours (statut : ' + source.statut + ').');
    }

    // Comme pour la clôture rétroactive : la fin est le dernier fait connu si la séance ne
    // contient plus rien de plus récent, jamais l'instant où l'on clique.
    const fin = typeof at === 'number' ? at : (dernierHorodatage(source) || source.startedAt || Date.now());

    const finale = copie(source);
    finale.statut = 'abandonnee';
    finale.endedAt = fin;
    finale.dureeSec = calculerDuree(finale, fin);
    finale.repos = null;          // un repos en cours n'a plus de sens
    finale.motifAbandon = motif;  // facultatif, purement informatif

    const ecrite = await enregistrerSeance(finale);

    // Même séquence que la clôture, et pour la même raison : les séries déjà faites sont
    // conservées, donc leur perte serait ressentie exactement comme celle d'une séance terminée.
    await relireEtVerifier(ecrite);

    retirerDesEnCours(ecrite.id);
    purgerMiroirSiOrphelin(ecrite.id);

    try {
      await ecrireEtatSeances();
    } catch (err) {
      console.warn('[store] meta non mis à jour après l\'abandon (reconstructible)', err);
    }

    return { seance: ecrite, seancesEnCours: seancesEnCours() };
  },

  // Édition d'une séance déjà terminée (correction depuis le détail d'historique).
  'seance:modifier': async ({ seance: s }) => {
    const enregistree = await enregistrerSeance(s);
    if (enregistree.statut === 'terminee') {
      try {
        await ecrireMeta({ lastPerf: fusionnerLastPerf(etat.meta.lastPerf, enregistree) });
      } catch (err) {
        console.warn('[store] lastPerf non mis à jour après édition', err);
      }
    }
    return { seance: enregistree };
  },

  /**
   * Supprimer une séance — en cours, terminée ou abandonnée. SUPPRESSION DURE assumée.
   *
   * C'est la seule suppression dure d'un FAIT dans toute l'application, et elle est explicitement
   * demandée : une séance ouverte par erreur, ou une séance de test, n'a aucune raison de polluer
   * l'historique à vie. À la différence d'un exercice — que des séances de 2023 référencent et
   * dont la disparition rendrait leurs séries ininterprétables — une séance n'est référencée par
   * rien. La supprimer ne casse aucune lecture.
   */
  'seance:supprimer': async ({ id }) => {
    const supprimee = etat.seances.get(id) || null;
    await idb.del(exigerDb(), 'seances', id);
    etat.seances.delete(id);

    const etaitEnCours = etat.seancesEnCoursIds.has(id);
    if (etaitEnCours) {
      retirerDesEnCours(id);
      purgerMiroirSiOrphelin(id);
      await ecrireEtatSeances();
    }

    // lastPerf peut désormais pointer sur la séance supprimée. Il est reconstruit intégralement
    // plutôt que corrigé sur place : une correction partielle laisserait un rappel fantôme.
    // Une séance en cours ou abandonnée n'y a jamais contribué : rien à recalculer dans ce cas.
    // (`!supprimee` : séance absente de la mémoire — on ne peut pas conclure, on recalcule.)
    if (etat.historiqueCharge && (!supprimee || estSeanceComptable(supprimee))) {
      try { await recalculerDerives(); } catch (err) { console.warn('[store] recalcul après suppression impossible', err); }
    }
    return { id, seance: supprimee, seancesEnCours: seancesEnCours() };
  },

  // ── Résolution d'une reprise proposée (voir reprendreSeance) ────────────
  'seance:reprendre': async ({ id }) => {
    const s = etat.seances.get(id) || (await idb.get(exigerDb(), 'seances', id));
    if (!estSeanceEnCours(s)) throw new Error('seance:reprendre — aucune séance en cours sous cet id.');
    etat.seances.set(s.id, s);
    etat.seancesEnCoursIds.add(s.id);
    etat.seanceActiveId = s.id;
    await ecrireEtatSeances();
    return { seance: s };
  },

  // ── Divers ──────────────────────────────────────────────────────────────
  'meta:mettre-a-jour': async (patch) => {
    const maj = await ecrireMeta(patch || {});
    return { meta: maj };
  },

  'export:effectue': async ({ at }) => {
    const maj = await ecrireMeta({ dernierExportAt: typeof at === 'number' ? at : Date.now() });
    return { meta: maj };
  }
};

/**
 * Unique porte d'écriture du store : mute l'état mémoire, persiste, puis notifie sur le bus.
 *
 * L'événement porte le type du commit lui-même : une vue qui veut réagir à
 * `commit('seance:terminer', …)` s'abonne à `bus.on('seance:terminer', …)`. Aucun appel direct
 * d'une couche basse vers une vue — c'est ce qui rend l'ordre de montage des vues indifférent.
 *
 * @param {string} type
 * @param {object} payload
 * @returns {Promise<object>}
 */
export async function commit(type, payload) {
  const operation = OPERATIONS[type];
  if (!operation) throw new Error('store.commit — type inconnu : « ' + type + ' »');

  const resultat = await operation(payload || {});

  bus.emit(type, resultat);
  // Événement fourre-tout pour les abonnés génériques (indicateur de sauvegarde, journal de
  // débogage). Émis APRÈS le type précis : un abonné spécifique doit voir l'état avant lui.
  bus.emit('store:commit', { type, resultat });

  return resultat;
}

export function typesDeCommit() {
  return Object.keys(OPERATIONS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reprise après fermeture
// ─────────────────────────────────────────────────────────────────────────────

// Fait le plus récent connu d'une séance : dernière série validée, sinon la date d'écriture.
function derniereActivite(s) {
  return dernierHorodatage(s) || s.updatedAt || s.startedAt || 0;
}

/**
 * Décide quoi faire d'une séance restée ouverte.
 *
 * IndexedDB fait autorité, SAUF si le miroir chaud est plus récent — c'est-à-dire si son
 * `lastTouch` dépasse le `updatedAt` de la séance en base. Cette fenêtre existe réellement :
 * la vue écrit le miroir de façon synchrone à chaque frappe, IndexedDB est asynchrone et peut
 * être tuée entre les deux. Le miroir est un CACHE, mais dans cette fenêtre précise il est le
 * seul témoin de la dernière série faite.
 *
 * Sous 6 h : reprise silencieuse — poser une question à quelqu'un qui reprend sa séance après
 * être allé boire est un tap gratuit et une inquiétude gratuite.
 * Au-delà : on ne décide pas à la place de l'utilisateur, on lui rend un signal.
 *
 * @param {object|null} chaud contenu de localStorage['muscu:hot'] : { seanceId, seance, lastTouch, … }
 * @returns {Promise<{etat:'aucune'}
 *                  | {etat:'reprise', seance:object, source:'idb'|'chaud'}
 *                  | {etat:'choix', seance:object, source:'idb'|'chaud', ageMs:number, actions:string[]}>}
 */
export async function reprendreSeance(chaud) {
  const candidats = [];

  // Candidats IndexedDB : TOUTE la collection chargée par initialiser(). En v1 il n'y en avait
  // qu'un ; le plus récemment touché reste celui qu'on propose de reprendre, les autres restent
  // listés par seancesEnCours() et accessibles depuis l'accueil.
  const ouvertes = seancesEnCours();
  if (!ouvertes.length && etat.meta && etat.meta.seanceActiveId) {
    // Reprise appelée seule, sans initialiser() : on relit l'id connu de meta.
    const relue = await idb.get(exigerDb(), 'seances', etat.meta.seanceActiveId);
    if (estSeanceEnCours(relue)) ouvertes.push(relue);
  }
  for (const s of ouvertes) {
    candidats.push({ source: 'idb', seance: s, touche: s.updatedAt || 0 });
  }

  // Candidat miroir chaud.
  const duChaud = chaud && chaud.seance && chaud.seance.statut === 'en-cours' ? chaud.seance : null;
  if (duChaud) {
    candidats.push({ source: 'chaud', seance: duChaud, touche: chaud.lastTouch || duChaud.updatedAt || 0 });
  }

  if (!candidats.length) {
    // Miroir orphelin (séance déjà terminée sur un autre onglet) : on le nettoie, sinon il
    // reproposerait la même reprise à chaque démarrage.
    if (chaud) purgerMiroir();
    return { etat: 'aucune' };
  }

  // Le plus récemment touché gagne. À égalité stricte, IndexedDB — parce qu'il est durable.
  candidats.sort((a, b) => (b.touche - a.touche) || (a.source === 'idb' ? -1 : 1));
  const retenu = candidats[0];
  const s = retenu.seance;

  // Le miroir a gagné : on referme la fenêtre immédiatement en le rendant durable, avant même
  // de savoir si l'utilisateur reprendra. Laisser la seule copie en localStorage, c'est la
  // laisser à la merci de la prochaine éviction de stockage.
  let retenue = s;
  if (retenu.source === 'chaud') {
    try {
      // enregistrerSeance renvoie la copie réellement écrite (updatedAt rafraîchi) : c'est elle
      // qui doit peupler l'état, sinon mémoire et base divergent dès la première lecture.
      retenue = await enregistrerSeance(s);
    } catch (err) {
      console.error('[store] la séance du miroir chaud n\'a pas pu être rendue durable', err);
    }
  }
  etat.seances.set(retenue.id, retenue);

  const ageMs = Date.now() - derniereActivite(retenue);

  // Nombre de séances ouvertes AUTRES que celle proposée : l'accueil en a besoin pour dire
  // « et 2 autres séances en cours » plutôt que de laisser croire qu'il n'y en a qu'une.
  const autres = seancesEnCours().filter((x) => x.id !== retenue.id).length;

  if (ageMs <= SEUIL_REPRISE_SILENCIEUSE_MS) {
    etat.seancesEnCoursIds.add(retenue.id);
    etat.seanceActiveId = retenue.id;
    try { await ecrireEtatSeances(); } catch (err) { console.warn('[store] meta non mis à jour à la reprise', err); }
    bus.emit('seance:reprise', { seance: retenue, source: retenu.source, autres });
    return { etat: 'reprise', seance: retenue, source: retenu.source, autres };
  }

  // ⚠ On ne marque PAS la séance active ici : tant que l'utilisateur n'a pas tranché, l'accueil
  // ne doit pas proposer « Reprendre » comme si de rien n'était. Les quatre actions se résolvent
  // par commit('seance:reprendre' | 'seance:terminer' avec retroactif:true | 'seance:abandonner'
  // | 'seance:supprimer').
  const signal = {
    etat: 'choix',
    seance: retenue,
    source: retenu.source,
    ageMs,
    autres,
    actions: ['reprendre', 'cloturer', 'abandonner', 'supprimer']
  };
  bus.emit('seance:choix-reprise', signal);
  return signal;
}

// Exposé pour tests.html et pour l'écran de secours : rien d'autre ne doit y toucher.
export const _interne = { etat, SEUIL_REPRISE_SILENCIEUSE_MS, MAX_SEANCES_EN_COURS };
