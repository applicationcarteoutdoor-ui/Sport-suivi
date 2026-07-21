// ui/icons.js — la bibliotheque de pictogrammes de l'application.
//
// C'est la fondation VISUELLE de la v2 : chaque pack, chaque exercice, chaque commande a ici son
// dessin. Aucune image, aucune police d'icones, aucun sprite : tout est construit en
// createElementNS via svg() de lib/dom.js. Consequences directes :
//   - rien a telecharger, rien a mettre en cache, rien qui puisse manquer hors ligne ;
//   - aucune chaine de balisage nulle part, donc aucun probleme d'echappement ;
//   - stroke='currentColor' partout : une icone prend la couleur de son texte, donc elle est
//     juste en theme clair ET en theme sombre SANS le moindre re-rendu a la bascule. C'est la
//     raison pour laquelle aucune couleur litterale n'apparait dans ce fichier — la tete des
//     silhouettes, seul remplissage du fichier, est en fill='currentColor' pour la meme raison.
//
// Style de dessin, impose et uniforme (voir GABARIT ci-dessous) : viewBox 0 0 24 24, trait 1.75,
// bouts et jonctions arrondis. Les silhouettes sont CONSTRUITES : tete = petit cercle PLEIN
// (r ~1.6), membres et buste = traits arrondis, et c'est la POSTURE qui raconte l'exercice.
// Le materiel a une grammaire fixe : barre = long fut + disques (cercles), haltere = fut court +
// deux petits rectangles arrondis, poulie = petit cercle + cable oblique, banc = trait EPAIS,
// kettlebell = cercle + anse. Chaque dessin reste entre 6 et 9 elements : au-dela, l'icone
// devient une bouillie a 20 px, taille a laquelle elle sera reellement lue dans une puce.

import { svg } from '../lib/dom.js';

// ─────────────────────────────────────────────────────────────────────────────
// Primitives de trace
// ─────────────────────────────────────────────────────────────────────────────
// Noms d'une lettre, volontairement : ces fonctions apparaissent des centaines de fois plus bas,
// et un nom long y noierait la GEOMETRIE, qui est la seule chose lisible dans ce fichier.

const L = (x1, y1, x2, y2) => svg('line', { x1, y1, x2, y2 });
const C = (cx, cy, r) => svg('circle', { cx, cy, r });
const E = (cx, cy, rx, ry) => svg('ellipse', { cx, cy, rx, ry });
const P = (d) => svg('path', { d });
const PL = (points) => svg('polyline', { points });
const R = (x, y, width, height, rx) => svg('rect', { x, y, width, height, rx });

/** Trait EPAIS : la matiere d'un banc, d'une assise, d'un plateau de presse. */
const T = (x1, y1, x2, y2) => svg('line', { x1, y1, x2, y2, 'stroke-width': 2.75 });

// ─────────────────────────────────────────────────────────────────────────────
// Formes recurrentes
// ─────────────────────────────────────────────────────────────────────────────
// Une tete, une barre chargee, un haltere ou un montant de machine reviennent dans une trentaine
// de dessins. Les factoriser garantit qu'une barre a TOUJOURS la meme allure d'une icone a
// l'autre — c'est la moitie du travail d'une famille d'icones coherente.

/** Tete de silhouette : cercle PLEIN (le seul remplissage du fichier, en currentColor). */
const tete = (cx, cy, r) => svg('circle', { cx, cy, r: r == null ? 1.6 : r, fill: 'currentColor' });

/** Barre chargee : le fut, plus un DISQUE (cercle) a chaque extremite. */
function barreChargee(y, x1, x2, rayon) {
  const r = rayon == null ? 2.4 : rayon;
  return [
    L(x1, y, x2, y),
    C(x1 + r + 0.6, y, r),
    C(x2 - r - 0.6, y, r)
  ];
}

/** Haltere : fut court + deux petits rectangles arrondis centres sur ses extremites. */
function haltere(cx, cy, demiLong) {
  const dl = demiLong == null ? 2.5 : demiLong;
  return [
    L(cx - dl, cy, cx + dl, cy),
    R(cx - dl - 0.9, cy - 1.6, 1.8, 3.2, 0.8),
    R(cx + dl - 0.9, cy - 1.6, 1.8, 3.2, 0.8)
  ];
}

/** Ligne de sol, reference commune a tous les mouvements au poids du corps. */
const sol = (y) => L(2.5, y == null ? 20.6 : y, 21.5, y == null ? 20.6 : y);

/** Montant vertical d'une machine a poulie (colonne gauche ou droite du cadre). */
const montant = (x) => L(x, 3.4, x, 20.5);

// ═════════════════════════════════════════════════════════════════════════════
// ICONES — dictionnaire nom -> fonction de dessin.
// Chaque fonction rend un TABLEAU d'elements SVG ; l'enveloppe (viewBox, stroke, titre) est
// posee une fois pour toutes par icone() plus bas.
// ═════════════════════════════════════════════════════════════════════════════

