// data/schema.js — LE contrat du projet.
//
// PRINCIPE 1 : l'INTENTION (le modele) est mutable ; le FAIT (la seance) est immuable et COPIE.
// PRINCIPE 2 : tout coefficient qui INTERPRETE un fait est GELE dans le fait.
// PRINCIPE 3 : tout polymorphisme passe par MODES. Aucun `if` sur un mode ailleurs
//              (unique exception nommee : chargeEffectiveKg dans domain/metrics.js).
//
// Charges en KG. Dates de regroupement en 'YYYY-MM-DD' LOCAL. Ids : ULID.

import { ulid } from '../lib/ids.js';
import { dayKey } from '../lib/dates.js';

// ─────────────────────────────────────────────────────────────────────────────
// TABLE DES MODES — unique point d'extension du polymorphisme
// ─────────────────────────────────────────────────────────────────────────────
// `saisie`   : champs de Serie effectivement saisis dans ce mode, DANS L'ORDRE du pave.
// `requis`   : sous-ensemble de `saisie` sans lequel la serie est invalide.
//              Absent ⇒ tous les champs de `saisie` sont requis.
// `metriques`: metriques proposees par progression.js, la premiere etant celle par defaut.
// `pas`      : pas des boutons +/-. La chaine 'incrementKg' signifie « lire exercice.incrementKg ».
// `lestSiLestable` : ce mode accepte lestKg quand l'exercice est lestable. Ce drapeau existe pour
//              que champsSaisie() derive le lest de la TABLE et non d'un test sur le nom du mode.
export const MODES = {
  'poids-du-corps': {
    saisie: ['reps'],
    // v4 : 'tonnage' retire des metriques PROPOSEES (retour utilisateur — l'option n'apparait
    // plus nulle part). Le reducteur et les calculs du domaine restent : donnees intactes.
    // v6 : 'tonnage' revient sous le nom « Volume » (retour utilisateur — il veut une courbe de
    // volume par seance ; c'est le tonnage du domaine, seul le libelle change).
    // v8 : « Volume » EN PREMIER — c'est l'onglet par defaut demande (metriqueParDefaut rend le
    // premier de cette liste quand l'exercice n'a pas de preference).
    metriques: ['tonnage', 'charge-effective-max', 'reps-max'],
    pas: { reps: 1, lestKg: 'incrementKg' },
    lestSiLestable: true
  },
  'charge': {
    saisie: ['reps', 'chargeKg'],
    metriques: ['tonnage', 'e1rm-max', 'charge-max', 'reps-max'],
    pas: { reps: 1, chargeKg: 'incrementKg' },
    lestSiLestable: false
  },
  'machine': {
    // valeur = numero de cran / de plaque, decimal admis (7.5)
    saisie: ['reps', 'valeur'],
    metriques: ['charge-max', 'reps-max'],
    pas: { reps: 1, valeur: 1 },
    lestSiLestable: false
  },
  'temps': {
    // gainage, suspension a la barre
    saisie: ['dureeSec'],
    metriques: ['duree-max', 'duree-totale'],
    pas: { dureeSec: 5, lestKg: 'incrementKg' },
    lestSiLestable: true
  },
  'cardio': {
    saisie: ['dureeSec', 'distanceM'], // distanceM OPTIONNELLE
    requis: ['dureeSec'],
    metriques: ['allure', 'vitesse', 'distance', 'duree'],
    pas: { dureeSec: 30, distanceM: 100 },
    lestSiLestable: false
  }
};
// ⚠ `allure` et `vitesse` sont TOUJOURS DERIVEES de dureeSec et distanceM.
//   Jamais saisies, jamais stockees : deux sources pour un meme fait divergent toujours.

export const NOMS_MODES = Object.keys(MODES);

export const LIBELLES_MODES = {
  'poids-du-corps': 'Poids du corps',
  'charge': 'Charge libre',
  'machine': 'Machine a crans',
  'temps': 'Durée',
  'cardio': 'Cardio'
};

// ─────────────────────────────────────────────────────────────────────────────
// Changement de mode sur un exercice AYANT DEJA un historique
// ─────────────────────────────────────────────────────────────────────────────
export const TRANSITIONS_AUTORISEES = {
  // migre : chargeKg = poidsDeCorps * bodyweightFactor + lestKg, series marquees migre:true
  'poids-du-corps': ['charge'],
  // uniquement si machineProfiles est complet, sinon les crans ne se convertissent pas en kg
  'machine': ['charge']
};
// Toute autre transition : refus, avec proposition de creer un NOUVEL exercice. Convertir
// silencieusement une metrique en une autre reecrit l'historique — c'est le defaut a eviter.

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulaires fermes
// ─────────────────────────────────────────────────────────────────────────────
export const CATEGORIES = [
  'dos', 'pectoraux', 'epaules', 'biceps', 'triceps',
  'quadriceps', 'ischios', 'fessiers', 'mollets', 'abdos',
  'cardio', 'corps-entier'
];

