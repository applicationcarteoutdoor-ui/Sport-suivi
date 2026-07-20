// ui/stepper.js — [ − ] [ valeur ] [ + ], le controle de saisie par defaut de l'ecran de seance.
//
// FRAGMENT VIVANT (zone C) : il possede son sous-arbre et ses ecouteurs, il expose des methodes
// ciblees (setValeur, valeur, detruire) et AUCUN parent n'a le droit de remplacer ce sous-arbre.
//
// ⚠ AUCUN <input> : la valeur vit en JavaScript et s'affiche dans un <output>. Cela supprime d'un
//   coup le zoom iOS a la focalisation, le conflit virgule/point et le champ masque par le clavier
//   systeme. La saisie libre passe par ui/keypad.js, ouvert au tap sur la valeur.
//
// ⚠ Deux garde-fous NON NEGOCIABLES sur l'appui long, sans lesquels des doigts moites depassent
//   systematiquement la valeur voulue :
//   1. l'acceleration est PLAFONNEE a 150 ms entre deux crans (et non 60 ms) ;
//   2. la repetition S'ARRETE d'elle-meme a +/- 10 crans, et propose alors le pave numerique.
//   Au-dela de 10 crans, taper le nombre est de toute facon plus rapide que le maintenir.

import { h, on } from '../lib/dom.js';
import { formatFr } from '../lib/num.js';

// Delai avant que l'appui long ne prenne le relais du premier cran.
const MS_AVANT_REPETITION = 480;
// Intervalle de depart de la repetition, puis decroissance geometrique...
const MS_DEPART = 300;
// ...jusqu'a ce PLANCHER, qui est le plafond de vitesse. Descendre a 60 ms rend le depassement
// inevitable : a cette cadence, 300 ms de retard de reaction valent 5 crans.
const MS_PLANCHER = 150;
const FACTEUR = 0.82;

// Arret automatique de la repetition. Compte les crans du SEUL appui long en cours.
const CRANS_MAX = 10;

// Au-dela de ce deplacement, le geste n'est plus un appui : c'est un defilement de la liste.
const SEUIL_DEPLACEMENT_PX = 10;

// Nombre de decimales significatives d'un nombre (1,25 -> 2).
function nbDecimales(n) {
  if (!Number.isFinite(n)) return 0;
  const texte = String(Math.abs(n));
  const point = texte.indexOf('.');
  return point === -1 ? 0 : texte.length - point - 1;
}

// Addition exacte a l'echelle des decimales des deux operandes.
// ⚠ On n'utilise PAS arrondiAuPas ici : il ramenerait la valeur sur la grille du pas et
//   deplacerait donc une valeur hors grille (63,75 kg avec un pas de 2,5) au lieu de l'incrementer.
//   La correction du float doit se faire sans jamais reinterpreter la valeur de depart.
function ajouter(valeur, delta) {
  const facteur = 10 ** Math.max(nbDecimales(valeur), nbDecimales(delta));
  return (Math.round(valeur * facteur) + Math.round(delta * facteur)) / facteur;
}

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Monte un stepper dans `el`.
 *
 * @param {Element} el conteneur. Le stepper y AJOUTE ses noeuds et ne touche a rien d'autre.
 * @param {Object} opts
 * @param {number} [opts.valeur=0]
 * @param {number} [opts.pas=1]
 * @param {number} [opts.min]  omis : pas de borne basse (indispensable au lest SIGNE)
 * @param {number} [opts.max]
 * @param {string} [opts.unite] affichee en petit a droite du nombre ('kg', 'm')
 * @param {string} [opts.libelle] nom accessible du groupe (« Charge »)
 * @param {(v:number)=>string} [opts.format] formateur d'affichage. EXTENSION au contrat du plan,
 *        rendue obligatoire par la ligne cardio : une duree s'affiche « 10:00 » et non « 600 ».
 *        Par defaut : formatFr.
 * @param {(v:number)=>void} [opts.onChange] appele a CHAQUE cran, y compris pendant l'appui long
 * @param {()=>void} [opts.onTapValeur] tap sur le nombre ou sur la pastille « Ouvrir le pave »
 * @returns {{ setValeur:(v:number)=>void, valeur:()=>number, detruire:()=>void }}
 */
