// domain/prefill.js — le module qui fait 1 tap au lieu de 6.
//
// MODULE PUR : aucun DOM, aucune I/O, aucun import de data/ hors schema.js.
//
// Pre-remplir la serie a venir est la seule raison pour laquelle la mediane de saisie est de
// 1 tap. Une valeur pre-remplie FAUSSE est pire qu'un champ vide : elle est validee sans etre
// relue, et le carnet enregistre une charge qui n'a jamais ete soulevee.
//
// La chaine a QUATRE niveaux, dans cet ordre :
//   1. serie precedente EFFECTIVE de la seance en cours   (« je continue »)
//   2. meme rang a la derniere seance connue              (« comme la derniere fois »)
//   3. cible du modele                                    (« ce qui etait prevu »)
//   4. vide                                               (premiere fois de la vie)

import { champsSaisieEntree, estComptable } from '../data/schema.js';
import { resumeSerie } from './metrics.js';

// Valeurs fermees de `source`. L'UI s'en sert pour libeller la provenance (« comme la derniere
// fois »), donc elles font partie du contrat au meme titre que `champs`.
export const SOURCES = {
  SERIE_PRECEDENTE: 'serie-precedente',
  DERNIERE_SEANCE: 'derniere-seance',
  CIBLE: 'cible',
  VIDE: 'vide'
};

// Abreviations de mois pour le rappel « Derniere fois (12 juil.) ».
// lib/dates.js ne propose que formatCourt ('12/07') et formatLong ('12 juillet 2026') : le premier
// est illisible dans une phrase, le second trop long pour une ligne de 360 px.
const MOIS_COURTS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'
];

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────────────────────────────

/** Retrouve l'entree d'un exercice dans la seance courante, quand l'appelant ne l'a pas sous la main. */
function trouverEntree(seance, exerciceId) {
  const entrees = seance && Array.isArray(seance.entrees) ? seance.entrees : [];
  for (const e of entrees) {
    if (e && e.exerciceId === exerciceId) return e;
  }
  return null;
}

/**
 * Derniere serie EFFECTIVE et faite d'un tableau de series.
 * ⚠ PIEGE CENTRAL DU MODULE : sans estComptable, l'echauffement a 50 kg qui precede la premiere
 * serie de travail devient la source du pre-remplissage, et la serie effective part a 50 kg au
 * lieu de 80. Le filtre est applique ICI et aux niveaux 2, jamais « plus tard chez l'appelant ».
 */
function dernierEffectif(series) {
  const liste = Array.isArray(series) ? series : [];
  for (let i = liste.length - 1; i >= 0; i--) {
    if (estComptable(liste[i])) return liste[i];
  }
  return null;
}

/**
 * Rang de la serie a venir, compte parmi les SEULES series effectives.
 * Les echauffements sont exclus du comptage : sinon, apres deux echauffements, la serie de travail
 * n° 1 irait chercher le rang 3 de la derniere seance — c'est-a-dire la serie la plus lourde,
 * souvent celle d'un echec.
 */
function rangEffectif(series) {
  const liste = Array.isArray(series) ? series : [];
  let n = 0;
  for (const s of liste) {
    if (s && s.kind !== 'echauffement') n++;
  }
  return n;
}

/** Series effectives d'une entree, dans l'ordre. L'ordre EST la position dans le tableau. */
function seriesEffectives(entree) {
  const liste = entree && Array.isArray(entree.series) ? entree.series : [];
  return liste.filter(estComptable);
}

/**
 * Normalise l'enregistrement de meta.lastPerf pour un exercice donne.
 *
 * lastPerf est une CARTE indexee par exerciceId (c'est pourquoi valeursPour et rappelTextuel
 * recoivent tous deux l'exerciceId a cote). On accepte deux formes, parce que le producteur
 * (data/store.js) peut aussi bien y ranger l'entree telle quelle qu'une enveloppe datee :
 *   { [exerciceId]: { date, seanceId, entree } }   ou   { [exerciceId]: <entree> + date }
 *
 * @returns {{ date: string|null, seanceId: string|null, entree: object, series: object[] }|null}
 */
function perfDe(lastPerf, exerciceId) {
  if (!lastPerf || typeof lastPerf !== 'object' || !exerciceId) return null;
  const brut = lastPerf[exerciceId];
  if (!brut || typeof brut !== 'object') return null;

  const entree = brut.entree && typeof brut.entree === 'object' ? brut.entree : brut;
  const series = seriesEffectives(entree);
  if (!series.length) return null;

  return {
    date: typeof brut.date === 'string' ? brut.date : null,
    seanceId: brut.seanceId || null,
    entree,
    series
  };
}

/**
 * Recopie les champs de saisie d'une serie source.
 * Seuls les champs du mode sont recopies : une charge tombee par accident sur une serie cardio ne
 * doit pas se propager de serie en serie.
 */
function extraire(serie, champs) {
  const champsPreremplis = {};
  if (!serie) return champsPreremplis;
  for (const champ of champs) {
    if (estNombre(serie[champ])) champsPreremplis[champ] = serie[champ];
  }
  return champsPreremplis;
}

/**
 * Niveau 3 : ce que le modele avait PREVU.
 * ⚠ Les modeles livres n'expriment aucune charge en dur (chargeCible.type vaut 'derniere') : un
 * modele qui annonce 60 kg ment au bout de trois mois. Une charge n'est donc pre-remplie ici que
 * si l'utilisateur l'a lui-meme figee dans son modele.
 */
