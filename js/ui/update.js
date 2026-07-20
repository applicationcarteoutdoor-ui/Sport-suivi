// ui/update.js — protocole de mise a jour cote client.
//
// Deux chemins, et le second est le cas NORMAL :
//   · Cas A — sw.js lui-meme a change (rare). Le navigateur installe un nouveau worker, qui reste
//     en attente. On propose le rechargement, et le clic envoie SKIP_WAITING.
//   · Cas B — seuls des assets ont change (le cas normal : corriger views/seance.js ne touche pas
//     sw.js d'un octet). Rien ne serait detecte par le navigateur. C'est ./version.json, relu en
//     no-store, qui porte la verite : on compare a APP_VERSION, on demande PRECACHE au worker, on
//     attend PRECACHE_OK, on propose, et le clic envoie ACTIVER puis recharge.
//
// ⚠ REGLE PRODUIT QUI PRIME SUR TOUT : le bandeau n'est JAMAIS affiche tant qu'une seance est
//   active. La proposition est MISE EN FILE jusqu'a la cloture. Interrompre quelqu'un entre deux
//   series pour lui parler de version est le meilleur moyen de lui faire perdre sa saisie.
// ⚠ Et il n'y a JAMAIS de rechargement automatique, dans aucun cas.
//
// Le bandeau est le noeud de la zone A deja present dans index.html : on ne fait que muter son
// textContent, son attribut hidden et son data-ouvert. Il n'est jamais recree.

import { APP_VERSION } from '../config.js';
import * as bus from '../lib/bus.js';
import * as store from '../data/store.js';
import { on } from '../lib/dom.js';

// Throttle : une verification au plus toutes les 15 minutes hors appel force. Sans lui, chaque
// retour au premier plan (soit des dizaines de fois par seance) declencherait une requete reseau.
const INTERVALLE_CONTROLE_MS = 15 * 60 * 1000;

// Delai de garde apres ACTIVER : si ACTIVE_OK ne revient pas (worker tue entre-temps), on recharge
// quand meme. Legitime, car le rechargement a deja ete demande par un clic de l'utilisateur.
const DELAI_ACTIVE_MS = 4000;

// Duree de la transition du bandeau (voir .bandeau-maj dans css/components.css). On attend qu'elle
// soit finie avant de reposer `hidden`, sinon le bandeau disparaitrait d'un coup.
const DELAI_FERMETURE_MS = 260;

const etat = {
  initialise: false,
  registration: null,
  dernierControle: 0,
  // Proposition en attente : { texte, appliquer }. Survit a une seance active, c'est tout l'objet
  // de la mise en file.
  proposition: null,
  bandeauOuvert: false,
  // Version deja precachee avec succes : evite un second PRECACHE complet si l'utilisateur a
  // repousse la proposition puis rouvert l'application.
  versionPrecachee: null,
  // Version dont le PRECACHE est en cours, pour ignorer un PRECACHE_OK obsolete.
  versionEnCours: null,
  // ⚠ Arme UNIQUEMENT au clic sur « Recharger ». Un simple booleen `refreshing` pose a l'init ne
  //   protegerait PAS du rechargement parasite : a la toute premiere visite, clients.claim() emet
  //   un controllerchange alors que l'utilisateur n'a rien demande, et la page se rechargerait
  //   toute seule sous ses yeux.
  rechargementDemande: false,
  minuterieFermeture: null
};

// ─────────────────────────────────────────────────────────────────────────────
// Acces aux noeuds de la coquille (zone A)
// ─────────────────────────────────────────────────────────────────────────────

const noeud = (id) => document.getElementById(id);

function noeuds() {
  return {
    bandeau: noeud('bandeau-maj'),
    texte: noeud('bandeau-maj-texte'),
    recharger: noeud('btn-maj-recharger'),
    plusTard: noeud('btn-maj-plus-tard')
  };
}

/** true si une seance est en cours. Enveloppe : store peut ne pas etre initialise (amorcage
 *  partiel, ecran de secours) et cette fonction ne doit jamais faire echouer l'appelant. */
