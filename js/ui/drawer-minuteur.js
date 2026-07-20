// ui/drawer-minuteur.js — tiroir lateral « Chronometre & Minuteur ».
//
// POURQUOI UN TIROIR, ET PAS UNE INTEGRATION AUX SERIES.
// Demande litterale : « Le minuteur / chronometre ne doit pas etre integre aux series. Il doit
// simplement etre disponible dans un onglet lateral, afin que l'utilisateur puisse l'ouvrir
// uniquement s'il en a besoin, sans avoir a quitter l'application pour utiliser l'application
// Chronometre du telephone. » Ce module ne connait donc NI la seance, NI le repos automatique
// (ui/timer-view.js, qui reste un objet completement distinct) : c'est un outil autonome,
// ouvrable depuis n'importe quel ecran, et qui ne bloque jamais rien.
//
// ⚠ L'ETAT EST UN HORODATAGE, JAMAIS UN COMPTEUR DECREMENTE.
//   Chronometre : { demarreA, cumulPause, enMarche } (+ pauseA, qui fige l'affichage).
//   Rebours     : { finAt, totalSec, enPause } (+ restantMs, la seule mesure gelee pendant la
//                 pause, aussitot reconvertie en finAt a la reprise).
//   Un compteur meurt avec le gel de l'onglet mobile ; un horodatage survit a tout, y compris a
//   un kill complet de l'application. On ne « rattrape » jamais les frames perdues : on
//   RECALCULE depuis Date.now(), sur visibilitychange ET sur pageshow (bfcache).
//
// ⚠ IL CONTINUE DE TOURNER quand le tiroir est ferme, quand on change d'ecran et quand
//   l'application passe en arriere-plan. C'est tout l'interet du module : remplacer le
//   chronometre du telephone. L'ouverture du tiroir n'est qu'un evenement d'AFFICHAGE ; elle ne
//   demarre, n'arrete et ne remet a zero strictement rien.
//
// ⚠ AUCUN etat FONCTIONNEL ne depend de requestAnimationFrame : rAF ne s'execute pas quand la
//   page n'est pas rendue. Ici rAF ne sert QU'A peindre des chiffres. L'ouverture du tiroir se
//   fait par reflow force puis pose SYNCHRONE de l'attribut, et l'echeance du rebours est portee
//   par un setTimeout arme au moment de l'echeance.
//
// Fragment vivant (zone C) : il possede tous les noeuds qu'il cree et n'en remplace jamais un
// qu'il ne possede pas. Le seul noeud de la coquille qu'il touche est l'attribut
// `data-minuteur` de .coquille (bordure d'ecran de fin), retire par detruire().

import { h, on } from '../lib/dom.js';
import { emit } from '../lib/bus.js';
import { formatDuree } from '../lib/num.js';
import { NS } from '../config.js';
import { icone } from './icons.js';
import { lire as lirePrefs } from '../data/prefs.js';
import * as keypad from './keypad.js';

// ─────────────────────────────────────────────────────────────────────────────
// Persistance
// ─────────────────────────────────────────────────────────────────────────────

// Cle DEDIEE : ni 'muscu:hot' (cache de reprise de la seance, purge a la cloture) ni
// 'muscu:prefs' (reglages, filtres sur une liste fermee de cles). Un chronometre lance puis
// oublie doit se retrouver intact apres un kill de l'application, meme sans seance en cours.
const CLE_ETAT = NS + ':minuteur';

// Plafond de la pile de tours. Au-dela, la liste n'est plus lisible et le poids en localStorage
// n'a plus de raison de croitre indefiniment. Les tours les plus ANCIENS sont abandonnes.
const MAX_TOURS = 99;

// Durees rapides, en secondes. Rangee a defilement horizontal.
const DUREES_RAPIDES = [60, 120, 180, 300];

const DELAI_SORTIE_MS = 320;

const SELECTEUR_FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

// Elements de la coquille neutralises pendant que le tiroir est ouvert. ⚠ #conteneur-pave en est
// volontairement absent : le pave numerique doit pouvoir se superposer au tiroir (reglage libre
// du rebours) sans etre rendu inerte par lui.
const ARRIERE_PLAN = ['entete', 'vue', 'nav-onglets', 'barre-action', 'bandeau-maj'];

/** Etat neutre. Toute lecture corrompue y retombe : un stockage casse ne bloque pas l'outil. */
function etatNeutre() {
  return {
    chrono: { demarreA: null, cumulPause: 0, enMarche: false, pauseA: null, tours: [] },
    rebours: { finAt: null, totalSec: 0, enPause: false, restantMs: 0, fini: false }
  };
}

const nombre = (v, defaut) => (typeof v === 'number' && Number.isFinite(v) ? v : defaut);

/**
 * Lit l'etat persiste et le NORMALISE. Un champ absent, d'un type inattendu ou incoherent
 * retombe sur sa valeur neutre : mieux vaut un chronometre remis a zero qu'un affichage NaN
 * indeboulonnable.
 * @returns {Object}
 */
