// views/progression.js — routes #/progression et #/progression/:exerciceId.
//
// v2 : l'ecran s'ouvre sur une GRILLE D'ICONES des exercices REELLEMENT PRATIQUES. Plus de
// selecteur a ouvrir pour le cas courant — on voit ce qu'on a fait, on tape dessus, la courbe
// apparait. Le catalogue complet reste accessible, mais en second rideau : il ne sert qu'a
// consulter un exercice jamais pratique, c'est-a-dire une courbe vide.
//
// CONTRAT DE RENDU (zone B) : le DOM de cette vue est construit UNE SEULE FOIS au montage.
// Il n'existe aucune fonction rerender(). Changer d'exercice, de plage ou de metrique ne
// remplace que les noeuds que la vue POSSEDE reellement :
//   - la grille d'icones (reconstruite quand la LISTE change ; sinon on ne mute que des attributs),
//   - la barre de metriques et les puces de comparaison (idem),
//   - le corps du tableau chronologique,
//   - la courbe, qui est un FRAGMENT VIVANT : on appelle detruire() puis renderLineChart(),
//     jamais vider() sur son conteneur (ui/chart.js le documente explicitement).
// L'en-tete, les segments de plage et l'ossature du tableau ne sont JAMAIS retouches.
//
// AUCUN test sur le mode de l'exercice ici : les metriques proposables viennent de
// domain/progression.metriquesDisponibles(), qui les derive de MODES. Ajouter un mode demain
// n'ouvre pas ce fichier.
//
// ⚠ Les seances ABANDONNEES n'entrent dans AUCUN comptage : estSeanceComptable est le seul
//   filtre, ici comme dans le domaine.

import { h, on, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatFr, formatDuree, formatAllure } from '../lib/num.js';
import { formatLong, formatCourt, dayKey, joursEntre, plage as plageDe } from '../lib/dates.js';
import * as store from '../data/store.js';
import * as prefs from '../data/prefs.js';
import {
  LIBELLES_METRIQUES, UNITES, metriqueParDefaut, estComptable, estSeanceComptable
} from '../data/schema.js';
import {
  metriquesDisponibles, serieTemporelle, tableauChronologique, records
} from '../domain/progression.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import { renderLineChart } from '../ui/chart.js';
import * as picker from '../ui/picker-exercice.js';
import { aller } from '../ui/router.js';

// Plages proposees. L'ordre est celui de la lecture : du plus resserre au plus large, parce que
// la question posee en salle est « et ces derniers mois ? » avant « et depuis toujours ? ».
const PLAGES = ['3m', '1a', 'tout'];

// Nombre de seances du tableau. Le plan le fixe a 20 : au-dela on ne consulte plus, on parcourt.
const N_TABLEAU = 20;

// Plafond de courbes superposees. Aligne sur celui de ui/chart.js : le refuser ICI evite a
// l'utilisateur de selectionner une cinquieme icone pour rien.
const MAX_COMPARAISON = 4;

// Duree de l'appui long qui bascule en comparaison. 500 ms : la meme que dans set-row.js, pour
// que le geste s'apprenne une seule fois dans toute l'application.
const APPUI_LONG_MS = 500;

// Au-dela de ce deplacement, l'appui long est annule : le doigt fait defiler la grille, il ne
// selectionne pas.
const TOLERANCE_GLISSE_PX = 10;

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Formate une valeur selon l'unite BRUTE de data/schema.UNITES.
 * Meme regle que dans ui/chart.js : 'sec' se lit « 1:30 » et 'sec-par-km' « 5:42 ».
 * Afficher « 342 sec » serait exact et illisible.
 */
function formatValeur(v, unite) {
  if (!estNombre(v)) return '—';
  if (unite === 'sec') return formatDuree(v);
  if (unite === 'sec-par-km') return `${formatAllure(v)} /km`;
  const nombre = formatFr(v);
  return unite ? `${nombre} ${unite}` : nombre;
}