function depuisCibles(entree, champs) {
  const cibles = entree && entree.cibles ? entree.cibles : null;
  if (!cibles) return null;

  const champsPreremplis = {};
  for (const champ of champs) {
    if (champ === 'reps' && cibles.reps) {
      // Bas de la fourchette : viser 6 sur « 6 a 8 » se corrige d'un tap vers le haut, alors que
      // valider 8 par reflexe enregistre une performance qui n'a pas eu lieu.
      const cible = estNombre(cibles.reps.min) ? cibles.reps.min : cibles.reps.max;
      if (estNombre(cible)) champsPreremplis.reps = cible;
    } else if (champ === 'dureeSec' && estNombre(cibles.dureeSec)) {
      champsPreremplis.dureeSec = cibles.dureeSec;
    } else if (champ === 'distanceM' && estNombre(cibles.distanceM)) {
      champsPreremplis.distanceM = cibles.distanceM;
    } else if ((champ === 'chargeKg' || champ === 'valeur' || champ === 'lestKg')
               && cibles.chargeCible && estNombre(cibles.chargeCible.kg)) {
      champsPreremplis[champ] = cibles.chargeCible.kg;
    }
  }
  return Object.keys(champsPreremplis).length ? champsPreremplis : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valeurs a pre-remplir pour la PROCHAINE serie d'un exercice.
 *
 * @param {string} exerciceId
 * @param {object} entree        entree de seance (coefficients geles). Peut etre null : elle est
 *                               alors retrouvee dans `seance`.
 * @param {object} seance        seance en cours
 * @param {object} lastPerf      carte meta.lastPerf, indexee par exerciceId
 * @returns {{ champs: object, source: string, date: string|null }}
 *          `champs` est indexe par nom de champ de saisie ('reps', 'chargeKg', 'lestKg'...).
 *          Un champ absent signifie « laisser vide », jamais « zero ».
 */
export function valeursPour(exerciceId, entree, seance, lastPerf) {
  const e = entree || trouverEntree(seance, exerciceId);
  const id = exerciceId || (e && e.exerciceId) || null;
  const vide = { champs: {}, source: SOURCES.VIDE, date: null };
  if (!e) return vide;

  // Derives des coefficients GELES sur l'entree, jamais de l'exercice tel qu'il est configure
  // aujourd'hui : rouvrir une seance de 2023 doit y afficher les champs de 2023.
  const champs = champsSaisieEntree(e);
  if (!champs.length) return vide;

  // ── 1. Serie precedente effective de la seance en cours ────────────────────
  const precedente = dernierEffectif(e.series);
  if (precedente) {
    const valeurs = extraire(precedente, champs);
    if (Object.keys(valeurs).length) {
      return {
        champs: valeurs,
        source: SOURCES.SERIE_PRECEDENTE,
        date: (seance && seance.date) || null
      };
    }
  }

  // ── 2. Meme rang a la derniere seance connue ───────────────────────────────
  const perf = perfDe(lastPerf, id);
  if (perf) {
    // Rang exact quand il existe, sinon la derniere serie connue. Retomber au niveau 3 parce que
    // l'on attaque une 5e serie la ou il n'y en avait que 4 la derniere fois donnerait un champ
    // vide alors qu'une valeur pertinente est disponible juste a cote.
    const rang = Math.min(rangEffectif(e.series), perf.series.length - 1);
    const valeurs = extraire(perf.series[rang], champs);
    if (Object.keys(valeurs).length) {
      return { champs: valeurs, source: SOURCES.DERNIERE_SEANCE, date: perf.date };
    }
  }

  // ── 3. Cible du modele ─────────────────────────────────────────────────────
  const cibles = depuisCibles(e, champs);
  if (cibles) return { champs: cibles, source: SOURCES.CIBLE, date: null };

  // ── 4. Vide ────────────────────────────────────────────────────────────────
  return vide;
}

/**
 * Rappel non editable affiche en tete du volet d'exercice — le coeur de la valeur percue :
 * « Derniere fois (12 juil.) : 8 × 60 kg · 8 × 60 kg · 6 × 60 kg »
 *
 * ⚠ Ne liste que les series COMPTABLES : afficher l'echauffement dans le rappel conduirait
 * l'utilisateur a « refaire pareil » en partant de la charge d'echauffement.
 *
 * @returns {string} chaine vide si aucune performance connue — l'appelant n'affiche alors rien.
 */
export function rappelTextuel(lastPerf, exerciceId) {
  const perf = perfDe(lastPerf, exerciceId);
  if (!perf) return '';

  // resumeSerie est l'UNIQUE formateur de serie du projet : dupliquer le formatage ici ferait
  // diverger le rappel de ce qu'affichent les lignes de serie juste en dessous.
  const resumes = perf.series
    .map((s) => resumeSerie(s, perf.entree))
    .filter((t) => typeof t === 'string' && t !== '');
  if (!resumes.length) return '';

  const quand = formatDateCourte(perf.date);
  return quand
    ? `Dernière fois (${quand}) : ${resumes.join(' · ')}`
    : `Dernière fois : ${resumes.join(' · ')}`;
}

/** '2026-07-12' -> '12 juil.' */
function formatDateCourte(cle) {
  const m = typeof cle === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(cle) : null;
  if (!m) return '';
  return `${+m[3]} ${MOIS_COURTS[+m[2] - 1]}`;
}
