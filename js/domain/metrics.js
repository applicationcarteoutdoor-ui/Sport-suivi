// domain/metrics.js — calculs derives d'une serie, d'une entree, d'une seance.
//
// Module PUR : aucun DOM, aucune I/O, aucun acces au store. Seules dependances autorisees :
// data/schema.js (le contrat) et lib/num.js (formatage de nombres, sans connaissance du domaine).
//
// Deux invariants portes par ce fichier :
//   1. Le drapeau `fiable` se propage de bout en bout. Un point non fiable sera rendu en contour
//      creux et ne peut JAMAIS porter un badge de record. Modeliser l'incertitude vaut mieux que
//      produire un chiffre faux avec assurance.
//   2. Tout agregat filtre `estComptable` : un echauffement compte pour zero dans le tonnage,
//      dans les records et dans les courbes.

import { estComptable, champsSaisieEntree, CHAMPS_VALEUR } from '../data/schema.js';
import { formatFr, formatDuree } from '../lib/num.js';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// ─────────────────────────────────────────────────────────────────────────────
// 1RM estime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1RM estime par la formule d'Epley. Formule UNIQUE, aucun reglage utilisateur.
 *
 * ⚠ Brzycki est REJETE : son denominateur (37 - reps) s'annule a 37 repetitions puis devient
 *   NEGATIF au-dela — un cas parfaitement atteignable en pompes, qui produirait une charge
 *   estimee infinie puis negative sans qu'aucune donnee ne soit fausse.
 * ⚠ Au-dela de 12 repetitions, Epley decroche : on retourne null plutot qu'un chiffre inventable.
 *   C'est progression.js qui bascule alors sur charge-max avec un message explicite ; une courbe
 *   vide sans explication serait pire qu'une metrique indisponible.
 *
 * @returns {number|null}
 */
