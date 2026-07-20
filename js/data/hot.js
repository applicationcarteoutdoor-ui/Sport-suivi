// data/hot.js — miroir localStorage de la seance active.
//
// ⚠ CE MODULE EST UN CACHE DE REPRISE, JAMAIS LA SOURCE DE VERITE.
//   IndexedDB fait autorite. Le contenu de 'muscu:hot' peut etre efface a tout instant — par le
//   navigateur sous pression memoire, par l'utilisateur, par un quota depasse — SANS AUCUNE perte
//   de correction : tout ce qui a ete valide est deja dans IDB. Ce miroir n'existe que pour deux
//   choses, et rien d'autre :
//     1. peindre l'ecran de seance AVANT que l'ouverture d'IDB n'ait abouti (lecture synchrone) ;
//     2. survivre a un IDB mort ou bloque, pour que l'ecran de secours puisse encore EXPORTER.
//   Corollaire de conception : aucun code ne doit jamais LIRE ce miroir pour decider d'un calcul.
//   La reprise (boot.js) le compare a IDB et ne le prefere que si `lastTouch > seance.updatedAt`.
//
// CADENCE D'ECRITURE — c'est ici que se joue la fluidite de la saisie en salle :
//   · a chaque serie validee            -> ecrire()          (synchrone, immediat)
//   · pendant l'edition (steppers)      -> ecrireDifferee()  (au plus une fois par frame)
//   · sur pagehide / visibilitychange   -> installerFilets() (ecriture forcee)
//   Un appui long sur un stepper emet ~16 changements par seconde. Appeler ecrire() a chaque cran
//   ferait 16 JSON.stringify BLOQUANTS par seconde sur l'objet seance entier : le bouton
//   deviendrait poissseux exactement au moment ou l'utilisateur regle sa charge.

import { CLES } from '../config.js';
import { emit } from '../lib/bus.js';

// Dernier etat CONNU de la seance active. Conserve en memoire pour que les filets (pagehide)
// puissent forcer une ecriture meme si aucune ecriture differee n'est en attente : un filet qui
// n'ecrit que « s'il reste quelque chose a ecrire » n'est pas un filet.
let dernierEtat = null;

// Ecriture differee en attente de la prochaine frame.
let enAttente = null;
let frameDemandee = 0;

// Filets deja poses : installerFilets() est idempotent, boot.js et la vue seance peuvent
// tous deux l'appeler sans empiler deux jeux d'ecouteurs.
let filetsPoses = false;

/**
 * Planifie un travail a la prochaine frame.
 * requestAnimationFrame est GELE en arriere-plan sur mobile : une ecriture differee planifiee
 * juste avant que l'onglet passe en fond ne partirait jamais. C'est precisement pour cela que
 * les filets (pagehide / visibilitychange) ecrivent `dernierEtat` de force et non `enAttente`.
 */
function planifier(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return setTimeout(fn, 16);
}

function annulerPlanification(jeton) {
  if (!jeton) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(jeton);
  else clearTimeout(jeton);
}

/** Compose la charge utile persistee. Forme figee : { seanceId, seance, brouillon, entryOuvert, lastTouch }. */
function composer(seance, brouillon, ctx) {
  const c = ctx || {};
  return {
    seanceId: (seance && seance.id) || null,
    seance: seance || null,
    // Le brouillon est la serie EN COURS de saisie, pas encore validee : c'est la seule donnee
    // du miroir qui n'existe nulle part ailleurs, et donc la seule que la reprise fait gagner.
    brouillon: c.brouillon !== undefined ? c.brouillon : (brouillon || null),
    entryOuvert: c.entryOuvert !== undefined ? c.entryOuvert : null,
    lastTouch: Date.now()
  };
}

/**
 * Ecrit le miroir immediatement.
 * A appeler a CHAQUE serie validee : c'est le seul instant ou une perte serait ressentie comme
 * une perte de donnees par l'utilisateur.
 *
 * @param {Object|null} seance seance active ; null purge le miroir
 * @param {Object|null} [brouillon] serie en cours de saisie, non validee
 * @param {{ entryOuvert?: string|null, brouillon?: Object|null }} [ctx]
 * @returns {boolean} false si l'ecriture a echoue (quota depasse, stockage indisponible)
 */
export function ecrire(seance, brouillon, ctx) {
  // Plus de seance active : le miroir n'a plus rien a refleter.
  if (!seance) { purger(); return true; }

  const charge = composer(seance, brouillon, ctx);
  dernierEtat = charge;

  // Une ecriture immediate rend caduque toute ecriture differee encore en attente.
  enAttente = null;

  try {
    localStorage.setItem(CLES.hot, JSON.stringify(charge));
    return true;
  } catch (err) {
    // ⚠ try/catch OBLIGATOIRE. setItem leve dans au moins trois situations bien reelles :
    //   QuotaExceededError (quota d'origine sature, souvent par UNE AUTRE application du meme
    //   compte github.io), navigation privee WebKit (quota nul), stockage desactive.
    //   On PURGE alors la cle : garder un miroir a moitie ecrit ou perime serait pire que rien,
    //   puisque la reprise pourrait le preferer a IDB sur la foi d'un lastTouch ancien.
    //   Le bus previent la couche UI, qui peut inviter a exporter — la seance elle-meme n'est
    //   pas menacee, seule la reprise apres coupure l'est.
    try { localStorage.removeItem(CLES.hot); } catch (_) { /* stockage inaccessible : rien a faire */ }
    emit('hot:quota', { erreur: err, nom: (err && err.name) || 'inconnu' });
    return false;
  }
}

