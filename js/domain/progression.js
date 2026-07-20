// domain/progression.js — agregation des series temporelles, tableaux et records.
//
// MODULE PUR : aucun DOM, aucune I/O, aucun import de data/ hors schema.js.
//
// Principe structurant : une TABLE DE REDUCTEURS indexee par metrique. Aucun test conditionnel
// sur le mode de l'exercice ne figure dans ce fichier. Ajouter une metrique = ajouter une ligne
// dans MODES (data/schema.js) et une ligne dans REDUCTEURS. Rien d'autre a modifier.
//
// Aucun cache, aucune memoisation, aucun index : ~1000 seances x ~7 entrees se balaient en
// moins de 5 ms. Un cache de records n'aurait rien apporte qu'un risque de desynchronisation.

import { MODES, UNITES, LIBELLES_METRIQUES, estComptable, estSeanceComptable } from '../data/schema.js';
import { formatDuree, formatAllure, formatFr } from '../lib/num.js';
import { dayKey } from '../lib/dates.js';
import { e1rm, chargeEffectiveKg, tonnageEntree, tonnageSeance } from './metrics.js';

// Nombre minimal de points en dessous duquel la courbe de 1RM estime bascule sur la charge max.
// Voir REPLI_E1RM plus bas : c'est le seuil sous lequel une « courbe » n'en est plus une.
const MIN_POINTS_E1RM = 3;

const MESSAGE_REPLI_E1RM = '1RM estimé indisponible au-delà de 12 répétitions — charge max affichée.';

// Metrique de substitution quand le 1RM estime ne produit pas assez de points.
const REPLI_E1RM = 'charge-max';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// ─────────────────────────────────────────────────────────────────────────────
// Combinateurs de reduction
// ─────────────────────────────────────────────────────────────────────────────
// Tous renvoient { valeur, libelle, fiable } ou null quand aucune serie n'a produit de valeur.
// `fiable` est propage de bout en bout : un point non fiable (machine sans profil de plaques)
// est rendu en contour creux et ne peut JAMAIS porter un badge de record.

function extremum(sets, valeurDe, libelleDe, meilleurQue) {
  let retenu = null;
  for (const s of sets) {
    const brut = valeurDe(s);
    // valeurDe peut renvoyer un nombre ou { valeur, fiable } : chargeEffectiveKg porte sa fiabilite.
    const valeur = brut && typeof brut === 'object' ? brut.valeur : brut;
    if (!estNombre(valeur)) continue;
    const fiable = brut && typeof brut === 'object' ? brut.fiable !== false : true;
    if (retenu === null || meilleurQue(valeur, retenu.valeur)) {
      retenu = { valeur, fiable, serie: s };
    }
  }
  if (!retenu) return null;
  return {
    valeur: retenu.valeur,
    libelle: libelleDe ? libelleDe(retenu.serie, retenu.valeur) : null,
    fiable: retenu.fiable
  };
}

const max = (sets, valeurDe, libelleDe) => extremum(sets, valeurDe, libelleDe, (a, b) => a > b);

// ⚠ L'allure est la SEULE metrique ou le minimum est la meilleure valeur : 4:30/km bat 5:10/km.
const min = (sets, valeurDe, libelleDe) => extremum(sets, valeurDe, libelleDe, (a, b) => a < b);