export function e1rm(chargeKg, reps) {
  if (!estNombre(chargeKg) || !estNombre(reps) || reps < 1) return null;
  if (reps === 1) return chargeKg; // pas d'extrapolation sur une serie deja maximale
  if (reps > 12) return null;
  return chargeKg * (1 + reps / 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// Charge effective
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Charge reellement deplacee par une serie, tous modes confondus, en kg.
 *
 * ⚠ SEUL `switch` sur un mode en dehors de data/schema.js (exception nommee dans le plan) :
 *   la conversion « unite de saisie -> kilos » est intrinsequement polymorphe et n'a pas de
 *   representation tabulaire honnete.
 * ⚠ Les coefficients sont lus sur l'ENTREE (bodyweightFactorUtilise, machineProfileUtilise),
 *   JAMAIS sur l'exercice courant : corriger le facteur des pompes de 0,65 a 0,75 reecrirait
 *   sinon en silence trois ans de tonnage deja enregistre.
 *
 * @returns {{kg: number|null, fiable: boolean}}
 */
export function chargeEffectiveKg(serie, entree, seance) {
  const s = serie || {};
  const e = entree || {};
  const bwf = e.bodyweightFactorUtilise; // GELE sur l'entree, pas lu sur l'Exercice

  switch (e.modeUtilise) {
    case 'charge':
      if (!estNombre(s.chargeKg)) return { kg: null, fiable: false };
      return { kg: s.chargeKg, fiable: true };

    case 'poids-du-corps':
    case 'temps': {
      const pdc = seance ? seance.poidsDeCorpsKg : null;
      // Sans poids de corps du jour, le calcul serait une invention : on degrade au lieu de deviner.
      if (!estNombre(pdc) || !estNombre(bwf)) return { kg: null, fiable: false };
      // lestKg est SIGNE : +10 lest, -20 assistance elastique. Une seule droite de progression.
      return { kg: pdc * bwf + (estNombre(s.lestKg) ? s.lestKg : 0), fiable: true };
    }

    case 'machine': {
      const p = e.machineProfileUtilise;
      // Sans profil de machine, le numero de cran reste exploitable EN CRANS : le convertir en
      // kilos au jugé melangerait deux salles sur la meme courbe.
      if (!p || !estNombre(p.kgParPlaque) || !estNombre(s.valeur)) return { kg: null, fiable: false };
      return { kg: (estNombre(p.offsetKg) ? p.offsetKg : 0) + s.valeur * p.kgParPlaque, fiable: true };
    }

    default:
      // cardio, mode inconnu, entree corrompue a l'import : aucune charge, et on le dit.
      return { kg: null, fiable: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tonnage
// ─────────────────────────────────────────────────────────────────────────────

// Un exercice unilateral se saisit « par cote » : les repetitions notees valent pour un cote,
// le volume reel est donc double. `unilateral` restant une dimension d'AFFICHAGE, il n'ajoute
// aucun champ a Serie ; seul le tonnage le prend en compte.
// ⚠ On lit UNIQUEMENT le coefficient gele sur l'entree. Un repli sur entree.unilateral ou sur
//   l'exercice courant violerait le principe 2 du modele de donnees — et masquerait le jour ou
//   le gel cesse d'etre fait, en rendant le defaut invisible au lieu de le rendre testable.
function facteurUnilateral(entree) {
  return entree && entree.unilateralUtilise === true ? 2 : 1;
}

/**
 * Tonnage d'une entree de seance : somme de charge effective x repetitions sur les seules
 * series COMPTABLES (done et non echauffement).
 *
 * `fiable` vaut false des qu'une serie comptable n'a pas pu etre convertie en kilos : le total
 * est alors un minorant, jamais une valeur exacte. Le propager permet a la fin de seance
 * d'afficher « environ » plutot qu'un chiffre net et faux.
 *
 * @returns {{kg: number, fiable: boolean}}
 */
export function tonnageEntree(entree, seance) {
  if (!entree || !Array.isArray(entree.series)) return { kg: 0, fiable: true };

  const facteur = facteurUnilateral(entree);
  let total = 0;
  let fiable = true;

  for (const serie of entree.series) {
    if (!estComptable(serie)) continue;
    // Les modes sans repetitions (temps, cardio) ne produisent aucun tonnage : ils ne rendent
    // pas le total incertain pour autant, ils n'y contribuent simplement pas.
    if (!estNombre(serie.reps) || serie.reps <= 0) continue;

    const { kg, fiable: ok } = chargeEffectiveKg(serie, entree, seance);
    if (!ok || !estNombre(kg)) { fiable = false; continue; }
    total += kg * serie.reps * facteur;
  }

  return { kg: total, fiable };
}

/**
 * Tonnage d'une seance entiere.
 * @returns {{kg: number, fiable: boolean}}
 */
export function tonnageSeance(seance) {
  if (!seance || !Array.isArray(seance.entrees)) return { kg: 0, fiable: true };

  let total = 0;
  let fiable = true;
  for (const entree of seance.entrees) {
    const t = tonnageEntree(entree, seance);
    total += t.kg;
    if (!t.fiable) fiable = false; // une seule incertitude suffit a rendre le total approximatif
  }
  return { kg: total, fiable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cardio — allure et vitesse sont TOUJOURS derivees, jamais saisies ni stockees
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allure en secondes par kilometre.
 * null si la distance est absente ou nulle : la distance est OPTIONNELLE en mode cardio, et
 * diviser par zero produirait Infinity, qui traverserait ensuite toutes les echelles de courbe.
 * ⚠ Une allure PLUS BASSE est meilleure (sens 'bas' dans progression.js).
 *
 * @returns {number|null}
 */
export function allureSecParKm(serie) {
  const s = serie || {};
  if (!estNombre(s.distanceM) || s.distanceM <= 0) return null;
  if (!estNombre(s.dureeSec) || s.dureeSec <= 0) return null;
  return s.dureeSec / (s.distanceM / 1000);
}

/**
 * Vitesse moyenne en km/h.
 * @returns {number|null}
 */
export function vitesseKmH(serie) {
  const s = serie || {};
  if (!estNombre(s.distanceM) || s.distanceM <= 0) return null;
  if (!estNombre(s.dureeSec) || s.dureeSec <= 0) return null;
  return (s.distanceM / 1000) / (s.dureeSec / 3600);
}

// ─────────────────────────────────────────────────────────────────────────────
// Records
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vrai si `valeur` bat `precedente` d'un ecart significatif.
 *
 * ⚠ La tolerance est incrementKg / 2 : sans elle, un profil de machine ou un poids de corps qui
 *   bouge de 200 g declencherait un badge « record » a chaque seance, et le badge ne voudrait
 *   plus rien dire. Un demi-increment est le plus petit ecart que l'utilisateur puisse
 *   reellement produire en salle.
 *
 * @param {number|null} valeur
 * @param {number|null} precedente  null = aucune reference, donc premier point = record
 * @param {number} incrementKg
 * @param {'haut'|'bas'} [sens='haut']  'bas' pour l'allure, ou progresser = descendre
 */
export function estRecord(valeur, precedente, incrementKg, sens = 'haut') {
  if (!estNombre(valeur)) return false;
  const tolerance = estNombre(incrementKg) && incrementKg > 0 ? incrementKg / 2 : 0;
  if (!estNombre(precedente)) return true;
  return sens === 'bas'
    ? precedente - valeur > tolerance
    : valeur - precedente > tolerance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatage d'une serie — UNIQUE formateur du projet, en DEUX formes
//   · resumeSerie        -> une phrase (« 8 × 102,5 kg ») : lignes de serie, infobulles, voix
//   · resumeSerieCellule -> deux lignes (« 8 » / « ×102,5 ») : les trois ecrans en TABLEAU
// Les deux derivent des memes champs de saisie geles : elles ne peuvent pas diverger.
// ─────────────────────────────────────────────────────────────────────────────

// Repli utilise quand l'entree est absente (import degrade, serie orpheline) : on deduit les
// champs de ce que la serie porte reellement, faute de mode gele pour le dire.
function champsPresents(serie) {
  return CHAMPS_VALEUR.filter((c) => estNombre(serie[c]));
}

// Suffixe de lest, SIGNE : « +10 kg » lest, « -20 kg » assistance. Un lest nul ou absent ne
// s'affiche pas : « 8 x +0 kg » se lit plus mal que « 8 reps ».
function suffixeLest(serie) {
  if (!estNombre(serie.lestKg) || serie.lestKg === 0) return '';
  return (serie.lestKg > 0 ? '+' : '') + formatFr(serie.lestKg) + ' kg';
}

/**
 * Resume lisible d'une serie : « 8 × 60 kg », « 8 × +10 kg », « 8 reps », « 1:30 »,
 * « 5,2 km en 26:00 ».
 *
 * ⚠ UNIQUE formateur de serie du projet. Toute vue qui reformaterait une serie dans son coin
 *   ferait diverger l'historique, le rappel « derniere fois » et la bulle de la courbe — trois
 *   ecritures du meme fait qui finissent toujours par ne plus se ressembler.
 * ⚠ La forme est derivee de champsSaisieEntree(entree), donc de MODES : aucun test sur le nom
 *   d'un mode ici, et un mode ajoute demain se formate sans toucher a cette fonction.
 *
 * @param {object} serie
 * @param {object} [entree] entree de seance porteuse des coefficients GELES
 * @returns {string}
 */
export function resumeSerie(serie, entree) {
  if (!serie) return '';
  const champs = entree ? champsSaisieEntree(entree) : champsPresents(serie);
  const a = (c) => champs.indexOf(c) !== -1;
  const lest = a('lestKg') || !entree ? suffixeLest(serie) : '';

  // Cardio : la distance est optionnelle, la duree ne l'est pas.
  if (a('distanceM')) {
    const duree = formatDuree(serie.dureeSec);
    if (estNombre(serie.distanceM) && serie.distanceM > 0) {
      const km = formatFr(serie.distanceM / 1000);
      return duree ? `${km} km en ${duree}` : `${km} km`;
    }
    return duree;
  }

  // Duree seule (gainage, suspension), eventuellement lestee.
  if (a('dureeSec') && !a('reps')) {
    const duree = formatDuree(serie.dureeSec);
    if (!duree) return '';
    return lest ? `${duree} ${lest}` : duree;
  }

  if (!estNombre(serie.reps)) return '';
  const reps = formatFr(serie.reps);

  if (a('chargeKg') && estNombre(serie.chargeKg)) return `${reps} × ${formatFr(serie.chargeKg)} kg`;
  // Sans profil de machine, le cran reste la seule verite disponible : on l'affiche tel quel
  // plutot qu'un kilo invente.
  if (a('valeur') && estNombre(serie.valeur)) return `${reps} × cran ${formatFr(serie.valeur)}`;
  if (lest) return `${reps} × ${lest}`;
  return `${reps} reps`;
}

/**
 * Forme TABLEAU de la meme serie : une valeur PRINCIPALE (grande) et ses complements (petits),
 * pour une case de tableau de deux lignes — « 8 » au-dessus de « ×102,5 ».
 *
 * ⚠ Deuxieme moitie de l'UNIQUE formateur, et non un second formateur. Les trois ecrans en
 *   tableau (seance en salle, detail d'une seance passee, carnet de progression) doivent afficher
 *   une serie a l'identique ; cette fonction a d'ailleurs vecu recopiee dans deux vues, avec le
 *   commentaire « copie EXACTE » pour tout garde-fou. Elle vit ici pour que ce soit vrai par
 *   construction, et pour qu'aucune vue n'ait a redecouvrir qu'un lest s'ecrit signe.
 * ⚠ Meme derivation que resumeSerie : l'ORDRE des champs de saisie du mode gele decide de la
 *   valeur principale (les reps pour une charge, la duree pour un gainage ou une sortie). Aucun
 *   test sur le nom d'un mode, donc rien a rouvrir ici quand MODES gagne une ligne.
 *
 * @param {object} serie   peut n'etre qu'un fantome de pre-remplissage (champs partiels)
 * @param {object} [entree] entree de seance porteuse des coefficients GELES
 * @returns {{ grand: string, petit: string }} chaines vides si rien n'est chiffrable
 */
export function resumeSerieCellule(serie, entree) {
  if (!serie) return { grand: '', petit: '' };
  const champs = entree ? champsSaisieEntree(entree) : champsPresents(serie);
  let grand = '';
  const petits = [];
  for (const c of champs) {
    const v = serie[c];
    if (!estNombre(v)) continue;
    // Le PREMIER champ chiffre du mode est la valeur principale : c'est le nombre qu'on lit d'un
    // coup d'oeil dans la colonne, les autres le qualifient.
    if (!grand) { grand = c === 'dureeSec' ? formatDuree(v) : formatFr(v); continue; }
    if (c === 'chargeKg') petits.push('×' + formatFr(v));
    else if (c === 'lestKg') { if (v !== 0) petits.push((v > 0 ? '+' : '') + formatFr(v)); }
    else if (c === 'valeur') petits.push('n°' + formatFr(v));
    else if (c === 'distanceM') petits.push(formatFr(v) + ' m');
    else if (c === 'dureeSec') petits.push(formatDuree(v));
    else petits.push(formatFr(v));
  }
  return { grand, petit: petits.join(' ') };
}
