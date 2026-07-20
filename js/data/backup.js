// data/backup.js — export et import. LE filet de securite de l'application.
//
// Regle unique dont tout le reste decoule : UN EXPORT NE PEUT PAS ECHOUER SILENCIEUSEMENT.
// Trois ans de seances tiennent dans un IndexedDB que le navigateur a le droit d'evincer sans
// prevenir ; l'export est la seule copie que l'utilisateur controle. Un bouton « Exporter » qui
// ne fait visiblement rien est donc un defaut plus grave qu'un plantage franc : l'utilisateur
// croit etre sauvegarde et ne l'est pas.
//
// Symetriquement, l'import DEGRADE plutot qu'il ne refuse (un exerciceId inconnu fabrique un
// exercice fantome archive), avec UNE seule exception, non negociable : un fichier dont la
// schemaVersion est SUPERIEURE a la notre est refuse sans qu'une seule ecriture ait lieu.
// Ecrire des donnees qu'on ne sait pas interpreter detruirait celles qui sont deja la.

import {
  DB_NAME, DB_VERSION, STORES, FORMAT_EXPORT, SCHEMA_VERSION, APP_VERSION
} from '../config.js';
import { ouvrir, getAll, putBatch } from '../lib/idb.js';
import { h, on, vider } from '../lib/dom.js';
import { dayKey } from '../lib/dates.js';
import { emit } from '../lib/bus.js';
import { valider, nouvelExercice, MODES } from './schema.js';
import * as prefs from './prefs.js';

// Magasins effectivement transportes par l'enveloppe. `meta` en est ABSENT volontairement :
// il ne contient que schemaVersion (redonde dans l'enveloppe) et lastPerf, qui est le seul
// derive persiste de l'application. Reimporter un derive, c'est importer une incoherence
// possible ; il se recalcule en quelques millisecondes par « Recalculer les derives ».
const MAGASINS_EXPORTES = ['exercices', 'lieux', 'modeles', 'seances', 'poids'];

// Correspondance collection de l'enveloppe -> type attendu par schema.valider().
const TYPES = {
  exercices: 'exercice',
  lieux: 'lieu',
  modeles: 'modele',
  seances: 'seance',
  poids: 'poids'
};

// ─────────────────────────────────────────────────────────────────────────────
// Acces a la base
// ─────────────────────────────────────────────────────────────────────────────

let baseInjectee = null;
let basePromise = null;

/**
 * Injecte la connexion deja ouverte par boot.js / store.js.
 * Optionnel : sans elle, ce module ouvre sa propre connexion (DB_VERSION est figee a vie, donc
 * deux connexions de meme version coexistent sans jamais declencher `onblocked`).
 */
export function utiliserBase(db) {
  baseInjectee = db || null;
}

/**
 * Cree les magasins manquants, derives de config.STORES.
 * ⚠ Indispensable meme si store.js fait la meme chose : si backup.js ouvrait la base SANS
 *   onUpgrade sur un profil vierge, IndexedDB creerait une base v1 VIDE. DB_VERSION etant figee
 *   a vie, plus aucune montee de version ne pourrait ensuite y ajouter les magasins : la base
 *   serait definitivement inutilisable. La liste vient de config.STORES et non d'une copie
 *   locale, pour qu'elle ne puisse pas diverger de celle de store.js.
 */
function creerMagasins(db) {
  for (const def of Object.values(STORES)) {
    if (db.objectStoreNames.contains(def.nom)) continue;
    const magasin = db.createObjectStore(def.nom, { keyPath: def.cle });
    for (const idx of def.index) magasin.createIndex(idx.nom, idx.chemin, { unique: idx.unique });
  }
}

function base() {
  if (baseInjectee) return Promise.resolve(baseInjectee);
  if (!basePromise) {
    basePromise = ouvrir(DB_NAME, DB_VERSION, creerMagasins, { timeoutMs: 5000 })
      .catch((err) => { basePromise = null; throw err; });
  }
  return basePromise;
}

/**
 * Vide un magasin puis y ecrit un lot, dans UNE seule transaction.
 * lib/idb.js n'expose pas de `clear` ; supprimer cle par cle ouvrirait une transaction par
 * enregistrement (des milliers pour trois ans de seances) et laisserait la base a moitie
 * remplacee si l'une d'elles echouait. Ici, tout passe ou rien ne passe.
 * ⚠ Aucun await non-IDB entre le clear et les put : une transaction IndexedDB se referme des
 *   que la pile d'appels se vide.
 */