function seanceEnCours() {
  try {
    return !!store.seanceActive();
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bandeau — mutations ciblees, jamais de reconstruction
// ─────────────────────────────────────────────────────────────────────────────

function ouvrirBandeau(texte) {
  const n = noeuds();
  if (!n.bandeau) return;
  if (etat.minuterieFermeture) { clearTimeout(etat.minuterieFermeture); etat.minuterieFermeture = null; }
  if (n.texte && texte) n.texte.textContent = texte;
  n.bandeau.hidden = false;
  etat.bandeauOuvert = true;
  // ⚠ Meme correction que dans sheet.js et keypad.js : l'attribut d'ouverture ne peut pas etre
  // pose dans un requestAnimationFrame, qui ne s'execute pas quand la page n'est pas rendue.
  // Le bandeau annoncant une mise a jour resterait invisible alors qu'il occupe la place.
  // Le reflow force donne au navigateur l'etat de depart de la transition, sans dependre
  // d'une frame de rendu.
  void n.bandeau.offsetHeight;
  n.bandeau.setAttribute('data-ouvert', 'oui');
}

function fermerBandeau() {
  const n = noeuds();
  if (!n.bandeau) return;
  etat.bandeauOuvert = false;
  n.bandeau.removeAttribute('data-ouvert');
  if (etat.minuterieFermeture) clearTimeout(etat.minuterieFermeture);
  etat.minuterieFermeture = setTimeout(() => {
    etat.minuterieFermeture = null;
    if (!etat.bandeauOuvert) n.bandeau.hidden = true;
  }, DELAI_FERMETURE_MS);
}

/**
 * Met une proposition en file et l'affiche si le moment est opportun.
 * @param {string} texte libelle affiche dans le bandeau
 * @param {() => void} appliquer action executee au clic sur « Recharger »
 */
function proposerRechargement(texte, appliquer) {
  etat.proposition = { texte, appliquer };
  bus.emit('maj:disponible', { texte });
  vidangerFile();
}

/** Affiche la proposition en attente si aucune seance n'est active. Appelee a chaque commit du
 *  store : la cloture d'une seance est donc suivie de l'affichage, sans qu'update.js ait a
 *  connaitre le nom de l'evenement de cloture. */
function vidangerFile() {
  if (!etat.proposition) return;
  if (seanceEnCours()) {
    // Une seance a demarre pendant que le bandeau etait affiche : on le retire SANS jeter la
    // proposition, qui ressortira a la cloture.
    if (etat.bandeauOuvert) fermerBandeau();
    return;
  }
  if (etat.bandeauOuvert) return;
  ouvrirBandeau(etat.proposition.texte);
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions du bandeau
// ─────────────────────────────────────────────────────────────────────────────

function surRecharger() {
  const proposition = etat.proposition;
  if (!proposition) { fermerBandeau(); return; }
  // ⚠ C'EST ICI, et nulle part ailleurs, que le rechargement devient legitime.
  etat.rechargementDemande = true;
  const n = noeuds();
  if (n.texte) n.texte.textContent = 'Mise à jour en cours…';
  if (n.recharger) n.recharger.disabled = true;
  if (n.plusTard) n.plusTard.disabled = true;
  try {
    proposition.appliquer();
  } catch (err) {
    console.warn('[update] application de la mise a jour impossible', err);
    recharger();
  }
}

function surPlusTard() {
  // La proposition est abandonnee pour cette session d'affichage. La prochaine verification la
  // reproduira instantanement : versionPrecachee evite de tout re-telecharger.
  etat.proposition = null;
  fermerBandeau();
  bus.emit('maj:reportee', {});
}

function recharger() {
  if (!etat.rechargementDemande) return; // garde-fou : aucun reload qui ne vienne d'un clic
  location.reload();
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages du service worker
// ─────────────────────────────────────────────────────────────────────────────

function surMessageSW(ev) {
  const m = (ev && ev.data) || {};

  if (m.type === 'PRECACHE_OK') {
    if (etat.versionEnCours && m.version !== etat.versionEnCours) return; // reponse obsolete
    etat.versionPrecachee = m.version || etat.versionEnCours;
    etat.versionEnCours = null;
    const version = etat.versionPrecachee;
    proposerRechargement('Une nouvelle version est prête.', () => {
      const sw = travailleur();
      if (!sw) { recharger(); return; }
      sw.postMessage({ type: 'ACTIVER', version });
      // Delai de garde : un worker peut etre tue avant de repondre ACTIVE_OK.
      setTimeout(recharger, DELAI_ACTIVE_MS);
    });
    return;
  }

  if (m.type === 'PRECACHE_KO') {
    // Echec SILENCIEUX cote utilisateur : hors-ligne ou asset manquant, l'application courante
    // fonctionne parfaitement. On garde la trace en console pour le diagnostic.
    console.warn('[update] precache refuse :', m.message);
    etat.versionEnCours = null;
    return;
  }

  if (m.type === 'ACTIVE_OK') { recharger(); return; }

  if (m.type === 'ACTIVE_KO') {
    console.warn('[update] activation refusee :', m.message);
    recharger(); // le clic a eu lieu : on recharge, le reseau prendra le relais
    return;
  }

  if (m.type === 'KILL_OK') {
    proposerRechargement(
      'Cette version a été désactivée. Recharge pour récupérer la dernière.',
      () => recharger()
    );
  }
}

/** Le worker a qui parler : celui qui controle la page, sinon celui de l'enregistrement. */
function travailleur() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }
  const reg = etat.registration;
  return (reg && (reg.active || reg.waiting)) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cas A — sw.js lui-meme a change
// ─────────────────────────────────────────────────────────────────────────────

function proposerBascule(reg) {
  proposerRechargement('Une nouvelle version est prête.', () => {
    const attente = reg.waiting;
    if (!attente) { recharger(); return; }
    // SKIP_WAITING fait basculer le worker, ce qui emet controllerchange — et c'est LA que le
    // rechargement se produit, parce que le drapeau a ete arme par le clic.
    attente.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(recharger, DELAI_ACTIVE_MS);
  });
}

function surveillerRegistration(reg) {
  etat.registration = reg;
  if (!reg) return;

  // Un worker peut deja attendre : mise a jour installee lors d'une visite precedente, page
  // fermee avant la proposition. controller non nul distingue bien une MISE A JOUR d'une
  // premiere installation.
  if (reg.waiting && navigator.serviceWorker.controller) proposerBascule(reg);

  reg.addEventListener('updatefound', () => {
    const nouveau = reg.installing;
    if (!nouveau) return;
    nouveau.addEventListener('statechange', () => {
      // ⚠ La condition sur controller est la seule qui distingue une mise a jour d'une PREMIERE
      //   installation. Sans elle, tout nouvel utilisateur se verrait proposer de recharger une
      //   application qu'il vient d'ouvrir pour la premiere fois.
      if (nouveau.state === 'installed' && navigator.serviceWorker.controller) proposerBascule(reg);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cas B — seuls des assets ont change
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifie la disponibilite d'une nouvelle version.
 * Ne rejette JAMAIS : hors-ligne, l'application revient au premier plan des dizaines de fois par
 * seance et un rejet non gere serait produit a chaque fois.
 *
 * @param {{force?: boolean}} [options] force ignore le throttle de 15 minutes
 * @returns {Promise<'ignoree'|'a-jour'|'kill'|'precache'|'indisponible'|'erreur'>}
 */
export async function verifier(options) {
  const force = !!(options && options.force);
  if (!('serviceWorker' in navigator)) return 'indisponible';

  const maintenant = Date.now();
  if (!force && maintenant - etat.dernierControle < INTERVALLE_CONTROLE_MS) return 'ignoree';
  etat.dernierControle = maintenant;

  // Deja precachee et refusee : on repropose sans rien retelecharger.
  if (etat.versionPrecachee && etat.versionPrecachee !== APP_VERSION && !etat.proposition) {
    const version = etat.versionPrecachee;
    proposerRechargement('Une nouvelle version est prête.', () => {
      const sw = travailleur();
      if (!sw) { recharger(); return; }
      sw.postMessage({ type: 'ACTIVER', version });
      setTimeout(recharger, DELAI_ACTIVE_MS);
    });
    return 'precache';
  }

  try {
    // ⚠ no-store obligatoire : GitHub Pages sert tout en max-age=600. Depuis le cache HTTP, ce
    //   fichier annoncerait sa propre version pendant dix minutes de plus — et le kill switch,
    //   qui est la seule porte de sortie d'une version cassee, serait injoignable.
    const reponse = await fetch('./version.json', { cache: 'no-store' });
    if (!reponse.ok) throw new Error('version.json HTTP ' + reponse.status);
    const manifeste = await reponse.json();

    // Kill switch : prioritaire sur tout le reste. Purge les caches et desenregistre le worker,
    // ce qui rend la main au reseau.
    if (manifeste && manifeste.kill) {
      const sw = travailleur();
      if (sw) sw.postMessage({ type: 'KILL' });
      return 'kill';
    }

    if (!manifeste || !manifeste.version) return 'erreur';
    if (manifeste.version === APP_VERSION) return 'a-jour';
    if (manifeste.version === etat.versionEnCours) return 'precache'; // deja en cours

    const sw = travailleur();
    if (!sw) {
      // Aucun worker joignable (premiere visite, enregistrement refuse) : rien a precacher, mais
      // la proposition reste legitime — le rechargement ira chercher les fichiers sur le reseau.
      proposerRechargement('Une nouvelle version est disponible.', () => recharger());
      return 'indisponible';
    }

    etat.versionEnCours = manifeste.version;
    // Le worker precache EN TACHE DE FOND, sans rien basculer. La bascule reste la decision de
    // l'utilisateur : servir une coquille v2 a du code v1 deja charge donnerait des modules ES
    // incoherents et des 404 sur des fichiers disparus.
    sw.postMessage({ type: 'PRECACHE', manifest: manifeste });
    return 'precache';
  } catch (err) {
    // .catch SILENCIEUX : hors-ligne, c'est le fonctionnement nominal.
    console.debug('[update] verification impossible', err && err.message);
    return 'erreur';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branche le protocole complet. Idempotente : plusieurs appels (accueil, reglages) sont sans effet.
 * L'enregistrement du worker lui-meme reste le tout premier geste de boot.js.
 */
export function initialiser() {
  if (etat.initialise) return;
  etat.initialise = true;

  const n = noeuds();
  if (n.recharger) on(n.recharger, 'click', surRecharger);
  if (n.plusTard) on(n.plusTard, 'click', surPlusTard);

  // La cloture d'une seance passe forcement par un commit du store : on n'a donc pas besoin de
  // connaitre le nom de l'evenement de cloture pour vidanger la file au bon moment.
  bus.on('store:commit', vidanger);
  bus.on('seance:reprise', vidanger);
  bus.on('app:prete', vidanger);

  if (!('serviceWorker' in navigator)) return;

  on(navigator.serviceWorker, 'message', surMessageSW);

  on(navigator.serviceWorker, 'controllerchange', () => {
    // ⚠ Sans le drapeau, ce gestionnaire rechargerait la page a la toute premiere visite : le
    //   clients.claim() du worker fraichement active emet exactement le meme evenement.
    if (etat.rechargementDemande) location.reload();
  });

  navigator.serviceWorker.getRegistration('./')
    .then((reg) => {
      if (reg) surveillerRegistration(reg);
      else return navigator.serviceWorker.ready.then(surveillerRegistration);
      return null;
    })
    .catch(() => { /* enregistrement inaccessible : l'application fonctionne sans mise a jour */ });

  // Premiere verification differee : l'amorcage a mieux a faire que de negocier le reseau pendant
  // que le premier ecran se peint.
  setTimeout(() => { verifier({}); }, 3000);

  // Retour au premier plan : le moment ou une version deployee entre-temps doit etre vue. Le
  // throttle de 15 minutes empeche que ce soit couteux.
  on(document, 'visibilitychange', () => {
    if (!document.hidden) verifier({});
  });
  // bfcache : pageshow persisted ne redeclenche aucun code de module.
  on(window, 'pageshow', () => { verifier({}); });
}

function vidanger() { vidangerFile(); }

/** Etat interne, pour tests.html et diagnostic. Aucune vue ne doit en dependre. */
export const _interne = { etat, INTERVALLE_CONTROLE_MS };
