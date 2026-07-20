// ui/install.js — aide a l'installation, NON BLOQUANTE.
//
// L'installation n'est pas un prealable : l'application fonctionne dans l'onglet. Elle n'est
// qu'une amelioration (icone, plein ecran, et surtout durabilite du stockage). Tout ce module
// suit donc une seule regle : ne jamais barrer la route.
//
// Deux plateformes, deux mecanismes irreconciliables :
//   · Android/Chrome emet `beforeinstallprompt`. On l'intercepte, on le met de cote, et on le
//     rejoue derriere un bouton — l'evenement natif ne peut etre rejoue qu'UNE fois.
//   · iOS n'a aucune API : l'installation passe par « Partager » puis « Sur l'écran d'accueil ».
//     La seule chose possible est une aide textuelle, servie par la route #/aide/installation.

import { NS } from '../config.js';
import * as bus from '../lib/bus.js';
import { h, on } from '../lib/dom.js';

// Refus memorise ici et non dans data/prefs.js : ce n'est pas une preference reglable, et
// prefs.ecrire() filtre justement les cles absentes de PREFS_DEFAUT.
const CLE_REFUS = NS + ':install';

// Un refus n'est pas definitif : quelqu'un qui decline en juillet peut vouloir installer en
// septembre, une fois convaincu. On se tait trente jours, pas pour toujours.
const DUREE_REFUS_MS = 30 * 24 * 60 * 60 * 1000;

const etat = {
  initialise: false,
  /** Evenement beforeinstallprompt mis de cote. Consommable UNE seule fois. */
  invite: null,
  installee: false
};

// ─────────────────────────────────────────────────────────────────────────────
// Detection de plateforme
// ─────────────────────────────────────────────────────────────────────────────

/**
 * true si l'application tourne deja en mode installe.
 * Deux canaux, aucun ne couvre les deux plateformes : `display-mode` est le standard, ignore par
 * Safari, et `navigator.standalone` est la propriete proprietaire d'iOS.
 * ⚠ navigator.standalone ne passe a true que si <meta name="apple-mobile-web-app-capable"> est
 *   present dans index.html — il l'est, et le retirer casserait toute cette detection.
 * @returns {boolean}
 */
export function estStandalone() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    // Android peut lancer une PWA installee en mode fenetre : le manifeste declare
    // display_override:["standalone","browser"], donc ce cas existe reellement.
    if (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
  } catch (_) { /* matchMedia absent : on retombe sur navigator.standalone */ }
  return navigator.standalone === true;
}

/**
 * true sur iPhone, iPod et iPad, y compris iPadOS recent.
 * ⚠ Depuis iPadOS 13, un iPad s'annonce comme un Macintosh dans son user agent : le seul signal
 *   qui les distingue est le tactile. Un Mac de bureau expose maxTouchPoints === 0 ; un iPad en
 *   expose 5. D'ou le croisement, sans lequel tous les iPad seraient prives de l'aide.
 * @returns {boolean}
 */
