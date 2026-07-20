// js/boot.js — amorcage de l'application.
//
// L'ORDRE DE CE FICHIER EST LE FICHIER. Chaque inversion a coute un defaut fatal dans les
// architectures evaluees, et les trois plus chers sont :
//   · enregistrer le service worker APRES l'ouverture d'IndexedDB : un IDB mort empeche alors
//     l'enregistrement, donc plus AUCUNE mise a jour corrective ne peut atteindre l'appareil.
//     L'application est morte sans reparation a distance ;
//   · demarrer le routeur APRES le chargement de l'historique : plusieurs megaoctets de seances
//     lus avant le premier pixel, sur un telephone en salle ;
//   · ne pas envelopper la chaine dans un try/catch : la moindre exception donne un ecran blanc,
//     et un ecran blanc rend l'EXPORT inaccessible — donc les donnees irrecuperables.
//
// Regle transversale : rien ici ne doit pouvoir empecher l'ecran de secours d'apparaitre.

import { DB_NAME, DB_VERSION, STORES, META_ID, SCHEMA_VERSION, FORMAT_EXPORT } from './config.js';
import * as idb from './lib/idb.js';
import * as bus from './lib/bus.js';
import { h, on, vider } from './lib/dom.js';
import * as prefs from './data/prefs.js';
import * as hot from './data/hot.js';
import * as migrations from './data/migrations.js';
import * as store from './data/store.js';
import * as backup from './data/backup.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Service worker — version MINIMALE
// ─────────────────────────────────────────────────────────────────────────────
// Le protocole complet de mise a jour (version.json, PRECACHE / ACTIVER / KILL, bandeau mis en
// file tant qu'une seance est active) vit dans ui/update.js. Ici on ne fait qu'une chose :
// s'assurer que le worker EXISTE sur l'appareil. C'est la seule action de tout l'amorcage qui
// conditionne la capacite a livrer un correctif plus tard.

/**
 * Enregistre le service worker.
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function enregistrerSW() {
  if (!('serviceWorker' in navigator)) return null;

  return navigator.serviceWorker.register('./sw.js', {
    // ⚠ RELATIF, sans barre initiale : « /sw.js » pointe vers la racine de <user>.github.io,
    //   hors du depot, et ne repond qu'un 404. La portee d'un worker ne remontant jamais
    //   au-dessus de son propre repertoire, une portee absolue serait de toute facon refusee.
    scope: './',
    // ⚠ GitHub Pages sert TOUT en Cache-Control: max-age=600. Sans updateViaCache:'none', le
    //   navigateur relit sw.js depuis son cache HTTP : un worker corrige reste invisible
    //   pendant dix minutes, exactement le temps qu'il faut pour croire a un bug.
    updateViaCache: 'none'
  });
}

/**
 * Branche les deux modules d'interface qui vivent HORS de toute vue : le protocole de mise a jour
 * et l'aide a l'installation. Tous deux n'operent que sur des noeuds de la zone A (bandeau de MAJ)
 * ou sur des evenements globaux (`beforeinstallprompt`), et doivent donc survivre a la navigation.
 *
 * ⚠ Import DYNAMIQUE et non statique, pour la meme raison que tout le reste de ce fichier : un
 *   module casse ou absent ne doit pas empecher boot.js de s'evaluer, sinon l'ecran de secours
 *   lui-meme devient inatteignable et l'utilisateur perd l'acces a son export.
 *
 * ⚠ Appele TOT, avant l'ouverture d'IndexedDB : `beforeinstallprompt` est emis une seule fois et
 *   tres tot. Poser l'ecouteur apres la chaine bloquante le manquerait, et le bouton « Installer »
 *   de l'accueil n'aurait plus rien a rejouer. Aucun await : rien de tout ceci ne conditionne le
 *   premier pixel.
 *
 * Sans consequence sur l'ordre du reste : update.initialiser() protege deja son acces au store
 * (seanceEnCours est enveloppe) et sa premiere verification reseau est differee de 3 s.
 */
