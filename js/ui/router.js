// js/ui/router.js — routeur par hash, unique proprietaire de la zone B.
//
// Trois decisions structurent ce fichier, et chacune corrige un defaut precis :
//
//   1. ROUTAGE PAR HASH EXCLUSIF. Aucune API History pour le chemin. Sur GitHub Pages il n'existe
//      aucun moyen de configurer une reecriture vers index.html : une URL en « vrai » chemin
//      (/Sport-suivi/seance) repond 404 des que l'utilisateur recharge ou partage le lien. Le
//      hash n'est jamais envoye au serveur, donc TOUTE navigation charge index.html. Le probleme
//      est supprime structurellement, pas contourne.
//
//   2. UNE FEUILLE EST UN PARAMETRE, PAS UNE ROUTE. `#/seance?sheet=ajout` a la meme route de
//      base que `#/seance`. Le routeur appelle alors `onParams()` et NE DEMONTE RIEN. Sans cette
//      regle, ouvrir « Ajouter un exercice » depuis une seance detruirait le scroll, le volet
//      ouvert et le minuteur en cours — pour une action qui n'a rien change au contexte. Comme
//      l'ouverture pousse une entree d'historique, le bouton retour d'Android ferme la feuille
//      au lieu de quitter la seance.
//
//   3. destroy() AVANT mount(). La vue sortante coupe ses abonnements bus, ses minuteurs et ses
//      ecouteurs AVANT que la suivante ne pose les siens. L'ordre inverse laisserait deux vues
//      abonnees simultanement a 'store:commit' : la sortante, deja detachee du DOM, ecrirait
//      dans des noeuds orphelins et fuirait a chaque navigation.
//
// Le routeur ne connait RIEN du domaine. Il ne lit ni IndexedDB, ni le store : il resout un
// hash, monte un module et mute les quelques noeuds nommes de la coquille.

import { h, on, vider } from '../lib/dom.js';
import { emit } from '../lib/bus.js';

// ─────────────────────────────────────────────────────────────────────────────
// Etat du singleton
// ─────────────────────────────────────────────────────────────────────────────
// Un seul routeur par document. Les fonctions exportees (aller, ouvrirFeuille...) operent sur
// cet etat : une vue les importe directement sans avoir a se faire passer l'objet rendu par
// demarrer(). C'est aussi ce qui permet a boot.js d'ecrire `mod.demarrer(...) || mod`.

const etat = {
  routes: null,
  conteneur: null,
  cle: null,        // cle de la route montee (motif, pas chemin resolu)
  vue: null,        // { destroy(), onParams(params) }
  params: {},
  chemin: '#/',
  demarre: false,
  // Profondeur d'historique creee par ouvrirFeuille : permet a fermerFeuille() de faire un
  // vrai history.back(), donc de laisser l'historique du navigateur coherent avec l'ecran.
  profondeurFeuille: 0,
  // Cles de requete posees par la feuille courante : elles seules sont retirees a la fermeture.
  clesFeuille: [],
  detacher: []
};

// ─────────────────────────────────────────────────────────────────────────────
// Analyse et resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decoupe un hash en chemin + parametres de requete.
 * Tolerant en entree : '', '#', '/seance', '#seance' et '#/seance' donnent tous un chemin valide.
 * @param {string} hash
 * @returns {{chemin: string, params: Object<string,string>}}
 */