export function estIOS() {
  const ua = navigator.userAgent || '';
  // window.MSStream : ancien Windows Phone, qui incluait « iPhone » dans son user agent.
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return true;
  return /Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memoire du refus
// ─────────────────────────────────────────────────────────────────────────────

function refusRecent() {
  try {
    const brut = localStorage.getItem(CLE_REFUS);
    if (!brut) return false;
    const donnees = JSON.parse(brut);
    if (donnees && donnees.installee) return true;
    if (!donnees || !donnees.refuseAt) return false;
    return Date.now() - donnees.refuseAt < DUREE_REFUS_MS;
  } catch (_) {
    // Stockage indisponible (navigation privee) : on ne se souvient de rien, ce qui est le
    // comportement le moins genant — l'aide reste refermable a chaque fois.
    return false;
  }
}

function memoriser(donnees) {
  try { localStorage.setItem(CLE_REFUS, JSON.stringify(donnees)); }
  catch (_) { /* quota ou stockage refuse : sans consequence */ }
}

/** Repousse la proposition de trente jours. Appelee par le bouton « Plus tard » du bandeau. */
export function refuser() {
  memoriser({ refuseAt: Date.now() });
  bus.emit('install:refusee', {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Etat proposable
// ─────────────────────────────────────────────────────────────────────────────

/** true si le prompt natif Android est disponible et non encore consomme. */
export function estInstallable() {
  return !!etat.invite;
}

/**
 * true si l'on peut, sans deranger, proposer quelque chose a l'utilisateur.
 * Faux si l'application est deja installee, si l'utilisateur a refuse recemment, ou si aucune
 * des deux voies (prompt natif, aide iOS) n'est ouverte.
 * @returns {boolean}
 */
export function peutProposer() {
  if (etat.installee || estStandalone()) return false;
  if (refusRecent()) return false;
  return estInstallable() || estIOS();
}

// ─────────────────────────────────────────────────────────────────────────────
// Declenchement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Declenche l'installation.
 * @returns {Promise<'accepted'|'dismissed'|'aide'|'indisponible'>}
 *   'aide' : aucune API, l'appelant doit envoyer l'utilisateur sur #/aide/installation.
 */
export async function proposer() {
  const invite = etat.invite;
  if (!invite) return estIOS() ? 'aide' : 'indisponible';

  // ⚠ L'evenement ne peut etre rejoue qu'une fois : on le libere AVANT d'attendre le choix, pour
  //   qu'un double-clic ne provoque pas un second prompt() sur un evenement deja consomme.
  etat.invite = null;
  try {
    invite.prompt();
    const choix = await invite.userChoice;
    const issue = (choix && choix.outcome) || 'dismissed';
    if (issue === 'dismissed') refuser();
    bus.emit('install:choix', { issue });
    return issue;
  } catch (err) {
    console.debug('[install] invite indisponible', err && err.message);
    return 'indisponible';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bandeau — fragment vivant (zone C)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monte un bandeau d'installation dans un conteneur fourni par une vue (l'accueil).
 * Il POSSEDE son sous-arbre et ses ecouteurs : aucun parent ne doit le remplacer, la vue appelle
 * detruire() a son demontage.
 *
 * ⚠ NON BLOQUANT : refermable, jamais modal, jamais superpose au bouton primaire.
 *
 * @param {Element} conteneur
 * @param {{onFerme?: () => void}} [options]
 * @returns {{racine: Element, detruire: () => void}|null} null si rien n'est a proposer
 */
export function monterBandeau(conteneur, options) {
  if (!conteneur || !peutProposer()) return null;
  const opts = options || {};
  const desabos = [];

  const ios = estIOS() && !estInstallable();

  const action = ios
    // Un lien, pas un bouton : l'aide iOS est une route, elle doit rester partageable et
    // atteignable au retour Android/navigateur.
    ? h('a', { class: 'bouton bouton-primaire', href: '#/aide/installation' }, 'Comment faire')
    : h('button', { class: 'bouton bouton-primaire', type: 'button' }, 'Installer');

  const fermer = h('button', {
    class: 'bouton bouton-fantome', type: 'button', 'aria-label': 'Masquer la proposition d\'installation'
  }, 'Plus tard');

  const racine = h('div', { class: 'bandeau-installation', role: 'note' },
    h('p', { class: 'bandeau-texte' },
      ios
        ? 'Ajoute Carnet Muscu à ton écran d\'accueil : l\'application s\'ouvre en plein écran et tes données sont mieux protégées.'
        : 'Installe Carnet Muscu sur ton téléphone : ouverture en plein écran, même sans connexion.'),
    h('div', { class: 'bandeau-actions' }, action, fermer)
  );

  if (!ios) {
    desabos.push(on(action, 'click', async () => {
      action.disabled = true;
      const issue = await proposer();
      // 'accepted' : l'evenement appinstalled fera disparaitre le bandeau. Sinon on le retire
      // ici, le refus ayant deja ete memorise par proposer().
      if (issue !== 'accepted') detruire();
    }));
  }

  desabos.push(on(fermer, 'click', () => {
    refuser();
    detruire();
  }));

  // L'installation peut aboutir depuis le menu du navigateur, sans passer par ce bandeau.
  desabos.push(bus.on('install:installee', () => detruire()));

  let detruit = false;
  function detruire() {
    if (detruit) return;
    detruit = true;
    for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
    desabos.length = 0;
    if (racine.parentNode) racine.parentNode.removeChild(racine);
    if (typeof opts.onFerme === 'function') opts.onFerme();
  }

  conteneur.appendChild(racine);
  return { racine, detruire };
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branche la capture de l'invite d'installation. Idempotente.
 *
 * ⚠ A appeler TOT : `beforeinstallprompt` est emis une seule fois, tres tot apres le chargement.
 *   Un abonnement pose au premier montage de l'accueil peut deja etre trop tard sur un rechargement
 *   rapide — d'ou l'appel au demarrage plutot qu'au montage d'une vue.
 */
export function initialiser() {
  if (etat.initialise) return;
  etat.initialise = true;

  on(window, 'beforeinstallprompt', (ev) => {
    // ⚠ preventDefault empeche la mini-infobar de Chrome. Sans lui, l'evenement n'est pas
    //   conservable et le bouton « Installer » de l'accueil ne pourrait rien declencher.
    ev.preventDefault();
    etat.invite = ev;
    // Seul canal d'invalidation : l'accueil, deja monte, decide s'il affiche son bandeau.
    bus.emit('install:disponible', {});
  });

  on(window, 'appinstalled', () => {
    etat.installee = true;
    etat.invite = null;
    // Memorise : sur Android, une PWA installee peut continuer a etre ouverte dans l'onglet, ou
    // estStandalone() reste faux. Sans cette trace, le bandeau reapparaitrait a l'infini.
    memoriser({ installee: true, installeAt: Date.now() });
    bus.emit('install:installee', {});
  });
}

/** Etat interne, pour tests.html et diagnostic. Aucune vue ne doit en dependre. */
export const _interne = { etat, CLE_REFUS, DUREE_REFUS_MS };