function brancherInterfaceGlobale() {
  import('./ui/install.js')
    .then((mod) => { if (mod && typeof mod.initialiser === 'function') mod.initialiser(); })
    .catch((err) => console.debug('[boot] ui/install.js indisponible', err && err.message));

  import('./ui/update.js')
    .then((mod) => { if (mod && typeof mod.initialiser === 'function') mod.initialiser(); })
    .catch((err) => console.debug('[boot] ui/update.js indisponible', err && err.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Theme
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applique le theme choisi sur <html>.
 * Synchrone et appele avant toute I/O : une application du theme apres l'ouverture d'IndexedDB
 * ferait clignoter un fond clair sur un telephone en mode sombre, pendant plusieurs centaines
 * de millisecondes.
 * @param {'auto'|'clair'|'sombre'} theme
 */
export function appliquerTheme(theme) {
  const racine = document.documentElement;
  // 'auto' = ABSENCE d'attribut : tokens.css laisse alors la main a prefers-color-scheme.
  // Poser data-theme="auto" ne correspondrait a aucun selecteur et figerait le theme clair.
  if (theme === 'clair' || theme === 'sombre') racine.setAttribute('data-theme', theme);
  else racine.removeAttribute('data-theme');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Schema IndexedDB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cree les magasins manquants. Appele par idb.ouvrir dans `onupgradeneeded`.
 *
 * ⚠ DB_VERSION est figee a vie : cette fonction ne s'executera donc qu'UNE fois par appareil,
 *   a la toute premiere ouverture. La consequence est severe et justifie de deriver la liste
 *   de config.STORES plutot que de l'ecrire ici : un magasin oublie au premier commit ne
 *   pourra plus JAMAIS etre ajoute, puisqu'il n'y aura plus de montee de version pour le faire.
 * @param {IDBDatabase} db
 */
export function onUpgrade(db) {
  for (const def of Object.values(STORES)) {
    if (db.objectStoreNames.contains(def.nom)) continue;
    const magasin = db.createObjectStore(def.nom, { keyPath: def.cle });
    for (const idx of def.index) magasin.createIndex(idx.nom, idx.chemin, { unique: idx.unique });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Table des routes
// ─────────────────────────────────────────────────────────────────────────────
// Extensible par une ligne : chemin -> module de vue. Les vues sont chargees en import
// DYNAMIQUE, jamais en import statique. Deux raisons, et la seconde est structurelle :
//   1. une vue pas encore ecrite ne doit pas empecher l'application de demarrer ;
//   2. un import statique de neuf vues serait un telechargement de neuf modules AVANT le
//      premier pixel, alors qu'une session n'en visite qu'une ou deux.
// Le module d'une vue doit exporter `mount(conteneur, params) -> { destroy(), onParams(params) }`.

// ⚠ Les titres sont du texte VU PAR L'UTILISATEUR : ils sont ecrits dans #titre-ecran et dans
//   document.title par le routeur. Ils portent donc leurs accents, contrairement aux commentaires.
const ROUTES = {
  '#/':                        route('./views/accueil.js', 'Carnet Muscu'),
  // v2 : l'ecran de seance est le TABLEAU facon carnet (demande utilisateur). L'ancien accordeon
  // (./views/seance.js) reste sur le disque a titre de reference mais n'est plus route.
  '#/seance':                  route('./views/seance-tableau.js', 'Séance'),
  '#/seance/fin':              route('./views/seance-fin.js', 'Fin de séance'),
  '#/historique':              route('./views/historique.js', 'Historique'),
  '#/historique/:id':          route('./views/seance-detail.js', 'Détail de séance'),
  '#/progression':             route('./views/progression.js', 'Progression'),
  '#/progression/:exerciceId': route('./views/progression.js', 'Progression'),
  '#/exercices':               route('./views/exercices.js', 'Exercices'),
  '#/exercices/:id':           route('./views/exercices.js', 'Exercice'),
  '#/modeles':                 route('./views/modeles.js', 'Routines'),
  '#/modeles/:id':             route('./views/modeles.js', 'Routine'),
  // v2 — composeur visuel par packs. Trois entrées, un seul module : seul le verbe final change
  // (« Commencer » pour une séance, « Enregistrer » pour une routine).
  '#/composer':                route('./views/composeur.js', 'Composer une séance'),
  '#/composer/routine':        route('./views/composeur.js', 'Nouvelle routine'),
  '#/composer/routine/:id':    route('./views/composeur.js', 'Modifier la routine'),
  '#/reglages':                route('./views/reglages.js', 'Réglages'),
  '#/aide/installation':       route('./views/reglages.js', 'Installer l\'application')
};

/**
 * Fabrique une entree de route dont le montage differe le chargement du module.
 *
 * Le contrat rendu est exactement celui d'une vue ordinaire — { destroy, onParams } — de sorte
 * que le routeur n'a aucune connaissance du chargement paresseux. Il rend donc l'ecran
 * immediatement, pendant que le module arrive.
 *
 * @param {string} chemin specifieur relatif du module de vue
 * @param {string} titre titre affiche dans l'en-tete
 */
function route(chemin, titre) {
  return {
    titre,
    chemin,
    mount(conteneur, params) {
      let vueReelle = null;
      let demonte = false;
      let derniersParams = params;

      // Import DYNAMIQUE a specifieur variable : resolu contre l'URL de boot.js, donc relatif
      // au sous-repertoire du depot. Aucun chemin absolu, aucune etape de build.
      import(chemin).then((mod) => {
        if (demonte) return;
        const monter = mod && (typeof mod.mount === 'function'
          ? mod.mount
          : (mod.default && typeof mod.default.mount === 'function' ? mod.default.mount : null));
        vider(conteneur);
        if (!monter) { monterEnConstruction(conteneur, titre, null); return; }
        vueReelle = monter(conteneur, derniersParams) || null;
      }).catch((err) => {
        // Vue absente (pas encore ecrite) ou en erreur de chargement : l'application reste
        // navigable. Faire tomber tout l'ecran parce qu'UN module manque punirait l'utilisateur
        // pour un etat du code, et masquerait les vues qui, elles, fonctionnent.
        if (demonte) return;
        vider(conteneur);
        monterEnConstruction(conteneur, titre, err);
      });

      return {
        destroy() {
          demonte = true;
          if (vueReelle && typeof vueReelle.destroy === 'function') vueReelle.destroy();
          vueReelle = null;
          vider(conteneur);
        },
        onParams(p) {
          // Memorise meme si le module n'est pas encore la : sans cela, un changement de
          // parametre survenu pendant le chargement serait perdu et la vue se monterait sur
          // l'exercice precedent.
          derniersParams = p;
          if (vueReelle && typeof vueReelle.onParams === 'function') vueReelle.onParams(p);
        }
      };
    }
  };
}

/** Vue de remplacement. Aucun innerHTML, comme partout ailleurs. */
function monterEnConstruction(conteneur, titre, err) {
  conteneur.appendChild(h('section', { class: 'vue vue-construction' },
    h('h2', { class: 'section-titre' }, titre || 'Ecran en construction'),
    h('p', {}, 'Cet ecran n\'est pas encore disponible dans cette version.'),
    err ? h('p', { class: 'texte-attenue' }, 'Detail technique : ' + (err.message || String(err))) : null,
    h('p', {}, h('a', { href: '#/' }, 'Revenir a l\'accueil'))
  ));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Routeur — repli minimal
// ─────────────────────────────────────────────────────────────────────────────
// ui/router.js est le routeur de l'application. Il est charge dynamiquement pour la meme raison
// que les vues : tant qu'il n'existe pas, l'application doit demarrer quand meme. Le repli
// ci-dessous en implemente le contrat strictement necessaire a l'amorcage — il disparait de
// l'execution des que ui/router.js est present, et n'est pas destine a le remplacer.

function analyserHash(hash) {
  const brut = (hash || '#/').replace(/^#?\/?/, '#/');
  const [chemin, requete] = brut.split('?');
  const params = {};
  if (requete) {
    for (const paire of requete.split('&')) {
      if (!paire) continue;
      const i = paire.indexOf('=');
      const cle = decodeURIComponent(i < 0 ? paire : paire.slice(0, i));
      params[cle] = i < 0 ? '' : decodeURIComponent(paire.slice(i + 1));
    }
  }
  return { chemin: chemin.length > 2 ? chemin.replace(/\/+$/, '') : chemin, params };
}

/** Resout un chemin contre la table, en essayant l'exact avant les motifs a segment nomme. */
function resoudre(routes, chemin) {
  if (routes[chemin]) return { cle: chemin, route: routes[chemin], params: {} };
  const segments = chemin.split('/');
  for (const cle of Object.keys(routes)) {
    const motif = cle.split('/');
    if (motif.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < motif.length; i++) {
      if (motif[i].startsWith(':')) { params[motif[i].slice(1)] = decodeURIComponent(segments[i]); continue; }
      if (motif[i] !== segments[i]) { ok = false; break; }
    }
    if (ok) return { cle, route: routes[cle], params };
  }
  return null;
}

function routeurDeSecours(routes, conteneur) {
  let cleCourante = null;
  let vue = null;

  const aller = () => {
    const { chemin, params } = analyserHash(location.hash);
    const trouve = resoudre(routes, chemin) || resoudre(routes, '#/');
    const tous = Object.assign({}, params, trouve.params);

    // ⚠ Seuls les parametres ont change : on appelle onParams, on NE REMONTE PAS. Remonter
    //   #/seance parce qu'une feuille s'ouvre (#/seance?sheet=ajout) detruirait le minuteur en
    //   cours, le volet ouvert et la position de scroll — le defaut central du plan.
    if (vue && trouve.cle === cleCourante) { vue.onParams(tous); majCoquille(trouve); return; }

    if (vue) vue.destroy();
    cleCourante = trouve.cle;
    vue = trouve.route.mount(conteneur, tous);
    majCoquille(trouve);
  };

  const majCoquille = (trouve) => {
    const titre = document.getElementById('titre-ecran');
    if (titre) titre.textContent = trouve.route.titre || 'Carnet Muscu';
    for (const onglet of document.querySelectorAll('[data-onglet]')) {
      const cible = onglet.getAttribute('href') || '';
      // '#/' est prefixe de TOUTES les routes : sans le cas particulier, l'onglet Accueil
      // resterait marque comme courant sur chaque ecran de l'application.
      const actif = cible === '#/' ? trouve.cle === '#/' : trouve.cle.startsWith(cible);
      if (actif) onglet.setAttribute('aria-current', 'page');
      else onglet.removeAttribute('aria-current');
    }
  };

  window.addEventListener('hashchange', aller);
  if (!location.hash) location.hash = '#/';
  aller();

  return { aller: (destination) => { location.hash = destination; } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Ecran de secours
// ─────────────────────────────────────────────────────────────────────────────
// Il est ECRIT EN DUR dans index.html et non construit ici : il doit rester atteignable meme
// quand c'est le JavaScript d'amorcage qui a echoue. On ne fait donc que le devoiler, poser
// trois ecouteurs et remplir des textContent.

function el(id) { return document.getElementById(id); }

/** Construit une enveloppe d'export a partir du SEUL miroir chaud. Chemin de derniere chance :
 *  il ne touche ni IndexedDB ni aucun module qui en depend. */
function enveloppeDeSecours(chaud) {
  return JSON.stringify({
    format: FORMAT_EXPORT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    // ⚠ Explicitement PARTIEL : cette sauvegarde ne contient que la seance en cours, la seule
    //   que le miroir chaud connaisse. Le dire evite qu'elle soit reimportee en « remplacer »
    //   par-dessus un historique complet, ce qui detruirait tout le reste.
    partiel: true,
    origine: 'miroir-chaud',
    data: {
      exercices: [], lieux: [], modeles: [],
      seances: chaud && chaud.seance ? [chaud.seance] : [],
      poids: [],
      prefs: prefs.lire()
    }
  }, null, 2);
}

function afficherTexteDeSecours(texte) {
  const zone = el('secours-texte');
  if (!zone) return;
  zone.value = texte;
  zone.hidden = false;
  try { zone.focus(); zone.select(); } catch (_) { /* selection impossible : la copie manuelle reste possible */ }
}

async function exporterDepuisSecours(chaud, message) {
  message.textContent = 'Preparation de la sauvegarde...';
  try {
    // On tente d'abord l'export COMPLET : IndexedDB peut n'avoir echoue qu'a l'ouverture faite
    // plus haut (delai depasse sous charge), et une seconde tentative aboutir. Un export complet
    // vaut infiniment mieux qu'un export de la seule seance en cours.
    const canal = await backup.exporter();
    message.textContent = canal === 'annule'
      ? 'Export annule. Tes donnees sont toujours la.'
      : 'Sauvegarde complete produite. Conserve-la hors de ce telephone avant toute autre action.';
    if (canal === 'texte') {
      const { texte } = await backup.construireExport();
      afficherTexteDeSecours(texte);
    }
  } catch (err) {
    // IndexedDB est bien inaccessible : repli sur le miroir chaud, affiche en clair. Rustique,
    // mais JAMAIS silencieux — un export qui echoue sans le dire est pire qu'un plantage franc.
    message.textContent = 'IndexedDB est inaccessible : seule la seance en cours a pu etre ' +
      'recuperee, depuis le cache de reprise. Copie le texte ci-dessous et conserve-le.';
    afficherTexteDeSecours(enveloppeDeSecours(chaud));
  }
}

async function reinitialiser(message) {
  // Double confirmation : c'est la seule action irreversible de toute l'application.
  if (!window.confirm('Reinitialiser efface DEFINITIVEMENT toutes les donnees de cet appareil. ' +
    'As-tu deja exporte ta sauvegarde ?')) return;
  if (!window.confirm('Derniere confirmation : effacer toutes les seances, exercices et reglages ?')) return;

  message.textContent = 'Effacement en cours...';
  try {
    // deleteDatabase peut rester bloque si une connexion survit ailleurs : on n'attend donc pas
    // indefiniment, le rechargement est declenche dans tous les cas.
    await new Promise((resolve) => {
      let fini = false;
      const finir = () => { if (!fini) { fini = true; resolve(); } };
      setTimeout(finir, 3000);
      try {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = finir; req.onerror = finir; req.onblocked = finir;
      } catch (_) { finir(); }
    });
  } finally {
    try { hot.purger(); } catch (_) { /* le miroir n'est qu'un cache */ }
    try { prefs.reinitialiser(); } catch (_) { /* les prefs se recreent par defaut */ }
    location.reload();
  }
}

/**
 * Devoile l'ecran de secours. JAMAIS d'ecran blanc : c'est le seul contrat de cette fonction.
 * @param {Error} err
 * @param {Object|null} chaud contenu du miroir chaud, lu AVANT l'ouverture d'IndexedDB
 */
export function ecranSecours(err, chaud) {
  console.error('[boot] amorcage en echec', err);

  const panneau = el('ecran-secours');
  if (!panneau) {
    // Il n'y a plus rien pour afficher quoi que ce soit proprement : un alert vaut mieux que rien.
    window.alert('L\'application n\'a pas pu demarrer : ' + (err && err.message ? err.message : err));
    return;
  }

  // ⚠ Styles poses ici et non en CSS : aucune regle .secours n'existe dans css/, et un panneau
  //   non positionne s'insererait au fil du document, sous la barre d'action fixe — donc
  //   invisible exactement quand il est indispensable. A retirer le jour ou css/ le stylera.
  Object.assign(panneau.style, {
    position: 'fixed', inset: '0', zIndex: '9999', overflowY: 'auto',
    padding: '24px', background: 'var(--fond, #0f1115)', color: 'var(--texte, #f7f8fa)'
  });

  // La coquille est masquee : la laisser visible sous un panneau translucide laisserait croire
  // que l'application fonctionne et que seule une alerte s'y superpose.
  for (const id of ['vue', 'nav-onglets', 'barre-action', 'entete']) {
    const noeud = el(id);
    if (noeud) noeud.hidden = true;
  }

  const message = el('secours-message');
  const detail = el('secours-detail');
  if (message) {
    message.textContent = chaud && chaud.seance
      ? 'Tes donnees ne sont pas perdues, et une seance en cours a ete retrouvee dans le cache de reprise. Exporte-les avant toute autre action.'
      : 'Tes donnees ne sont pas perdues. Exporte-les avant toute autre action.';
  }
  if (detail) {
    // Message d'erreur EN CLAIR : sans lui, il est impossible de distinguer a distance une base
    // corrompue d'une navigation privee ou d'un stockage sature.
    detail.textContent = (err && err.code ? '[' + err.code + '] ' : '') +
      (err && err.message ? err.message : String(err));
    detail.hidden = false;
  }

  const btnExport = el('btn-secours-exporter');
  const btnReessayer = el('btn-secours-reessayer');
  const btnReinit = el('btn-secours-reinitialiser');

  if (btnExport && message) on(btnExport, 'click', () => { exporterDepuisSecours(chaud, message); });
  if (btnReessayer) on(btnReessayer, 'click', () => location.reload());
  if (btnReinit && message) on(btnReinit, 'click', () => { reinitialiser(message); });

  panneau.hidden = false;
  if (btnExport) { try { btnExport.focus(); } catch (_) { /* focus impossible : sans consequence */ } }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. persist() — APRES la premiere seance, jamais a l'amorcage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Demande la persistance du stockage, une seule fois, apres qu'une premiere seance a ete
 * REELLEMENT enregistree.
 *
 * Pourquoi pas a l'amorcage : Chrome accorde la permission en fonction de l'engagement de
 * l'utilisateur. La demander a la premiere seconde de la premiere visite, c'est se la faire
 * refuser une fois pour toutes ; la demander apres une heure de salle enregistree, c'est la
 * demander au moment ou tous les signaux d'engagement sont au maximum.
 *
 * ⚠ Safari n'implemente PAS StorageManager.persist(). Sur iOS, cette protection est donc
 *   INEXISTANTE : rien n'empeche le systeme d'evincer IndexedDB apres quelques semaines sans
 *   ouverture. Elle ne doit jamais etre presentee a l'utilisateur comme une defense en
 *   profondeur — sur iOS, la SEULE sauvegarde reelle est l'export manuel.
 */
function armerPersistance() {
  const desabonner = bus.on('seance:terminer', () => {
    desabonner();
    const stockage = navigator.storage;
    if (!stockage || typeof stockage.persist !== 'function') return; // Safari : rien a faire
    stockage.persisted()
      .then((deja) => (deja ? true : stockage.persist()))
      .then((accorde) => bus.emit('stockage:persistant', { accorde: accorde === true }))
      .catch(() => { /* refus ou API indisponible : sans consequence sur les donnees */ });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Chaine d'amorcage
// ─────────────────────────────────────────────────────────────────────────────

async function amorcer() {
  // ── 1. Service worker EN TOUT PREMIER, sans await ──────────────────────────
  // Hors de la chaine bloquante et avec un catch SILENCIEUX : un enregistrement refuse
  // (navigation privee, contexte non securise) ne doit ni retarder ni faire echouer le
  // demarrage. Ce qui compte, c'est que si IDB tombe juste apres, le worker soit deja la :
  // un correctif pourra encore atteindre l'appareil.
  enregistrerSW().catch(() => { /* enregistrement impossible : l'application fonctionne sans */ });

  // Dans la foulee et toujours sans await : capture de `beforeinstallprompt` (emis une seule fois,
  // tres tot) et branchement du bandeau de mise a jour. Ni l'un ni l'autre ne bloque le premier
  // pixel, et un echec de chargement reste sans consequence sur le demarrage.
  brancherInterfaceGlobale();

  // ── 2. Prefs, theme et miroir chaud : synchrones, immediats ────────────────
  const preferences = prefs.lire();
  appliquerTheme(preferences.theme);
  // Lu AVANT l'ouverture d'IndexedDB, et conserve : c'est precisement ce qui permet a l'ecran
  // de secours d'exporter la seance en cours quand IDB est mort.
  const chaud = hot.lire();
  // Les filets sont poses des maintenant : une page tuee pendant l'ouverture d'IDB doit encore
  // sauver ce qu'elle a en memoire.
  hot.installerFilets();

  armerPersistance();

  try {
    // ── 3. IndexedDB, avec delai de garde ───────────────────────────────────
    // Le delai n'est pas une precaution theorique : en mode standalone WebKit et en navigation
    // privee, la requete d'ouverture ne se resout NI ne rejette jamais. Sans lui, la chaine
    // reste suspendue pour toujours et l'ecran de secours n'est jamais atteint.
    const db = await idb.ouvrir(DB_NAME, DB_VERSION, onUpgrade, { timeoutMs: 5000 });

    // backup.js peut ouvrir sa propre connexion ; lui passer celle-ci evite une seconde
    // ouverture — et donc un second delai de garde — au moment ou l'utilisateur exporte.
    backup.utiliserBase(db);

    // ── 4. Migrations, avant toute lecture applicative ──────────────────────
    // Eager et transactionnelles : laisser cohabiter deux versions du modele en memoire
    // reviendrait a semer des `if (ancienFormat)` dans tout le domaine, a vie.
    const metaEnBase = await idb.get(db, 'meta', META_ID);
    await migrations.appliquer(db, metaEnBase ? metaEnBase.schemaVersion : null);

    // ── 5. Store : catalogue, modeles, lieux, meta, seance active ───────────
    await store.initialiser(db);

    // ── 6. Reprise de seance ────────────────────────────────────────────────
    // IndexedDB fait autorite SAUF si le miroir est plus recent (lastTouch > updatedAt).
    // store.reprendreSeance emet 'seance:choix-reprise' au-dela de 6 h : c'est la vue accueil
    // qui pose la question, pas l'amorcage — bloquer ici retarderait le premier pixel.
    await store.reprendreSeance(chaud);

    // ── 7. Routeur : L'ECRAN EST PEINT ICI ──────────────────────────────────
    const conteneur = document.querySelector('main');
    if (!conteneur) throw new Error('Element <main> introuvable dans index.html.');

    let routeur = null;
    try {
      const mod = await import('./ui/router.js');
      if (mod && typeof mod.demarrer === 'function') routeur = mod.demarrer(ROUTES, conteneur) || mod;
    } catch (err) {
      console.warn('[boot] ui/router.js indisponible, repli sur le routeur minimal', err);
    }
    if (!routeur) routeur = routeurDeSecours(ROUTES, conteneur);

    // ── 7 bis. Tiroir du minuteur — monte UNE SEULE FOIS, hors des vues ─────
    // v2 : le minuteur n'est plus dans le flux des series. Il vit dans un tiroir lateral
    // disponible depuis n'importe quel ecran, et il DOIT survivre aux changements de vue : c'est
    // tout son interet, remplacer le chronometre du telephone sans quitter l'application.
    // Le monter ici, apres le routeur et hors de toute vue, est la seule facon de le garantir.
    // Echec silencieux : un minuteur indisponible ne doit pas empecher d'enregistrer une seance.
    try {
      const mod = await import('./ui/drawer-minuteur.js');
      if (mod && typeof mod.monter === 'function') mod.monter(document.body);
    } catch (err) {
      console.warn('[boot] ui/drawer-minuteur.js indisponible', err);
    }

    // ── 8. Historique EN TACHE DE FOND, SANS await ──────────────────────────
    // L'ecran est deja peint. #/seance n'en depend pas : le rappel « Derniere fois » vient de
    // meta.lastPerf, deja charge a l'etape 5. Les vues qui en ont besoin s'abonnent a
    // bus('historique:pret').
    store.chargerHistorique();

    bus.emit('app:prete', { seanceActive: !!store.seanceActive() });
    return routeur;
  } catch (err) {
    // ── 9. Ecran de secours ─────────────────────────────────────────────────
    ecranSecours(err, chaud);
    return null;
  }
}

// ⚠ Le .catch final n'est pas decoratif : une exception levee par ecranSecours lui-meme
//   (DOM absent, module casse) produirait un rejet non gere et, la, un vrai ecran blanc.
amorcer().catch((err) => {
  console.error('[boot] echec irrattrapable', err);
  try { window.alert('L\'application n\'a pas pu demarrer : ' + (err && err.message ? err.message : err)); }
  catch (_) { /* plus rien n'est possible */ }
});

export { amorcer, ROUTES };
