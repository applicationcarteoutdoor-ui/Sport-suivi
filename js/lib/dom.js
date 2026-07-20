// lib/dom.js — micro-helpers de construction du DOM.
// Zero VDOM, zero diff, zero innerHTML : le contrat de rendu de l'application interdit qu'un
// noeud soit remplace par un noeud qu'il ne possede pas. Ces helpers ne savent que CONSTRUIRE ;
// la mutation ciblee (textContent, classList, setAttribute) est faite par les fragments eux-memes.

const NS_SVG = 'http://www.w3.org/2000/svg';

// Attributs qui doivent etre poses comme PROPRIETE et non via setAttribute : sur un input, la
// propriete `value` porte la valeur courante, l'attribut ne porte que la valeur initiale.
const PROPRIETES = new Set(['value', 'checked', 'selected', 'indeterminate']);

/**
 * Applique un objet d'attributs a un element.
 * @param {Element} el
 * @param {Object|null} attrs
 * @param {boolean} estSvg true si l'element vit dans l'espace de noms SVG
 */
function appliquerAttrs(el, attrs, estSvg) {
  if (!attrs) return;
  for (const cle in attrs) {
    const val = attrs[cle];

    // class accepte une chaine ou un tableau (les valeurs fausses du tableau sont ignorees,
    // ce qui permet d'ecrire ['ligne', estActive && 'ligne--active']).
    if (cle === 'class' || cle === 'className') {
      const nom = Array.isArray(val) ? val.filter(Boolean).join(' ') : (val == null ? '' : String(val));
      // ⚠ Sur un element SVG, `className` est un SVGAnimatedString en LECTURE SEULE :
      //    l'affectation echoue silencieusement. setAttribute fonctionne dans les deux mondes.
      if (nom) el.setAttribute('class', nom); else el.removeAttribute('class');
      continue;
    }

    // style en objet : { position:'sticky', '--hauteur':'56px' }.
    if (cle === 'style' && val && typeof val === 'object') {
      for (const prop in val) {
        const v = val[prop];
        if (v == null || v === false) continue;
        // setProperty est le seul chemin qui accepte les proprietes personnalisees (--x).
        if (prop.startsWith('--')) el.style.setProperty(prop, String(v));
        else el.style[prop] = v;
      }
      continue;
    }

    // dataset en objet : { action:'valider', id } -> data-action, data-id.
    if (cle === 'dataset' && val && typeof val === 'object') {
      for (const d in val) {
        const v = val[d];
        if (v == null || v === false) continue;
        // ⚠ SVGElement expose bien `dataset`, mais on passe par setAttribute pour garder un
        //    comportement identique dans les deux espaces de noms (et la casse maitrisee).
        el.setAttribute('data-' + d, String(v));
      }
      continue;
    }

    if (val == null) continue;                       // null / undefined : attribut absent

    if (PROPRIETES.has(cle) && !estSvg) { el[cle] = val; continue; }

    // ⚠ aria-* et data-* ne sont JAMAIS des attributs booleens : aria-hidden="false" et
    //    aria-expanded="false" sont porteurs de sens. Les traiter comme booleens (et donc
    //    omettre l'attribut quand la valeur est false) casse toute l'accessibilite.
    if (cle.startsWith('aria-') || cle.startsWith('data-') || cle === 'role') {
      el.setAttribute(cle, String(val));
      continue;
    }

    // Attributs booleens HTML (disabled, hidden, required...) : leur PRESENCE vaut vrai,
    // meme avec la valeur "false". D'ou l'omission pure et simple quand val === false.
    if (val === true) { el.setAttribute(cle, ''); continue; }
    if (val === false) { el.removeAttribute(cle); continue; }

    el.setAttribute(cle, String(val));
  }
}

/**
 * Ajoute des enfants : Element, chaine, nombre, null/false (ignores) ou tableau (aplati).
 * @param {Element} el
 * @param {Array} enfants
 */
function ajouterEnfants(el, enfants) {
  for (const enfant of enfants) {
    if (enfant == null || enfant === false || enfant === true || enfant === '') continue;
    if (Array.isArray(enfant)) { ajouterEnfants(el, enfant); continue; }
    if (enfant instanceof Node) { el.appendChild(enfant); continue; }
    // Tout le reste (chaine, nombre) devient du TEXTE : createTextNode n'interprete jamais
    // le contenu, ce qui rend l'echappement HTML sans objet dans toute l'application.
    el.appendChild(document.createTextNode(String(enfant)));
  }
}

// Un objet est considere comme une table d'attributs s'il est simple : ni noeud, ni tableau.
const estAttrs = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node);

/**
 * Cree un element HTML.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {...(Node|string|number|Array|null)} enfants
 * @returns {Element}
 */
export function h(tag, attrs, ...enfants) {
  const el = document.createElement(tag);
  if (estAttrs(attrs)) appliquerAttrs(el, attrs, false);
  else if (attrs !== undefined && attrs !== null) enfants.unshift(attrs);
  ajouterEnfants(el, enfants);
  return el;
}

/**
 * Cree un element SVG. Indispensable a ui/chart.js : createElement('path') fabrique un
 * HTMLUnknownElement invisible, seul createElementNS produit une vraie forme.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {...(Node|string|number|Array|null)} enfants
 * @returns {Element}
 */
export function svg(tag, attrs, ...enfants) {
  const el = document.createElementNS(NS_SVG, tag);
  if (estAttrs(attrs)) appliquerAttrs(el, attrs, true);
  else if (attrs !== undefined && attrs !== null) enfants.unshift(attrs);
  ajouterEnfants(el, enfants);
  return el;
}

/**
 * Abonne un ecouteur et rend sa fonction de desabonnement.
 * @param {EventTarget} el
 * @param {string} type
 * @param {Function} fn
 * @param {Object|boolean} [opts]
 * @returns {() => void} desabonnement, idempotent
 */
export function on(el, type, fn, opts) {
  el.addEventListener(type, fn, opts);
  return () => el.removeEventListener(type, fn, opts);
}

/**
 * Delegation d'evenement : un seul ecouteur par vue, pose sur la racine.
 * Le rappel recoit (evenement, cible) ou cible est l'element correspondant au selecteur.
 * @param {Element} racine
 * @param {string} type
 * @param {string} selecteur
 * @param {(ev: Event, cible: Element) => void} fn
 * @param {Object|boolean} [opts]
 * @returns {() => void} desabonnement
 */
export function delegate(racine, type, selecteur, fn, opts) {
  const relais = (ev) => {
    // ⚠ ev.target peut etre un noeud TEXTE (selection) ou un noeud hors document : closest
    //    n'existe que sur Element, d'ou le garde-fou.
    const depart = ev.target instanceof Element ? ev.target : null;
    if (!depart) return;
    const cible = depart.closest(selecteur);
    // ⚠ contains est obligatoire : closest peut remonter AU-DESSUS de la racine et faire
    //    reagir la vue a un clic qui ne lui appartient pas.
    if (!cible || !racine.contains(cible)) return;
    fn(ev, cible);
  };
  racine.addEventListener(type, relais, opts);
  return () => racine.removeEventListener(type, relais, opts);
}

/**
 * Vide un element de tous ses enfants.
 * @param {Element} el
 */
export function vider(el) {
  // ⚠ Jamais `innerHTML = ''` : c'est un point d'entree d'analyse HTML, et la regle
  //    « zero innerHTML » ne tient que si elle est SANS exception (rien a auditer ensuite).
  while (el.firstChild) el.removeChild(el.firstChild);
}
