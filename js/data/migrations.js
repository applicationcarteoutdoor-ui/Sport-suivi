// data/migrations.js — pipeline de migration du modèle de données.
//
// MIGRATIONS est VIDE en v1. Le pipeline existe quand même dès le premier commit : écrire la
// première migration le jour où elle est nécessaire, c'est l'écrire sous pression, sur des
// données de production qu'on ne peut plus tester. Le chemin est donc parcouru — et vérifiable
// dans tests.html — avant d'avoir quoi que ce soit à migrer.
//
// Séquence, dans cet ordre strict :
//   1. lire meta.schemaVersion
//   2. égale à SCHEMA_VERSION          -> ne RIEN faire, zéro écriture
//   3. supérieure à SCHEMA_VERSION     -> REFUSER de démarrer, zéro écriture
//   4. sinon : sauvegarde -> up() en chaîne -> écriture -> RELECTURE ET VÉRIFICATION -> purge
//
// La sauvegarde vit dans IndexedDB et non en localStorage : localStorage est le premier stockage
// évincé sous pression mémoire, et il est plafonné à ~5 Mo — soit exactement ce qui cède quand
// il sert, sur la base la plus grosse, celle qu'on ne peut pas se permettre de perdre.

import { SCHEMA_VERSION, NOMS_STORES, META_ID, MAX_SEANCES_EN_COURS } from '../config.js';
import * as idb from '../lib/idb.js';

// Clé de l'unique copie de sauvegarde, dans le magasin `meta`.
// UNE SEULE copie : deux sauvegardes concurrentes, c'est la question « laquelle est la bonne ? »
// posée au pire moment.
export const CLE_SAUVEGARDE = 'backup:pre-migration';

/**
 * Migrations à appliquer en chaîne, triées par `de`.
 *
 * Contrat d'une entrée :
 *   { de: 1, vers: 2, description: '…', up(donnees) -> donnees }
 *
 * `up` est PURE : elle reçoit un instantané complet
 *   { exercices[], modeles[], seances[], lieux[], poids[], meta{} }
 * et renvoie le même objet transformé. Aucune I/O, aucun accès à la base, aucun Date.now()
 * qui rendrait le résultat non reproductible : c'est ce qui permet de la tester dans
 * tests.html sans navigateur, sans IndexedDB, et de la rejouer sur la sauvegarde.
 *
 * @type {Array<{de:number, vers:number, description:string, up:(d:any)=>any}>}
 */
export const MIGRATIONS = [];

// ─────────────────────────────────────────────────────────────────────────────
// 1 -> 2 — plusieurs séances en cours · statut d'abandon · routines utilisateur
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ PURE et SYNCHRONE : aucune I/O, aucun Date.now(), aucun ulid(). Rejouée deux fois sur les
//   mêmes données, elle rend le même résultat — c'est ce qui permet de la rejouer sur la
//   sauvegarde après un échec, et de la tester dans tests.html sans navigateur ni IndexedDB.
//
// ⚠ Elle ne MUTE RIEN de ce qu'elle reçoit : le pipeline conserve l'instantané `avant` pour
//   purgerAbsents() et pour la sauvegarde. Muter sur place ferait comparer un objet à lui-même
//   et rendrait la sauvegarde identique à l'état migré — c'est-à-dire inutile.
//
// Ce qu'elle fait, et rien de plus :
//   1. `meta.seancesEnCoursIds` — la collection remplace le champ unique `seanceActiveId`. Elle
//      est RECONSTRUITE par balayage des séances, jamais devinée : une base v1 peut très bien
//      contenir une séance restée « en-cours » que meta ne référençait pas (miroir chaud effacé).
//   2. `meta.seanceActiveId` — conservé, il désigne désormais « la dernière séance touchée ».
//      On le revalide : s'il pointe sur une séance close ou disparue, on prend la plus récente
//      des séances en cours, sinon null.
//   3. `Modele.origine` — 'utilisateur' pour les ids préfixés 'usr:', 'livre' sinon. Sans ce
//      champ, rien ne distinguerait une routine (supprimable) d'un modèle livré (archivable) ;
//      le déduire à chaque lecture marcherait tant que la convention de préfixe tient, et
//      cesserait de marcher au premier import venu d'un autre appareil.
//   4. `Seance.statut` — un statut absent ou inconnu est réparé : 'terminee' si la séance porte
//      un `endedAt`, 'en-cours' sinon. AUCUNE séance v1 ne devient 'abandonnee' : personne n'a
//      jamais pu abandonner avant que le bouton n'existe, et inventer des abandons rétroactifs
//      retirerait des séances réelles de toutes les courbes.