export const LIBELLES_CATEGORIES = {
  'dos': 'Dos',
  'pectoraux': 'Pectoraux',
  'epaules': 'Épaules',
  'biceps': 'Biceps',
  'triceps': 'Triceps',
  'quadriceps': 'Quadriceps',
  'ischios': 'Ischios',
  'fessiers': 'Fessiers',
  'mollets': 'Mollets',
  'abdos': 'Abdos',
  'cardio': 'Cardio',
  'corps-entier': 'Corps entier'
};

export const MATERIELS = [
  'aucun', 'barre', 'halteres', 'kettlebell', 'poulie', 'machine',
  'barre-traction', 'barres-paralleles', 'banc', 'elastique', 'sangles',
  'tapis-de-course', 'velo', 'rameur', 'elliptique', 'corde-a-sauter'
];

export const LIBELLES_MATERIELS = {
  'aucun': 'Aucun',
  'barre': 'Barre',
  'halteres': 'Haltères',
  'kettlebell': 'Kettlebell',
  'poulie': 'Poulie',
  'machine': 'Machine',
  'barre-traction': 'Barre de traction',
  'barres-paralleles': 'Barres parallèles',
  'banc': 'Banc',
  'elastique': 'Élastique',
  'sangles': 'Sangles',
  'tapis-de-course': 'Tapis de course',
  'velo': 'Vélo',
  'rameur': 'Rameur',
  'elliptique': 'Elliptique',
  'corde-a-sauter': 'Corde à sauter'
};

// Unite BRUTE de chaque metrique. Le formatage lisible reste a la charge de lib/num.js :
// 'sec-par-km' s'affiche « 5:42 /km », 'sec' s'affiche « 1:30 ».
export const UNITES = {
  'e1rm-max': 'kg',
  'charge-max': 'kg',
  'charge-effective-max': 'kg',
  'reps-max': 'reps',
  'reps-total': 'reps',
  'tonnage': 'kg',
  'duree-max': 'sec',
  'duree-totale': 'sec',
  'duree': 'sec',
  'allure': 'sec-par-km',
  'vitesse': 'km/h',
  'distance': 'km'
};

export const LIBELLES_METRIQUES = {
  'e1rm-max': '1RM estimé',
  'charge-max': 'Charge max',
  'charge-effective-max': 'Charge effective max',
  'reps-max': 'Répétitions max',
  'reps-total': 'Répétitions (total séance)',   // v8 : cumul, pour la 2e courbe permanente
  'tonnage': 'Volume',   // v6 : somme charge x reps par seance — le mot « tonnage » rebutait
  'duree-max': 'Durée max',
  'duree-totale': 'Durée totale',
  'duree': 'Durée',
  'allure': 'Allure',
  'vitesse': 'Vitesse',
  'distance': 'Distance'
};

// Valeurs fermees de Serie.kind : 2 valeurs, pas 5. Une taxonomie plus fine ne serait jamais
// saisie correctement en salle et rendrait `estComptable` indecidable.
export const KINDS = ['echauffement', 'effective'];

// Tous les champs numeriques que peut porter une Serie, tous modes confondus.
export const CHAMPS_VALEUR = ['reps', 'chargeKg', 'lestKg', 'valeur', 'dureeSec', 'distanceM'];

// Statuts d'une Seance. TROIS valeurs depuis la v2.
//
// ⚠ 'abandonnee' n'est PAS 'terminee'. Une seance abandonnee est CONSERVEE et reste visible dans
//   l'historique — constater qu'on a lache une seance est une information d'entrainement — mais
//   elle n'entre JAMAIS dans un agregat : ni courbe, ni tonnage, ni record, ni « derniere fois ».
//   La regle est portee par STATUTS_COMPTABLES et par estSeanceComptable(), a utiliser partout
//   plutot que de repeter `statut === 'terminee'`.
export const STATUTS_SEANCE = ['en-cours', 'terminee', 'abandonnee'];

// SEUL statut dont les series alimentent les agregats. Enumere ici pour qu'un statut ajoute
// demain n'entre pas dans les courbes par simple oubli : il faudra l'inscrire dans cette liste.
export const STATUTS_COMPTABLES = ['terminee'];

