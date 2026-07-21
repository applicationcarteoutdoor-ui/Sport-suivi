// ui/chart.js — moteur de courbes SVG maison, zero dependance.
//
// FRAGMENT VIVANT (zone C du contrat de rendu) : il POSSEDE son sous-arbre et ses ecouteurs.
// Aucun parent n'a le droit de remplacer ce sous-arbre ; pour changer de metrique ou de plage,
// l'appelant appelle detruire() puis renderLineChart() a nouveau.
//
// Le moteur ne pose AUCUNE couleur : il pose des classes et un `data-serie` de 1 a 4
// (css/components.css les resout via currentColor et les variables de theme). C'est ce qui rend
// la bascule clair/sombre GRATUITE, sans le moindre re-rendu de la courbe.
//
// ⚠ LES CAS DEGENERES SONT DANS LE CONTRAT DE CETTE FONCTION, jamais chez l'appelant :
//   0 point    -> etat vide illustre
//   1 point    -> grande carte chiffree
//   2-3 points -> courbe + lisere « Tendance indisponible »
// C'est la situation NORMALE des trois premieres semaines, c'est-a-dire exactement la periode
// pendant laquelle l'utilisateur decide si l'application vaut son carnet papier.
//
// ── MULTI-SERIES (v2) ────────────────────────────────────────────────────────
// La meme fonction accepte AUSSI un tableau `series`. Les regles y sont :
//   - QUATRE courbes au maximum : au-dela, sur 360 px, on ne lit plus rien ;
//   - la forme des points varie autant que la couleur (rond, carre, triangle, losange), parce
//     qu'une palette seule exclut les daltoniens de la moitie de l'ecran ;
//   - l'axe X est l'UNION des dates : chaque serie ne trace que ses propres points, jamais une
//     valeur interpolee qui n'a jamais ete mesuree ;
//   - EXACTEMENT DEUX unites distinctes sont admises, chacune sur SA propre echelle Y
//     (graduations de la premiere a gauche, de la seconde a droite, colorees par serie) ;
//     au-dela de deux unites, la comparaison est REFUSEE avec un message, pas tracee au hasard.

// ⚠ `vider` n'est volontairement PAS importe : le fragment ne vide JAMAIS le conteneur de
// l'appelant (qui porte aussi le tableau des 20 dernieres seances), il n'en retire que sa racine.
import { svg, h, on } from '../lib/dom.js';
import { formatFr, formatDuree, formatAllure } from '../lib/num.js';
import { formatCourt, formatLong } from '../lib/dates.js';

// ─────────────────────────────────────────────────────────────────────────────
// Geometrie
// ─────────────────────────────────────────────────────────────────────────────
// Largeur VIRTUELLE du viewBox. Aucune largeur en dur n'est posee sur l'element : le SVG est
// fluide (width:100% en CSS) et se remet a l'echelle seul. Une rotation d'ecran ou l'ouverture
// d'un panneau lateral ne demande donc AUCUN re-rendu, donc aucun risque pour le contrat.
const LARGEUR = 360;

// ⚠ Marges volontairement minuscules a gauche : les graduations Y sont DESSINEES A L'INTERIEUR
// du graphe. Une colonne d'axe de 40 px volerait 11 % de la largeur utile sur un telephone de
// 360 px — c'est un point de donnee sur huit qui disparait pour afficher « 60 » deux fois.
const MARGE_HAUT = 16;    // place de l'etiquette Y la plus haute, posee au-dessus de sa ligne
const MARGE_BAS = 22;     // place des etiquettes X, jamais inclinees
const MARGE_GAUCHE = 8;
const MARGE_DROITE = 8;

const RAYON_POINT = 3;    // ⚠ points TOUJOURS visibles : la ligne seule ment sur la densite reelle

const MAX_GRADUATIONS_Y = 4;
const CIBLE_GRADUATIONS_Y = 3;
const MAX_ETIQUETTES_X = 4;

// En dessous de ce nombre de points, une « tendance » n'est que du bruit presente comme un fait.
const MIN_POINTS_TENDANCE = 4;

// ⚠ Plafond DUR de series simultanees. Ce n'est pas une preference esthetique : au-dela de
// quatre traces, sur 360 px de large et 210 px de haut, les lignes se croisent trop souvent pour
// qu'on puisse encore suivre l'une d'elles du regard.
const MAX_SERIES = 4;

// Formes de points, dans l'ordre des series. La couleur est un ORNEMENT ; la forme est
// l'information. Un daltonien deuteranope lit ce graphe exactement comme les autres.
const FORMES = ['rond', 'carre', 'triangle', 'losange'];

const MSG_VIDE = 'Enregistre une séance avec cet exercice';
const MSG_UN_POINT = 'Reviens après deux séances pour voir la courbe';
const MSG_TENDANCE_INDISPO = 'Tendance indisponible';
const MSG_TROP_SERIES = 'Quatre courbes au maximum : les suivantes ne sont pas affichées.';

// Nom lisible d'une unite BRUTE, pour le message de refus. « kg et sec-par-km » ne dit rien a
// personne ; « kilogrammes et allure » se comprend sans documentation.
const LIBELLES_UNITES = {
  'kg': 'kilogrammes',
  'reps': 'répétitions',
  'sec': 'durée',
  'sec-par-km': 'allure',
  'km/h': 'vitesse',
  'km': 'distance'
};

