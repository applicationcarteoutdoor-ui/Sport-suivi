// ui/silhouette.js — silhouette anatomique cliquable, vue de FACE et vue de DOS.
//
// Style « ecorche epure » inspire des planches anatomiques classiques : un contour de corps
// net, chaque groupe musculaire delimite par son propre trace ferme, quelques stries internes
// legeres pour suggerer la fibre. Tout est construit en createElementNS via svg() de lib/dom.js
// — aucune image, aucun innerHTML, currentColor partout (juste en clair comme en sombre).
//
// Chaque groupe musculaire est un <g data-groupe="<categorie>" role="button" tabindex="0"> dont
// la categorie est EXACTEMENT une valeur de CATEGORIES (data/schema.js) ; le libelle du <title>
// vient de LIBELLES_CATEGORIES, jamais d'une chaine locale qui pourrait diverger.
//
// Geometrie : viewBox 0 0 120 260 par vue, axe du corps a x = 60, proportions academiques
// (tete ≈ 1/8 de la hauteur, coudes a la taille, poignets a l'entrejambe, epaules plus larges
// que le bassin). Les muscles PAIRS sont dessines une fois (cote gauche) puis refletes par
// transform — la symetrie est ainsi garantie par construction.
//
// Ce module ne connait ni le store ni le routage : il rend un conteneur et rappelle
// onGroupe(categorie) au tap (delegation click + Entree/Espace). La mise en evidence du groupe
// choisi passe par data-actif='oui' (regles dans css/v2.css, section 14).

import { h, svg, delegate } from '../lib/dom.js';
import { LIBELLES_CATEGORIES } from '../data/schema.js';

// Reflexion par rapport a l'axe du corps : x -> 120 - x.
const MIROIR = 'translate(120 0) scale(-1 1)';

const TRAIT = { class: 'silhouette-trait' };
const STRIE = { class: 'silhouette-strie', fill: 'none' };

/** Un trace simple. */
const trace = (d, attrs) => svg('path', Object.assign({ d }, attrs || null));

/** Le meme trace et son symetrique — pour tout ce que le corps possede en double. */
const paire = (d, attrs) => [
  trace(d, attrs),
  svg('path', Object.assign({ d, transform: MIROIR }, attrs || null))
];

/**
 * Groupe musculaire tapable. Le <title> (premier enfant, regle d'accessibilite des lecteurs
 * d'ecran) porte le libelle francais officiel de la categorie.
 * @param {string} categorie valeur de CATEGORIES
 * @param {Element[]} formes traces du muscle (et ses stries)
 * @returns {SVGElement}
 */