export const LIBELLES_STATUTS_SEANCE = {
  'en-cours': 'En cours',
  'terminee': 'Terminée',
  'abandonnee': 'Abandonnée'
};

export const SOURCES_POIDS = ['seance', 'manuel'];

// ─────────────────────────────────────────────────────────────────────────────
// Modeles : livres (catalogue) vs routines de l'utilisateur
// ─────────────────────────────────────────────────────────────────────────────
// Une ROUTINE est un Modele cree par l'utilisateur. Le type ne change pas : seule son ORIGINE
// change, et avec elle une regle de suppression.
//   · modele LIVRE      -> ne se supprime pas, il s'ARCHIVE (il peut revenir, et l'archiver est
//                          reversible ; le supprimer le ferait resurgir au prochain semis).
//   · routine UTILISATEUR -> suppression DURE autorisee. Une routine est une INTENTION, pas un
//                          fait : les seances passees en portent deja une copie integrale dans
//                          modeleSnapshot, donc supprimer la routine ne perd aucun historique.
export const PREFIXE_ROUTINE = 'usr:';

// Prefixes des modeles LIVRES. 'mod:' est celui de data/templates.js depuis la v1 ; 'tpl:' est
// accepte pour les livraisons futures. Les deux se lisent « livre avec l'application ».
export const PREFIXES_MODELE_LIVRE = ['tpl:', 'mod:'];

export const ORIGINES_MODELE = ['livre', 'utilisateur'];

/** Origine d'un modele. Lit le champ `origine` s'il existe, sinon la DEDUIT du prefixe d'id :
 *  une base v1 n'a pas ce champ, et la deduction doit donner le meme resultat que la migration. */
export function origineModele(modele) {
  if (!modele) return 'livre';
  if (ORIGINES_MODELE.indexOf(modele.origine) !== -1) return modele.origine;
  const id = String(modele.id || '');
  if (id.startsWith(PREFIXE_ROUTINE)) return 'utilisateur';
  if (PREFIXES_MODELE_LIVRE.some((p) => id.startsWith(p))) return 'livre';
  // Id sans prefixe connu : c'est forcement une creation locale, jamais une livraison.
  return 'utilisateur';
}

export function estRoutine(modele) {
  return origineModele(modele) === 'utilisateur';
}

export function estModeleLivre(modele) {
  return origineModele(modele) === 'livre';
}

/** true si ce modele accepte une suppression DURE. Faux pour tout modele livre. */
export function suppressionDurePermise(modele) {
  return estRoutine(modele);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires internes
// ─────────────────────────────────────────────────────────────────────────────

// Copie profonde. Les fabriques COPIENT tout ce qu'elles recoivent : un modele partage par
// reference avec une seance ferait muter l'historique a la moindre edition du modele.
function copie(v) {
  if (v == null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v); } catch (e) { /* objets non clonables : repli JSON */ }
  }
  return JSON.parse(JSON.stringify(v));
}

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);
const estTexte = (v) => typeof v === 'string' && v.trim() !== '';

// ─────────────────────────────────────────────────────────────────────────────
// Fabriques
// ─────────────────────────────────────────────────────────────────────────────

// Cree un exercice complet. Tous les champs existent toujours : un champ absent se lit `undefined`
// et se propage silencieusement dans les calculs, un champ a null se detecte.
export function nouvelExercice(p = {}) {
  const maintenant = Date.now();
  const mode = MODES[p.mode] ? p.mode : 'charge';
  return {
    id: p.id || 'usr:' + ulid(),
    nom: p.nom || '',
    alias: Array.isArray(p.alias) ? p.alias.slice() : [], // recherche UNIQUEMENT, jamais regroupement
    categorie: p.categorie || 'corps-entier',
    materiel: p.materiel || 'aucun',
    mode,
    lestable: p.lestable === true,           // active lestKg SIGNE
    unilateral: p.unilateral === true,       // dimension d'AFFICHAGE : n'ajoute aucun champ a Serie
    incrementKg: estNombre(p.incrementKg) ? p.incrementKg : 2.5,
    bodyweightFactor: estNombre(p.bodyweightFactor) ? p.bodyweightFactor : 1.0,
    machineProfiles: p.machineProfiles ? copie(p.machineProfiles) : {},
    metriqueCardio: p.metriqueCardio || null,
    reposParDefautSec: estNombre(p.reposParDefautSec) ? p.reposParDefautSec : 120,
    metriquePreferee: p.metriquePreferee || null,
    notes: p.notes || null,
    // ⚠ interdit a la synchronisation du catalogue livre d'ecraser cet exercice.
    userModified: p.userModified === true,
    // ⚠ JAMAIS de suppression dure : des seances de 2023 referencent cet id a vie.
    archived: p.archived === true,
    archivedAt: p.archivedAt || null,
    createdAt: p.createdAt || maintenant,
    updatedAt: p.updatedAt || maintenant
  };
}

