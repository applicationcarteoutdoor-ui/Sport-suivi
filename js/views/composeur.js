// js/views/composeur.js — routes #/composer, #/composer/routine, #/composer/routine/:id
//
// C'EST L'ECRAN DEMANDE : « l'utilisateur choisit un pack, le pack affiche les icones des
// exercices correspondants, il selectionne ceux qu'il souhaite ajouter, puis chaque exercice
// apparait sous forme de ligne avec son icone, le nombre de series, les repetitions, le poids
// utilise ou l'indication lesté, et eventuellement le temps de repos ».
//
// Un SEUL module sert les trois routes. Ce qui change d'une route a l'autre tient en deux
// choses : le verbe du bouton final (« Commencer la séance » / « Enregistrer la routine ») et ce
// qu'on fait de la liste composee. Tout le reste — packs, grille d'icones, recherche, lignes
// reglables — est rigoureusement identique, et le dupliquer en deux ecrans aurait garanti qu'ils
// divergent au premier correctif.
//
// ── CONTRAT DE RENDU ────────────────────────────────────────────────────────────────────────
// La vue construit son DOM UNE FOIS au montage. Deux zones bougent ensuite, chacune sous une
// regle differente :
//
//   · LA GRILLE D'ICONES est reconstruite a chaque changement de pack ou de recherche. Elle le
//     peut parce qu'elle ne contient AUCUN fragment vivant : ses tuiles sont des boutons inertes
//     sans ecouteur propre (tout passe par la delegation posee sur la racine). La reconstruire ne
//     detruit donc ni saisie, ni etat cache, ni abonnement.
//
//   · LA LISTE DES EXERCICES CHOISIS n'est JAMAIS reconstruite. Chacune de ses lignes possede
//     trois a six steppers, qui sont des fragments vivants (zone C). Une ligne est inseree,
//     DEPLACEE (insertBefore deplace le noeud existant, avec ses enfants et leurs ecouteurs) ou
//     retiree — jamais recalculee en bloc. C'est ce qui permet de reordonner un exercice sans que
//     les valeurs qu'on vient de regler ne repartent a zero.
//
// ── CE QUE CE FICHIER NE FAIT PAS ───────────────────────────────────────────────────────────
//   · Aucun innerHTML : tout passe par h() et icone().
//   · Aucune ecriture directe en base : tout passe par store.commit().
//   · AUCUN test sur un mode. Les reglages d'un exercice sont DERIVES de champsSaisie(exercice),
//     qui lit MODES dans schema.js. Un exercice cardio propose donc duree et distance, un
//     exercice a la barre propose repetitions et charge, un gainage propose une duree — sans
//     qu'une seule ligne d'ici ne connaisse le mot « cardio ».

import { h, on, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatDuree } from '../lib/num.js';
import { dayKey } from '../lib/dates.js';
import { champsSaisie, pasChamp, nouvelItemModele, nouvelExercice, estComptable, estSeanceComptable } from '../data/schema.js';
import { PACKS, PACKS_PAR_ID, exercicesDuPack, compterParPack, packDeLExercice } from '../data/packs.js';
import * as store from '../data/store.js';
import * as session from '../domain/session.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import * as stepper from '../ui/stepper.js';
import * as keypad from '../ui/keypad.js';
import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';
import * as router from '../ui/router.js';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// ─────────────────────────────────────────────────────────────────────────────
// Recherche insensible aux accents et a la casse
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ SANS normalize('NFD') suivi du retrait des diacritiques, « developpe » ne trouve JAMAIS
//   « Développé couché » — or c'est exactement ce qu'on tape au clavier d'un telephone, ou
//   personne ne compose les accents. La ponctuation devient une espace pour que « pull-up » et
//   « pull up » soient la meme requete.
// Bloc Unicode « Combining Diacritical Marks », ecrit en ECHAPPEMENTS et non en caracteres
// litteraux : la regle survit ainsi a n'importe quel outil qui reencoderait ce fichier.
const DIACRITIQUES = /[̀-ͯ]/g;

