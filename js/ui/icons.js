// ui/icons.js — la bibliotheque de pictogrammes de l'application.
//
// C'est la fondation VISUELLE de la v2 : chaque pack, chaque exercice, chaque commande a ici son
// dessin. Aucune image, aucune police d'icones, aucun sprite : tout est construit en
// createElementNS via svg() de lib/dom.js. Consequences directes :
//   - rien a telecharger, rien a mettre en cache, rien qui puisse manquer hors ligne ;
//   - aucune chaine de balisage nulle part, donc aucun probleme d'echappement ;
//   - stroke='currentColor' partout : une icone prend la couleur de son texte, donc elle est
//     juste en theme clair ET en theme sombre SANS le moindre re-rendu a la bascule. C'est la
//     raison pour laquelle aucune couleur litterale n'apparait dans ce fichier.
//
// Style de dessin, impose et uniforme (voir GABARIT ci-dessous) : viewBox 0 0 24 24, trait seul,
// jamais de remplissage, epaisseur 1.75, bouts et jonctions arrondis. Chaque dessin reste sous
// huit traits : au-dela, l'icone devient une bouillie a 20 px, taille a laquelle elle sera
// reellement lue dans une puce ou une ligne de serie.

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

// ─────────────────────────────────────────────────────────────────────────────
// Formes recurrentes
// ─────────────────────────────────────────────────────────────────────────────
// Une barre chargee, un banc, un haltere ou une colonne de machine reviennent dans une vingtaine
// de dessins. Les factoriser evite de recopier vingt fois les memes coordonnees — et surtout
// garantit qu'une barre a TOUJOURS la meme allure d'une icone a l'autre, ce qui est la moitie du
// travail d'une famille d'icones coherente.

/** Barre horizontale chargee : le fut, plus un disque a chaque extremite. */
function barreChargee(y, x1, x2, demiDisque) {
  const d = demiDisque == null ? 2.5 : demiDisque;
  return [
    L(x1, y, x2, y),
    L(x1 + 1.6, y - d, x1 + 1.6, y + d),
    L(x2 - 1.6, y - d, x2 - 1.6, y + d)
  ];
}

/** Haltere court : fut plus deux embouts. */
function haltere(cx, cy, demiLong, demiHaut) {
  const dl = demiLong == null ? 3 : demiLong;
  const dh = demiHaut == null ? 1.6 : demiHaut;
  return [
    L(cx - dl, cy, cx + dl, cy),
    L(cx - dl + 0.5, cy - dh, cx - dl + 0.5, cy + dh),
    L(cx + dl - 0.5, cy - dh, cx + dl - 0.5, cy + dh)
  ];
}

/** Banc : plateau horizontal et un pied qui descend au sol. */
function banc(y, x1, x2, xPied) {
  return [L(x1, y, x2, y), L(xPied, y, xPied, 20.6)];
}

/** Ligne de sol, reference commune a tous les mouvements au poids du corps. */
const sol = (y) => L(2.5, y == null ? 20.6 : y, 21.5, y == null ? 20.6 : y);

/** Montant vertical d'une machine ou d'une colonne a poulie. */
const colonne = (x) => L(x, 2.5, x, 21.5);

/** Tete de la silhouette. */
const tete = (cx, cy, r) => C(cx, cy, r == null ? 1.75 : r);

// ═════════════════════════════════════════════════════════════════════════════
// ICONES — dictionnaire nom -> fonction de dessin.
// Chaque fonction rend un TABLEAU d'elements SVG ; l'enveloppe (viewBox, stroke, titre) est
// posee une fois pour toutes par icone() plus bas.
// ═════════════════════════════════════════════════════════════════════════════

