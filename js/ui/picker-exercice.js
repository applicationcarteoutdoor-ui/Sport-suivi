// ui/picker-exercice.js — selecteur d'exercice, feuille basse filtrable.
//
// POURQUOI PAS UN <select> : 40 entrees dans la roue de defilement iOS sont ingerables a une
// main, en salle, entre deux series. La roue n'offre ni recherche, ni tri par usage, ni creation.
// Ici : recherche sur le nom ET les alias, tri par frequence recente en tete, onglets
// Muscu / Cardio, et une creation « eclair » a deux champs.
//
// CONTRAT DE RENDU : ce module est un FRAGMENT VIVANT (zone C). Il construit son sous-arbre une
// fois, le POSSEDE integralement, et n'est jamais remplace par un parent. La liste est le seul
// noeud qu'il reconstruit — il en est le proprietaire exclusif. Aucun rerender() global.

import { h, on, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import * as store from '../data/store.js';
import {
  MODES, NOMS_MODES, LIBELLES_MODES, LIBELLES_CATEGORIES, LIBELLES_MATERIELS,
  CATEGORIES, nouvelExercice, estSeanceComptable } from '../data/schema.js';
import * as sheet from './sheet.js';

// Nombre d'exercices proposes dans la section « Recents ». Au-dela, la section cesse d'etre un
// raccourci et redevient une liste a lire.
const MAX_RECENTS = 6;

// Fenetre de calcul de la frequence recente. Trois mois : assez long pour couvrir un cycle,
// assez court pour qu'un exercice abandonne disparaisse de la tete de liste.
const FENETRE_JOURS = 90;

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation de recherche
// ─────────────────────────────────────────────────────────────────────────────

// ⚠ SANS normalize('NFD') + suppression des diacritiques, « developpe » ne trouve JAMAIS
//   « Développé couché » : c'est la requete la plus naturelle au clavier d'un telephone, ou
//   personne ne compose les accents. La ponctuation devient une espace pour que « pull-up »
//   et « pull up » soient la meme chose.
// Bloc Unicode « Combining Diacritical Marks » : ce que normalize('NFD') detache des lettres.
// Ecrit en echappements et non en caracteres litteraux, pour que la regle survive a n'importe
// quel outil qui reencoderait le fichier.
const DIACRITIQUES = /[\u0300-\u036f]/g;

function normaliser(texte) {
  return String(texte == null ? '' : texte)
    .normalize('NFD')
    .replace(DIACRITIQUES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Index de recherche d'un exercice : nom + alias. La categorie et le materiel en sont exclus
// volontairement — chercher « barre » ne doit pas remonter les 12 exercices a la barre avant
// l'exercice dont c'est le nom.
function indexer(ex) {
  return normaliser([ex.nom].concat(ex.alias || []).join(' '));
}

// Tous les mots de la requete doivent etre presents. « dev couch » trouve « Développé couché ».
function correspond(index, mots) {
  for (const mot of mots) if (index.indexOf(mot) === -1) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frequence recente
// ─────────────────────────────────────────────────────────────────────────────

// Score decroissant avec l'age : un exercice fait hier passe devant un exercice fait dix fois
// il y a trois mois. Sans cette decroissance, le tri fige la tete de liste sur l'ancien programme.
function scoreAge(jours) {
  if (jours < 0) return 1;
  return 1 / (1 + jours / 14);
}

function joursDepuis(cle, aujourdHui) {
  // Les cles sont des dates LOCALES 'YYYY-MM-DD' : on les compare en millisecondes via Date,
  // jamais en soustrayant des chaines.
  const t = Date.parse(cle + 'T00:00:00');
  if (!Number.isFinite(t)) return FENETRE_JOURS;
  return Math.round((aujourdHui - t) / 86400000);
}

/**
 * Table exerciceId -> score d'usage recent.
 * Deux sources, cumulees : l'historique complet quand il est charge, et meta.lastPerf sinon.
 * ⚠ lastPerf est le repli qui compte : la feuille peut s'ouvrir avant la fin du chargement de
 *   l'historique (tache de fond), et une tete de liste vide a ce moment-la annule tout l'interet
 *   du tri par frequence.
 */
function scoresUsage() {
  const scores = new Map();
  const maintenant = Date.now();
  const ajouter = (id, valeur) => {
    if (!id) return;
    scores.set(id, (scores.get(id) || 0) + valeur);
  };

  for (const s of store.seances()) {
    if (!estSeanceComptable(s)) continue;
    const jours = joursDepuis(s.date, maintenant);
    if (jours > FENETRE_JOURS) continue;
    for (const e of s.entrees || []) ajouter(e.exerciceId, scoreAge(jours));
  }

  const lastPerf = (store.meta() && store.meta().lastPerf) || {};
  for (const id in lastPerf) {
    const perf = lastPerf[id];
    if (!perf || !perf.date) continue;
    const jours = joursDepuis(perf.date, maintenant);
    if (jours > FENETRE_JOURS) continue;
    ajouter(id, scoreAge(jours));
  }

  return scores;
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction des lignes
// ─────────────────────────────────────────────────────────────────────────────

const estCardio = (ex) => ex.mode === 'cardio' || ex.categorie === 'cardio';

function sousTitre(ex) {
  const bouts = [];
  if (ex.materiel && ex.materiel !== 'aucun') bouts.push(LIBELLES_MATERIELS[ex.materiel] || ex.materiel);
  bouts.push(LIBELLES_MODES[ex.mode] || ex.mode);
  if (ex.unilateral) bouts.push('par côté');
  if (ex.archived) bouts.push('archivé');
  return bouts.join(' · ');
}

// Une ligne est un <button> et non un <div> : cible tactile de 56 px (.ligne-liste), focus
// clavier et role natifs, sans un seul attribut aria a maintenir.
function ligne(ex) {
  return h('button', {
    type: 'button',
    class: 'ligne-liste',
    'data-action': 'choisir',
    'data-id': ex.id,
    'data-archive': ex.archived ? 'oui' : null
  },
    h('span', null,
      h('span', { class: 'ligne-liste-principal' }, ex.nom),
      h('br'),
      h('span', { class: 'ligne-liste-secondaire' }, sousTitre(ex))
    ),
    h('span', { class: 'ligne-liste-secondaire' }, LIBELLES_CATEGORIES[ex.categorie] || '')
  );
}

function titreSection(texte) {
  return h('h3', { class: 'section-titre', style: { padding: 'var(--esp-3) var(--esp-4) var(--esp-1)' } }, texte);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ouverture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ouvre la feuille de selection d'exercice.
 *
 * @param {Object} options
 * @param {string} [options.filtreCategorie] restreint a une categorie ; masque alors les onglets
 * @param {(exercice:Object)=>void} options.onChoisir appele avec l'exercice retenu, feuille fermee
 * @param {(brouillon:{nom:string,mode:string})=>Object|Promise<Object>} [options.onCreerEclair]
 *        appele a la creation eclair. S'il rend un exercice, il fait autorite ; s'il ne rend rien,
 *        le selecteur cree l'exercice lui-meme via store.commit('exercice:enregistrer').
 * @returns {{fermer:()=>void}}
 */
export function ouvrir({ filtreCategorie = null, onChoisir, onCreerEclair } = {}) {
  const desabonnements = [];
  let onglet = filtreCategorie === 'cardio' ? 'cardio' : 'muscu';
  let requete = '';
  let montrerArchives = false;
  let poignee = null;   // { fermer } rendu par sheet.ouvrir
  // Drapeau de vivacite : declare AVANT les rappels differes (rAF) pour qu'ils puissent le tester
  // sans dependre de l'ordre d'ecriture du module.
  let ferme = false;

  // ── Sous-arbre, construit UNE fois ────────────────────────────────────────
  const racine = h('div', { class: 'picker-exercice' });

  const champ = h('input', {
    type: 'search',
    class: 'champ-recherche',
    placeholder: 'Rechercher un exercice…',
    'aria-label': 'Rechercher un exercice',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'search'
  });
  // ⚠ AUCUN focus automatique : ouvrir le clavier des l'apparition de la feuille masquerait
  //   precisement la tete de liste (les exercices recents), qui couvre la grande majorite des
  //   choix. L'utilisateur tape dans le champ quand il en a besoin.

  const onglets = h('div', { class: 'segments', role: 'tablist', hidden: !!filtreCategorie },
    h('button', { type: 'button', class: 'segment', role: 'tab', 'data-action': 'onglet', 'data-onglet': 'muscu', 'aria-selected': 'true' }, 'Muscu'),
    h('button', { type: 'button', class: 'segment', role: 'tab', 'data-action': 'onglet', 'data-onglet': 'cardio', 'aria-selected': 'false' }, 'Cardio')
  );

  const liste = h('div', { class: 'liste', role: 'listbox' });

  const boutonArchives = h('button', { type: 'button', class: 'bouton bouton-fantome', 'data-action': 'archives' }, 'Afficher les archivés');
  const boutonEclair = h('button', { type: 'button', class: 'bouton bouton-large', 'data-action': 'eclair' }, '+ Créer éclair');

  const panneauListe = h('div', null,
    champ,
    onglets,
    liste,
    h('div', { style: { display: 'flex', gap: 'var(--esp-2)', flexDirection: 'column', paddingTop: 'var(--esp-3)' } },
      boutonEclair,
      boutonArchives
    )
  );

  // ── Panneau « Creer eclair » ──────────────────────────────────────────────
  // Deux champs, pas neuf. Le cas reel est : la machine est occupee, on la remplace, on veut
  // enregistrer une serie dans les quinze secondes. Categorie, materiel, increment et facteur de
  // poids de corps prennent leurs valeurs par defaut et se completent plus tard depuis Exercices.
  const champNom = h('input', {
    type: 'text',
    class: 'champ-recherche',
    placeholder: 'Nom de l’exercice',
    'aria-label': 'Nom de l’exercice',
    autocomplete: 'off',
    enterkeyhint: 'done'
  });

  const segmentsMode = h('div', { class: 'segments', role: 'tablist', style: { flexWrap: 'wrap' } },
    ...NOMS_MODES.map((m) => h('button', {
      type: 'button', class: 'segment', role: 'tab',
      'data-action': 'mode', 'data-mode': m,
      'aria-selected': m === 'charge' ? 'true' : 'false',
      style: { minWidth: '30%' }
    }, LIBELLES_MODES[m] || m))
  );
  let modeChoisi = 'charge';

  const messageEclair = h('p', { class: 'ligne-liste-secondaire', hidden: true, role: 'alert' });

  const panneauCreation = h('div', { hidden: true },
    h('p', { class: 'section-titre' }, 'Nom'),
    champNom,
    h('p', { class: 'section-titre', style: { paddingTop: 'var(--esp-3)' } }, 'Mode de suivi'),
    segmentsMode,
    messageEclair,
    h('div', { style: { display: 'flex', gap: 'var(--esp-3)', paddingTop: 'var(--esp-4)' } },
      h('button', { type: 'button', class: 'bouton bouton-large', 'data-action': 'annuler-eclair' }, 'Retour'),
      h('button', { type: 'button', class: 'bouton bouton-primaire bouton-large', 'data-action': 'valider-eclair' }, 'Créer et choisir')
    )
  );

  racine.appendChild(panneauListe);
  racine.appendChild(panneauCreation);

  // ── Remplissage de la liste (seul noeud reconstruit, et il nous appartient) ──
  function candidats() {
    const mots = requete ? normaliser(requete).split(' ').filter(Boolean) : [];
    return store.exercices().filter((ex) => {
      if (ex.archived && !montrerArchives) return false;               // exclus PAR DEFAUT
      if (filtreCategorie && ex.categorie !== filtreCategorie) return false;
      if (!filtreCategorie) {
        if (onglet === 'cardio' ? !estCardio(ex) : estCardio(ex)) return false;
      }
      if (!mots.length) return true;
      return correspond(indexer(ex), mots);
    });
  }

  function remplir() {
    vider(liste);
    const scores = scoresUsage();
    const trouves = candidats();

    if (!trouves.length) {
      liste.appendChild(h('div', { class: 'etat-vide' },
        h('p', { class: 'etat-vide-titre' }, 'Aucun exercice'),
        h('p', { class: 'etat-vide-texte' },
          requete ? 'Aucun exercice ne correspond à « ' + requete + ' ». Créez-le en deux champs.'
                  : 'Aucun exercice dans cette catégorie.')
      ));
      return;
    }

    const parNom = (a, b) => String(a.nom).localeCompare(String(b.nom), 'fr', { sensitivity: 'base' });

    // En recherche : un seul bloc, les plus utilises d'abord. Decouper en categories pendant une
    // recherche eloignerait le resultat evident du haut de l'ecran.
    if (requete) {
      const debut = normaliser(requete);
      trouves.sort((a, b) => {
        const da = normaliser(a.nom).startsWith(debut) ? 1 : 0;
        const db = normaliser(b.nom).startsWith(debut) ? 1 : 0;
        if (da !== db) return db - da;
        const sa = scores.get(a.id) || 0, sb = scores.get(b.id) || 0;
        if (sa !== sb) return sb - sa;
        return parNom(a, b);
      });
      for (const ex of trouves) liste.appendChild(ligne(ex));
      return;
    }

    const recents = trouves
      .filter((ex) => (scores.get(ex.id) || 0) > 0)
      .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0) || parNom(a, b))
      .slice(0, MAX_RECENTS);
    const idsRecents = new Set(recents.map((ex) => ex.id));

    if (recents.length) {
      liste.appendChild(titreSection('Récents'));
      for (const ex of recents) liste.appendChild(ligne(ex));
    }

    // Le reste par categorie, dans l'ordre du vocabulaire ferme de schema.js (ordre anatomique
    // et non alphabetique : c'est celui dans lequel un programme est ecrit).
    const reste = trouves.filter((ex) => !idsRecents.has(ex.id));
    const ordre = CATEGORIES.filter((c) => reste.some((ex) => ex.categorie === c))
      .concat(reste.some((ex) => CATEGORIES.indexOf(ex.categorie) === -1) ? ['__autres'] : []);

    for (const cat of ordre) {
      const bloc = reste
        .filter((ex) => (cat === '__autres' ? CATEGORIES.indexOf(ex.categorie) === -1 : ex.categorie === cat))
        .sort(parNom);
      if (!bloc.length) continue;
      liste.appendChild(titreSection(cat === '__autres' ? 'Autres' : (LIBELLES_CATEGORIES[cat] || cat)));
      for (const ex of bloc) liste.appendChild(ligne(ex));
    }
  }

  // ── Creation eclair ───────────────────────────────────────────────────────
  function afficherCreation(afficher) {
    panneauListe.hidden = afficher;
    panneauCreation.hidden = !afficher;
    if (afficher) {
      // Le nom deja tape dans la recherche est repris : ne pas le retaper est tout l'interet.
      champNom.value = requete;
      messageEclair.hidden = true;
      champNom.focus();
    }
  }

  async function creerEclair() {
    const nom = String(champNom.value || '').trim();
    if (!nom) {
      messageEclair.textContent = 'Donnez un nom à l’exercice.';
      messageEclair.hidden = false;
      champNom.focus();
      return;
    }
    let exercice = null;
    try {
      if (typeof onCreerEclair === 'function') exercice = await onCreerEclair({ nom, mode: modeChoisi });
      if (!exercice) {
        // Tout le reste prend ses valeurs par defaut (nouvelExercice) : c'est un exercice
        // complet et valide des maintenant, completable plus tard depuis l'ecran Exercices.
        const brouillon = nouvelExercice({
          nom,
          mode: modeChoisi,
          categorie: modeChoisi === 'cardio' ? 'cardio' : (filtreCategorie || 'corps-entier'),
          metriqueCardio: modeChoisi === 'cardio' ? 'allure' : null,
          userModified: true
        });
        const resultat = await store.commit('exercice:enregistrer', { exercice: brouillon });
        exercice = (resultat && resultat.exercice) || brouillon;
      }
    } catch (err) {
      console.error('[picker-exercice] création éclair en échec', err);
      messageEclair.textContent = 'Création impossible : ' + (err && err.message ? err.message : 'erreur inconnue');
      messageEclair.hidden = false;
      return;
    }
    choisir(exercice);
  }

  function choisir(exercice) {
    if (!exercice) return;
    fermer();
    if (typeof onChoisir === 'function') onChoisir(exercice);
  }

  // ── Delegation : UN seul ecouteur click pour tout le fragment ─────────────
  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');

    if (action === 'choisir') {
      choisir(store.exercice(cible.getAttribute('data-id')));
      return;
    }
    if (action === 'onglet') {
      onglet = cible.getAttribute('data-onglet');
      // Mutation ciblee d'attributs : les boutons d'onglet ne sont jamais reconstruits.
      for (const b of onglets.children) {
        b.setAttribute('aria-selected', b.getAttribute('data-onglet') === onglet ? 'true' : 'false');
      }
      liste.scrollTop = 0;
      remplir();
      return;
    }
    if (action === 'archives') {
      montrerArchives = !montrerArchives;
      boutonArchives.textContent = montrerArchives ? 'Masquer les archivés' : 'Afficher les archivés';
      remplir();
      return;
    }
    if (action === 'eclair') { afficherCreation(true); return; }
    if (action === 'annuler-eclair') { afficherCreation(false); return; }
    if (action === 'mode') {
      modeChoisi = MODES[cible.getAttribute('data-mode')] ? cible.getAttribute('data-mode') : 'charge';
      for (const b of segmentsMode.children) {
        b.setAttribute('aria-selected', b.getAttribute('data-mode') === modeChoisi ? 'true' : 'false');
      }
      return;
    }
    if (action === 'valider-eclair') { creerEclair(); return; }
  }));

  desabonnements.push(on(champ, 'input', () => {
    requete = champ.value || '';
    liste.scrollTop = 0;
    remplir();
  }));

  // Entree dans la recherche : si un seul resultat, on le choisit ; sinon on rend la main au
  // clavier pour degager la liste.
  desabonnements.push(on(champ, 'keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const trouves = candidats();
    if (trouves.length === 1) choisir(trouves[0]);
    else champ.blur();
  }));

  desabonnements.push(on(champNom, 'keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); creerEclair(); }
  }));

  // L'historique arrive en tache de fond : quand il est pret, le tri par frequence recente
  // devient reellement pertinent. On ne reconstruit que la liste — jamais la feuille, jamais le
  // champ de recherche, dont le focus et la selection survivent.
  desabonnements.push(bus.on('historique:pret', () => { if (!panneauListe.hidden) remplir(); }));

  // ── Clavier : la liste ne doit jamais passer sous le clavier ──────────────
  // Sur iOS le clavier ne redimensionne PAS le viewport de mise en page : sans ce calage, la
  // moitie basse de la feuille (donc la liste) devient inatteignable des que le champ a le focus.
  const vv = window.visualViewport || null;
  // Hauteur reservee au pied de feuille (« Créer éclair » + archives), qui doit rester
  // atteignable : c'est justement l'action utile quand la recherche ne trouve rien.
  const RESERVE_PIED = 132;

  function calerHauteur() {
    const dispo = vv ? vv.height : window.innerHeight;
    // Position reelle du haut de la liste dans le viewport visuel : mesuree, et non devinee par
    // une constante, sinon un changement de police ou l'ajout d'un onglet decale tout le calcul.
    const rect = liste.getBoundingClientRect();
    const haut = rect.top - (vv ? vv.offsetTop : 0);
    const restant = dispo - (haut > 0 ? haut : 0) - RESERVE_PIED;
    liste.style.maxHeight = Math.max(180, Math.round(restant)) + 'px';
    liste.style.overflowY = 'auto';
    liste.style.overscrollBehavior = 'contain';
  }
  // Premier calage apres l'insertion dans la feuille : avant, getBoundingClientRect rend 0.
  // Garde de vivacite : la feuille peut avoir ete fermee avant le cadre suivant (Echap immediat,
  // remplacement par une autre feuille) et on mesurerait alors un sous-arbre detache.
  requestAnimationFrame(() => { if (!ferme) calerHauteur(); });
  if (vv) {
    desabonnements.push(on(vv, 'resize', calerHauteur));
    desabonnements.push(on(vv, 'scroll', calerHauteur));
  } else {
    desabonnements.push(on(window, 'resize', calerHauteur));
  }

  // La ligne active est ramenee dans la zone visible quand le clavier apparait.
  desabonnements.push(on(champ, 'focus', () => {
    // Deux frames : le clavier n'a pas encore redimensionne le visualViewport au moment du focus.
    // Le drapeau est teste aux DEUX cadres : la fermeture peut tomber entre les deux.
    requestAnimationFrame(() => {
      if (ferme) return;
      requestAnimationFrame(() => { if (!ferme) calerHauteur(); });
    });
  }));

  remplir();

  // ── Montage dans la feuille basse ─────────────────────────────────────────
  function nettoyer() {
    if (ferme) return;
    ferme = true;
    for (const off of desabonnements) { try { off(); } catch (err) { /* deja detache */ } }
    desabonnements.length = 0;
  }

  function fermer() {
    const p = poignee;
    poignee = null;
    nettoyer();
    if (p && typeof p.fermer === 'function') p.fermer();
  }

  poignee = sheet.ouvrir({
    titre: filtreCategorie ? (LIBELLES_CATEGORIES[filtreCategorie] || 'Exercices') : 'Choisir un exercice',
    contenu: racine,
    // ⚠ La feuille peut etre fermee par le voile, la croix ou Echap, sans passer par fermer() :
    //   sans ce rappel, les abonnements au bus et au visualViewport survivraient a la feuille.
    //   La cle est « onFermer » — c'est la SEULE que sheet.js lit ; toute autre orthographe est
    //   ignoree en silence et fait fuir les huit abonnements de ce fragment.
    onFermer: nettoyer
  }) || { fermer: nettoyer };

  return { fermer };
}