const libelleUnite = (u) => LIBELLES_UNITES[u] || u || 'sans unité';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// ─────────────────────────────────────────────────────────────────────────────
// Domaine et graduations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domaine vertical [min, max] d'une liste de valeurs.
 * ⚠ Le cas « toutes les valeurs sont EGALES » n'est pas un cas limite exotique : c'est le cas
 * NOMINAL de quelqu'un qui fait 3 seances de suite a 60 kg. Sans elargissement artificiel,
 * (max - min) vaut 0 et toute la mise a l'echelle devient NaN — courbe blanche, sans message.
 */
export function domaineY(valeurs) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of valeurs) {
    if (!estNombre(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [0, 1];

  if (min === max) {
    // 5 % de la valeur, ou 1 quand la valeur est nulle (|0| * 0.05 === 0 : la division par zero
    // reviendrait par la porte de derriere).
    const d = Math.abs(min) * 0.05 || 1;
    min -= d;
    max += d;
  }
  const marge = (max - min) * 0.05;
  return [min - marge, max + marge];
}

/**
 * « Nice numbers » : 1, 2, 2,5 ou 5 fois une puissance de 10.
 * Un pas brut de 3,7 kg produit des graduations 3,7 / 7,4 / 11,1 que personne ne lit ; le meme
 * intervalle arrondi a 5 donne 5 / 10 / 15, immediatement comparable a des disques reels.
 */
export function pasJoli(brut) {
  if (!estNombre(brut) || brut <= 0) return 1;
  const exp = Math.floor(Math.log10(brut));
  const f = brut / 10 ** exp;
  const facteur = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return facteur * 10 ** exp;
}

/** Graduations Y : 3 a 4 maximum. Au-dela, sur 210 px de haut, le graphe devient un cahier. */
function graduationsY(min, max) {
  const pas = pasJoli((max - min) / CIBLE_GRADUATIONS_Y);
  const debut = Math.ceil(min / pas) * pas;
  const valeurs = [];
  for (let i = 0; valeurs.length < MAX_GRADUATIONS_Y; i++) {
    // ⚠ debut + i * pas, jamais v += pas : l'accumulation de 1,25 en binaire derive et fabrique
    //    des etiquettes « 61,249999999 ».
    const v = debut + i * pas;
    if (v > max + 1e-9) break;
    valeurs.push(Math.round(v * 1e6) / 1e6);
  }
  return { valeurs, pas };
}

/** Nombre de decimales a afficher, deduit du pas des graduations. */
function decimalesDe(pas) {
  const texte = String(pas);
  const point = texte.indexOf('.');
  if (point === -1) return 0;
  return Math.min(2, texte.length - point - 1);
}

/**
 * Formate une valeur selon l'unite BRUTE de data/schema.js (UNITES).
 * Le formatage lisible est la responsabilite de lib/num.js : 'sec' devient « 1:30 » et
 * 'sec-par-km' devient « 5:42 ». Afficher « 342 sec » serait techniquement juste et inutilisable.
 */
function formatValeur(v, unite, dec) {
  if (!estNombre(v)) return '';
  if (unite === 'sec') return formatDuree(v);
  if (unite === 'sec-par-km') return formatAllure(v);
  const nombre = formatFr(v, dec);
  return unite ? `${nombre} ${unite}` : nombre;
}

/** Indices des etiquettes X : 4 AU MAXIMUM, bornes toujours incluses. */
function indicesEtiquettesX(n) {
  if (n <= MAX_ETIQUETTES_X) return Array.from({ length: n }, (_, i) => i);
  const indices = [];
  for (let k = 0; k < MAX_ETIQUETTES_X; k++) {
    indices.push(Math.round((k * (n - 1)) / (MAX_ETIQUETTES_X - 1)));
  }
  // Deduplication : sur 5 points, deux positions arrondies peuvent tomber sur le meme index.
  return indices.filter((v, i) => indices.indexOf(v) === i);
}

// ─────────────────────────────────────────────────────────────────────────────
// Description accessible
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phrase de tendance lue par un lecteur d'ecran (aria-label + <title>).
 * ⚠ `sens` vaut 'bas' pour l'allure : descendre EST un progres. Sans cette inversion,
 * l'utilisateur qui court plus vite s'entendrait annoncer une regression.
 */
function descriptionTendance(points, unite, sens, dec) {
  const n = points.length;
  if (!n) return 'Courbe sans donnée.';
  if (n === 1) return `Un seul point : ${formatValeur(points[0].y, unite, dec)}.`;

  const debut = points[0];
  const fin = points[n - 1];
  const delta = fin.y - debut.y;
  const versLeBas = sens === 'bas';
  const progresse = versLeBas ? delta < 0 : delta > 0;

  const base = `Courbe de ${n} séances, du ${formatLong(debut.x)} au ${formatLong(fin.x)}, `
    + `de ${formatValeur(debut.y, unite, dec)} à ${formatValeur(fin.y, unite, dec)}.`;

  if (n < MIN_POINTS_TENDANCE) return `${base} ${MSG_TENDANCE_INDISPO}.`;
  if (delta === 0) return `${base} Tendance stable.`;
  return `${base} Tendance ${progresse ? 'en progression' : 'en baisse'}.`;
}

/** Index du meilleur point FIABLE, ou -1. Un point non fiable ne peut JAMAIS porter un record. */
function indexRecord(points, sens) {
  const versLeBas = sens === 'bas';
  let meilleur = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // ⚠ Un cran de machine sans profil de plaques ne sait pas dire des kilos : lui coller une
    //    etoile de record serait affirmer un chiffre faux avec assurance.
    if (p.fiable === false || !estNombre(p.y)) continue;
    if (meilleur === -1 || (versLeBas ? p.y < points[meilleur].y : p.y > points[meilleur].y)) {
      meilleur = i;
    }
  }
  return meilleur;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marqueurs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Point d'une serie, dessine selon sa FORME.
 * Les quatre formes sont calibrees pour occuper une aire visuelle voisine : un triangle inscrit
 * dans le meme rayon qu'un disque parait deux fois plus petit, d'ou les facteurs 1,15 / 1,3.
 *
 * @param {'rond'|'carre'|'triangle'|'losange'} forme
 * @param {number} x coordonnee viewBox
 * @param {number} y coordonnee viewBox
 * @param {number} r rayon de reference
 * @param {object} [attrs] attributs additionnels (classe, data-*)
 */
function marqueur(forme, x, y, r, attrs) {
  const base = Object.assign({ class: 'courbe-point' }, attrs || {});
  if (forme === 'carre') {
    return svg('rect', Object.assign({}, base, {
      x: (x - r).toFixed(2), y: (y - r).toFixed(2), width: (r * 2).toFixed(2), height: (r * 2).toFixed(2)
    }));
  }
  if (forme === 'triangle') {
    return svg('path', Object.assign({}, base, {
      d: `M${x.toFixed(2)} ${(y - r * 1.3).toFixed(2)} `
        + `L${(x + r * 1.15).toFixed(2)} ${(y + r * 0.85).toFixed(2)} `
        + `L${(x - r * 1.15).toFixed(2)} ${(y + r * 0.85).toFixed(2)} Z`
    }));
  }
  if (forme === 'losange') {
    return svg('path', Object.assign({}, base, {
      d: `M${x.toFixed(2)} ${(y - r * 1.3).toFixed(2)} `
        + `L${(x + r * 1.3).toFixed(2)} ${y.toFixed(2)} `
        + `L${x.toFixed(2)} ${(y + r * 1.3).toFixed(2)} `
        + `L${(x - r * 1.3).toFixed(2)} ${y.toFixed(2)} Z`
    }));
  }
  return svg('circle', Object.assign({}, base, { cx: x.toFixed(2), cy: y.toFixed(2), r }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation de l'entree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ramene les deux formes d'appel a une seule structure interne.
 * L'appel historique `{ points }` devient une serie unique et sans libelle : aucun appelant
 * existant n'a a changer, et le rendu d'une serie unique reste STRICTEMENT celui d'avant.
 */
function normaliserSeries(brutes, points, unite) {
  const source = Array.isArray(brutes) && brutes.length
    ? brutes
    : [{ id: 'principale', libelle: null, points }];

  return source.map((s, i) => {
    const src = s || {};
    return {
      id: src.id == null ? 'serie-' + i : String(src.id),
      libelle: src.libelle == null ? null : String(src.libelle),
      couleur: src.couleur || null,
      // Une serie peut porter sa propre unite ; a defaut elle herite de celle du graphe.
      unite: src.unite == null ? unite : src.unite,
      // On ne fait confiance a rien : un point sans y numerique casserait la mise a l'echelle.
      points: (Array.isArray(src.points) ? src.points : []).filter((p) => p && estNombre(p.y))
    };
  });
}

/** Union triee des dates de toutes les series : l'axe X commun, sans point invente. */
function axeUnion(series) {
  const vues = new Set();
  for (const s of series) for (const p of s.points) vues.add(p.x);
  return Array.from(vues).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trace une ou plusieurs courbes dans `conteneur`.
 *
 * @param {Element} conteneur          hote ; le fragment y ajoute SON propre noeud racine
 * @param {object}  options
 * @param {{x:string,y:number,libelle?:string,fiable?:boolean,seanceId?:string}[]} [options.points]
 *        appel HISTORIQUE, serie unique. Deja trie par x croissant.
 * @param {{id:string,libelle:string,points:object[],couleur?:string,unite?:string}[]} [options.series]
 *        appel MULTI-SERIES. 4 series affichees au maximum.
 * @param {string}  [options.unite]    unite BRUTE de data/schema.UNITES ('kg', 'sec', 'sec-par-km'…)
 * @param {'haut'|'bas'} [options.sens='haut']  'bas' pour l'allure : descendre est un progres
 * @param {number}  [options.hauteur=210]
 * @param {(point:object, index:number, serie:object) => void} [options.onSelect] tap sur un point
 * @returns {{ detruire: () => void }}
 */
export function renderLineChart(conteneur, options = {}) {
  const {
    points: bruts,
    series: brutesSeries,
    unite = '',
    sens = 'haut',
    hauteur = 210,
    onSelect
  } = options;

  const racine = h('div', { class: 'courbe' });
  const offs = [];
  let bulle = null;

  const detruire = () => {
    for (const off of offs) off();
    offs.length = 0;
    bulle = null;
    // Le fragment ne retire QUE son propre noeud : il ne vide pas le conteneur de l'appelant,
    // qui peut legitimement contenir le tableau des 20 dernieres seances juste en dessous.
    if (racine.parentNode) racine.parentNode.removeChild(racine);
  };

  const finir = () => {
    conteneur.appendChild(racine);
    return { detruire };
  };

  const toutes = normaliserSeries(brutesSeries, bruts, unite);
  const pleines = toutes.filter((s) => s.points.length);

  // ── Refus explicite : des unites incompatibles ────────────────────────────
  // ⚠ Superposer des kilos et des minutes sur un meme axe produit un graphe qui a l'air juste et
  //    qui ne veut rien dire. EXACTEMENT DEUX unites distinctes sont toutefois admises : chacune
  //    recoit alors SA propre echelle Y (graduations de la premiere a gauche, de la seconde a
  //    droite, dans la couleur de leur serie). Au-dela de deux, on refuse EN LE DISANT.
  const unites = [];
  for (const s of pleines) if (unites.indexOf(s.unite) === -1) unites.push(s.unite);
  if (unites.length > 2) {
    racine.appendChild(h('div', { class: 'courbe-refus', role: 'status' },
      h('p', { class: 'courbe-refus-titre' }, 'Comparaison impossible'),
      h('p', { class: 'courbe-refus-texte' },
        `Ces courbes ne se mesurent pas dans la même unité (${unites.map(libelleUnite).join(' et ')}). `
        + 'Choisis une métrique commune aux exercices sélectionnés.')
    ));
    return finir();
  }

  /**
   * Bulle de lecture. Noeud PERSISTANT dont on ne mute que le texte et la position : jamais
   * recreee, donc jamais de clignotement, et rien a re-attacher.
   */
  function poserBulle(graphe, texte, xVue, yVue) {
    if (!bulle) {
      bulle = h('div', { class: 'courbe-bulle' });
      racine.appendChild(bulle);
    }
    bulle.textContent = texte;
    bulle.hidden = false;

    // Conversion coordonnees viewBox -> pixels reels, relue a chaque tap : elle survit ainsi a
    // une rotation d'ecran sans le moindre ecouteur de redimensionnement.
    const rectSvg = graphe.getBoundingClientRect();
    const rectRacine = racine.getBoundingClientRect();
    const ratio = rectSvg.width / LARGEUR;
    const gauche = (rectSvg.left - rectRacine.left) + xVue * ratio;
    const haut = (rectSvg.top - rectRacine.top) + yVue * ratio;

    bulle.style.left = '0px';
    bulle.style.top = `${Math.max(0, haut - bulle.offsetHeight - 10)}px`;
    // Recadrage horizontal APRES mesure : une bulle centree sur le premier point deborde a
    // gauche du conteneur et se fait couper.
    const largeurBulle = bulle.offsetWidth;
    const x = Math.min(
      Math.max(0, gauche - largeurBulle / 2),
      Math.max(0, rectRacine.width - largeurBulle)
    );
    bulle.style.left = `${x}px`;
  }

  // ── Une seule serie porteuse de donnees : rendu HISTORIQUE, inchange ──────
  // C'est aussi le chemin des cas 0 et 1 point, et celui de tous les appelants d'origine.
  if (pleines.length <= 1) {
    const serie = pleines[0] || toutes[0] || { points: [], unite, libelle: null };
    rendreSimple(serie);
    const avis = avisSeriesVides(toutes, pleines);
    if (avis) racine.appendChild(avis);
    return finir();
  }

  rendreMulti();
  return finir();

  // ═══════════════════════════════════════════════════════════════════════════
  // Rendu a une serie — le contrat d'origine, mot pour mot
  // ═══════════════════════════════════════════════════════════════════════════

  function rendreSimple(serie) {
    const points = serie.points;
    const uniteSerie = serie.unite == null ? unite : serie.unite;

    // ── Cas 0 point : etat vide PORTEUR D'UNE ISSUE ──────────────────────────
    if (points.length === 0) {
      racine.appendChild(h('div', { class: 'etat-vide' },
        illustrationVide(),
        h('p', { class: 'etat-vide-titre' }, 'Pas encore de courbe'),
        h('p', { class: 'etat-vide-texte' }, MSG_VIDE)
      ));
      return;
    }

    const [minY, maxY] = domaineY(points.map((p) => p.y));
    const { valeurs: ticks, pas } = graduationsY(minY, maxY);
    const dec = decimalesDe(pas);

    // ── Cas 1 point : grande carte chiffree ─────────────────────────────────
    // ⚠ Une « courbe » a un point est un pixel. Le chiffre, lui, se lit a un metre.
    if (points.length === 1) {
      const p = points[0];
      racine.appendChild(h('div', { class: 'courbe-valeur-unique' },
        h('div', { class: 'courbe-valeur-unique-nombre' }, formatValeur(p.y, uniteSerie, dec)),
        h('div', { class: 'etat-vide-texte' }, `Le ${formatLong(p.x)}`),
        p.libelle ? h('div', { class: 'etat-vide-texte' }, p.libelle) : null
      ));
      racine.appendChild(h('p', { class: 'courbe-avis' }, MSG_UN_POINT));
      return;
    }

    // ── Cas nominal : la courbe ─────────────────────────────────────────────
    const hautPlot = MARGE_HAUT;
    const basPlot = hauteur - MARGE_BAS;
    const gauchePlot = MARGE_GAUCHE;
    const droitePlot = LARGEUR - MARGE_DROITE;
    const largeurPlot = droitePlot - gauchePlot;
    const hauteurPlot = basPlot - hautPlot;
    const etendueY = maxY - minY;

    // Echelle X par INDEX et non par date : deux entrees du meme exercice dans une meme seance
    // partagent la meme dayKey, et une echelle temporelle les superposerait exactement.
    const xDe = (i) => gauchePlot + (points.length === 1 ? largeurPlot / 2 : (i * largeurPlot) / (points.length - 1));
    const yDe = (v) => basPlot - ((v - minY) / etendueY) * hauteurPlot;

    const description = descriptionTendance(points, uniteSerie, sens, dec);

    const graphe = svg('svg', {
      class: 'courbe-svg',
      viewBox: `0 0 ${LARGEUR} ${hauteur}`,
      // ⚠ preserveAspectRatio par defaut suffit : aucune largeur en dur, la reactivite est acquise.
      role: 'img',
      'aria-label': description
    });
    graphe.appendChild(svg('title', null, description));

    // Graduations horizontales fines, DANS le graphe, etiquette posee au-dessus de sa ligne.
    const grille = svg('g', { class: 'courbe-grille' });
    const etiquettesY = svg('g', { class: 'courbe-etiquette-y' });
    for (const t of ticks) {
      const y = yDe(t);
      grille.appendChild(svg('line', { x1: gauchePlot, y1: y, x2: droitePlot, y2: y }));
      etiquettesY.appendChild(svg('text', {
        x: gauchePlot + 2,
        y: y - 4,
        'text-anchor': 'start'
      }, formatValeur(t, uniteSerie, dec)));
    }
    graphe.appendChild(grille);

    // Aire puis trace : l'aire en premier pour que la ligne passe DESSUS.
    const segments = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xDe(i).toFixed(2)} ${yDe(p.y).toFixed(2)}`);
    const d = segments.join(' ');
    graphe.appendChild(svg('path', {
      class: 'courbe-aire',
      d: `${d} L${xDe(points.length - 1).toFixed(2)} ${basPlot} L${xDe(0).toFixed(2)} ${basPlot} Z`
    }));
    graphe.appendChild(svg('path', { class: 'courbe-trace', d }));

    graphe.appendChild(etiquettesY);

    // Etiquettes X : 4 au maximum, format 12/03, JAMAIS inclinees. Les bornes sont ancrees vers
    // l'interieur, sans quoi la premiere et la derniere sortent du viewBox et se font rogner.
    const etiquettesX = svg('g', { class: 'courbe-etiquette' });
    const indices = indicesEtiquettesX(points.length);
    for (const i of indices) {
      const ancre = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
      etiquettesX.appendChild(svg('text', {
        x: xDe(i),
        y: hauteur - 6,
        'text-anchor': ancre
      }, formatCourt(points[i].x)));
    }
    graphe.appendChild(etiquettesX);

    // Points, toujours visibles. Non fiables en CONTOUR CREUX (resolu par le CSS via data-fiable).
    const groupePoints = svg('g', null);
    const cercles = points.map((p, i) => {
      const c = svg('circle', {
        class: 'courbe-point',
        cx: xDe(i),
        cy: yDe(p.y),
        r: RAYON_POINT,
        'data-fiable': p.fiable === false ? 'non' : 'oui',
        'data-index': i
      });
      groupePoints.appendChild(c);
      return c;
    });
    graphe.appendChild(groupePoints);

    // Etoile de record sur le meilleur point FIABLE. Jamais sur un point creux.
    const iRecord = indexRecord(points, sens);
    if (iRecord !== -1) {
      graphe.appendChild(svg('text', {
        class: 'courbe-etiquette',
        x: xDe(iRecord),
        y: yDe(points[iRecord].y) - 8,
        'text-anchor': 'middle',
        'aria-hidden': 'true'
      }, '★'));
    }

    // Zone de captation : un seul rectangle transparent plutot qu'un ecouteur par point. Un point
    // de 3 px de rayon est intouchable au doigt ; ici c'est le point le plus proche EN X qui gagne,
    // quelle que soit la hauteur du tap. Pas de pincement pour zoomer : rien a ce sujet, donc rien
    // a desactiver, et le geste de scroll de la page reste intact.
    const capteur = svg('rect', {
      x: gauchePlot,
      y: hautPlot - MARGE_HAUT,
      width: largeurPlot,
      height: hauteur,
      fill: 'transparent'
    });
    graphe.appendChild(capteur);

    racine.appendChild(graphe);

    // Lisere « Tendance indisponible » : 2 ou 3 points tracent une courbe honnete, mais la pente
    // entre deux seances n'est pas une tendance. On le DIT plutot que de laisser croire.
    if (points.length < MIN_POINTS_TENDANCE) {
      racine.appendChild(h('p', { class: 'courbe-avis' }, MSG_TENDANCE_INDISPO));
    }

    let pointSelectionne = null;

    function selectionner(i) {
      const p = points[i];
      if (!p) return;

      if (pointSelectionne !== null && cercles[pointSelectionne]) {
        cercles[pointSelectionne].removeAttribute('data-selectionne');
      }
      pointSelectionne = i;
      cercles[i].setAttribute('data-selectionne', 'oui');

      const detail = p.libelle || formatValeur(p.y, uniteSerie, dec);
      poserBulle(graphe, `Le ${formatLong(p.x)} : ${detail}`, xDe(i), yDe(p.y));

      if (typeof onSelect === 'function') onSelect(p, i, serie);
    }

    /** Point le plus proche EN X du tap. */
    function indexLePlusProche(clientX) {
      const rectSvg = graphe.getBoundingClientRect();
      if (!rectSvg.width) return 0;
      const xVue = ((clientX - rectSvg.left) / rectSvg.width) * LARGEUR;
      let meilleur = 0;
      let ecart = Infinity;
      for (let i = 0; i < points.length; i++) {
        const e = Math.abs(xDe(i) - xVue);
        if (e < ecart) { ecart = e; meilleur = i; }
      }
      return meilleur;
    }

    // pointerdown et non click : le retour visuel arrive sous le doigt, sans les 300 ms de certains
    // navigateurs. L'ecouteur appartient au fragment, qui est le seul a pouvoir le detruire.
    offs.push(on(graphe, 'pointerdown', (ev) => {
      if (!points.length) return;
      selectionner(indexLePlusProche(ev.clientX));
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rendu MULTI-SERIES
  // ═══════════════════════════════════════════════════════════════════════════

  function rendreMulti() {
    // ⚠ Plafond applique ICI et pas seulement chez l'appelant : le moteur doit rester lisible
    //    quel que soit ce qu'on lui donne.
    const series = pleines.slice(0, MAX_SERIES);
    const tronquees = pleines.length > MAX_SERIES;
    const uniteDe = (s) => (s.unite == null ? unite : s.unite);

    // ── Echelles : UNE par unite (une ou deux, la garde d'unites a deja tranche) ──
    // Domaine calcule sur TOUTES les series visibles au montage. Masquer une serie depuis la
    // legende ne remet PAS l'echelle a jour : une echelle qui saute a chaque tap rend toute
    // comparaison visuelle impossible, et cela reconstruirait le sous-arbre du fragment.
    // A DEUX unites, chaque serie est projetee sur l'echelle de SON unite : les kilos et les
    // repetitions gardent chacun toute la hauteur du graphe.
    const unitesVisibles = [];
    for (const s of series) {
      const u = uniteDe(s);
      if (unitesVisibles.indexOf(u) === -1) unitesVisibles.push(u);
    }
    const echelles = new Map();
    for (const u of unitesVisibles) {
      const vals = [];
      for (const s of series) if (uniteDe(s) === u) for (const p of s.points) vals.push(p.y);
      const [minY, maxY] = domaineY(vals);
      const { valeurs: ticks, pas } = graduationsY(minY, maxY);
      echelles.set(u, { unite: u, minY, maxY, ticks, dec: decimalesDe(pas) });
    }
    const echelleDe = (s) => echelles.get(uniteDe(s));

    // ── Axe X : UNION des dates ──────────────────────────────────────────────
    // Chaque serie ne trace que ses propres points. Une date ou une serie n'a rien mesure reste
    // un TROU dans sa ligne : on ne fabrique aucune valeur intermediaire.
    const dates = axeUnion(series);
    const parDate = new Map(dates.map((d, i) => [d, i]));

    const hautPlot = MARGE_HAUT;
    const basPlot = hauteur - MARGE_BAS;
    const gauchePlot = MARGE_GAUCHE;
    const droitePlot = LARGEUR - MARGE_DROITE;
    const largeurPlot = droitePlot - gauchePlot;
    const hauteurPlot = basPlot - hautPlot;

    const xDe = (i) => gauchePlot + (dates.length === 1 ? largeurPlot / 2 : (i * largeurPlot) / (dates.length - 1));
    const yDe = (ech, v) => basPlot - ((v - ech.minY) / (ech.maxY - ech.minY)) * hauteurPlot;

    const description = 'Comparaison de ' + series.length + ' courbes. '
      + series.map((s) => {
        const ech = echelleDe(s);
        return `${s.libelle || 'Courbe'} : ${descriptionTendance(s.points, ech.unite, sens, ech.dec)}`;
      }).join(' ');

    const graphe = svg('svg', {
      class: 'courbe-svg',
      viewBox: `0 0 ${LARGEUR} ${hauteur}`,
      role: 'img',
      'aria-label': description
    });
    graphe.appendChild(svg('title', null, description));

    // Grille : celle de l'echelle de GAUCHE uniquement. A deux unites, deux grilles entrelacees
    // ne seraient que du bruit — les etiquettes de droite suffisent a lire la seconde echelle.
    const echelleGauche = echelles.get(unitesVisibles[0]);
    const grille = svg('g', { class: 'courbe-grille' });
    for (const t of echelleGauche.ticks) {
      const y = yDe(echelleGauche, t);
      grille.appendChild(svg('line', { x1: gauchePlot, y1: y, x2: droitePlot, y2: y }));
    }
    graphe.appendChild(grille);

    // Etiquettes Y : premiere unite a GAUCHE, seconde a DROITE. A deux unites, chaque groupe
    // prend via data-serie la couleur de la PREMIERE serie qui porte son unite (regle css/v2.css) :
    // le lien echelle↔courbe se lit d'un coup d'oeil. A une seule unite, rendu inchange.
    const rangDe = (u) => {
      for (let i = 0; i < series.length; i++) if (uniteDe(series[i]) === u) return i + 1;
      return 1;
    };
    const couleurDe = (u) => {
      for (const s of series) if (uniteDe(s) === u) return s.couleur || null;
      return null;
    };
    unitesVisibles.forEach((u, cote) => {
      const ech = echelles.get(u);
      const attrs = { class: 'courbe-etiquette-y' };
      if (unitesVisibles.length === 2) attrs['data-serie'] = String(rangDe(u));
      const groupeEtiquettes = svg('g', attrs);
      const couleur = unitesVisibles.length === 2 ? couleurDe(u) : null;
      if (couleur) groupeEtiquettes.style.setProperty('--serie-couleur', couleur);
      for (const t of ech.ticks) {
        const y = yDe(ech, t);
        groupeEtiquettes.appendChild(svg('text', {
          x: cote === 0 ? gauchePlot + 2 : droitePlot - 2,
          y: y - 4,
          'text-anchor': cote === 0 ? 'start' : 'end'
        }, formatValeur(t, ech.unite, ech.dec)));
      }
      graphe.appendChild(groupeEtiquettes);
    });

    // Etiquettes X : 4 au maximum, jamais inclinees, prises sur l'axe COMMUN.
    const etiquettesX = svg('g', { class: 'courbe-etiquette' });
    for (const i of indicesEtiquettesX(dates.length)) {
      const ancre = i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle';
      etiquettesX.appendChild(svg('text', {
        x: xDe(i),
        y: hauteur - 6,
        'text-anchor': ancre
      }, formatCourt(dates[i])));
    }
    graphe.appendChild(etiquettesX);

    // ⚠ AUCUNE aire remplie en multi-series : quatre aires superposees se recouvrent et le
    //    lecteur ne sait plus quelle surface appartient a quelle courbe.
    const rendus = series.map((serie, rang) => {
      const forme = FORMES[rang % FORMES.length];
      const groupe = svg('g', {
        class: 'courbe-serie',
        'data-serie': String(rang + 1),
        'data-forme': forme
      });
      // Une couleur explicite, quand l'appelant en fournit une, passe par une propriete
      // personnalisee : le CSS reste maitre du reste (epaisseur, opacite, contour creux).
      if (serie.couleur) groupe.style.setProperty('--serie-couleur', serie.couleur);

      const echelleSerie = echelleDe(serie);
      const positions = serie.points.map((p) => ({
        p,
        x: xDe(parDate.get(p.x)),
        y: yDe(echelleSerie, p.y)
      }));

      const d = positions
        .map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)} ${q.y.toFixed(2)}`)
        .join(' ');
      groupe.appendChild(svg('path', { class: 'courbe-trace', d }));

      const marques = positions.map((q, i) => {
        const m = marqueur(forme, q.x, q.y, RAYON_POINT, {
          'data-fiable': q.p.fiable === false ? 'non' : 'oui',
          'data-index': i
        });
        groupe.appendChild(m);
        return m;
      });

      graphe.appendChild(groupe);
      return { serie, rang, forme, groupe, positions, marques, masquee: false };
    });

    // Zone de captation unique, comme en serie simple.
    graphe.appendChild(svg('rect', {
      x: gauchePlot,
      y: hautPlot - MARGE_HAUT,
      width: largeurPlot,
      height: hauteur,
      fill: 'transparent'
    }));

    racine.appendChild(graphe);

    // ── Legende compacte et tapable ──────────────────────────────────────────
    const legende = h('div', { class: 'courbe-legende' });
    for (const r of rendus) {
      legende.appendChild(h('button', {
        type: 'button',
        class: 'courbe-legende-item',
        'data-action': 'basculer-serie',
        'data-serie': String(r.rang + 1),
        'data-forme': r.forme,
        'aria-pressed': 'true'
      },
      echantillon(r.forme, r.rang + 1, r.serie.couleur),
      h('span', { class: 'courbe-legende-nom' }, r.serie.libelle || `Courbe ${r.rang + 1}`)
      ));
    }
    racine.appendChild(legende);

    if (tronquees) racine.appendChild(h('p', { class: 'courbe-avis' }, MSG_TROP_SERIES));
    const avis = avisSeriesVides(toutes, pleines);
    if (avis) racine.appendChild(avis);

    // Bascule d'une serie : on ne reconstruit RIEN, on pose un style et deux attributs.
    // ⚠ display en style INLINE et non via une classe : l'etat fonctionnel d'un fragment ne doit
    //    dependre ni d'une feuille de style pas encore chargee, ni de requestAnimationFrame.
    offs.push(on(legende, 'click', (ev) => {
      const cible = ev.target instanceof Element
        ? ev.target.closest('[data-action="basculer-serie"]')
        : null;
      if (!cible || !legende.contains(cible)) return;
      const rang = Number(cible.getAttribute('data-serie')) - 1;
      const r = rendus[rang];
      if (!r) return;
      r.masquee = !r.masquee;
      r.groupe.style.display = r.masquee ? 'none' : '';
      r.groupe.setAttribute('data-masque', r.masquee ? 'oui' : 'non');
      cible.setAttribute('aria-pressed', r.masquee ? 'false' : 'true');
      cible.setAttribute('data-masque', r.masquee ? 'oui' : 'non');
      if (r.masquee && selection && selection.rendu === r) deselectionner();
    }));

    let selection = null;

    function deselectionner() {
      if (selection) selection.marque.removeAttribute('data-selectionne');
      selection = null;
      // La bulle est MASQUEE, jamais retiree : elle est persistante par contrat.
      if (bulle) { bulle.textContent = ''; bulle.hidden = true; }
    }

    /** Point le plus proche du tap, toutes series VISIBLES confondues : X d'abord, puis Y. */
    function plusProche(clientX, clientY) {
      const rectSvg = graphe.getBoundingClientRect();
      if (!rectSvg.width) return null;
      const ratio = rectSvg.width / LARGEUR;
      const xVue = (clientX - rectSvg.left) / ratio;
      const yVue = (clientY - rectSvg.top) / ratio;

      let meilleur = null;
      let meilleurEcart = Infinity;
      for (const r of rendus) {
        if (r.masquee) continue;
        for (let i = 0; i < r.positions.length; i++) {
          const q = r.positions[i];
          // L'ecart en X pese quatre fois plus que celui en Y : le doigt vise une DATE, il ne
          // vise pas une altitude au pixel pres.
          const ecart = Math.abs(q.x - xVue) * 4 + Math.abs(q.y - yVue);
          if (ecart < meilleurEcart) {
            meilleurEcart = ecart;
            meilleur = { rendu: r, index: i, position: q, marque: r.marques[i] };
          }
        }
      }
      return meilleur;
    }

    offs.push(on(graphe, 'pointerdown', (ev) => {
      const trouve = plusProche(ev.clientX, ev.clientY);
      if (!trouve) return;
      deselectionner();
      selection = trouve;
      trouve.marque.setAttribute('data-selectionne', 'oui');

      const p = trouve.position.p;
      const nom = trouve.rendu.serie.libelle;
      const ech = echelleDe(trouve.rendu.serie);
      const detail = p.libelle || formatValeur(p.y, ech.unite, ech.dec);
      poserBulle(
        graphe,
        `${nom ? nom + ' — ' : ''}${formatLong(p.x)} : ${detail}`,
        trouve.position.x,
        trouve.position.y
      );

      if (typeof onSelect === 'function') onSelect(p, trouve.index, trouve.rendu.serie);
    }));
  }
}

/**
 * Liseré nommant les series demandees mais sans aucun point sur la plage affichee.
 * @returns {Element|null} null quand il n'y a rien a dire — l'appelant ne pose alors AUCUN noeud.
 */
function avisSeriesVides(toutes, pleines) {
  const vides = toutes.filter((s) => pleines.indexOf(s) === -1 && s.libelle);
  if (!vides.length) return null;
  return h('p', { class: 'courbe-avis' },
    `Sans donnée sur cette période : ${vides.map((s) => s.libelle).join(', ')}.`);
}

/**
 * Pastille de legende : un segment de trace et le marqueur de la serie.
 * Le marqueur est reproduit A L'IDENTIQUE — c'est lui, et non la couleur, qui fait le lien entre
 * la legende et la courbe pour qui ne distingue pas les teintes.
 */
function echantillon(forme, rang, couleur) {
  const el = svg('svg', {
    class: 'courbe-legende-marque',
    viewBox: '0 0 20 12',
    'data-serie': String(rang),
    'data-forme': forme,
    'aria-hidden': 'true'
  });
  if (couleur) el.style.setProperty('--serie-couleur', couleur);
  el.appendChild(svg('line', { class: 'courbe-trace', x1: 1, y1: 6, x2: 19, y2: 6 }));
  el.appendChild(marqueur(forme, 10, 6, 3, { 'data-fiable': 'oui' }));
  return el;
}

/**
 * Illustration de l'etat vide : trois barres et une ligne montante, en SVG.
 * Decorative, donc aria-hidden : la faire lire n'ajouterait rien au message qui la suit.
 */
function illustrationVide() {
  const el = svg('svg', {
    class: 'courbe-svg',
    viewBox: '0 0 120 72',
    'aria-hidden': 'true',
    style: { width: '120px', opacity: '0.45' }
  });
  el.appendChild(svg('g', { class: 'courbe-grille' },
    svg('line', { x1: 8, y1: 18, x2: 112, y2: 18 }),
    svg('line', { x1: 8, y1: 40, x2: 112, y2: 40 }),
    svg('line', { x1: 8, y1: 62, x2: 112, y2: 62 })
  ));
  el.appendChild(svg('path', {
    class: 'courbe-trace',
    'stroke-dasharray': '5 5',
    d: 'M10 58 L40 46 L70 34 L100 16'
  }));
  return el;
}