export function monter(el, opts = {}) {
  const pas = estNombre(opts.pas) && opts.pas > 0 ? opts.pas : 1;
  const min = estNombre(opts.min) ? opts.min : null;
  const max = estNombre(opts.max) ? opts.max : null;
  const format = typeof opts.format === 'function' ? opts.format : (v) => formatFr(v);

  let valeur = estNombre(opts.valeur) ? opts.valeur : 0;

  // ── Construction du sous-arbre, UNE SEULE FOIS ────────────────────────────────
  const nombre = h('span', { class: 'stepper-valeur' }, format(valeur));
  const unite = h('span', { class: 'stepper-unite' }, opts.unite || '');
  if (!opts.unite) unite.hidden = true;

  // ⚠ <output> et non <input> : c'est la regle centrale de l'ecran de seance. Le role et le
  //   tabindex en font malgre tout une cible tapable et atteignable au clavier, puisqu'un tap
  //   dessus ouvre le pave numerique.
  const affichage = h(
    'output',
    {
      class: 'stepper-valeur',
      role: 'button',
      tabindex: '0',
      'aria-label': (opts.libelle ? opts.libelle + ' : ' : '') + 'ouvrir le pavé numérique'
    },
    nombre,
    unite
  );

  const boutonMoins = h('button', {
    class: 'stepper-bouton',
    type: 'button',
    'data-sens': '-1',
    'aria-label': 'Diminuer' + (opts.libelle ? ' : ' + opts.libelle : ''),
    // touch-action:none est indispensable : sans lui le navigateur s'approprie le geste et
    // pointermove/pointerup ne parviennent jamais au bouton, ce qui laisse la repetition tourner.
    style: { touchAction: 'none' }
  }, '−');

  const boutonPlus = h('button', {
    class: 'stepper-bouton',
    type: 'button',
    'data-sens': '1',
    'aria-label': 'Augmenter' + (opts.libelle ? ' : ' + opts.libelle : ''),
    style: { touchAction: 'none' }
  }, '+');

  const racine = h('div', {
    class: 'stepper',
    role: 'group',
    'data-actif': 'non',
    'aria-label': opts.libelle || null
  }, boutonMoins, affichage, boutonPlus);

  // Pastille d'echappement : apparait quand la repetition s'est arretee d'elle-meme.
  const astuce = h('button', {
    class: 'stepper-astuce',
    type: 'button',
    hidden: true
  }, 'Ouvrir le pavé');

  el.appendChild(racine);
  el.appendChild(astuce);

  // ── Etat de l'appui long ─────────────────────────────────────────────────────
  let minuteur = null;
  let pointeurId = null;
  let boutonActif = null;
  let departX = 0;
  let departY = 0;
  let crans = 0;
  let detruit = false;

  function borner(v) {
    if (min != null && v < min) return min;
    if (max != null && v > max) return max;
    return v;
  }

  function peindre() {
    // Mutation CIBLEE d'un unique noeud texte : rien n'est remplace, ni le stepper, ni le bouton
    // qui se trouve sous le doigt pendant l'acceleration.
    nombre.textContent = format(valeur);
    boutonMoins.disabled = min != null && valeur <= min;
    boutonPlus.disabled = max != null && valeur >= max;
  }

  function appliquer(sens, notifier) {
    const cible = borner(ajouter(valeur, sens * pas));
    if (cible === valeur) return false;
    valeur = cible;
    peindre();
    if (notifier && typeof opts.onChange === 'function') opts.onChange(valeur);
    return true;
  }

  function arreterRepetition(afficherAstuce) {
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    if (boutonActif && pointeurId != null && boutonActif.hasPointerCapture &&
        boutonActif.hasPointerCapture(pointeurId)) {
      try { boutonActif.releasePointerCapture(pointeurId); } catch (e) { /* pointeur deja perdu */ }
    }
    pointeurId = null;
    boutonActif = null;
    crans = 0;
    racine.setAttribute('data-actif', 'non');
    if (afficherAstuce) astuce.hidden = false;
  }

  function programmer(sens, delai) {
    minuteur = setTimeout(function tic() {
      if (detruit) return;
      crans += 1;
      const aChange = appliquer(sens, true);
      // Arret automatique : plafond de crans atteint, ou borne min/max touchee.
      if (!aChange || crans >= CRANS_MAX) { arreterRepetition(true); return; }
      programmer(sens, Math.max(MS_PLANCHER, delai * FACTEUR));
    }, delai);
  }

  function surPointerDown(ev) {
    // Bouton non principal d'une souris : ce n'est pas une intention de saisie.
    if (ev.button != null && ev.button !== 0) return;
    if (pointeurId != null) return;              // un seul doigt a la fois
    const bouton = ev.currentTarget;
    if (bouton.disabled) return;

    ev.preventDefault();                          // pas de selection de texte, pas de defilement
    const sens = Number(bouton.getAttribute('data-sens'));

    pointeurId = ev.pointerId;
    boutonActif = bouton;
    departX = ev.clientX;
    departY = ev.clientY;
    crans = 0;
    astuce.hidden = true;
    racine.setAttribute('data-actif', 'oui');

    // La capture garantit que pointermove et pointerup arrivent ici meme si le doigt glisse
    // hors du bouton : sans elle, un pointerup manque laisse la repetition tourner a l'infini.
    if (bouton.setPointerCapture) {
      try { bouton.setPointerCapture(ev.pointerId); } catch (e) { /* non capturable */ }
    }

    // Premier cran immediat : un tap simple doit repondre sans attendre le delai d'appui long.
    appliquer(sens, true);
    programmer(sens, MS_DEPART);
  }

  function surPointerMove(ev) {
    if (pointeurId == null || ev.pointerId !== pointeurId) return;
    const dx = ev.clientX - departX;
    const dy = ev.clientY - departY;
    // Au-dela de 10 px, l'utilisateur defile : on annule l'appui long sans annuler les crans
    // deja appliques (les defaire serait vecu comme une perte de saisie).
    if (dx * dx + dy * dy > SEUIL_DEPLACEMENT_PX * SEUIL_DEPLACEMENT_PX) arreterRepetition(false);
  }

  function surPointerUp(ev) {
    if (pointeurId == null || ev.pointerId !== pointeurId) return;
    arreterRepetition(false);
  }

  // Clavier : les boutons ne recoivent AUCUN ecouteur `click` (il doublerait le pointerdown),
  // donc l'activation clavier doit etre traitee explicitement.
  function surKeyDown(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    ev.preventDefault();
    appliquer(Number(ev.currentTarget.getAttribute('data-sens')), true);
  }

  function ouvrirPave(ev) {
    ev.preventDefault();
    astuce.hidden = true;
    if (typeof opts.onTapValeur === 'function') opts.onTapValeur();
  }

  function surKeyDownValeur(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    ouvrirPave(ev);
  }

  const off = [];
  for (const bouton of [boutonMoins, boutonPlus]) {
    off.push(on(bouton, 'pointerdown', surPointerDown));
    off.push(on(bouton, 'pointermove', surPointerMove));
    off.push(on(bouton, 'pointerup', surPointerUp));
    off.push(on(bouton, 'pointercancel', surPointerUp));
    off.push(on(bouton, 'lostpointercapture', surPointerUp));
    off.push(on(bouton, 'keydown', surKeyDown));
    // Un appui long sur un bouton declenche le menu contextuel sur Android : il volerait le geste.
    off.push(on(bouton, 'contextmenu', (ev) => ev.preventDefault()));
  }
  off.push(on(affichage, 'click', ouvrirPave));
  off.push(on(affichage, 'keydown', surKeyDownValeur));
  off.push(on(astuce, 'click', ouvrirPave));

  peindre();

  return {
    /** Impose une valeur SANS declencher onChange : c'est le parent qui l'a decidee. */
    setValeur(v) {
      if (!estNombre(v)) return;
      valeur = borner(v);
      astuce.hidden = true;
      peindre();
    },
    valeur() {
      return valeur;
    },
    detruire() {
      detruit = true;
      arreterRepetition(false);
      for (const f of off) f();
      off.length = 0;
      // Le fragment retire les noeuds QU'IL A CREES, et uniquement ceux-la.
      if (racine.parentNode) racine.parentNode.removeChild(racine);
      if (astuce.parentNode) astuce.parentNode.removeChild(astuce);
    }
  };
}
