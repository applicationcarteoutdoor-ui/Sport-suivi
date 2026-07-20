// data/catalog.js — CATALOGUE livre : 40 exercices, dont 6 cardio.
//
// Chaque entree est un Exercice complet au sens de schema.js, fabrique par nouvelExercice() :
// passer par la fabrique garantit que le catalogue et un exercice cree par l'utilisateur ont
// EXACTEMENT la meme forme. Un champ present ici et absent la-bas se lirait `undefined` et se
// propagerait en silence dans les calculs de charge effective.
//
// Les ids sont prefixes 'cat:' et FIGES A VIE : des seances de 2023 les referencent. Renommer un
// id revient a effacer l'historique de l'exercice, jamais a le renommer. Seul le champ `nom`
// se corrige.

import { nouvelExercice, transitionPermise } from './schema.js';

// Horodatage FIXE du catalogue livre, jamais Date.now() : sans cela, chaque chargement du module
// fabriquerait des createdAt differents et `synchroniser` ne saurait plus distinguer un exercice
// deja installe d'un exercice neuf.
const LIVRE_LE = Date.parse('2026-01-01T00:00:00Z');

/**
 * Nom du pictogramme d'un exercice : SON IDENTIFIANT PRIVE DE SON PREFIXE. Aucune exception.
 * 'cat:tractions-pronation' donne 'tractions-pronation'.
 *
 * ⚠ Cette regle est le contrat partage avec js/ui/icons.js. Elle est mecanique EXPRES : une table
 *   de correspondance id → icone serait un troisieme endroit a mettre a jour a chaque nouvel
 *   exercice, et le jour ou quelqu'un l'oublie, l'exercice s'affiche sans icone dans le
 *   selecteur — donc invisible dans une interface faite d'icones.
 * ⚠ Vaut aussi pour les exercices personnels : 'usr:01H...' donne l'icone '01H...', que icons.js
 *   ne connait pas et pour laquelle il rendra son pictogramme de repli. C'est le comportement
 *   voulu : une regle unique, un repli unique, aucun cas particulier a tester.
 */
export function iconeDeId(id) {
  if (typeof id !== 'string') return '';
  const separateur = id.indexOf(':');
  return separateur === -1 ? id : id.slice(separateur + 1);
}

