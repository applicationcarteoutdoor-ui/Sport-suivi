// domain/session.js — machine a etats de la seance en cours.
//
// Module PUR : aucun DOM, aucune I/O, aucun acces au store. Les seuls imports autorises sont
// lib/ et data/schema.js. Toute fonction recoit la seance et rend la seance : la persistance
// (data/store.js, data/hot.js) et le rendu (views/seance.js) sont declenches par l'appelant,
// jamais d'ici. C'est ce qui rend le fichier testable dans tests.html sans navigateur simule.
//
// La mutation en place est ASSUMEE : une seance de 6 exercices est reclonee a chaque tap si on
// travaille en immuable, et l'ecran de seance est deja le chemin le plus chaud de l'application.
// En contrepartie, aucune fonction ne touche quoi que ce soit hors de l'objet seance recu.
//
// ⚠ INVARIANT D'ORDRE : l'ordre EST la position dans le tableau, pour les entrees comme pour les
//   series. Aucun champ d'index n'existe — un index duplique ou trou apres un « Passer » ou une
//   suppression serait indetectable, alors qu'un tableau est ordonne par construction.
//
// ⚠ INVARIANT DE FRAICHEUR : `updatedAt` est reecrit a CHAQUE mutation, sans exception. L'import
//   en mode « fusionner » departage deux versions d'une meme seance sur ce seul champ : une
//   mutation qui l'oublie fait perdre silencieusement les series saisies sur l'autre appareil.

import {
  nouvelleSerie,
  nouvelleEntree,
  nouvelleSeance,
  champsSaisieEntree
} from '../data/schema.js';

// Plafond de la duree d'une seance close (voir terminer()).
const MARGE_CLOTURE_MS = 10 * 60 * 1000;

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// Horodatage de reference. Injectable par ctx.maintenant pour que les tests soient
// deterministes : une assertion sur une duree ne peut pas dependre de l'heure qu'il est.
function maintenant(ctx) {
  return ctx && estNombre(ctx.maintenant) ? ctx.maintenant : Date.now();
}

