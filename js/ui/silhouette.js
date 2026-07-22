// ui/silhouette.js — planche anatomique cliquable, vue de FACE et vue de DOS.
//
// Style « ecorche de guide de musculation » : chaque muscle est une forme FERMEE aux volumes
// credibles (deltoide en calotte a trois faisceaux, pectoraux en eventail sur la ligne sternale,
// tablette des abdos et obliques, quadriceps a trois chefs dont la goutte du vaste interne,
// grand dorsal en ailes, fessiers en deux volumes, fourche des gastrocnemiens...), parcourue de
// stries fines qui suivent la direction de ses fibres — c'est le contraste trait ferme / strie
// legere qui fait « planche d'anatomie ».
//
// Les muscles sans categorie propre (cou, avant-bras, adducteurs, tibial anterieur, sartorius,
// rotule...) sont dessines quand meme : ils habillent le corps. Un muscle voisin d'un groupe
// qui l'entraine DE FAIT lui est rattache (avant-bras -> biceps de face et triceps de dos,
// trapezes vus de face -> dos) ; les autres sont purement decoratifs et ne captent AUCUN tap
// (pointer-events none), pour ne jamais voler le doigt aux groupes cliquables.
//
// Tout est construit en createElementNS via svg() de lib/dom.js — aucune image, aucun
// innerHTML, currentColor partout (juste en clair comme en sombre).
//
// Chaque groupe musculaire est un <g data-groupe="<categorie>" role="button" tabindex="0"> dont
// la categorie est EXACTEMENT une valeur de CATEGORIES (data/schema.js) ; le libelle du <title>
// vient de LIBELLES_CATEGORIES, jamais d'une chaine locale qui pourrait diverger.
//
// Geometrie : viewBox 0 0 120 260 par vue, axe du corps a x = 60, canon academique de 8 tetes
// (tete ≈ 30 unites pour 245 de haut, epaules ≈ 2 tetes de large, taille etroite, entrejambe a
// mi-hauteur, coudes a la taille, poignets a l'entrejambe, mains a mi-cuisse). Les muscles
// PAIRS sont dessines une fois (cote gauche) puis refletes par transform — la symetrie est
// ainsi garantie par construction.
//
// Ce module ne connait ni le store ni le routage : il rend un conteneur et rappelle
// onGroupe(categorie) au tap (delegation click + Entree/Espace). La mise en evidence du groupe
// choisi passe par data-actif='oui' (regles dans css/v2.css, section 14).

import { h, svg, delegate } from '../lib/dom.js';
import { LIBELLES_CATEGORIES } from '../data/schema.js';

// Reflexion par rapport a l'axe du corps : x -> 120 - x.
const MIROIR = 'translate(120 0) scale(-1 1)';

// pointer-events none sur TOUT l'habillage (contours, stries, muscles decoratifs) : seule la
// surface FERMEE d'un groupe [data-groupe] doit capter le tap, jamais un trait qui la recouvre.
const TRAIT = { class: 'silhouette-trait', 'pointer-events': 'none' };
const STRIE = { class: 'silhouette-strie', fill: 'none', 'pointer-events': 'none' };
const DECO = { 'pointer-events': 'none' }; // muscle decoratif : dessine au trait standard, inerte

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

// Crane : ovale qui s'affine vers la machoire (~30 unites de haut, canon de 8 tetes).
const D_CRANE =
  'M49.6 21.4 C49.6 12.8 54.1 7.2 60 7.2 C65.9 7.2 70.4 12.8 70.4 21.4 '
  + 'C70.4 25.9 69.3 29.9 67.2 32.9 C65.2 35.7 62.7 37.3 60 37.3 '
  + 'C57.3 37.3 54.8 35.7 52.8 32.9 C50.7 29.9 49.6 25.9 49.6 21.4 Z';