function ex(p) {
  const exercice = nouvelExercice(Object.assign({ createdAt: LIVRE_LE, updatedAt: LIVRE_LE }, p));
  // ⚠ Pose APRES la fabrique, et pas passe dans `p` : nouvelExercice() construit un objet litteral
  //   champ par champ et laisserait tomber en silence toute cle qu'elle ne connait pas. L'icone
  //   n'est donc PAS un champ du schema, elle est derivee de l'id — un exercice ne peut pas avoir
  //   une icone qui contredise son identite.
  exercice.icone = iconeDeId(exercice.id);
  return exercice;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conventions de reglage, appliquees uniformement ci-dessous
// ─────────────────────────────────────────────────────────────────────────────
// incrementKg : 2.5 pour une barre (la plus petite PAIRE de disques pese 2 x 1,25 kg),
//               1.25 pour les halteres et les petits mouvements d'isolation,
//               5 pour les machines et les colonnes lourdes (le pas reel de la pile).
//               Il sert AUSSI de tolerance de record : estRecord exige un ecart > increment / 2.
// bodyweightFactor : part du poids de corps reellement deplacee. 1.0 quand le corps entier pend
//               ou se souleve (tractions, dips, suspension), 0.65 en pompes classiques,
//               0.75 en pompes declinees, 0.6 en gainage. Ce coefficient est GELE sur l'entree
//               de seance au moment de l'ajout : le corriger ici ne reecrit aucun passe.
// reposParDefautSec : temps reellement pris en salle, pas un ideal theorique.

export const CATALOGUE = [

  // ── Dos : tractions ────────────────────────────────────────────────────────
  ex({
    id: 'cat:tractions-pronation',
    nom: 'Tractions pronation',
    alias: ['pull-up', 'traction', 'pull up', 'pronation'],
    categorie: 'dos',
    materiel: 'barre-traction',
    mode: 'poids-du-corps',
    lestable: true,          // ceinture de lest, ou lestKg NEGATIF pour une assistance elastique
    unilateral: false,
    incrementKg: 2.5,
    bodyweightFactor: 1.0,
    reposParDefautSec: 150
  }),
  ex({
    id: 'cat:tractions-supination',
    nom: 'Tractions supination',
    alias: ['chin-up', 'chin up', 'supination', 'traction supination'],
    categorie: 'dos',
    materiel: 'barre-traction',
    mode: 'poids-du-corps',
    lestable: true,
    unilateral: false,
    incrementKg: 2.5,
    bodyweightFactor: 1.0,
    reposParDefautSec: 150
  }),
  ex({
    id: 'cat:tractions-neutre',
    nom: 'Tractions prise neutre',
    alias: ['neutral grip', 'prise marteau', 'traction neutre'],
    categorie: 'dos',
    materiel: 'barre-traction',
    mode: 'poids-du-corps',
    lestable: true,
    unilateral: false,
    incrementKg: 2.5,
    bodyweightFactor: 1.0,
    reposParDefautSec: 150
  }),

  // ── Pectoraux et triceps : pompes ──────────────────────────────────────────
  ex({
    id: 'cat:pompes',
    nom: 'Pompes',
    alias: ['push-up', 'push up', 'pompes classiques'],
    categorie: 'pectoraux',
    materiel: 'aucun',
    mode: 'poids-du-corps',
    lestable: true,          // gilet leste ou disque sur le dos
    unilateral: false,
    incrementKg: 1.25,
    bodyweightFactor: 0.65,
    reposParDefautSec: 90
  }),
  ex({
    id: 'cat:pompes-declinees',
    nom: 'Pompes déclinées',
    alias: ['decline push-up', 'pieds sureleves', 'pompes pieds sureleves'],
    categorie: 'pectoraux',
    materiel: 'banc',
    mode: 'poids-du-corps',
    lestable: true,
    unilateral: false,
    incrementKg: 1.25,
    bodyweightFactor: 0.75,  // pieds plus hauts que les mains : davantage de poids sur les bras
    reposParDefautSec: 90
  }),
  ex({
    id: 'cat:pompes-diamant',
    nom: 'Pompes diamant',
    alias: ['diamond push-up', 'pompes serrees', 'pompes triceps'],
    categorie: 'triceps',
    materiel: 'aucun',
    mode: 'poids-du-corps',
    lestable: true,
    unilateral: false,
    incrementKg: 1.25,
    bodyweightFactor: 0.7,   // mains serrees : bras de levier plus defavorable qu'en pompes larges
    reposParDefautSec: 90
  }),
  // ⚠ « Pompes mains surelevees » (regression debutante des pompes classiques) n'est pas livree :
  //   le catalogue est plafonne a 40 entrees, et c'est la seule variante de la liste qui
  //   n'apporte aucun stimulus distinct. Elle se recree en deux champs via « Creer eclair ».

  // ── Dips ───────────────────────────────────────────────────────────────────
  ex({
    id: 'cat:dips-barres',
    nom: 'Dips aux barres parallèles',
    alias: ['dips', 'dip', 'repulsions'],
    categorie: 'pectoraux',
    materiel: 'barres-paralleles',
    mode: 'poids-du-corps',
    lestable: true,
    unilateral: false,
    incrementKg: 2.5,
    bodyweightFactor: 1.0,
    reposParDefautSec: 150
  }),
  ex({
    id: 'cat:dips-banc',
    nom: 'Dips sur banc',
    alias: ['bench dips', 'dips triceps', 'dips chaise'],
    categorie: 'triceps',
    materiel: 'banc',
    mode: 'poids-du-corps',
    lestable: true,
    unilateral: false,
    incrementKg: 1.25,
    bodyweightFactor: 1.0,
    reposParDefautSec: 90
  }),

  // ── Pectoraux : developpes ─────────────────────────────────────────────────
  ex({
    id: 'cat:developpe-couche-barre',
    nom: 'Développé couché à la barre',
    alias: ['bench press', 'developpe couche', 'couche', 'bench'],
    categorie: 'pectoraux',
    materiel: 'barre',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 180
  }),
  ex({
    id: 'cat:developpe-couche-halteres',
    nom: 'Développé couché aux haltères',
    alias: ['dumbbell bench press', 'developpe halteres', 'db bench'],
    categorie: 'pectoraux',
    materiel: 'halteres',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 1.25,
    reposParDefautSec: 150
  }),
  ex({
    id: 'cat:developpe-incline-barre',
    nom: 'Développé incliné à la barre',
    alias: ['incline bench press', 'developpe incline', 'incline'],
    categorie: 'pectoraux',
    materiel: 'barre',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 180
  }),

  // ── Epaules ────────────────────────────────────────────────────────────────
  ex({
    id: 'cat:developpe-militaire',
    nom: 'Développé militaire',
    alias: ['overhead press', 'military press', 'ohp', 'developpe epaules'],
    categorie: 'epaules',
    materiel: 'barre',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 180
  }),

  // ── Dos : tirages horizontaux et verticaux ─────────────────────────────────
  ex({
    id: 'cat:rowing-barre',
    nom: 'Rowing à la barre',
    alias: ['barbell row', 'rowing buste penche', 'rowing'],
    categorie: 'dos',
    materiel: 'barre',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 150
  }),
  ex({
    id: 'cat:rowing-halteres',
    nom: 'Rowing à un bras aux haltères',
    alias: ['dumbbell row', 'rowing haltere', 'row un bras'],
    categorie: 'dos',
    materiel: 'halteres',
    mode: 'charge',
    lestable: false,
    // unilateral : dimension d'AFFICHAGE (« par cote », tonnage double). N'ajoute aucun champ
    // a la Serie : on saisit un cote, jamais deux colonnes.
    unilateral: true,
    incrementKg: 1.25,
    reposParDefautSec: 120
  }),
  ex({
    id: 'cat:rowing-poulie-basse',
    nom: 'Rowing à la poulie basse',
    alias: ['seated cable row', 'tirage horizontal', 'rowing assis'],
    categorie: 'dos',
    materiel: 'poulie',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 5,          // pas reel d'une colonne de plaques lourdes
    reposParDefautSec: 120
  }),
  ex({
    id: 'cat:tirage-vertical',
    nom: 'Tirage vertical à la poulie haute',
    alias: ['lat pulldown', 'tirage nuque', 'tirage poitrine', 'pulldown'],
    categorie: 'dos',
    materiel: 'poulie',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 5,
    reposParDefautSec: 120
  }),

  // ── Chaine posterieure et jambes ───────────────────────────────────────────
  ex({
    id: 'cat:souleve-de-terre',
    nom: 'Soulevé de terre',
    alias: ['deadlift', 'sdt', 'souleve'],
    categorie: 'ischios',
    materiel: 'barre',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 210
  }),
  ex({
    id: 'cat:squat',
    nom: 'Squat à la barre',
    alias: ['back squat', 'squat', 'flexion'],
    categorie: 'quadriceps',
    materiel: 'barre',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 210
  }),
  ex({
    id: 'cat:presse-a-cuisses',
    nom: 'Presse à cuisses',
    alias: ['leg press', 'presse', 'presse jambes'],
    categorie: 'quadriceps',
    materiel: 'machine',
    // mode 'machine' : on note le NUMERO DE CRAN, pas des kilos. Sans machineProfiles renseigne
    // pour le lieu, la courbe reste en crans et les metriques en kg sont marquees fiable:false —
    // c'est voulu : mieux vaut modeliser l'incertitude que produire un chiffre faux.
    mode: 'machine',
    lestable: false,
    unilateral: false,
    incrementKg: 5,
    reposParDefautSec: 180
  }),
  ex({
    id: 'cat:fentes',
    nom: 'Fentes',
    alias: ['lunges', 'fentes marchees', 'fente avant'],
    categorie: 'quadriceps',
    materiel: 'halteres',
    mode: 'charge',
    lestable: false,
    unilateral: true,
    incrementKg: 1.25,
    reposParDefautSec: 120
  }),
  ex({
    id: 'cat:leg-curl',
    nom: 'Leg curl',
    alias: ['leg curl', 'curl ischios', 'flexion jambes'],
    categorie: 'ischios',
    materiel: 'machine',
    mode: 'machine',
    lestable: false,
    unilateral: false,
    incrementKg: 5,
    reposParDefautSec: 120
  }),
  ex({
    id: 'cat:leg-extension',
    nom: 'Leg extension',
    alias: ['leg extension', 'extension jambes', 'extension quadriceps'],
    categorie: 'quadriceps',
    materiel: 'machine',
    mode: 'machine',
    lestable: false,
    unilateral: false,
    incrementKg: 5,
    reposParDefautSec: 120
  }),
  ex({
    id: 'cat:mollets',
    nom: 'Extensions mollets debout',
    alias: ['calf raise', 'mollets', 'extension mollets'],
    categorie: 'mollets',
    materiel: 'machine',
    mode: 'machine',
    lestable: false,
    unilateral: false,
    incrementKg: 5,
    reposParDefautSec: 90
  }),

  // ── Biceps ─────────────────────────────────────────────────────────────────
  ex({
    id: 'cat:curl-barre',
    nom: 'Curl biceps à la barre',
    alias: ['barbell curl', 'curl barre', 'curl ez'],
    categorie: 'biceps',
    materiel: 'barre',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 90
  }),
  ex({
    id: 'cat:curl-halteres',
    nom: 'Curl biceps aux haltères',
    alias: ['dumbbell curl', 'curl haltere', 'curl marteau'],
    categorie: 'biceps',
    materiel: 'halteres',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 1.25,
    reposParDefautSec: 90
  }),
  ex({
    id: 'cat:curl-poulie',
    nom: 'Curl biceps à la poulie',
    alias: ['cable curl', 'curl poulie basse', 'curl cable'],
    categorie: 'biceps',
    materiel: 'poulie',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 90
  }),

  // ── Triceps ────────────────────────────────────────────────────────────────
  ex({
    id: 'cat:extensions-triceps-poulie',
    nom: 'Extensions triceps à la poulie haute',
    alias: ['triceps pushdown', 'extension poulie', 'pushdown', 'barre au front poulie'],
    categorie: 'triceps',
    materiel: 'poulie',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    reposParDefautSec: 90
  }),
  ex({
    id: 'cat:extensions-triceps-nuque',
    nom: 'Extensions triceps à la nuque',
    alias: ['overhead extension', 'extension nuque', 'triceps nuque'],
    categorie: 'triceps',
    materiel: 'halteres',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 1.25,
    reposParDefautSec: 90
  }),

  // ── Epaules : isolation ────────────────────────────────────────────────────
  ex({
    id: 'cat:elevations-laterales',
    nom: 'Élévations latérales',
    alias: ['lateral raise', 'elevations', 'laterales'],
    categorie: 'epaules',
    materiel: 'halteres',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 1.25,
    reposParDefautSec: 75
  }),
  ex({
    id: 'cat:oiseau',
    nom: 'Oiseau',
    alias: ['rear delt fly', 'elevations arriere', 'deltoide posterieur'],
    categorie: 'epaules',
    materiel: 'halteres',
    mode: 'charge',
    lestable: false,
    unilateral: false,
    incrementKg: 1.25,
    reposParDefautSec: 75
  }),

  // ── Abdos et gainage ───────────────────────────────────────────────────────
  ex({
    id: 'cat:planche',
    nom: 'Gainage planche',
    alias: ['plank', 'planche', 'gainage ventral'],
    categorie: 'abdos',
    materiel: 'aucun',
    mode: 'temps',           // le seul chiffre qui progresse ici est une duree, pas des reps
    lestable: true,          // disque pose sur le dos
    unilateral: false,
    incrementKg: 1.25,
    bodyweightFactor: 0.6,
    reposParDefautSec: 60
  }),
  ex({
    id: 'cat:planche-laterale',
    nom: 'Gainage planche latérale',
    alias: ['side plank', 'planche laterale', 'gainage lateral'],
    categorie: 'abdos',
    materiel: 'aucun',
    mode: 'temps',
    lestable: true,
    unilateral: true,
    incrementKg: 1.25,
    bodyweightFactor: 0.6,
    reposParDefautSec: 45
  }),
  ex({
    id: 'cat:suspension-barre',
    nom: 'Suspension à la barre',
    alias: ['dead hang', 'suspension', 'hang', 'grip'],
    categorie: 'dos',
    materiel: 'barre-traction',
    mode: 'temps',
    lestable: true,
    unilateral: false,
    incrementKg: 2.5,
    bodyweightFactor: 1.0,
    reposParDefautSec: 90
  }),
  ex({
    id: 'cat:releve-de-jambes',
    nom: 'Relevé de jambes suspendu',
    alias: ['hanging leg raise', 'releve jambes', 'leg raise'],
    categorie: 'abdos',
    materiel: 'barre-traction',
    mode: 'poids-du-corps',
    lestable: true,          // haltere tenu entre les pieds
    unilateral: false,
    incrementKg: 1.25,
    bodyweightFactor: 0.5,   // seul le bas du corps est souleve
    reposParDefautSec: 90
  }),

  // ── Cardio (6) ─────────────────────────────────────────────────────────────
  // ⚠ allure et vitesse ne sont JAMAIS saisies : elles sont derivees de dureeSec et distanceM.
  //   metriqueCardio dit seulement laquelle des deux presenter en premier.
  // ⚠ incrementKg n'a aucun sens en mode 'cardio' (les pas y sont dureeSec:30 et distanceM:100,
  //   lus dans MODES). Il reste renseigne car valider() l'exige strictement positif sur tout
  //   exercice : un champ absent se lirait undefined et remonterait dans les steppers.
  ex({
    id: 'cat:course-a-pied',
    nom: 'Course à pied',
    alias: ['running', 'run', 'footing', 'jogging', 'course'],
    categorie: 'cardio',
    materiel: 'aucun',
    mode: 'cardio',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    metriqueCardio: 'allure',
    reposParDefautSec: 60
  }),
  ex({
    id: 'cat:marche',
    nom: 'Marche',
    alias: ['walking', 'walk', 'marche rapide', 'randonnee'],
    categorie: 'cardio',
    materiel: 'aucun',
    mode: 'cardio',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    metriqueCardio: 'allure',
    reposParDefautSec: 60
  }),
  ex({
    id: 'cat:velo',
    nom: 'Vélo',
    alias: ['cycling', 'bike', 'velo appartement', 'cyclisme'],
    categorie: 'cardio',
    materiel: 'velo',
    mode: 'cardio',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    metriqueCardio: 'vitesse',
    reposParDefautSec: 60
  }),
  ex({
    id: 'cat:rameur',
    nom: 'Rameur',
    alias: ['rowing machine', 'rameur', 'erg', 'aviron'],
    categorie: 'cardio',
    materiel: 'rameur',
    mode: 'cardio',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    metriqueCardio: 'vitesse',
    reposParDefautSec: 90
  }),
  ex({
    id: 'cat:elliptique',
    nom: 'Vélo elliptique',
    alias: ['elliptical', 'elliptique', 'cross trainer'],
    categorie: 'cardio',
    materiel: 'elliptique',
    mode: 'cardio',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    metriqueCardio: 'vitesse',
    reposParDefautSec: 60
  }),
  ex({
    id: 'cat:corde-a-sauter',
    nom: 'Corde à sauter',
    alias: ['jump rope', 'skipping', 'corde'],
    categorie: 'cardio',
    materiel: 'corde-a-sauter',
    mode: 'cardio',
    lestable: false,
    unilateral: false,
    incrementKg: 2.5,
    // null : sauter sur place ne parcourt aucune distance, une allure y serait un chiffre invente.
    metriqueCardio: null,
    reposParDefautSec: 60
  })
];

// Index par id, pour eviter un find() lineaire a chaque recherche.
export const CATALOGUE_PAR_ID = new Map(CATALOGUE.map((e) => [e.id, e]));

/** true si cet id provient du catalogue livre (par opposition a 'usr:'). */
export function estExerciceLivre(id) {
  return typeof id === 'string' && id.startsWith('cat:');
}

// ─────────────────────────────────────────────────────────────────────────────
// Synchronisation du catalogue livre avec ce qui est deja en base
// ─────────────────────────────────────────────────────────────────────────────

// Champs dont le CATALOGUE est proprietaire : les corriger dans une version future doit se
// propager aux installations existantes, sinon une faute de frappe ou un mauvais coefficient
// reste dans la base de tous les utilisateurs pour toujours.
const CHAMPS_SYNCHRONISES = [
  'nom', 'alias', 'categorie', 'materiel', 'lestable', 'unilateral',
  'incrementKg', 'bodyweightFactor', 'metriqueCardio', 'reposParDefautSec',
  // ⚠ 'icone' DOIT figurer ici. Les installations existantes portent en base des exercices ecrits
  //   avant que ce champ n'existe : sans synchronisation, ils resteraient sans icone A VIE, et
  //   c'est precisement l'utilisateur deja installe — celui qui a de l'historique — qui verrait un
  //   selecteur vide. Le champ est derive de l'id, donc jamais en desaccord avec l'identite.
  'icone'
];
// N'y figurent PAS, volontairement :
//   machineProfiles, notes, metriquePreferee : purement locaux a l'utilisateur et a sa salle.
//   archived / archivedAt : archiver un exercice est une decision de l'utilisateur.
//   createdAt, id, userModified : identite de l'enregistrement.
//   mode : traite a part ci-dessous, car il ne se change pas librement.

function copieProfonde(v) {
  if (v == null || typeof v !== 'object') return v;
  return Array.isArray(v) ? v.map(copieProfonde) : JSON.parse(JSON.stringify(v));
}

// Egalite suffisante pour des scalaires et des tableaux de chaines (le seul cas : `alias`).
function memeValeur(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Confronte le catalogue livre a ce qui existe deja en base.
 *
 * @param {Array<object>} existants exercices lus dans IndexedDB (catalogue ET personnalises)
 * @returns {{ crees: object[], misAJour: object[] }} objets prets a etre ecrits tels quels
 *
 * ⚠ Un exercice dont `userModified` vaut true n'est JAMAIS touche. C'est le point entier de ce
 *   drapeau : l'utilisateur qui a corrige « Pompes » a 0,75 parce que ses pompes sont declinees,
 *   ou qui a renomme un exercice au vocabulaire de sa salle, verrait sa correction annulee a
 *   chaque ouverture de l'application — un bug invisible, silencieux et repete a l'infini.
 *   Le catalogue livre PROPOSE ; l'utilisateur DISPOSE, et sa decision est definitive.
 *
 * ⚠ Ne retourne que ce qui a REELLEMENT change : renvoyer les 40 exercices a chaque demarrage
 *   ferait 40 ecritures IDB inutiles au moment precis ou l'ecran doit etre peint.
 */
export function synchroniser(existants) {
  const index = new Map();
  for (const e of Array.isArray(existants) ? existants : []) {
    if (e && typeof e.id === 'string') index.set(e.id, e);
  }

  const crees = [];
  const misAJour = [];
  const maintenant = Date.now();

  for (const reference of CATALOGUE) {
    const actuel = index.get(reference.id);

    // Nouveau dans cette version du catalogue : on l'installe tel quel.
    if (!actuel) {
      crees.push(copieProfonde(reference));
      continue;
    }

    if (actuel.userModified === true) continue;

    const fusionne = Object.assign({}, actuel);
    let change = false;

    for (const champ of CHAMPS_SYNCHRONISES) {
      if (!memeValeur(actuel[champ], reference[champ])) {
        fusionne[champ] = copieProfonde(reference[champ]);
        change = true;
      }
    }

    // Le mode est le seul champ dont le changement REINTERPRETE l'historique : passer un
    // exercice de 'machine' a 'charge' transforme des numeros de cran en kilos. On ne l'applique
    // que si TRANSITIONS_AUTORISEES le permet ; sinon on laisse la base intacte et le changement
    // devra passer par la creation d'un nouvel exercice, sous le controle de l'utilisateur.
    if (actuel.mode !== reference.mode && transitionPermise(actuel.mode, reference.mode)) {
      fusionne.mode = reference.mode;
      change = true;
    }

    if (!change) continue;
    fusionne.updatedAt = maintenant;
    misAJour.push(fusionne);
  }

  return { crees, misAJour };
}