function groupe(categorie, formes) {
  return svg('g', {
    class: 'silhouette-groupe',
    'data-groupe': categorie,
    role: 'button',
    tabindex: 0
  },
    svg('title', null, LIBELLES_CATEGORIES[categorie] || categorie),
    formes
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contour du corps — commun aux deux vues (la silhouette est la meme de face
// et de dos ; seuls les muscles dessines dessus changent).
// ─────────────────────────────────────────────────────────────────────────────

// Crane : ovale plein de proportions academiques (~1/8 de la hauteur totale du corps).
const D_CRANE =
  'M49.2 21.8 C49.2 12.4 53.8 6.6 60 6.6 C66.2 6.6 70.8 12.4 70.8 21.8 '
  + 'C70.8 29.6 66.4 36 60 36 C53.6 36 49.2 29.6 49.2 21.8 Z';

// Demi-corps gauche, d'un seul trait : cou, trapeze, epaule, bras legerement ecarte, main,
// aisselle, flanc, hanche, jambe, pied, puis remontee interne jusqu'a l'entrejambe.
const D_DEMI_CORPS =
  'M55.8 34.2 '
  + 'C55.4 38.6 54.6 42.4 53.4 45.6 '     // cou
  + 'C47.4 47.2 40.6 48 34 49.6 '         // ligne du trapeze vers la pointe d'epaule
  + 'C29.6 51.4 27.1 55.3 27 59.8 '       // galbe externe du deltoide
  + 'C26.9 63.6 26.3 71 25.4 78.6 '       // bras externe
  + 'C24.9 83.6 24.6 89 24.9 94.2 '       // coude
  + 'C25.3 102 26.2 110.6 27.6 118.4 '    // avant-bras externe
  + 'C28 121.6 28.3 124.6 28.5 127.4 '    // poignet
  + 'C27.1 130.6 26.5 134.4 26.7 138.4 '  // base de la main
  + 'C26.9 142.8 27.6 146.2 28.7 148.8 '  // doigts
  + 'C29.5 150.4 31.1 150.8 32.5 150 '    // bout de main arrondi
  + 'C33.9 149.2 34.7 147.4 34.7 145.2 '  // remontee du bord interne
  + 'C34.8 139.2 34.9 133.6 34.9 128.4 '  // poignet interne
  + 'C34.5 117.4 34.1 105.6 33.9 95.4 '   // avant-bras interne
  + 'C33.5 87 35.9 78.2 39.3 71.2 '       // bras interne jusqu'a l'aisselle
  + 'C41.3 82 42.7 92.8 43.7 103.4 '      // flanc vers la taille
  + 'C40.7 110.4 39 117.2 38.7 124.2 '    // crete de la hanche
  + 'C38.4 145.2 39.5 166 42.1 186.2 '    // cuisse externe jusqu'au genou
  + 'C42.6 193 42.9 199.4 43.6 205.2 '    // genou puis naissance du mollet
  + 'C45 215.6 46.2 225.6 47.1 235.2 '    // mollet externe vers la cheville
  + 'C46.7 240.6 45.4 245.2 43.3 249 '    // cheville vers l'avant du pied
  + 'C42.2 251.2 43.2 252.6 45.3 252.6 '  // pointe arrondie
  + 'L56.5 252.6 '                         // ligne du pied
  + 'C58 252.6 58.8 251.6 58.6 250 '      // bord interne du pied
  + 'C57.6 245.4 56.8 240.8 56.3 236.4 '  // cheville interne
  + 'C55.8 228.8 55.4 221.4 55.3 214.2 '  // mollet interne
  + 'C55.4 206.2 55.5 198.2 55.7 190.4 '  // genou interne
  + 'C56.6 172 58 154.6 59.9 137.8';      // cuisse interne jusqu'a l'entrejambe

function contourCorps() {
  return [trace(D_CRANE, TRAIT), ...paire(D_DEMI_CORPS, TRAIT)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Muscles — traces gauches (refletes par paire) ou symetriques ecrits en entier.
// Chaque zone est FERMEE (Z) pour que son remplissage — transparent au repos,
// teinte au survol et a la selection — couvre toute la surface tapable.
// ─────────────────────────────────────────────────────────────────────────────

// Deltoide : calotte ronde posee entre le trapeze et le bras. Identique face et dos.
const D_DELTOIDE =
  'M34.6 50.8 C30.7 52.6 28.4 56.1 28.3 60.2 C28.2 63.4 28.9 66.4 30.4 68.9 '
  + 'C33.6 67.9 36.4 65.3 38.3 61.8 C39.2 57.7 38 53.7 35.4 50.7 '
  + 'C35.1 50.7 34.8 50.7 34.6 50.8 Z';
const S_DELTOIDE = 'M31.6 53.8 C31 58 31.4 62.2 32.8 65.9';

// Pectoral : eventail accroche au sternum (x = 59.4), bord bas en courbe.
const D_PECTORAL =
  'M43.3 53.5 C48.4 52.1 54.2 51.7 59.4 52.5 L59.4 57.1 '
  + 'C59.4 65.8 58.5 72.8 55.3 77 C50.4 79.6 45.1 77.7 42.1 72.5 '
  + 'C40.3 66.4 40.7 59.5 43.3 53.5 Z';
const S_PECTORAL_1 = 'M45.5 58.3 C50 59.5 54.5 60.1 58.5 59.9';
const S_PECTORAL_2 = 'M45.1 65.5 C49.7 67.1 54.2 67.7 58.5 67.3';

// Biceps : fuseau bombe sur l'avant du bras, entre deltoide et coude.
const D_BICEPS =
  'M30.3 70.6 C33 72 35.1 74.6 36.1 78 C37.1 82.5 36.5 87.8 34.6 92.3 '
  + 'C33.4 94.8 31.8 96.4 30.1 96.9 C28.3 94.3 27.3 90.3 27.1 85.8 '
  + 'C26.9 80.3 28 74.9 30.3 70.6 Z';
const S_BICEPS = 'M31.7 74.6 C32.8 79.7 32.7 85.5 31.4 90.8';

// Abdominaux : colonne centrale unique, du bas des pectoraux au bassin.
const D_ABDOS =
  'M52.2 80.7 C57.4 82.3 62.6 82.3 67.8 80.7 C69.2 89.1 69.6 98.2 68.9 107.2 '
  + 'C68.3 115.8 66.2 122.8 62.8 128 L57.2 128 C53.8 122.8 51.7 115.8 51.1 107.2 '
  + 'C50.4 98.2 50.8 89.1 52.2 80.7 Z';
const S_ABDOS = [
  'M60 82.5 L60 127',                                  // ligne blanche mediane
  'M52.9 90.5 C57.6 91.9 62.4 91.9 67.1 90.5',         // etages de la « tablette »
  'M52.7 99.9 C57.5 101.3 62.5 101.3 67.3 99.9',
  'M53.1 109.1 C57.7 110.3 62.3 110.3 66.9 109.1'
];

// Quadriceps : masse avant de la cuisse, de la hanche au genou.
const D_QUADRICEPS =
  'M40.7 133.1 C45.9 136.1 51.4 137.4 56.6 136.7 C57.7 146.1 57.4 156.8 55.9 166.8 '
  + 'C54.7 175.6 52.5 183.4 49.5 189.7 C46.7 185.3 44 178.5 42 170.3 '
  + 'C39.7 160.3 39.1 146.2 40.7 133.1 Z';
const S_QUADRICEPS_1 = 'M46.7 141.1 C48.1 152.1 47.9 165.1 45.9 177.9';
const S_QUADRICEPS_2 = 'M53.5 172.1 C54.6 177 54.2 182 52.1 185.9'; // goutte du vaste interne

// Jambe avant (tibia) : rattachee a la categorie « mollets » — un tap sur le bas de
// jambe, quelle que soit la vue, doit mener aux memes exercices.
const D_JAMBE_AVANT =
  'M46.5 197.7 C49.6 199.9 52.8 200.7 55.4 200.1 C55.9 208.5 55.2 217.6 53.5 226.4 '
  + 'C52.4 231.6 50.9 235.6 49.1 238.3 C47.4 234.9 46 229.9 45.2 224.1 '
  + 'C44.2 215.2 44.6 205.9 46.5 197.7 Z';
const S_JAMBE_AVANT = 'M50.7 202.5 C51.7 210.5 51.3 220.3 49.7 229.9';

// Trapeze : cerf-volant symetrique, de la nuque a la pointe mediane du dos.
const D_TRAPEZE =
  'M60 42.7 C55 45.5 48.3 47.9 41.7 49.3 C47.7 52.5 52.7 57.5 55.4 63.4 '
  + 'C57.6 68.7 58.9 75.5 59.4 83.1 L60 89.9 L60.6 83.1 '
  + 'C61.1 75.5 62.4 68.7 64.6 63.4 C67.3 57.5 72.3 52.5 78.3 49.3 '
  + 'C71.7 47.9 65 45.5 60 42.7 Z';

// Grand dorsal : aile qui descend de l'aisselle vers la taille.
const D_DORSAL =
  'M41.3 69.1 C45.7 73.5 50.6 76.7 55.7 78.5 L57.5 79.7 '
  + 'C57.7 88.3 56.3 96.6 53.4 104.1 C49.9 101.9 46.5 98.3 44.2 93.5 '
  + 'C41.6 87.6 40.7 78.5 41.3 69.1 Z';
const S_DORSAL = 'M45.3 78.1 C47.7 84.1 50.3 90.1 52.9 95.3';

// Lombaires : colonne basse entre les deux ailes, jusqu'au bassin.
const D_LOMBAIRES =
  'M55.5 96.9 C58.5 97.9 61.5 97.9 64.5 96.9 C65.3 104.7 65 112.6 63.7 120.1 '
  + 'C61.4 122.1 58.6 122.1 56.3 120.1 C55 112.6 54.7 104.7 55.5 96.9 Z';
const S_COLONNE = 'M60 92.1 L60 119.5';

// Triceps : fuseau arriere du bras — meme emplacement que le biceps, stries en fer a cheval.
const D_TRICEPS =
  'M29.9 70.1 C32.6 71.7 34.7 74.3 35.8 77.7 C36.8 82.2 36.3 87.6 34.4 92.1 '
  + 'C33.2 94.7 31.6 96.3 29.9 96.8 C28.1 94.2 27.1 90.2 26.9 85.7 '
  + 'C26.7 80.2 27.7 74.5 29.9 70.1 Z';
const S_TRICEPS_1 = 'M30.5 74.7 C30 80 30.3 85.3 31.9 90.1';
const S_TRICEPS_2 = 'M33.7 76.5 C34 81 33.5 85.5 32 89.5';

// Fessier : galbe rond sous les lombaires.
const D_FESSIER =
  'M45.5 120.5 C50.2 119.1 55.2 119.3 59.4 121.1 L59.4 125.5 '
  + 'C59.4 134.6 57.6 141.9 53.5 146.5 C49.5 147.9 45.7 146.1 43.5 141.5 '
  + 'C41.7 135.4 42.4 127.5 45.5 120.5 Z';
const S_FESSIER = 'M47.1 126.1 C49.9 130.5 51.7 135.6 52.5 141.1';

// Ischio-jambiers : arriere de la cuisse, du pli fessier au creux du genou.
const D_ISCHIOS =
  'M43 150.7 C47.7 152.9 52.6 153.7 56.9 153.1 C57.7 162.1 57.2 171.8 55.4 180.6 '
  + 'C54 186.6 52 191.1 49.5 194.1 C46.8 189.9 44.6 183.5 43.1 175.3 '
  + 'C41.6 166.8 41.6 158.2 43 150.7 Z';
const S_ISCHIOS_1 = 'M47.3 157.1 C48.3 166.1 48.1 176.3 46.7 185.9';
const S_ISCHIOS_2 = 'M52.7 158.1 C53.4 166.7 52.8 176.1 50.9 185.1';

// Mollet (gastrocnemiens) : double losange arriere, avec la fourche des deux chefs.
const D_MOLLET =
  'M46.3 198.7 C49.3 197.1 52.4 197.1 55 198.9 C56.2 205.5 56.3 213 55.2 220.6 '
  + 'C54.1 227.4 52.3 233.1 50 237.7 C47.8 233.5 46.1 227.5 45.1 220.6 '
  + 'C44 213 44.4 205.5 46.3 198.7 Z';
const S_MOLLET_1 = 'M50.5 200.7 L50.3 213.5';
const S_MOLLET_2 = 'M47.5 219.5 C49 222.7 51.5 223.5 53.5 221.3';

// ─────────────────────────────────────────────────────────────────────────────
// Les deux vues
// ─────────────────────────────────────────────────────────────────────────────

const ATTRS_DESSIN = {
  class: 'silhouette-dessin',
  viewBox: '0 0 120 260',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.3,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
};

function vueFace() {
  return svg('svg', Object.assign({ 'aria-label': 'Vue de face' }, ATTRS_DESSIN),
    contourCorps(),
    // Details de planche : clavicules et rotules, purement decoratifs.
    paire('M44.6 52.8 C49.8 51.2 55.2 50.6 59.4 50.8', TRAIT),
    paire('M46.4 191.4 C47.9 193.2 50.3 193.4 52.1 192', TRAIT),
    groupe('epaules', [...paire(D_DELTOIDE), ...paire(S_DELTOIDE, STRIE)]),
    groupe('pectoraux', [
      ...paire(D_PECTORAL),
      ...paire(S_PECTORAL_1, STRIE), ...paire(S_PECTORAL_2, STRIE)
    ]),
    groupe('biceps', [...paire(D_BICEPS), ...paire(S_BICEPS, STRIE)]),
    groupe('abdos', [trace(D_ABDOS), S_ABDOS.map((d) => trace(d, STRIE))]),
    groupe('quadriceps', [
      ...paire(D_QUADRICEPS),
      ...paire(S_QUADRICEPS_1, STRIE), ...paire(S_QUADRICEPS_2, STRIE)
    ]),
    groupe('mollets', [...paire(D_JAMBE_AVANT), ...paire(S_JAMBE_AVANT, STRIE)])
  );
}

function vueDos() {
  return svg('svg', Object.assign({ 'aria-label': 'Vue de dos' }, ATTRS_DESSIN),
    contourCorps(),
    groupe('epaules', [...paire(D_DELTOIDE), ...paire(S_DELTOIDE, STRIE)]),
    groupe('dos', [
      trace(D_TRAPEZE),
      ...paire(D_DORSAL),
      trace(D_LOMBAIRES),
      trace(S_COLONNE, STRIE),
      ...paire(S_DORSAL, STRIE)
    ]),
    groupe('triceps', [
      ...paire(D_TRICEPS),
      ...paire(S_TRICEPS_1, STRIE), ...paire(S_TRICEPS_2, STRIE)
    ]),
    groupe('fessiers', [...paire(D_FESSIER), ...paire(S_FESSIER, STRIE)]),
    groupe('ischios', [
      ...paire(D_ISCHIOS),
      ...paire(S_ISCHIOS_1, STRIE), ...paire(S_ISCHIOS_2, STRIE)
    ]),
    groupe('mollets', [
      ...paire(D_MOLLET),
      ...paire(S_MOLLET_1, STRIE), ...paire(S_MOLLET_2, STRIE)
    ])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fabrique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit la silhouette double (face + dos).
 *
 * @param {{ onGroupe?: (categorie: string) => void }} [options]
 * @returns {{ element: Element, selectionner: (categorie: string|null) => void }}
 *   `selectionner` pose data-actif='oui' sur le groupe demande — dans les DEUX vues quand la
 *   categorie y figure deux fois (epaules, mollets) — et le retire de tous les autres.
 */
export function creerSilhouette(options) {
  const o = options || {};

  const element = h('div', { class: 'silhouette' },
    h('figure', { class: 'silhouette-vue' },
      vueFace(),
      h('figcaption', { class: 'silhouette-legende' }, 'Face')
    ),
    h('figure', { class: 'silhouette-vue' },
      vueDos(),
      h('figcaption', { class: 'silhouette-legende' }, 'Dos')
    )
  );

  function selectionner(categorie) {
    for (const g of element.querySelectorAll('[data-groupe]')) {
      if (categorie != null && g.getAttribute('data-groupe') === categorie) {
        g.setAttribute('data-actif', 'oui');
      } else {
        g.removeAttribute('data-actif');
      }
    }
  }

  function activer(cible) {
    const categorie = cible.getAttribute('data-groupe');
    if (!categorie) return;
    selectionner(categorie);
    if (typeof o.onGroupe === 'function') o.onGroupe(categorie);
  }

  // Delegation posee sur le conteneur de la silhouette elle-meme : les ecouteurs vivent et
  // meurent avec le noeud, rien a detacher chez l'appelant.
  delegate(element, 'click', '[data-groupe]', (ev, cible) => activer(cible));
  delegate(element, 'keydown', '[data-groupe]', (ev, cible) => {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    ev.preventDefault();
    activer(cible);
  });

  return { element, selectionner };
}

export default { creerSilhouette };