// Vocabulaires FIGES dans la migration, et non importes de schema.js : une migration decrit un
// passe. Si le schema courant gagne un statut demain, cette migration doit continuer a produire
// exactement ce qu'elle produisait le jour ou elle a ete ecrite.
const STATUTS_V2 = ['en-cours', 'terminee', 'abandonnee'];
const ORIGINES_V2 = ['livre', 'utilisateur'];

// Statut réparé d'une séance v1. Ne fabrique jamais 'abandonnee' (voir ci-dessus).
function statutRepare(s) {
  if (STATUTS_V2.indexOf(s.statut) !== -1) return s.statut;
  return typeof s.endedAt === 'number' ? 'terminee' : 'en-cours';
}

// Origine d'un modèle v1, déduite du préfixe d'id. La règle est volontairement IDENTIQUE à
// schema.origineModele() : la migration fige ce que la lecture déduisait, sans rien changer.
// (Elle est redupliquée ici plutôt qu'importée : une migration doit rester lisible et stable
// même si le schéma courant évolue à nouveau — elle décrit un passé, pas le présent.)
function origineDeduite(m) {
  const id = String((m && m.id) || '');
  if (id.startsWith('usr:')) return 'utilisateur';
  if (id.startsWith('tpl:') || id.startsWith('mod:')) return 'livre';
  return 'utilisateur';
}

