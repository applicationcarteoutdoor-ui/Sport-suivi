// ui/keypad.js — pave numerique in-app.
//
// FRAGMENT VIVANT (zone C). Il rend dans le conteneur de pave de la zone A (#conteneur-pave),
// distinct du conteneur de feuille : le pave peut donc se superposer a une feuille ouverte
// (edition d'une serie -> saisie d'un nombre) sans la fermer.
//
// ⚠ `champs` est un TABLEAU, et c'est tout l'interet : repetitions -> « Suivant » -> charge ->
//   « OK », en UNE SEULE ouverture. Une valeur par ouverture imposerait deux cycles modaux pour
//   une seule serie, soit deux fois le voile, deux fois l'animation, deux fois la perte de contexte.
// ⚠ Il remplace le clavier systeme : pas de zoom iOS a la focalisation, pas de conflit
//   virgule/point (la virgule EST la touche decimale), pas de champ masque par le clavier.

import { h, on, vider } from '../lib/dom.js';
import { parseFr, formatFr } from '../lib/num.js';

const ID_HOTE = 'conteneur-pave';

// Une seule instance ouverte a la fois : deux paves superposes rendraient la touche « OK »
// ambigue et laisseraient un voile orphelin a la fermeture.
let courant = null;

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Ouvre le pave sur une SUITE de champs.
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.champs [{ cle, label, valeur, unite, pas }]
 *        Extensions au contrat du plan, toutes optionnelles :
 *        `entier:true`  desactive la touche virgule (repetitions, secondes, metres) ;
 *        `signe:true`   affiche la bascule +/− (lest SIGNE : +10 lest, −20 assistance) ;
 *        `min` / `max`  bornes de validation ;
 *        `format`       formateur d'affichage de la valeur initiale (duree en « 10:00 »).
 * @param {(valeurs:Object)=>void} [opts.onValider] recoit { [cle]: nombre } pour TOUS les champs
 * @param {()=>void} [opts.onAnnuler]
 * @param {Element} [opts.hote] conteneur d'accueil (defaut : #conteneur-pave de la zone A)
 * @returns {{ fermer:()=>void }|null}
 */
