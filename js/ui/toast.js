// js/ui/toast.js — notification breve avec action d'annulation. Fragment vivant (zone C).
//
// Deux decisions, contre-intuitives toutes les deux :
//
//   1. DUREE PAR DEFAUT 10 SECONDES, pas 3 ni 5. Les 5 s des bibliotheques de composants sont
//      calibrees pour un usage de bureau, ou le regard ne quitte pas l'ecran. En salle, la
//      sequence reelle est : valider la serie, poser le telephone, reprendre la barre. Quand
//      l'utilisateur constate son erreur de saisie et cherche « Annuler », il s'est ecoule
//      plusieurs secondes. Un toast de 5 s a deja disparu : l'annulation n'existe alors que sur
//      le papier.
//
//   2. LE NOEUD EST CREE UNE FOIS ET REUTILISE. Le toast possede son sous-arbre : afficher un
//      second message mute le textContent existant, il ne remplace pas le noeud. Remplacer le
//      noeud relancerait l'animation d'entree a chaque serie et, surtout, ferait disparaitre
//      « Annuler » sous le doigt de l'utilisateur qui le visait.
//
// Un seul toast a la fois : deux notifications empilees en bas d'un ecran de 360 px recouvrent
// la liste des series, et la seconde masque le bouton d'annulation de la premiere.

import { h, on } from '../lib/dom.js';

// v6 : 3,5 s (retour utilisateur : « elles durent trop longtemps, c'est horrible »). Le
// raisonnement « salle de sport » des 10 s d'origine reste valable pour un toast qui porte
// « Annuler » : ces appelants passent une duree explicite plus longue.
const DUREE_DEFAUT = 3500;

let racine = null;      // le <div class="toast">, cree une fois
let texteEl = null;
let boutonEl = null;
let detacherBouton = null;
let minuterie = 0;
let annulerCourant = null;

/** L'hote est ecrit en dur dans index.html (zone A) : on ne le cree jamais. */
function hote() {
  return document.getElementById('zone-toast') || document.body;
}

/**
 * Construit le sous-arbre du toast, une seule fois pour la vie du document.
 * @returns {Element}
 */
function construire() {
  if (racine) return racine;

  texteEl = h('span', { class: 'toast-texte' });
  boutonEl = h('button', {
    class: 'toast-annuler',
    type: 'button',
    hidden: true
  }, 'Annuler');

  racine = h('div', {
    class: 'toast',
    'data-ouvert': 'non',
    // ⚠ Pas de role="alert" : une alerte interrompt la lecture d'ecran en pleine saisie. L'hote
    //   d'index.html porte deja role="status" et aria-live="polite", ce qui suffit — le message
    //   est annonce a la fin de l'enonce en cours.
    'aria-hidden': 'true'
  }, texteEl, boutonEl);

  hote().appendChild(racine);
  return racine;
}

/** Positionne le toast au-dessus de ce qui occupe reellement le bas de l'ecran. */
function ancrage() {
  // La barre d'action n'existe que pendant une seance. Hors seance, se caler sur sa hauteur
  // laisserait le toast flotter a 76 px du vide ; se caler dessous le ferait recouvrir la
  // navigation basse. Le CSS gere les deux cas via data-ancrage.
  const barre = document.getElementById('barre-action');
  return (barre && !barre.hidden) ? 'barre' : 'nav';
}

function armerMinuterie(duree) {
  if (minuterie) { clearTimeout(minuterie); minuterie = 0; }
  // duree <= 0 : toast persistant, ferme uniquement par l'appelant ou par une action.
  if (!(duree > 0)) return;
  minuterie = setTimeout(() => { minuterie = 0; masquer(); }, duree);
}

/**
 * Affiche un message.
 *
 * @param {string} texte message, en francais, deja formate (le toast ne formate rien)
 * @param {Object} [options]
 * @param {Function} [options.annuler] appelee au tap sur « Annuler ». Sa presence seule fait
 *   apparaitre le bouton : pas de libelle a passer, il n'y a qu'une action possible.
 * @param {string} [options.libelleAnnuler] libelle alternatif ('Rétablir', 'Voir'...)
 * @param {number} [options.duree=10000] millisecondes. 0 ou negatif : persistant.
 * @returns {{fermer: Function}}
 */
export function afficher(texte, options) {
  const opts = options || {};
  construire();

  // Un toast en remplace un autre : l'action du precedent est abandonnee sans etre appelee.
  // L'appeler serait pire — l'utilisateur n'aura rien tape.
  annulerCourant = typeof opts.annuler === 'function' ? opts.annuler : null;

  texteEl.textContent = texte == null ? '' : String(texte);

  if (detacherBouton) { detacherBouton(); detacherBouton = null; }
  boutonEl.hidden = !annulerCourant;
  if (annulerCourant) {
    boutonEl.textContent = opts.libelleAnnuler || 'Annuler';
    // L'ecouteur est repose a chaque affichage plutot que garde a vie avec un renvoi vers une
    // variable : cela garantit qu'un toast sans action n'a aucun ecouteur actif.
    detacherBouton = on(boutonEl, 'click', () => {
      const fn = annulerCourant;
      // Ferme AVANT d'executer : l'action peut declencher un nouveau toast (« Série rétablie »),
      // qui serait aussitot masque par la fermeture de celui-ci.
      masquer();
      if (!fn) return;
      try { fn(); }
      catch (err) { console.error('[toast] action d\'annulation en echec', err); }
    });
  }

  racine.setAttribute('data-ancrage', ancrage());
  racine.setAttribute('data-ouvert', 'oui');
  racine.setAttribute('aria-hidden', 'false');

  armerMinuterie(opts.duree === undefined ? DUREE_DEFAUT : opts.duree);

  return { fermer: masquer };
}

/**
 * Masque le toast courant. Idempotent : appelable sans savoir si un toast est affiche.
 * Le noeud reste dans le document — le retirer casserait la reutilisation et n'economiserait
 * rien, le CSS le rendant deja invisible et non tapable (visibility + pointer-events).
 */
export function masquer() {
  if (minuterie) { clearTimeout(minuterie); minuterie = 0; }
  annulerCourant = null;
  if (detacherBouton) { detacherBouton(); detacherBouton = null; }
  if (!racine) return;
  racine.setAttribute('data-ouvert', 'non');
  racine.setAttribute('aria-hidden', 'true');
  // ⚠ Le bouton est masque immediatement, avant meme la fin de la transition de sortie : un
  //   bouton encore focusable dans un toast en train de disparaitre est atteignable au clavier
  //   et lisible par un lecteur d'ecran alors qu'il n'est plus visible.
  if (boutonEl) boutonEl.hidden = true;
}

/** @returns {boolean} vrai si un toast est actuellement visible. */
export function estAffiche() {
  return !!racine && racine.getAttribute('data-ouvert') === 'oui';
}

export default { afficher, masquer, estAffiche };