export function nouveauLieu(p = {}) {
  return {
    id: p.id || 'lieu:' + ulid(),
    nom: p.nom || '',
    archived: p.archived === true,
    createdAt: p.createdAt || Date.now()
  };
}

// Cree une serie. `mode` sert uniquement a savoir quels champs de saisie renseigner :
// les autres restent a null pour que la forme de l'objet soit toujours la meme.
// ⚠ `done` vaut false par defaut : une serie fraichement fabriquee est PREVUE, pas faite.
//   session.validerSerie() la passe a true. Un defaut a true compterait les series a venir
//   dans tous les agregats (voir estComptable).
export function nouvelleSerie(mode, p = {}) {
  const def = MODES[mode];
  // Champs recevables dans ce mode. lestKg est toujours accepte a ce niveau : seul l'exercice
  // sait s'il est lestable, et la serie ne porte pas le mode (il est gele sur l'entree parente).
  const recevables = def ? def.saisie.concat(['lestKg']) : CHAMPS_VALEUR;
  const serie = {
    id: p.id || ulid(),
    kind: KINDS.indexOf(p.kind) !== -1 ? p.kind : 'effective',
    done: p.done === true,
    echec: p.echec === true,               // « racke avant la fin », saisi depuis l'edition seule
    reps: null,
    chargeKg: null,
    lestKg: null,                          // ⚠ SIGNE : +10 lest, -20 assistance
    valeur: null,                          // numero de cran, decimal admis (7.5)
    dureeSec: null,
    distanceM: null,
    note: p.note || null,
    // ⚠ epoch ms de VALIDATION. Le repos reel entre deux series en est derive, jamais saisi.
    at: estNombre(p.at) ? p.at : (p.done === true ? Date.now() : null)
  };
  // Les champs etrangers au mode restent a null : une charge tombee par accident sur une serie
  // cardio serait ensuite lue par les reducteurs et fausserait une courbe sans laisser de trace.
  for (const champ of recevables) {
    if (estNombre(p[champ])) serie[champ] = p[champ];
  }
  // Renseigne uniquement par une transition de mode (voir TRANSITIONS_AUTORISEES).
  if (p.migre === true) serie.migre = true;
  return serie;
}

// Cree une entree de seance a partir d'un exercice.
// ══ COEFFICIENTS GELES — correction du defaut de falsification retroactive ══
// modeUtilise, lestableUtilise, incrementKgUtilise, bodyweightFactorUtilise et
// machineProfileUtilise sont COPIES ici et plus jamais relus sur l'Exercice. Sans ce gel,
// corriger le bodyweightFactor des pompes de 0,65 a 0,75 reecrirait en silence trois ans de
// tonnage deja enregistre : le passe changerait de valeur sans qu'aucune donnee n'ait bouge.
export function nouvelleEntree(exercice, cibles = {}, ctx = {}) {
  const ex = exercice || {};
  const lieuId = ctx.lieuId || null;
  const profils = ex.machineProfiles || {};
  const profil = lieuId && profils[lieuId] ? copie(profils[lieuId]) : null;
  return {
    id: ctx.id || ulid(),
    exerciceId: ex.id || null,              // ⚠ reference par id, JAMAIS par libelle
    nomAffiche: ex.nom || null,             // secours a l'import corrompu UNIQUEMENT
    groupeId: cibles.groupeId || null,      // schema conserve, UI v1 absente (supersets)
    groupeType: cibles.groupeType || null,
    modeUtilise: ex.mode || null,
    lestableUtilise: ex.lestable === true,
    // ⚠ Gele au meme titre que les autres : le tonnage d'un exercice unilateral compte double.
    //   Sans ce champ, metrics.js le cherche, ne le trouve jamais, et divise silencieusement
    //   par deux le tonnage de tous les exercices unilateraux — a vie.
    unilateralUtilise: ex.unilateral === true,
    incrementKgUtilise: estNombre(ex.incrementKg) ? ex.incrementKg : null,
    bodyweightFactorUtilise: estNombre(ex.bodyweightFactor) ? ex.bodyweightFactor : null,
    // ⚠ le profil du LIEU du jour : demenager de salle ne doit pas reinterpreter les anciens crans.
    machineProfileUtilise: profil,
    cibles: {
      series: estNombre(cibles.series) ? cibles.series : null,
      seriesEchauffement: estNombre(cibles.seriesEchauffement) ? cibles.seriesEchauffement : 0,
      // ⚠ FOURCHETTE, jamais un entier : « 6 a 8 » est ce qui est reellement vise.
      reps: cibles.reps ? { min: cibles.reps.min ?? null, max: cibles.reps.max ?? null } : null,
      dureeSec: estNombre(cibles.dureeSec) ? cibles.dureeSec : null,
      distanceM: estNombre(cibles.distanceM) ? cibles.distanceM : null,
      chargeCible: cibles.chargeCible ? copie(cibles.chargeCible) : null,
      reposSec: estNombre(cibles.reposSec) ? cibles.reposSec
        : (estNombre(ex.reposParDefautSec) ? ex.reposParDefautSec : 120)
    },
    series: Array.isArray(ctx.series) ? ctx.series : [],
    note: cibles.note || null
  };
}

