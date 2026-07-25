// views/progression.js — routes #/progression et #/progression/:exerciceId.
//
// v3 : refonte de LISIBILITE (retour utilisateur : « je ne la trouve pas tres claire »).
// La page se lit de HAUT EN BAS, sans mode cache :
//   1. « Mes exercices » : grille d'icones des exercices REELLEMENT PRATIQUES (grandes tuiles).
//   2. Une SECTION DETAIL pour l'exercice choisi, dans un ordre FIXE : carte record bien
//      visible -> onglets d'affichage (libelles francais complets, jamais de jargon) -> puis, sur
//      la meme place, UN SEUL affichage : le CARNET (par defaut) ou une COURBE avec ses plages.
//      v14 : le carnet n'est plus sous la courbe mais a COTE d'elle, en premier onglet — retour
//      utilisateur (« à coté des autres courbes, et le premier affiché quand on clique »).
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
//   - l'en-tete de detail, la carte record, la barre d'onglets, la zone de comparaison,
//   - l'en-tete de colonnes et le corps du carnet (son nombre de colonnes suit la seance la plus
//     fournie, donc les deux se refont ensemble),
//   - la courbe, qui est un FRAGMENT VIVANT : on appelle detruire() puis renderLineChart(),
//     jamais vider() sur son conteneur (ui/chart.js le documente explicitement).
// L'ossature et les segments de plage ne sont JAMAIS retouches : changer d'onglet ne fait que
// basculer des `hidden` (appliquerVue) et repeindre l'affichage devenu visible.
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
  LIBELLES_METRIQUES, UNITES, metriqueParDefaut, estComptable, estSeanceComptable,
  champsSaisieEntree
} from '../data/schema.js';
import {
  metriquesDisponibles, serieTemporelle, tableauChronologique, records
} from '../domain/progression.js';
import { resumeSerie, resumeSerieCellule } from '../domain/metrics.js';
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

  // v14 : ce que montre la zone sous les onglets — le CARNET ou une COURBE. Le carnet est un
  // onglet a part entiere, place AVANT les metriques et selectionne d'entree (retour utilisateur :
  // « que ce soit le premier affiché quand on clique »). `metrique` reste resolue en parallele :
  // elle habille la carte record et sert de destination quand on quitte le carnet.
  let vue = 'carnet';             // 'carnet' | 'courbe'

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

  // Onglets : conteneur stable, contenu reconstruit a chaque changement de selection (le mode
  // change, donc la liste change). Libelles = LIBELLES_METRIQUES, en toutes lettres, precedes de
  // l'onglet Carnet.
  const barreMetriques = h('div', { class: 'metriques', role: 'tablist', 'aria-label': 'Affichage' });

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

  // v13 — CARNET. Retour utilisateur : « représentation d'un tableau, sur la gauche la date,
  // après sur le reste les séries et répétitions qu'on a faites (avec la charge utilisée s'il y
  // en a), tout en haut le plus récent ». C'est la page de droite du carnet papier : la courbe
  // donne la tendance, le carnet donne les chiffres exacts a reproduire aujourd'hui.
  //
  // v14 — MEME DESSIN QUE L'ECRAN DE SEANCE (retour utilisateur : « je n'aime pas la DA,
  // retravaille-la dans le même style que l'application »). Les pastilles de la v13 sont
  // remplacees par le vocabulaire de classes du tableau de saisie (tab-entete, tab-coin, tab-col,
  // tab-rangee, tab-sport, tab-cellules, tab-cellule) : colonne de gauche = la DATE au lieu de
  // l'exercice, colonnes suivantes = S1, S2, S3… Trois ecrans, un seul dessin de tableau —
  // seance en salle, detail d'une seance passee, carnet.
  //
  // ⚠ Une SEULE grille pour toutes les rangees (variable --tab-cols, posee par peindreCarnet) :
  //   c'est ce qui fait tomber la serie n d'un jour exactement sous la serie n de la veille. Une
  //   grille par rangee alignerait les dates et rien d'autre, ce qui vide le carnet de son sens.
  const carnetEntete = h('div', { class: 'tab-entete' });
  const carnetCorps = h('div', { class: 'tab-corps' });
  const carnetTableau = h('div', { class: 'carnet-tableau' }, carnetEntete, carnetCorps);

  // Etat vide TENU HORS de la grille : une rangee a colspan n'existe pas en CSS grid, et une
  // fausse rangee d'une seule cellule elargirait silencieusement toutes les colonnes.
  const carnetVide = h('p', { class: 'carnet-vide' });

  // Sans cette ligne, « 8 » au-dessus de « ×102,5 » ne se lit pas du premier coup.
  // ⚠ Son texte SUIT l'exercice affiche (voir legendeDe) : figee sur « répétitions × charge »,
  //   elle mentait sur trois des cinq modes — un gainage affiche « 1:30 », une sortie « 5,2 km ».
  const legendeTableau = h('p', { class: 'carnet-legende' });

  const blocCarnet = h('div', { class: 'bloc-carnet' }, legendeTableau, carnetTableau, carnetVide);

  const blocDetail = h('section', { class: 'bloc-detail', hidden: true },
    enteteDetail,
    carteRecord,
    barreMetriques,
    segmentsPlage,
    avisMetrique,
    hoteCourbe,
    aideCourbe,
    zoneComparaison,
    blocCarnet
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
    // v8 : « Répétitions max » n'est PLUS un onglet (retour utilisateur — la 2e courbe empilee
    // montre deja les repetitions, l'onglet ne servait a rien). La cle reste dans MODES : elle
    // signale qu'un mode se compte en repetitions (repsEmpilablesPossibles) et la 2e courbe
    // l'affiche sous les metriques de charge. La barre se recentre seule (flex).
    const dispo = metriquesCommunes().filter((m) => m.cle !== 'reps-max');

    // Metrique retenue : celle deja choisie si elle reste valide (changer de plage ne doit pas
    // ramener a la metrique par defaut), sinon la preference de l'exercice principal.
    if (!dispo.some((m) => m.cle === metrique)) {
      const ex = exerciceDe(principal());
      const preferee = ex ? metriqueParDefaut(ex) : null;
      // ⚠ metriqueParDefaut lit MODES, qui peut declarer une metrique sans reducteur ; celle-ci
      //    est absente de `dispo` et laisserait la barre sans aucun segment selectionne.
      metrique = dispo.some((m) => m.cle === preferee) ? preferee : (dispo[0] ? dispo[0].cle : null);
    }

    // v14 : le CARNET ouvre la barre — c'est l'affichage par defaut, et il se lit avant les
    // tendances. Il porte le SEUL pictogramme de la barre, parce qu'il est le seul onglet a ne
    // pas montrer une courbe : l'icone annonce une difference de nature, pas une decoration.
    barreMetriques.appendChild(h('button', {
      type: 'button',
      class: 'segment segment-carnet',
      role: 'tab',
      'data-action': 'vue',
      'data-vue': 'carnet',
      'aria-selected': vue === 'carnet' ? 'true' : 'false'
    }, icone('carnet', { taille: 15 }), h('span', null, 'Carnet')));

    for (const m of dispo) {
      barreMetriques.appendChild(h('button', {
        type: 'button',
        class: 'segment',
        role: 'tab',
        'data-action': 'metrique',
        'data-metrique': m.cle,
        'aria-selected': vue === 'courbe' && m.cle === metrique ? 'true' : 'false'
      }, m.libelle));
    }
    // Jamais masquee : l'onglet Carnet existe meme pour un exercice fantome, sans fiche et donc
    // sans aucune metrique — c'est justement le cas ou ses chiffres bruts sont la seule lecture.
    barreMetriques.hidden = false;
  }

  /** Selection d'un onglet : on ne repeint pas la barre, on mute des attributs. */
  function marquerOnglets() {
    for (const b of barreMetriques.children) {
      const cible = b.getAttribute('data-vue');
      const choisi = cible
        ? vue === cible
        : vue === 'courbe' && b.getAttribute('data-metrique') === metrique;
      b.setAttribute('aria-selected', choisi ? 'true' : 'false');
    }
  }

  /**
   * Ce qui est VISIBLE depend de l'onglet : un seul des deux affichages occupe la place.
   * ⚠ Les commandes d'un affichage absent sont MASQUEES, jamais laissees inertes : les plages ne
   *   bornent que la courbe (le carnet montre toujours ses vingt dernieres seances), et proposer
   *   « Comparer à un autre exercice » sous un tableau de chiffres ne veut rien dire.
   */
  function appliquerVue() {
    const carnet = vue === 'carnet';
    segmentsPlage.hidden = carnet;
    hoteCourbe.hidden = carnet;
    aideCourbe.hidden = carnet;
    zoneComparaison.hidden = carnet;
    blocCarnet.hidden = !carnet;
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

    // Onglet Carnet : le fragment vient d'etre detruit et rien n'est reconstruit. Le laisser vivre
    // derriere un conteneur masque garderait ses ecouteurs de pointeur sur un SVG invisible.
    if (vue !== 'courbe') return;

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
        // v8 : la 2e courbe SUIT l'onglet choisi — sous « Volume » le CUMUL des repetitions de
        // la seance ; sous une metrique de charge, le MAX de reps par serie (demande verbatim).
        const cleReps = metrique === 'tonnage' ? 'reps-total' : 'reps-max';
        const stReps = serieTemporelle(seances, id, cleReps, bornes);
        enveloppeReps = h('div', { class: 'courbe-pile courbe-pile-reps' },
          titrePile(2, cleReps === 'reps-total'
            ? 'Répétitions (total par séance)'
            : 'Répétitions (max par série)'));
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
   * Phrase de lecture des cases, DERIVEE de ce que le tableau affiche vraiment.
   *
   * ⚠ Aucun test sur le nom d'un mode : on lit les CHAMPS DE SAISIE geles sur l'entree
   *   (champsSaisieEntree, donc MODES). L'ordre des cas est celui de metrics.resumeSerieCellule,
   *   qui decide de la forme des cases : les deux se lisent cote a cote et ne peuvent pas diverger.
   */
  function legendeDe(lignes) {
    // Champs DECLARES par le mode gele de la seance la plus recente — c'est elle qu'on lit en
    // premier, et resumeSerieCellule tire d'elle la forme des cases du haut.
    const entree = lignes.length ? lignes[0].entree : null;
    const declares = entree ? champsSaisieEntree(entree) : [];

    // ⚠ Puis intersection avec ce qui est REELLEMENT CHIFFRE dans les lignes affichees. Le mode
    //   declare le lest de TOUT exercice lestable : une planche sans lest affichait « lest en
    //   dessous » sous vingt cases qui n'en portaient aucun, et une sortie sans distance aurait
    //   annonce une distance absente. La legende decrit le tableau, pas la table des modes.
    const vus = new Set();
    for (const l of lignes) {
      for (const serie of l.series) {
        for (const c of declares) {
          const v = serie[c];
          if (!estNombre(v)) continue;
          // Un lest nul ne s'ecrit pas dans la case (voir resumeSerieCellule) : il ne s'annonce
          // donc pas non plus dans la legende.
          if (c === 'lestKg' && v === 0) continue;
          vus.add(c);
        }
      }
    }
    const a = (c) => vus.has(c);
    // L'en-tete « S1 S2 S3… » dit deja ce qu'est une colonne — le meme en-tete que l'ecran de
    // saisie. La legende n'a donc a expliquer que le contenu d'une CASE, et le sens de lecture.
    const fin = ' La séance la plus récente est en haut.';
    if (a('distanceM')) return 'Durée en gros, distance en dessous.' + fin;
    if (a('dureeSec') && !a('reps')) {
      return (a('lestKg') ? 'Durée tenue, lest en dessous.' : 'Durée tenue, série par série.') + fin;
    }
    if (a('reps') && a('chargeKg')) return 'Répétitions en gros, charge en dessous.' + fin;
    if (a('reps') && a('valeur')) return 'Répétitions en gros, cran de la machine en dessous.' + fin;
    if (a('reps') && a('lestKg')) return 'Répétitions en gros, lest en dessous.' + fin;
    if (a('reps')) return 'Répétitions par série.' + fin;
    return 'Une case par série, dans l’ordre où elles ont été faites.' + fin;
  }

  /**
   * CARNET des dernieres seances — l'affichage par defaut de l'ecran.
   * C'est lui que l'on vient reellement lire : la courbe donne la tendance, le carnet donne les
   * chiffres exacts a reproduire aujourd'hui, serie par serie. En comparaison, il liste la serie
   * PRINCIPALE : quatre carnets entrelaces ne se lisent pas, et la legende dit lequel est affiche.
   */
  function peindreCarnet() {
    vider(carnetEntete);
    vider(carnetCorps);
    const id = principal();

    // Rien a lire : le tableau disparait entierement plutot que de montrer une grille vide, et la
    // legende de lecture avec lui — elle n'expliquerait que du vide.
    const dire = (texte) => {
      carnetVide.textContent = texte;
      carnetVide.hidden = false;
      carnetTableau.hidden = true;
      legendeTableau.hidden = true;
    };

    if (!id) { dire('Choisis un exercice pour voir son carnet.'); return; }

    const lignes = tableauChronologique(store.seances(), id, N_TABLEAU);
    if (!lignes.length) {
      dire(store.historiquePret()
        ? 'Aucune séance enregistrée avec cet exercice.'
        : 'Chargement de l’historique…');
      return;
    }

    carnetVide.hidden = true;
    carnetTableau.hidden = false;

    // Colonnes = la seance la PLUS FOURNIE des lignes affichees, sans plafond : amputer la
    // huitieme serie d'un jour pour tenir dans sept colonnes ferait mentir le carnet, alors qu'une
    // colonne de plus ne coute que de la largeur. Toutes les rangees partagent ce nombre.
    let cols = 1;
    for (const l of lignes) cols = Math.max(cols, l.series.length);
    carnetTableau.style.setProperty('--tab-cols', String(cols));

    carnetEntete.appendChild(h('span', { class: 'tab-coin' }, 'Date'));
    for (let i = 1; i <= cols; i++) {
      carnetEntete.appendChild(h('span', { class: 'tab-col' }, 'S' + i));
    }

    // La legende suit la seance la PLUS RECENTE : c'est son mode que les cases du haut — celles
    // qu'on lit en premier — affichent. En comparaison, elle nomme d'abord l'exercice montre.
    legendeTableau.textContent = (selection.length > 1 ? `Carnet de ${nomDe(id)}. ` : '')
      + legendeDe(lignes);
    legendeTableau.hidden = false;

    for (const l of lignes) {
      const cellules = h('div', { class: 'tab-cellules' });
      for (let i = 0; i < cols; i++) {
        const serie = l.series[i] || null;
        if (!serie) {
          // Ce jour-la, cette serie n'existe pas. Un point tres attenue, pas une case vide : la
          // grille reste lisible comme une grille, et l'absence se voit comme une absence.
          cellules.appendChild(h('span', { class: 'tab-cellule', 'data-vide': 'oui' },
            h('span', { class: 'tab-cellule-grand' }, '·')));
          continue;
        }
        // Meme formateur que l'ecran de saisie (grand/petit), forme longue en infobulle.
        const t = resumeSerieCellule(serie, l.entree);
        const cel = h('span', {
          class: 'tab-cellule',
          // Une serie ratee (« rackee avant la fin ») est un fait, pas un detail : elle explique
          // a elle seule pourquoi la courbe plonge ce jour-la.
          'data-echec': serie.echec === true ? 'oui' : 'non',
          title: resumeSerie(serie, l.entree)
        }, h('span', { class: 'tab-cellule-grand' }, t.grand || '—'));
        if (t.petit) cel.appendChild(h('span', { class: 'tab-cellule-petit' }, t.petit));
        cellules.appendChild(cel);
      }

      // Colonne de gauche : la DATE, a la place de l'exercice de l'ecran de saisie. Un bouton et
      // non une rangee cliquable — cible tactile, focus clavier et role natifs, et la seule cible
      // tapable de la rangee (les cases, elles, ne sont pas des commandes ici).
      const jour = h('button', {
        type: 'button',
        class: 'tab-sport',
        'data-action': 'ouvrir-seance',
        'data-id': l.seanceId,
        'aria-label': `Ouvrir la séance du ${formatLong(l.date)}`
      },
        h('span', { class: 'carnet-jour-date' }, formatCourt(l.date)),
        h('span', { class: 'carnet-jour-age' }, depuisQuand(l.date)));

      carnetCorps.appendChild(h('div', { class: 'tab-rangee' }, jour, cellules));
    }
  }

  /** Repeint tout ce qui depend de la selection. Chaque fonction ne touche que SES noeuds. */
  function peindreSelection() {
    blocDetail.hidden = !principal();
    marquerGrille();
    peindreEnteteDetail();
    peindreMetriques();     // resout `metrique` : DOIT preceder record et courbe
    appliquerVue();
    peindreRecord();
    peindreCourbe();
    peindreComparaison();
    peindreCarnet();
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
    peindreCarnet();
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

    if (action === 'vue') {
      // Retour au carnet. `metrique` n'est PAS effacee : la carte record continue de l'habiller,
      // et revenir a la courbe retrouve l'onglet qu'on avait choisi.
      const nom = cible.getAttribute('data-vue');
      if (!nom || nom === vue) return;
      vue = nom;
      marquerOnglets();
      appliquerVue();
      peindreCourbe();       // detruit le fragment vivant en quittant la courbe
      peindreCarnet();
      return;
    }

    if (action === 'metrique') {
      const cle = cible.getAttribute('data-metrique');
      if (!cle) return;
      if (cle === metrique && vue === 'courbe') return;
      metrique = cle;
      vue = 'courbe';
      marquerOnglets();
      appliquerVue();
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
      // Et retour au CARNET : « le premier affiché quand on clique » vaut a chaque exercice
      // choisi, pas seulement a l'ouverture de l'ecran.
      vue = 'carnet';
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