/**
 * Ecrit le miroir au plus une fois par frame.
 * A appeler pendant l'edition continue (steppers, appui long) : les appels intermediaires sont
 * ecrases, seul le dernier etat de la frame est serialise.
 *
 * Mêmes arguments que `ecrire`. Ne renvoie rien : le resultat de l'ecriture n'est pas encore
 * connu au moment de l'appel. En cas de quota, l'evenement 'hot:quota' est emis comme d'habitude.
 */
export function ecrireDifferee(seance, brouillon, ctx) {
  if (!seance) { purger(); return; }

  enAttente = { seance, brouillon, ctx };
  // Memorise l'etat des maintenant : si la page disparait avant la frame, le filet ecrira
  // quand meme la derniere valeur connue.
  dernierEtat = composer(seance, brouillon, ctx);

  if (frameDemandee) return;
  frameDemandee = planifier(() => {
    frameDemandee = 0;
    if (!enAttente) return;
    const { seance: s, brouillon: b, ctx: c } = enAttente;
    ecrire(s, b, c);
  });
}

/**
 * Lit le miroir.
 * @returns {Object|null} { seanceId, seance, brouillon, entryOuvert, lastTouch } ou null
 */
export function lire() {
  let brut;
  try {
    brut = localStorage.getItem(CLES.hot);
  } catch (_) {
    // Stockage inaccessible : le miroir est optionnel, l'amorcage continue sans lui.
    return null;
  }
  if (!brut) return null;

  try {
    const charge = JSON.parse(brut);
    // Un miroir sans seance n'a aucune valeur de reprise : on le traite comme absent plutot que
    // de laisser boot.js manipuler un objet a moitie forme.
    if (!charge || typeof charge !== 'object' || !charge.seance) return null;
    return charge;
  } catch (_) {
    // JSON tronque : cela arrive reellement quand la page meurt PENDANT setItem sur certains
    // moteurs. C'est un cache : on l'efface sans etat d'ame et sans alerter l'utilisateur.
    try { localStorage.removeItem(CLES.hot); } catch (__) { /* rien a faire */ }
    return null;
  }
}

/** Efface le miroir. Sans aucune consequence sur les donnees : IDB reste la source de verite. */
export function purger() {
  dernierEtat = null;
  enAttente = null;
  annulerPlanification(frameDemandee);
  frameDemandee = 0;
  try { localStorage.removeItem(CLES.hot); } catch (_) { /* rien a faire */ }
}

/**
 * Pose les filets de sauvegarde : ecriture FORCEE quand la page peut disparaitre.
 * Idempotent.
 * @returns {() => void} retrait des filets
 */
export function installerFilets() {
  if (filetsPoses) return () => {};
  filetsPoses = true;

  const forcer = () => {
    if (!dernierEtat) return;
    // Ecriture SYNCHRONE et inconditionnelle. On ne teste pas `enAttente` : la frame planifiee
    // par ecrireDifferee peut avoir ete gelee par le passage en arriere-plan, auquel cas
    // « rien en attente » ne signifie surtout pas « tout est ecrit ».
    enAttente = null;
    try {
      localStorage.setItem(CLES.hot, JSON.stringify({ ...dernierEtat, lastTouch: Date.now() }));
    } catch (err) {
      try { localStorage.removeItem(CLES.hot); } catch (_) { /* rien a faire */ }
      // Pas d'emit ici : sur pagehide, plus aucun abonne n'a le temps de reagir, et un toast
      // affiche sur une page en train de mourir ne serait jamais vu.
    }
  };

  const surVisibilite = () => { if (document.visibilityState === 'hidden') forcer(); };

  // ⚠ pagehide et visibilitychange, PAS beforeunload/unload : sur iOS et Android, une
  //   application mise en arriere-plan puis tuee par le systeme n'emet JAMAIS unload.
  //   pagehide couvre la mise en bfcache, visibilitychange couvre le passage en fond — c'est le
  //   dernier instant ou du JavaScript s'execute encore de facon garantie.
  window.addEventListener('pagehide', forcer);
  document.addEventListener('visibilitychange', surVisibilite);
  // 'freeze' (Chrome) precede le gel complet de l'onglet : dernier rappel avant silence total.
  window.addEventListener('freeze', forcer);

  return () => {
    window.removeEventListener('pagehide', forcer);
    document.removeEventListener('visibilitychange', surVisibilite);
    window.removeEventListener('freeze', forcer);
    filetsPoses = false;
  };
}