function lireStock() {
  const etat = etatNeutre();
  let brut = null;
  try {
    const texte = localStorage.getItem(CLE_ETAT);
    if (texte) brut = JSON.parse(texte);
  } catch (_) {
    brut = null;                       // navigation privee, quota, JSON tronque
  }
  if (!brut || typeof brut !== 'object') return etat;

  const c = brut.chrono;
  if (c && typeof c === 'object') {
    const demarreA = nombre(c.demarreA, null);
    if (demarreA != null) {
      etat.chrono.demarreA = demarreA;
      etat.chrono.cumulPause = Math.max(0, nombre(c.cumulPause, 0));
      etat.chrono.enMarche = c.enMarche === true;
      const pauseA = nombre(c.pauseA, null);
      // Un chrono a l'arret DOIT porter son horodatage de gel, sans quoi son temps ecoule
      // repartirait de Date.now() et le compteur bondirait au rechargement.
      etat.chrono.pauseA = etat.chrono.enMarche ? null : (pauseA != null ? pauseA : Date.now());
      if (Array.isArray(c.tours)) {
        etat.chrono.tours = c.tours.filter((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0)
          .slice(-MAX_TOURS);
      }
    }
  }

  const r = brut.rebours;
  if (r && typeof r === 'object') {
    etat.rebours.totalSec = Math.max(0, nombre(r.totalSec, 0));
    etat.rebours.enPause = r.enPause === true;
    etat.rebours.restantMs = Math.max(0, nombre(r.restantMs, 0));
    etat.rebours.fini = r.fini === true;
    const finAt = nombre(r.finAt, null);
    etat.rebours.finAt = etat.rebours.enPause ? null : finAt;
    // Coherence : ni finAt ni restant en pause = rien en cours, quel que soit le reste.
    if (etat.rebours.finAt == null && !(etat.rebours.enPause && etat.rebours.restantMs > 0)) {
      if (!etat.rebours.fini) { etat.rebours.totalSec = 0; etat.rebours.enPause = false; etat.rebours.restantMs = 0; }
    }
  }
  return etat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ AudioContext cree au PREMIER GESTE UTILISATEUR puis SUSPENDU entre les bips : un contexte
//   maintenu actif prend la session audio du systeme et coupe la musique de l'utilisateur
//   pendant toute sa seance.
// ⚠ iOS suspend l'AudioContext des la mise en arriere-plan : un oscillateur planifie a l'avance
//   (source.start(ctx.currentTime + reste)) NE SE DECLENCHE PAS. Le bip est donc joue par un
//   setTimeout arme AU MOMENT DE L'ECHEANCE, jamais programme a l'avance.
let ctxAudio = null;

function amorcerAudio() {
  if (ctxAudio) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  try {
    ctxAudio = new Ctor();
    if (ctxAudio.state === 'running') ctxAudio.suspend();
  } catch (_) {
    ctxAudio = null;
  }
}

async function bip() {
  if (!ctxAudio) return;
  try {
    if (ctxAudio.state !== 'running') await ctxAudio.resume();
    const t = ctxAudio.currentTime;
    const osc = ctxAudio.createOscillator();
    const gain = ctxAudio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    // Enveloppe courte : un creneau brut produit un clic desagreable a chaque extremite.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    gain.connect(ctxAudio.destination);
    osc.start(t);
    osc.stop(t + 0.24);
    osc.onended = () => { try { ctxAudio.suspend(); } catch (_) { /* deja suspendu */ } };
  } catch (_) {
    // Session audio refusee (page jamais touchee, mode silencieux materiel) : le canal VISUEL
    // reste le canal principal, on n'escalade pas une erreur pour un bip.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatage
// ─────────────────────────────────────────────────────────────────────────────

/** Centiemes de seconde, sur deux chiffres. Le chronometre d'un telephone en affiche : ici aussi. */
const centiemes = (ms) => String(Math.floor((Math.max(0, ms) % 1000) / 10)).padStart(2, '0');

/** Secondes ENTIERES ecoulees, arrondies vers le bas (un chrono ne doit jamais devancer le reel). */
const secBas = (ms) => Math.floor(Math.max(0, ms) / 1000);

/** Secondes RESTANTES, arrondies vers le haut : « 1 » doit rester affiche jusqu'a l'echeance. */
const secHaut = (ms) => Math.ceil(Math.max(0, ms) / 1000);

/** « 47 s » sous une minute, « 2:13 » au-dela — un retard se lit en secondes, pas en 0:47. */
const formatRetard = (sec) => (sec < 60 ? sec + ' s' : formatDuree(sec));

/** Libelle court d'une duree rapide : « 1 min », « 5 min ». */
const libelleDuree = (sec) => (sec % 60 === 0 ? sec / 60 + ' min' : formatDuree(sec));

// ─────────────────────────────────────────────────────────────────────────────
// Montage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monte le tiroir et son bouton flottant.
 *
 * Appele UNE FOIS au demarrage de l'application, sur un hote de la coquille (zone A). Le tiroir
 * n'est pas une vue : il n'est jamais demonte par le routeur, et c'est precisement ce qui lui
 * permet de continuer a tourner d'un ecran a l'autre.
 *
 * @param {Element} [hote] conteneur d'accueil. Defaut : document.body.
 * @returns {{ouvrir:Function, fermer:Function, basculer:Function, estOuvert:Function, detruire:Function}}
 */
export function monter(hote) {
  const conteneurHote = hote instanceof Element ? hote : document.body;

  // ── Etat ───────────────────────────────────────────────────────────────────────────────────
  const etat = lireStock();
  let ouvert = false;
  let detruit = false;

  let raf = 0;
  let minuteurEcheance = 0;
  let minuterieSortie = 0;
  let verrou = null;          // WakeLockSentinel
  let jetonVerrou = 0;        // invalide une acquisition asynchrone devenue obsolete
  let precedentFocus = null;
  let paveOuvert = null;
  const neutralises = [];     // elements d'arriere-plan REELLEMENT modifies par ce module
  const detacher = [];

  // Derniers textes peints : ecrire un textContent identique a chaque frame invaliderait la mise
  // en page ~60 fois par seconde pour rien.
  const peint = { chrono: null, chronoCs: null, chronoEtat: null, rebours: null, reboursCs: null,
                  reboursEtat: null, mentionChrono: null, mentionRebours: null, flottant: null,
                  flottantActif: null };

  // ── Calculs — TOUJOURS depuis Date.now(), jamais depuis un compteur ────────────────────────
  function chronoEcouleMs() {
    const c = etat.chrono;
    if (c.demarreA == null) return 0;
    const fin = c.enMarche ? Date.now() : (c.pauseA != null ? c.pauseA : Date.now());
    return Math.max(0, fin - c.demarreA - c.cumulPause);
  }

  function reboursRestantMs() {
    const r = etat.rebours;
    if (r.enPause) return Math.max(0, r.restantMs);
    if (r.finAt == null) return 0;
    return r.finAt - Date.now();                 // peut etre NEGATIF : c'est le retard
  }

  const chronoActif = () => etat.chrono.demarreA != null;
  const reboursArme = () => etat.rebours.finAt != null || (etat.rebours.enPause && etat.rebours.restantMs > 0);
  /** Vrai si quelque chose compte VRAIMENT. C'est ce qui justifie le wake lock, et rien d'autre. */
  const compteEnCours = () => (etat.chrono.enMarche) || (etat.rebours.finAt != null && !etat.rebours.fini);
  /**
   * Vrai si l'affichage doit continuer de vivre.
   * ⚠ Plus large que compteEnCours : apres l'echeance, le rebours continue d'egrener
   *   « Terminé depuis 47 s ». Savoir DEPUIS QUAND il a sonne est la seule information utile au
   *   retour d'arriere-plan — un « Terminé » fige a la seconde de l'echeance ne dit rien.
   *   Le wake lock, lui, est relache : plus rien n'est attendu.
   */
  const doitTicker = () => compteEnCours() || (reboursArme() && etat.rebours.fini);

  // ── Noeuds ─────────────────────────────────────────────────────────────────────────────────
  const idTitre = 'tiroir-minuteur-titre';

  const chronoValeur = h('output', { class: 'outil-affichage' }, '0:00');
  const chronoCs = h('span', { class: 'outil-decimales' }, ',00');
  const chronoMention = h('p', { class: 'outil-mention' }, 'Arrêté');

  const btnChronoPrimaire = h('button', {
    class: 'bouton-outil bouton-outil-primaire', type: 'button', 'data-action': 'chrono-basculer'
  }, icone('lecture', { taille: 28 }), h('span', { class: 'bouton-outil-libelle' }, 'Démarrer'));

  const btnChronoTour = h('button', {
    class: 'bouton-outil', type: 'button', 'data-action': 'chrono-tour', disabled: true
  }, icone('coche', { taille: 24 }), h('span', { class: 'bouton-outil-libelle' }, 'Tour'));

  const btnChronoZero = h('button', {
    class: 'bouton-outil', type: 'button', 'data-action': 'chrono-zero', disabled: true
  }, icone('croix', { taille: 24 }), h('span', { class: 'bouton-outil-libelle' }, 'Zéro'));

  const toursVide = h('p', { class: 'tours-vide' }, 'Aucun tour');
  const listeTours = h('ol', { class: 'liste-tours', 'aria-label': 'Temps intermédiaires' });

  const carteChrono = h('section', { class: 'outil-minuteur', 'data-outil': 'chrono', 'data-etat': 'arrete' },
    h('div', { class: 'outil-entete' },
      icone('chronometre', { taille: 22 }),
      h('h3', { class: 'outil-nom' }, 'Chronomètre')
    ),
    h('div', { class: 'outil-cadran' }, chronoValeur, chronoCs),
    chronoMention,
    h('div', { class: 'outil-actions' }, btnChronoPrimaire, btnChronoTour, btnChronoZero),
    listeTours,
    toursVide
  );

  const reboursValeur = h('output', { class: 'outil-affichage' }, '0:00');
  const reboursCs = h('span', { class: 'outil-decimales' }, '');
  const reboursMention = h('p', { class: 'outil-mention' }, 'Choisissez une durée');

  const puces = DUREES_RAPIDES.map((sec) => h('button', {
    class: 'puce-duree', type: 'button', 'data-action': 'rebours-duree', 'data-sec': String(sec)
  }, libelleDuree(sec)));

  const puceLibre = h('button', {
    class: 'puce-duree puce-duree-libre', type: 'button', 'data-action': 'rebours-libre'
  }, icone('crayon', { taille: 18 }), h('span', null, 'Libre'));

  const rangeeDurees = h('div', { class: 'rangee-durees defilable-horizontal', role: 'group', 'aria-label': 'Durées rapides' },
    puces, puceLibre);

  const btnReboursPrimaire = h('button', {
    class: 'bouton-outil bouton-outil-primaire', type: 'button', 'data-action': 'rebours-basculer', disabled: true
  }, icone('pause', { taille: 28 }), h('span', { class: 'bouton-outil-libelle' }, 'Pause'));

  const btnMoins30 = h('button', {
    class: 'bouton-outil', type: 'button', 'data-action': 'rebours-moins30', disabled: true
  }, icone('moins', { taille: 24 }), h('span', { class: 'bouton-outil-libelle' }, '30 s'));

  const btnPlus30 = h('button', {
    class: 'bouton-outil', type: 'button', 'data-action': 'rebours-plus30', disabled: true
  }, icone('plus', { taille: 24 }), h('span', { class: 'bouton-outil-libelle' }, '30 s'));

  const btnReboursZero = h('button', {
    class: 'bouton-outil', type: 'button', 'data-action': 'rebours-zero', disabled: true
  }, icone('croix', { taille: 24 }), h('span', { class: 'bouton-outil-libelle' }, 'Zéro'));

  const carteRebours = h('section', { class: 'outil-minuteur', 'data-outil': 'rebours', 'data-etat': 'arrete' },
    h('div', { class: 'outil-entete' },
      icone('minuteur', { taille: 22 }),
      h('h3', { class: 'outil-nom' }, 'Minuteur')
    ),
    h('div', { class: 'outil-cadran' }, reboursValeur, reboursCs),
    reboursMention,
    rangeeDurees,
    h('div', { class: 'outil-actions' }, btnReboursPrimaire, btnMoins30, btnPlus30, btnReboursZero)
  );

  const btnFermer = h('button', { class: 'tiroir-fermer', type: 'button', 'aria-label': 'Fermer le minuteur' },
    icone('croix', { taille: 24 }));

  const corps = h('div', { class: 'tiroir-corps defilable' }, carteChrono, carteRebours);

  const panneau = h('aside', {
    class: 'tiroir tiroir-minuteur',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': idTitre,
    tabindex: '-1'
  },
    h('header', { class: 'tiroir-entete' },
      h('h2', { class: 'tiroir-titre', id: idTitre }, 'Chronomètre'),
      btnFermer
    ),
    corps
  );

  const voile = h('div', { class: 'tiroir-voile' });

  const racine = h('div', {
    class: 'tiroir-minuteur-hote',
    'data-ouvert': 'non',
    hidden: true
  }, voile, panneau);

  // Bouton flottant : discret, present sur TOUS les ecrans. Sa pastille affiche l'etat compact
  // d'un compte en cours, pour qu'on n'ait pas a ouvrir le tiroir pour savoir ou on en est.
  const flottantValeur = h('span', { class: 'minuteur-flottant-valeur', hidden: true });
  const flottant = h('button', {
    class: 'bouton-minuteur-flottant',
    type: 'button',
    'data-actif': 'non',
    'aria-label': 'Chronomètre et minuteur',
    'aria-expanded': 'false',
    'aria-haspopup': 'dialog'
  }, icone('chronometre', { taille: 24 }), flottantValeur);

  conteneurHote.appendChild(racine);
  conteneurHote.appendChild(flottant);

  // Bordure d'ecran de fin. La regle CSS vise .coquille[data-minuteur='fini'] — attribut DISTINCT
  // de celui du minuteur de repos (data-repos), les deux outils etant independants.
  const coquille = document.querySelector('.coquille') || document.body;

  // ── Peinture ───────────────────────────────────────────────────────────────────────────────
  function poserTexte(noeud, cle, texte) {
    if (peint[cle] === texte) return;
    peint[cle] = texte;
    noeud.textContent = texte;
  }

  function poserEtat(carte, cle, valeur) {
    if (peint[cle] === valeur) return;
    peint[cle] = valeur;
    carte.setAttribute('data-etat', valeur);
  }

  function peindreChrono() {
    const ms = chronoEcouleMs();
    const c = etat.chrono;
    const etatVisuel = c.enMarche ? 'marche' : (chronoActif() ? 'pause' : 'arrete');

    poserTexte(chronoValeur, 'chrono', formatDuree(secBas(ms)));
    poserTexte(chronoCs, 'chronoCs', ',' + centiemes(ms));
    poserEtat(carteChrono, 'chronoEtat', etatVisuel);
    poserTexte(chronoMention, 'mentionChrono',
      etatVisuel === 'marche' ? 'En marche' : (etatVisuel === 'pause' ? 'En pause' : 'Arrêté'));

    const libelle = btnChronoPrimaire.querySelector('.bouton-outil-libelle');
    const nouveauLibelle = c.enMarche ? 'Pause' : (chronoActif() ? 'Reprendre' : 'Démarrer');
    if (libelle && libelle.textContent !== nouveauLibelle) {
      libelle.textContent = nouveauLibelle;
      // ⚠ L'icone est REMPLACEE par un noeud que ce fragment POSSEDE : c'est son propre
      //   sous-arbre, pas celui d'un parent. Le contrat de rendu est respecte.
      const ancienne = btnChronoPrimaire.querySelector('svg');
      const suivante = icone(c.enMarche ? 'pause' : 'lecture', { taille: 28 });
      if (ancienne) btnChronoPrimaire.replaceChild(suivante, ancienne);
      else btnChronoPrimaire.insertBefore(suivante, btnChronoPrimaire.firstChild);
    }
    btnChronoTour.disabled = !c.enMarche;
    btnChronoZero.disabled = !chronoActif();
  }

  function peindreRebours() {
    const r = etat.rebours;
    const ms = reboursRestantMs();
    const arme = reboursArme();

    let etatVisuel = 'arrete';
    if (r.fini || (arme && ms <= 0)) etatVisuel = 'fini';
    else if (r.enPause) etatVisuel = 'pause';
    else if (arme) etatVisuel = 'marche';

    if (etatVisuel === 'fini') {
      const retard = Math.floor(-Math.min(0, ms) / 1000);
      poserTexte(reboursValeur, 'rebours', '0:00');
      poserTexte(reboursCs, 'reboursCs', '');
      // ⚠ Jamais un zero muet : au retour d'arriere-plan, savoir DEPUIS QUAND le minuteur a
      //   sonne est la seule information utile.
      poserTexte(reboursMention, 'mentionRebours',
        retard > 0 ? 'Terminé depuis ' + formatRetard(retard) : 'Terminé');
    } else if (arme) {
      poserTexte(reboursValeur, 'rebours', formatDuree(secHaut(ms)));
      poserTexte(reboursCs, 'reboursCs', '');
      poserTexte(reboursMention, 'mentionRebours',
        (r.enPause ? 'En pause · ' : 'Départ · ') + libelleDuree(r.totalSec));
    } else {
      poserTexte(reboursValeur, 'rebours', '0:00');
      poserTexte(reboursCs, 'reboursCs', '');
      poserTexte(reboursMention, 'mentionRebours', 'Choisissez une durée');
    }

    poserEtat(carteRebours, 'reboursEtat', etatVisuel);
    // La bordure d'ecran vit sur la coquille : elle doit rester visible tiroir FERME.
    if (etatVisuel === 'fini') coquille.setAttribute('data-minuteur', 'fini');
    else coquille.removeAttribute('data-minuteur');

    const enDecompte = arme && !r.enPause && etatVisuel !== 'fini';
    const libelle = btnReboursPrimaire.querySelector('.bouton-outil-libelle');
    const nouveauLibelle = enDecompte ? 'Pause' : 'Reprendre';
    if (libelle && libelle.textContent !== nouveauLibelle) {
      libelle.textContent = nouveauLibelle;
      const ancienne = btnReboursPrimaire.querySelector('svg');
      const suivante = icone(enDecompte ? 'pause' : 'lecture', { taille: 28 });
      if (ancienne) btnReboursPrimaire.replaceChild(suivante, ancienne);
      else btnReboursPrimaire.insertBefore(suivante, btnReboursPrimaire.firstChild);
    }
    btnReboursPrimaire.disabled = !arme || etatVisuel === 'fini';
    btnMoins30.disabled = !arme || etatVisuel === 'fini';
    btnPlus30.disabled = !arme || etatVisuel === 'fini';
    btnReboursZero.disabled = !arme && !r.fini;
  }

  function peindreFlottant() {
    // Priorite au rebours : c'est lui qui porte une echeance, donc une urgence.
    let texte = '';
    let actif = 'non';
    const r = etat.rebours;
    const msR = reboursRestantMs();
    if (r.fini || (reboursArme() && msR <= 0)) {
      texte = '0:00';
      actif = 'fini';
    } else if (reboursArme()) {
      texte = formatDuree(secHaut(msR));
      actif = r.enPause ? 'pause' : 'oui';
    } else if (chronoActif()) {
      texte = formatDuree(secBas(chronoEcouleMs()));
      actif = etat.chrono.enMarche ? 'oui' : 'pause';
    }

    if (peint.flottant !== texte) {
      peint.flottant = texte;
      flottantValeur.textContent = texte;
      flottantValeur.hidden = texte === '';
      // L'etiquette accessible porte le temps : c'est la seule facon de connaitre l'etat du
      // compte sans ouvrir le tiroir quand on ne voit pas la pastille.
      flottant.setAttribute('aria-label', texte
        ? 'Chronomètre et minuteur — ' + texte
        : 'Chronomètre et minuteur');
    }
    if (peint.flottantActif !== actif) {
      peint.flottantActif = actif;
      flottant.setAttribute('data-actif', actif);
    }
  }

  function peindre() {
    // ⚠ Le rebours est peint MEME TIROIR FERME : c'est lui qui porte l'attribut de fin sur la
    //   coquille (bordure d'ecran), qui doit apparaitre ET disparaitre sans ouverture. Le
    //   chronometre, lui, est saute : ses centiemes reecriraient un textContent soixante fois
    //   par seconde pour des noeuds que personne ne regarde.
    if (ouvert) peindreChrono();
    peindreRebours();
    peindreFlottant();
  }

  function reconstruireTours() {
    const tours = etat.chrono.tours;
    // Sous-arbre POSSEDE par le fragment : le vider est legitime. On ne remplace jamais un
    // noeud d'un parent.
    while (listeTours.firstChild) listeTours.removeChild(listeTours.firstChild);
    // Le plus recent EN HAUT : c'est le seul qu'on regarde, un telephone pose au sol.
    for (let i = tours.length - 1; i >= 0; i--) {
      const cumul = tours[i];
      const ecart = i === 0 ? cumul : cumul - tours[i - 1];
      listeTours.appendChild(h('li', { class: 'tour' },
        h('span', { class: 'tour-rang' }, String(i + 1)),
        h('span', { class: 'tour-temps' }, formatDuree(secBas(cumul)) + ',' + centiemes(cumul)),
        h('span', { class: 'tour-ecart' }, '+' + formatDuree(secBas(ecart)) + ',' + centiemes(ecart))
      ));
    }
    listeTours.hidden = tours.length === 0;
    toursVide.hidden = tours.length !== 0;
  }

  // ── Boucle d'affichage ─────────────────────────────────────────────────────────────────────
  // ⚠ rAF ne pilote QUE des chiffres. Aucun etat fonctionnel ne depend de son execution.
  function tick() {
    raf = 0;
    if (detruit) return;
    peindre();
    if (!doitTicker() || document.hidden) return;
    raf = requestAnimationFrame(tick);
  }

  function relancer() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!detruit && doitTicker() && !document.hidden) raf = requestAnimationFrame(tick);
  }

  // ── Persistance ────────────────────────────────────────────────────────────────────────────
  function persister() {
    try {
      localStorage.setItem(CLE_ETAT, JSON.stringify(etat));
    } catch (_) {
      // Quota depasse ou stockage refuse : l'outil continue de fonctionner EN MEMOIRE pour la
      // session en cours. Perdre un chronometre au prochain lancement est benin ; refuser de le
      // demarrer ne l'est pas.
    }
  }

  /** Point de passage UNIQUE apres toute modification d'etat : persiste, repeint, relance. */
  function change() {
    persister();
    programmerEcheance();
    peindre();
    relancer();
    majVerrou();
    emit('minuteur:modifie', etatCourant());
  }

  // ── Echeance du rebours ────────────────────────────────────────────────────────────────────
  function annulerEcheance() {
    if (minuteurEcheance) clearTimeout(minuteurEcheance);
    minuteurEcheance = 0;
  }

  /** Arme le declenchement AU MOMENT DE L'ECHEANCE. Jamais un son planifie a l'avance. */
  function programmerEcheance() {
    annulerEcheance();
    const r = etat.rebours;
    if (detruit || r.fini || r.enPause || r.finAt == null) return;
    const ms = reboursRestantMs();
    if (ms <= 0) return;
    // Le setTimeout est la source FONCTIONNELLE de la fin ; rAF n'est qu'un accelerateur
    // d'affichage. Si l'onglet est gele, recaler() prend le relais au retour.
    minuteurEcheance = setTimeout(() => {
      minuteurEcheance = 0;
      if (!detruit && !etat.rebours.fini) signalerFin(false);
    }, ms);
  }

  /**
   * @param {boolean} tardif vrai si la fin a ete DECOUVERTE au retour d'arriere-plan : ni bip ni
   *   vibration, qui n'auraient plus aucun sens plusieurs minutes apres l'echeance.
   */
  function signalerFin(tardif) {
    const r = etat.rebours;
    if (r.fini) return;
    r.fini = true;
    r.enPause = false;
    annulerEcheance();

    // 1. VISUEL D'ABORD : grand affichage + bordure d'ecran. Seul canal fiable sur les deux
    //    plateformes, et le seul qui reste lisible telephone pose au sol.
    peindreRebours();
    peindreFlottant();

    if (!tardif) {
      const prefs = lirePrefs();
      // 2. Vibration : sans effet mais sans erreur sur iOS.
      if (prefs.vibration && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate([200, 100, 200]); } catch (_) { /* ignore */ }
      }
      // 3. Bip, joue MAINTENANT et non planifie.
      if (prefs.son) bip();
    }

    relacherVerrou();
    persister();
    relancer();
    emit('minuteur:fini', { totalSec: r.totalSec, tardif });
  }

  // ── Recalage : visibilitychange + pageshow (bfcache) ───────────────────────────────────────
  function recaler() {
    if (detruit) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      relacherVerrou();
      // ⚠ On persiste AVANT le gel : c'est le dernier instant garanti sur mobile.
      persister();
      return;
    }
    // Force un repeint complet apres le gel : les dernieres valeurs peintes datent d'avant.
    for (const cle in peint) peint[cle] = null;

    const r = etat.rebours;
    if (!r.fini && r.finAt != null && reboursRestantMs() <= 0) {
      signalerFin(true);               // decouverte tardive : visuel seul
    } else {
      programmerEcheance();
    }
    peindre();
    majVerrou();
    relancer();
  }

  // ── Wake Lock : OPT-IN, lu depuis les prefs, derriere la garde de fonctionnalite ───────────
  async function acquerirVerrou() {
    // ⚠ Garde obligatoire : l'API est absente avant iOS 16.4.
    if (!('wakeLock' in navigator)) return;
    if (verrou || detruit || document.hidden) return;
    if (!compteEnCours()) return;
    if (!lirePrefs().wakeLockRepos) return;
    const jeton = ++jetonVerrou;
    try {
      const sentinelle = await navigator.wakeLock.request('screen');
      // Entre la demande et sa resolution, le compte a pu s'arreter ou le module etre detruit.
      if (jeton !== jetonVerrou || detruit || !compteEnCours()) {
        try { sentinelle.release(); } catch (_) { /* deja relache */ }
        return;
      }
      verrou = sentinelle;
      sentinelle.addEventListener('release', () => { if (verrou === sentinelle) verrou = null; });
    } catch (_) {
      // Refus systeme (batterie faible) : le compte continue, seul l'ecran s'eteindra.
    }
  }

  function relacherVerrou() {
    jetonVerrou++;
    const sentinelle = verrou;
    verrou = null;
    if (sentinelle) { try { sentinelle.release(); } catch (_) { /* deja relache */ } }
  }

  function majVerrou() {
    if (compteEnCours()) acquerirVerrou();
    else relacherVerrou();
  }

  // ── Commandes du chronometre ───────────────────────────────────────────────────────────────
  function chronoBasculer() {
    const c = etat.chrono;
    if (!chronoActif()) {
      c.demarreA = Date.now();
      c.cumulPause = 0;
      c.pauseA = null;
      c.enMarche = true;
      c.tours = [];
      reconstruireTours();
    } else if (c.enMarche) {
      c.pauseA = Date.now();
      c.enMarche = false;
    } else {
      // Le temps passe en pause est REPORTE dans cumulPause : l'etat reste un horodatage.
      c.cumulPause += Date.now() - (c.pauseA != null ? c.pauseA : Date.now());
      c.pauseA = null;
      c.enMarche = true;
    }
    change();
  }

  function chronoTour() {
    const c = etat.chrono;
    if (!c.enMarche) return;
    c.tours.push(chronoEcouleMs());
    // Les tours les plus ANCIENS sont abandonnes : le dernier est celui qu'on regarde.
    if (c.tours.length > MAX_TOURS) c.tours = c.tours.slice(-MAX_TOURS);
    reconstruireTours();
    change();
  }

  function chronoZero() {
    const c = etat.chrono;
    c.demarreA = null;
    c.cumulPause = 0;
    c.pauseA = null;
    c.enMarche = false;
    c.tours = [];
    reconstruireTours();
    change();
  }

  // ── Commandes du rebours ───────────────────────────────────────────────────────────────────
  function reboursDemarrer(sec) {
    const total = Math.max(1, Math.round(sec));
    const r = etat.rebours;
    r.totalSec = total;
    r.finAt = Date.now() + total * 1000;
    r.enPause = false;
    r.restantMs = 0;
    r.fini = false;
    change();
  }

  function reboursBasculer() {
    const r = etat.rebours;
    if (r.fini || !reboursArme()) return;
    if (r.enPause) {
      // La duree gelee redevient un horodatage de fin.
      r.finAt = Date.now() + r.restantMs;
      r.restantMs = 0;
      r.enPause = false;
    } else {
      r.restantMs = Math.max(0, reboursRestantMs());
      r.finAt = null;
      r.enPause = true;
    }
    change();
  }

  function reboursAjuster(deltaSec) {
    const r = etat.rebours;
    if (r.fini || !reboursArme()) return;
    const delta = deltaSec * 1000;
    if (r.enPause) {
      r.restantMs = Math.max(0, r.restantMs + delta);
    } else {
      // Borne basse a l'instant present : un finAt dans le passe signifierait un decompte
      // negatif, pas une echeance atteinte.
      r.finAt = Math.max(Date.now(), r.finAt + delta);
    }
    r.totalSec = Math.max(0, r.totalSec + deltaSec);
    change();
    // Un « −30 s » qui amene le reste a zero doit sonner tout de suite, pas au prochain tick.
    if (!r.enPause && reboursRestantMs() <= 0) signalerFin(false);
  }

  function reboursZero() {
    const r = etat.rebours;
    r.finAt = null;
    r.totalSec = 0;
    r.enPause = false;
    r.restantMs = 0;
    r.fini = false;
    annulerEcheance();
    change();
  }

  /** Reglage libre : le pave numerique de l'application, jamais un <input> (zoom iOS). */
  function reboursLibre() {
    const base = etat.rebours.totalSec || lirePrefs().reposParDefautSec || 120;
    if (paveOuvert && typeof paveOuvert.fermer === 'function') { try { paveOuvert.fermer(); } catch (_) {} }
    paveOuvert = keypad.ouvrir({
      champs: [
        { cle: 'min', label: 'Minutes', valeur: Math.floor(base / 60), unite: 'min', pas: 1, entier: true, min: 0, max: 180 },
        { cle: 'sec', label: 'Secondes', valeur: base % 60, unite: 's', pas: 5, entier: true, min: 0, max: 59 }
      ],
      onValider: (valeurs) => {
        paveOuvert = null;
        const total = Math.max(0, Math.round(valeurs.min || 0)) * 60 + Math.max(0, Math.round(valeurs.sec || 0));
        if (total > 0) reboursDemarrer(total);
      },
      onAnnuler: () => { paveOuvert = null; }
    });
  }

  // ── Ouverture / fermeture ──────────────────────────────────────────────────────────────────
  function neutraliserArrierePlan(actif) {
    const supporteInert = 'inert' in HTMLElement.prototype;
    if (actif) {
      for (const id of ARRIERE_PLAN) {
        const el = document.getElementById(id);
        if (!el) continue;
        // ⚠ On ne touche pas a un element DEJA neutralise par une feuille ouverte : le restaurer
        //   a la fermeture du tiroir rendrait la seance de nouveau accessible sous la feuille.
        if (el.getAttribute('aria-hidden') === 'true') continue;
        if (supporteInert) el.inert = true;
        el.setAttribute('aria-hidden', 'true');
        neutralises.push(el);
      }
      return;
    }
    for (const el of neutralises) {
      if (supporteInert) el.inert = false;
      el.removeAttribute('aria-hidden');
    }
    neutralises.length = 0;
  }

  function focusables() {
    return Array.prototype.filter.call(
      panneau.querySelectorAll(SELECTEUR_FOCUSABLE),
      // offsetParent nul = element masque. Un piege a focus qui compte des elements invisibles
      // envoie le focus dans le vide.
      (el) => !el.hasAttribute('hidden') && !el.disabled && el.offsetParent !== null
    );
  }

  function ouvrir() {
    if (detruit || ouvert) return;
    // Premier geste utilisateur : seul moment ou iOS autorise la creation de l'AudioContext.
    amorcerAudio();
    if (minuterieSortie) { clearTimeout(minuterieSortie); minuterieSortie = 0; }
    ouvert = true;
    precedentFocus = document.activeElement;
    racine.hidden = false;
    neutraliserArrierePlan(true);
    reconstruireTours();
    for (const cle in peint) peint[cle] = null;
    peindre();

    // ⚠ L'OUVERTURE NE DEPEND D'AUCUN CADRE D'ANIMATION.
    //   rAF ne s'execute pas quand la page n'est pas rendue (arriere-plan, throttling mobile) :
    //   poser l'attribut dans un rAF montait le tiroir — noeuds, boutons, ecouteurs — en le
    //   laissant invisible, sans la moindre erreur en console. C'est un etat FONCTIONNEL.
    //   Le meme resultat visuel s'obtient en forcant le calcul de l'etat de depart par une
    //   lecture de mise en page, puis en posant l'attribut SYNCHRONEMENT.
    void panneau.offsetHeight;
    racine.setAttribute('data-ouvert', 'oui');
    flottant.setAttribute('aria-expanded', 'true');

    const liste = focusables();
    const cible = liste.find((el) => el !== btnFermer) || liste[0] || panneau;
    try { cible.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
    relancer();
    emit('minuteur:ouvert', {});
  }

  function fermer() {
    if (detruit || !ouvert) return;
    ouvert = false;
    racine.setAttribute('data-ouvert', 'non');
    flottant.setAttribute('aria-expanded', 'false');
    neutraliserArrierePlan(false);

    // Le focus revient d'ou il venait : sans cela il retombe sur <body> et le prochain Tab
    // repart du tout premier element de la page.
    if (precedentFocus && typeof precedentFocus.focus === 'function' && document.contains(precedentFocus)) {
      try { precedentFocus.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
    } else {
      try { flottant.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
    }
    precedentFocus = null;

    // On attend la fin de la transition de sortie pour retirer le tiroir du flux, faute de quoi
    // il disparaitrait d'un coup. Double garde-fou obligatoire : transitionend n'arrive ni quand
    // la page passe en arriere-plan, ni quand prefers-reduced-motion annule la duree.
    const finir = () => {
      if (minuterieSortie) { clearTimeout(minuterieSortie); minuterieSortie = 0; }
      if (!ouvert && !detruit) racine.hidden = true;
    };
    minuterieSortie = setTimeout(finir, DELAI_SORTIE_MS);
    // ⚠ Le compte, lui, continue : fermer le tiroir est un evenement d'AFFICHAGE.
    relancer();
    emit('minuteur:ferme', {});
  }

  const basculer = () => { if (ouvert) fermer(); else ouvrir(); };

  // ── Ecouteurs — un seul relais de clic par zone, dispatche par data-action ─────────────────
  const ACTIONS = {
    'chrono-basculer': chronoBasculer,
    'chrono-tour': chronoTour,
    'chrono-zero': chronoZero,
    'rebours-basculer': reboursBasculer,
    'rebours-plus30': () => reboursAjuster(30),
    'rebours-moins30': () => reboursAjuster(-30),
    'rebours-zero': reboursZero,
    'rebours-libre': reboursLibre
  };

  detacher.push(on(panneau, 'click', (ev) => {
    const cible = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
    if (!cible || !panneau.contains(cible)) return;
    amorcerAudio();
    const nom = cible.getAttribute('data-action');
    if (nom === 'rebours-duree') {
      const sec = Number(cible.getAttribute('data-sec'));
      if (Number.isFinite(sec) && sec > 0) reboursDemarrer(sec);
      return;
    }
    const fn = ACTIONS[nom];
    if (fn) fn();
  }));

  detacher.push(on(flottant, 'click', () => { basculer(); }));
  detacher.push(on(btnFermer, 'click', fermer));
  detacher.push(on(voile, 'click', fermer));

  // Piege a focus + Echap. Pose sur le PANNEAU et non sur le document : un ecouteur global
  // intercepterait aussi les touches du pave numerique, qui se superpose legitimement au tiroir.
  detacher.push(on(panneau, 'keydown', (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      ev.preventDefault();
      ev.stopPropagation();
      fermer();
      return;
    }
    if (ev.key !== 'Tab') return;
    const liste = focusables();
    if (!liste.length) { ev.preventDefault(); return; }
    const premier = liste[0];
    const dernier = liste[liste.length - 1];
    // Le cycle est ferme a la main : sans cela, Tab depuis le dernier bouton sort du tiroir et
    // parcourt l'ecran masque derriere le voile.
    if (ev.shiftKey && (document.activeElement === premier || !panneau.contains(document.activeElement))) {
      ev.preventDefault(); dernier.focus();
    } else if (!ev.shiftKey && document.activeElement === dernier) {
      ev.preventDefault(); premier.focus();
    }
  }));

  detacher.push(on(document, 'visibilitychange', recaler));
  detacher.push(on(window, 'pageshow', recaler));        // retour depuis le bfcache
  // ⚠ pagehide est le DERNIER instant garanti sur mobile : `unload` n'est pas fiable et
  //   `beforeunload` ne se declenche pas sur iOS. C'est ici que se joue la survie du chronometre
  //   a une fermeture complete de l'application.
  detacher.push(on(window, 'pagehide', persister));

  // ── API ────────────────────────────────────────────────────────────────────────────────────
  /**
   * Instantane de l'etat, recalcule depuis Date.now() a chaque appel.
   * Destine notamment a l'indicateur compact du bouton flottant et aux ecrans qui veulent savoir
   * si un compte tourne.
   * @returns {{chrono:Object, rebours:Object}}
   */
  function etatCourant() {
    const msC = chronoEcouleMs();
    const msR = reboursRestantMs();
    const arme = reboursArme();
    return {
      chrono: {
        actif: chronoActif(),
        enMarche: etat.chrono.enMarche,
        enPause: chronoActif() && !etat.chrono.enMarche,
        ecouleMs: msC,
        ecouleSec: secBas(msC),
        texte: formatDuree(secBas(msC)),
        tours: etat.chrono.tours.slice()
      },
      rebours: {
        actif: arme,
        enMarche: arme && !etat.rebours.enPause && !etat.rebours.fini,
        enPause: etat.rebours.enPause,
        fini: etat.rebours.fini,
        totalSec: etat.rebours.totalSec,
        restantMs: Math.max(0, msR),
        restantSec: secHaut(msR),
        texte: formatDuree(secHaut(msR))
      }
    };
  }

  function detruire() {
    if (detruit) return;
    detruit = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    annulerEcheance();
    if (minuterieSortie) { clearTimeout(minuterieSortie); minuterieSortie = 0; }
    relacherVerrou();
    // ⚠ L'etat est persiste AVANT tout demontage : detruire l'affichage ne doit jamais detruire
    //   le chronometre de l'utilisateur.
    persister();
    if (paveOuvert && typeof paveOuvert.fermer === 'function') { try { paveOuvert.fermer(); } catch (_) {} }
    paveOuvert = null;
    for (const off of detacher) { try { off(); } catch (_) { /* deja detache */ } }
    detacher.length = 0;
    neutraliserArrierePlan(false);
    // Noeuds POSSEDES : retires. Attribut de la COQUILLE : remis dans son etat de repos.
    if (racine.parentNode) racine.parentNode.removeChild(racine);
    if (flottant.parentNode) flottant.parentNode.removeChild(flottant);
    coquille.removeAttribute('data-minuteur');
  }

  // ── Amorcage ───────────────────────────────────────────────────────────────────────────────
  // On repart d'un etat potentiellement vieux de plusieurs heures : c'est le cas NORMAL apres un
  // kill de l'application. Rien n'est rattrape, tout est recalcule.
  reconstruireTours();
  if (!etat.rebours.fini && etat.rebours.finAt != null && reboursRestantMs() <= 0) {
    signalerFin(true);                 // echeance passee pendant que l'application etait morte
  } else {
    programmerEcheance();
  }
  peindre();
  majVerrou();
  relancer();

  return { ouvrir, fermer, basculer, estOuvert: () => ouvert, etatCourant, detruire };
}

export default { monter };