export const ICONES = {

  // ───────────────────────────────────────────────────────────────────────────
  // Packs et materiel (8) — ce que l'utilisateur voit sur la grille d'entree
  // ───────────────────────────────────────────────────────────────────────────

  'poids-du-corps': () => [
    tete(12, 4.8, 2),
    L(12, 6.8, 12, 14),
    L(5.5, 10, 18.5, 10),
    L(12, 14, 9, 20.5),
    L(12, 14, 15, 20.5)
  ],

  // ⚠ Haltere et barre partagent la meme grammaire (un fut, des disques) : sans un contraste
  //   FRANC ils deviennent la meme icone a 20 px. Le contraste est ici la LONGUEUR du fut —
  //   l'haltere tient au centre du cadre, la barre le traverse de bord a bord — et le nombre de
  //   disques, un seul par cote contre deux.
  'halteres': () => [
    L(6, 12, 18, 12),
    L(7.6, 8.6, 7.6, 15.4),
    L(16.4, 8.6, 16.4, 15.4),
    L(4.6, 10.2, 4.6, 13.8),
    L(19.4, 10.2, 19.4, 13.8)
  ],

  'barre': () => [
    L(1.8, 12, 22.2, 12),
    L(5.2, 7.2, 5.2, 16.8),
    L(7.8, 9.4, 7.8, 14.6),
    L(18.8, 7.2, 18.8, 16.8),
    L(16.2, 9.4, 16.2, 14.6)
  ],

  'poulie': () => [
    colonne(4),
    L(4, 4, 12, 4),
    C(12, 5.8, 1.8),
    L(12, 7.6, 12, 14.5),
    L(9, 14.5, 15, 14.5)
  ],

  // Colonne de plaques entre deux rails, et le cable qui y plonge : sans le cable, le rectangle
  // raye se lit comme une liste de texte et non comme une machine.
  'machine': () => [
    L(5, 3, 19, 3),
    L(5, 3, 5, 21),
    L(19, 3, 19, 21),
    L(12, 3, 12, 8),
    R(8.4, 8, 7.2, 11, 1),
    L(8.4, 11.7, 15.6, 11.7),
    L(8.4, 15.4, 15.6, 15.4)
  ],

  // Le coeur : le seul symbole qui dit « cardio » sans dire QUEL cardio.
  'cardio': () => [
    P('M12 20.2 C 5.2 15.4, 3 11, 5.6 7.6 C 7.8 4.8, 10.8 5.6, 12 8.2 '
      + 'C 13.2 5.6, 16.2 4.8, 18.4 7.6 C 21 11, 18.8 15.4, 12 20.2 Z')
  ],

  'elastique': () => [
    P('M5.2 12 C 8.5 5.5, 15.5 18.5, 18.8 12'),
    C(3.4, 12, 1.7),
    C(20.6, 12, 1.7)
  ],

  // Pack « gainage » : la planche, MIROIR de l'icone de l'exercice « Gainage planche » (tete a
  // gauche au lieu de la droite). Un tronc abstrait avait ete essaye ici et se lisait comme une
  // pile ou un telephone : la silhouette, elle, est reconnue immediatement, et la repetition
  // entre un pack et l'exercice qu'il contient est une aide plutot qu'une confusion.
  'gainage': () => [
    tete(5.2, 10, 1.7),
    L(6.7, 10.9, 16, 15),
    L(16, 15, 20.5, 18.6),
    L(6.6, 11.7, 8.4, 18.8),
    L(4.6, 18.8, 10.4, 18.8),
    sol()
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Dos — tractions. Le discriminant est la PRISE, dessinee au contact de la barre :
  // mains larges et bras plies (pronation), mains serrees (supination), poignees
  // perpendiculaires (neutre).
  // ───────────────────────────────────────────────────────────────────────────

  'tractions-pronation': () => [
    L(3, 3.5, 21, 3.5),
    PL('8,3.5 6.8,7.5 9.8,9.5'),
    PL('16,3.5 17.2,7.5 14.2,9.5'),
    tete(12, 7, 1.7),
    L(12, 9.5, 12, 15),
    L(12, 15, 10.5, 20.5),
    L(12, 15, 13.5, 20.5)
  ],

  'tractions-supination': () => [
    L(3, 3.5, 21, 3.5),
    PL('10,3.5 9,7.5 10.4,9.5'),
    PL('14,3.5 15,7.5 13.6,9.5'),
    tete(12, 7, 1.7),
    L(12, 9.5, 12, 14.5),
    PL('12,14.5 9,17.5 10,20.5'),
    PL('12,14.5 15,17.5 14,20.5')
  ],

  'tractions-neutre': () => [
    L(3, 3.5, 21, 3.5),
    L(9, 2, 9, 5.5),
    L(15, 2, 15, 5.5),
    PL('9,5.5 8.4,8 10,9.6'),
    PL('15,5.5 15.6,8 14,9.6'),
    tete(12, 7.4, 1.7),
    L(12, 10, 12, 20.5)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Pectoraux et triceps — pompes. Tete a DROITE dans toute la famille ; ce qui change est
  // l'inclinaison du corps et ce que les mains touchent.
  // ───────────────────────────────────────────────────────────────────────────

  'pompes': () => [
    tete(18.8, 10, 1.7),
    L(17.3, 10.9, 8, 15),
    L(8, 15, 3.5, 18.6),
    L(17.6, 11.6, 16.4, 20.6),
    sol()
  ],

  // Pieds SURELEVES sur un banc : le corps descend vers la tete, a l'inverse des pompes a plat.
  'pompes-declinees': () => [
    tete(5.6, 15.2, 1.7),
    L(7.2, 14.6, 15, 11),
    L(15, 11, 19, 9.2),
    L(5.8, 16.9, 5.8, 20.6),
    ...banc(8.8, 15.5, 22, 20),
    sol()
  ],

  // Mains JOINTES : le losange sous la poitrine est le seul detail qui separe cette icone des
  // pompes classiques, il est donc dessine en grand et pose exactement sous les epaules.
  'pompes-diamant': () => [
    tete(18.8, 10, 1.7),
    L(17.3, 10.9, 8, 15),
    L(8, 15, 3.5, 18.6),
    L(17.6, 11.6, 16, 17.2),
    P('M16 17.2 L17.7 19 L16 20.8 L14.3 19 Z'),
    sol()
  ],

  // Mains SURELEVEES : regression des pompes classiques. Absente du catalogue livre, mais un
  // exercice cree par l'utilisateur peut la reclamer par son identifiant.
  'pompes-surelevees': () => [
    tete(18.4, 8.2, 1.7),
    L(16.9, 9.1, 8, 13.8),
    L(8, 13.8, 3.5, 17.6),
    L(17.4, 9.9, 16.6, 15),
    ...banc(15, 12.5, 21.5, 19.5),
    sol()
  ],

  // ── Dips ───────────────────────────────────────────────────────────────────

  'dips-barres': () => [
    L(2.5, 9, 8.5, 9),
    L(15.5, 9, 21.5, 9),
    tete(12, 6.4, 1.7),
    L(12, 8.4, 12, 15),
    L(12, 10, 7.5, 9.3),
    L(12, 10, 16.5, 9.3),
    PL('12,15 15.4,17.6 13.4,20.6')
  ],

  'dips-banc': () => [
    ...banc(10, 2.5, 10.5, 4.5),
    tete(13, 6.8, 1.7),
    L(13, 8.6, 13, 14),
    L(13, 10.2, 8.5, 10.2),
    L(13, 14, 19.5, 16.6),
    L(19.5, 16.6, 19.5, 20.6)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Pectoraux — developpes
  // ───────────────────────────────────────────────────────────────────────────

  'developpe-couche-barre': () => barreChargee(6.5, 2.5, 21.5, 3).concat([
    L(8, 7.5, 8, 14),
    L(16, 7.5, 16, 14),
    L(4, 15.5, 20, 15.5),
    L(7, 15.5, 7, 20.2),
    L(17, 15.5, 17, 20.2)
  ]),

  'developpe-couche-halteres': () => [
    PL('6,8 8,14 16,14 18,8'),
    L(3.5, 16, 20.5, 16),
    ...haltere(6, 6.5, 2.8, 1.8),
    ...haltere(18, 6.5, 2.8, 1.8)
  ],

  // Le dossier INCLINE est le discriminant : une diagonale nette de bas-gauche a haut-droite.
  'developpe-incline-barre': () => [
    L(4, 20.2, 16, 8),
    L(2.5, 20.2, 9, 20.2),
    L(14, 9.5, 14, 6),
    ...barreChargee(5, 6, 21.5, 2.5)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Epaules — developpe militaire (debout, barre au-dessus de la tete)
  // ───────────────────────────────────────────────────────────────────────────

  'developpe-militaire': () => barreChargee(4, 4, 20, 2.5).concat([
    L(9, 4.6, 10.8, 8.6),
    L(15, 4.6, 13.2, 8.6),
    tete(12, 10.8, 1.75),
    PL('12,12.6 12,16.4 9.6,20.8'),
    L(12, 16.4, 14.4, 20.8)
  ]),

  // ───────────────────────────────────────────────────────────────────────────
  // Dos — tirages horizontaux et verticaux
  // ───────────────────────────────────────────────────────────────────────────

  'rowing-barre': () => [
    tete(4.6, 7.6, 1.7),
    L(6.3, 8.3, 15, 11.4),
    PL('15,11.4 16,15.5 15,20.4'),
    L(11, 10, 11, 15),
    ...barreChargee(15, 5, 19.5, 2.4)
  ],

  'rowing-halteres': () => [
    tete(18, 8, 1.7),
    L(16.5, 8.9, 8.5, 12.4),
    L(9.2, 12.6, 9.2, 15),
    L(14, 11.2, 14, 15.4),
    R(12.3, 15.4, 3.4, 2.4, 1),
    ...banc(15, 3, 12.2, 5)
  ],

  'rowing-poulie-basse': () => [
    colonne(21),
    C(19.7, 17.6, 1.4),
    L(18.4, 17.2, 11, 14.8),
    L(10, 13.3, 10, 16.3),
    L(3, 17.2, 8.4, 17.2),
    tete(6, 8.6, 1.8),
    L(6, 10.5, 6.6, 15.4),
    L(7.2, 13, 10, 14.9)
  ],

  // Barre LARGE et personne assise dessous : le contraire exact des extensions triceps, ou la
  // barre est courte et la personne debout a cote.
  'tirage-vertical': () => [
    colonne(21),
    C(19.6, 4.6, 1.4),
    L(19.6, 6, 12.5, 8.2),
    L(6, 8.2, 18, 8.2),
    L(8.5, 8.2, 11, 12),
    L(15, 8.2, 12.8, 12),
    tete(11.8, 13.6, 1.8),
    L(7, 19.4, 15.5, 19.4)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Chaine posterieure et jambes
  // ───────────────────────────────────────────────────────────────────────────

  // Les deux GROS disques au sol sont la signature du souleve de terre : rien d'autre dans la
  // famille ne pose la barre par terre.
  'souleve-de-terre': () => [
    L(2.5, 17, 21.5, 17),
    C(5.2, 17, 3.4),
    C(18.8, 17, 3.4),
    tete(12, 5.4, 1.7),
    L(11.8, 7.1, 11.2, 11.6),
    L(11.2, 11.6, 11, 16.4),
    PL('11.2,11.6 13.6,14 13.2,17.6')
  ],

  'squat': () => barreChargee(7.4, 3, 21, 2.8).concat([
    tete(12, 3.6, 1.6),
    L(12, 8.6, 12, 13),
    PL('12,13 9,16.2 9,20.6'),
    PL('12,13 15,16.2 15,20.6')
  ]),

  'presse-a-cuisses': () => [
    L(3.2, 19.4, 3.2, 12.6),
    L(3.2, 19.4, 9, 19.4),
    PL('9,18.6 14,16 14.6,11.6'),
    L(10.8, 10.2, 18.2, 13.4),
    R(14.2, 3.6, 6, 5, 1),
    L(16.4, 17, 21.6, 6)
  ],

  'fentes': () => [
    tete(12, 4.4, 1.7),
    L(12, 6.2, 12, 12),
    PL('12,12 17,15.2 17,20.6'),
    PL('12,12 8,16 5,20.6'),
    L(9.2, 8.6, 9.2, 11.2),
    L(14.8, 8.6, 14.8, 11.2),
    sol()
  ],

  // Leg curl : ALLONGE, le rouleau part vers le HAUT derriere la jambe.
  'leg-curl': () => [
    tete(4.6, 11.4, 1.7),
    L(6.3, 12.8, 15, 12.8),
    ...banc(14.4, 3, 16, 6),
    PL('15,12.8 19.6,12.6 20,8.4'),
    C(20, 6.4, 1.9)
  ],

  // Leg extension : ASSIS, le rouleau part vers l'AVANT devant le tibia.
  'leg-extension': () => [
    L(4, 18.4, 4, 8.8),
    L(4, 18.4, 10.4, 18.4),
    tete(6.2, 6.8, 1.7),
    L(10, 17.2, 15, 17.2),
    L(15, 17.2, 18.6, 13.4),
    C(19.9, 12, 1.9)
  ],

  'mollets': () => [
    L(13, 3.6, 13, 14),
    P('M13 8 C 16.2 10, 16.2 12.8, 13.4 14.6'),
    PL('11.8,15.4 11.8,17 17.4,17'),
    L(8, 17, 20, 17),
    L(8, 17, 8, 20.6),
    sol()
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Biceps
  // ───────────────────────────────────────────────────────────────────────────

  // Curl barre : les DEUX bras, une barre longue et chargee.
  'curl-barre': () => [
    PL('8,4 8,10 11.5,12.5'),
    PL('16,4 16,10 12.5,12.5'),
    L(3.5, 12.6, 20.5, 12.6),
    L(5.6, 10, 5.6, 15.2),
    L(18.4, 10, 18.4, 15.2)
  ],

  // Curl haltere : UN seul bras, flechi, avec le renflement du biceps.
  'curl-halteres': () => [
    PL('4.6,16.6 12,16.6 15,8.4'),
    P('M6 15.4 C 9 12.6, 12 13.2, 12.6 15.6'),
    ...haltere(16, 6.6, 3, 1.9)
  ],

  'curl-poulie': () => [
    colonne(3),
    C(4.5, 18, 1.5),
    L(5.9, 17.6, 12.6, 14.8),
    L(11.6, 13.4, 14.2, 15.8),
    PL('17.4,5.6 17.4,12 13.6,14.9')
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Triceps
  // ───────────────────────────────────────────────────────────────────────────

  // Barre COURTE, personne DEBOUT a cote de la colonne : a lire par contraste avec le tirage
  // vertical, ou la barre est large et la personne assise sous la poulie.
  'extensions-triceps-poulie': () => [
    colonne(21),
    C(19.6, 4.6, 1.4),
    L(19.6, 6, 12.6, 10.4),
    L(9.5, 10.4, 15.5, 10.4),
    tete(6.2, 4.6, 1.7),
    L(6.2, 6.4, 6.2, 11.6),
    L(6.2, 11.6, 10, 10.6),
    L(6.2, 15, 6.2, 20.6)
  ],

  'extensions-triceps-nuque': () => [
    tete(12, 9.4, 1.8),
    L(12, 11.4, 12, 19.6),
    PL('9.6,11.4 9,6 11,3.9'),
    PL('14.4,11.4 15,6 13,3.9'),
    ...haltere(12, 3.5, 3.6, 1.7)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Epaules — isolation. Les deux se lisent a l'ANGLE DES BRAS : horizontal pour les
  // elevations laterales, releve vers l'arriere avec le buste penche pour l'oiseau.
  // ───────────────────────────────────────────────────────────────────────────

  'elevations-laterales': () => [
    tete(12, 5, 1.8),
    L(12, 7, 12, 17.5),
    L(12, 9.2, 4, 9.2),
    L(12, 9.2, 20, 9.2),
    L(3, 7.4, 3, 11),
    L(21, 7.4, 21, 11)
  ],

  'oiseau': () => [
    tete(12, 5.8, 1.8),
    L(12, 7.8, 10, 15.4),
    L(11.4, 10.2, 4.4, 6),
    L(11.4, 10.2, 18.4, 6),
    L(3.2, 4.4, 3.2, 7.8),
    L(19.6, 4.4, 19.6, 7.8),
    L(10, 15.4, 9.2, 20.6)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Abdos et gainage
  // ───────────────────────────────────────────────────────────────────────────

  // AVANT-BRAS au sol (coude plie) : c'est ce qui separe la planche des pompes, ou le bras
  // est tendu.
  'planche': () => [
    tete(18.8, 10, 1.7),
    L(17.3, 10.9, 8, 15),
    L(8, 15, 3.5, 18.6),
    L(17.4, 11.7, 15.6, 18.8),
    L(13.6, 18.8, 19.4, 18.8),
    sol()
  ],

  'planche-laterale': () => [
    tete(20.4, 7, 1.6),
    L(19, 8, 5, 17.2),
    L(17.6, 9.4, 16.6, 18.6),
    L(17.6, 9.4, 14, 3.6),
    sol()
  ],

  // Bras TENDUS et corps entierement pendu : la suspension est une traction qui n'a pas commence.
  'suspension-barre': () => [
    L(3, 3.5, 21, 3.5),
    L(9, 3.5, 9, 10.4),
    L(15, 3.5, 15, 10.4),
    tete(12, 7.6, 1.7),
    L(12, 10.2, 12, 15.4),
    L(12, 15.4, 10.6, 21),
    L(12, 15.4, 13.4, 21)
  ],

  'releve-de-jambes': () => [
    L(3, 3.5, 21, 3.5),
    L(8.5, 3.5, 8.5, 9.6),
    L(15.5, 3.5, 15.5, 9.6),
    tete(12, 7, 1.7),
    L(12, 9.6, 12, 15.4),
    L(12, 15.4, 19.6, 15.4),
    L(19.6, 15.4, 19.6, 12.8)
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // Cardio (6)
  // ───────────────────────────────────────────────────────────────────────────

  // Course : buste PENCHE, foulee ample, bras plies.
  'course-a-pied': () => [
    tete(15.2, 4.8, 1.8),
    L(14.2, 6.8, 11, 12),
    PL('13.8,8.4 16.8,10.2 15.8,13.2'),
    L(13.4, 8.6, 9, 7),
    PL('11,12 12.4,16 15.2,19.4'),
    PL('11,12 7,15 6.8,19.6')
  ],

  // Marche : buste DROIT, foulee courte, bras presque tendus.
  'marche': () => [
    tete(13, 4.6, 1.8),
    L(13, 6.6, 12, 13),
    L(12.8, 8.2, 15.2, 12.2),
    L(12.8, 8.2, 10.2, 11.4),
    PL('12,13 13.6,17 15,20.6'),
    PL('12,13 9.6,17 8.6,20.6')
  ],

  'velo': () => [
    C(5.6, 17, 3.5),
    C(18.4, 17, 3.5),
    PL('5.6,17 11.6,17 9,9.8 15,9.8 18.4,17'),
    L(15, 9.8, 17.2, 8),
    L(9, 9.8, 6.8, 9.2)
  ],

  'rameur': () => [
    C(18.4, 11, 3.2),
    L(3, 19.6, 20.4, 19.6),
    R(8, 16, 4.6, 2.2, 0.7),
    L(15.4, 11.6, 6, 13.4),
    L(5, 11.8, 5, 15.2)
  ],

  'elliptique': () => [
    E(9, 15.2, 6, 3.4),
    L(19, 4, 19, 19.4),
    L(14.4, 19.8, 22, 19.8),
    L(19, 6.2, 10.4, 13.4),
    L(4.4, 15.8, 8, 14)
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
  // Interface (16)
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
// ici suffirait a changer l'epaisseur de trait de toute l'application.
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