// Demi-corps gauche, d'un seul trait : cou, pente du trapeze, deltoide, bras legerement
// ecarte du buste (l'aisselle et le flanc restent lisibles), main a mi-cuisse, flanc, taille
// marquee, hanche, cuisse, mollet, pied, puis remontee interne jusqu'a l'entrejambe.
const D_DEMI_CORPS =
  'M55.1 35.7 '
  + 'C54.7 38.7 54.2 41.5 53.6 44.1 '     // cou
  + 'C48.9 46.3 41.9 47.9 35.9 49.7 '     // pente du trapeze vers l'acromion
  + 'C34.3 50.3 32.9 51 31.7 51.9 '       // pointe de l'epaule
  + 'C29.2 53.6 27.9 56.7 27.6 60.3 '     // galbe externe du deltoide
  + 'C27.4 63.5 27.9 66.7 29.1 69.7 '     // fin du deltoide
  + 'C28.1 74.9 27.3 80.3 26.7 85.7 '     // bras externe
  + 'C26.3 90.5 26.4 95.3 27.1 99.7 '     // vers le coude
  + 'C26.5 102.3 25.7 104.7 25.1 107.1 '  // pli du coude
  + 'C24.3 110.7 24.3 114.9 25.3 119.7 '  // bombe de l'avant-bras
  + 'C26.1 124.3 27 128.9 27.7 133.3 '    // fuselage vers le poignet
  + 'C27.1 136.1 26.9 139.3 27.3 142.7 '  // base de la main
  + 'C27.7 146.1 28.6 148.9 29.9 150.9 '  // doigts
  + 'C31.1 152.7 32.9 152.9 34.1 151.3 '  // bout de main arrondi
  + 'C34.9 150.1 35.3 148.3 35.3 145.9 '  // bord interne de la main
  + 'C35.1 141.7 34.9 137.7 34.7 133.9 '  // poignet interne
  + 'C34.3 128.3 34 122.5 34 116.9 '      // avant-bras interne
  + 'C34 111.9 34.3 107.1 34.9 102.5 '    // pli interne du coude
  + 'C35.7 96.9 36.7 91.3 37.7 85.9 '     // bras interne
  + 'C38.5 81.5 39.4 77.1 40.3 72.9 '     // aisselle
  + 'C41.5 75.7 42.3 79.3 42.9 83.7 '     // cage thoracique
  + 'C43.5 90.3 43.9 97.3 43.9 104.3 '    // flanc vers la taille
  + 'C43.9 108.5 43.3 112.1 42.1 115.3 '  // crete iliaque
  + 'C40.9 118.5 40.3 122.3 40.2 126.3 '  // hanche
  + 'C40.3 133.9 41 141.9 42.1 149.9 '    // cuisse externe haute
  + 'C43.2 157.9 43.9 166.5 44.3 175.5 '  // cuisse externe basse
  + 'C44.5 180.3 44.5 185.1 44.4 189.9 '  // genou externe
  + 'C44.3 193.7 44.1 197.3 43.9 200.7 '  // sous le genou
  + 'C43.5 205.5 43.9 210.7 45 216.3 '    // galbe du mollet
  + 'C46 221.7 46.6 227.1 46.9 232.5 '    // fuselage du mollet
  + 'C47.1 236.1 47.1 239.6 46.9 242.9 '  // cheville
  + 'C46.7 245.7 46 248.1 44.9 249.9 '    // cou-de-pied
  + 'C44.2 251.1 44.7 252.2 46.1 252.4 '  // arrondi du talon
  + 'L54.7 252.4 '                         // ligne du pied
  + 'C56.1 252.4 56.8 251.5 56.7 250.1 '  // bord interne du pied
  + 'C56.5 247.7 56.2 245.2 55.9 242.7 '  // cheville interne
  + 'C55.5 237.9 55.4 232.5 55.7 226.5 '  // mollet interne bas
  + 'C56 220.9 56.4 214.7 56.5 208.1 '    // bombe interne du mollet
  + 'C56.6 203.5 56.4 198.9 55.9 194.3 '  // genou interne
  + 'C56.5 185.7 57.3 176.7 58.1 167.5 '  // cuisse interne basse
  + 'C58.9 157.9 59.6 147.5 59.9 136.5 '  // cuisse interne haute
  + 'C60 135.1 60 133.7 59.9 132.5';      // entrejambe (mi-hauteur du corps)

// Ligne des phalanges : la main est la meme de face (dos de main, bras en pronation
// legere comme sur les planches) et de dos.
const S_MAIN = 'M28.3 144.3 C30.3 145.5 32.5 145.9 34.7 145.3';