/** Anciennete lisible d'une date, en trois mots maximum. « il y a 340 jours » ne se lit pas. */
function depuisQuand(date) {
  const j = joursEntre(date, dayKey());
  if (j == null) return '';
  if (j <= 0) return 'aujourd’hui';
  if (j === 1) return 'hier';
  if (j < 7) return `il y a ${j} j`;
  if (j < 60) return `il y a ${Math.round(j / 7)} sem.`;
  return `il y a ${Math.round(j / 30)} mois`;
}

/**
 * Exercices REELLEMENT PRATIQUES, tries par frequence recente puis par date de derniere pratique.
 *
 * ⚠ Un exercice sans aucune serie comptable n'y figure pas : une seance entierement en
 *   echauffement, ou un exercice passe, ne fabrique pas une icone qui n'ouvrirait qu'une courbe
 *   vide. C'est toute la difference entre cette grille et le catalogue.
 *
 * @returns {{ id, nom, exercice, derniere, recentes, total }[]}
 */
function exercicesPratiques() {
  const stats = new Map();
  // « Recent » = la fenetre la plus courte proposee par lib/dates : trois mois. Compter sur
  // toute la vie ferait remonter en tete un exercice abandonne il y a deux ans mais tres pratique
  // a l'epoque — exactement l'inverse de ce qu'on vient chercher.
  const seuilRecent = plageDe('3m').debut;

  for (const s of store.seances()) {
    if (!estSeanceComptable(s)) continue;
    const entrees = Array.isArray(s.entrees) ? s.entrees : [];
    for (const e of entrees) {
      if (!e || !e.exerciceId) continue;
      const sets = (Array.isArray(e.series) ? e.series : []).filter(estComptable);
      if (!sets.length) continue;

      let stat = stats.get(e.exerciceId);
      if (!stat) {
        stat = { id: e.exerciceId, nomSecours: e.nomAffiche || null, derniere: '', recentes: 0, total: 0 };
        stats.set(e.exerciceId, stat);
      }
      stat.total++;
      if (s.date >= seuilRecent) stat.recentes++;
      if (s.date > stat.derniere) stat.derniere = s.date;
    }
  }

  const liste = [];
  for (const stat of stats.values()) {
    const ex = store.exercice(stat.id);
    liste.push({
      id: stat.id,
      // nomAffiche est le SECOURS documente par le schema : un exercice fantome (import d'un
      // appareil ou l'exercice n'existe pas) garde ainsi un nom lisible plutot qu'un identifiant.
      nom: (ex && ex.nom) || stat.nomSecours || 'Exercice inconnu',
      exercice: ex,
      derniere: stat.derniere,
      recentes: stat.recentes,
      total: stat.total
    });
  }

  liste.sort((a, b) => {
    if (b.recentes !== a.recentes) return b.recentes - a.recentes;
    if (a.derniere !== b.derniere) return a.derniere < b.derniere ? 1 : -1;
    return a.nom.localeCompare(b.nom, 'fr');
  });
  return liste;
}

