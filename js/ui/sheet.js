// js/ui/sheet.js — feuille basse generique. Fragment vivant (zone C).
//
// Pourquoi une feuille et pas un ecran : « Ajouter un exercice », « Modifier une série » ou
// « Changer de lieu » sont des actions QUI NE CHANGENT PAS DE CONTEXTE. En faire des routes
// demontait #/seance, donc detruisait le scroll, le volet ouvert et le minuteur en cours — pour
// une action censee durer trois secondes. La feuille se superpose : la seance reste montee
// derriere, intacte.
//
// Ce module ne connait NI le routage NI le domaine. Il ouvre, ferme, et rend un objet. C'est la
// vue appelante qui decide QUAND ouvrir (a la lecture de `params.sheet`) et qui synchronise
// l'URL a la fermeture (via router.fermerFeuille dans `onFermer`). Sans cette synchronisation,
// fermer par Echap laisserait `?sheet=…` dans l'URL et le bouton retour d'Android rouvrirait la
// feuille que l'utilisateur vient de fermer.
//
// Le conteneur vit dans index.html (zone A) et n'est JAMAIS recree : seuls son contenu, sa
// classe et son attribut data-ouvert changent.

import { h, on } from '../lib/dom.js';

// Repli si la transition de fermeture n'emet pas d'evenement : element retire du flux, onglet
// passe en arriere-plan, ou `prefers-reduced-motion` qui ramene la duree a 0,01 ms (base.css).
// Sans ce repli, un noeud de feuille resterait a vie dans le document, invisible et focusable.
const DELAI_SORTIE_MS = 320;

const SELECTEUR_FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

// Elements de la coquille neutralises pendant qu'une feuille est ouverte. ⚠ #conteneur-pave en
// est volontairement absent : le pave numerique doit pouvoir se superposer a une feuille
// ouverte (modifier une serie -> taper un nombre) sans la fermer.
const ARRIERE_PLAN = ['entete', 'vue', 'nav-onglets', 'barre-action', 'bandeau-maj'];

/** Une seule feuille a la fois : l'hote est unique et une pile de feuilles n'a aucun sens ici. */
let ouverte = null;

function hote() { return document.getElementById('conteneur-feuille'); }

/**
 * @param {Element} racine
 * @returns {Element[]} elements focusables reellement visibles
 */
function focusables(racine) {
  return Array.prototype.filter.call(
    racine.querySelectorAll(SELECTEUR_FOCUSABLE),
    // offsetParent nul = element masque (hidden, display:none, ancetre masque). Un piege a
    // focus qui compte des elements invisibles envoie le focus dans le vide.
    (el) => !el.hasAttribute('hidden') && el.offsetParent !== null
  );
}

/**
 * Rend l'arriere-plan inaccessible au clavier et aux lecteurs d'ecran.
 * @param {boolean} actif
 * @returns {void}
 */
function neutraliserArrierePlan(actif) {
  const supporteInert = 'inert' in HTMLElement.prototype;
  for (const id of ARRIERE_PLAN) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (supporteInert) el.inert = actif;
    // aria-hidden en complement (et en repli avant Safari 15.5 / Firefox 112) : `inert` est
    // ignore par quelques moteurs encore en circulation, et un lecteur d'ecran qui traverse la
    // feuille pour lire la seance derriere est pire qu'une feuille absente.
    if (actif) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  }
}

/**
 * Fabrique un bouton d'action de pied de feuille.
 * @param {Object} def { libelle, variante, action(fermer), fermeApres, disabled }
 * @param {Function} fermer
 * @returns {Element}
 */
function boutonAction(def, fermer) {
  if (def instanceof Node) return def;           // l'appelant fournit son propre noeud
  const variante = def.variante || def.type;
  const btn = h('button', {
    class: ['bouton', variante ? 'bouton-' + variante : null],
    type: 'button',
    disabled: def.disabled === true,
    dataset: def.nom ? { action: def.nom } : null
  }, def.libelle || 'OK');
  on(btn, 'click', () => {
    let garder = false;
    if (typeof def.action === 'function') {
      try { garder = def.action(fermer) === false; }
      catch (err) { console.error('[sheet] action « ' + (def.libelle || '?') + ' » en echec', err); }
    }
    // Par defaut une action de pied ferme la feuille. `fermeApres:false` ou une action qui
    // rend `false` la maintient ouverte : c'est le cas d'une validation qui echoue et doit
    // afficher son erreur SANS faire disparaitre la saisie de l'utilisateur.
    if (def.fermeApres === false || garder) return;
    fermer();
  });
  return btn;
}