function somme(sets, valeurDe, libelleDe) {
  let total = 0;
  let compte = 0;
  let fiable = true;
  for (const s of sets) {
    const brut = valeurDe(s);
    const valeur = brut && typeof brut === 'object' ? brut.valeur : brut;
    if (brut && typeof brut === 'object' && brut.fiable === false) fiable = false;
    if (!estNombre(valeur)) continue;
    total += valeur;
    compte++;
  }
  // Zero serie exploitable : on renvoie null et non 0, pour que serieTemporelle n'inscrive
  // PAS de point. Un zero graphique se lit « il a fait 0 kg ce jour-la », ce qui est faux.
  if (!compte) return null;
  return { valeur: total, libelle: libelleDe ? libelleDe(total) : null, fiable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formules derivees (jamais saisies, jamais stockees)
// ─────────────────────────────────────────────────────────────────────────────

const allureDe = (s) => (estNombre(s.distanceM) && s.distanceM > 0 && estNombre(s.dureeSec)
  ? s.dureeSec / (s.distanceM / 1000)
  : null);

const vitesseDe = (s) => (estNombre(s.distanceM) && estNombre(s.dureeSec) && s.dureeSec > 0
  ? (s.distanceM / 1000) / (s.dureeSec / 3600)
  : null);

/**
 * Charge effective d'une serie, avec repli EN CRANS.
 * Une machine sans profil de plaques renseigne ne sait pas convertir un cran en kilos. Plutot que
 * de ne rien tracer, on trace le numero de cran et on marque le point NON FIABLE : la courbe
 * reste utile (« je suis passe du cran 7 au cran 9 ») sans jamais affirmer un kilo faux.
 */
function chargeOuCran(serie, entree, seance) {
  const c = chargeEffectiveKg(serie, entree, seance);
  if (c && estNombre(c.kg)) return { valeur: c.kg, fiable: c.fiable !== false };
  if (estNombre(serie.valeur)) return { valeur: serie.valeur, fiable: false };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE DES REDUCTEURS — indexee par metrique, JAMAIS par mode
// ─────────────────────────────────────────────────────────────────────────────
// Signature uniforme : (sets, entree, seance) -> { valeur, libelle, fiable } | null
// `sets` est deja filtre par estComptable : aucun reducteur n'a a le refaire.

const REDUCTEURS = {
  'e1rm-max': (sets) => max(
    sets,
    (x) => e1rm(x.chargeKg, x.reps),
    (x, v) => `${x.reps} × ${formatFr(x.chargeKg)} kg — 1RM est. ${formatFr(v, 0)} kg`
  ),

  // 'charge-max' et 'charge-effective-max' partagent le meme reducteur : ce sont deux LIBELLES
  // d'un meme fait (« la charge la plus lourde reellement supportee »), le poids du corps etant
  // deja integre par chargeEffectiveKg. Les distinguer par un `if` sur le mode serait la faute.
  'charge-max': (sets, e, s) => max(
    sets,
    (x) => chargeOuCran(x, e, s),
    (x, v) => `${x.reps} × ${formatFr(v)} kg`
  ),
  'charge-effective-max': (sets, e, s) => max(
    sets,
    (x) => chargeOuCran(x, e, s),
    (x, v) => `${x.reps} × ${formatFr(v)} kg`
  ),

  'reps-max': (sets) => max(sets, (x) => x.reps, (x) => `${x.reps} reps`),

  // Delegue a metrics.js : le tonnage est sa responsabilite, la dupliquer ici la ferait diverger.
  // ⚠ tonnageEntree rend { kg, fiable }, PAS un nombre. Le traiter comme un nombre ne lève
  //   aucune erreur : le réducteur rend simplement null pour toujours, et la courbe de tonnage
  //   reste éternellement vide sans le moindre message.
  'tonnage': (sets, e, s) => {
    const t = tonnageEntree(e, s);
    return estNombre(t.kg) && t.kg > 0
      ? { valeur: t.kg, libelle: `${formatFr(t.kg, 0)} kg`, fiable: t.fiable }
      : null;
  },

  'duree-max': (sets) => max(sets, (x) => x.dureeSec, (x) => formatDuree(x.dureeSec)),
  'duree-totale': (sets) => somme(sets, (x) => x.dureeSec, (v) => formatDuree(v)),
  'duree': (sets) => somme(sets, (x) => x.dureeSec, (v) => formatDuree(v)),

  // ⚠ MINIMUM : plus bas vaut mieux.
  'allure': (sets) => min(sets, allureDe, (x, v) => `${formatAllure(v)} /km`),
  'vitesse': (sets) => max(sets, vitesseDe, (x, v) => `${formatFr(v, 1)} km/h`),
  'distance': (sets) => somme(
    sets,
    (x) => (estNombre(x.distanceM) ? x.distanceM / 1000 : null),
    (v) => `${formatFr(v, 2)} km`
  )
};

// Sens de progression. Toutes les metriques montent, SAUF l'allure : une courbe d'allure
// decroissante est un progres. Le moteur de courbe inverse tendance et record d'apres ce champ.
const SENS = { allure: 'bas' };

/** Sens de progression d'une metrique : 'haut' (par defaut) ou 'bas'. */
export function sensDe(metrique) {
  return SENS[metrique] || 'haut';
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metriques proposables pour un exercice, derivees de MODES.
 * La premiere du tableau est celle affichee par defaut (cf. schema.metriqueParDefaut).
 *
 * @returns {{ cle: string, libelle: string, unite: string }[]}
 */
export function metriquesDisponibles(exercice) {
  const def = MODES[exercice && exercice.mode];
  if (!def) return [];
  return def.metriques
    // Une metrique declaree dans MODES mais sans reducteur produirait une courbe vide sans
    // explication : on ne la propose pas du tout.
    .filter((cle) => typeof REDUCTEURS[cle] === 'function')
    .map((cle) => ({
      cle,
      libelle: LIBELLES_METRIQUES[cle] || cle,
      unite: UNITES[cle] || ''
    }));
}

/**
 * Serie temporelle d'une metrique pour un exercice.
 *
 * @param {object[]} seances
 * @param {string} exerciceId
 * @param {string} metrique     cle de REDUCTEURS
 * @param {{debut:string}} [plage]  borne inferieure INCLUSIVE, comparee en chaine (lib/dates.plage)
 * @returns {{ points: object[], sens: string, unite: string, metrique: string,
 *             metriqueDemandee: string, message: string|null }}
 *          points : { x: dayKey, y: number, libelle, seanceId, entreeId, fiable }
 */
export function serieTemporelle(seances, exerciceId, metrique, plage) {
  const demandee = metrique;
  let resultat = collecter(seances, exerciceId, demandee, plage);

  // ⚠ REPLI OBLIGATOIRE du 1RM estime. Epley decroche au-dela de 12 repetitions : un utilisateur
  // qui travaille systematiquement en series de 15 obtient une courbe VIDE, sans le moindre
  // indice sur la raison. On bascule alors sur la charge max en le DISANT.
  if (demandee === 'e1rm-max' && resultat.points.length < MIN_POINTS_E1RM) {
    const repli = collecter(seances, exerciceId, REPLI_E1RM, plage);
    // Ne basculer que si le repli apporte vraiment plus : sur un exercice sans aucune seance,
    // annoncer « 1RM indisponible » designerait un coupable inexistant.
    if (repli.points.length > resultat.points.length) {
      return {
        points: repli.points,
        sens: sensDe(REPLI_E1RM),
        unite: UNITES[REPLI_E1RM] || '',
        metrique: REPLI_E1RM,
        metriqueDemandee: demandee,
        message: MESSAGE_REPLI_E1RM
      };
    }
  }

  return {
    points: resultat.points,
    sens: sensDe(demandee),
    unite: UNITES[demandee] || '',
    metrique: demandee,
    metriqueDemandee: demandee,
    message: null
  };
}

/** Balayage brut, sans repli. Extrait pour que serieTemporelle puisse le rejouer sur une autre metrique. */
function collecter(seances, exerciceId, metrique, plage) {
  const points = [];
  const reduire = REDUCTEURS[metrique];
  const liste = Array.isArray(seances) ? seances : [];
  if (!reduire) return { points };

  for (const s of liste) {
    // Une seance en cours n'a pas de valeur consolidee : elle ferait sauter le dernier point
    // de la courbe a chaque serie validee.
    if (!estSeanceComptable(s)) continue;
    // dayKey se compare en CHAINE : l'ordre lexicographique est l'ordre chronologique.
    if (plage && plage.debut && s.date < plage.debut) continue;

    const entrees = Array.isArray(s.entrees) ? s.entrees : [];
    for (const e of entrees) {
      if (!e || e.exerciceId !== exerciceId) continue;
      const sets = (Array.isArray(e.series) ? e.series : []).filter(estComptable);
      // ⚠ Aucune serie comptable (que de l'echauffement, ou exercice passe) : PAS de point vide.
      // Un point a zero creuserait un trou dans la courbe la ou il ne s'est rien passe.
      if (!sets.length) continue;

      const r = reduire(sets, e, s);
      if (!r || !estNombre(r.valeur)) continue;

      points.push({
        x: s.date,
        y: r.valeur,
        libelle: r.libelle,
        seanceId: s.id,
        entreeId: e.id,
        fiable: r.fiable !== false
      });
    }
  }

  // Comparateur renvoyant 0 sur l'egalite : indispensable pour que deux entrees du meme exercice
  // dans une meme seance conservent leur ordre de saisie (tri stable).
  points.sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
  return { points };
}

/**
 * Tableau des n dernieres seances contenant cet exercice, ANTICHRONOLOGIQUE.
 * Il est affiche sous chaque courbe et c'est lui qui est reellement consulte : la courbe donne la
 * tendance, le tableau donne les chiffres exacts a reproduire aujourd'hui.
 *
 * @returns {{ date, seanceId, entreeId, nbSeries, series: object[], tonnage: number|null,
 *             meilleure: object|null, note: string|null }[]}
 */
export function tableauChronologique(seances, exerciceId, n = 20) {
  const lignes = [];
  const liste = Array.isArray(seances) ? seances : [];

  for (const s of liste) {
    if (!estSeanceComptable(s)) continue;
    const entrees = Array.isArray(s.entrees) ? s.entrees : [];
    for (const e of entrees) {
      if (!e || e.exerciceId !== exerciceId) continue;
      const sets = (Array.isArray(e.series) ? e.series : []).filter(estComptable);
      if (!sets.length) continue;

      const meilleure = max(sets, (x) => chargeOuCran(x, e, s), (x, v) => `${x.reps} × ${formatFr(v)} kg`);
      const tonnage = tonnageEntree(e, s);      // { kg, fiable }, jamais un nombre

      lignes.push({
        date: s.date,
        seanceId: s.id,
        entreeId: e.id,
        nbSeries: sets.length,
        series: sets,
        tonnage: estNombre(tonnage.kg) ? tonnage.kg : null,
        tonnageFiable: tonnage.fiable,
        meilleure: meilleure || null,
        note: e.note || null
      });
    }
  }

  // Antichronologique : la seance la plus recente en premier, c'est celle que l'on vient chercher.
  lignes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return lignes.slice(0, n > 0 ? n : 0);
}

// Modes cardio, DERIVES DE LA TABLE et non d'un test sur le nom du mode : un mode 'natation'
// ajoute demain a MODES entrerait dans le decompte des minutes de cardio sans toucher ce fichier.
// Le critere est la presence de distanceM en saisie, ce qui exclut 'temps' (gainage) a juste titre.
const MODES_CARDIO = new Set(
  Object.keys(MODES).filter((m) => MODES[m].saisie.indexOf('distanceM') !== -1)
);

/**
 * Resume de la semaine EN COURS (lundi -> aujourd'hui), affiche sur l'accueil.
 *
 * @param {object[]} seances
 * @param {Date} [reference] jour de reference. Parametre explicite : un module pur ne doit pas
 *                           dependre d'une horloge implicite, sans quoi il n'est pas testable.
 * @returns {{ seances: number, tonnage: number, series: number, minutesCardio: number, debut: string }}
 */
export function resumeSemaine(seances, reference = new Date()) {
  // Semaine ISO : elle commence le LUNDI. getDay() renvoie 0 pour dimanche, d'ou le decalage,
  // sans lequel le dimanche soir remettrait le compteur a zero au milieu du week-end.
  const jour = reference.getDay();
  const recul = (jour + 6) % 7;
  const lundi = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - recul);
  const debut = dayKey(lundi);

  const resume = { seances: 0, tonnage: 0, series: 0, minutesCardio: 0, debut };
  const liste = Array.isArray(seances) ? seances : [];

  for (const s of liste) {
    if (!estSeanceComptable(s)) continue;
    if (s.date < debut) continue;

    resume.seances++;
    const tonnage = tonnageSeance(s);          // { kg, fiable }, jamais un nombre
    if (estNombre(tonnage.kg)) resume.tonnage += tonnage.kg;

    const entrees = Array.isArray(s.entrees) ? s.entrees : [];
    for (const e of entrees) {
      const sets = (Array.isArray(e.series) ? e.series : []).filter(estComptable);
      resume.series += sets.length;
      if (!MODES_CARDIO.has(e.modeUtilise)) continue;
      for (const x of sets) {
        if (estNombre(x.dureeSec)) resume.minutesCardio += x.dureeSec / 60;
      }
    }
  }

  resume.minutesCardio = Math.round(resume.minutesCardio);
  return resume;
}

/**
 * Records d'un exercice, TOUTES METRIQUES de son mode.
 *
 * ⚠ RECALCULE a chaque appel, jamais mis en cache : rien a invalider, rien a desynchroniser.
 * Le balayage complet coute moins de 5 ms sur 1000 seances — moins cher qu'un bug d'invalidation.
 *
 * Le mode est lu sur l'entree la plus recente (coefficient GELE) et non sur l'exercice courant :
 * c'est ce qui permet d'appeler records() sans disposer de l'objet Exercice.
 *
 * @returns {Object<string, {valeur, libelle, unite, sens, date, seanceId, fiable}>}
 */
export function records(seances, exerciceId) {
  const liste = Array.isArray(seances) ? seances : [];

  // Mode de reference = celui de l'entree la plus recente. Un exercice migre de 'poids-du-corps'
  // vers 'charge' doit exposer les records du mode dans lequel il est aujourd'hui pratique.
  let modeRecent = null;
  let dateRecente = '';
  for (const s of liste) {
    if (!estSeanceComptable(s)) continue;
    const entrees = Array.isArray(s.entrees) ? s.entrees : [];
    for (const e of entrees) {
      if (!e || e.exerciceId !== exerciceId) continue;
      if (s.date >= dateRecente) { dateRecente = s.date; modeRecent = e.modeUtilise; }
    }
  }

  const def = MODES[modeRecent];
  const resultat = {};
  if (!def) return resultat;

  for (const metrique of def.metriques) {
    if (typeof REDUCTEURS[metrique] !== 'function') continue;
    const { points } = collecter(liste, exerciceId, metrique, null);

    let meilleur = null;
    const versLeBas = sensDe(metrique) === 'bas';
    for (const p of points) {
      // ⚠ Un point NON FIABLE (machine sans profil de plaques) ne peut jamais porter un record :
      // ce serait afficher un chiffre faux avec assurance.
      if (!p.fiable) continue;
      if (!meilleur || (versLeBas ? p.y < meilleur.y : p.y > meilleur.y)) meilleur = p;
    }
    if (!meilleur) continue;

    resultat[metrique] = {
      valeur: meilleur.y,
      libelle: meilleur.libelle,
      unite: UNITES[metrique] || '',
      sens: versLeBas ? 'bas' : 'haut',
      date: meilleur.x,
      seanceId: meilleur.seanceId,
      fiable: true
    };
  }

  return resultat;
}
