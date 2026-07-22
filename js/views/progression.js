// views/progression.js — routes #/progression et #/progression/:exerciceId.
//
// v3 : refonte de LISIBILITE (retour utilisateur : « je ne la trouve pas tres claire »).
// La page se lit de HAUT EN BAS, sans mode cache :
//   1. « Mes exercices » : grille d'icones des exercices REELLEMENT PRATIQUES (grandes tuiles).
//   2. Une SECTION DETAIL pour l'exercice choisi, dans un ordre FIXE : carte record bien
//      visible -> puces de metrique (libelles francais complets, jamais de jargon) -> puces de
//      plage -> courbe -> tableau des dernieres seances.
//   3. La comparaison est DISCRETE : un simple lien « Comparer a un autre exercice » sous la
//      courbe, qui ouvre le selecteur et superpose la courbe choisie. L'appui long et la barre
//      permanente de comparaison ont DISPARU — ils etaient la source principale de confusion.
//   4. L'ecran ne s'ouvre JAMAIS vide : sans exercice dans l'adresse, le plus pratique
//      recemment est choisi automatiquement.
//
// CONTRAT DE RENDU (zone B) : le DOM de cette vue est construit UNE SEULE FOIS au montage.
// Il n'existe aucune fonction rerender(). Changer d'exercice, de plage ou de metrique ne
// remplace que les noeuds que la vue POSSEDE reellement :
//   - la grille d'icones (reconstruite quand la LISTE change ; sinon on ne mute que des attributs),
//   - l'en-tete de detail, la carte record, la barre de metriques, la zone de comparaison,
//   - le corps du tableau chronologique,
//   - la courbe, qui est un FRAGMENT VIVANT : on appelle detruire() puis renderLineChart(),
//     jamais vider() sur son conteneur (ui/chart.js le documente explicitement).
// L'ossature, les segments de plage et l'en-tete du tableau ne sont JAMAIS retouches.
//
// AUCUN test sur le mode de l'exercice ici : les metriques proposables viennent de
// domain/progression.metriquesDisponibles(), qui les derive de MODES. Ajouter un mode demain
// n'ouvre pas ce fichier.
//
// ⚠ Les seances ABANDONNEES n'entrent dans AUCUN comptage : estSeanceComptable est le seul
//   filtre, ici comme dans le domaine.

import { h, delegate, vider } from '../lib/dom.js';
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