MIGRATIONS.push({
  de: 1,
  vers: 2,
  description: 'Collection de séances en cours, statut « abandonnée », origine des modèles',
  up(donnees) {
    const d = donnees || {};

    const seances = (d.seances || []).map((s) => {
      if (!s) return s;
      const statut = statutRepare(s);
      return statut === s.statut ? Object.assign({}, s) : Object.assign({}, s, { statut });
    });

    const modeles = (d.modeles || []).map((m) => {
      if (!m) return m;
      const origine = ORIGINES_V2.indexOf(m.origine) !== -1 ? m.origine : origineDeduite(m);
      return Object.assign({}, m, { origine });
    });

    // Ordre déterministe : startedAt décroissant, id croissant en cas d'égalité stricte. Un tri
    // instable donnerait deux résultats différents pour la même base et casserait la relecture.
    const enCours = seances
      .filter((s) => s && s.statut === 'en-cours')
      .slice()
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0) || String(a.id).localeCompare(String(b.id)));

    // ⚠ Plafond applique ICI, dans la migration, et pas seulement a la creation d'une seance.
    //   Une base v1 peut avoir accumule des seances orphelines restees 'en-cours' pendant des
    //   mois : elles arriveraient en v2 au-dela de MAX_SEANCES_EN_COURS, c'est-a-dire dans un
    //   etat que le garde-fou est cense rendre impossible et que l'accueil n'est pas dimensionne
    //   pour afficher. Le tri au-dessus etant deterministe, la troncature l'est aussi : figer la
    //   decision dans la migration la rend testable sans navigateur.
    //   Les seances au-dela du plafond ne sont PAS supprimees : elles restent en base, simplement
    //   plus listees comme actives. Aucune donnee perdue.
    const idsEnCours = enCours.slice(0, MAX_SEANCES_EN_COURS).map((s) => s.id);

    // meta peut être null si le magasin est vide — mais appliquer() ne migre jamais une base
    // sans meta (versionActuelle vaut alors null, cas 'base-neuve'). Défensif malgré tout : une
    // migration qui suppose ses entrées est une migration qui échoue en production.
    const metaAvant = d.meta || {};
    const ancienActif = metaAvant.seanceActiveId || null;
    const actifValide = ancienActif && idsEnCours.indexOf(ancienActif) !== -1;

    const meta = Object.assign({}, metaAvant, {
      seancesEnCoursIds: idsEnCours,
      seanceActiveId: actifValide ? ancienActif : (idsEnCours[0] || null)
    });

    return Object.assign({}, d, { seances, modeles, meta });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Erreurs typées
// ─────────────────────────────────────────────────────────────────────────────

// Un code stable permet à boot.js de distinguer « base venue du futur » (l'utilisateur doit
// mettre l'application à jour) de « migration en échec » (la sauvegarde est intacte) sans
// analyser un message destiné à un humain.
function erreur(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture / écriture d'un instantané complet
// ─────────────────────────────────────────────────────────────────────────────

// Magasins de données pures, hors `meta` : `meta` est lu et écrit à part, car il porte le
// compteur de version lui-même et la sauvegarde.
const MAGASINS_DONNEES = NOMS_STORES.filter((n) => n !== 'meta');

async function lireInstantane(db) {
  const donnees = { meta: null };
  for (const nom of MAGASINS_DONNEES) {
    donnees[nom] = (await idb.getAll(db, nom)) || [];
  }
  donnees.meta = (await idb.get(db, 'meta', META_ID)) || null;
  return donnees;
}

async function ecrireInstantane(db, donnees) {
  for (const nom of MAGASINS_DONNEES) {
    const lot = Array.isArray(donnees[nom]) ? donnees[nom] : [];
    // putBatch écrit tout le magasin en UNE transaction. Les enregistrements supprimés par une
    // migration ne sont pas effacés ici : une migration qui supprime doit le faire explicitement
    // (voir purgerAbsents ci-dessous), pour qu'une suppression ne puisse jamais être accidentelle.
    await idb.putBatch(db, nom, lot);
  }
  if (donnees.meta) await idb.put(db, 'meta', donnees.meta);
}

// Supprime les enregistrements présents avant la migration et absents après. Séparé de
// l'écriture pour que la suppression soit un acte délibéré du pipeline et non un effet de bord
// d'un `up()` qui aurait oublié de recopier une entité.
async function purgerAbsents(db, avant, apres) {
  for (const nom of MAGASINS_DONNEES) {
    const cle = nom === 'poids' ? 'date' : 'id';
    const restants = new Set((apres[nom] || []).map((o) => o && o[cle]));
    for (const o of avant[nom] || []) {
      const k = o && o[cle];
      if (k != null && !restants.has(k)) await idb.del(db, nom, k);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sauvegarde
// ─────────────────────────────────────────────────────────────────────────────

/** Lit la sauvegarde de pré-migration, ou null. Sa seule présence signale une migration
 *  interrompue : elle n'est purgée qu'après une relecture réussie. */
export async function lireSauvegarde(db) {
  const enr = await idb.get(db, 'meta', CLE_SAUVEGARDE);
  return enr || null;
}

/**
 * Restaure la sauvegarde et la conserve.
 * ⚠ On ne purge PAS après restauration : tant que l'utilisateur n'a pas exporté ses données,
 * la seule copie connue-bonne doit survivre à une restauration elle-même interrompue.
 */
export async function restaurer(db) {
  const sauvegarde = await lireSauvegarde(db);
  if (!sauvegarde || !sauvegarde.donnees) {
    throw erreur('SAUVEGARDE_ABSENTE', 'Aucune sauvegarde de pré-migration à restaurer.');
  }
  await ecrireInstantane(db, sauvegarde.donnees);
  return { version: sauvegarde.schemaVersion, creeA: sauvegarde.creeA };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chaînage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit la chaîne de migrations de `de` vers `vers`.
 * Lève si un maillon manque : appliquer une chaîne trouée laisserait des données à moitié
 * converties, dans un état qu'aucune version du code ne sait plus lire.
 */
export function chaine(de, vers) {
  const suite = [];
  let courante = de;
  let garde = 0;
  while (courante < vers) {
    const etape = MIGRATIONS.find((m) => m.de === courante);
    if (!etape || typeof etape.up !== 'function') {
      throw erreur(
        'MIGRATION_MANQUANTE',
        `Aucune migration depuis la version ${courante} vers ${vers}. Base non migrée, aucune écriture effectuée.`
      );
    }
    if (etape.vers <= courante) {
      throw erreur('MIGRATION_INVALIDE', `La migration ${courante} → ${etape.vers} ne progresse pas.`);
    }
    suite.push(etape);
    courante = etape.vers;
    // Verrou anti-boucle : une table mal écrite (cycle 1→2→1) ferait tourner l'amorçage à
    // l'infini, écran blanc et batterie vidée, sans jamais atteindre l'écran de secours.
    if (++garde > 100) throw erreur('MIGRATION_INVALIDE', 'Chaîne de migrations cyclique.');
  }
  if (courante !== vers) {
    throw erreur('MIGRATION_MANQUANTE', `La chaîne s'arrête à la version ${courante} au lieu de ${vers}.`);
  }
  return suite;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vérification après écriture
// ─────────────────────────────────────────────────────────────────────────────

// Relit la base et compare ce qui vient d'être écrit. Une écriture IndexedDB peut échouer
// APRÈS la validation de la transaction (quota atteint, base évincée, disque plein) : sans
// relecture, on purgerait la sauvegarde en croyant la migration réussie.
async function verifier(db, attendu, versionCible) {
  const relu = await lireInstantane(db);

  if (!relu.meta || relu.meta.schemaVersion !== versionCible) {
    throw erreur(
      'RELECTURE_ECHOUEE',
      `Après migration, meta.schemaVersion vaut ${relu.meta ? relu.meta.schemaVersion : 'rien'} ` +
      `au lieu de ${versionCible}. Sauvegarde « ${CLE_SAUVEGARDE} » conservée.`
    );
  }

  for (const nom of MAGASINS_DONNEES) {
    const n = (attendu[nom] || []).length;
    const m = (relu[nom] || []).length;
    if (n !== m) {
      throw erreur(
        'RELECTURE_ECHOUEE',
        `Après migration, le magasin « ${nom} » contient ${m} enregistrements au lieu de ${n}. ` +
        `Sauvegarde « ${CLE_SAUVEGARDE} » conservée.`
      );
    }
  }
  return relu;
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applique les migrations nécessaires.
 *
 * @param {IDBDatabase} db
 * @param {number|null|undefined} versionActuelle valeur de meta.schemaVersion, ou null/undefined
 *        si le magasin meta est vide (base neuve : store.initialiser l'écrira).
 * @returns {Promise<{applique:boolean, de:number|null, vers:number, raison?:string, etapes?:string[]}>}
 * @throws {Error} avec `.code` : 'VERSION_FUTURE' | 'MIGRATION_MANQUANTE' | 'MIGRATION_INVALIDE'
 *         | 'RELECTURE_ECHOUEE'. Dans les trois premiers cas, AUCUNE écriture n'a eu lieu.
 */
export async function appliquer(db, versionActuelle) {
  // Base neuve : aucun enregistrement meta, donc rien à migrer et surtout rien à écrire ici.
  // C'est store.initialiser qui crée meta, une fois, avec SCHEMA_VERSION.
  if (versionActuelle == null) {
    return { applique: false, de: null, vers: SCHEMA_VERSION, raison: 'base-neuve' };
  }

  if (typeof versionActuelle !== 'number' || !Number.isFinite(versionActuelle)) {
    throw erreur(
      'VERSION_INVALIDE',
      `meta.schemaVersion vaut « ${versionActuelle} », ce qui n'est pas un numéro de version. ` +
      'Aucune écriture effectuée.'
    );
  }

  if (versionActuelle === SCHEMA_VERSION) {
    return { applique: false, de: versionActuelle, vers: SCHEMA_VERSION, raison: 'a-jour' };
  }

  // ⚠ Base écrite par une version PLUS RÉCENTE de l'application (l'utilisateur a ouvert
  // l'app à jour sur un autre navigateur puis importé, ou un ancien onglet est resté ouvert).
  // On refuse de démarrer plutôt que de laisser du code v1 réécrire des données v2 avec ses
  // propres règles : une rétro-migration silencieuse détruit ce qu'elle ne comprend pas.
  if (versionActuelle > SCHEMA_VERSION) {
    throw erreur(
      'VERSION_FUTURE',
      `Ces données ont été enregistrées par une version plus récente de Carnet Muscu ` +
      `(modèle ${versionActuelle}, cette version lit le modèle ${SCHEMA_VERSION}). ` +
      'Mettez l\'application à jour. Aucune donnée n\'a été modifiée.'
    );
  }

  // La chaîne est validée AVANT toute écriture, sauvegarde comprise : refuser tôt coûte un
  // message d'erreur, refuser tard coûte une base à moitié migrée.
  const etapes = chaine(versionActuelle, SCHEMA_VERSION);

  const avant = await lireInstantane(db);

  // Sauvegarde préalable. Écrite AVANT le premier `up()`, purgée APRÈS la relecture.
  await idb.put(db, 'meta', {
    id: CLE_SAUVEGARDE,
    schemaVersion: versionActuelle,
    creeA: Date.now(),
    donnees: avant
  });

  // Les `up()` sont purs : on les enchaîne en mémoire, sans toucher la base. Si l'un lève,
  // rien n'a été écrit hors la sauvegarde, et l'état sur disque est encore l'état d'origine.
  let apres = avant;
  for (const etape of etapes) {
    apres = etape.up(apres);
    if (!apres || typeof apres !== 'object') {
      throw erreur(
        'MIGRATION_INVALIDE',
        `La migration ${etape.de} → ${etape.vers} n'a rien renvoyé. Base inchangée, sauvegarde conservée.`
      );
    }
  }

  // Le compteur de version est écrit dans le MÊME instantané que les données : c'est un seul
  // et même fait, et deux écritures séparées laisseraient une fenêtre où la base est migrée
  // mais s'annonce encore à l'ancienne version.
  apres.meta = Object.assign({}, apres.meta, { id: META_ID, schemaVersion: SCHEMA_VERSION });

  await ecrireInstantane(db, apres);
  await purgerAbsents(db, avant, apres);

  await verifier(db, apres, SCHEMA_VERSION);

  // La sauvegarde n'est purgée qu'ici : elle cède exactement quand elle a fini de servir.
  await idb.del(db, 'meta', CLE_SAUVEGARDE);

  return {
    applique: true,
    de: versionActuelle,
    vers: SCHEMA_VERSION,
    etapes: etapes.map((e) => `${e.de} → ${e.vers} : ${e.description || 'sans description'}`)
  };
}