export function ouvrir(opts = {}) {
  const champs = Array.isArray(opts.champs) ? opts.champs.filter(Boolean) : [];
  if (!champs.length) return null;

  // Fermer le precedent AVANT d'en ouvrir un nouveau, sans declencher son onAnnuler : c'est un
  // remplacement decide par l'application, pas un abandon de l'utilisateur.
  if (courant) courant.fermer(true);

  const hote = opts.hote || document.getElementById(ID_HOTE);
  if (!hote) return null;

  // ── Etat ──────────────────────────────────────────────────────────────────────
  // Un brouillon TEXTE par champ : tant qu'il est vide, l'affichage montre la valeur d'origine.
  // Le premier chiffre frappe remplace donc la valeur au lieu de s'y accoler — c'est le geste
  // attendu quand on ouvre le pave justement parce que la valeur pre-remplie est fausse.
  const brouillons = champs.map(() => '');
  let index = 0;
  let ferme = false;
  // Declaree ici et non a la fin : fermer() la referme sur elle-meme pour se retirer du registre.
  let instance = null;

  const valeurInitiale = (i) => (estNombre(champs[i].valeur) ? champs[i].valeur : null);

  function valeurDe(i) {
    const brouillon = brouillons[i];
    if (brouillon === '' || brouillon === '-' || brouillon === ',') return valeurInitiale(i);
    const n = parseFr(brouillon);
    return n == null ? valeurInitiale(i) : n;
  }

  function texteDe(i) {
    if (brouillons[i] !== '') return brouillons[i];
    const v = valeurInitiale(i);
    if (v == null) return '';
    const champ = champs[i];
    return typeof champ.format === 'function' ? champ.format(v) : formatFr(v);
  }

  // ── Sous-arbre, construit UNE SEULE FOIS ─────────────────────────────────────
  const affichages = [];
  const cartes = champs.map((champ, i) => {
    const affichage = h('output', { class: 'pave-affichage' }, texteDe(i));
    affichages.push(affichage);
    return h('button', {
      class: 'pave-champ',
      type: 'button',
      'data-index': String(i),
      'data-actif': i === 0 ? 'oui' : 'non'
    },
      h('span', { class: 'pave-champ-label' }, champ.label || champ.cle || ''),
      affichage,
      champ.unite ? h('span', { class: 'pave-champ-unite' }, ' ' + champ.unite) : null
    );
  });

  const zoneChamps = h('div', { class: 'pave-champs' }, cartes);

  // 12 touches : 10 chiffres, la virgule decimale et l'effacement. La validation n'est pas une
  // touche du pave mais une barre pleine largeur, pour qu'elle ne soit jamais frappee par erreur
  // a la place d'un chiffre.
  const touches = [];
  function touche(texte, role, valeur) {
    const t = h('button', {
      class: 'pave-touche',
      type: 'button',
      'data-role': role,
      'data-valeur': valeur == null ? null : String(valeur)
    }, texte);
    touches.push(t);
    return t;
  }

  const grille = h('div', { class: 'pave-touches' },
    touche('1', 'chiffre', 1), touche('2', 'chiffre', 2), touche('3', 'chiffre', 3),
    touche('4', 'chiffre', 4), touche('5', 'chiffre', 5), touche('6', 'chiffre', 6),
    touche('7', 'chiffre', 7), touche('8', 'chiffre', 8), touche('9', 'chiffre', 9),
    touche(',', 'virgule'), touche('0', 'chiffre', 0), touche('⌫', 'effacer')
  );

  const toucheVirgule = touches[9];
  const boutonValider = h('button', {
    class: 'pave-touche',
    type: 'button',
    'data-role': 'valider'
  }, champs.length > 1 ? 'Suivant' : 'OK');
  grille.appendChild(boutonValider);

  // Bascule de signe. Elle n'est PAS une 13e touche du pave : le lest signe est un cas rare
  // (assistance elastique) et lui donner une case de la grille couterait la virgule ou un chiffre.
  const boutonSigne = h('button', {
    class: 'bouton bouton-fantome',
    type: 'button',
    'data-role': 'signe',
    'aria-label': 'Changer le signe'
  }, '±');

  const boutonAnnuler = h('button', {
    class: 'bouton bouton-fantome',
    type: 'button',
    'data-role': 'annuler'
  }, 'Annuler');

  const titre = h('h2', { class: 'feuille-titre' }, opts.titre || 'Saisie');

  const feuille = h('div', {
    class: 'feuille',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': opts.titre || 'Pavé numérique'
  },
    h('div', { class: 'feuille-poignee' }),
    h('div', { class: 'feuille-entete' }, titre, boutonSigne, boutonAnnuler),
    h('div', { class: 'feuille-corps' }, zoneChamps, grille)
  );

  const voile = h('div', { class: 'feuille-voile', 'data-role': 'voile' });
  const racine = h('div', { class: 'feuille-conteneur pave', 'data-ouvert': 'non' }, voile, feuille);

  vider(hote);
  hote.appendChild(racine);
  hote.hidden = false;
  // ⚠ L'OUVERTURE NE DOIT DEPENDRE D'AUCUN CADRE D'ANIMATION.
  // Cet attribut etait pose dans un requestAnimationFrame, qui ne s'execute PAS quand la page
  // n'est pas rendue (onglet en arriere-plan, throttling mobile). Le pave se montait alors
  // complet mais invisible : impossible de saisir une charge, sans aucune erreur en console.
  // Le reflow force etablit l'etat de depart de la transition sans dependre d'une frame.
  void racine.offsetHeight;
  if (!ferme) racine.setAttribute('data-ouvert', 'oui');

  // ── Peinture ciblee ──────────────────────────────────────────────────────────
  function peindre() {
    for (let i = 0; i < champs.length; i++) {
      affichages[i].textContent = texteDe(i);
      cartes[i].setAttribute('data-actif', i === index ? 'oui' : 'non');
    }
    boutonValider.textContent = index < champs.length - 1 ? 'Suivant' : 'OK';
    // La virgule n'a aucun sens sur des repetitions ou des metres : la touche reste en place
    // (la grille ne bouge jamais sous le doigt) mais devient inerte.
    toucheVirgule.disabled = champs[index].entier === true;
    boutonSigne.hidden = champs[index].signe !== true;
  }

  function frapper(role, valeur) {
    const champ = champs[index];
    let brouillon = brouillons[index];

    if (role === 'chiffre') {
      if (brouillon.replace(/[^0-9]/g, '').length >= 6) return;  // garde-fou de saisie
      brouillon += String(valeur);
    } else if (role === 'virgule') {
      if (champ.entier === true) return;
      if (brouillon.indexOf(',') !== -1) return;
      brouillon = (brouillon === '' || brouillon === '-') ? brouillon + '0,' : brouillon + ',';
    } else if (role === 'effacer') {
      // Brouillon vide : l'effacement porte sur la valeur pre-remplie, qu'il faut donc d'abord
      // materialiser, sinon la touche parait ne rien faire.
      if (brouillon === '') brouillon = texteDe(index);
      brouillon = brouillon.slice(0, -1);
      // ⚠ Tout efface = ZERO, et surtout pas un retour a la valeur pre-remplie : « je vide le
      //   champ » exprime une intention de remise a zero, pas un abandon de la correction.
      if (brouillon === '' || brouillon === '-') brouillon = '0';
    } else if (role === 'signe') {
      if (champ.signe !== true) return;
      if (brouillon === '') brouillon = texteDe(index);
      brouillon = brouillon.charAt(0) === '-' ? brouillon.slice(1) : '-' + brouillon;
      if (brouillon === '-' || brouillon === '') brouillon = '0';
    }

    brouillons[index] = brouillon;
    peindre();
  }

  function borner(v, champ) {
    if (v == null) return null;
    if (estNombre(champ.min) && v < champ.min) return champ.min;
    if (estNombre(champ.max) && v > champ.max) return champ.max;
    return v;
  }

  function suivantOuValider() {
    if (index < champs.length - 1) { index += 1; peindre(); return; }
    const valeurs = {};
    for (let i = 0; i < champs.length; i++) {
      valeurs[champs[i].cle] = borner(valeurDe(i), champs[i]);
    }
    const rappel = opts.onValider;
    fermer(true);
    if (typeof rappel === 'function') rappel(valeurs);
  }

  function annuler() {
    const rappel = opts.onAnnuler;
    fermer(true);
    if (typeof rappel === 'function') rappel();
  }

  // ── Ecouteurs. Un seul `click` delegue sur la racine du fragment. ─────────────
  function surClick(ev) {
    const cible = ev.target instanceof Element ? ev.target.closest('[data-role],[data-index]') : null;
    if (!cible || !racine.contains(cible)) return;
    ev.preventDefault();

    const carte = cible.getAttribute('data-index');
    if (carte != null) { index = Number(carte); peindre(); return; }

    const role = cible.getAttribute('data-role');
    if (role === 'voile' || role === 'annuler') { annuler(); return; }
    if (role === 'valider') { suivantOuValider(); return; }
    const brut = cible.getAttribute('data-valeur');
    frapper(role, brut == null ? null : Number(brut));
  }

  // Clavier physique : sans interet en salle, indispensable au developpement et a l'accessibilite.
  function surKeyDown(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); annuler(); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); suivantOuValider(); return; }
    if (ev.key === 'Backspace') { ev.preventDefault(); frapper('effacer'); return; }
    if (ev.key === ',' || ev.key === '.') { ev.preventDefault(); frapper('virgule'); return; }
    if (ev.key === '-') { ev.preventDefault(); frapper('signe'); return; }
    if (ev.key >= '0' && ev.key <= '9') { ev.preventDefault(); frapper('chiffre', Number(ev.key)); }
  }

  const off = [
    on(racine, 'click', surClick),
    on(document, 'keydown', surKeyDown)
  ];

  function fermer(silencieux) {
    if (ferme) return;
    ferme = true;
    for (const f of off) f();
    off.length = 0;
    racine.setAttribute('data-ouvert', 'non');
    if (racine.parentNode) racine.parentNode.removeChild(racine);
    // Le pave ne possede que son sous-arbre : il rend l'hote a l'etat exact ou il l'a trouve.
    hote.hidden = true;
    if (courant === instance) courant = null;
    if (!silencieux && typeof opts.onAnnuler === 'function') opts.onAnnuler();
  }

  peindre();
  // Le focus part sur la validation : c'est la seule commande dont l'activation clavier
  // (Entree) doit fonctionner sans deplacement prealable.
  boutonValider.focus({ preventScroll: true });

  instance = { fermer: () => fermer(true) };
  courant = instance;
  return instance;
}

/** Ferme le pave ouvert, s'il y en a un. Utilise par le routeur a la fermeture d'une feuille. */
export function fermer() {
  if (courant) courant.fermer();
}

/** true si un pave est actuellement ouvert (le retour Android le ferme avant de naviguer). */
export function estOuvert() {
  return courant != null;
}
