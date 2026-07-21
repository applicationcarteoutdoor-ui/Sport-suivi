// config.js — constantes globales du projet.
// Aucune dependance : ce fichier est la racine de la chaine lib <- data <- domain <- ui <- views.

// Prefixe unique de toutes les cles localStorage. L'origine <user>.github.io est partagee par
// TOUS les depots du compte : sans prefixe, deux applications se marcheraient dessus.
export const NS = 'muscu';

// Compteur UNIQUE de version du modele de donnees, persiste dans meta.schemaVersion.
// Les migrations (data/migrations.js) se comparent a lui, et a lui seul.
//
// v2 (chantier v2) : trois evolutions du modele, toutes decrites par la migration 1 -> 2 :
//   · plusieurs seances EN COURS simultanement  -> meta.seancesEnCoursIds
//   · statut de seance 'abandonnee'             -> STATUTS_SEANCE passe de 2 a 3 valeurs
//   · routines utilisateur                      -> Modele.origine ('livre' | 'utilisateur')
export const SCHEMA_VERSION = 2;

export const DB_NAME = 'muscu-carnet';

// ⚠ FIGEE A VIE. Les 6 magasins sont tous crees au premier commit, y compris ceux qui ne
// serviront que plus tard : aucune montee de version ne sera jamais necessaire, donc l'evenement
// `onblocked` (onglet fige tenant l'ancienne version, insoluble sur mobile) devient
// structurellement impossible. Faire evoluer les DONNEES passe par SCHEMA_VERSION, jamais par ici.
export const DB_VERSION = 1;

// Version applicative. Doit rester alignee sur le champ `version` de version.json a chaque
// deploiement : c'est la comparaison entre les deux qui declenche le bandeau de mise a jour.
export const APP_VERSION = '2026-07-20-06';

// Les 6 magasins IndexedDB, figes au premier commit.
// `cle` = keyPath ; `index` = index secondaires a creer dans onUpgrade.
export const STORES = {
  exercices: { nom: 'exercices', cle: 'id', index: [] },
  modeles:   { nom: 'modeles',   cle: 'id', index: [] },
  // L'index 'date' porte des cles 'YYYY-MM-DD' LOCALES : elles se comparent et se trient comme
  // des chaines, ce qui suffit a toutes les plages de l'application.
  seances:   { nom: 'seances',   cle: 'id', index: [{ nom: 'date', chemin: 'date', unique: false }] },
  lieux:     { nom: 'lieux',     cle: 'id', index: [] },
  // Un seul pesage par jour : la date EST la cle primaire, une re-saisie ecrase.
  poids:     { nom: 'poids',     cle: 'date', index: [] },
  meta:      { nom: 'meta',      cle: 'id', index: [] }
};

// Liste ordonnee des magasins, pratique pour onUpgrade et pour l'export.
export const NOMS_STORES = Object.values(STORES).map((s) => s.nom);

// Identifiant de l'unique enregistrement du magasin meta.
export const META_ID = 'meta';

// Cles localStorage. Toutes prefixees par NS.
export const CLES = {
  // Cache de reprise, JAMAIS la source de verite : peut etre efface sans perte de donnees.
  hot: NS + ':hot',
  prefs: NS + ':prefs'
};

// Preferences par defaut, fusionnees avec ce qui est lu en localStorage (data/prefs.js).
export const PREFS_DEFAUT = {
  theme: 'auto',
  wakeLockRepos: false, // opt-in : consomme de la batterie et chauffe le telephone
  son: true,
  vibration: true,
  reposParDefautSec: 120,
  dernierModeleId: null,
  plageCourbe: '3m',
  clavierSysteme: false // repli obligatoire pour qui prefere le clavier natif
};

// Format de l'enveloppe d'export. Verifie a l'import avant toute ecriture.
export const FORMAT_EXPORT = 'muscu-export';

// Rappel d'export au-dela de ce delai sans sauvegarde.
export const JOURS_AVANT_RAPPEL_EXPORT = 30;

// ─────────────────────────────────────────────────────────────────────────────
// v2 — plusieurs seances en cours
// ─────────────────────────────────────────────────────────────────────────────

// Plafond du nombre de seances simultanement « en-cours ».
// Ce n'est pas une limite technique mais un garde-fou : au-dela, l'ecran d'accueil n'est plus
// lisible et les seances oubliees s'accumulent en polluant la date de « derniere fois ». Le
// store refuse d'en demarrer une de plus et invite a terminer ou abandonner.
export const MAX_SEANCES_EN_COURS = 5;

// Nombre de seances reflechies dans le miroir chaud localStorage (data/hot.js).
//
// ⚠ CHOIX DOCUMENTE : 1, c'est-a-dire la seule seance ACTIVE.
//   Le miroir est plafonne a ~5 Mo pour TOUTE l'origine <user>.github.io, partagee avec les
//   autres depots du compte. Une seance complete pese quelques dizaines de kilo-octets ; en
//   miroiter cinq multiplierait par cinq le cout de CHAQUE ecriture — or ce module ecrit a
//   chaque serie validee, sur le chemin le plus chaud de l'application. Le miroir reste ce
//   qu'il est : un CACHE DE REPRISE de la seance qu'on a sous les yeux, jamais la source de
//   verite. Les autres seances en cours sont durables dans IndexedDB et referencees par
//   meta.seancesEnCoursIds : elles se retrouvent au demarrage sans le miroir.
export const MAX_SEANCES_MIROIR = 1;