function viderEtEcrire(db, magasin, valeurs) {
  const lot = Array.from(valeurs || []);
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(magasin, 'readwrite'); } catch (err) { reject(err); return; }
    try {
      const s = tx.objectStore(magasin);
      s.clear();
      for (const v of lot) s.put(v);
    } catch (err) {
      try { tx.abort(); } catch (_) { /* deja avortee */ }
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(lot.length);
    tx.onerror = () => reject(tx.error || new Error('Remplacement de « ' + magasin + ' » en echec.'));
    tx.onabort = () => reject(tx.error || new Error('Remplacement de « ' + magasin + ' » avorte.'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit l'enveloppe d'export complete.
 * @returns {Promise<{ blob: Blob, nom: string, texte: string, enveloppe: Object }>}
 */
export async function construireExport() {
  const db = await base();

  const collections = await Promise.all(
    MAGASINS_EXPORTES.map((nom) => getAll(db, nom).catch(() => []))
  );

  const data = {};
  MAGASINS_EXPORTES.forEach((nom, i) => { data[nom] = collections[i] || []; });
  data.prefs = prefs.lire();

  const enveloppe = {
    format: FORMAT_EXPORT,
    // ⚠ La schemaVersion de l'ENVELOPPE, pas celle du fichier lu : c'est elle qui permettra a une
    //   version future de savoir comment relire ce fichier, et a une version ancienne de refuser.
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    data
  };

  // Indente : un export est aussi le dernier recours de lecture a la main quand plus rien ne
  // fonctionne. Le surcout de taille est sans importance face a cet usage.
  const texte = JSON.stringify(enveloppe, null, 2);
  // dayKey est LOCALE : un export lance a 23 h porte la date du jour vecu, pas celle d'UTC.
  const nom = 'Sport-suivi-' + dayKey(new Date()) + '.json';
  const blob = new Blob([texte], { type: 'application/json' });

  return { blob, nom, texte, enveloppe };
}

/**
 * Detection iOS en mode « application installee ».
 * ⚠ Duplique volontairement une bribe de ui/install.js : data/ ne peut pas importer ui/ sans
 *   inverser la direction des dependances. Le croisement maxTouchPoints est indispensable —
 *   iPadOS s'annonce comme un Mac dans son userAgent depuis iPadOS 13.
 */
function estIOSInstallee() {
  const nav = globalThis.navigator;
  if (!nav) return false;
  const ua = nav.userAgent || '';
  const estIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true ||
    (globalThis.matchMedia && matchMedia('(display-mode: standalone)').matches);
  return estIOS && standalone;
}

/** Trace de l'export. Ecrite UNIQUEMENT quand un canal a REELLEMENT abouti. */
function marquerExport() {
  prefs.ecrire({ dernierExportAt: Date.now() });
}

/**
 * Exporte les donnees. Trois canaux, essayes DANS CET ORDRE.
 *
 * @param {{ conteneurRecours?: Element }} [options] conteneur ou monter la zone de texte de
 *        dernier recours. Absent : l'evenement bus 'export:recours' est emis avec le texte, a
 *        charge de la vue reglages de le presenter.
 * @returns {Promise<'partage'|'telechargement'|'texte'|'annule'>}
 */
export async function exporter(options = {}) {
  const { blob, nom, texte } = await construireExport();

  // ── Canal 1 : navigator.share avec fichier ────────────────────────────────
  // ⚠ SEUL canal fiable dans une PWA iOS installee. C'est aussi le meilleur sur Android : il
  //   laisse choisir la destination (Fichiers, Drive, mail) au lieu d'enfouir le fichier dans
  //   un dossier de telechargement que l'utilisateur ne retrouvera pas.
  try {
    const nav = globalThis.navigator;
    if (nav && typeof File === 'function' && typeof nav.share === 'function' &&
        typeof nav.canShare === 'function') {
      const fichier = new File([blob], nom, { type: 'application/json' });
      // ⚠ canShare({files}) et non canShare() : Android a longtemps annonce le partage tout en
      //   refusant les fichiers. Sans ce test, share() rejette et le canal 2 ne serait tente
      //   qu'apres une feuille de partage deja apparue puis disparue.
      if (nav.canShare({ files: [fichier] })) {
        try {
          await nav.share({ files: [fichier], title: nom });
          marquerExport();
          return 'partage';
        } catch (err) {
          // L'utilisateur a ferme la feuille : ce n'est PAS un echec, et surtout il ne faut pas
          // enchainer sur un telechargement qu'il n'a pas demande.
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return 'annule';
          // Tout autre rejet (partage indisponible, fichier refuse) : on tente le canal suivant.
        }
      }
    }
  } catch (_) { /* API de partage cassee : canal suivant */ }

  // ── Canal 2 : lien <a download> ───────────────────────────────────────────
  // ⚠ On ne l'essaie PAS dans une PWA iOS installee : il n'y a ni gestionnaire de
  //   telechargement ni onglet vers lequel basculer, le clic ne produit STRICTEMENT RIEN et
  //   nous ecririons un dernierExportAt mensonger. Mieux vaut afficher la zone de texte.
  if (!estIOSInstallee()) {
    try {
      const url = URL.createObjectURL(blob);
      const lien = h('a', { href: url, download: nom, rel: 'noopener' });
      // Le lien doit etre DANS le document : Firefox ignore le clic sur un noeud detache.
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      // ⚠ Revocation differee : revoquer immediatement annule le telechargement en cours sur
      //   plusieurs WebView Android. 60 s couvrent largement l'ecriture d'un fichier local.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* deja revoquee */ } }, 60000);
      marquerExport();
      return 'telechargement';
    } catch (_) { /* createObjectURL indisponible : canal suivant */ }
  }

  // ── Canal 3 : zone de texte selectionnable ────────────────────────────────
  // Recours VISIBLE : l'utilisateur voit ses donnees, peut les copier et les coller dans une
  // note ou un mail. Lent et rustique, mais jamais silencieux.
  // dernierExportAt n'est PAS ecrit : rien ne prouve que la copie a eu lieu.
  if (options.conteneurRecours) {
    monterRecoursTexte(options.conteneurRecours, { texte, nom });
  } else {
    emit('export:recours', { texte, nom });
  }
  return 'texte';
}

/**
 * Monte la zone de texte de dernier recours. Zero innerHTML, comme partout ailleurs.
 * @param {Element} conteneur
 * @param {{ texte: string, nom: string }} charge
 * @returns {{ detruire: () => void }}
 */
export function monterRecoursTexte(conteneur, { texte, nom }) {
  vider(conteneur);

  const zone = h('textarea', {
    class: 'zone-texte-export',
    readonly: true,
    spellcheck: 'false',
    rows: 8,
    'aria-label': 'Contenu de la sauvegarde ' + nom,
    value: texte
  });

  const etat = h('p', { class: 'export-recours-etat', role: 'status' }, '');
  // ⚠ `bouton-primaire` et non `bouton--primaire` : c'est la classe REELLEMENT definie dans
  //   css/components.css. Ce bouton est le dernier recours du filet de securite (iOS installe,
  //   partage et telechargement indisponibles) : il ne peut pas se permettre d'etre invisible.
  const bouton = h('button', { type: 'button', class: 'bouton bouton-primaire' }, 'Copier');

  const offClic = on(bouton, 'click', async () => {
    let copie = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(texte);
        copie = true;
      }
    } catch (_) { /* refus de permission ou contexte non securise : repli ci-dessous */ }

    if (!copie) {
      // ⚠ Repli obligatoire : navigator.clipboard n'existe qu'en contexte securise, et le
      //   presse-papiers peut etre refuse hors geste utilisateur direct. La selection manuelle
      //   reste toujours possible, c'est le sens du message.
      try {
        zone.focus();
        zone.select();
        // setSelectionRange : sur iOS, select() seul ne selectionne pas un textarea readonly.
        zone.setSelectionRange(0, texte.length);
        copie = typeof document.execCommand === 'function' && document.execCommand('copy');
      } catch (_) { copie = false; }
    }

    etat.textContent = copie
      ? 'Sauvegarde copiee. Colle-la dans une note ou un mail, puis conserve-la.'
      : 'Copie automatique impossible. Selectionne tout le texte ci-dessus et copie-le a la main.';
  });

  conteneur.appendChild(h('p', { class: 'export-recours-intro' },
    'Le partage et le telechargement ne sont pas disponibles ici. Voici ta sauvegarde « ' + nom +
    ' » : copie-la et conserve-la hors de ce telephone.'));
  conteneur.appendChild(zone);
  conteneur.appendChild(bouton);
  conteneur.appendChild(etat);

  return {
    detruire() {
      offClic();
      vider(conteneur);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import — analyse
// ─────────────────────────────────────────────────────────────────────────────

function tableau(v) {
  return Array.isArray(v) ? v : [];
}

function refus(ligne) {
  return {
    ok: false,
    rapport: { lignes: [ligne], erreurs: [ligne], avertissements: [], compte: {}, fantomes: [] },
    donnees: null
  };
}

/**
 * Analyse un fichier d'export SANS RIEN ECRIRE.
 * Produit un rapport lisible destine a etre affiche AVANT que l'utilisateur ne confirme :
 * remplacer trois ans de seances sans savoir ce que contient le fichier est irrattrapable.
 *
 * @param {string} texte contenu du fichier
 * @returns {{ ok: boolean, rapport: Object, donnees: Object|null }}
 */
export function analyserImport(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') {
    return refus('Fichier vide : rien a importer.');
  }

  let brut;
  try {
    brut = JSON.parse(texte);
  } catch (err) {
    return refus('Fichier illisible : ce n\'est pas du JSON valide (' + (err.message || 'erreur') + ').');
  }

  if (!brut || typeof brut !== 'object') {
    return refus('Fichier illisible : le contenu n\'est pas un objet.');
  }
  if (brut.format !== FORMAT_EXPORT) {
    return refus('Ce fichier n\'est pas une sauvegarde Carnet Muscu (format « ' +
      (brut.format || 'absent') + ' », attendu « ' + FORMAT_EXPORT + ' »).');
  }

  const versionFichier = typeof brut.schemaVersion === 'number' ? brut.schemaVersion : null;
  if (versionFichier === null) {
    return refus('Sauvegarde sans numero de version de schema : impossible de savoir comment la lire.');
  }
  if (versionFichier > SCHEMA_VERSION) {
    // ⚠ REFUS EXPLICITE, AUCUNE ECRITURE. Le fichier vient d'une version plus recente de
    //   l'application : nous ne connaissons ni ses champs ni leur signification. En importer une
    //   partie « au mieux » ecraserait des donnees valides par une interpretation fausse.
    return refus('Sauvegarde creee par une version plus recente de l\'application (schema ' +
      versionFichier + ', cette version lit le schema ' + SCHEMA_VERSION +
      '). Mets l\'application a jour, puis reessaie. Aucune donnee n\'a ete modifiee.');
  }

  const data = (brut.data && typeof brut.data === 'object') ? brut.data : {};
  const lignes = [];
  const avertissements = [];
  const compte = {};
  const donnees = { exercices: [], lieux: [], modeles: [], seances: [], poids: [], prefs: null };

  // Validation collection par collection. Un enregistrement invalide est ECARTE et signale ;
  // il ne fait jamais tomber tout le fichier — c'est le principe « degrader, jamais refuser ».
  for (const nom of MAGASINS_EXPORTES) {
    const entrants = tableau(data[nom]);
    let retenus = 0;
    for (const item of entrants) {
      const v = valider(item, TYPES[nom]);
      if (v.ok) { donnees[nom].push(item); retenus++; continue; }
      avertissements.push(nom + ' : 1 enregistrement ecarte (' + v.erreurs.join(', ') + ')');
    }
    compte[nom] = retenus;
    if (entrants.length !== retenus) compte[nom + 'Ecartes'] = entrants.length - retenus;
  }

  if (data.prefs && typeof data.prefs === 'object') donnees.prefs = data.prefs;

  // Comptage des series et reperage des exercices manquants DANS LE FICHIER. Les exercices
  // presents localement mais absents du fichier ne sont pas des manquants : seule
  // appliquerImport, qui voit la base, peut trancher. Ici on n'annonce qu'un maximum.
  const idsExercices = new Set(donnees.exercices.map((e) => e.id));
  const manquants = new Map();
  let series = 0;
  for (const seance of donnees.seances) {
    for (const entree of tableau(seance.entrees)) {
      series += tableau(entree.series).length;
      if (!entree.exerciceId || idsExercices.has(entree.exerciceId)) continue;
      if (!manquants.has(entree.exerciceId)) {
        manquants.set(entree.exerciceId, entree.nomAffiche || entree.exerciceId);
      }
    }
  }
  compte.series = series;

  const fantomes = Array.from(manquants, ([id, nom]) => ({ id, nom }));

  // ── Rapport lisible ───────────────────────────────────────────────────────
  const dateExport = typeof brut.exportedAt === 'number'
    ? new Date(brut.exportedAt).toLocaleString('fr-FR')
    : 'date inconnue';
  lignes.push('Sauvegarde du ' + dateExport +
    (brut.appVersion ? ' (application ' + brut.appVersion + ')' : ''));
  lignes.push(compte.seances + ' seance(s), ' + series + ' serie(s)');
  lignes.push(compte.exercices + ' exercice(s), ' + compte.modeles + ' modele(s), ' +
    compte.lieux + ' lieu(x), ' + compte.poids + ' pesee(s)');
  lignes.push(donnees.prefs ? 'Preferences incluses' : 'Preferences absentes du fichier');

  if (versionFichier < SCHEMA_VERSION) {
    lignes.push('Schema plus ancien (' + versionFichier + ') : les donnees seront migrees au ' +
      'prochain demarrage.');
  }
  if (fantomes.length) {
    lignes.push(fantomes.length + ' exercice(s) reference(s) par des seances sont absents du ' +
      'fichier. S\'ils manquent aussi ici, ils seront recrees archives, sous leur nom d\'origine, ' +
      'pour que l\'historique reste lisible.');
  }
  for (const a of avertissements) lignes.push('Ecarte — ' + a);

  return {
    ok: true,
    rapport: { lignes, erreurs: [], avertissements, compte, fantomes, schemaVersion: versionFichier },
    donnees
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import — application
// ─────────────────────────────────────────────────────────────────────────────

/** Horodatage de comparaison pour la fusion. Degrade proprement quand updatedAt manque. */
function horodatage(o) {
  if (!o) return -1;
  if (typeof o.updatedAt === 'number') return o.updatedAt;
  // Un enregistrement sans updatedAt vient d'un export tres ancien ou bricole a la main :
  // on lui donne le rang le plus bas possible pour qu'il ne puisse jamais ecraser un existant
  // dont on connait, lui, la date.
  if (typeof o.createdAt === 'number') return o.createdAt;
  if (typeof o.startedAt === 'number') return o.startedAt;
  return 0;
}

/** Fusionne deux collections par cle : le plus recent gagne. */
function fusionner(existants, entrants, cle) {
  const parCle = new Map();
  for (const e of existants) parCle.set(e[cle], e);
  for (const n of entrants) {
    const actuel = parCle.get(n[cle]);
    // > et non >= : a egalite parfaite d'horodatage, l'existant est conserve. Reimporter deux
    // fois le meme fichier ne doit produire aucune ecriture, donc aucun risque.
    if (!actuel || horodatage(n) > horodatage(actuel)) parCle.set(n[cle], n);
  }
  return Array.from(parCle.values());
}

/**
 * Fabrique un exercice FANTOME pour un id reference mais introuvable.
 * ⚠ Archive d'emblee : il ne doit apparaitre ni dans le selecteur d'exercices ni dans les
 *   suggestions, seulement dans l'historique qui le reference. Le mode est repris du
 *   `modeUtilise` GELE sur l'entree de seance : c'est la seule source fiable qui subsiste, et
 *   elle est exacte par construction, puisqu'elle a ete copiee le jour de la seance.
 */
function fabriquerFantome(id, entree) {
  const mode = entree && MODES[entree.modeUtilise] ? entree.modeUtilise : 'charge';
  const maintenant = Date.now();
  return nouvelExercice({
    id,
    nom: (entree && entree.nomAffiche) || 'Exercice inconnu',
    categorie: mode === 'cardio' ? 'cardio' : 'corps-entier',
    mode,
    lestable: !!(entree && entree.lestableUtilise),
    incrementKg: (entree && entree.incrementKgUtilise) || undefined,
    bodyweightFactor: (entree && entree.bodyweightFactorUtilise) || undefined,
    // userModified : interdit a la synchronisation du catalogue livre de le rehabiliter.
    userModified: true,
    archived: true,
    archivedAt: maintenant,
    notes: 'Recree automatiquement a l\'import : cet exercice etait reference par des seances ' +
      'mais absent de la sauvegarde.'
  });
}

/**
 * Applique un import prealablement analyse.
 *
 * @param {Object} donnees champ `donnees` renvoye par analyserImport()
 * @param {'remplacer'|'fusionner'} strategie
 * @returns {Promise<Object>} bilan { strategie, ecrits: {...}, fantomes: [...] }
 */
export async function appliquerImport(donnees, strategie = 'fusionner') {
  if (!donnees || typeof donnees !== 'object') {
    throw new Error('Import impossible : analyse absente. Appelle analyserImport() d\'abord.');
  }
  if (strategie !== 'remplacer' && strategie !== 'fusionner') {
    throw new Error('Strategie d\'import inconnue : ' + strategie);
  }

  const db = await base();

  const entrants = {
    exercices: tableau(donnees.exercices),
    lieux: tableau(donnees.lieux),
    modeles: tableau(donnees.modeles),
    seances: tableau(donnees.seances),
    poids: tableau(donnees.poids)
  };

  // Etat actuel, lu AVANT toute ecriture : la fusion en a besoin, et le calcul des fantomes
  // aussi (un exercice absent du fichier mais present ici n'est pas un fantome).
  const existants = {};
  for (const nom of MAGASINS_EXPORTES) {
    existants[nom] = strategie === 'fusionner' ? await getAll(db, nom).catch(() => []) : [];
  }

  // ── Exercices fantomes ────────────────────────────────────────────────────
  const connus = new Set();
  for (const e of entrants.exercices) connus.add(e.id);
  if (strategie === 'fusionner') for (const e of existants.exercices) connus.add(e.id);

  const fantomes = [];
  for (const seance of entrants.seances) {
    for (const entree of tableau(seance.entrees)) {
      const id = entree && entree.exerciceId;
      if (!id || connus.has(id)) continue;
      connus.add(id);
      fantomes.push(fabriquerFantome(id, entree));
    }
  }
  if (fantomes.length) entrants.exercices = entrants.exercices.concat(fantomes);

  // ── Ecriture ──────────────────────────────────────────────────────────────
  const CLE = { exercices: 'id', lieux: 'id', modeles: 'id', seances: 'id', poids: 'date' };
  const ecrits = {};

  for (const nom of MAGASINS_EXPORTES) {
    if (strategie === 'remplacer') {
      // Une transaction par magasin : IndexedDB ne permet pas de garantir l'atomicite entre
      // magasins sans une transaction unique, et une transaction unique sur 5 magasins et des
      // milliers d'enregistrements se ferme prematurement. Le pire cas — echec entre deux
      // magasins — reste rattrapable : la sauvegarde d'origine est toujours dans le fichier.
      ecrits[nom] = await viderEtEcrire(db, nom, entrants[nom]);
    } else {
      const fusionnes = fusionner(existants[nom], entrants[nom], CLE[nom]);
      await putBatch(db, nom, fusionnes);
      ecrits[nom] = fusionnes.length;
    }
  }

  // ── Preferences ───────────────────────────────────────────────────────────
  // Appliquees UNIQUEMENT en « remplacer ». En fusion, les preferences de cet appareil-ci sont
  // les bonnes : importer le theme et le repli clavier d'un autre telephone n'a aucun sens, et
  // ecraserait un reglage que l'utilisateur vient peut-etre de faire.
  if (strategie === 'remplacer' && donnees.prefs) {
    prefs.ecrire(donnees.prefs);
  }

  // Seul canal d'invalidation : store.js recharge ses caches, les vues se redessinent.
  // ⚠ meta.lastPerf n'a PAS ete importe (aucun derive dans l'enveloppe) : il est desormais
  //   faux et doit etre recalcule. C'est a l'abonne de declencher recalculerDerives().
  emit('donnees:importees', { strategie, ecrits, fantomes: fantomes.length });

  return { strategie, ecrits, fantomes: fantomes.map((f) => ({ id: f.id, nom: f.nom })) };
}