export function analyserHash(hash) {
  const brut = (hash || '#/').replace(/^#?\/?/, '#/');
  const coupe = brut.indexOf('?');
  const chemin = coupe < 0 ? brut : brut.slice(0, coupe);
  const requete = coupe < 0 ? '' : brut.slice(coupe + 1);
  const params = {};
  if (requete) {
    for (const paire of requete.split('&')) {
      if (!paire) continue;
      const i = paire.indexOf('=');
      // decodeURIComponent leve sur un '%' isole (une valeur tapee a la main, un lien tronque
      // par une application de messagerie) : un parametre illisible ne doit pas empecher la
      // route de se resoudre.
      try {
        const cle = decodeURIComponent(i < 0 ? paire : paire.slice(0, i));
        params[cle] = i < 0 ? '' : decodeURIComponent(paire.slice(i + 1));
      } catch (_) { /* parametre illisible : ignore */ }
    }
  }
  // Barre finale retiree, sauf sur la racine ou elle EST le chemin.
  return { chemin: chemin.length > 2 ? chemin.replace(/\/+$/, '') : chemin, params };
}

/**
 * Reconstruit un hash a partir d'un chemin et d'une table de parametres.
 * @param {string} chemin
 * @param {Object} params
 * @returns {string}
 */
function construireHash(chemin, params) {
  const morceaux = [];
  for (const cle in params) {
    const val = params[cle];
    if (val == null || val === false) continue;
    morceaux.push(encodeURIComponent(cle) + '=' + encodeURIComponent(String(val)));
  }
  return morceaux.length ? chemin + '?' + morceaux.join('&') : chemin;
}

/**
 * Resout un chemin contre la table de routes : correspondance exacte d'abord, motifs a segment
 * nomme (':id') ensuite. L'exact passe en premier pour que '#/exercices' ne soit jamais capture
 * par un motif de meme longueur.
 * @param {Object} routes
 * @param {string} chemin
 * @returns {{cle: string, route: Object, params: Object}|null}
 */
function resoudre(routes, chemin) {
  if (routes[chemin]) return { cle: chemin, route: routes[chemin], params: {} };
  const segments = chemin.split('/');
  for (const cle of Object.keys(routes)) {
    if (cle.indexOf(':') < 0) continue;
    const motif = cle.split('/');
    if (motif.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < motif.length; i++) {
      if (motif[i].charAt(0) === ':') {
        if (!segments[i]) { ok = false; break; }   // un segment vide ne remplit pas un ':id'
        try { params[motif[i].slice(1)] = decodeURIComponent(segments[i]); }
        catch (_) { params[motif[i].slice(1)] = segments[i]; }
        continue;
      }
      if (motif[i] !== segments[i]) { ok = false; break; }
    }
    if (ok) return { cle, route: routes[cle], params };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue de secours
// ─────────────────────────────────────────────────────────────────────────────
// Un module de vue absent, casse ou servi en 404 par un cache incomplet ne doit JAMAIS produire
// un ecran vide : l'utilisateur serait piege sans meme un lien de retour. La vue de secours est
// construite ici, sans import, pour rester disponible quand c'est justement l'import qui echoue.

/**
 * @param {Element} conteneur
 * @param {string} titre
 * @param {Error|null} err
 * @returns {{destroy: Function, onParams: Function}}
 */
function monterSecours(conteneur, titre, err) {
  vider(conteneur);
  conteneur.appendChild(h('section', { class: 'vue vue-secours' },
    h('h2', { class: 'section-titre' }, titre || 'Écran indisponible'),
    h('p', {}, 'Cet écran n\'a pas pu être chargé. Tes données ne sont pas affectées.'),
    err ? h('p', { class: 'texte-attenue' },
      'Détail technique : ' + (err && err.message ? err.message : String(err))) : null,
    h('p', {}, h('a', { class: 'bouton', href: '#/' }, 'Revenir à l\'accueil'))
  ));
  return { destroy() { vider(conteneur); }, onParams() { /* rien a rafraichir */ } };
}

/**
 * Normalise une entree de table de routes en une fonction de montage.
 *
 * Trois formes acceptees, de la plus explicite a la plus laconique :
 *   { titre, mount(conteneur, params) }   — deja pret (forme produite par boot.js)
 *   { titre, chemin: './views/x.js' }     — le routeur fait lui-meme l'import dynamique
 *   './views/x.js'                        — chaine nue
 *
 * L'import est DYNAMIQUE dans tous les cas : un import statique des neuf vues serait neuf
 * modules telecharges avant le premier pixel, alors qu'une session en visite une ou deux.
 *
 * @param {Object|string} route
 * @returns {{titre: string, mount: Function}}
 */
function normaliser(route) {
  const def = typeof route === 'string' ? { chemin: route } : (route || {});
  const titre = def.titre || 'Carnet Muscu';

  if (typeof def.mount === 'function') return { titre, mount: def.mount, brut: def };

  const chemin = def.chemin;
  return {
    titre,
    brut: def,
    mount(conteneur, params) {
      let reelle = null;
      let demonte = false;
      // Memorise meme quand le module n'est pas encore la : un changement de parametre survenu
      // pendant le chargement serait sinon perdu, et la vue se monterait sur l'etat precedent.
      let derniers = params;

      if (!chemin) return monterSecours(conteneur, titre, new Error('Route sans module.'));

      import(chemin).then((mod) => {
        if (demonte) return;
        const monter = mod && (typeof mod.mount === 'function'
          ? mod.mount
          : (mod.default && typeof mod.default.mount === 'function' ? mod.default.mount : null));
        vider(conteneur);
        if (!monter) { reelle = monterSecours(conteneur, titre, new Error('Le module n\'exporte pas mount().')); return; }
        reelle = monter(conteneur, derniers) || null;
      }).catch((err) => {
        if (demonte) return;
        reelle = monterSecours(conteneur, titre, err);
      });

      return {
        destroy() {
          demonte = true;
          appelerSur(reelle, 'destroy');
          reelle = null;
          vider(conteneur);
        },
        onParams(p) {
          derniers = p;
          appelerSur(reelle, 'onParams', p);
        }
      };
    }
  };
}

/** Appel defensif : une vue qui leve dans destroy() ne doit pas bloquer la navigation. */
function appelerSur(objet, methode, arg) {
  if (!objet || typeof objet[methode] !== 'function') return false;
  try { objet[methode](arg); return true; }
  catch (err) { console.error('[router] ' + methode + '() de la vue en echec', err); return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coquille (zone A) — mutations ciblees uniquement
// ─────────────────────────────────────────────────────────────────────────────
// Aucun noeud n'est cree ni remplace ici : on ecrit du textContent et des attributs sur des
// noeuds ecrits en dur dans index.html et repere par id.

function noeud(id) { return document.getElementById(id); }

/**
 * @param {{cle: string, titre: string}} contexte
 */
function majCoquille(contexte) {
  const titre = noeud('titre-ecran');
  if (titre) titre.textContent = contexte.titre || 'Carnet Muscu';
  // Le titre du document suit : c'est lui qui nomme l'onglet et l'entree d'historique.
  document.title = contexte.cle === '#/' ? 'Carnet Muscu' : (contexte.titre + ' — Carnet Muscu');

  // Bouton retour : masque sur la racine, qui n'a nulle part ou revenir. Les vues qui veulent
  // un comportement de retour particulier surchargent son data-action, jamais sa presence.
  const retour = noeud('btn-retour');
  if (retour) retour.hidden = contexte.cle === '#/';

  // Onglets : seuls aria-current et la classe changent. '#/' etant prefixe de toutes les
  // routes, il exige un cas particulier, sans quoi l'onglet Accueil resterait courant partout.
  for (const onglet of document.querySelectorAll('[data-onglet]')) {
    const cible = onglet.getAttribute('href') || '';
    const actif = cible === '#/' ? contexte.cle === '#/' : contexte.cle.indexOf(cible) === 0;
    if (actif) onglet.setAttribute('aria-current', 'page');
    else onglet.removeAttribute('aria-current');
    onglet.classList.toggle('est-actif', actif);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boucle de navigation
// ─────────────────────────────────────────────────────────────────────────────

function traiter() {
  const { chemin, params } = analyserHash(location.hash);
  let trouve = resoudre(etat.routes, chemin);
  let introuvable = false;

  if (!trouve) {
    // Hash inconnu (lien obsolete, faute de frappe, ancienne version installee) : on retombe
    // sur la racine plutot que d'afficher un ecran vide. La correction est SILENCIEUSE et sans
    // redirection d'URL : rediriger effacerait l'entree d'historique et casserait le retour.
    trouve = resoudre(etat.routes, '#/');
    introuvable = true;
  }

  const def = trouve ? normaliser(trouve.route) : null;
  const tous = Object.assign({}, params, trouve ? trouve.params : {});
  const contexte = {
    cle: trouve ? trouve.cle : '#/',
    chemin,
    titre: def ? def.titre : 'Carnet Muscu',
    params: tous
  };

  etat.chemin = chemin;
  etat.params = tous;

  // Une feuille refermee (par le bouton retour d'Android ou par fermerFeuille) remet le compteur
  // a zero : sans cela, un second history.back() sauterait hors de la seance.
  if (!tous.sheet) { etat.profondeurFeuille = 0; etat.clesFeuille = []; }

  // ⚠ LE POINT CENTRAL. Meme route de base : on ne demonte RIEN. Le minuteur en cours, le volet
  //   ouvert, la position de scroll et le bouton sous le doigt survivent par construction.
  if (etat.vue && trouve && trouve.cle === etat.cle) {
    appelerSur(etat.vue, 'onParams', tous);
    majCoquille(contexte);
    emit('route:params', { cle: contexte.cle, params: tous, feuille: tous.sheet || null });
    return;
  }

  if (!trouve || !def) {
    if (etat.vue) { appelerSur(etat.vue, 'destroy'); etat.vue = null; etat.cle = null; }
    etat.vue = monterSecours(etat.conteneur, 'Écran introuvable', new Error(chemin));
    majCoquille(contexte);
    return;
  }

  // ⚠ destroy() de la sortante AVANT mount() de l'entrante. Voir l'en-tete du fichier.
  if (etat.vue) appelerSur(etat.vue, 'destroy');
  etat.vue = null;
  etat.cle = trouve.cle;

  // Le conteneur est vide juste avant le montage : une vue n'herite jamais des noeuds de la
  // precedente, meme si son destroy() a leve.
  vider(etat.conteneur);
  majCoquille(contexte);

  let montee = null;
  try {
    montee = def.mount(etat.conteneur, tous) || null;
  } catch (err) {
    console.error('[router] montage en echec pour ' + trouve.cle, err);
    montee = monterSecours(etat.conteneur, def.titre, err);
  }
  // Une vue sans destroy() n'est pas une vue : on l'enveloppe pour que le contrat tienne cote
  // routeur, quelle que soit la discipline du module.
  etat.vue = montee || { destroy() { vider(etat.conteneur); }, onParams() {} };

  // Le focus part au contenu : sans cela, un lecteur d'ecran resterait sur l'onglet clique et
  // ne lirait jamais le nouvel ecran. tabindex="-1" est deja pose sur <main> dans index.html.
  if (etat.conteneur && typeof etat.conteneur.focus === 'function') {
    try { etat.conteneur.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
  }

  emit('route:changee', { cle: contexte.cle, chemin, params: tous, introuvable });
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Demarre le routeur. Appele une seule fois, par boot.js, APRES l'initialisation du store et
 * AVANT le chargement de l'historique : c'est ici que le premier pixel est peint.
 *
 * @param {Object} routes table cle de route -> { titre, mount } | { titre, chemin } | string
 * @param {Element} conteneur zone B, le <main> d'index.html
 * @returns {{aller, courant, ouvrirFeuille, fermerFeuille, arreter}}
 */
export function demarrer(routes, conteneur) {
  if (etat.demarre) return api;
  if (!routes || !conteneur) throw new Error('router.demarrer : routes et conteneur sont requis.');

  etat.routes = routes;
  etat.conteneur = conteneur;
  etat.demarre = true;

  etat.detacher.push(on(window, 'hashchange', traiter));

  // Bouton retour de la coquille : un seul ecouteur, pose une fois pour toutes. Il ferme la
  // feuille si elle est ouverte — le meme geste que le retour d'Android, pour la meme raison.
  const retour = noeud('btn-retour');
  if (retour) {
    etat.detacher.push(on(retour, 'click', () => {
      if (etat.params && etat.params.sheet) { fermerFeuille(); return; }
      // history.length > 1 ne garantit pas que l'entree precedente appartienne a l'application
      // (l'utilisateur peut arriver par un lien externe) : la racine reste le repli sur.
      if (window.history.length > 1) window.history.back();
      else aller('#/');
    }));
  }

  // Pas de hash du tout (premiere ouverture, raccourci d'accueil) : on ECRASE l'entree courante
  // plutot que d'en pousser une, sinon le tout premier retour ramenerait sur une URL sans hash,
  // donc sur un rechargement complet de l'application.
  if (!location.hash || location.hash === '#') {
    try { history.replaceState(null, '', location.pathname + location.search + '#/'); }
    catch (_) { location.hash = '#/'; }
  }

  traiter();
  return api;
}

/**
 * Navigue vers un hash. Sans effet si la destination est deja affichee : reassigner le meme
 * hash n'emet pas 'hashchange' mais empile tout de meme une entree d'historique morte, qui
 * oblige a appuyer deux fois sur retour.
 *
 * @param {string} hash
 * @param {{remplacer?: boolean}} [options] remplacer : n'empile pas d'entree d'historique
 */
export function aller(hash, options) {
  const destination = (hash || '#/').replace(/^#?\/?/, '#/');
  if (destination === (location.hash || '#/')) return;
  if (options && options.remplacer) {
    try {
      history.replaceState(null, '', location.pathname + location.search + destination);
      traiter();   // replaceState n'emet PAS hashchange : la boucle doit etre relancee a la main
      return;
    } catch (_) { /* contexte sans History API : on retombe sur l'affectation directe */ }
  }
  location.hash = destination;
}

/**
 * Etat courant du routeur.
 * @returns {{hash: string, cle: string, chemin: string, params: Object, feuille: string|null}}
 */
export function courant() {
  return {
    hash: location.hash || '#/',
    cle: etat.cle,
    chemin: etat.chemin,
    params: Object.assign({}, etat.params),
    feuille: (etat.params && etat.params.sheet) || null
  };
}

/**
 * Ouvre une feuille superposee sur la route COURANTE.
 *
 * ⚠ Ce n'est pas une navigation : la route de base ne change pas, la vue n'est pas demontee, et
 *   elle recoit simplement onParams({ sheet: nom, ... }). C'est a elle d'appeler ui/sheet.js.
 *   Le seul effet de bord est une entree d'historique — c'est exactement ce qui fait que le
 *   bouton retour d'Android ferme la feuille au lieu de quitter la seance.
 *
 * @param {string} nom valeur du parametre `sheet` ('ajout-exercice', 'edition-serie'...)
 * @param {Object} [data] parametres additionnels, ex. { id: 'ser_01H...' }
 */
export function ouvrirFeuille(nom, data) {
  if (!nom) return;
  const params = Object.assign({}, etat.params, data || {}, { sheet: nom });
  // Seules ces cles seront retirees a la fermeture : les parametres propres a la route (une
  // metrique selectionnee, une plage de courbe) doivent survivre a l'ouverture d'une feuille.
  etat.clesFeuille = ['sheet'].concat(Object.keys(data || {}));
  const cible = construireHash(etat.chemin, params);
  if (cible === (location.hash || '')) return;
  etat.profondeurFeuille++;
  location.hash = cible;      // affectation directe : on VEUT l'entree d'historique
}

/**
 * Ferme la feuille ouverte.
 *
 * Si elle a ete ouverte par ouvrirFeuille, on remonte l'historique : l'entree poussee a
 * l'ouverture disparait, et l'historique du navigateur reste le reflet exact de ce que
 * l'utilisateur a vu. Sinon (feuille presente dans l'URL d'entree, lien partage), on remplace
 * l'entree courante — reculer renverrait hors de l'application.
 */
export function fermerFeuille() {
  if (!etat.params || !etat.params.sheet) return;
  if (etat.profondeurFeuille > 0) {
    etat.profondeurFeuille--;
    window.history.back();    // 'hashchange' suivra et relancera traiter()
    return;
  }
  const params = Object.assign({}, etat.params);
  for (const cle of (etat.clesFeuille.length ? etat.clesFeuille : ['sheet'])) delete params[cle];
  etat.clesFeuille = [];
  aller(construireHash(etat.chemin, params), { remplacer: true });
}

/**
 * Arrete le routeur et demonte la vue courante. Sert aux tests : en production le routeur vit
 * aussi longtemps que le document.
 */
export function arreter() {
  for (const off of etat.detacher) { try { off(); } catch (_) { /* deja detache */ } }
  etat.detacher = [];
  if (etat.vue) appelerSur(etat.vue, 'destroy');
  etat.vue = null;
  etat.cle = null;
  etat.demarre = false;
}

const api = { demarrer, aller, courant, ouvrirFeuille, fermerFeuille, arreter, analyserHash };

export default api;