// Plafond de courbes superposees. Aligne sur celui de ui/chart.js : cacher le lien de
// comparaison ICI evite a l'utilisateur d'ouvrir le selecteur pour rien.
const MAX_COMPARAISON = 4;

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
 * Le PREMIER de la liste est donc « le plus pratique recemment » : c'est lui qui est choisi
 * automatiquement quand la route ne designe personne — l'ecran ne s'ouvre jamais vide.
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

  // selection[0] est la serie PRINCIPALE : celle de l'en-tete, du record et du tableau.
  // selection[1..3] sont les courbes SUPERPOSEES par le lien de comparaison.
  let selection = [];
  let metrique = null;            // resolue a chaque changement de selection
  let pratiques = [];             // instantane courant de la grille
  let signatureGrille = '';       // pour ne reconstruire la grille QUE si la liste a change

  let nomPlage = prefs.lire().plageCourbe || '3m';
  if (PLAGES.indexOf(nomPlage) === -1) nomPlage = '3m';

  // v8 : dernier point tape sur une courbe. Un SECOND tap sur le meme point ouvre la seance
  // dans l'historique (panneau superpose) — reinitialise a chaque re-rendu de courbe.
  let dernierPointVu = null;

  // ── Ossature, construite UNE fois ─────────────────────────────────────────
  // L'ordre du DOM est l'ordre de LECTURE voulu par la refonte : grille d'abord, puis pour
  // l'exercice choisi : record -> metriques -> plage -> courbe -> comparaison -> tableau.

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

  const blocGrille = h('section', { class: 'bloc-exercices' },
    h('div', { class: 'entete-section' },
      h('h3', { class: 'section-titre' }, 'Mes exercices'),
      h('div', { class: 'entete-actions' }, lienCatalogue)
    ),
    grille
  );

  // En-tete de detail : icone + nom de l'exercice regarde. C'est lui qui repond a « de quoi
  // parlent les blocs du dessous ? » — sans lui, la carte record semble flotter.
  const porteIconeDetail = h('span', { class: 'entete-detail-picto' });
  const nomDetail = h('h3', { class: 'entete-detail-nom' }, '');
  const enteteDetail = h('div', { class: 'entete-detail' }, porteIconeDetail, nomDetail);

  // Carte record : LA reponse a la question posee en salle (« c'est quoi mon record ? »).
  // Contenu reconstruit a chaque changement d'exercice ou de metrique.
  const carteRecord = h('div', { class: 'carte-record' });

  // Metriques : conteneur stable, contenu reconstruit a chaque changement de selection (le mode
  // change, donc la liste change). Libelles = LIBELLES_METRIQUES, en toutes lettres.
  const barreMetriques = h('div', { class: 'metriques', role: 'tablist', 'aria-label': 'Métrique affichée' });

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

  // v8 : plus de bascule « Poids + reps » — les DEUX courbes (metrique choisie + cumul des
  // repetitions) sont TOUJOURS empilees pour un exercice seul. Rien a decouvrir, rien a armer.

  // Message de repli du 1RM estime, et message d'absence de metrique commune. Une courbe qui
  // change de metrique sans le dire est incomprehensible : le message est rendu MOT POUR MOT tel
  // que le domaine le retourne.
  const avisMetrique = h('p', { class: 'courbe-avis', role: 'status', hidden: true });

  // Hote de la courbe. ⚠ On ne le vide JAMAIS : le fragment retire lui-meme sa racine.
  const hoteCourbe = h('div', { class: 'hote-courbe' });

  // v8 : le double-tap d'un point ouvre la seance — l'astuce est ecrite, sinon personne ne la
  // trouve. Une ligne attenuee, pas un tutoriel.
  const aideCourbe = h('p', { class: 'courbe-aide' },
    'Touche un point pour le détail, deux fois pour ouvrir la séance.');

  // Comparaison DISCRETE, sous la courbe : un lien qui ouvre le selecteur, et les puces des
  // courbes superposees (retirables une a une). Rien de permanent, aucun mode a apprendre.
  const zoneComparaison = h('div', { class: 'zone-comparaison' });

  const corpsTableau = h('tbody', {});
  const tableau = h('table', { class: 'tableau-chrono' },
    h('thead', {},
      h('tr', {},
        h('th', { scope: 'col' }, 'Date'),
        h('th', { scope: 'col' }, 'Meilleure série'),
        h('th', { scope: 'col' }, 'Séries')
      )
    ),
    corpsTableau
  );

  const titreTableau = h('h3', { class: 'section-titre' }, 'Dernières séances');

  const blocDetail = h('section', { class: 'bloc-detail', hidden: true },
    enteteDetail,
    carteRecord,
    barreMetriques,
    segmentsPlage,
    avisMetrique,
    hoteCourbe,
    aideCourbe,
    zoneComparaison,
    titreTableau,
    tableau
  );

  const racine = h('section', { class: 'vue-progression' }, blocGrille, blocDetail);

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

  /**
   * La 2e courbe permanente (cumul des repetitions) n'a de sens que pour UN exercice seul dont
   * le mode se compte en repetitions. Aucun test sur le mode : tout vient de
   * metriquesDisponibles (donc de MODES).
   */
  function repsEmpilablesPossibles() {
    if (selection.length !== 1) return false;
    const ex = exerciceDe(principal());
    if (!ex) return false;
    return metriquesDisponibles(ex).some((m) => m.cle === 'reps-max');
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
      // Etat « aucune seance » : messages simples, et une INVITATION a lancer une seance —
      // c'est la seule action qui donnera un contenu a cet ecran.
      const vide = h('div', { class: 'etat-vide' },
        icone('exercice', { taille: 40 }),
        h('p', { class: 'etat-vide-titre' }, store.historiquePret()
          ? 'Aucune séance pour l’instant'
          : 'Chargement de l’historique…'),
        h('p', { class: 'etat-vide-texte' }, store.historiquePret()
          ? 'Termine une première séance : tes exercices apparaîtront ici, avec leur progression.'
          : 'Tes exercices pratiqués arrivent…')
      );
      if (store.historiquePret()) {
        vide.appendChild(h('button', {
          type: 'button',
          class: 'bouton bouton-primaire',
          'data-action': 'composer'
        }, icone('lecture', { taille: 18 }), h('span', null, 'Lancer une séance')));
      }
      grille.appendChild(vide);
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
      tuile.setAttribute('aria-pressed', id === principal() ? 'true' : 'false');
    }
  }

  /** En-tete de detail : icone et nom de l'exercice principal. */
  function peindreEnteteDetail() {
    vider(porteIconeDetail);
    const id = principal();
    if (!id) { nomDetail.textContent = ''; return; }
    porteIconeDetail.appendChild(
      icone(iconePourExercice(exerciceDe(id) || id), { taille: 28, classe: 'entete-detail-icone' })
    );
    nomDetail.textContent = nomDe(id);
  }

  /**
   * Carte record : la meilleure valeur de la METRIQUE AFFICHEE, en grand, avec sa date.
   * records() n'expose que des points FIABLES : rien a filtrer ici, rien a decorer soi-meme.
   */
  function peindreRecord() {
    vider(carteRecord);
    const id = principal();
    if (!id || !metrique) { carteRecord.hidden = true; return; }
    carteRecord.hidden = false;

    const rec = records(store.seances(), id)[metrique];
    if (!rec) {
      carteRecord.appendChild(h('p', { class: 'carte-record-vide' },
        store.historiquePret()
          ? 'Pas encore de record — termine une séance avec cet exercice pour en établir un.'
          : 'Chargement de l’historique…'));
      return;
    }

    carteRecord.appendChild(h('span', { class: 'carte-record-libelle' },
      `Record — ${LIBELLES_METRIQUES[metrique] || metrique}`));
    carteRecord.appendChild(h('span', { class: 'carte-record-valeur' },
      formatValeur(rec.valeur, rec.unite || UNITES[metrique] || '')));
    // « il y a 3 j · 5 × 76 kg » : l'anciennete d'abord (c'est elle qu'on vient lire), le
    // detail de la serie ensuite quand le domaine le fournit.
    carteRecord.appendChild(h('span', { class: 'carte-record-date' },
      `${depuisQuand(rec.date)}${rec.libelle ? ' · ' + rec.libelle : ''}`));
  }

  /**
   * Barre de metriques. La liste vient de MODES via metriquesDisponibles : cette vue ne sait
   * pas ce qu'est un mode, et n'a donc rien a modifier quand un mode est ajoute. Les libelles
   * sont ceux de LIBELLES_METRIQUES — en toutes lettres, jamais de cle technique.
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
        afficherAvis('Ces exercices n’ont aucune statistique commune : retire la comparaison pour revoir la courbe.');
      }
      return;
    }

    const bornes = plageDe(nomPlage);
    const seances = store.seances();
    dernierPointVu = null;

    // v8 : un SECOND tap sur le meme point ouvre la seance — le panneau superpose du routeur la
    // presente par-dessus cet ecran, qui reste monte et retrouve son etat au retour.
    const surPointChoisi = (p) => {
      if (!p || !p.seanceId) return;
      if (dernierPointVu === p.seanceId) {
        aller('#/historique/' + encodeURIComponent(p.seanceId));
        return;
      }
      dernierPointVu = p.seanceId;
    };

    // ── Exercice seul : DEUX graphes EMPILES, toujours ────────────────────────
    // v7 : plus jamais deux echelles Y sur un meme graphe (anti-pattern n°1 de dataviz).
    // v8 : la pile n'est plus une option — graphe 1 = la metrique choisie (Volume en tete),
    // graphe 2 = le CUMUL des repetitions par seance (retour utilisateur : le « max par
    // seance » ne disait rien sous une courbe de volume).
    if (selection.length === 1) {
      const id = principal();
      const stPrincipale = serieTemporelle(seances, id, metrique, bornes);
      afficherAvis(stPrincipale.message || null);

      const titrePile = (rang, texte) => h('p', { class: 'courbe-pile-titre' },
        h('span', { class: 'courbe-legende-marque', 'data-serie': String(rang), 'aria-hidden': 'true' }, '●'),
        h('span', null, texte));

      // ⚠ La couleur passe par l'ENVELOPPE (currentColor traverse tout le SVG du moteur) : en
      //   rendu mono-serie le moteur ne pose pas de groupe .courbe-serie, une regle par serie
      //   n'aurait aucune prise. Pastille du titre et trace partagent donc la meme source.
      const cleAffichee = stPrincipale.metrique || metrique;
      const enveloppePoids = h('div', { class: 'courbe-pile courbe-pile-poids' },
        titrePile(1, (LIBELLES_METRIQUES[cleAffichee] || LIBELLES_METRIQUES[metrique] || 'Progression') +
          (stPrincipale.unite ? ' (' + stPrincipale.unite + ')' : '')));
      hoteCourbe.appendChild(enveloppePoids);
      const cPrincipale = renderLineChart(enveloppePoids, {
        points: stPrincipale.points, unite: stPrincipale.unite, sens: stPrincipale.sens || 'haut',
        hauteur: 180, onSelect: surPointChoisi
      });

      let cReps = null;
      let enveloppeReps = null;
      if (repsEmpilablesPossibles()) {
        const stReps = serieTemporelle(seances, id, 'reps-total', bornes);
        enveloppeReps = h('div', { class: 'courbe-pile courbe-pile-reps' },
          titrePile(2, 'Répétitions (total par séance)'));
        hoteCourbe.appendChild(enveloppeReps);
        cReps = renderLineChart(enveloppeReps, {
          points: stReps.points, unite: stReps.unite, sens: 'haut',
          hauteur: 150, onSelect: surPointChoisi
        });
      }

      courbe = {
        detruire() {
          try { cPrincipale.detruire(); } catch (_) { /* deja detruit */ }
          if (cReps) { try { cReps.detruire(); } catch (_) { /* deja detruit */ } }
          if (enveloppePoids.parentNode) enveloppePoids.parentNode.removeChild(enveloppePoids);
          if (enveloppeReps && enveloppeReps.parentNode) enveloppeReps.parentNode.removeChild(enveloppeReps);
        }
      };
      return;
    }

    // ── Comparaison multi-exercices : un seul graphe multi-series ─────────────
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
    courbe = renderLineChart(hoteCourbe, { series, unite, sens, onSelect: surPointChoisi });
  }

  /**
   * Zone de comparaison, SOUS la courbe : les puces des courbes superposees (retirables), puis
   * le lien discret qui ouvre le selecteur. Pas de mode, pas de barre permanente : ce qui est
   * superpose se voit, ce qui n'existe pas n'occupe aucune place.
   */
  function peindreComparaison() {
    vider(zoneComparaison);
    if (!principal()) return;

    // Puces des courbes SUPERPOSEES uniquement (rang >= 1) : la principale a deja son en-tete.
    // data-serie porte le MEME rang que dans la legende de la courbe : puce et trace partagent
    // leur couleur, sans quoi la comparaison demande un effort de memoire a chaque regard.
    for (let i = 1; i < selection.length; i++) {
      const id = selection[i];
      zoneComparaison.appendChild(h('button', {
        type: 'button',
        class: 'puce-comparaison',
        'data-action': 'retirer',
        'data-id': id,
        'data-serie': String(i + 1),
        'aria-label': `Retirer ${nomDe(id)} de la comparaison`
      }, h('span', { class: 'puce-comparaison-nom' }, nomDe(id)), icone('croix', { taille: 14 })));
    }

    if (selection.length < MAX_COMPARAISON) {
      zoneComparaison.appendChild(h('button', {
        type: 'button',
        class: 'lien-comparer',
        'data-action': 'comparer'
      }, icone('plus', { taille: 16 }), h('span', null, 'Comparer à un autre exercice')));
    } else {
      zoneComparaison.appendChild(h('p', { class: 'zone-comparaison-aide' }, 'Quatre courbes au maximum.'));
    }
  }

  /**
   * Tableau des dernieres seances — TOUJOURS present sous la courbe.
   * C'est lui que l'on vient reellement lire : la courbe donne la tendance, le tableau donne
   * les chiffres exacts a reproduire aujourd'hui. En comparaison, il liste la serie PRINCIPALE :
   * quatre tableaux entrelaces ne se lisent pas, et le titre dit lequel est affiche.
   */
  function peindreTableau() {
    vider(corpsTableau);
    const id = principal();

    titreTableau.textContent = id && selection.length > 1
      ? `Dernières séances — ${nomDe(id)}`
      : 'Dernières séances';

    if (!id) {
      corpsTableau.appendChild(h('tr', {},
        h('td', { colspan: '4' }, 'Choisis un exercice pour voir son historique.')));
      return;
    }

    const lignes = tableauChronologique(store.seances(), id, N_TABLEAU);
    if (!lignes.length) {
      corpsTableau.appendChild(h('tr', {},
        h('td', { colspan: '3' }, store.historiquePret()
          ? 'Aucune séance enregistrée avec cet exercice.'
          : 'Chargement de l’historique…')));
      return;
    }

    for (const l of lignes) {
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
        h('td', {}, String(l.nbSeries))
      ));
    }
  }

  /** Repeint tout ce qui depend de la selection. Chaque fonction ne touche que SES noeuds. */
  function peindreSelection() {
    blocDetail.hidden = !principal();
    marquerGrille();
    peindreEnteteDetail();
    peindreMetriques();     // resout `metrique` : DOIT preceder record et courbe
    peindreRecord();
    peindreCourbe();
    peindreComparaison();
    peindreTableau();
  }

  /** Repeint ce qui depend des donnees, sans toucher aux selecteurs (donc sans perdre le focus). */
  function peindreDonnees() {
    peindreGrille();
    // Premiere arrivee de l'historique : aucun exercice n'etait selectionnable au montage.
    // On choisit le plus pratique recemment — l'ecran ne reste jamais vide.
    if (!selection.length && pratiques.length) {
      selection = [pratiques[0].id];
      peindreSelection();
      return;
    }
    peindreRecord();
    peindreCourbe();
    peindreTableau();
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  /** Superpose une courbe choisie dans le selecteur. La metrique commune est retranchee ensuite. */
  function ajouterComparaison(id) {
    if (!id || selection.indexOf(id) !== -1) return;
    if (selection.length >= MAX_COMPARAISON) return;
    selection = selection.concat([id]);
    // La metrique reste valide si elle appartient a l'intersection : peindreMetriques tranche.
    peindreSelection();
  }

  /** Retire une courbe superposee. La principale ne se retire pas : c'est la page elle-meme. */
  function retirerComparaison(id) {
    if (!id || id === principal()) return;
    if (selection.indexOf(id) === -1) return;
    selection = selection.filter((x) => x !== id);
    peindreSelection();
  }

  // ── Delegation : UN seul ecouteur click pour toute la vue ──────────────────

  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');

    if (action === 'exercice') {
      const id = cible.getAttribute('data-id');
      if (!id) return;
      // Navigation : l'exercice affiche fait partie de l'adresse, donc partageable et
      // restaurable. Depuis #/progression/:exerciceId, le routeur appelle onParams() et ne
      // demonte RIEN — la vue reste en place, seuls les noeuds concernes changent.
      if (id !== principal()) aller('#/progression/' + encodeURIComponent(id));
      return;
    }

    if (action === 'comparer') {
      // Comparaison en UN geste : le selecteur s'ouvre, l'exercice choisi se superpose.
      picker.ouvrir({ onChoisir: (ex) => { if (ex) ajouterComparaison(ex.id); } });
      return;
    }

    if (action === 'retirer') {
      retirerComparaison(cible.getAttribute('data-id'));
      return;
    }

    if (action === 'catalogue') {
      // Second rideau : le catalogue complet sert a un exercice JAMAIS pratique, dont la courbe
      // sera vide. Le cas courant, lui, est deja a l'ecran sous forme d'icones.
      picker.ouvrir({
        onChoisir: (ex) => {
          if (ex) aller('#/progression/' + encodeURIComponent(ex.id));
        }
      });
      return;
    }

    if (action === 'composer') {
      // Invitation de l'etat vide : composer puis lancer sa premiere seance.
      aller('#/composer');
      return;
    }

    if (action === 'plage') {
      const nom = cible.getAttribute('data-plage');
      if (!nom || nom === nomPlage || PLAGES.indexOf(nom) === -1) return;
      nomPlage = nom;
      // Memorisee : revenir sur cet ecran dans deux jours doit retrouver la meme fenetre.
      prefs.ecrire({ plageCourbe: nomPlage });
      marquerPlage();
      peindreCourbe();       // la plage ne borne que la courbe : record et tableau sont globaux
      return;
    }

    if (action === 'metrique') {
      const cle = cible.getAttribute('data-metrique');
      if (!cle || cle === metrique) return;
      metrique = cle;
      marquerMetrique();
      peindreRecord();       // la carte record suit la metrique affichee
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
  // Jamais d'ecran vide : sans exercice dans l'adresse, le plus pratique recemment est choisi.
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
      // Une navigation designe UNE courbe : elle remplace toute superposition en cours plutot
      // que de laisser l'utilisateur devant une comparaison qu'il n'a pas demandee.
      selection = [suivant];
      // Metrique remise a zero : celle du mode precedent n'existe peut-etre pas dans le nouveau.
      metrique = null;
      peindreSelection();
    },

    destroy() {
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