/**
 * Monte la vue Progression.
 * @param {Element} conteneur
 * @param {Object} params  { exerciceId? } fourni par le routeur
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur, params = {}) {
  const desabonnements = [];
  let courbe = null;              // fragment vivant : { detruire() }

  // selection[0] est la serie PRINCIPALE : celle du tableau, des records et du titre.
  let selection = [];
  let modeComparaison = false;
  let metrique = null;            // resolue a chaque changement de selection
  let pratiques = [];             // instantane courant de la grille
  let signatureGrille = '';       // pour ne reconstruire la grille QUE si la liste a change

  let nomPlage = prefs.lire().plageCourbe || '3m';
  if (PLAGES.indexOf(nomPlage) === -1) nomPlage = '3m';

  // ── Ossature, construite UNE fois ─────────────────────────────────────────

  const titreGrille = h('h3', { class: 'section-titre' }, 'Tes exercices');

  const boutonComparer = h('button', {
    type: 'button',
    class: 'bouton bouton-fantome bouton-comparer',
    'data-action': 'comparer',
    'aria-pressed': 'false'
  }, icone('plus', { taille: 18 }), h('span', null, 'Comparer'));

  const lienCatalogue = h('button', {
    type: 'button',
    class: 'lien-catalogue',
    'data-action': 'catalogue'
  }, icone('recherche', { taille: 16 }), h('span', null, 'Catalogue complet'));

  const grille = h('div', {
    class: 'grille-exercices',
    role: 'group',
    'aria-label': 'Exercices déjà pratiqués'
  });

  // Puces de comparaison : visibles uniquement en mode comparaison. Elles disent, en clair, ce
  // que la legende de la courbe dit en couleurs — l'un ne remplace pas l'autre.
  const puces = h('div', { class: 'barre-comparaison', hidden: true });

  const blocGrille = h('section', { class: 'bloc-exercices' },
    h('div', { class: 'entete-section' },
      titreGrille,
      h('div', { class: 'entete-actions' }, boutonComparer, lienCatalogue)
    ),
    grille,
    puces
  );

  // Plages : segments statiques. Seul aria-selected bouge — jamais les noeuds.
  const segmentsPlage = h('div', { class: 'segments', role: 'tablist', 'aria-label': 'Plage affichée' },
    ...PLAGES.map((nom) => h('button', {
      type: 'button',
      class: 'segment',
      role: 'tab',
      'data-action': 'plage',
      'data-plage': nom,
      'aria-selected': nom === nomPlage ? 'true' : 'false'
    }, plageDe(nom).libelle))
  );

  // Metriques : conteneur stable, contenu reconstruit a chaque changement de selection (le mode
  // change, donc la liste change). Ce noeud appartient a la vue, rien d'autre n'y touche.
  const barreMetriques = h('div', { class: 'metriques', role: 'tablist', 'aria-label': 'Métrique affichée' });

  // Message de repli du 1RM estime, et message d'absence de metrique commune. Une courbe qui
  // change de metrique sans le dire est incomprehensible : le message est rendu MOT POUR MOT tel
  // que le domaine le retourne.
  const avisMetrique = h('p', { class: 'courbe-avis', role: 'status', hidden: true });

  // Hote de la courbe. ⚠ On ne le vide JAMAIS : le fragment retire lui-meme sa racine.
  const hoteCourbe = h('div', { class: 'hote-courbe' });

  const listeRecords = h('div', { class: 'carte' });
  const blocRecords = h('section', {},
    h('h3', { class: 'section-titre' }, 'Records'),
    listeRecords
  );

  const corpsTableau = h('tbody', {});
  const tableau = h('table', { class: 'tableau-chrono' },
    h('thead', {},
      h('tr', {},
        h('th', { scope: 'col' }, 'Date'),
        h('th', { scope: 'col' }, 'Meilleure série'),
        h('th', { scope: 'col' }, 'Tonnage'),
        h('th', { scope: 'col' }, 'Séries')
      )
    ),
    corpsTableau
  );

  const titreTableau = h('h3', { class: 'section-titre' }, `${N_TABLEAU} dernières séances`);

  const racine = h('section', { class: 'vue-progression' },
    blocGrille,
    segmentsPlage,
    barreMetriques,
    avisMetrique,
    hoteCourbe,
    blocRecords,
    titreTableau,
    tableau
  );

  // ── Acces a la selection ──────────────────────────────────────────────────

  const principal = () => selection[0] || null;

  function nomDe(id) {
    const ex = store.exercice(id);
    if (ex && ex.nom) return ex.nom;
    const p = pratiques.find((x) => x.id === id);
    return (p && p.nom) || 'Exercice';
  }

  function exerciceDe(id) {
    const ex = store.exercice(id);
    if (ex) return ex;
    const p = pratiques.find((x) => x.id === id);
    return (p && p.exercice) || null;
  }

  /** Exercices reellement resolus de la selection. Un fantome sans fiche n'a aucune metrique. */
  const exercicesSelectionnes = () => selection.map(exerciceDe).filter(Boolean);

  /**
   * Metriques COMMUNES a toute la selection.
   * ⚠ L'intersection porte sur la CLE de metrique, et la cle determine l'unite (data/schema.UNITES).
   *   Comparer deux exercices sur une metrique commune, c'est donc les comparer dans la meme
   *   unite par construction — la garde d'unites de ui/chart.js n'est qu'une seconde barriere.
   */
  function metriquesCommunes() {
    const exs = exercicesSelectionnes();
    if (!exs.length) return [];
    let liste = metriquesDisponibles(exs[0]);
    for (let i = 1; i < exs.length; i++) {
      const cles = metriquesDisponibles(exs[i]).map((m) => m.cle);
      liste = liste.filter((m) => cles.indexOf(m.cle) !== -1);
    }
    return liste;
  }

  // ── Peinture ciblee ───────────────────────────────────────────────────────

  /**
   * Grille d'icones. Reconstruite UNIQUEMENT si la liste des exercices pratiques a change :
   * l'arrivee de l'historique en tache de fond ne doit pas arracher la tuile sous le doigt.
   */
  function peindreGrille() {
    pratiques = exercicesPratiques();
    const signature = pratiques.map((p) => p.id + '@' + p.derniere + 'x' + p.total).join('|');
    if (signature === signatureGrille && grille.firstChild) { marquerGrille(); return; }
    signatureGrille = signature;

    vider(grille);

    if (!pratiques.length) {
      grille.appendChild(h('div', { class: 'etat-vide' },
        icone('exercice', { taille: 40 }),
        h('p', { class: 'etat-vide-titre' }, store.historiquePret()
          ? 'Aucun exercice pratiqué'
          : 'Chargement de l’historique…'),
        h('p', { class: 'etat-vide-texte' },
          'Termine une séance : ses exercices apparaîtront ici, en icônes.')
      ));
      return;
    }

    for (const p of pratiques) {
      grille.appendChild(h('button', {
        type: 'button',
        class: 'tuile-exercice',
        'data-action': 'exercice',
        'data-id': p.id,
        'aria-pressed': 'false',
        'aria-label': `${p.nom}, ${p.total} séance${p.total > 1 ? 's' : ''}, ${depuisQuand(p.derniere)}`
      },
      // Le pictogramme d'abord et en grand : c'est lui qu'on vise, le texte ne fait que confirmer.
      icone(iconePourExercice(p.exercice || p.id), { taille: 34, classe: 'tuile-exercice-icone' }),
      h('span', { class: 'tuile-exercice-nom' }, p.nom),
      h('span', { class: 'tuile-exercice-meta' }, depuisQuand(p.derniere))
      ));
    }
    marquerGrille();
  }

  /** Etat de selection des tuiles : mutation d'attributs, jamais de reconstruction. */
  function marquerGrille() {
    for (const tuile of grille.children) {
      const id = tuile.getAttribute && tuile.getAttribute('data-id');
      if (!id) continue;
      const rang = selection.indexOf(id);
      tuile.setAttribute('aria-pressed', rang !== -1 ? 'true' : 'false');
      // data-serie porte le MEME rang que dans la legende de la courbe : la tuile et le trace
      // partagent leur couleur et leur forme, sans quoi la comparaison demande un effort de
      // memoire a chaque regard.
      if (rang !== -1) tuile.setAttribute('data-serie', String(rang + 1));
      else tuile.removeAttribute('data-serie');
    }
  }

  /** Puces de comparaison. Reconstruites : elles n'appartiennent qu'a la vue. */
  function peindrePuces() {
    puces.hidden = !modeComparaison;
    vider(puces);
    if (!modeComparaison) return;

    for (let i = 0; i < selection.length; i++) {
      const id = selection[i];
      puces.appendChild(h('button', {
        type: 'button',
        class: 'puce-comparaison',
        'data-action': 'retirer',
        'data-id': id,
        'data-serie': String(i + 1),
        'aria-label': `Retirer ${nomDe(id)} de la comparaison`
      }, h('span', { class: 'puce-comparaison-nom' }, nomDe(id)), icone('croix', { taille: 14 })));
    }

    puces.appendChild(h('p', { class: 'barre-comparaison-aide' },
      selection.length < MAX_COMPARAISON
        ? 'Tape d’autres icônes pour les superposer.'
        : 'Quatre courbes au maximum.'));
  }

  /**
   * Barre de metriques. La liste vient de MODES via metriquesDisponibles : cette vue ne sait
   * pas ce qu'est un mode, et n'a donc rien a modifier quand un mode est ajoute.
   */
  function peindreMetriques() {
    vider(barreMetriques);
    const dispo = metriquesCommunes();

    // Metrique retenue : celle deja choisie si elle reste valide (changer de plage ne doit pas
    // ramener a la metrique par defaut), sinon la preference de l'exercice principal.
    if (!dispo.some((m) => m.cle === metrique)) {
      const ex = exerciceDe(principal());
      const preferee = ex ? metriqueParDefaut(ex) : null;
      // ⚠ metriqueParDefaut lit MODES, qui peut declarer une metrique sans reducteur ; celle-ci
      //    est absente de `dispo` et laisserait la barre sans aucun segment selectionne.
      metrique = dispo.some((m) => m.cle === preferee) ? preferee : (dispo[0] ? dispo[0].cle : null);
    }

    for (const m of dispo) {
      barreMetriques.appendChild(h('button', {
        type: 'button',
        class: 'segment',
        role: 'tab',
        'data-action': 'metrique',
        'data-metrique': m.cle,
        'aria-selected': m.cle === metrique ? 'true' : 'false'
      }, m.libelle));
    }
    barreMetriques.hidden = dispo.length === 0;
  }

  /** Selection d'une metrique : on ne repeint pas la barre, on mute deux attributs. */
  function marquerMetrique() {
    for (const b of barreMetriques.children) {
      b.setAttribute('aria-selected', b.getAttribute('data-metrique') === metrique ? 'true' : 'false');
    }
  }

  function marquerPlage() {
    for (const b of segmentsPlage.children) {
      b.setAttribute('aria-selected', b.getAttribute('data-plage') === nomPlage ? 'true' : 'false');
    }
  }

  function afficherAvis(texte) {
    if (!texte) { avisMetrique.hidden = true; avisMetrique.textContent = ''; return; }
    avisMetrique.textContent = texte;
    avisMetrique.hidden = false;
  }

  /**
   * Courbe. Le fragment est detruit puis reconstruit : c'est le protocole documente par
   * ui/chart.js, et le seul moyen de changer de metrique sans qu'un parent ne touche a son
   * sous-arbre. Les cas 0 et 1 point sont DANS LE CONTRAT du moteur : on ne les redouble pas.
   */
  function peindreCourbe() {
    if (courbe) { courbe.detruire(); courbe = null; }
    afficherAvis(null);

    if (!selection.length) return;

    if (!metrique) {
      // Selection heteroclite : deux exercices sans aucune metrique commune (une planche et une
      // sortie velo). On le DIT plutot que d'afficher un cadre vide.
      if (selection.length > 1) {
        afficherAvis('Ces exercices n’ont aucune statistique commune : retire-en un pour voir sa courbe.');
      }
      return;
    }

    const bornes = plageDe(nomPlage);
    const seances = store.seances();
    const series = [];
    let message = null;
    let sens = 'haut';
    let unite = '';

    for (const id of selection) {
      const st = serieTemporelle(seances, id, metrique, bornes);
      // ⚠ Repli automatique du 1RM estime vers la charge max : le domaine l'a decide, la vue
      //    l'ANNONCE. Sans ce message, l'axe change d'unite sans que rien ne l'explique.
      if (st.message && !message) message = st.message;
      if (!series.length) { sens = st.sens; unite = st.unite; }
      series.push({ id, libelle: nomDe(id), points: st.points, unite: st.unite });
    }

    afficherAvis(message);

    // Une seule serie : on emprunte l'appel HISTORIQUE de renderLineChart. Le rendu et les cas
    // degeneres restent alors strictement ceux d'avant la comparaison.
    courbe = selection.length === 1
      ? renderLineChart(hoteCourbe, { points: series[0].points, unite, sens })
      : renderLineChart(hoteCourbe, { series, unite, sens });
  }

  /** Records de la serie PRINCIPALE. Les points non fiables sont deja exclus par le domaine. */
  function peindreRecords() {
    vider(listeRecords);
    const id = principal();
    if (!id) {
      listeRecords.appendChild(h('p', { class: 'ligne-liste-secondaire' }, 'Aucun exercice sélectionné.'));
      return;
    }

    const table = records(store.seances(), id);
    const cles = Object.keys(table);
    if (!cles.length) {
      listeRecords.appendChild(h('p', { class: 'ligne-liste-secondaire' },
        'Aucun record : cet exercice n’a pas encore de série enregistrée.'));
      return;
    }

    for (const cle of cles) {
      const rec = table[cle];
      listeRecords.appendChild(h('div', { class: 'ligne-reglage' },
        h('span', null,
          h('span', { class: 'ligne-liste-principal' }, LIBELLES_METRIQUES[cle] || cle),
          h('br'),
          h('span', { class: 'ligne-liste-secondaire' },
            `${formatLong(rec.date)}${rec.libelle ? ' · ' + rec.libelle : ''}`)
        ),
        // ⚠ Le badge n'est pose que sur un record FIABLE. records() n'en rend pas d'autres :
        //    rien a filtrer ici, et surtout rien a decorer soi-meme.
        h('span', { class: 'badge-record' }, formatValeur(rec.valeur, rec.unite || UNITES[cle] || ''))
      ));
    }
  }

  /**
   * Tableau des 20 dernieres seances — TOUJOURS present sous la courbe.
   * C'est lui que l'on vient reellement lire : la courbe donne la tendance, le tableau donne
   * les chiffres exacts a reproduire aujourd'hui. En comparaison, il liste la serie PRINCIPALE :
   * quatre tableaux entrelaces ne se lisent pas, et le titre dit lequel est affiche.
   */
  function peindreTableau() {
    vider(corpsTableau);
    const id = principal();

    titreTableau.textContent = id && selection.length > 1
      ? `${N_TABLEAU} dernières séances — ${nomDe(id)}`
      : `${N_TABLEAU} dernières séances`;

    if (!id) {
      corpsTableau.appendChild(h('tr', {},
        h('td', { colspan: '4' }, 'Choisis un exercice pour voir son historique.')));
      return;
    }

    const lignes = tableauChronologique(store.seances(), id, N_TABLEAU);
    if (!lignes.length) {
      corpsTableau.appendChild(h('tr', {},
        h('td', { colspan: '4' }, store.historiquePret()
          ? 'Aucune séance enregistrée avec cet exercice.'
          : 'Chargement de l’historique…')));
      return;
    }

    for (const l of lignes) {
      const tonnageFiable = l.tonnage != null && l.tonnageFiable !== false;
      corpsTableau.appendChild(h('tr', {},
        h('td', {},
          // Un bouton et non une ligne cliquable : cible tactile, focus clavier et role natifs.
          h('button', {
            type: 'button',
            class: 'bouton bouton-fantome',
            'data-action': 'ouvrir-seance',
            'data-id': l.seanceId,
            'aria-label': `Ouvrir la séance du ${formatLong(l.date)}`
          }, formatCourt(l.date))
        ),
        h('td', {
          'data-fiable': l.meilleure && l.meilleure.fiable === false ? 'non' : 'oui'
        }, l.meilleure
          ? (l.meilleure.libelle || formatFr(l.meilleure.valeur))
            + (l.meilleure.fiable === false ? ' ~' : '')
          : '—'),
        h('td', { 'data-fiable': tonnageFiable ? 'oui' : 'non' },
          l.tonnage == null ? '—' : `${formatFr(l.tonnage, 0)} kg${tonnageFiable ? '' : ' ~'}`),
        h('td', {}, String(l.nbSeries))
      ));
    }
  }

  /** Repeint tout ce qui depend de la selection. Chaque fonction ne touche que SES noeuds. */
  function peindreSelection() {
    marquerGrille();
    peindrePuces();
    peindreMetriques();
    peindreCourbe();
    peindreRecords();
    peindreTableau();
  }

  /** Repeint ce qui depend des donnees, sans toucher aux selecteurs (donc sans perdre le focus). */
  function peindreDonnees() {
    peindreGrille();
    // Premiere arrivee de l'historique : aucun exercice n'etait selectionnable au montage.
    if (!selection.length && pratiques.length) {
      selection = [pratiques[0].id];
      peindreSelection();
      return;
    }
    peindreCourbe();
    peindreRecords();
    peindreTableau();
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function basculerComparaison(actif) {
    modeComparaison = actif;
    boutonComparer.setAttribute('aria-pressed', actif ? 'true' : 'false');
    // Sortir de la comparaison ne perd jamais la courbe qu'on regardait : on garde la principale.
    if (!actif && selection.length > 1) selection = [selection[0]];
    peindreSelection();
  }

  /** Ajoute ou retire un exercice de la comparaison. Le principal ne se retire pas tout seul. */
  function basculerExercice(id) {
    const rang = selection.indexOf(id);
    if (rang === -1) {
      if (selection.length >= MAX_COMPARAISON) return;
      selection = selection.concat([id]);
    } else {
      if (selection.length === 1) return;
      selection = selection.filter((x) => x !== id);
    }
    // La metrique reste valide si elle appartient a l'intersection : peindreMetriques tranche.
    peindreSelection();
  }

  // ── Appui long : entree dans la comparaison ───────────────────────────────
  // ⚠ setTimeout et non requestAnimationFrame : rAF est GELE quand la page n'est pas rendue, et
  //   un etat FONCTIONNEL ne doit jamais en dependre. Trois bugs de cette famille ont deja ete
  //   corriges dans ce projet.

  let minuteurAppui = null;
  let departAppui = null;
  let clicAnnule = false;

  function annulerAppui() {
    if (minuteurAppui !== null) { clearTimeout(minuteurAppui); minuteurAppui = null; }
    departAppui = null;
  }

  desabonnements.push(on(grille, 'pointerdown', (ev) => {
    const tuile = ev.target instanceof Element ? ev.target.closest('[data-action="exercice"]') : null;
    if (!tuile || !grille.contains(tuile)) return;
    const id = tuile.getAttribute('data-id');
    if (!id) return;

    annulerAppui();
    // ⚠ Remis a faux a CHAQUE appui : un appui long suivi d'un clic ailleurs laisserait sinon le
    //    drapeau arme, et le tap suivant sur une tuile serait avale sans rien faire.
    clicAnnule = false;
    departAppui = { x: ev.clientX, y: ev.clientY };
    minuteurAppui = setTimeout(() => {
      minuteurAppui = null;
      // Le clic qui suivra le relachement doit etre ignore : sans ce drapeau, l'appui long
      // ouvrirait la comparaison PUIS naviguerait vers l'exercice, annulant le geste.
      clicAnnule = true;
      if (!modeComparaison) basculerComparaison(true);
      if (selection.indexOf(id) === -1) basculerExercice(id);
    }, APPUI_LONG_MS);
  }));

  desabonnements.push(on(grille, 'pointermove', (ev) => {
    if (!departAppui) return;
    if (Math.abs(ev.clientX - departAppui.x) > TOLERANCE_GLISSE_PX
      || Math.abs(ev.clientY - departAppui.y) > TOLERANCE_GLISSE_PX) annulerAppui();
  }));

  desabonnements.push(on(grille, 'pointerup', annulerAppui));
  desabonnements.push(on(grille, 'pointercancel', annulerAppui));

  // ── Delegation : UN seul ecouteur click pour toute la vue ──────────────────

  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');

    if (action === 'exercice') {
      const id = cible.getAttribute('data-id');
      if (clicAnnule) { clicAnnule = false; return; }
      if (!id) return;
      if (modeComparaison) { basculerExercice(id); return; }
      // Navigation : l'exercice affiche fait partie de l'adresse, donc partageable et
      // restaurable. Depuis #/progression/:exerciceId, le routeur appelle onParams() et ne
      // demonte RIEN — la vue reste en place, seuls les noeuds concernes changent.
      if (id !== principal()) aller('#/progression/' + encodeURIComponent(id));
      return;
    }

    if (action === 'retirer') {
      const id = cible.getAttribute('data-id');
      if (id) basculerExercice(id);
      return;
    }

    if (action === 'comparer') {
      basculerComparaison(!modeComparaison);
      return;
    }

    if (action === 'catalogue') {
      // Second rideau : le catalogue complet sert a un exercice JAMAIS pratique, dont la courbe
      // sera vide. Le cas courant, lui, est deja a l'ecran sous forme d'icones.
      picker.ouvrir({
        onChoisir: (ex) => {
          if (!ex) return;
          if (modeComparaison) { basculerExercice(ex.id); return; }
          aller('#/progression/' + encodeURIComponent(ex.id));
        }
      });
      return;
    }

    if (action === 'plage') {
      const nom = cible.getAttribute('data-plage');
      if (!nom || nom === nomPlage || PLAGES.indexOf(nom) === -1) return;
      nomPlage = nom;
      // Memorisee : revenir sur cet ecran dans deux jours doit retrouver la meme fenetre.
      prefs.ecrire({ plageCourbe: nomPlage });
      marquerPlage();
      peindreCourbe();       // la plage ne borne que la courbe : records et tableau sont globaux
      return;
    }

    if (action === 'metrique') {
      const cle = cible.getAttribute('data-metrique');
      if (!cle || cle === metrique) return;
      metrique = cle;
      marquerMetrique();
      peindreCourbe();
      return;
    }

    if (action === 'ouvrir-seance') {
      const id = cible.getAttribute('data-id');
      if (id) aller('#/historique/' + encodeURIComponent(id));
    }
  }));

  // L'historique arrive en tache de fond : a son arrivee, la grille passe de vide a garnie et la
  // courbe d'un point a vingt. On repeint les DONNEES seulement — les segments gardent leur focus.
  desabonnements.push(bus.on('historique:pret', peindreDonnees));

  // Une seance passee corrigee depuis le detail change la courbe : meme traitement.
  desabonnements.push(bus.on('store:commit', peindreDonnees));

  // ── Montage ───────────────────────────────────────────────────────────────

  peindreGrille();
  const demande = params.exerciceId || null;
  if (demande) selection = [demande];
  else if (pratiques.length) selection = [pratiques[0].id];
  peindreSelection();
  marquerPlage();
  conteneur.appendChild(racine);

  return {
    /**
     * Changement de parametres SANS remontage (meme cle de route). Seul l'exercice peut varier
     * ici ; on ne reconstruit ni l'ossature, ni la grille, ni les segments de plage.
     */
    onParams(p) {
      const suivant = (p && p.exerciceId) || null;
      if (!suivant || suivant === principal()) return;
      // Une navigation designe UNE courbe : elle sort de la comparaison plutot que de laisser
      // l'utilisateur devant une superposition qu'il n'a pas demandee.
      selection = [suivant];
      modeComparaison = false;
      boutonComparer.setAttribute('aria-pressed', 'false');
      // Metrique remise a zero : celle du mode precedent n'existe peut-etre pas dans le nouveau.
      metrique = null;
      peindreSelection();
    },

    destroy() {
      annulerAppui();
      for (const off of desabonnements) { try { off(); } catch (_) { /* deja detache */ } }
      desabonnements.length = 0;
      // Le fragment vivant coupe SES propres ecouteurs : le laisser au ramasse-miettes
      // laisserait un pointerdown attache a un SVG detache.
      if (courbe) { courbe.detruire(); courbe = null; }
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    }
  };
}

export default { mount };