function normaliser(texte) {
  return String(texte == null ? '' : texte)
    .normalize('NFD')
    .replace(DIACRITIQUES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Nom + ALIAS. Les alias existent pour la recherche et pour rien d'autre : sans eux, chercher
// « pompes » ne remonterait pas un exercice enregistre sous « push-up ».
function indexer(ex) {
  return normaliser([ex.nom].concat(ex.alias || []).join(' '));
}

// Tous les mots de la requete doivent etre presents : « dev couch » trouve « Développé couché ».
function correspond(index, mots) {
  for (const mot of mots) if (index.indexOf(mot) === -1) return false;
  return true;
}

function comparerNoms(a, b) {
  return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base', numeric: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexte de lancement d'une seance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poids de corps a geler sur la seance qui demarre, ou null.
 * ⚠ On ne reporte QUE le poids DU JOUR. Un poids d'hier serait faux sans que rien ne le signale,
 *   et il empecherait views/seance.js — a qui appartient cette saisie — de la proposer.
 */
function poidsDuJour() {
  const aujourdHui = dayKey();
  for (const s of store.seances()) {
    if (!estNombre(s.poidsDeCorpsKg)) continue;
    return s.date === aujourdHui ? s.poidsDeCorpsKg : null;
  }
  return null;
}

/** Lieu preselectionne : le lieu unique s'il n'y en a qu'un, sinon rien (choisi a la cloture). */
function lieuParDefaut() {
  const actifs = store.lieux().filter((l) => l && l.archived !== true);
  return actifs.length === 1 ? actifs[0].id : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cibles d'une ligne
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cibles de depart d'un exercice qu'on vient de selectionner.
 *
 * ⚠ Tout est DERIVE de champsSaisie(exercice) : ce fichier ne teste jamais un mode. La presence
 *   de 'distanceM' parmi les champs de saisie signale une sortie qui se mesure en une seule fois
 *   (une seule serie, aucun repos) ; la presence de 'reps' signale un exercice qui se compte en
 *   repetitions. Aucun nom de mode n'apparait.
 *
 * ⚠ chargeFigee est FAUSSE par defaut : chargeCible reste { type:'derniere' }. Un kilo en dur
 *   dans une routine ment au bout de trois mois de progression — c'est la raison d'etre du type
 *   'derniere', et l'utilisateur doit poser un geste explicite pour y renoncer.
 */
function ciblesParDefaut(exercice) {
  const champs = champsSaisie(exercice);
  const enUneFois = champs.indexOf('distanceM') !== -1;
  return {
    champs,
    series: enUneFois ? 1 : 3,
    repsMin: 8,
    repsMax: 12,
    dureeSec: enUneFois ? 1800 : 45,
    distanceM: 0,
    chargeFigee: false,
    chargeKg: 20,
    reposSec: enUneFois ? 0 : (estNombre(exercice.reposParDefautSec) ? exercice.reposParDefautSec : 120)
  };
}

/**
 * Cibles reprises d'un item de routine existante. Les champs absents retombent sur les defauts :
 * une routine ecrite avant l'ajout d'un reglage ne doit pas produire une ligne a moitie vide.
 */
function ciblesDepuisItem(exercice, item) {
  const base = ciblesParDefaut(exercice);
  if (!item) return base;
  if (estNombre(item.seriesCibles)) base.series = item.seriesCibles;
  if (item.repsCibles) {
    if (estNombre(item.repsCibles.min)) base.repsMin = item.repsCibles.min;
    if (estNombre(item.repsCibles.max)) base.repsMax = item.repsCibles.max;
  }
  if (estNombre(item.dureeCibleSec)) base.dureeSec = item.dureeCibleSec;
  if (estNombre(item.distanceCibleM)) base.distanceM = item.distanceCibleM;
  if (estNombre(item.reposSec)) base.reposSec = item.reposSec;
  // 'fixe' est la seule facon d'exprimer un kilo en dur ; toute autre valeur (dont 'derniere')
  // laisse la charge libre. Meme vocabulaire que views/modeles.js et que domain/prefill.js.
  if (item.chargeCible && item.chargeCible.type === 'fixe' && estNombre(item.chargeCible.kg)) {
    base.chargeFigee = true;
    base.chargeKg = item.chargeCible.kg;
  }
  if (base.repsMax < base.repsMin) base.repsMax = base.repsMin;
  return base;
}

/**
 * Champ qui porte la « charge » pour cet exercice, ou null s'il n'en a pas.
 * Les trois candidats sont mutuellement exclusifs dans MODES, et domain/prefill.js les remplit
 * tous les trois depuis la MEME source (cibles.chargeCible.kg) : une seule commande suffit donc a
 * les couvrir, et seul son libelle change.
 */
function champDeCharge(champs) {
  if (champs.indexOf('chargeKg') !== -1) return 'chargeKg';
  if (champs.indexOf('valeur') !== -1) return 'valeur';
  if (champs.indexOf('lestKg') !== -1) return 'lestKg';
  return null;
}

const LIBELLES_CHARGE = { chargeKg: 'Charge', valeur: 'Cran', lestKg: 'Lest' };
// Libelle du bouton tant que la charge n'est pas figee. « Lesté » est le mot demande : sur un
// exercice lestable, il dit a la fois « cet exercice se leste » et « le poids sera saisi en
// salle », ce qu'aucun chiffre ne saurait dire sans mentir.
const LIBELLES_CHARGE_LIBRE = { chargeKg: 'Dernière', valeur: 'Dernier', lestKg: 'Lesté' };
const UNITES_CHARGE = { chargeKg: 'kg', valeur: '', lestKg: 'kg' };

// ═════════════════════════════════════════════════════════════════════════════
// Montage
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param {Element} conteneur zone B (le <main> d'index.html)
 * @param {Object} params parametres de route ; `id` sur #/composer/routine/:id
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur, params) {
  // La route n'est pas passee a mount() : on la lit sur le routeur, qui a deja pose son chemin
  // avant d'appeler le montage. Repli sur location.hash pour rester montable hors routeur.
  const courant = (typeof router.courant === 'function' && router.courant()) || null;
  const chemin = (courant && courant.chemin) || router.analyserHash(location.hash).chemin;
  const modeRoutine = chemin.indexOf('#/composer/routine') === 0;
  const routineId = (params && params.id) || null;
  const routineSource = routineId ? store.modele(routineId) : null;

  const etat = {
    detruit: false,
    packActif: PACKS[0] ? PACKS[0].id : null,
    requete: '',
    ordre: [],           // ids de ligne, dans l'ordre d'execution
    enregistrement: false,
    feuille: null,       // poignee de la feuille « Créer éclair »
    avertiCharge: false
  };

  const lignes = new Map();      // idLigne    -> descripteur de ligne
  const parExercice = new Map(); // exerciceId -> idLigne (un exercice ne figure qu'une fois)
  const tuiles = new Map();      // exerciceId -> bouton de la grille actuellement affichee
  const pastilles = new Map();   // packId     -> noeud du compteur
  const desabos = [];
  let compteurLignes = 0;

  // v4 : nombre de seances COMPTABLES contenant chaque exercice (avec au moins une serie
  // comptable). Compte UNE FOIS au montage, recompte sur 'historique:pret' — jamais a chaque
  // rendu de grille : store.seances() peut porter trois ans de seances.
  const usageParExercice = new Map(); // exerciceId -> nombre de seances comptables

  function recompterUsages() {
    usageParExercice.clear();
    for (const s of store.seances()) {
      if (!estSeanceComptable(s)) continue;
      const vus = new Set(); // un exercice compte UNE fois par seance
      for (const entree of s.entrees || []) {
        if (!entree || !entree.exerciceId || vus.has(entree.exerciceId)) continue;
        if (!(entree.series || []).some(estComptable)) continue;
        vus.add(entree.exerciceId);
        usageParExercice.set(entree.exerciceId, (usageParExercice.get(entree.exerciceId) || 0) + 1);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sous-arbre, construit UNE SEULE FOIS
  // ───────────────────────────────────────────────────────────────────────────

  // 1. Nom de la routine — present uniquement quand on compose une routine. Un <input> texte est
  //    ici parfaitement legitime : la regle « aucun <input> » vise les NOMBRES saisis en salle
  //    (zoom iOS, conflit virgule/point, champ masque par le clavier), pas un nom tape une fois
  //    assis. Les nombres, eux, passent tous par des steppers et par le pave.
  const champNom = h('input', {
    type: 'text',
    class: 'composeur-nom',
    placeholder: 'Nom de la routine',
    'aria-label': 'Nom de la routine',
    autocomplete: 'off',
    enterkeyhint: 'done',
    value: routineSource ? (routineSource.nom || '') : ''
  });
  const blocNom = h('div', { class: 'composeur-nom-bloc', hidden: !modeRoutine }, champNom);

  // 2. Recherche — elle filtre TOUS les packs a la fois.
  const champRecherche = h('input', {
    type: 'search',
    class: 'composeur-recherche-champ',
    placeholder: 'Rechercher un exercice…',
    'aria-label': 'Rechercher un exercice dans tous les packs',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'search'
  });
  const barreRecherche = h('div', { class: 'composeur-recherche' },
    icone('recherche', { taille: 20, classe: 'composeur-recherche-icone' }),
    champRecherche
  );

  // 3. Rangee de packs, a defilement horizontal. Construite une fois : PACKS est une table figee,
  //    seuls aria-selected et le compteur de chaque tuile changent ensuite.
  const rangeePacks = h('div', {
    class: 'packs-rangee defilement-horizontal',
    role: 'tablist',
    'aria-label': 'Packs d\'exercices'
  });
  for (const pack of PACKS) {
    const compteur = h('span', { class: 'pack-tuile-compteur' }, '0');
    pastilles.set(pack.id, compteur);
    rangeePacks.appendChild(h('button', {
      type: 'button',
      class: 'pack-tuile',
      role: 'tab',
      'data-action': 'pack',
      'data-pack': pack.id,
      'aria-selected': pack.id === etat.packActif ? 'true' : 'false'
    },
      h('span', { class: 'pack-tuile-dessin' }, icone(pack.icone, { taille: 34 })),
      h('span', { class: 'pack-tuile-nom' }, pack.nom),
      compteur
    ));
  }

  // 4. Grille d'icones — SEUL noeud reconstruit, et la vue en est proprietaire exclusive.
  const titreGrille = h('h2', { class: 'composeur-titre-grille' }, '');
  const grille = h('div', { class: 'grille-exercices', role: 'group', 'aria-label': 'Exercices du pack' });

  // 5. Liste des exercices choisis.
  const titreSelection = h('h2', { class: 'selection-titre' }, modeRoutine ? 'Ma routine' : 'Ma séance');
  const compteurSelection = h('span', { class: 'selection-compteur' }, '0');
  const boutonAjouter = h('button', {
    type: 'button',
    class: 'bouton-ajouter',
    'data-action': 'ajouter',
    'aria-label': 'Ajouter un exercice'
  }, icone('plus', { taille: 26 }));

  const listeSelection = h('div', { class: 'selection-lignes' });
  const selectionVide = h('p', { class: 'selection-vide' },
    'Touche une icône ci-dessus pour ajouter un exercice.');

  const blocSelection = h('section', { class: 'selection' },
    h('div', { class: 'selection-entete' }, titreSelection, compteurSelection, boutonAjouter),
    selectionVide,
    listeSelection
  );

  // 6. Barre d'action basse. Elle appartient a la vue : la barre de la coquille (#barre-action)
  //    est celle de l'ecran de seance, et rien ici n'a le droit d'y toucher.
  const boutonFinal = h('button', {
    type: 'button',
    class: 'bouton bouton-primaire bouton-large',
    'data-action': 'valider',
    disabled: true
  }, modeRoutine ? 'Enregistrer la routine' : 'Commencer la séance');
  const barreBasse = h('div', { class: 'composeur-barre' }, boutonFinal);

  const racine = h('section', { class: 'vue vue-composeur', 'data-recherche': 'non' },
    blocNom,
    barreRecherche,
    rangeePacks,
    titreGrille,
    grille,
    blocSelection,
    barreBasse
  );
  conteneur.appendChild(racine);

  // ───────────────────────────────────────────────────────────────────────────
  // Lectures
  // ───────────────────────────────────────────────────────────────────────────

  function exercicesActifs() {
    return store.exercices().filter((ex) => ex && ex.archived !== true);
  }

  /** Exercices affiches dans la grille : resultats de recherche (tous packs) ou pack actif. */
  function exercicesAffiches() {
    const actifs = exercicesActifs();
    const mots = etat.requete ? normaliser(etat.requete).split(' ').filter(Boolean) : [];
    if (!mots.length) {
      // v4 : les exercices les plus UTILISES d'abord (demande utilisateur). Le tri est STABLE
      // (garanti par la spec ES2019) : a egalite d'usage, l'ordre du pack est conserve.
      return exercicesDuPack(etat.packActif, actifs).slice().sort((a, b) =>
        (usageParExercice.get(b.id) || 0) - (usageParExercice.get(a.id) || 0));
    }
    return actifs.filter((ex) => correspond(indexer(ex), mots)).sort(comparerNoms);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Grille d'icones
  // ───────────────────────────────────────────────────────────────────────────

  function marquerTuile(exerciceId) {
    const tuile = tuiles.get(exerciceId);
    if (!tuile) return;
    const choisi = parExercice.has(exerciceId);
    tuile.setAttribute('aria-pressed', choisi ? 'true' : 'false');
    // La coche n'existe visuellement QUE sur une tuile selectionnee. C'est le JS qui commande sa
    // visibilite via l'attribut hidden : aucune regle CSS ne doit l'afficher sans condition.
    const marque = tuile.querySelector('.exercice-tuile-marque');
    if (marque) marque.hidden = !choisi;
  }

  function peindreGrille() {
    vider(grille);
    tuiles.clear();

    const trouves = exercicesAffiches();
    const pack = PACKS_PAR_ID.get(etat.packActif);
    titreGrille.textContent = etat.requete
      ? (trouves.length + (trouves.length > 1 ? ' résultats' : ' résultat'))
      : ((pack && pack.nom) || 'Exercices');

    if (!trouves.length) {
      // « Créer éclair » : quand la recherche ne rend rien, la reponse utile n'est pas un message
      // d'absence, c'est un bouton de creation. Le nom deja tape y sera repris tel quel.
      grille.appendChild(h('div', { class: 'grille-vide' },
        h('p', { class: 'grille-vide-texte' },
          etat.requete
            ? 'Aucun exercice ne correspond à « ' + etat.requete + ' ».'
            : 'Ce pack ne contient encore aucun exercice.'),
        h('button', { type: 'button', class: 'bouton bouton-large', 'data-action': 'creer-eclair' },
          'Créer cet exercice')
      ));
      return;
    }

    for (const ex of trouves) {
      const choisi = parExercice.has(ex.id);
      const tuile = h('button', {
        type: 'button',
        class: 'exercice-tuile',
        'data-action': 'basculer',
        'data-id': ex.id,
        'aria-pressed': choisi ? 'true' : 'false'
      },
        h('span', { class: 'exercice-tuile-dessin' }, icone(iconePourExercice(ex), { taille: 34 })),
        h('span', { class: 'exercice-tuile-nom' }, ex.nom),
        // hidden des la construction quand la tuile n'est pas selectionnee : la grille etant
        // reconstruite a chaque changement de pack ou de recherche, l'etat initial doit etre
        // juste sans attendre un passage par marquerTuile().
        h('span', { class: 'exercice-tuile-marque', 'aria-hidden': 'true', hidden: !choisi },
          icone('coche', { taille: 16 }))
      );
      tuiles.set(ex.id, tuile);
      grille.appendChild(tuile);
    }
  }

  function peindrePacks() {
    const compte = compterParPack(exercicesActifs());
    for (const [packId, noeud] of pastilles) noeud.textContent = String(compte[packId] || 0);
    for (const bouton of rangeePacks.children) {
      // Aucun pack n'est marque actif pendant une recherche : elle porte sur tous a la fois, et
      // laisser une tuile allumee ferait croire que la grille est restreinte a ce pack.
      const actif = !etat.requete && bouton.getAttribute('data-pack') === etat.packActif;
      bouton.setAttribute('aria-selected', actif ? 'true' : 'false');
    }
    racine.setAttribute('data-recherche', etat.requete ? 'oui' : 'non');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Puces de reglage — chacune possede un stepper (fragment vivant)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Monte un stepper dans `hote` et l'enregistre pour destruction avec sa ligne.
   * Le tap sur la valeur ouvre le pave numerique : au-dela d'une dizaine de crans, taper le
   * nombre est plus rapide que le maintenir — c'est exactement ce que stepper.js signale de
   * lui-meme avec sa pastille « Ouvrir le pavé ».
   */
  function monterStepper(ligne, hote, opts) {
    const poignee = stepper.monter(hote, {
      valeur: opts.valeur,
      pas: opts.pas,
      min: opts.min,
      max: opts.max,
      unite: opts.unite,
      libelle: opts.libelle,
      format: opts.format,
      onChange: opts.onChange,
      onTapValeur() {
        keypad.ouvrir({
          champs: [{
            cle: 'v',
            label: opts.libelle,
            valeur: poignee.valeur(),
            unite: opts.unite,
            pas: opts.pas,
            min: opts.min,
            max: opts.max,
            entier: opts.entier === true,
            signe: opts.signe === true,
            format: opts.format
          }],
          onValider(valeurs) {
            const v = valeurs && valeurs.v;
            if (!estNombre(v)) return;
            // ⚠ setValeur n'appelle PAS onChange (c'est le contrat de stepper.js : la valeur est
            //   imposee par le parent). Le modele doit donc etre mis a jour explicitement, sinon
            //   la valeur tapee au pave s'afficherait sans jamais etre enregistree.
            poignee.setValeur(v);
            if (typeof opts.onChange === 'function') opts.onChange(poignee.valeur());
          }
        });
      }
    });
    ligne.steppers.push(poignee);
    return poignee;
  }

  /** Puce complete : un libelle et son stepper. */
  function puceReglage(ligne, opts) {
    const hote = h('div', { class: 'reglage-controle' });
    const puce = h('div', { class: 'reglage' },
      h('span', { class: 'reglage-libelle' }, opts.libelle),
      hote
    );
    const poignee = monterStepper(ligne, hote, opts);
    return { puce, poignee };
  }

  /**
   * Puce de charge. Deux etats dans le MEME noeud :
   *   · libre : un bouton « Dernière » / « Lesté » — aucun kilo n'est ecrit dans la routine ;
   *   · figee : un stepper, plus un avertissement la premiere fois qu'on fige une charge dans une
   *             routine, parce qu'une charge en dur ment apres trois mois de progression.
   * Le passage de l'un a l'autre ne construit QUE le stepper de cette puce : rien d'autre dans la
   * ligne n'est touche.
   */
  function puceCharge(ligne, champ) {
    const hote = h('div', { class: 'reglage-controle' });
    const bouton = h('button', {
      type: 'button',
      class: 'reglage-libre',
      'data-action': 'figer-charge',
      'data-ligne': ligne.id
    }, LIBELLES_CHARGE_LIBRE[champ] || 'Dernière');
    hote.appendChild(bouton);

    const puce = h('div', { class: 'reglage reglage-charge', 'data-figee': 'non' },
      h('span', { class: 'reglage-libelle' }, LIBELLES_CHARGE[champ] || 'Charge'),
      hote
    );

    let monte = false;

    function figer() {
      if (monte) return;
      monte = true;
      bouton.hidden = true;
      puce.setAttribute('data-figee', 'oui');
      ligne.cibles.chargeFigee = true;

      monterStepper(ligne, hote, {
        libelle: LIBELLES_CHARGE[champ] || 'Charge',
        valeur: ligne.cibles.chargeKg,
        // ⚠ pasChamp resout la chaine 'incrementKg' de MODES contre l'exercice : les boutons
        //   avancent du vrai increment de la salle (1,25 kg), jamais d'un kilo arbitraire.
        pas: pasChamp(ligne.exercice, champ),
        // Pas de borne basse sur le lest : il est SIGNE (+10 lest, −20 assistance elastique).
        min: champ === 'lestKg' ? undefined : 0,
        unite: UNITES_CHARGE[champ],
        signe: champ === 'lestKg',
        entier: champ === 'valeur' ? false : false,
        onChange(v) {
          ligne.cibles.chargeKg = v;
          ligne.cibles.chargeFigee = true;
        }
      });

      if (modeRoutine && !etat.avertiCharge) {
        etat.avertiCharge = true;
        toast.afficher(
          'Charge figée : cette routine annoncera ce poids même après des mois de progression.',
          { duree: 8000 }
        );
      }
    }

    return { puce, figer };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Construction d'une ligne d'exercice
  // ───────────────────────────────────────────────────────────────────────────
  // L'ordre des puces EST l'ordre de lecture demande : icone, series, repetitions, charge ou
  // « lesté », repos.

  function creerLigne(exercice, cibles, itemIdSource) {
    const ligne = {
      id: 'lig' + (++compteurLignes),
      exerciceId: exercice.id,
      exercice,
      cibles,
      itemIdSource: itemIdSource || null,
      steppers: [],
      noeud: null,
      boutonMonter: null,
      boutonDescendre: null,
      figerCharge: null
    };

    const champs = cibles.champs;
    const reglages = h('div', { class: 'ligne-exercice-reglages defilement-horizontal' });

    // ── Series : toujours presentes, quel que soit le mode ────────────────────
    reglages.appendChild(puceReglage(ligne, {
      libelle: 'Séries',
      valeur: cibles.series,
      pas: 1, min: 1, max: 20, entier: true,
      onChange(v) { cibles.series = v; }
    }).puce);

    // ── Repetitions : une FOURCHETTE, jamais un entier seul ────────────────────
    // « 8 » se lit comme un ordre rate des qu'on en fait 7. Les deux steppers sont lies : relever
    // le minimum au-dessus du maximum pousse le maximum, et inversement.
    if (champs.indexOf('reps') !== -1) {
      let poigneeMax = null;
      const min = puceReglage(ligne, {
        libelle: 'Reps min',
        valeur: cibles.repsMin,
        pas: 1, min: 1, max: 100, entier: true,
        onChange(v) {
          cibles.repsMin = v;
          if (cibles.repsMax < v) {
            cibles.repsMax = v;
            if (poigneeMax) poigneeMax.setValeur(v);
          }
        }
      });
      const max = puceReglage(ligne, {
        libelle: 'Reps max',
        valeur: cibles.repsMax,
        pas: 1, min: 1, max: 100, entier: true,
        onChange(v) {
          cibles.repsMax = v;
          if (v < cibles.repsMin) {
            cibles.repsMin = v;
            min.poignee.setValeur(v);
          }
        }
      });
      poigneeMax = max.poignee;
      reglages.appendChild(min.puce);
      reglages.appendChild(max.puce);
    }

    // ── Duree ─────────────────────────────────────────────────────────────────
    if (champs.indexOf('dureeSec') !== -1) {
      reglages.appendChild(puceReglage(ligne, {
        libelle: 'Durée',
        valeur: cibles.dureeSec,
        pas: pasChamp(exercice, 'dureeSec'),
        min: 0, entier: true,
        // ⚠ Une duree s'affiche « 10:00 », jamais « 600 » : c'est tout l'interet de l'option
        //   `format` de stepper.js.
        format: (v) => formatDuree(v),
        onChange(v) { cibles.dureeSec = v; }
      }).puce);
    }

    // ── Distance (optionnelle : 0 signifie « non mesurée ») ────────────────────
    if (champs.indexOf('distanceM') !== -1) {
      reglages.appendChild(puceReglage(ligne, {
        libelle: 'Distance',
        valeur: cibles.distanceM,
        pas: pasChamp(exercice, 'distanceM'),
        min: 0, unite: 'm', entier: true,
        onChange(v) { cibles.distanceM = v; }
      }).puce);
    }

    // ── Charge, cran ou lest ──────────────────────────────────────────────────
    const champCharge = champDeCharge(champs);
    if (champCharge) {
      const charge = puceCharge(ligne, champCharge);
      ligne.figerCharge = charge.figer;
      reglages.appendChild(charge.puce);
      // Routine rouverte avec une charge deja figee : on remonte le stepper directement, sans
      // faire repasser l'utilisateur par le bouton.
      if (cibles.chargeFigee) charge.figer();
    }

    // v4 : plus de reglage de repos (retour utilisateur). La valeur par defaut reste dans les
    // donnees (ciblesParDefaut) : rien n'est perdu si le reglage revient un jour.

    // ── Commandes de ligne ────────────────────────────────────────────────────
    ligne.boutonMonter = h('button', {
      type: 'button', class: 'ligne-commande', 'data-action': 'monter', 'data-ligne': ligne.id,
      'aria-label': 'Monter ' + exercice.nom
    }, icone('chevron-bas', { taille: 20, classe: 'chevron-inverse' }));

    ligne.boutonDescendre = h('button', {
      type: 'button', class: 'ligne-commande', 'data-action': 'descendre', 'data-ligne': ligne.id,
      'aria-label': 'Descendre ' + exercice.nom
    }, icone('chevron-bas', { taille: 20 }));

    const boutonRetirer = h('button', {
      type: 'button', class: 'ligne-commande ligne-commande-retirer',
      'data-action': 'retirer', 'data-ligne': ligne.id,
      'aria-label': 'Retirer ' + exercice.nom
    }, icone('croix', { taille: 20 }));

    const pack = PACKS_PAR_ID.get(packDeLExercice(exercice));

    ligne.noeud = h('div', { class: 'ligne-exercice', 'data-ligne': ligne.id },
      h('div', { class: 'ligne-exercice-entete' },
        h('span', { class: 'ligne-exercice-dessin' }, icone(iconePourExercice(exercice), { taille: 28 })),
        h('div', { class: 'ligne-exercice-titre' },
          h('span', { class: 'ligne-exercice-nom' }, exercice.nom),
          h('span', { class: 'ligne-exercice-pack' }, (pack && pack.nom) || '')
        ),
        h('div', { class: 'ligne-exercice-commandes' },
          ligne.boutonMonter, ligne.boutonDescendre, boutonRetirer)
      ),
      reglages
    );

    return ligne;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Selection
  // ───────────────────────────────────────────────────────────────────────────

  function majEtatSelection() {
    const total = etat.ordre.length;
    compteurSelection.textContent = String(total);
    selectionVide.hidden = total > 0;
    boutonFinal.disabled = total === 0 || etat.enregistrement;
    for (let i = 0; i < total; i++) {
      const ligne = lignes.get(etat.ordre[i]);
      if (!ligne) continue;
      ligne.boutonMonter.disabled = i === 0;
      ligne.boutonDescendre.disabled = i === total - 1;
    }
  }

  function ajouterExercice(exercice, cibles, itemIdSource) {
    if (!exercice || parExercice.has(exercice.id)) return null;
    const ligne = creerLigne(exercice, cibles || ciblesParDefaut(exercice), itemIdSource);
    lignes.set(ligne.id, ligne);
    parExercice.set(exercice.id, ligne.id);
    etat.ordre.push(ligne.id);
    listeSelection.appendChild(ligne.noeud);
    marquerTuile(exercice.id);
    majEtatSelection();
    return ligne;
  }

  function retirerLigne(idLigne) {
    const ligne = lignes.get(idLigne);
    if (!ligne) return;
    // ⚠ Les fragments vivants sont detruits AVANT que leur hote ne quitte le document : leur
    //   detruire() coupe les ecouteurs pointeur et retire les noeuds qu'ils ont crees. L'ordre
    //   inverse laisserait une capture de pointeur active sur un sous-arbre detache.
    for (const poignee of ligne.steppers) {
      try { poignee.detruire(); } catch (err) { console.warn('[composeur] stepper non détruit', err); }
    }
    ligne.steppers.length = 0;
    if (ligne.noeud.parentNode) ligne.noeud.parentNode.removeChild(ligne.noeud);
    lignes.delete(idLigne);
    parExercice.delete(ligne.exerciceId);
    const i = etat.ordre.indexOf(idLigne);
    if (i !== -1) etat.ordre.splice(i, 1);
    marquerTuile(ligne.exerciceId);
    majEtatSelection();
  }

  /**
   * Reordonnancement. insertBefore DEPLACE le noeud existant : ses enfants, donc les steppers et
   * leurs ecouteurs, sont preserves tels quels. Reconstruire la ligne a sa nouvelle place aurait
   * remis toutes ses valeurs a leur defaut — et c'est precisement le geste qu'on fait apres les
   * avoir reglees.
   */
  function deplacerLigne(idLigne, delta) {
    const i = etat.ordre.indexOf(idLigne);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= etat.ordre.length) return;
    etat.ordre.splice(i, 1);
    etat.ordre.splice(j, 0, idLigne);

    const ligne = lignes.get(idLigne);
    const suivante = etat.ordre[j + 1] ? lignes.get(etat.ordre[j + 1]) : null;
    listeSelection.insertBefore(ligne.noeud, suivante ? suivante.noeud : null);
    majEtatSelection();

    // Deplacer un noeud lui fait perdre le focus : sans cette restitution, remonter un exercice
    // de trois rangs obligerait a viser le bouton a nouveau apres chaque tap.
    const vise = delta < 0 ? ligne.boutonMonter : ligne.boutonDescendre;
    const repli = delta < 0 ? ligne.boutonDescendre : ligne.boutonMonter;
    const cible = vise && !vise.disabled ? vise : repli;
    if (cible && !cible.disabled) {
      try { cible.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
    }
  }

  /** Un tap SELECTIONNE, un second DESELECTIONNE. La selection survit au changement de pack. */
  function basculerExercice(exerciceId) {
    const dejaLa = parExercice.get(exerciceId);
    if (dejaLa) { retirerLigne(dejaLa); return; }
    const ex = store.exercice(exerciceId);
    if (!ex) return;
    ajouterExercice(ex);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Feuille « Créer éclair »
  // ───────────────────────────────────────────────────────────────────────────
  // Un nom, un pack, et c'est tout. Categorie, increment, facteur de poids de corps et repos
  // prennent leurs valeurs par defaut : l'exercice est complet et valide immediatement, et se
  // precise plus tard depuis l'ecran Exercices. Le cas reel est « la machine est occupée, je la
  // remplace, je veux enregistrer une serie dans les quinze secondes ».

  function fermerFeuille() {
    const p = etat.feuille;
    if (!p) return;
    etat.feuille = null;
    try { p.fermer(); } catch (_) { /* deja fermee */ }
  }

  function ouvrirFeuilleEclair() {
    if (etat.feuille) return;

    let packChoisi = etat.packActif;

    const champEclair = h('input', {
      type: 'text',
      class: 'composeur-nom',
      placeholder: 'Nom de l’exercice',
      'aria-label': 'Nom de l’exercice',
      autocomplete: 'off',
      enterkeyhint: 'done',
      value: etat.requete
    });

    const rangee = h('div', {
      class: 'eclair-packs defilement-horizontal',
      role: 'radiogroup',
      'aria-label': 'Pack de l\'exercice'
    });
    for (const pack of PACKS) {
      rangee.appendChild(h('button', {
        type: 'button',
        class: 'eclair-pack',
        role: 'radio',
        'data-pack': pack.id,
        'aria-checked': pack.id === packChoisi ? 'true' : 'false'
      },
        icone(pack.icone, { taille: 26 }),
        h('span', { class: 'eclair-pack-nom' }, pack.nom)
      ));
    }

    const message = h('p', { class: 'eclair-message', hidden: true, role: 'alert' });
    const corps = h('div', { class: 'eclair' }, champEclair, rangee, message);

    const detacher = [];
    detacher.push(delegate(rangee, 'click', '[data-pack]', (ev, cible) => {
      packChoisi = cible.getAttribute('data-pack');
      for (const b of rangee.children) {
        b.setAttribute('aria-checked', b.getAttribute('data-pack') === packChoisi ? 'true' : 'false');
      }
    }));
    detacher.push(on(champEclair, 'keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); creer(); }
    }));

    async function creer() {
      const nom = String(champEclair.value || '').trim();
      if (!nom) {
        message.textContent = 'Donne un nom à l’exercice.';
        message.hidden = false;
        champEclair.focus();
        return;
      }
      const pack = PACKS_PAR_ID.get(packChoisi) || PACKS[0];
      try {
        // Mode et materiel sont DEDUITS du pack : ce sont les deux champs que packs.js declare
        // pour lui, donc packDeLExercice() rangera l'exercice cree dans ce meme pack. La boucle
        // est fermee, l'utilisateur retrouve son exercice la ou il l'a cree.
        const brouillon = nouvelExercice({
          nom,
          mode: (pack.modes && pack.modes[0]) || 'charge',
          materiel: (pack.materiels && pack.materiels[0]) || 'aucun',
          categorie: pack.id === 'cardio' ? 'cardio' : 'corps-entier',
          metriqueCardio: pack.id === 'cardio' ? 'allure' : null,
          userModified: true
        });
        const resultat = await store.commit('exercice:enregistrer', { exercice: brouillon });
        if (etat.detruit) return;
        const cree = (resultat && resultat.exercice) || brouillon;

        fermerFeuille();
        // La recherche est effacee et le pack de l'exercice affiche : on veut VOIR ce qu'on vient
        // de creer, marque comme choisi, plutot que de rester devant une grille vide.
        etat.requete = '';
        champRecherche.value = '';
        etat.packActif = packDeLExercice(cree);
        ajouterExercice(cree);
        peindrePacks();
        peindreGrille();
        toast.afficher('« ' + cree.nom + ' » créé et ajouté.', { duree: 6000 });
      } catch (err) {
        console.error('[composeur] création éclair en échec', err);
        message.textContent = 'Création impossible : ' + (err && err.message ? err.message : 'erreur inconnue');
        message.hidden = false;
      }
    }

    function nettoyer() {
      for (const off of detacher) { try { off(); } catch (_) { /* deja detache */ } }
      detacher.length = 0;
      if (!etat.feuille) return;
      etat.feuille = null;
      // Retire ?sheet=… de l'URL. Sans cela, fermer par Echap ou par le voile laisserait le
      // parametre en place, et le retour d'Android rouvrirait la feuille qu'on vient de fermer.
      if (!etat.detruit) router.fermerFeuille();
    }

    etat.feuille = sheet.ouvrir({
      titre: 'Créer un exercice',
      classe: 'feuille-eclair',
      contenu: corps,
      // ⚠ La cle est « onFermer » : c'est la SEULE que sheet.js lit. Toute autre orthographe est
      //   ignoree en silence et ferait fuir les ecouteurs de cette feuille.
      onFermer: nettoyer,
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        // fermeApres:false — la feuille reste ouverte si la creation echoue, sinon la saisie
        // disparaitrait avec le message d'erreur.
        { libelle: 'Créer et ajouter', variante: 'primaire', fermeApres: false, action: creer }
      ]
    }) || null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Validation finale
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Traduit les lignes en items de Modele.
   * ⚠ repsCibles est une FOURCHETTE, et n'est ecrite que si l'exercice se compte en repetitions ;
   *   dureeCibleSec et distanceCibleM ne le sont que si le mode les saisit. Ecrire des champs
   *   etrangers au mode les ferait relire par domain/prefill.js, qui pre-remplirait alors des
   *   valeurs sans aucun sens pour cet exercice.
   */
  function itemsComposes() {
    return etat.ordre.map((id) => {
      const ligne = lignes.get(id);
      const c = ligne.cibles;
      const champs = c.champs;
      return nouvelItemModele({
        // L'id d'item d'une routine editee est PRESERVE : c'est la cle de reconciliation de
        // l'import « fusionner ». Le regenerer ferait apparaitre chaque exercice en double.
        id: ligne.itemIdSource || null,
        exerciceId: ligne.exerciceId,
        seriesCibles: c.series,
        seriesEchauffement: 0,
        repsCibles: champs.indexOf('reps') !== -1 ? { min: c.repsMin, max: c.repsMax } : null,
        dureeCibleSec: champs.indexOf('dureeSec') !== -1 ? c.dureeSec : null,
        // Distance a 0 = « non mesurée » : on ecrit null plutot qu'un zero, qui serait relu comme
        // une distance reellement visee et donnerait une allure absurde.
        distanceCibleM: (champs.indexOf('distanceM') !== -1 && c.distanceM > 0) ? c.distanceM : null,
        chargeCible: (c.chargeFigee && champDeCharge(champs))
          ? { type: 'fixe', kg: c.chargeKg }
          : { type: 'derniere', delta: 0 },
        reposSec: c.reposSec
      });
    });
  }

  async function finaliser() {
    if (etat.enregistrement || etat.detruit || !etat.ordre.length) return;

    // Le nom est verifie AVANT de verrouiller le bouton : une routine sans nom doit pouvoir etre
    // corrigee immediatement, pas laisser l'ecran fige.
    const nom = modeRoutine ? String(champNom.value || '').trim() : '';
    if (modeRoutine && !nom) {
      toast.afficher('Donne un nom à ta routine.');
      champNom.focus();
      return;
    }

    const items = itemsComposes();
    etat.enregistrement = true;
    boutonFinal.disabled = true;

    try {
      if (modeRoutine) {
        if (routineSource) {
          await store.commit('routine:modifier', {
            modele: Object.assign({}, routineSource, { nom, items })
          });
        } else {
          await store.commit('routine:creer', { nom, items });
        }
        if (etat.detruit) return;
        toast.afficher('Routine « ' + nom + ' » enregistrée.', { duree: 6000 });
        router.aller('#/modeles');
        return;
      }

      // Seance immediate. Le modele passe a session.demarrer() n'est PAS persiste et porte un id
      // NUL : nouvelleSeance en fait alors `modeleId: null` tout en conservant modeleSnapshot. La
      // seance sait donc ce qui etait prevu, sans referencer un modele qui n'existe nulle part —
      // un modeleId pointant dans le vide serait une reference morte a vie dans l'historique.
      const modeleEphemere = {
        id: null,
        nom: 'Séance composée',
        description: '',
        dureeEstimeeMin: null,
        items,
        origine: 'utilisateur',
        archived: false
      };

      const seance = session.demarrer(modeleEphemere, {
        // domain/ n'a pas le droit de lire le store : on lui passe le resolveur d'exercices,
        // indispensable au GEL des coefficients sur chaque entree.
        exercices: (id) => store.exercice(id),
        poidsDeCorpsKg: poidsDuJour(),
        lieuId: lieuParDefaut()
      });

      await store.commit('seance:demarrer', { seance });
      if (etat.detruit) return;
      router.aller('#/seance');
    } catch (err) {
      console.error('[composeur] enregistrement en échec', err);
      toast.afficher(err && err.message ? err.message : 'L\'enregistrement a échoué.');
    } finally {
      etat.enregistrement = false;
      if (!etat.detruit) majEtatSelection();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Delegation : UN SEUL ecouteur click pour toute la vue
  // ───────────────────────────────────────────────────────────────────────────

  desabos.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');

    if (action === 'pack') {
      // Choisir un pack sort de la recherche : celle-ci porte sur TOUS les packs, la laisser
      // active ferait ignorer le pack qu'on vient de toucher.
      etat.packActif = cible.getAttribute('data-pack');
      if (etat.requete) { etat.requete = ''; champRecherche.value = ''; }
      grille.scrollTop = 0;
      peindrePacks();
      peindreGrille();
      return;
    }

    if (action === 'basculer') { basculerExercice(cible.getAttribute('data-id')); return; }
    if (action === 'monter') { deplacerLigne(cible.getAttribute('data-ligne'), -1); return; }
    if (action === 'descendre') { deplacerLigne(cible.getAttribute('data-ligne'), 1); return; }
    if (action === 'retirer') { retirerLigne(cible.getAttribute('data-ligne')); return; }

    if (action === 'figer-charge') {
      const ligne = lignes.get(cible.getAttribute('data-ligne'));
      if (ligne && typeof ligne.figerCharge === 'function') ligne.figerCharge();
      return;
    }

    if (action === 'ajouter') {
      // Le bouton « + » ne fait qu'une chose : ramener a la grille. Ce n'est pas une navigation,
      // c'est un retour visuel — la selection en cours reste montee, juste en dessous.
      try { grille.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      catch (_) { grille.scrollIntoView(); }
      try { champRecherche.focus({ preventScroll: true }); } catch (_) { /* sans consequence */ }
      return;
    }

    if (action === 'creer-eclair') { router.ouvrirFeuille('creer-eclair'); return; }
    if (action === 'valider') { finaliser(); return; }
  }));

  desabos.push(on(champRecherche, 'input', () => {
    etat.requete = champRecherche.value || '';
    grille.scrollTop = 0;
    peindrePacks();
    peindreGrille();
  }));

  // Entree dans la recherche : un resultat unique est bascule directement, sinon on rend la main
  // au clavier pour degager la grille.
  desabos.push(on(champRecherche, 'keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const trouves = exercicesAffiches();
    if (trouves.length === 1) basculerExercice(trouves[0].id);
    else champRecherche.blur();
  }));

  // Un exercice cree ou archive ailleurs (ecran Exercices, autre onglet) doit apparaitre — ou
  // disparaitre — dans les compteurs et la grille sans qu'on ait a quitter cet ecran.
  function rafraichirCatalogue() {
    if (etat.detruit) return;
    peindrePacks();
    peindreGrille();
  }
  desabos.push(bus.on('exercice:enregistrer', rafraichirCatalogue));
  desabos.push(bus.on('exercice:archiver', rafraichirCatalogue));

  // L'historique arrive en tache de fond : quand il est pret, les compteurs d'usage deviennent
  // exacts et la grille se reordonne. Un seul recomptage, pas un par rendu.
  desabos.push(bus.on('historique:pret', () => {
    if (etat.detruit) return;
    recompterUsages();
    peindreGrille();
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // Amorcage
  // ───────────────────────────────────────────────────────────────────────────

  // L'historique n'est pas necessaire ICI, mais il l'est a l'ecran de seance juste apres : le
  // demander maintenant le rend pret avant le premier rappel « Dernière fois ». Idempotent.
  store.chargerHistorique();

  // Comptage initial des usages : store.seances() peut deja etre rempli (autre ecran visite
  // avant). S'il est vide, l'abonnement 'historique:pret' ci-dessus completera.
  recompterUsages();

  // Edition d'une routine existante : on rejoue ses items, dans l'ordre.
  if (routineSource && Array.isArray(routineSource.items)) {
    for (const item of routineSource.items) {
      const ex = store.exercice(item.exerciceId);
      // Exercice introuvable (import partiel, catalogue desynchronise) : on saute l'item plutot
      // que de fabriquer une ligne sans mode, dont aucun reglage ne serait derivable. Degrader,
      // jamais bloquer l'ouverture de la routine.
      if (!ex) continue;
      ajouterExercice(ex, ciblesDepuisItem(ex, item), item.id);
    }
    // Le pack affiche au depart est celui du premier exercice de la routine : on reprend la
    // composition la ou elle en etait, plutot qu'au premier pack de la liste.
    const premiere = lignes.get(etat.ordre[0]);
    if (premiere) etat.packActif = packDeLExercice(premiere.exercice);
  }

  peindrePacks();
  peindreGrille();
  majEtatSelection();

  // Feuille demandee des l'URL d'entree (lien partage, rechargement) : elle s'ouvre au montage.
  if (params && params.sheet === 'creer-eclair') ouvrirFeuilleEclair();

  // ───────────────────────────────────────────────────────────────────────────
  // Contrat de vue
  // ───────────────────────────────────────────────────────────────────────────

  return {
    /**
     * Seuls les parametres de requete ont change (ouverture ou fermeture d'une feuille) : la vue
     * n'est PAS remontee, la selection et tous ses steppers restent exactement en place.
     */
    onParams(p) {
      if (etat.detruit) return;
      const veutFeuille = !!(p && p.sheet === 'creer-eclair');
      if (veutFeuille && !etat.feuille) ouvrirFeuilleEclair();
      else if (!veutFeuille && etat.feuille) fermerFeuille();
    },

    destroy() {
      etat.detruit = true;
      for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
      desabos.length = 0;
      fermerFeuille();
      // Chaque fragment vivant est detruit explicitement : vider le conteneur ne desabonnerait
      // pas les ecouteurs pointeur que les steppers ont poses sur leurs propres boutons.
      for (const ligne of lignes.values()) {
        for (const poignee of ligne.steppers) {
          try { poignee.detruire(); } catch (err) { console.warn('[composeur] stepper non détruit', err); }
        }
        ligne.steppers.length = 0;
      }
      lignes.clear();
      parExercice.clear();
      tuiles.clear();
      etat.ordre.length = 0;
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    }
  };
}

export default { mount };