// ⚠ Unique point d'ecriture de updatedAt. Toute fonction publique qui modifie la seance passe
//   par ici : c'est plus sur qu'une ligne repetee dans quinze fonctions, dont une l'oubliera.
function toucher(seance, ts) {
  if (seance) seance.updatedAt = estNombre(ts) ? ts : Date.now();
  return seance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recherches internes — tolerantes par principe
// ─────────────────────────────────────────────────────────────────────────────
// Un entryId ou un serieId perime arrive normalement : le toast « Annuler » vit 10 secondes et
// l'utilisateur peut avoir supprime la ligne entre-temps. Ces fonctions rendent null et les
// fonctions publiques rendent alors la seance inchangee, plutot que de lever au milieu d'une
// serie et de laisser l'ecran dans un etat incoherent.

function trouverEntree(seance, entryId) {
  if (!seance || !Array.isArray(seance.entrees)) return null;
  return seance.entrees.find((e) => e.id === entryId) || null;
}

function indexEntree(seance, entryId) {
  if (!seance || !Array.isArray(seance.entrees)) return -1;
  return seance.entrees.findIndex((e) => e.id === entryId);
}

function trouverSerie(entree, serieId) {
  if (!entree || !Array.isArray(entree.series)) return null;
  return entree.series.find((s) => s.id === serieId) || null;
}

// Resout un exercice depuis le contexte fourni par l'appelant. domain/ n'a pas le droit de lire
// le store : c'est donc la vue ou store.js qui passe la collection, sous la forme qui l'arrange
// (Map, tableau, index par id, ou fonction de resolution).
function resoudreExercice(ctx, exerciceId) {
  const source = ctx && ctx.exercices;
  if (!source || exerciceId == null) return null;
  if (typeof source === 'function') return source(exerciceId) || null;
  if (typeof source.get === 'function') return source.get(exerciceId) || null;
  if (Array.isArray(source)) return source.find((e) => e && e.id === exerciceId) || null;
  return source[exerciceId] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Series prevues
// ─────────────────────────────────────────────────────────────────────────────

// Nombre total de series prevues sur une entree, echauffement compris. null = « pas de cible » :
// en seance libre on enchaine autant de series qu'on veut, il n'y a rien a atteindre.
function totalCible(entree) {
  const c = (entree && entree.cibles) || {};
  if (!estNombre(c.series)) return null;
  return c.series + (estNombre(c.seriesEchauffement) ? c.seriesEchauffement : 0);
}

// Nature de la serie de rang `rang` (0-based) : les series d'echauffement sont TOUJOURS les
// premieres. Deriver le kind du rang plutot que de le stocker au moment de la creation evite
// qu'une suppression de la serie 1 laisse une serie 2 « echauffement » au milieu du bloc.
function kindPourRang(entree, rang) {
  const c = (entree && entree.cibles) || {};
  const ech = estNombre(c.seriesEchauffement) ? c.seriesEchauffement : 0;
  return rang < ech ? 'echauffement' : 'effective';
}

// Ajoute la prochaine serie PREVUE (done:false) a la fin de l'entree, si une serie reste a faire.
// Rend la serie creee, ou null s'il n'y a plus rien a proposer.
function proposerSerieSuivante(entree) {
  const total = totalCible(entree);
  // total null (seance libre) : on propose indefiniment. C'est l'utilisateur qui arrete en
  // passant a l'exercice suivant, pas un compteur qui ne connait pas son programme.
  if (total != null && entree.series.length >= total) return null;
  const serie = nouvelleSerie(entree.modeUtilise, { kind: kindPourRang(entree, entree.series.length) });
  entree.series.push(serie);
  return serie;
}

// Applique des champs de saisie sur une serie, en ne retenant QUE ceux que le mode gele sur
// l'entree autorise. Sans ce filtre, un chargeKg tombe par erreur sur une serie cardio serait
// relu plus tard par les reducteurs de progression.js et fausserait une courbe sans trace.
function appliquerChamps(entree, serie, champs) {
  if (!champs) return serie;
  const autorises = champsSaisieEntree(entree);
  for (const champ of autorises) {
    if (!(champ in champs)) continue;
    const v = champs[champ];
    // null est une valeur legitime : « je n'ai pas mesure la distance » doit pouvoir effacer.
    serie[champ] = v == null ? null : (estNombre(v) ? v : serie[champ]);
  }
  if ('note' in champs) serie.note = champs.note || null;
  if ('echec' in champs) serie.echec = champs.echec === true;
  if (champs.kind === 'echauffement' || champs.kind === 'effective') serie.kind = champs.kind;
  return serie;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cibles issues d'un modele
// ─────────────────────────────────────────────────────────────────────────────
// Le vocabulaire d'un item de modele (seriesCibles, repsCibles, dureeCibleSec…) n'est pas celui
// de EntreeSeance.cibles (series, reps, dureeSec…). La traduction est faite ici, en un seul
// endroit : dupliquee dans les vues, elle finirait par diverger entre l'ecran de seance et
// l'ecran de detail, et les deux liraient alors des cibles differentes pour la meme seance.
function ciblesDepuisItem(item) {
  return {
    groupeId: item.groupeId || null,
    groupeType: item.groupeType || null,
    series: estNombre(item.seriesCibles) ? item.seriesCibles : null,
    seriesEchauffement: estNombre(item.seriesEchauffement) ? item.seriesEchauffement : 0,
    reps: item.repsCibles || null,
    dureeSec: estNombre(item.dureeCibleSec) ? item.dureeCibleSec : null,
    distanceM: estNombre(item.distanceCibleM) ? item.distanceCibleM : null,
    chargeCible: item.chargeCible || null,
    reposSec: estNombre(item.reposSec) ? item.reposSec : null,
    note: item.note || null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Demarrage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Demarre une seance a partir d'un modele, ou une seance LIBRE si `modele` vaut null.
 *
 * ctx = { exercices, poidsDeCorpsKg, lieuId, date, id, maintenant }
 *   `exercices` : Map, tableau, index par id ou fonction — necessaire au GEL des coefficients.
 *
 * ⚠ nouvelleSeance() prend une COPIE INTEGRALE du modele dans modeleSnapshot : modifier le
 *   modele demain ne doit rien changer a ce qui a ete reellement fait aujourd'hui. C'est aussi
 *   ce snapshot que l'ecran de detail affichera dans trois ans, tel qu'il etait ce jour-la.
 */
export function demarrer(modele, ctx = {}) {
  const seance = nouvelleSeance(modele || null, ctx);
  const items = modele && Array.isArray(modele.items) ? modele.items : [];
  for (const item of items) {
    const exercice = resoudreExercice(ctx, item.exerciceId);
    // ⚠ Exercice introuvable (catalogue desynchronise, exercice supprime d'un import) : on saute
    //   l'item. Une entree sans modeUtilise est invalide au sens de schema.valider() et surtout
    //   irrendable — aucun champ de saisie ne peut en etre derive. L'exercice reste ajoutable a
    //   la main pendant la seance : degrader, jamais bloquer le lancement.
    if (!exercice) continue;
    ajouterExercice(seance, item.exerciceId, exercice, {
      cibles: ciblesDepuisItem(item),
      lieuId: ctx.lieuId || seance.lieuId,
      maintenant: maintenant(ctx)
    });
  }
  return toucher(seance, maintenant(ctx));
}

/**
 * Demarre une SORTIE CARDIO autonome.
 * ⚠ Ce n'est pas un type de seance : c'est une Seance ordinaire, modeleId null, a une seule
 *   entree en mode cardio. Zero champ, zero magasin, zero ecran de plus, et l'historique reste
 *   unifie par construction. Le predicat estCardioPure() la reconnait, il ne la declare pas.
 */
export function demarrerCardio(exerciceId, ctx = {}) {
  const seance = nouvelleSeance(null, ctx);
  const exercice = resoudreExercice(ctx, exerciceId);
  if (exercice) {
    ajouterExercice(seance, exerciceId, exercice, {
      cibles: { series: 1, seriesEchauffement: 0, reposSec: 0 },
      lieuId: ctx.lieuId || seance.lieuId,
      maintenant: maintenant(ctx)
    });
  }
  return toucher(seance, maintenant(ctx));
}

/**
 * Ajoute un exercice a la seance et GELE ses coefficients sur l'entree creee.
 *
 * @param {object} seance
 * @param {string} exerciceId
 * @param {object} exercice  l'Exercice complet — il est OBLIGATOIRE ici, meme si l'id suffirait
 *                           a le retrouver : c'est lui qui porte les coefficients a geler.
 * @param {object} ctx  { cibles, lieuId, maintenant, id }
 */
export function ajouterExercice(seance, exerciceId, exercice, ctx = {}) {
  if (!seance || !exercice) return seance;
  const cibles = Object.assign({}, ctx.cibles || {});

  // ⚠ Seance libre (aucun modele) : la premiere serie d'un exercice a charge est PROPOSEE en
  //   echauffement. Sans modele pour l'annoncer, la premiere serie est en pratique toujours une
  //   montee en charge ; la compter comme effective ferait plonger la courbe et, pire,
  //   pre-remplirait la seance suivante avec le poids de l'echauffement (defaut du prefill).
  //   Une seule cible d'echauffement suffit : l'utilisateur en ajoute d'autres au besoin.
  if (!seance.modeleId && !seance.modeleSnapshot && exercice.mode === 'charge'
      && !estNombre(cibles.seriesEchauffement)) {
    cibles.seriesEchauffement = 1;
  }

  // nouvelleEntree() copie modeUtilise, lestableUtilise, incrementKgUtilise,
  // bodyweightFactorUtilise et machineProfileUtilise depuis l'exercice : plus rien ne sera
  // relu sur l'Exercice ensuite.
  const entree = nouvelleEntree(exercice, cibles, {
    id: ctx.id,
    lieuId: ctx.lieuId || seance.lieuId || null
  });
  entree.exerciceId = exerciceId || entree.exerciceId;
  seance.entrees.push(entree);

  // Une entree sans ligne visible n'offre aucune cible de tap : on propose immediatement la
  // premiere serie, pre-remplie plus tard par domain/prefill.js.
  proposerSerieSuivante(entree);

  return toucher(seance, maintenant(ctx));
}

// ─────────────────────────────────────────────────────────────────────────────
// Series
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valide une serie : c'est LE geste de l'application, celui qui doit couter un tap.
 *
 * @param {object} seance
 * @param {string} entryId
 * @param {object} champs  valeurs saisies + options : { serieId, at, kind, note, echec }
 *                         `serieId` absent ⇒ la premiere serie non faite de l'entree.
 * @returns {{seance:object, serie:object|null, suivante:object|null}}
 */
export function validerSerie(seance, entryId, champs = {}) {
  const entree = trouverEntree(seance, entryId);
  if (!entree) return { seance, serie: null, suivante: null };

  const ts = estNombre(champs.at) ? champs.at : Date.now();
  let serie = champs.serieId ? trouverSerie(entree, champs.serieId) : null;
  if (!serie) serie = entree.series.find((s) => s.done !== true) || null;
  // Toutes les series prevues sont deja faites (« + Serie » implicite) : on en cree une.
  if (!serie) {
    serie = nouvelleSerie(entree.modeUtilise, { kind: kindPourRang(entree, entree.series.length) });
    entree.series.push(serie);
  }

  appliquerChamps(entree, serie, champs);
  serie.done = true;
  // ⚠ Horodatage de VALIDATION, en millisecondes. Le repos reellement observe entre deux series
  //   en est DERIVE (voir reposReel) : le saisir a la main creerait une seconde source de verite
  //   qui divergerait des la premiere serie ou le telephone est reste dans la poche.
  serie.at = ts;

  const suivante = proposerSerieSuivante(entree);

  // Le minuteur demarre ici et non dans la vue : c'est le meme geste utilisateur, et un repos
  // arme depuis deux endroits differents finirait par l'etre deux fois.
  // ⚠ Il n'empeche JAMAIS la validation suivante : c'est un affichage, pas un verrou.
  const reposSec = entree.cibles && estNombre(entree.cibles.reposSec) ? entree.cibles.reposSec : 0;
  if (reposSec > 0) demarrerRepos(seance, reposSec, ts);

  toucher(seance, ts);
  return { seance, serie, suivante };
}

/**
 * Corrige une serie deja validee — le seul chemin d'edition, atteint par un TAP sur la ligne.
 * ⚠ `at` n'est PAS reecrit : la correction faite trois minutes plus tard ne doit pas deplacer
 *   l'horodatage de la serie, sinon tous les repos reels de l'exercice deviennent faux.
 */
export function modifierSerie(seance, entryId, serieId, champs = {}) {
  const entree = trouverEntree(seance, entryId);
  const serie = trouverSerie(entree, serieId);
  if (!serie) return seance;
  appliquerChamps(entree, serie, champs);
  if ('done' in champs) {
    serie.done = champs.done === true;
    // schema.valider() exige `at` sur une serie faite : une serie repassee a done sans
    // horodatage rendrait la seance invalide a l'export.
    if (serie.done && !estNombre(serie.at)) serie.at = estNombre(champs.at) ? champs.at : Date.now();
    if (!serie.done) serie.at = null;
  }
  return toucher(seance);
}

/** Supprime definitivement une serie (appui long, jamais un tap). */
export function supprimerSerie(seance, entryId, serieId) {
  const entree = trouverEntree(seance, entryId);
  if (!entree) return seance;
  const i = entree.series.findIndex((s) => s.id === serieId);
  if (i === -1) return seance;
  entree.series.splice(i, 1);
  return toucher(seance);
}

/**
 * Ajoute une serie prevue de plus, au-dela de la cible (« + Serie »).
 * ⚠ La cible n'est PAS relevee : le modele reste l'intention, la seance reste le fait. Faire
 *   5 series sur un modele qui en prevoit 4 doit se lire « 5/4 », pas « 5/5 ».
 */
export function ajouterSerie(seance, entryId, champs = {}) {
  const entree = trouverEntree(seance, entryId);
  if (!entree) return seance;
  const serie = nouvelleSerie(entree.modeUtilise, {
    kind: champs.kind === 'echauffement' ? 'echauffement' : kindPourRang(entree, entree.series.length)
  });
  appliquerChamps(entree, serie, champs);
  entree.series.push(serie);
  return toucher(seance);
}

/**
 * Marque une serie prevue comme NON FAITE (machine prise, douleur, fin de temps).
 * ⚠ La serie est CONSERVEE : elle porte l'information « c'etait prevu et ca n'a pas ete fait »,
 *   qui disparaitrait avec une suppression. estComptable() l'exclut de tout agregat, courbe et
 *   record, parce que done vaut false — aucun autre filtre n'est necessaire ailleurs.
 * La serie prevue suivante est proposee dans la foulee : sauter une serie ne doit pas laisser
 * l'exercice sans ligne active.
 */
export function marquerNonFaite(seance, entryId, serieId) {
  const entree = trouverEntree(seance, entryId);
  if (!entree) return seance;
  const serie = serieId ? trouverSerie(entree, serieId) : entree.series.find((s) => s.done !== true);
  if (!serie) return seance;
  serie.done = false;
  serie.at = null;     // `at` est l'horodatage de validation : sans validation, il n'existe pas.
  proposerSerieSuivante(entree);
  return toucher(seance);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exercices : ordre et retrait
// ─────────────────────────────────────────────────────────────────────────────

/**
 * « Passer » : reporte l'exercice a la FIN de la liste — le cas non-nominal n°1 en salle
 * (machine occupee). Reporter et non supprimer : les series deja faites et les cibles suivent
 * l'entree, et l'exercice reste a faire au lieu de disparaitre du programme du jour.
 */
export function passerExercice(seance, entryId) {
  const i = indexEntree(seance, entryId);
  if (i === -1 || i === seance.entrees.length - 1) return toucher(seance);
  const [entree] = seance.entrees.splice(i, 1);
  seance.entrees.push(entree);
  return toucher(seance);
}

/** Retire un exercice de la seance, series comprises. */
export function retirerExercice(seance, entryId) {
  const i = indexEntree(seance, entryId);
  if (i === -1) return seance;
  seance.entrees.splice(i, 1);
  return toucher(seance);
}

/**
 * Deplace un exercice de `delta` positions (-1 = monter d'un cran).
 * La destination est BORNEE au tableau : un delta qui deborde deplace jusqu'au bord plutot que
 * de ne rien faire, parce qu'un bouton « monter » qui ne reagit pas se lit comme une panne.
 */
export function deplacerExercice(seance, entryId, delta) {
  const i = indexEntree(seance, entryId);
  if (i === -1 || !estNombre(delta) || delta === 0) return seance;
  const cible = Math.max(0, Math.min(seance.entrees.length - 1, i + delta));
  if (cible === i) return seance;
  const [entree] = seance.entrees.splice(i, 1);
  seance.entrees.splice(cible, 0, entree);
  return toucher(seance);
}

// ─────────────────────────────────────────────────────────────────────────────
// Repos
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ L'etat du repos est { finAt, totalSec } : un HORODATAGE DE FIN, jamais un compteur. Un
//   compteur decremente meurt avec le gel d'onglet mobile et se reveille faux ; un horodatage
//   survit a l'ecran verrouille, au passage en arriere-plan et au kill complet de l'application.
//   La vue ne « rattrape » pas le temps perdu, elle RECALCULE finAt - Date.now().

/** Arme le minuteur de repos pour `sec` secondes. */
export function demarrerRepos(seance, sec, ts) {
  if (!seance || !estNombre(sec) || sec <= 0) return seance;
  const base = estNombre(ts) ? ts : Date.now();
  seance.repos = { finAt: base + sec * 1000, totalSec: sec };
  return toucher(seance, base);
}

/** Desarme le minuteur. */
export function arreterRepos(seance) {
  if (!seance || !seance.repos) return seance;
  seance.repos = null;
  return toucher(seance);
}

/**
 * Allonge (delta > 0) ou raccourcit (delta < 0) le repos en cours, en secondes.
 * Le total est borne a 0 : un repos negatif afficherait un compte a rebours qui remonte.
 */
export function ajusterRepos(seance, delta) {
  if (!seance || !seance.repos || !estNombre(delta)) return seance;
  const total = Math.max(0, seance.repos.totalSec + delta);
  const applique = total - seance.repos.totalSec;
  seance.repos.totalSec = total;
  seance.repos.finAt += applique * 1000;
  return toucher(seance);
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation dans la seance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prochaine chose a faire dans la seance : premiere serie non faite, dans l'ordre des entrees.
 * @returns {{entryId:string, entree:object, serie:object, index:number}|null} null si tout est fait.
 *
 * ⚠ C'est cette fonction qui porte l'AVANCE AUTOMATIQUE : apres la derniere serie ciblee d'un
 *   exercice, elle designe deja l'exercice suivant, dont la vue ouvre le volet et met en
 *   position. C'est le tap le plus facilement economisable de toute la seance — un changement
 *   d'exercice coute alors 0 tap.
 */
export function prochainePosition(seance) {
  if (!seance || !Array.isArray(seance.entrees)) return null;
  for (const entree of seance.entrees) {
    const index = entree.series.findIndex((s) => s.done !== true);
    if (index !== -1) {
      return { entryId: entree.id, entree, serie: entree.series[index], index };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloture
// ─────────────────────────────────────────────────────────────────────────────

/** Horodatage de la derniere serie reellement validee, tous exercices confondus. */
function derniereValidation(seance) {
  let dernier = null;
  for (const entree of seance.entrees) {
    for (const serie of entree.series) {
      if (serie.done === true && estNombre(serie.at) && (dernier == null || serie.at > dernier)) {
        dernier = serie.at;
      }
    }
  }
  return dernier;
}

// Une serie prevue, jamais validee et VIERGE de toute valeur ne porte aucune information : c'est
// la ligne pre-remplie que l'ecran propose en permanence. La conserver ferait finir chaque
// exercice sur un « 4/5 » mensonger dans l'historique. Une serie non faite portant des valeurs,
// elle, est conservee : c'est une intention explicite (marquerNonFaite).
function estSerieVierge(serie) {
  return serie.done !== true &&
    serie.reps == null && serie.chargeKg == null && serie.lestKg == null &&
    serie.valeur == null && serie.dureeSec == null && serie.distanceM == null &&
    !serie.note;
}

/**
 * Cloture la seance.
 *
 * ⚠ La duree est BORNEE : min(endedAt, derniere validation + 10 min) - startedAt. Une seance
 *   commencee a 18 h, terminee sur le telephone a 23 h une fois rentre a la maison, ne doit pas
 *   etre enregistree comme 5 heures d'entrainement — cela fausserait toutes les statistiques de
 *   volume horaire. La marge de 10 minutes couvre la derniere serie plus le rangement.
 */
export function terminer(seance, ctx = {}) {
  if (!seance) return seance;
  const fin = maintenant(ctx);
  const dernier = derniereValidation(seance);
  const borne = dernier != null ? Math.min(fin, dernier + MARGE_CLOTURE_MS) : fin;

  for (const entree of seance.entrees) {
    entree.series = entree.series.filter((s) => !estSerieVierge(s));
  }

  seance.endedAt = fin;
  seance.dureeSec = Math.max(0, Math.round((borne - seance.startedAt) / 1000));
  seance.statut = 'terminee';
  // Un repos arme survivrait a la cloture et rallumerait le minuteur au prochain demarrage.
  seance.repos = null;
  if (estNombre(ctx.ressenti)) seance.ressenti = ctx.ressenti;
  if (ctx.notes != null) seance.notes = ctx.notes;
  if (ctx.lieuId) seance.lieuId = ctx.lieuId;
  return toucher(seance, fin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivations — jamais stockees
// ─────────────────────────────────────────────────────────────────────────────

/**
 * true si la seance est une SORTIE CARDIO autonome (une seule entree, en mode cardio).
 * ⚠ DERIVE, jamais stocke : un drapeau `estCardio` persiste divergerait des qu'on ajoute des
 *   pompes a la fin d'une sortie course, et l'historique afficherait une pastille qui ment.
 */
export function estCardioPure(seance) {
  if (!seance || !Array.isArray(seance.entrees) || seance.entrees.length !== 1) return false;
  return seance.entrees[0].modeUtilise === 'cardio';
}

/**
 * Repos REELLEMENT observe avant la serie `serieId`, en secondes, ou null s'il est indeterminable
 * (premiere serie faite de l'exercice, ou serie non validee).
 * ⚠ DERIVE des horodatages de validation, jamais saisi : c'est ce que le repos a vraiment dure,
 *   pas ce que le minuteur avait annonce. Les deux different des que le telephone repart en poche.
 */
export function reposReel(entree, serieId) {
  if (!entree || !Array.isArray(entree.series)) return null;
  const i = entree.series.findIndex((s) => s.id === serieId);
  if (i <= 0) return null;
  const serie = entree.series[i];
  if (serie.done !== true || !estNombre(serie.at)) return null;
  for (let j = i - 1; j >= 0; j--) {
    const prec = entree.series[j];
    // On remonte au-dela des series non faites : le repos observe court depuis la derniere
    // serie REELLEMENT executee, pas depuis une serie qui n'a jamais eu lieu.
    if (prec.done === true && estNombre(prec.at)) {
      return Math.max(0, Math.round((serie.at - prec.at) / 1000));
    }
  }
  return null;
}

/** Etat courant du minuteur, ou null. Sucre pour les vues : `session.repos(seance)`. */
export function repos(seance) {
  return (seance && seance.repos) || null;
}