export const ICONES = {

  // ───────────────────────────────────────────────────────────────────────────
  // Packs et materiel (8) — ce que l'utilisateur voit sur la grille d'entree
  // ───────────────────────────────────────────────────────────────────────────

  // Silhouette debout, bras ouverts : la personne SANS materiel.
  'poids-du-corps': () => [
    tete(12, 4.1),
    L(12, 5.7, 12, 13),
    L(12, 7.6, 7, 11.6),
    L(12, 7.6, 17, 11.6),
    L(12, 13, 8.6, 20.4),
    L(12, 13, 15.4, 20.4)
  ],

  // ⚠ Haltere et barre partagent la meme grammaire (un fut, des masses au bout) : sans un
  //   contraste FRANC ils deviennent la meme icone a 20 px. Le contraste est double : la
  //   LONGUEUR du fut (l'haltere tient au centre, la barre traverse le cadre) et la NATURE des
  //   masses (rectangles arrondis contre grands disques ronds).
  'halteres': () => [
    L(7.6, 12, 16.4, 12),
    R(4.6, 7.8, 3, 8.4, 1.5),
    R(16.4, 7.8, 3, 8.4, 1.5)
  ],

  'barre': () => barreChargee(12, 1.8, 22.2, 3.3).concat([
    L(9.8, 10.6, 9.8, 13.4),
    L(14.2, 10.6, 14.2, 13.4)
  ]),

  // La grammaire de la poulie : petite roue en haut, cable OBLIQUE, poignee perpendiculaire.
  'poulie': () => [
    L(5, 3, 17, 3),
    C(11, 5.5, 2.3),
    L(12.6, 7.2, 16.6, 15.2),
    L(14.4, 17.6, 20, 14.8)
  ],

  // Colonne de plaques entre deux rails, et le cable qui y plonge : sans le cable, le rectangle
  // raye se lit comme une liste de texte et non comme une machine.
  'machine': () => [
    L(5, 2.8, 5, 21.2),
    L(19, 2.8, 19, 21.2),
    L(5, 2.8, 19, 2.8),
    L(12, 2.8, 12, 8.4),
    R(8.2, 8.4, 7.6, 9.8, 1.2),
    L(8.2, 11.7, 15.8, 11.7),
    L(8.2, 15, 15.8, 15)
  ],

  // v4 : le cardio, c'est quelqu'un qui TRANSPIRE (demande utilisateur) — coureur en foulee,
  // buste penche, gouttes qui volent derriere la tete. Le coeur est libere pour les favoris.
  'cardio': () => [
    tete(13.8, 4.6),
    L(13.3, 6.2, 11.4, 12.2),
    L(12.7, 7.8, 16.6, 9.8),
    L(13, 7.5, 9.4, 9),
    PL('11.4,12.2 14.6,15.2 13.8,20.2'),
    PL('11.4,12.2 8.2,15.6 5.8,19.4'),
    L(9.6, 2.8, 9, 4.6),
    L(7.2, 4.6, 6.6, 6.4)
  ],

  // Le coeur — reserve aux seances FAVORITES (jamais au cardio, voir ci-dessus).
  // ⚠ UN SEUL trace ferme, obligatoirement : la regle CSS du favori remplit ce chemin
  //   (fill: currentColor) — deux sous-chemins ou un trace ouvert rempliraient de travers.
  'coeur': () => [
    P('M12 20.1 C 6.3 16.4, 3.3 13, 3.3 9.7 C 3.3 7, 5.4 5, 8 5 '
      + 'C 9.6 5, 11.1 5.8, 12 7.2 C 12.9 5.8, 14.4 5, 16 5 '
      + 'C 18.6 5, 20.7 7, 20.7 9.7 C 20.7 13, 17.7 16.4, 12 20.1 Z')
  ],

  'elastique': () => [
    P('M5.2 12 C 8.5 5.5, 15.5 18.5, 18.8 12'),
    C(3.4, 12, 1.7),
    C(20.6, 12, 1.7)
  ],

  // Pack « gainage » : la planche, MIROIR de l'icone de l'exercice « planche » (tete a gauche
  // au lieu de la droite). La silhouette est reconnue immediatement, et la repetition entre un
  // pack et l'exercice qu'il contient est une aide plutot qu'une confusion.
  'gainage': () => [
    tete(4.7, 9.7),
    L(6.2, 10.5, 19.6, 18.2),
    L(6.6, 11, 7.8, 18.6),
    L(4.6, 18.7, 10.2, 18.7),
    sol()
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Dos — tractions. Le corps est SUSPENDU sous la barre ; le discriminant est la PRISE :
  // mains larges coudes ouverts (pronation), mains serrees coudes devant et jambes croisees
  // (supination), poignees perpendiculaires et corps droit (neutre).
  // ───────────────────────────────────────────────────────────────────────────

  'tractions-pronation': () => [
    L(3, 3.5, 21, 3.5),
    PL('7.4,3.5 6.8,7.2 10,9.2'),
    PL('16.6,3.5 17.2,7.2 14,9.2'),
    tete(12, 7.3),
    L(12, 9.2, 12, 14.8),
    L(12, 14.8, 10.4, 20.4),
    L(12, 14.8, 13.6, 20.4)
  ],

  'tractions-supination': () => [
    L(3, 3.5, 21, 3.5),
    PL('10,3.5 8.9,7 11,9.1'),
    PL('14,3.5 15.1,7 13,9.1'),
    tete(12, 7.3),
    L(12, 9.2, 12, 14.4),
    PL('12,14.4 9.7,17.2 10.7,20.3'),
    PL('12,14.4 14.3,17.2 13.3,20.3')
  ],

  'tractions-neutre': () => [
    L(3, 3.5, 21, 3.5),
    L(9.5, 3.5, 9.5, 6.1),
    L(14.5, 3.5, 14.5, 6.1),
    PL('9.5,6.1 9.2,8.1 10.6,9.3'),
    PL('14.5,6.1 14.8,8.1 13.4,9.3'),
    tete(12, 7.6),
    L(12, 9.5, 12, 20.3)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Pectoraux et triceps — pompes. Tete a DROITE dans toute la famille, corps oblique d'un seul
  // trait, bras FLECHI (coude casse) : c'est le milieu de la repetition. Ce qui change entre les
  // variantes est ce que touchent les mains et les pieds.
  // ───────────────────────────────────────────────────────────────────────────

  'pompes': () => [
    tete(19.3, 9.5),
    L(17.8, 10.3, 4.6, 17.2),
    L(4.6, 17.2, 3.8, 18.7),
    PL('17.3,10.9 15.2,14.8 17.9,18.7'),
    sol()
  ],

  // Pieds SURELEVES sur un banc (trait epais) : le corps plonge vers la tete.
  'pompes-declinees': () => [
    T(2.5, 10, 8.8, 10),
    L(7.6, 9.4, 18.4, 14),
    tete(20.1, 14.7),
    PL('18,14.8 16.2,17.4 18.8,18.7'),
    sol()
  ],

  // Mains JOINTES : le losange sous la poitrine est le seul detail qui separe cette icone des
  // pompes classiques, il est donc dessine en grand, bras tendu jusqu'a lui.
  'pompes-diamant': () => [
    tete(19.3, 9.5),
    L(17.8, 10.3, 4.6, 17.2),
    L(17.3, 10.9, 16.3, 16.6),
    P('M16.3 16.7 L18 18.5 L16.3 20.3 L14.6 18.5 Z'),
    sol()
  ],

  // Mains SURELEVEES sur un banc : regression des pompes classiques. Absente du catalogue livre,
  // mais un exercice cree par l'utilisateur peut la reclamer par son identifiant.
  'pompes-surelevees': () => [
    T(15.2, 12.4, 21.5, 12.4),
    tete(18.9, 7.7),
    L(17.4, 8.6, 4.6, 17.4),
    L(16.9, 9.3, 17.7, 10.9),
    sol()
  ],

  // ── Dips ───────────────────────────────────────────────────────────────────

  // Deux barres paralleles, bras qui POUSSENT dessus, jambes repliees derriere.
  'dips-barres': () => [
    L(2.5, 8.5, 8.5, 8.5),
    L(15.5, 8.5, 21.5, 8.5),
    tete(12, 5.7),
    L(12, 7.3, 12, 14.4),
    L(12, 9.2, 7.6, 8.7),
    L(12, 9.2, 16.4, 8.7),
    PL('12,14.4 14.4,17.2 12.6,20.4')
  ],

  // Mains derriere soi sur un banc, jambes tendues devant : la posture inverse des dips barres.
  'dips-banc': () => [
    T(2.5, 10.6, 9.6, 10.6),
    tete(12.8, 6.4),
    L(12.8, 8, 12.8, 14.4),
    L(12.8, 9.6, 8.8, 9.9),
    L(12.8, 14.4, 19.6, 16.6),
    L(19.6, 16.6, 19.8, 20.4),
    sol()
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Pectoraux — developpes. Toujours : personne ALLONGEE sur un banc trait epais, bras
  // verticaux, charge au-dessus. Le discriminant est la charge (barre a disques ou halteres)
  // et l'inclinaison du banc.
  // ───────────────────────────────────────────────────────────────────────────

  'developpe-couche-barre': () => barreChargee(6.2, 3, 21, 2.2).concat([
    L(9, 6.2, 9, 13.6),
    L(15, 6.2, 15, 13.6),
    L(4.8, 14.2, 17.6, 14.2),
    tete(19.4, 14),
    T(3, 17, 21, 17)
  ]),

  'developpe-couche-halteres': () => [
    T(3.5, 17, 20.5, 17),
    L(4.8, 14.4, 16.6, 14.4),
    tete(18.6, 14.2),
    L(9.8, 14, 7.2, 9.2),
    L(12.6, 14, 15.2, 9.2),
    R(5.9, 5.4, 2.6, 3.6, 1),
    R(13.9, 5.4, 2.6, 3.6, 1)
  ],

  // Le dossier INCLINE (trait epais en diagonale) est le discriminant.
  'developpe-incline-barre': () => barreChargee(4.8, 8, 22, 2).concat([
    T(4, 19.6, 14.4, 9.6),
    tete(16, 8.6),
    L(14.8, 9.6, 15.6, 5)
  ]),

  // ───────────────────────────────────────────────────────────────────────────
  // Epaules — developpe militaire : DEBOUT, barre chargee verrouillee au-dessus de la tete,
  // bras tendus en V renverse.
  // ───────────────────────────────────────────────────────────────────────────

  'developpe-militaire': () => barreChargee(4.2, 4.5, 19.5, 2).concat([
    L(8.6, 4.6, 10.6, 10.2),
    L(15.4, 4.6, 13.4, 10.2),
    tete(12, 8.6),
    L(12, 10.2, 12, 15.4),
    L(12, 15.4, 9.8, 20.6),
    L(12, 15.4, 14.2, 20.6)
  ]),

  // ───────────────────────────────────────────────────────────────────────────
  // Dos — tirages horizontaux et verticaux
  // ───────────────────────────────────────────────────────────────────────────

  // Buste CHARNIERE, barre tiree sous la poitrine : vue de profil, le disque est un cercle.
  'rowing-barre': () => [
    tete(4.8, 6.6),
    L(6.4, 7.2, 14.6, 10.6),
    PL('14.6,10.6 16,15 15,20.4'),
    L(9.8, 8.6, 10.4, 14.2),
    L(6.6, 14.6, 14.2, 14.6),
    C(10.4, 14.6, 2.5),
    sol()
  ],

  // Un genou sur le banc, buste penche, l'autre bras tire l'haltere vers la hanche.
  'rowing-halteres': () => [
    T(2.8, 15.2, 10.2, 15.2),
    L(9.4, 11.8, 8, 14.6),
    L(9, 11.8, 17.6, 8.6),
    tete(19.4, 8.2),
    L(14.6, 9.6, 14.2, 13),
    ...haltere(14.2, 14.2, 2.3)
  ],

  // Assis au sol, poulie BASSE a droite, dos droit, cable tire vers le ventre.
  'rowing-poulie-basse': () => [
    montant(20.8),
    C(19.2, 17.8, 1.6),
    L(17.7, 17.2, 11.8, 14.8),
    tete(5.8, 8.2),
    L(5.8, 9.8, 6.8, 16.6),
    L(6.8, 16.6, 12.8, 16.8),
    L(6.4, 11.4, 11.8, 14.8),
    sol()
  ],

  // Poulie HAUTE, barre LARGE au-dessus, personne assise dessous : le contraire exact des
  // extensions triceps, ou la barre est courte et la personne debout a cote.
  'tirage-vertical': () => [
    montant(20.8),
    C(19.2, 4.9, 1.6),
    L(17.7, 5.5, 13.2, 7.7),
    L(5.5, 8, 17, 8),
    L(7.8, 8, 9.9, 13.8),
    L(14.8, 8, 13.7, 13.8),
    tete(11.8, 13),
    L(11.8, 14.6, 11.8, 19.6)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Chaine posterieure et jambes
  // ───────────────────────────────────────────────────────────────────────────

  // Les deux GROS disques posent la barre AU SOL : rien d'autre dans la famille ne le fait.
  // Buste penche, genoux plies, bras tendu jusqu'a la barre.
  'souleve-de-terre': () => [
    L(2.8, 16.6, 21.2, 16.6),
    C(6, 16.6, 3.2),
    C(18, 16.6, 3.2),
    tete(11.6, 4.4),
    L(11.9, 6, 13.6, 10.8),
    PL('13.6,10.8 12.4,13.8 12.9,16.2'),
    L(11.6, 6.8, 11, 16.2),
    sol(19.8)
  ],

  // Barre sur les epaules (sous la tete), hanches basses, genoux ouverts : la flexion est
  // FRANCHE, c'est elle qui dit « squat ».
  'squat': () => barreChargee(6.8, 3.2, 20.8, 2.1).concat([
    tete(12, 3.6),
    L(12, 7.2, 12, 12.6),
    PL('12,12.6 8.2,14.6 9.2,20.4'),
    PL('12,12.6 15.8,14.6 14.8,20.4'),
    sol()
  ]),

  // Composer : trois tuiles et un « + » a la place de la quatrieme — litteralement la grille de
  // packs du composeur. C'est le logo de l'entree « Composer » sur l'accueil.
  'composer': () => [
    R(3.5, 3.5, 7, 7, 2),
    R(13.5, 3.5, 7, 7, 2),
    R(3.5, 13.5, 7, 7, 2),
    L(17, 14.2, 17, 19.8),
    L(14.2, 17, 19.8, 17)
  ],

  // Squat SANS charge : la meme flexion franche que 'squat', bras tendus DEVANT (l'equilibre du
  // squat au poids du corps) a la place de la barre. C'est l'absence de materiel qui se lit.
  'squat-poids-du-corps': () => [
    tete(12, 3.9),
    L(12, 5.5, 12, 12.6),
    L(12, 7.6, 18.4, 8.6),
    PL('12,12.6 8.2,14.6 9.2,20.4'),
    PL('12,12.6 15.8,14.6 14.8,20.4'),
    sol()
  ],

  // Assise en bas a gauche, plateau charge en haut a droite, jambes qui poussent entre les deux.
  'presse-a-cuisses': () => [
    T(2.6, 18.8, 9.6, 18.8),
    L(7.2, 15.9, 4.3, 11.7),
    tete(3.8, 10.1),
    PL('7.2,15.9 12.8,11.6 16.8,5.8'),
    T(14.2, 3.2, 21.2, 10.2)
  ],

  // Fente : buste droit, jambe avant pliee a angle droit, jambe arriere etendue loin derriere.
  'fentes': () => [
    tete(10.6, 4.2),
    L(10.6, 5.8, 10.6, 12.2),
    PL('10.6,12.2 15.2,13.6 15.2,20.4'),
    PL('10.6,12.2 7,16.6 4.2,20.2'),
    sol()
  ],

  // Leg curl : ALLONGE face au banc, le talon remonte le rouleau vers le HAUT.
  'leg-curl': () => [
    T(3, 15.8, 16, 15.8),
    tete(4.4, 13.5),
    L(6, 13.9, 14.8, 14.1),
    PL('14.8,14.1 18.8,12.6 19.5,8.4'),
    C(19.7, 6.7, 1.7)
  ],

  // Leg extension : ASSIS, le tibia deplie le rouleau vers l'AVANT.
  'leg-extension': () => [
    T(4.6, 9, 4.6, 17),
    T(4.6, 17, 11, 17),
    tete(7.3, 6.3),
    L(7.1, 7.9, 7.9, 15.2),
    PL('7.9,15.4 13.9,15.6 18.5,11.9'),
    C(19.7, 10.9, 1.7)
  ],

  // Sur la pointe du pied au bord d'une marche, mollet bombe : l'extension de cheville.
  'mollets': () => [
    L(9, 17.2, 20.5, 17.2),
    L(9, 17.2, 9, 20.6),
    tete(13.9, 3.8),
    L(13.9, 5.4, 13.5, 17),
    P('M13.5 11.6 C 15.9 12.9, 15.9 15.1, 13.7 16.8'),
    sol()
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Biceps
  // ───────────────────────────────────────────────────────────────────────────

  // Curl barre : silhouette de face, les DEUX coudes casses, barre a disques a mi-montee.
  'curl-barre': () => [
    tete(12, 3.9),
    L(12, 5.5, 12, 12.8),
    PL('9.2,7 8.5,11.6 10.2,13.8'),
    PL('14.8,7 15.5,11.6 13.8,13.8'),
    L(4.6, 13.8, 19.4, 13.8),
    C(5.9, 13.8, 1.9),
    C(18.1, 13.8, 1.9),
    L(12, 12.8, 10.4, 20.4),
    L(12, 12.8, 13.6, 20.4)
  ],

  // Curl haltere : UN seul bras flechi, renflement du biceps, haltere (fut + rectangles) en haut.
  'curl-halteres': () => [
    PL('4.8,17 12,16.6 15.4,8.8'),
    P('M6.4 15.7 C 9.4 12.7, 12.5 13.4, 13 15.9'),
    ...haltere(15.4, 8.8, 2.5)
  ],

  // Poulie BASSE a gauche, cable oblique remonte par l'avant-bras.
  'curl-poulie': () => [
    montant(3.2),
    C(4.9, 18.5, 1.6),
    L(6.4, 17.9, 12.8, 14.6),
    tete(16.8, 5.2),
    L(16.8, 6.8, 16.8, 14.2),
    PL('16.8,8.6 16.2,12.2 12.8,14.6'),
    L(16.8, 14.2, 15.2, 20.4),
    L(16.8, 14.2, 18.4, 20.4)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Triceps
  // ───────────────────────────────────────────────────────────────────────────

  // Poulie HAUTE, barre COURTE, personne DEBOUT a cote de la colonne : a lire par contraste
  // avec le tirage vertical, ou la barre est large et la personne assise sous la poulie.
  'extensions-triceps-poulie': () => [
    montant(20.8),
    C(19.2, 4.9, 1.6),
    L(17.8, 5.7, 13.8, 10),
    L(11, 10.4, 16.4, 10.4),
    tete(7, 4.7),
    L(7, 6.3, 7, 20.3),
    PL('7,8.2 9.8,11 12.8,10.5')
  ],

  // Haltere DERRIERE la nuque, les deux coudes pointes vers le ciel.
  'extensions-triceps-nuque': () => [
    tete(12, 9.3),
    L(12, 10.9, 12, 19.4),
    PL('10.2,11.3 9.2,5.9 11.2,4.4'),
    PL('13.8,11.3 14.8,5.9 12.8,4.4'),
    ...haltere(12, 3.4, 3.3)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Epaules — isolation. Les deux se lisent a l'ANGLE DES BRAS : croix horizontale pour les
  // elevations laterales, ailes relevees buste penche pour l'oiseau. Les petits rectangles au
  // bout des bras sont les halteres vus de face.
  // ───────────────────────────────────────────────────────────────────────────

  'elevations-laterales': () => [
    tete(12, 4.5),
    L(12, 6.5, 12, 14.6),
    L(12, 8.8, 4.8, 8.4),
    L(12, 8.8, 19.2, 8.4),
    R(2.4, 6.6, 1.8, 3.6, 0.8),
    R(19.8, 6.6, 1.8, 3.6, 0.8),
    L(12, 14.6, 10, 20.5),
    L(12, 14.6, 14, 20.5)
  ],

  'oiseau': () => [
    tete(12.2, 5.4),
    L(12.2, 7, 10.4, 14.8),
    L(11.6, 9.6, 4.8, 5.8),
    L(11.6, 9.6, 18.6, 5.8),
    R(3.5, 3.8, 1.8, 3.2, 0.8),
    R(18.1, 3.8, 1.8, 3.2, 0.8),
    L(10.4, 14.8, 9.6, 20.4)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Abdos et gainage
  // ───────────────────────────────────────────────────────────────────────────

  // AVANT-BRAS au sol (coude plie) : c'est ce qui separe la planche des pompes, ou le bras
  // est tendu et casse a mi-hauteur.
  'planche': () => [
    tete(19.3, 9.7),
    L(17.8, 10.5, 4.4, 18.2),
    L(17.4, 11, 16.2, 18.6),
    L(13.8, 18.7, 19.4, 18.7),
    sol()
  ],

  // Corps en diagonale sur UN bras d'appui, l'autre bras leve vers le ciel.
  'planche-laterale': () => [
    tete(19.8, 7.2),
    L(18.4, 8.2, 4.8, 18.4),
    L(17.2, 9.1, 16.4, 18.6),
    L(17.4, 8.7, 13.6, 3.4),
    sol()
  ],

  // Bras TENDUS et corps droit, immobile : la suspension est une traction qui n'a pas commence.
  'suspension-barre': () => [
    L(3, 3.5, 21, 3.5),
    L(9.2, 3.5, 10.9, 9.1),
    L(14.8, 3.5, 13.1, 9.1),
    tete(12, 7.5),
    L(12, 9.1, 12, 15.6),
    L(12, 15.6, 11.1, 20.7),
    L(12, 15.6, 12.9, 20.7)
  ],

  // Suspendu, jambes MONTEES a l'horizontale : l'equerre.
  'releve-de-jambes': () => [
    L(3, 3.5, 21, 3.5),
    L(9.2, 3.5, 10.9, 8.9),
    L(14.8, 3.5, 13.1, 8.9),
    tete(12, 7.3),
    L(12, 8.9, 11.7, 14.6),
    L(11.7, 14.6, 19.4, 13.2)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Abdos, jambes, epaules — les 7 exercices ajoutes avec la v3 du catalogue.
  // Convention stricte : nom d'icone = id du catalogue sans le prefixe 'cat:'.
  // (Le huitieme, cat:squat, reutilise l'icone 'squat' plus haut.)
  // ───────────────────────────────────────────────────────────────────────────

  // Pied ARRIERE sureleve sur le banc, jambe avant qui plie : le squat unilateral.
  'squat-bulgare': () => [
    T(14.8, 13.4, 21.5, 13.4),
    tete(9.4, 4.1),
    L(9.4, 5.7, 9, 11.8),
    PL('9,11.8 7.6,15.8 8,20.4'),
    PL('9,11.8 13.4,16.4 17,12.6'),
    sol()
  ],

  // Kettlebell (cercle + anse) serree contre la poitrine, hanches basses genoux ouverts.
  'goblet-squat': () => [
    tete(12, 3.7),
    L(9.7, 6.4, 11, 8.6),
    L(14.3, 6.4, 13, 8.6),
    P('M10.5 9.2 Q 12 7.3 13.5 9.2'),
    C(12, 10.6, 2.1),
    PL('12,12.7 8.2,14.5 9,20.4'),
    PL('12,12.7 15.8,14.5 15,20.4'),
    sol()
  ],

  // Epaules sur le banc, hanches en PONT, disque de barre pose sur le bassin.
  'hip-thrust': () => [
    T(2.5, 13.4, 8.2, 13.4),
    tete(3.7, 10.3),
    L(6.4, 12.4, 13.8, 10.9),
    L(13.8, 10.9, 17.8, 12.7),
    L(17.8, 12.7, 18, 20.3),
    C(13.6, 8.2, 2.3),
    L(10.6, 8.2, 16.6, 8.2),
    sol()
  ],

  // Charniere de hanche jambes TENDUES, barre qui S'ARRETE aux tibias : par contraste avec le
  // souleve de terre classique (genoux plies, gros disques poses au sol).
  'souleve-de-terre-roumain': () => [
    tete(4.7, 7.1),
    L(6.3, 7.5, 14.2, 9),
    L(14.2, 9, 14.9, 20.3),
    L(7.6, 7.9, 7.2, 13.9),
    L(3.4, 14.3, 10.9, 14.3),
    C(7.1, 14.3, 2.2),
    sol()
  ],

  // Dos au sol, genoux plies, seules les epaules s'ENROULENT : le crunch, pas le sit-up.
  'crunchs': () => [
    P('M14.2 18.7 C 11 18.4, 8.2 16.6, 7 14.2'),
    tete(6.2, 12.4),
    L(14.2, 18.7, 17.6, 13.9),
    L(17.6, 13.9, 20.3, 18.7),
    sol()
  ],

  // Le saut final, bras en V, pieds DECOLLES du sol : l'instant le plus identifiable du burpee.
  'burpees': () => [
    tete(12, 3.6),
    L(12, 5.2, 12, 11.6),
    L(12, 6.9, 7.8, 3.4),
    L(12, 6.9, 16.2, 3.4),
    L(12, 11.6, 8.4, 16),
    L(12, 11.6, 15.6, 16),
    sol()
  ],

  // Poulie HAUTE tiree VERS LE VISAGE, coude haut : ni un tirage (personne debout), ni une
  // extension triceps (le cable arrive a hauteur de tete, pas de barre poussee vers le bas).
  'face-pull': () => [
    montant(20.8),
    C(19.2, 5.1, 1.6),
    L(17.7, 5.9, 12.9, 8.9),
    tete(6.5, 7.7),
    L(6.5, 9.3, 6.5, 20.3),
    PL('6.8,10.3 10.7,8.3 12.9,8.9')
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Cardio (6)
  // ───────────────────────────────────────────────────────────────────────────

  // Course : buste PENCHE, foulee ample, bras plies.
  'course-a-pied': () => [
    tete(15.7, 4.3),
    L(14.8, 5.9, 11.6, 11.8),
    PL('14.2,7.2 17,9.2 15.9,12.2'),
    L(13.9, 7.5, 9.4, 6.4),
    PL('11.6,11.8 15,15 13.8,19.8'),
    PL('11.6,11.8 7.6,14.2 6,19')
  ],

  // Marche : buste DROIT, foulee courte, bras presque tendus.
  'marche': () => [
    tete(12.7, 4.3),
    L(12.7, 5.9, 12.1, 13),
    L(12.5, 8, 14.7, 12),
    L(12.5, 8, 10.1, 11.6),
    PL('12.1,13 13.9,17 14.9,20.5'),
    PL('12.1,13 10.1,17 9.1,20.5')
  ],

  'velo': () => [
    C(5.6, 16.8, 3.4),
    C(18.4, 16.8, 3.4),
    PL('5.6,16.8 11.4,16.8 8.8,10 14.6,10 18.4,16.8'),
    L(14.6, 10, 16.8, 7.8),
    L(8.8, 10, 6.9, 9.2)
  ],

  // Rameur : volant a gauche, rail au sol, rameur assis qui tire, jambes vers l'avant.
  'rameur': () => [
    C(4.7, 14.6, 2.9),
    L(2.6, 19.6, 21.4, 19.6),
    R(11.6, 16.5, 4.4, 2, 0.7),
    tete(16.4, 7.1),
    L(16, 8.7, 14, 16.4),
    L(15, 10.8, 7.4, 13.2),
    L(13.9, 16.6, 8.6, 17.9)
  ],

  'elliptique': () => [
    E(9, 15.6, 6, 3.1),
    L(18.8, 4.2, 18.8, 19.4),
    L(14.6, 19.7, 22, 19.7),
    L(18.8, 6.4, 10.6, 13.6),
    L(4.6, 16, 8.2, 14.2)
  ],

  'corde-a-sauter': () => [
    P('M5 8.4 C 1.8 16, 6 21, 12 21 C 18 21, 22.2 16, 19 8.4'),
    L(5, 8.4, 3.4, 5.6),
    L(19, 8.4, 20.6, 5.6)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Repli generique : la courbe d'activite. Neutre, ne ressemble a aucun exercice precis,
  // donc ne ment pas quand un exercice cree par l'utilisateur n'a pas de dessin dedie.
  // ───────────────────────────────────────────────────────────────────────────

  'exercice': () => [
    PL('2.5,12 7,12 10,5 14,19 17,12 21.5,12')
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Interface (16) — geometrie simple, propre, centree. Pas de silhouettes ici.
  // ───────────────────────────────────────────────────────────────────────────

  'plus': () => [L(12, 5, 12, 19), L(5, 12, 19, 12)],

  'moins': () => [L(5, 12, 19, 12)],

  'croix': () => [L(6, 6, 18, 18), L(18, 6, 6, 18)],

  'chevron-droit': () => [PL('9,4.5 16.5,12 9,19.5')],

  'chevron-bas': () => [PL('4.5,9 12,16.5 19.5,9')],

  'chronometre': () => [
    C(12, 13.2, 7.6),
    L(12, 13.2, 12, 8.8),
    L(12, 13.2, 15.2, 13.2),
    L(9.6, 2.6, 14.4, 2.6),
    L(12, 2.6, 12, 5.6)
  ],

  'minuteur': () => [
    L(6, 3, 18, 3),
    L(6, 21, 18, 21),
    P('M8 3 V6.6 L12 12 L16 6.6 V3'),
    P('M8 21 V17.4 L12 12 L16 17.4 V21')
  ],

  'lecture': () => [P('M8 4.8 L19 12 L8 19.2 Z')],

  'pause': () => [L(9, 4.8, 9, 19.2), L(15, 4.8, 15, 19.2)],

  'poubelle': () => [
    L(3.8, 6, 20.2, 6),
    P('M6.4 6 L7.4 20.6 H16.6 L17.6 6'),
    P('M9.4 6 V3.4 H14.6 V6'),
    L(10.2, 9.6, 10.2, 17.2),
    L(13.8, 9.6, 13.8, 17.2)
  ],

  'crayon': () => [
    P('M3.6 20.4 L4.7 15.8 L15.9 4.6 L19.4 8.1 L8.2 19.3 Z'),
    L(14.1, 6.4, 17.6, 9.9)
  ],

  'telecharger': () => [
    L(12, 3, 12, 15.6),
    PL('7.4,11 12,15.6 16.6,11'),
    PL('4,17 4,20.6 20,20.6 20,17')
  ],

  'televerser': () => [
    L(12, 16, 12, 3.4),
    PL('7.4,8 12,3.4 16.6,8'),
    PL('4,17 4,20.6 20,20.6 20,17')
  ],

  'recherche': () => [
    C(10.8, 10.8, 6.6),
    L(15.6, 15.6, 20.4, 20.4)
  ],

  'coche': () => [PL('4.6,12.6 9.6,17.6 19.4,6.8')],

  'avertissement': () => [
    P('M12 3.4 L21.6 20.2 H2.4 Z'),
    L(12, 9.4, 12, 14.4),
    C(12, 17.3, 0.4)
  ]
};

// ═════════════════════════════════════════════════════════════════════════════
// Fabrique
// ═════════════════════════════════════════════════════════════════════════════

// Attributs communs a TOUTES les icones. Poses sur la racine et herites par les enfants : les
// fonctions de dessin ci-dessus n'ont donc jamais a repeter stroke ni fill, et une seule ligne
// ici suffirait a changer l'epaisseur de trait de toute l'application. Deux exceptions locales,
// posees enfant par enfant : la tete des silhouettes (fill currentColor) et les traits epais de
// banc (stroke-width 2.75).
const GABARIT = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.75,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
};

/**
 * Construit une icone.
 *
 * @param {string} nom cle de ICONES ; un nom inconnu retombe sur l'icone generique plutot que de
 *                     lever, parce qu'une icone manquante ne doit jamais faire ecran blanc.
 * @param {{ taille?: number, classe?: string, titre?: string }} [options]
 * @returns {SVGElement}
 *
 * ⚠ Accessibilite : sans `titre`, l'icone est DECORATIVE et porte aria-hidden. C'est le cas
 *   normal — a cote d'un libelle « Ajouter une serie », une icone annoncee ferait lire
 *   l'information deux fois. `titre` n'est a fournir que lorsque l'icone est SEULE porteuse du
 *   sens (un bouton sans texte).
 */
export function icone(nom, options) {
  const o = options || {};
  const taille = o.taille == null ? 24 : o.taille;
  // ⚠ Garde de propriete PROPRE. Sans elle, un nom herite d'Object.prototype ('toString',
  //   'constructor', 'valueOf', '__proto__') rend une fonction native au lieu d'un dessin, et
  //   appendChild leve un TypeError — a rebours de la garantie « une icone manquante ne fait
  //   jamais ecran blanc ». Le nom vient d'un identifiant d'exercice : 'usr:toString' suffit.
  const connu = typeof nom === 'string' && Object.prototype.hasOwnProperty.call(ICONES, nom);
  const dessin = connu ? ICONES[nom] : ICONES['exercice'];

  const attrs = Object.assign({}, GABARIT, {
    width: taille,
    height: taille,
    class: ['icone', o.classe]
  });

  // ⚠ La propriete personnalisee n'est posee QUE si une taille a ete demandee explicitement.
  //   Un style INLINE l'emporte sur toute regle d'auteur, y compris pour une propriete
  //   personnalisee : la poser systematiquement rendait INERTES les classes .icone-xs a
  //   .icone-xxl, et une tuile de pack demandee en .icone-xxl sortait a 24 px.
  if (o.taille != null) attrs.style = { '--icone-taille': taille + 'px' };

  if (o.titre) attrs.role = 'img';
  else attrs['aria-hidden'] = 'true';

  const el = svg('svg', attrs);
  // Le titre vient EN PREMIER : les lecteurs d'ecran annoncent le premier titre rencontre dans
  // l'arbre, le placer apres les formes le rend inaudible sur certains moteurs.
  if (o.titre) el.appendChild(svg('title', null, o.titre));
  for (const forme of dessin()) el.appendChild(forme);
  return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution exercice -> icone
// ─────────────────────────────────────────────────────────────────────────────

// Materiel -> pack. Le materiel est le champ le plus fiable d'un exercice cree par
// l'utilisateur : il est choisi dans une liste fermee (MATERIELS de schema.js), la ou le nom est
// libre. Les cles couvrent l'integralite de MATERIELS ; en ajouter un la-bas sans l'ajouter ici
// se traduit par un repli silencieux mais correct sur le pack « poids-du-corps ».
const PACK_PAR_MATERIEL = {
  'aucun': 'poids-du-corps',
  'barre': 'barre',
  'halteres': 'halteres',
  'kettlebell': 'halteres',
  'poulie': 'poulie',
  'machine': 'machine',
  'barre-traction': 'poids-du-corps',
  'barres-paralleles': 'poids-du-corps',
  'banc': 'poids-du-corps',
  'elastique': 'elastique',
  'sangles': 'elastique',
  'tapis-de-course': 'cardio',
  'velo': 'cardio',
  'rameur': 'cardio',
  'elliptique': 'cardio',
  'corde-a-sauter': 'cardio'
};

/**
 * Resout un exercice vers un nom d'icone, en trois tentatives de plus en plus larges.
 *
 * @param {object|string} exercice l'exercice, ou directement son id
 * @returns {string} un nom TOUJOURS present dans ICONES
 *
 * ⚠ Le premier essai passe par l'IDENTIFIANT, jamais par le nom : les ids du catalogue sont figes
 *   a vie (voir data/catalog.js), alors que le champ `nom` se corrige et se traduit. Indexer les
 *   dessins sur le nom ferait disparaitre l'icone d'un exercice le jour ou l'on corrige sa
 *   typographie.
 */
export function iconePourExercice(exercice) {
  if (!exercice) return 'exercice';

  const id = typeof exercice === 'string' ? exercice : exercice.id;

  // 1. Dessin dedie, retrouve par l'id prive de son prefixe d'origine ('cat:' ou 'usr:').
  if (typeof id === 'string') {
    const sep = id.indexOf(':');
    const cle = sep === -1 ? id : id.slice(sep + 1);
    if (Object.prototype.hasOwnProperty.call(ICONES, cle)) return cle;
  }

  if (typeof exercice === 'string') return 'exercice';

  // 2. Icone du pack, deduite du materiel — puis du mode pour les seuls cas ou le materiel ne
  //    tranche pas : sans machine ni charge, un exercice « aucun » peut etre du cardio (course)
  //    ou du gainage (planche), et les deux packs sont visuellement tres differents.
  const pack = PACK_PAR_MATERIEL[exercice.materiel];
  if (pack === 'poids-du-corps' || pack == null) {
    if (exercice.mode === 'cardio') return 'cardio';
    if (exercice.mode === 'temps') return 'gainage';
  }
  if (pack) return pack;

  // 3. Repli generique.
  return 'exercice';
}