function contourCorps() {
  return [
    trace(D_CRANE, TRAIT),
    ...paire(D_DEMI_CORPS, TRAIT),
    ...paire(S_MAIN, STRIE)
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Muscles — traces gauches (refletes par paire) ou symetriques ecrits en entier.
// Chaque zone est FERMEE (Z) pour que son remplissage — transparent au repos,
// teinte au survol et a la selection — couvre toute la surface tapable.
// ─────────────────────────────────────────────────────────────────────────────

// ── FACE : tete et cou ───────────────────────────────────────────────────────

// Machoire : la seule indication de visage — un ecorche n'a ni oeil ni bouche.
const S_MACHOIRE = 'M53.1 31.1 C55.1 33.5 57.4 34.9 60 35.1';

// Sterno-cleido-mastoidien : bande qui court de derriere la machoire au creux sternal.
// Decoratif (le cou n'est pas une categorie).
const D_COU =
  'M53.5 34.3 C54.7 37.9 56.5 41.3 58.9 44.3 C59.3 44.9 59.5 45.7 59.5 46.7 '
  + 'C58.7 46.9 57.9 46.7 57.3 46.1 C54.9 43.3 53.1 39.9 51.9 36.1 '
  + 'C51.7 35.3 52.3 34.5 53.5 34.3 Z';

// Clavicule : la barre en S leger qui separe cou et trapezes des pectoraux et deltoides.
const S_CLAVICULE = 'M59.1 49.5 C51.9 50.7 43.9 50.7 35.1 50.3';

// Trapeze superieur vu de FACE : le bourrelet entre la pente du cou et la clavicule.
// Rattache au groupe « dos » (c'est LE muscle du dos visible de face — hausses d'epaules).
const D_TRAPEZE_F =
  'M52.9 45.1 C48.5 46.9 42.9 48.3 36.9 49.7 C42.5 50.1 48.3 49.7 52.7 48.5 '
  + 'C52.9 47.4 53 46.3 52.9 45.1 Z';

// ── FACE et DOS : epaule ─────────────────────────────────────────────────────

// Deltoide : calotte posee entre clavicule et bras, qui descend en V vers son insertion
// a mi-bras. Identique de face et de dos ; les stries separent les trois faisceaux.
const D_DELTOIDE =
  'M34.3 50.9 C31.3 52.5 29.3 55.5 28.5 59.3 C27.7 62.9 28.1 66.7 29.5 69.9 '
  + 'C30.3 71.7 31.4 73.1 32.7 73.9 C34.1 72.3 35.4 69.9 36.4 67.1 '
  + 'C37.9 62.9 38.7 58.3 38.7 54.3 C38.7 52.7 37.7 51.3 36.1 50.5 '
  + 'C35.5 50.5 34.9 50.7 34.3 50.9 Z';
const S_DELTOIDE_1 = 'M30.5 54.7 C29.9 59.5 30.3 64.3 31.7 68.9';   // faisceau anterieur
const S_DELTOIDE_2 = 'M35.9 53.5 C35.3 58.7 34.3 63.9 32.9 68.7';   // faisceau moyen

// ── FACE : pectoraux ─────────────────────────────────────────────────────────

// Pectoral : eventail accroche a la clavicule et au sternum (x = 59.3 ; le miroir laisse la
// gouttiere sternale), qui plonge vers l'aisselle ou ses fibres convergent sous le deltoide.
const D_PECTORAL =
  'M42.3 52.5 C47.7 51.3 53.7 51 59.3 51.3 L59.3 53.9 '
  + 'C59.3 61.9 58.5 68.9 56.7 74.1 C55.1 78.5 52.1 80.7 48.1 80.1 '
  + 'C43.9 79.4 40.8 76.1 39.4 71.1 C38.3 64.7 39.3 57.9 42.3 52.5 Z';
const S_PECTORAL_1 = 'M58.1 55.9 C52.7 56.3 47.3 58.1 42.5 61.3';   // fibres claviculaires
const S_PECTORAL_2 = 'M58.1 61.7 C53.1 62.1 48.1 63.9 43.7 67.1';   // fibres sternales
const S_PECTORAL_3 = 'M57.3 68.1 C53.1 68.5 49.1 69.9 45.5 72.5';   // fibres abdominales

// ── FACE : bras ──────────────────────────────────────────────────────────────

// Biceps : fuseau bombe sur l'avant du bras, du bord du deltoide au pli du coude.
const D_BICEPS =
  'M31.3 72.1 C33.7 73.7 35.5 76.7 36.2 80.7 C36.9 85.1 36.4 90.1 34.9 94.5 '
  + 'C34.1 96.9 33 98.8 31.7 99.9 C29.9 98.5 28.4 95.9 27.6 92.5 '
  + 'C26.7 87.5 27.1 81.9 28.9 77.1 C29.5 75.3 30.3 73.5 31.3 72.1 Z';
const S_BICEPS_1 = 'M31.3 76.3 C32.3 81.5 32.5 87.1 31.7 92.5';
const S_BICEPS_2 = 'M34.1 79.1 C34.7 83.5 34.5 88.3 33.5 92.7';

// Brachial : la lentille qui pointe entre biceps et triceps juste au-dessus du coude.
const D_BRACHIAL =
  'M27.2 88.5 C26.7 92.3 26.8 96.1 27.7 99.7 C28.9 99.1 29.8 97.7 30.3 95.7 '
  + 'C30.9 92.9 30.5 90.1 29.3 87.5 C28.5 87.7 27.8 88 27.2 88.5 Z';

// Avant-bras : masse fuselee du coude au poignet. Le long supinateur nait AU-DESSUS du pli
// du coude, entre biceps et triceps — d'ou le bord haut en diagonale qui enjambe
// l'articulation (sans lui, un anneau vide ceinture le coude). La silhouette est la meme de
// face et de dos ; le groupe d'accueil change (biceps de face, triceps de dos).
const D_AVANT_BRAS =
  'M28.7 98.9 C26.9 102.9 25.7 107.5 25.3 112.7 C24.9 117.5 25.5 122.4 27.1 127.3 '
  + 'C27.8 129.5 28.7 131.3 29.9 132.9 L32.7 132.9 '
  + 'C33.5 130.9 34.1 128.3 34.4 125.1 C34.9 119.1 34.5 112.5 33.3 106.3 '
  + 'C32.9 104.3 32.4 102.5 31.9 100.9 C30.7 100.1 29.6 99.4 28.7 98.9 Z';
const S_AVANT_BRAS_1 = 'M30.5 102.5 C29.9 110.5 30.1 118.7 31.3 126.9';
const S_AVANT_BRAS_2 = 'M27.7 105.9 C27.1 112.5 27.5 119.5 29.1 125.9';

// ── FACE : sangle abdominale ─────────────────────────────────────────────────

// Grand droit (moitie gauche ; le miroir laisse la ligne blanche mediane) : la colonne qui
// court des pectoraux au pubis. Les stries transversales dessinent la « tablette ».
const D_RECTUS =
  'M52.1 80.3 C54.5 81.1 56.9 81.5 59.3 81.5 L59.3 128.7 '
  + 'C57.9 129.5 56.5 130.5 55.3 131.9 C53 126.7 51.5 120.7 50.9 113.7 '
  + 'C50.1 103.5 50.5 92.3 52.1 80.3 Z';
const S_RECTUS = [
  'M51.5 89.1 C54.1 90.1 56.7 90.5 59.3 90.5',
  'M51.1 98.3 C53.9 99.3 56.5 99.7 59.3 99.7',
  'M50.9 107.5 C53.7 108.5 56.5 108.9 59.3 108.9',
  'M51.3 116.9 C53.9 117.7 56.7 118.1 59.3 118.1'
];

// Oblique externe : le pan qui borde la tablette et epouse le flanc jusqu'a la crete iliaque.
const D_OBLIQUE =
  'M50.5 84.9 C47.3 87.7 45.1 91.7 44.1 96.7 C43.3 101.5 43.5 106.6 44.5 111.9 '
  + 'C45.7 114.7 47.5 117.1 49.9 119.1 C49 113.3 48.7 106.9 49 100.3 '
  + 'C49.2 95 49.7 89.9 50.5 84.9 Z';
const S_OBLIQUE_1 = 'M44.7 96.9 C46.3 98.1 47.6 99.9 48.5 102.1';
const S_OBLIQUE_2 = 'M44.5 103.5 C46.1 104.7 47.4 106.4 48.3 108.6';

// Dentele anterieur : trois digitations decoratives sous l'aisselle, entre pectoral
// et oblique — la signature des ecorches.
const S_SERRATUS = [
  'M41.9 75.5 C43.3 75.9 44.7 76.7 45.9 77.7',
  'M42.3 79.7 C43.7 80.1 45.1 80.7 46.3 81.7',
  'M42.9 83.7 C44.3 83.9 45.7 84.5 46.9 85.3'
];

// Pli inguinal : le V de l'aine, de la crete iliaque vers le pubis — il s'arrete au bord
// du grand droit (le prolonger jusqu'a l'axe nouait un paquet de traits sur le pubis).
const S_INGUINAL = 'M42.3 116.1 C46.5 121.5 51.1 125.7 55.9 128.7';

// Tenseur du fascia lata : le petit fuseau au coin de la hanche, entre l'aine et le
// vaste externe. Decoratif.
const D_TFL =
  'M41.7 120.3 C43.1 122.3 44 125.3 44.3 129.1 C44.6 132.7 44.3 136.5 43.3 140.3 '
  + 'C42.1 137.9 41.2 134.7 40.8 130.7 C40.5 127.1 40.8 123.5 41.7 120.3 Z';

// ── FACE : cuisse ────────────────────────────────────────────────────────────

// Quadriceps, chef par chef — les bords voisins se FROLENT (une seule couture visible,
// jamais de couloir vide entre deux chefs). Vaste externe : le galbe du dehors de la cuisse.
const D_VASTE_EXT =
  'M40.9 133.3 C40.3 142.3 40.6 151.9 41.9 161.3 C42.7 168.1 44 174.3 45.9 179.7 '
  + 'C46.1 176.9 46.5 172.9 46.9 167.9 C47.5 158.9 47 148.3 45.4 136.5 '
  + 'C44.1 135.1 42.6 134 40.9 133.3 Z';
const S_VASTE_EXT = 'M43.1 140.9 C44.3 149.9 44.7 159.7 44.3 169.5';

// Droit femoral : le fuseau central, du bassin au tendon quadricipital.
const D_DROIT_FEM =
  'M48.1 133.9 C50.2 137.9 51.4 143.5 51.9 150.7 C52.4 158.3 51.9 166.1 50.3 173.5 '
  + 'C49.7 176.6 48.9 179.1 47.9 181.3 C47.3 178.1 46.9 174.1 46.9 169.3 '
  + 'C46.9 159.7 47.3 147.9 48.1 133.9 Z';
const S_DROIT_FEM = 'M48.9 140.9 C49.7 150.3 49.8 160.9 49.1 171.5';

// Vaste interne : la « goutte » qui bombe juste au-dessus du genou, cote interne.
const D_VASTE_INT =
  'M50.1 168.5 C51.9 169.5 53.5 171.7 54.7 175.1 C55.5 177.7 55.7 180.5 55.2 183.3 '
  + 'C54.4 185.9 52.8 187.5 50.9 188.1 C49.8 186.1 49.1 183.1 48.9 179.3 '
  + 'C48.8 175.5 49.2 171.9 50.1 168.5 Z';
const S_VASTE_INT = 'M51.7 172.9 C52.7 175.7 53.1 178.9 52.9 182.3';

// Adducteurs : tout le versant interne de la cuisse, du pubis a la goutte du vaste
// interne. Decoratif.
const D_ADDUCTEURS =
  'M52.9 134.5 C55 133.9 57.1 133.7 59.3 133.9 C59.1 143.1 58.4 151.9 57.2 160.5 '
  + 'C56.5 165.1 55.6 169.3 54.5 173.1 C53.3 169.7 52.4 165.5 51.9 160.5 '
  + 'C51.1 151.7 51.4 143 52.9 134.5 Z';

// Sartorius : le ruban qui traverse la cuisse en echarpe, de la hanche au genou interne
// (il demarre sous le pli inguinal pour ne pas epaissir le coin de la hanche).
const S_SARTORIUS = 'M43.5 122.3 C48.1 130.3 51.6 140.1 53.9 151.7 C54.9 156.7 55.5 161.5 55.8 166.1';

// Rotule et tendon rotulien. Decoratifs.
const D_PATELLA =
  'M47.5 184.1 C47.3 187.3 48.4 189.9 50.4 191.1 C52.3 190.1 53.3 187.7 53.2 184.5 '
  + 'C51.4 183.1 49.3 183.1 47.5 184.1 Z';
const S_ROTULIEN = 'M50.4 191.3 C50.5 193.1 50.5 194.9 50.4 196.5';

// ── FACE : jambe ─────────────────────────────────────────────────────────────

// Loge anterieure, rattachee a « mollets » : un tap sur le bas de jambe, quelle que soit
// la vue, mene aux memes exercices. Tibial anterieur le long de la crete du tibia...
const D_TIBIAL =
  'M46.7 196.5 C45.9 202.3 45.7 208.9 46.3 216.1 C46.7 222.1 47.7 228.1 49.3 233.9 '
  + 'C50.1 230.7 50.6 226.9 50.8 222.5 C51.1 214.1 50.4 205.1 48.7 196.9 '
  + 'C48 196.5 47.3 196.4 46.7 196.5 Z';
const S_TIBIAL = 'M47.5 200.5 C47.1 208.1 47.4 216.3 48.5 224.5';
const S_TENDON_TIBIAL = 'M49.4 234.1 C50.1 237.5 51.1 240.7 52.3 243.5';

// ... peroniers en lisiere externe...
const D_PERONIERS =
  'M45.5 198.3 C44.7 203.1 44.4 208.5 44.7 214.5 C44.9 219.3 45.7 224.3 46.9 229.3 '
  + 'C47.2 227.1 47.3 224.5 47.2 221.5 C47 213.5 46.5 205.7 45.5 198.3 Z';

// ... et bombe interne du gastrocnemien, visible de face derriere le tibia.
const D_GASTRO_MED_F =
  'M54.3 196.9 C55.5 200.4 56.1 204.9 56.2 210.1 C56.3 214.5 55.9 218.9 55.1 223.1 '
  + 'C54 219.9 53.3 215.9 53 211.1 C52.8 206.1 53.2 201.3 54.3 196.9 Z';

// Ligne des orteils.
const S_ORTEILS = 'M46.3 248.3 C49.7 249.5 53.3 249.6 56.3 248.7';

// ── DOS : nuque et tronc ─────────────────────────────────────────────────────

// Cordes de la nuque (splenius), de l'occiput a la pointe du trapeze. Decoratives.
const S_NUQUE = 'M56.9 36.9 C56.5 39.9 55.9 42.7 55.1 45.3';

// Trapeze (moitie gauche ; le miroir laisse la gouttiere des epineuses) : le grand
// cerf-volant, de l'occiput a l'acromion puis en pointe jusqu'aux dorsales basses.
// Stries : faisceaux superieur, moyen et inferieur.
const D_TRAPEZE_D =
  'M59.3 38.9 C56.3 42.5 51.9 45.7 46.7 48.1 C42.9 49.8 39.1 50.5 35.5 50.3 '
  + 'C40.1 53.3 44.9 56.5 49.3 60.5 C53.9 64.7 56.9 69.9 58.3 76.1 '
  + 'C58.9 79.1 59.3 82.3 59.3 85.7 L59.3 94.9 Z';
const S_TRAPEZE_1 = 'M57.1 43.5 C53.3 46.5 49.1 48.9 44.7 50.5';
const S_TRAPEZE_2 = 'M58.5 55.3 C53.9 55.1 49.3 54.1 45.1 52.3';
const S_TRAPEZE_3 = 'M58.9 87.9 C56.7 80.5 52.9 73.7 47.5 67.7';

// Infra-epineux (et petit rond) : la plaque sur l'omoplate, entre trapeze et deltoide.
const D_INFRA =
  'M39.5 55.5 C42.5 57.1 45.3 59.7 47.7 62.9 C46.3 65.5 44.2 67.3 41.7 68.5 '
  + 'C39.9 66.1 38.8 62.9 38.5 59.1 C38.8 57.7 39.1 56.5 39.5 55.5 Z';
const S_INFRA = 'M40.3 59.7 C42.7 60.7 44.8 62.2 46.5 64.1';

// Grand dorsal : l'aile qui part de l'aisselle, s'accroche a la colonne sous le trapeze
// et fond vers la taille. Son bord bas rejoint la colonne en biais (aponevrose lombaire).
const D_DORSAL =
  'M40.5 69.9 C44.8 73.5 49.9 76.1 55.7 77.7 L59.3 78.7 L59.3 104.9 '
  + 'C55.3 104.3 51.5 102.5 48.1 99.5 C43.9 95.3 41.3 89.3 40.5 81.5 '
  + 'C40.2 77.7 40.2 73.9 40.5 69.9 Z';
const S_DORSAL_1 = 'M44.1 77.9 C47.8 84.3 52.3 89.9 57.3 94.7';
const S_DORSAL_2 = 'M42.1 81.9 C44.5 89.3 48.3 95.9 53.5 101.7';
const S_DORSAL_3 = 'M46.9 75.9 C50.7 80.7 54.9 84.5 59.1 87.3';

// Lombaires : les deux colonnes des erecteurs, visibles sous le bord du grand dorsal.
const D_LOMBAIRES =
  'M55.3 106.1 C56.6 106.5 57.9 106.8 59.3 106.9 L59.3 123.9 '
  + 'C57.9 123.5 56.5 122.5 55.3 121.1 C54.7 116.1 54.7 111.1 55.3 106.1 Z';
const S_LOMBAIRES = 'M57.3 108.9 L57.4 120.9';

// ── DOS : bras ───────────────────────────────────────────────────────────────

// Triceps : meme fuseau que le biceps vu de dos ; les deux stries qui convergent vers le
// tendon dessinent le « fer a cheval » (vaste externe / chef long).
const D_TRICEPS =
  'M31.3 71.9 C33.7 73.5 35.5 76.5 36.2 80.5 C36.9 84.9 36.4 89.9 34.9 94.3 '
  + 'C34.1 96.7 33 98.6 31.7 99.7 C29.9 98.3 28.4 95.7 27.6 92.3 '
  + 'C26.7 87.3 27.1 81.7 28.9 76.9 C29.5 75.1 30.3 73.3 31.3 71.9 Z';
const S_TRICEPS_1 = 'M34.3 76.9 C34.7 81.7 34.3 86.9 32.9 91.5';
const S_TRICEPS_2 = 'M29.5 77.9 C29.1 82.7 29.6 87.7 31.1 92.1';
const S_TRICEPS_3 = 'M30.7 93.3 C31.5 94.7 32.7 94.9 33.7 93.7';   // arc du fer a cheval

// Pointe du coude (olecrane). Decorative.
const S_OLECRANE = 'M30.3 100.9 C31.1 102.1 32.3 102.5 33.5 102.1';

// ── DOS : bassin ─────────────────────────────────────────────────────────────

// Moyen fessier : le coussin au creux de la hanche, au-dessus du grand fessier.
const D_MOYEN_FESSIER =
  'M42.7 116.5 C45.5 115.3 48.5 115.1 51.3 115.9 C50.7 119.9 49.1 123.3 46.5 126.1 '
  + 'C44.5 123.7 43.2 120.5 42.7 116.5 Z';

// Grand fessier : le volume rond du sacrum au pli, fibres en biais vers le femur.
const D_GRAND_FESSIER =
  'M45.9 119.9 C50.3 118.3 54.9 118.5 59.3 120.7 L59.3 127.9 '
  + 'C59.3 136.9 57.1 144.3 52.7 149.5 C48.9 151.1 45.5 149.9 43.1 146.1 '
  + 'C41.3 141.3 41.5 134.9 43.7 127.5 C44.3 124.9 45 122.3 45.9 119.9 Z';
const S_FESSIER_1 = 'M55.3 123.3 C52.1 129.5 49.9 136.7 48.7 144.7';
const S_FESSIER_2 = 'M50.5 121.9 C47.9 127.3 46.1 133.5 45.1 140.5';

// Pli sous-fessier. Decoratif.
const S_PLI_FESSIER = 'M45.3 149.9 C49.5 151.7 54.1 151.9 58.7 150.5';

// ── DOS : cuisse ─────────────────────────────────────────────────────────────

// Ischio-jambiers en DEUX masses : biceps femoral dehors, semi-tendineux dedans, qui se
// separent au-dessus du creux poplite (les deux tendons decoratifs l'encadrent).
const D_ISCHIO_EXT =
  'M44.1 152.5 C46.2 154.5 47.8 158.1 48.6 163.1 C49.6 169.5 49.5 176.3 48.3 182.7 '
  + 'C47.7 185.7 46.8 188.3 45.7 190.5 C44.9 187.7 44.4 184.1 44.2 179.7 '
  + 'C43.8 170.7 43.8 161.6 44.1 152.5 Z';
const D_ISCHIO_INT =
  'M51.1 153.3 C53.4 155.1 55.2 158.5 56.1 163.3 C57.1 169.5 56.9 176.1 55.5 182.5 '
  + 'C54.7 185.7 53.6 188.3 52.3 190.3 C50.9 187.5 49.9 183.3 49.5 177.9 '
  + 'C49 169.7 49.5 161.3 51.1 153.3 Z';
const S_ISCHIO_1 = 'M45.9 158.9 C46.9 167.3 47.1 176.5 46.3 185.3';
const S_ISCHIO_2 = 'M53.1 159.9 C54.1 167.9 54.1 176.3 53.1 184.5';
const S_TENDON_ISCHIO_1 = 'M45.9 190.9 C45.5 193.9 45.3 196.9 45.3 199.9';
const S_TENDON_ISCHIO_2 = 'M52.7 190.9 C53.1 193.9 53.3 196.9 53.3 199.9';

// ── DOS : mollet ─────────────────────────────────────────────────────────────

// Gastrocnemiens : les deux chefs de la fourche (l'interne descend plus bas), puis le
// soleaire qui depasse de chaque cote et le tendon d'Achille en double trait.
const D_GASTRO_EXT =
  'M45.1 198.3 C44.3 203.1 44.1 208.5 44.7 214.1 C45.2 218.9 46.2 223.3 47.7 227.1 '
  + 'C48.6 223.9 49.2 219.9 49.4 215.3 C49.7 209.3 49.2 203.5 47.9 197.9 '
  + 'C46.9 197.7 45.9 197.9 45.1 198.3 Z';
const D_GASTRO_INT =
  'M50.9 197.7 C53.1 198.1 54.9 199.9 56.1 202.9 C56.5 207.5 56.3 212.7 55.5 218.3 '
  + 'C54.9 221.7 54 224.7 52.9 227.3 C51.5 223.9 50.5 219.7 50.1 214.7 '
  + 'C49.8 208.9 50 203.1 50.9 197.7 Z';
const S_FOURCHE = 'M49.9 200.9 C49.8 205.9 49.8 210.9 49.9 215.9';
const S_GASTRO_1 = 'M46.3 201.9 C45.9 207.5 46.2 213.5 47.1 219.5';
const S_GASTRO_2 = 'M53.3 201.9 C53.9 207.1 53.9 212.9 53.1 218.9';
const D_SOLEAIRE_EXT =
  'M45.1 216.9 C45.2 221.7 45.9 226.3 47.3 230.7 C47.7 228.7 47.9 226.3 47.8 223.7 '
  + 'C47.7 220.9 47.2 218.3 46.4 215.9 C45.9 216.1 45.5 216.4 45.1 216.9 Z';
const D_SOLEAIRE_INT =
  'M54.7 220.9 C54.5 225.1 53.9 229.1 52.9 232.9 C53.9 232.5 54.8 231.3 55.4 229.5 '
  + 'C56 226.7 56.1 223.7 55.7 220.7 C55.4 220.7 55 220.7 54.7 220.9 Z';
const S_ACHILLE_1 = 'M49.5 231.9 C49.4 236.1 49.5 240.3 49.9 244.3';
const S_ACHILLE_2 = 'M51.7 231.9 C51.8 236.1 51.7 240.3 51.3 244.3';

// Coussin du talon. Decoratif.
const S_TALON = 'M46.7 248.1 C49.9 249.3 53.3 249.4 56.1 248.5';

// ─────────────────────────────────────────────────────────────────────────────
// Les deux vues
// ─────────────────────────────────────────────────────────────────────────────

// Trait par defaut (muscles) volontairement plus fin que le contour (silhouette-trait, 1.6)
// et plus affirme que les stries (silhouette-strie, 0.7) : trois epaisseurs = effet planche.
const ATTRS_DESSIN = {
  class: 'silhouette-dessin',
  viewBox: '0 0 120 260',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.05,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
};

function vueFace() {
  return svg('svg', Object.assign({ 'aria-label': 'Vue de face' }, ATTRS_DESSIN),
    contourCorps(),
    // Habillage sous-jacent : machoire, cou, clavicules, dentele, aine, orteils.
    paire(S_MACHOIRE, STRIE),
    paire(D_COU, DECO),
    paire(S_CLAVICULE, TRAIT),
    S_SERRATUS.map((d) => paire(d, STRIE)),
    paire(S_ORTEILS, STRIE),
    // Trapezes vus de face : c'est du « dos » sous le doigt.
    groupe('dos', paire(D_TRAPEZE_F)),
    groupe('epaules', [
      ...paire(D_DELTOIDE),
      ...paire(S_DELTOIDE_1, STRIE), ...paire(S_DELTOIDE_2, STRIE)
    ]),
    groupe('pectoraux', [
      ...paire(D_PECTORAL),
      ...paire(S_PECTORAL_1, STRIE), ...paire(S_PECTORAL_2, STRIE), ...paire(S_PECTORAL_3, STRIE)
    ]),
    // Bras complet : biceps, brachial et avant-bras repondent tous « biceps ».
    groupe('biceps', [
      ...paire(D_BICEPS), ...paire(D_BRACHIAL), ...paire(D_AVANT_BRAS),
      ...paire(S_BICEPS_1, STRIE), ...paire(S_BICEPS_2, STRIE),
      ...paire(S_AVANT_BRAS_1, STRIE), ...paire(S_AVANT_BRAS_2, STRIE)
    ]),
    groupe('abdos', [
      ...paire(D_RECTUS), ...paire(D_OBLIQUE),
      S_RECTUS.map((d) => paire(d, STRIE)),
      ...paire(S_OBLIQUE_1, STRIE), ...paire(S_OBLIQUE_2, STRIE)
    ]),
    // Adducteurs, tenseur du fascia lata et sartorius habillent la cuisse SOUS les quadriceps.
    paire(D_ADDUCTEURS, DECO),
    paire(D_TFL, DECO),
    paire(S_SARTORIUS, STRIE),
    groupe('quadriceps', [
      ...paire(D_VASTE_EXT), ...paire(D_DROIT_FEM), ...paire(D_VASTE_INT),
      ...paire(S_VASTE_EXT, STRIE), ...paire(S_DROIT_FEM, STRIE), ...paire(S_VASTE_INT, STRIE)
    ]),
    groupe('mollets', [
      ...paire(D_TIBIAL), ...paire(D_PERONIERS), ...paire(D_GASTRO_MED_F),
      ...paire(S_TIBIAL, STRIE), ...paire(S_TENDON_TIBIAL, STRIE)
    ]),
    // Finitions par-dessus : V de l'aine, rotule et son tendon.
    paire(S_INGUINAL, TRAIT),
    paire(D_PATELLA, DECO),
    paire(S_ROTULIEN, STRIE)
  );
}

function vueDos() {
  return svg('svg', Object.assign({ 'aria-label': 'Vue de dos' }, ATTRS_DESSIN),
    contourCorps(),
    // Habillage : nuque, pointe du coude, plis sous-fessiers, talons.
    paire(S_NUQUE, STRIE),
    paire(S_OLECRANE, STRIE),
    paire(S_TALON, STRIE),
    groupe('epaules', [
      ...paire(D_DELTOIDE),
      ...paire(S_DELTOIDE_1, STRIE), ...paire(S_DELTOIDE_2, STRIE)
    ]),
    // Tout le tronc arriere repond « dos » : trapeze, infra-epineux, grand dorsal, lombaires.
    groupe('dos', [
      ...paire(D_TRAPEZE_D), ...paire(D_INFRA), ...paire(D_DORSAL), ...paire(D_LOMBAIRES),
      ...paire(S_TRAPEZE_1, STRIE), ...paire(S_TRAPEZE_2, STRIE), ...paire(S_TRAPEZE_3, STRIE),
      ...paire(S_INFRA, STRIE),
      ...paire(S_DORSAL_1, STRIE), ...paire(S_DORSAL_2, STRIE), ...paire(S_DORSAL_3, STRIE),
      ...paire(S_LOMBAIRES, STRIE)
    ]),
    // Bras complet : triceps et avant-bras (extenseurs) repondent tous « triceps ».
    groupe('triceps', [
      ...paire(D_TRICEPS), ...paire(D_AVANT_BRAS),
      ...paire(S_TRICEPS_1, STRIE), ...paire(S_TRICEPS_2, STRIE), ...paire(S_TRICEPS_3, STRIE),
      ...paire(S_AVANT_BRAS_1, STRIE), ...paire(S_AVANT_BRAS_2, STRIE)
    ]),
    groupe('fessiers', [
      ...paire(D_MOYEN_FESSIER), ...paire(D_GRAND_FESSIER),
      ...paire(S_FESSIER_1, STRIE), ...paire(S_FESSIER_2, STRIE)
    ]),
    paire(S_PLI_FESSIER, STRIE),
    groupe('ischios', [
      ...paire(D_ISCHIO_EXT), ...paire(D_ISCHIO_INT),
      ...paire(S_ISCHIO_1, STRIE), ...paire(S_ISCHIO_2, STRIE)
    ]),
    paire(S_TENDON_ISCHIO_1, STRIE),
    paire(S_TENDON_ISCHIO_2, STRIE),
    groupe('mollets', [
      ...paire(D_GASTRO_EXT), ...paire(D_GASTRO_INT),
      ...paire(D_SOLEAIRE_EXT), ...paire(D_SOLEAIRE_INT),
      ...paire(S_FOURCHE, STRIE), ...paire(S_GASTRO_1, STRIE), ...paire(S_GASTRO_2, STRIE),
      ...paire(S_ACHILLE_1, STRIE), ...paire(S_ACHILLE_2, STRIE)
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
 * @returns {Element & { element: Element, selectionner: (categorie: string|null) => void }}
 *   Le retour EST l'element racine, augmente de `element` (auto-reference) et `selectionner` :
 *   l'appelant peut aussi bien l'ajouter tel quel comme enfant (vue muscles) que destructurer
 *   `{ element, selectionner }` (feuille anatomique du composeur) — la couture ne peut plus
 *   casser d'un cote ou de l'autre. `selectionner` pose data-actif='oui' sur le groupe
 *   demande — dans les DEUX vues quand la categorie y figure deux fois (dos, epaules,
 *   mollets) — et le retire de tous les autres.
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

  element.element = element;
  element.selectionner = selectionner;
  return element;
}

export default { creerSilhouette };