/**
 * Ouvre une feuille basse.
 *
 * @param {Object} config
 * @param {string} config.titre titre affiche, en francais
 * @param {Node|Node[]|string} config.contenu corps de la feuille, deja construit par l'appelant
 * @param {Array} [config.actions] boutons de pied : { libelle, variante, action(fermer), fermeApres }
 *   ou des noeuds deja construits
 * @param {Function} [config.onFermer] appelee APRES la fermeture, EXACTEMENT UNE FOIS, sur tous
 *   les chemins : voile, croix, Echap, action de pied, remplacement par une autre feuille.
 *   C'est ici que la vue appelle router.fermerFeuille() pour retirer `?sheet=…` de l'URL.
 * @param {boolean} [config.fermable=true] false : ni Echap, ni voile, ni croix (confirmation
 *   destructrice qui exige un choix explicite)
 * @param {string} [config.classe] classe supplementaire sur la feuille ('pave', 'picker-exercice'...)
 * @returns {{fermer: Function, element: Element, corps: Element}}
 */
export function ouvrir(config) {
  const cfg = config || {};
  const conteneur = hote();
  if (!conteneur) throw new Error('sheet.ouvrir : #conteneur-feuille absent d\'index.html.');

  // Une feuille en remplace une autre. Fermeture IMMEDIATE (sans animation) de la precedente :
  // jouer deux transitions superposees ferait clignoter le voile et laisserait, l'espace d'un
  // quart de seconde, deux pieges a focus concurrents.
  if (ouverte) ouverte.fermerImmediat();

  const precedentFocus = document.activeElement;
  let fermee = false;
  let fermetureNotifiee = false;
  let minuterieSortie = 0;
  const detacher = [];

  /**
   * Previent l'appelant, UNE SEULE FOIS, quel que soit le chemin de fermeture (voile, croix,
   * Echap, action de pied, remplacement par une autre feuille, demontage). Sans cette garantie
   * le nettoyage de l'appelant — desabonnements, synchronisation de l'URL — ne s'executerait pas
   * quand la feuille est remplacee, puisque fermerImmediat annule justement la minuterie de sortie.
   * @returns {void}
   */
  function notifierFermeture() {
    if (fermetureNotifiee) return;
    fermetureNotifiee = true;
    if (typeof cfg.onFermer === 'function') {
      try { cfg.onFermer(); }
      catch (err) { console.error('[sheet] onFermer en echec', err); }
    }
  }

  const idTitre = 'feuille-titre-' + Date.now().toString(36);

  const voile = h('div', { class: 'feuille-voile' });
  const corps = h('div', { class: 'feuille-corps defilable' });
  if (cfg.contenu != null) {
    const enfants = Array.isArray(cfg.contenu) ? cfg.contenu : [cfg.contenu];
    for (const enfant of enfants) {
      if (enfant == null || enfant === false) continue;
      corps.appendChild(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
    }
  }

  const fermable = cfg.fermable !== false;

  const btnFermer = fermable
    ? h('button', { class: 'bouton-icone', type: 'button', 'aria-label': 'Fermer' },
        h('span', { 'aria-hidden': 'true' }, '×'))
    : null;

  const panneau = h('div', {
    class: ['feuille', cfg.classe || null],
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': idTitre
  },
    h('div', { class: 'feuille-poignee', 'aria-hidden': 'true' }),
    h('div', { class: 'feuille-entete' },
      h('h2', { class: 'feuille-titre', id: idTitre }, cfg.titre || ''),
      btnFermer
    ),
    corps
  );

  const actions = Array.isArray(cfg.actions) ? cfg.actions.filter(Boolean) : [];
  let pied = null;
  if (actions.length) {
    pied = h('div', { class: 'feuille-actions' });
    panneau.appendChild(pied);
  }

  conteneur.appendChild(voile);
  conteneur.appendChild(panneau);
  // Le conteneur d'index.html porte `hidden` et aucune classe : on lui pose la sienne ici
  // plutot que de le remplacer, conformement au regime de la zone A.
  conteneur.classList.add('feuille-conteneur');
  conteneur.hidden = false;

  /**
   * Fermeture sans animation ni deferrement : utilisee au remplacement et au demontage.
   * @param {boolean} [differerNotification] vrai quand l'appelant se charge lui-meme d'appeler
   *   notifierFermeture() apres une derniere etape (restitution du focus par finir()).
   */
  function fermerImmediat(differerNotification) {
    if (fermee) return;
    fermee = true;
    if (minuterieSortie) { clearTimeout(minuterieSortie); minuterieSortie = 0; }
    for (const off of detacher) { try { off(); } catch (_) { /* deja detache */ } }
    detacher.length = 0;
    if (ouverte && ouverte.panneau === panneau) ouverte = null;
    if (voile.parentNode) voile.parentNode.removeChild(voile);
    if (panneau.parentNode) panneau.parentNode.removeChild(panneau);
    // L'hote n'est referme que s'il ne contient plus rien : une feuille ouverte par-dessus
    // celle-ci pendant sa sortie ne doit pas se retrouver masquee par ce nettoyage.
    if (!conteneur.firstChild) {
      conteneur.setAttribute('data-ouvert', 'non');
      conteneur.hidden = true;
      neutraliserArrierePlan(false);
    }
    if (!differerNotification) notifierFermeture();
  }

  function fermer() {
    if (fermee) return;
    conteneur.setAttribute('data-ouvert', 'non');

    // On attend la fin de la transition de sortie pour retirer les noeuds, faute de quoi la
    // feuille disparaitrait d'un coup au lieu de glisser vers le bas. Le double garde-fou
    // (transitionend + minuterie) est indispensable : transitionend n'arrive pas si l'onglet
    // passe en arriere-plan, ni quand `prefers-reduced-motion` annule la duree.
    const finir = () => {
      // Notification differee : le focus doit d'abord retrouver sa place, car onFermer peut
      // deplacer le focus a son tour (rouvrir une feuille, ouvrir le pave) et aurait alors le
      // dernier mot annule par la restitution ci-dessous.
      fermerImmediat(true);
      // Le focus revient d'ou il venait : sans cela il retombe sur <body> et le prochain Tab
      // repart du tout premier lien de la page — l'utilisateur perd sa place dans la seance.
      if (precedentFocus && typeof precedentFocus.focus === 'function' &&
          document.contains(precedentFocus)) {
        try { precedentFocus.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
      }
      notifierFermeture();
    };

    const surFin = (ev) => { if (ev.target === panneau) finir(); };
    detacher.push(on(panneau, 'transitionend', surFin));
    minuterieSortie = setTimeout(finir, DELAI_SORTIE_MS);
  }

  if (fermable) {
    detacher.push(on(voile, 'click', fermer));
    if (btnFermer) detacher.push(on(btnFermer, 'click', fermer));
  }

  for (const def of actions) pied.appendChild(boutonAction(def, fermer));

  // ── Piege a focus ──────────────────────────────────────────────────────────
  // Pose sur le panneau et non sur le document : un ecouteur global intercepterait aussi les
  // touches du pave numerique, qui se superpose legitimement a la feuille.
  detacher.push(on(panneau, 'keydown', (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      if (!fermable) return;
      ev.preventDefault();
      ev.stopPropagation();
      fermer();
      return;
    }
    if (ev.key !== 'Tab') return;
    const liste = focusables(panneau);
    if (!liste.length) { ev.preventDefault(); return; }
    const premier = liste[0];
    const dernier = liste[liste.length - 1];
    // Le cycle est ferme a la main : sans cela, Tab depuis le dernier bouton sort de la feuille
    // et se met a parcourir la seance masquee derriere le voile.
    if (ev.shiftKey && (document.activeElement === premier || !panneau.contains(document.activeElement))) {
      ev.preventDefault(); dernier.focus();
    } else if (!ev.shiftKey && document.activeElement === dernier) {
      ev.preventDefault(); premier.focus();
    }
  }));

  neutraliserArrierePlan(true);

  // ⚠ L'OUVERTURE NE DOIT DEPENDRE D'AUCUN CADRE D'ANIMATION.
  //
  // Cette ligne posait auparavant data-ouvert dans un requestAnimationFrame. Or rAF ne
  // s'execute PAS quand la page n'est pas rendue : onglet en arriere-plan, application mise de
  // cote une seconde, throttling agressif du navigateur mobile. Dans ces cas la feuille se
  // montait completement — noeuds, boutons, ecouteurs — mais restait a visibility:hidden.
  // L'utilisateur voyait un ecran vide et se retrouvait bloque, sans la moindre erreur en
  // console. C'est un etat FONCTIONNEL : il ne peut pas dependre de la disponibilite d'une
  // frame de rendu.
  //
  // Le meme resultat visuel s'obtient sans rAF : on force le calcul de l'etat de depart en
  // lisant une propriete de mise en page, puis on pose l'attribut SYNCHRONEMENT. Le navigateur
  // a alors les deux etats et joue la transition. Si le rendu est suspendu, l'attribut est
  // quand meme pose et la feuille sera visible des la reprise.
  void panneau.offsetHeight;                    // reflow force : etablit l'etat de depart
  if (!fermee) {
    conteneur.setAttribute('data-ouvert', 'oui');
    // Le focus va au premier element utile de la feuille, en sautant la croix de fermeture :
    // atterrir sur « Fermer » est la pire des destinations pour un lecteur d'ecran.
    // v11 : et en sautant les CHAMPS DE SAISIE — focaliser un input a l'ouverture fait jaillir
    // le clavier du telephone avant meme qu'on ait lu la feuille (bug rapporte sur le
    // « Catalogue complet »). Celui qui veut chercher touche le champ ; la feuille, elle,
    // recoit le focus sur son panneau, et le lecteur d'ecran y entre comme avant.
    const liste = focusables(panneau);
    const estSaisie = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    const premierUtile = liste.find((el) => el !== btnFermer) || null;
    const cible = (!premierUtile || estSaisie(premierUtile)) ? panneau : premierUtile;
    if (cible === panneau) panneau.setAttribute('tabindex', '-1');
    try { cible.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
  }

  ouverte = { panneau, fermer, fermerImmediat };
  return { fermer, element: panneau, corps };
}

/** Ferme la feuille ouverte, s'il y en a une. Idempotent. */
export function fermer() {
  if (ouverte) ouverte.fermer();
}

/** @returns {boolean} vrai si une feuille est ouverte. */
export function estOuverte() {
  return !!ouverte;
}

export default { ouvrir, fermer, estOuverte };