// Cree la coquille d'une seance. Les entrees sont ajoutees par domain/session.js, qui seul
// dispose des exercices necessaires au gel des coefficients.
export function nouvelleSeance(modele = null, ctx = {}) {
  const maintenant = Date.now();
  return {
    id: ctx.id || ulid(),
    // ⚠ date LOCALE via dayKey : derivee d'un ISO UTC, une seance commencee a 23 h basculerait
    //   au lendemain et ne se rangerait pas au bon jour dans l'historique.
    date: ctx.date || dayKey(new Date(maintenant)),
    startedAt: estNombre(ctx.startedAt) ? ctx.startedAt : maintenant,
    endedAt: null,
    dureeSec: null,
    statut: 'en-cours',
    modeleId: modele ? modele.id : null,     // conserve a titre STATISTIQUE uniquement
    // v5 : nom PERSONNALISE (« Renommer » dans le detail d'historique). null = les vues
    // retombent sur modeleSnapshot.nom puis « Séance libre ». Le snapshot n'est jamais reecrit.
    nom: ctx.nom || null,
    // COPIE INTEGRALE du modele au lancement : modifier le modele demain ne doit rien changer
    // a ce qui a ete reellement fait aujourd'hui.
    modeleSnapshot: modele ? copie(modele) : null,
    // ⚠ demande AU LANCEMENT : chargeEffectiveKg en depend PENDANT toute la seance.
    poidsDeCorpsKg: estNombre(ctx.poidsDeCorpsKg) ? ctx.poidsDeCorpsKg : null,
    lieuId: ctx.lieuId || null,
    ressenti: null,
    notes: null,
    // ⚠ horodatage de FIN, jamais un compteur : un compteur decremente meurt avec le gel
    //   d'onglet mobile, un horodatage survit meme a un kill complet de l'application.
    repos: null,
    entrees: [],
    // ⚠ REQUIS : l'import « fusionner » est indecidable sans lui.
    updatedAt: maintenant
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fabriques de modeles / routines
// ─────────────────────────────────────────────────────────────────────────────

// Item de modele, tous champs presents. L'id est fourni par l'appelant quand il doit rester
// DETERMINISTE (modeles livres) et genere sinon.
export function nouvelItemModele(p = {}) {
  return {
    id: p.id || ulid(),
    exerciceId: p.exerciceId || null,
    groupeId: p.groupeId || null,   // schema conserve pour les supersets, UI absente
    groupeType: p.groupeType || null,
    seriesCibles: estNombre(p.seriesCibles) ? p.seriesCibles : 3,
    seriesEchauffement: estNombre(p.seriesEchauffement) ? p.seriesEchauffement : 0,
    // ⚠ FOURCHETTE, jamais un entier : « 8 » se lit comme un ordre rate des qu'on en fait 7.
    repsCibles: p.repsCibles ? { min: p.repsCibles.min ?? null, max: p.repsCibles.max ?? null } : null,
    dureeCibleSec: estNombre(p.dureeCibleSec) ? p.dureeCibleSec : null,
    distanceCibleM: estNombre(p.distanceCibleM) ? p.distanceCibleM : null,
    // ⚠ Aucun kilo en dur : un modele qui annonce « 4 x 8 a 60 kg » ment des la troisieme semaine.
    chargeCible: p.chargeCible ? copie(p.chargeCible) : { type: 'derniere', delta: 0 },
    reposSec: estNombre(p.reposSec) ? p.reposSec : 120,
    note: p.note || null
  };
}

/**
 * Cree un Modele. Par defaut une ROUTINE UTILISATEUR : c'est le seul cas ou du code appelle
 * cette fabrique a l'execution — les modeles livres sont ecrits en dur dans data/templates.js.
 */
export function nouveauModele(p = {}) {
  const maintenant = Date.now();
  const origine = ORIGINES_MODELE.indexOf(p.origine) !== -1 ? p.origine : 'utilisateur';
  return {
    id: p.id || (origine === 'utilisateur' ? PREFIXE_ROUTINE + ulid() : 'tpl:' + ulid()),
    nom: p.nom || '',
    description: p.description || '',
    dureeEstimeeMin: estNombre(p.dureeEstimeeMin) ? p.dureeEstimeeMin : null,
    items: Array.isArray(p.items) ? p.items.map((it) => nouvelItemModele(it)) : [],
    // ⚠ Champ explicite plutot qu'un test de prefixe dissemine : une routine importee depuis un
    //   autre appareil garde son origine meme si l'id ne suit plus la convention du jour.
    origine,
    // v4 : seance FAVORITE — mise en avant sur l'accueil. Un champ absent vaut false, aucune
    // migration necessaire.
    favori: p.favori === true,
    archived: p.archived === true,
    createdAt: p.createdAt || maintenant,
    updatedAt: p.updatedAt || maintenant
  };
}

/**
 * Duplique un modele en ROUTINE UTILISATEUR.
 * Les ids d'items sont REGENERES : deux modeles partageant un id d'item se marcheraient dessus
 * a l'import « fusionner », ou l'id d'item est la cle de reconciliation.
 */
export function dupliquerModele(modele, p = {}) {
  const src = modele || {};
  return nouveauModele({
    nom: p.nom || (src.nom ? src.nom + ' (copie)' : 'Routine'),
    description: src.description || '',
    dureeEstimeeMin: src.dureeEstimeeMin,
    // id volontairement omis sur chaque item : nouvelItemModele en genere un neuf.
    items: (src.items || []).map((it) => Object.assign(copie(it), { id: null })),
    origine: 'utilisateur'
  });
}

/**
 * Construit (SANS l'ecrire) une routine FAVORITE a partir d'une seance close : « refaire cette
 * seance a vide ». L'appelant la persiste via commit('routine:creer', { routine }).
 *
 * Un item par entree ayant AU MOINS une serie comptable (estComptable) ; les cibles decrivent ce
 * qui a ete REELLEMENT fait :
 *   · seriesCibles  = nombre de series comptables ;
 *   · repsCibles    = fourchette min/max des reps effectivement faites ;
 *   · dureeCibleSec / distanceCibleM = meilleures series (modes temps / cardio) ;
 *   · chargeCible   = { type:'derniere', delta:0 } — JAMAIS un kilo en dur (invariant du modele).
 */
export function routineDepuisSeance(seance, p = {}) {
  const s = seance || {};
  const snap = s.modeleSnapshot || null;
  const items = [];
  for (const entree of s.entrees || []) {
    if (!entree || !entree.exerciceId) continue;
    const comptables = (entree.series || []).filter(estComptable);
    if (!comptables.length) continue;

    const item = {
      exerciceId: entree.exerciceId,
      seriesCibles: comptables.length,
      seriesEchauffement: (entree.series || [])
        .filter((x) => x && x.done === true && x.kind === 'echauffement').length,
      chargeCible: { type: 'derniere', delta: 0 }
    };
    const cibles = entree.cibles || {};
    if (estNombre(cibles.reposSec)) item.reposSec = cibles.reposSec;

    const reps = comptables.map((x) => x.reps).filter(estNombre);
    if (reps.length) item.repsCibles = { min: Math.min.apply(null, reps), max: Math.max.apply(null, reps) };

    const durees = comptables.map((x) => x.dureeSec).filter(estNombre);
    if (durees.length) item.dureeCibleSec = Math.max.apply(null, durees);

    const distances = comptables.map((x) => x.distanceM).filter(estNombre);
    if (distances.length) item.distanceCibleM = Math.max.apply(null, distances);

    items.push(item);
  }
  return {
    nom: p.nom || (snap && snap.nom) || ('Séance du ' + (s.date || '')),
    description: '',
    items,
    // v6 : plus de flag favori — le concept est remplace par les « seances types », des routines
    // ordinaires creees depuis l'historique (bouton « + ») et gerees depuis l'accueil.
    origine: 'utilisateur'
  };
}

export function nouveauPoids(p = {}) {
  return {
    date: p.date || dayKey(new Date()),
    kg: estNombre(p.kg) ? p.kg : null,
    source: SOURCES_POIDS.includes(p.source) ? p.source : 'manuel'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivations
// ─────────────────────────────────────────────────────────────────────────────

// Champs de saisie effectifs d'un exercice. Derive de MODES et du seul booleen `lestable` :
// c'est la fonction qui evite a l'UI de tester un mode pour savoir s'il faut afficher le lest.
export function champsSaisie(exercice) {
  const def = MODES[exercice && exercice.mode];
  if (!def) return [];
  const champs = def.saisie.slice();
  if (def.lestSiLestable && exercice.lestable === true) champs.push('lestKg');
  return champs;
}

// Meme derivation, mais depuis une ENTREE de seance (coefficients geles) : c'est cette version
// qu'utilise l'ecran de seance, pour que rouvrir une vieille seance affiche les champs
// tels qu'ils etaient ce jour-la et non tels que l'exercice est configure aujourd'hui.
export function champsSaisieEntree(entree) {
  return champsSaisie({ mode: entree && entree.modeUtilise, lestable: entree && entree.lestableUtilise });
}

// true si la serie compte dans les agregats, records et courbes.
// ⚠ A UTILISER PARTOUT : un echauffement pris pour une serie effective pre-remplit la premiere
//   serie a 50 kg au lieu de 80 et fait plonger toutes les courbes.
export function estComptable(serie) {
  return !!serie && serie.done === true && serie.kind !== 'echauffement';
}

// true si les series de cette seance alimentent les agregats, records et courbes.
//
// ⚠ A UTILISER PARTOUT en lieu et place de `seance.statut === 'terminee'`. C'est le pendant de
//   estComptable() au niveau de la SEANCE : une seance abandonnee contient de vraies series
//   faites, mais elle est incomplete par definition, et la laisser entrer dans une courbe ferait
//   plonger la tendance sans que rien n'ait regresse.
export function estSeanceComptable(seance) {
  return !!seance && STATUTS_COMPTABLES.indexOf(seance.statut) !== -1;
}

export function estSeanceEnCours(seance) {
  return !!seance && seance.statut === 'en-cours';
}

export function estSeanceAbandonnee(seance) {
  return !!seance && seance.statut === 'abandonnee';
}

/** true si cette seance est close, quelle qu'en soit l'issue. Sert aux ecrans, pas aux agregats. */
export function estSeanceClose(seance) {
  return !!seance && (seance.statut === 'terminee' || seance.statut === 'abandonnee');
}

export function transitionPermise(de, vers) {
  if (!MODES[de] || !MODES[vers]) return false;
  if (de === vers) return true; // « ne pas changer de mode » est toujours permis
  return (TRANSITIONS_AUTORISEES[de] || []).indexOf(vers) !== -1;
}

// Metrique affichee par defaut pour un exercice : preference explicite si elle est valide dans
// le mode courant, puis metriqueCardio, puis la premiere metrique du mode.
export function metriqueParDefaut(exercice) {
  const def = MODES[exercice && exercice.mode];
  if (!def) return null;
  const dispo = def.metriques;
  if (exercice.metriquePreferee && dispo.indexOf(exercice.metriquePreferee) !== -1) {
    return exercice.metriquePreferee;
  }
  if (exercice.metriqueCardio && dispo.indexOf(exercice.metriqueCardio) !== -1) {
    return exercice.metriqueCardio;
  }
  return dispo[0] || null;
}

// Pas d'un champ pour un exercice donne. Resout la chaine 'incrementKg' de MODES.pas contre
// l'exercice, pour que les boutons +/- avancent du vrai increment de la salle (1,25 kg).
export function pasChamp(exercice, champ) {
  const def = MODES[exercice && exercice.mode];
  const pas = def && def.pas ? def.pas[champ] : null;
  if (pas == null) return 1;
  if (pas === 'incrementKg') return estNombre(exercice.incrementKg) ? exercice.incrementKg : 2.5;
  return pas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const VALIDATEURS = {
  exercice(o, err) {
    if (!estTexte(o.id)) err.push('id manquant');
    if (!estTexte(o.nom)) err.push('nom obligatoire');
    if (!MODES[o.mode]) err.push('mode inconnu : ' + o.mode);
    if (CATEGORIES.indexOf(o.categorie) === -1) err.push('categorie inconnue : ' + o.categorie);
    if (o.materiel != null && MATERIELS.indexOf(o.materiel) === -1) err.push('materiel inconnu : ' + o.materiel);
    if (!estNombre(o.incrementKg) || o.incrementKg <= 0) err.push('incrementKg doit etre > 0');
    if (!estNombre(o.bodyweightFactor) || o.bodyweightFactor < 0) err.push('bodyweightFactor invalide');
    if (o.metriqueCardio != null && !UNITES[o.metriqueCardio]) err.push('metriqueCardio inconnue');
  },
  serie(o, err) {
    if (!estTexte(o.id)) err.push('id manquant');
    if (KINDS.indexOf(o.kind) === -1) err.push('kind inconnu : ' + o.kind);
    if (typeof o.done !== 'boolean') err.push('done doit etre un booleen');
    if (o.reps != null && (!estNombre(o.reps) || o.reps < 0)) err.push('reps invalide');
    if (o.chargeKg != null && (!estNombre(o.chargeKg) || o.chargeKg < 0)) err.push('chargeKg invalide');
    // lestKg est SIGNE : une valeur negative (assistance elastique) est parfaitement valide.
    if (o.lestKg != null && !estNombre(o.lestKg)) err.push('lestKg invalide');
    if (o.valeur != null && (!estNombre(o.valeur) || o.valeur < 0)) err.push('valeur invalide');
    if (o.dureeSec != null && (!estNombre(o.dureeSec) || o.dureeSec < 0)) err.push('dureeSec invalide');
    if (o.distanceM != null && (!estNombre(o.distanceM) || o.distanceM < 0)) err.push('distanceM invalide');
    if (o.done === true && !estNombre(o.at)) err.push('at obligatoire sur une serie faite');
  },
  entree(o, err) {
    if (!estTexte(o.id)) err.push('id manquant');
    if (!estTexte(o.exerciceId)) err.push('exerciceId manquant');
    if (!MODES[o.modeUtilise]) err.push('modeUtilise inconnu : ' + o.modeUtilise);
    if (!Array.isArray(o.series)) err.push('series doit etre un tableau');
  },
  seance(o, err) {
    if (!estTexte(o.id)) err.push('id manquant');
    // Le format est verifie, pas la valeur : une date locale ne se revalide pas contre UTC.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) err.push('date attendue au format YYYY-MM-DD local');
    if (STATUTS_SEANCE.indexOf(o.statut) === -1) err.push('statut inconnu : ' + o.statut);
    if (!estNombre(o.startedAt)) err.push('startedAt manquant');
    if (!Array.isArray(o.entrees)) err.push('entrees doit etre un tableau');
    if (!estNombre(o.updatedAt)) err.push('updatedAt manquant');
    if (o.poidsDeCorpsKg != null && (!estNombre(o.poidsDeCorpsKg) || o.poidsDeCorpsKg <= 0)) {
      err.push('poidsDeCorpsKg invalide');
    }
    // Une seance close — terminee comme abandonnee — porte forcement l'instant de sa cloture :
    // sans lui, l'historique ne sait pas la dater et la duree n'est pas calculable.
    if (o.statut !== 'en-cours' && !estNombre(o.endedAt)) err.push('endedAt obligatoire sur une seance close');
  },
  modele(o, err) {
    if (!estTexte(o.id)) err.push('id manquant');
    if (!estTexte(o.nom)) err.push('nom obligatoire');
    if (!Array.isArray(o.items)) err.push('items doit etre un tableau');
    // `origine` reste FACULTATIF : une base v1 n'en a pas et origineModele() la deduit du
    // prefixe. En revanche une valeur presente et fausse est une erreur, parce qu'elle ferait
    // croire a tort qu'un modele livre est supprimable.
    if (o.origine != null && ORIGINES_MODELE.indexOf(o.origine) === -1) {
      err.push('origine inconnue : ' + o.origine);
    }
  },
  lieu(o, err) {
    if (!estTexte(o.id)) err.push('id manquant');
    if (!estTexte(o.nom)) err.push('nom obligatoire');
  },
  poids(o, err) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) err.push('date attendue au format YYYY-MM-DD local');
    if (!estNombre(o.kg) || o.kg <= 0) err.push('kg invalide');
    if (SOURCES_POIDS.indexOf(o.source) === -1) err.push('source inconnue : ' + o.source);
  }
};

// valider(objet, type) -> { ok, erreurs }
// Ne leve JAMAIS : l'import doit pouvoir DEGRADER une donnee douteuse plutot que de la refuser,
// et une exception ici ferait perdre l'ensemble du fichier importe.
export function valider(objet, type) {
  const erreurs = [];
  const validateur = VALIDATEURS[type];
  if (!validateur) erreurs.push('type inconnu : ' + type);
  else if (!objet || typeof objet !== 'object') erreurs.push('objet attendu');
  else validateur(objet, erreurs);
  return { ok: erreurs.length === 0, erreurs };
}
