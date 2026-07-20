// views/seance.js — l'ecran de saisie en salle. C'est le chemin le plus chaud du projet.
//
// CONTRAT DE RENDU (zone B). Le DOM est construit UNE FOIS au montage et n'est plus jamais
// reconstruit. Il n'existe aucune fonction rerender() ici, et c'est volontaire : un rendu global
// detruirait le minuteur en cours, le defilement, le volet ouvert, le focus et — surtout — le
// bouton qui se trouve sous le doigt de l'utilisateur au moment ou il valide sa serie.
//
// Repartition de propriete :
//   · la coquille (#entete, #barre-action, #zone-minuteur, #btn-primaire) appartient a index.html.
//     Cette vue n'y MUTE que du textContent, des classes et des attributs, et remet tout en etat
//     dans destroy().
//   · chaque bloc d'exercice (accordeon) possede son sous-arbre et ses lignes ;
//   · chaque ligne de serie est un fragment vivant de ui/set-row.js : personne ne remplace son
//     sous-arbre, on lui demande figer() / editer() / setValeur().
//
// Valider une serie mute donc exactement quatre choses : la ligne concernee, la ligne suivante
// ajoutee a la fin du bloc, l'en-tete du bloc, et la barre d'action.
//
// ⚠ v2 — LE MINUTEUR N'EST PLUS DANS LE FLUX DES SERIES. Il ne demarre plus tout seul a la
//   validation, et la zone minuteur de la barre d'action basse est repliee : le bouton primaire
//   occupe desormais toute la largeur, ce qui agrandit la cible la plus utilisee de
//   l'application. Le repos CIBLE (entree.cibles.reposSec) reste une donnee de la seance : seul
//   son declenchement automatique disparait. Un tiroir lateral (js/ui/drawer-minuteur.js),
//   disponible partout, prend le relais ; cette vue ne le connait pas et ne l'importe pas.
//
// ⚠ v2 — ABANDONNER. Le menu porte une sortie de seance de plus, NETTEMENT distincte de
//   « Terminer » : la seance est conservee et reste dans l'historique, mais elle n'entre dans
//   aucune courbe ni statistique. Elle passe par commit('seance:abandonner').

import { h, on, delegate } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatFr } from '../lib/num.js';
import { dayKey } from '../lib/dates.js';

import * as store from '../data/store.js';
import * as hot from '../data/hot.js';
import { champsSaisieEntree } from '../data/schema.js';

import * as session from '../domain/session.js';
import * as prefill from '../domain/prefill.js';
// resumeSerie est l'UNIQUE formateur de serie du projet : le resume replie d'un bloc doit se
// lire exactement comme les lignes qu'il resume.
import { resumeSerie } from '../domain/metrics.js';

import * as router from '../ui/router.js';
import { icone } from '../ui/icons.js';
import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';
import * as setRow from '../ui/set-row.js';
import * as stepper from '../ui/stepper.js';
import * as keypad from '../ui/keypad.js';
import * as picker from '../ui/picker-exercice.js';

// Duree du toast d'annulation. 10 s et pas 3 : entre la validation et le moment ou l'utilisateur
// s'apercoit de son erreur, le telephone est reparti dans la poche.
const DUREE_ANNULATION_MS = 10000;

// Poids de corps par defaut quand aucune seance passee n'en porte : une valeur plausible se
// corrige d'un tap, un champ vide impose une saisie complete au pire moment.
const POIDS_PAR_DEFAUT_KG = 75;

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

function noeud(id) { return document.getElementById(id); }

function heureDe(ts) {
  const d = new Date(estNombre(ts) ? ts : Date.now());
  return String(d.getHours()) + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Nombre total de series prevues sur une entree, echauffement compris. null = seance libre :
// il n'y a rien a atteindre, on n'affiche donc pas de denominateur.
function totalCible(entree) {
  const c = (entree && entree.cibles) || {};
  if (!estNombre(c.series)) return null;
  return c.series + (estNombre(c.seriesEchauffement) ? c.seriesEchauffement : 0);
}

function nomExercice(entree) {
  const ex = store.exercice(entree.exerciceId);
  return (ex && ex.nom) || entree.nomAffiche || 'Exercice';
}

function metriqueCardioDe(entree) {
  const ex = store.exercice(entree.exerciceId);
  return (ex && ex.metriqueCardio) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// mount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Element} conteneur zone B (le <main> d'index.html)
 * @param {Object} params parametres de route : { modele, libre, cardio, sheet }
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur, params) {
  // ── Etat de la vue ─────────────────────────────────────────────────────────
  let seance = null;
  let detruit = false;
  let entryOuvert = null;
  /** @type {Map<string, Object>} entryId -> bloc d'exercice (fragment vivant) */
  const blocs = new Map();
  const desabonnements = [];

  // Vrai des que la seance est close par cette vue (abandon). Coupe les dernieres ecritures de
  // destroy() : reecrire le miroir chaud avec une seance abandonnee ressusciterait une proposition
  // de reprise que le store vient justement de purger.
  let seanceClose = false;
  let feuilleCourante = null;   // jeton { nom, interne, fermer } — voir demanderFeuille()
  // UN SEUL niveau d'annulation, en memoire : au-dela, « Annuler » devient un historique
  // d'edition, c'est-a-dire une fonctionnalite qu'il faudrait afficher et expliquer.
  let annulable = null;

  // ── Coquille : noeuds empruntes, jamais remplaces ──────────────────────────
  const barre = noeud('barre-action');
  const btnPrimaire = noeud('btn-primaire');
  const zoneMinuteur = noeud('zone-minuteur');
  const sousTitre = noeud('sous-titre-ecran');
  const btnMenu = noeud('btn-menu');
  const coquille = document.querySelector('.coquille') || document.body;

  // ── Sous-arbre de la vue, construit UNE fois ───────────────────────────────
  const etatLigne = h('p', { class: 'seance-etat' });
  const zoneBlocs = h('div', { class: 'blocs-exercices' });
  const btnAjouter = h('button', {
    class: 'bouton bouton-large ajouter-exercice',
    type: 'button',
    'data-action': 'ajouter-exercice'
  }, '+ Ajouter un exercice');

  const chargement = h('div', { class: 'etat-vide' },
    h('p', { class: 'etat-vide-titre' }, 'Préparation de la séance…'));

  const racine = h('section', { class: 'vue vue-seance' }, etatLigne, zoneBlocs, btnAjouter, chargement);
  conteneur.appendChild(racine);

  // ═══════════════════════════════════════════════════════════════════════════
  // Bloc d'exercice — fragment vivant, proprietaire de ses lignes
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @param {Object} entree entree de seance (coefficients GELES)
   * @returns {Object} bloc
   */
  function creerBloc(entree) {
    const entryId = entree.id;
    /** @type {Map<string, Object>} serieId -> poignee de ui/set-row.js */
    const lignes = new Map();
    let serieActiveId = null;
    // ⚠ CORRECTION D'UNE SERIE DEJA FAITE — etat SEPARE de la serie active. « Tap = edition »
    //   (ui/set-row.js) laisse corriger une ligne figee trois minutes plus tard ; si cette ligne
    //   devenait la serie active, le bouton primaire validerait une serie deja done et la seance
    //   partirait en vrille. Ici la serie active ne bouge pas : c'est le bouton primaire qui
    //   change de role le temps de la correction.
    let serieCorrigeeId = null;

    const chevron = h('span', { class: 'accordeon-chevron', 'aria-hidden': 'true' }, '▸');
    const titre = h('span', { class: 'accordeon-titre' }, nomExercice(entree));
    const resume = h('span', { class: 'accordeon-resume' });
    const compteur = h('span', { class: 'accordeon-compteur' });

    const entete = h('button', {
      class: 'accordeon-entete',
      type: 'button',
      'data-action': 'basculer',
      'data-entry': entryId,
      'aria-expanded': 'false'
    }, chevron, h('span', null, titre, h('br'), resume), compteur);

    // Rappel « Dernière fois » — NON EDITABLE. C'est le coeur de la valeur percue de
    // l'application : sans lui, l'utilisateur ne sait pas quoi mettre sur la barre.
    const rappelLabel = h('span');
    const rappelValeurs = h('span', { class: 'rappel-precedent-valeurs' });
    const rappel = h('div', { class: 'rappel-precedent', hidden: true }, rappelLabel, rappelValeurs);

    const zoneLignes = h('div', { class: 'zone-lignes' });

    const actions = h('div', { class: 'ligne-serie-actions' },
      h('button', { class: 'bouton bouton-fantome', type: 'button', 'data-action': 'plus-serie', 'data-entry': entryId }, '+ Série'),
      h('button', { class: 'bouton bouton-fantome', type: 'button', 'data-action': 'non-faite', 'data-entry': entryId }, '⊘ Non faite'),
      h('button', { class: 'bouton bouton-fantome', type: 'button', 'data-action': 'passer', 'data-entry': entryId }, 'Passer')
    );

    const corps = h('div', { class: 'accordeon-corps', hidden: true }, rappel, zoneLignes, actions);
    const element = h('div', { class: 'accordeon-exercice', 'data-entry': entryId }, entete, corps);

    // ── Rappel ───────────────────────────────────────────────────────────────
    function majRappel() {
      const meta = store.meta();
      const texte = prefill.rappelTextuel((meta && meta.lastPerf) || {}, entree.exerciceId);
      if (!texte) { rappel.hidden = true; return; }
      const coupe = texte.indexOf(' : ');
      if (coupe === -1) {
        rappelLabel.textContent = '';
        rappelValeurs.textContent = texte;
      } else {
        rappelLabel.textContent = texte.slice(0, coupe + 3);
        rappelValeurs.textContent = texte.slice(coupe + 3);
      }
      rappel.hidden = false;
    }

    // ── En-tete ──────────────────────────────────────────────────────────────
    function majEnteteBloc() {
      const faites = entree.series.filter((s) => s.done === true).length;
      const total = totalCible(entree);
      compteur.textContent = total == null ? String(faites) : faites + '/' + total;
      element.setAttribute('data-termine', total != null && faites >= total ? 'oui' : 'non');

      // Replie, le bloc doit rester informatif : la derniere serie reellement faite en dit plus
      // qu'un libelle, et evite d'avoir a deplier pour savoir ou on en est.
      const derniere = entree.series.filter((s) => s.done === true).slice(-1)[0] || null;
      resume.textContent = derniere ? resumeSerie(derniere, entree) : '';
      titre.textContent = nomExercice(entree);
    }

    // ── Lignes ───────────────────────────────────────────────────────────────
    function etatPour(serie, index) {
      if (serie.done === true) return 'faite';
      // La DERNIERE serie non faite est la serie active : les precedentes non faites sont des
      // series explicitement marquees « non faite » (marquerNonFaite les conserve).
      return index === dernierIndexNonFaite() ? 'en-edition' : 'non-faite';
    }

    function dernierIndexNonFaite() {
      for (let i = entree.series.length - 1; i >= 0; i--) {
        if (entree.series[i].done !== true) return i;
      }
      return -1;
    }

    function serieParId(id) {
      return id ? entree.series.find((s) => s.id === id) || null : null;
    }

    // La serie active est TOUJOURS la derniere non faite — la meme regle que etatPour(), sinon
    // l'etat visuel des lignes et l'etat interne du bloc divergeraient.
    function recalerSerieActive() {
      const i = dernierIndexNonFaite();
      serieActiveId = i === -1 ? null : entree.series[i].id;
    }

    /** Referme la correction en cours : la ligne se refige sur la serie telle qu'elle est MAINTENANT. */
    function cloreCorrection() {
      if (!serieCorrigeeId) return;
      const id = serieCorrigeeId;
      serieCorrigeeId = null;
      const poignee = lignes.get(id);
      const serie = serieParId(id);
      if (poignee && serie) poignee.figer(serie);
      recalerSerieActive();
    }

    function monterLigne(serie, index) {
      const etat = etatPour(serie, index);
      const poignee = setRow.monter(zoneLignes, {
        serie,
        entree,
        etat,
        numero: index + 1,
        metriqueCardio: metriqueCardioDe(entree),
        callbacks: {
          onEditer() {
            // Passer d'une ligne a une autre referme la correction en cours : elle est deja dans
            // la seance, on la rend durable plutot que de la laisser au seul miroir chaud.
            const fermait = serieCorrigeeId != null && serieCorrigeeId !== serie.id;
            if (fermait) cloreCorrection();
            // Correction d'une ligne figee : elle ne devient PAS la serie active.
            if (serie.done === true) serieCorrigeeId = serie.id;
            else serieActiveId = serie.id;
            if (fermait) persister();
            majBarre();
          },
          onSupprimer() { demanderSuppression(entryId, serie.id); },
          onChange(cle, valeur, valeurs) {
            if (serieCorrigeeId === serie.id) {
              // La correction redescend dans le DOMAINE des le premier cran : sans cela, un
              // rechargement de la page la perdrait purement et simplement. La base, elle,
              // attend la validation (persister) — un commit par cran de stepper serait absurde.
              session.modifierSerie(seance, entryId, serie.id, valeurs);
              majEnteteBloc();
            }
            // Edition continue (appui long sur un stepper) : au plus une ecriture par frame.
            // Ecrire a chaque cran ferait 16 JSON.stringify bloquants par seconde, exactement
            // au moment ou l'utilisateur regle sa charge.
            hot.ecrireDifferee(seance, brouillonActif(), { entryOuvert });
          },
          onKind(kind) {
            session.modifierSerie(seance, entryId, serie.id, { kind });
            majEnteteBloc();
            persister();
          },
          onNonFaite() { marquerNonFaite(entryId, serie.id); }
        }
      });
      lignes.set(serie.id, poignee);
      if (etat === 'en-edition') serieActiveId = serie.id;
      return poignee;
    }

    function construireLignes() {
      for (const poignee of lignes.values()) poignee.detruire();
      lignes.clear();
      serieActiveId = null;
      serieCorrigeeId = null;
      entree.series.forEach(monterLigne);
    }

    construireLignes();
    majRappel();
    majEnteteBloc();

    return {
      entryId,
      entree,
      element,

      /** Ajoute la ligne proposee par le domaine. Aucun noeud existant n'est touche. */
      ajouterLigne(serie) {
        const poignee = monterLigne(serie, entree.series.length - 1);
        serieActiveId = serie.id;
        return poignee;
      },

      retirerLigne(serieId) {
        const poignee = lignes.get(serieId);
        if (!poignee) return;
        poignee.detruire();
        lignes.delete(serieId);
        if (serieActiveId === serieId) serieActiveId = null;
        if (serieCorrigeeId === serieId) serieCorrigeeId = null;
      },

      /** Reconstruction des SEULES lignes du bloc — legitime : le bloc les possede. Utilisee
       *  apres une suppression, pour que la numerotation reste exacte. */
      reconstruireLignes: construireLignes,

      ligne(serieId) { return lignes.get(serieId) || null; },

      serieActive() {
        if (!serieActiveId) return null;
        return entree.series.find((s) => s.id === serieActiveId) || null;
      },

      poigneeActive() { return serieActiveId ? lignes.get(serieActiveId) || null : null; },

      /** Serie deja faite en cours de correction, ou null. */
      serieCorrigee() { return serieParId(serieCorrigeeId); },

      /** Referme la correction : la ligne se refige et la serie active redevient la bonne. */
      cloreCorrection,

      /** Remet une ligne validee en edition (annulation). */
      reactiver(serieId) {
        const poignee = lignes.get(serieId);
        if (!poignee) return;
        serieCorrigeeId = null;
        serieActiveId = serieId;
        poignee.editer();
      },

      // Le volet replie est retire du flux avec [hidden] et non par une hauteur animee : une
      // transition de hauteur sur huit exercices fait tressauter le defilement au moment precis
      // de l'avance automatique. Le chevron, lui, pivote en CSS sur aria-expanded.
      ouvrir(ouvert) {
        corps.hidden = !ouvert;
        entete.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
      },

      majEntete: majEnteteBloc,
      majRappel,

      detruire() {
        for (const poignee of lignes.values()) poignee.detruire();
        lignes.clear();
        if (element.parentNode) element.parentNode.removeChild(element);
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Construction / demarrage
  // ═══════════════════════════════════════════════════════════════════════════

  async function demarrer(p) {
    let active = store.seanceActive();

    // La vue accepte de LANCER la seance si l'accueil s'est contente de naviguer. Le garde-fou
    // est le meme que celui du store : jamais deux seances actives.
    if (!active && p && (p.modele || p.libre || p.cardio)) {
      try {
        const ctx = { exercices: store.exercice };
        const brouillon = p.cardio
          ? session.demarrerCardio(p.cardio, ctx)
          : session.demarrer(p.modele ? store.modele(p.modele) : null, ctx);
        const resultat = await store.commit('seance:demarrer', { seance: brouillon });
        active = (resultat && resultat.seance) || brouillon;
      } catch (err) {
        console.error('[seance] démarrage impossible', err);
      }
    }

    if (detruit) return;

    if (!active) {
      chargement.textContent = '';
      chargement.appendChild(h('p', { class: 'etat-vide-titre' }, 'Aucune séance en cours'));
      chargement.appendChild(h('p', { class: 'etat-vide-texte' },
        'Lance une séance depuis l\'accueil pour commencer à saisir tes séries.'));
      chargement.appendChild(h('p', null, h('a', { class: 'bouton', href: '#/' }, 'Revenir à l\'accueil')));
      return;
    }

    seance = active;
    chargement.hidden = true;

    construire();

    // ⚠ Poids de corps demande AU LANCEMENT et non a la fin : chargeEffectiveKg en depend
    //   PENDANT toute la seance (poids du corps, gainage, tractions lestees). Le demander a la
    //   cloture obligerait a reinterpreter apres coup des series deja affichees.
    if (!estNombre(seance.poidsDeCorpsKg)) demanderFeuille('poids');
    else appliquerFeuille((p && p.sheet) || null);
  }

  function construire() {
    // Coquille : on devoile la barre d'action et on s'empare du bouton primaire.
    if (barre) barre.hidden = false;
    if (btnMenu) btnMenu.hidden = false;
    if (sousTitre) sousTitre.hidden = false;
    coquille.setAttribute('data-seance', 'active');

    for (const entree of seance.entrees) {
      const bloc = creerBloc(entree);
      blocs.set(entree.id, bloc);
      zoneBlocs.appendChild(bloc.element);
    }

    // ⚠ Zone minuteur REPLIEE. Le noeud appartient a index.html : on ne le supprime jamais, on
    //   l'escamote et on le rend a son etat de repos dans destroy(). La classe posee sur la barre
    //   dit au CSS que le bouton primaire est desormais SEUL dans la barre — il prend toute la
    //   largeur au lieu de laisser 88 px a un minuteur qui n'est plus la.
    if (zoneMinuteur) zoneMinuteur.hidden = true;
    if (barre) barre.classList.add('barre-action-pleine');

    // Volet ouvert : la ou l'utilisateur en etait reellement, y compris apres un kill de l'app.
    const chaud = hot.lire();
    const memorise = chaud && chaud.seanceId === seance.id ? chaud.entryOuvert : null;
    const position = session.prochainePosition(seance);
    ouvrirBloc(memorise && blocs.has(memorise) ? memorise : (position ? position.entryId : (seance.entrees[0] && seance.entrees[0].id)) || null, false);

    prereplirActive();
    majEntete();
    majBarre();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Coquille — mutations ciblees uniquement
  // ═══════════════════════════════════════════════════════════════════════════

  function majEntete() {
    if (!seance) return;
    const titreEcran = noeud('titre-ecran');
    const nom = (seance.modeleSnapshot && seance.modeleSnapshot.nom) || 'Séance libre';
    // ⚠ Le routeur reecrit ce titre a chaque changement de parametre : on le repose donc aussi
    //   depuis onParams(), sinon l'ouverture d'une feuille ferait reapparaitre « Seance ».
    if (titreEcran) titreEcran.textContent = nom;

    const position = session.prochainePosition(seance);
    const index = position ? seance.entrees.findIndex((e) => e.id === position.entryId) : -1;
    const situation = index === -1
      ? 'Tout est fait'
      : 'Exercice ' + (index + 1) + '/' + seance.entrees.length;
    if (sousTitre) sousTitre.textContent = heureDe(seance.startedAt) + ' · ' + situation;

    etatLigne.textContent = estNombre(seance.poidsDeCorpsKg)
      ? 'Poids de corps : ' + formatFr(seance.poidsDeCorpsKg) + ' kg'
      : 'Poids de corps non renseigné';
  }

  /** Bloc dont une serie deja faite est en cours de correction, ou null. */
  function blocCorrige() {
    const ouvert = entryOuvert ? blocs.get(entryOuvert) : null;
    if (ouvert && ouvert.serieCorrigee()) return ouvert;
    for (const bloc of blocs.values()) if (bloc.serieCorrigee()) return bloc;
    return null;
  }

  function majBarre() {
    if (!btnPrimaire) return;
    // Une correction en cours s'empare du bouton primaire : proposer « Valider la serie »
    // pendant qu'une ligne deja faite est ouverte en edition ne dirait pas ce que le tap fait.
    if (blocCorrige()) {
      btnPrimaire.textContent = 'ENREGISTRER LA CORRECTION';
      btnPrimaire.setAttribute('data-role', 'corriger');
      btnPrimaire.disabled = false;
      return;
    }
    const position = seance ? session.prochainePosition(seance) : null;
    if (position) {
      btnPrimaire.textContent = 'VALIDER LA SÉRIE';
      btnPrimaire.setAttribute('data-role', 'valider');
    } else {
      // Le bouton primaire n'est jamais remplace ni deplace : seul son libelle change. Proposer
      // « Valider » quand il n'y a plus rien a valider serait un tap dans le vide.
      btnPrimaire.textContent = 'TERMINER LA SÉANCE';
      btnPrimaire.setAttribute('data-role', 'terminer');
    }
    btnPrimaire.disabled = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Accordeon — un seul volet ouvert
  // ═══════════════════════════════════════════════════════════════════════════

  function ouvrirBloc(entryId, defiler) {
    if (!entryId || !blocs.has(entryId)) return;
    if (entryOuvert === entryId) {
      if (defiler) defilerVers(entryId);
      return;
    }
    for (const [id, bloc] of blocs) bloc.ouvrir(id === entryId);
    entryOuvert = entryId;
    hot.ecrire(seance, brouillonActif(), { entryOuvert });
    if (defiler) defilerVers(entryId);
  }

  function defilerVers(entryId) {
    const bloc = blocs.get(entryId);
    if (!bloc) return;
    // Deux frames : le volet vient d'etre devoile, sa position finale n'est pas encore calculee.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (detruit) return;
      try { bloc.element.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      catch (_) { bloc.element.scrollIntoView(true); }
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pre-remplissage
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pre-remplit la ligne active d'un bloc via domain/prefill.
   * ⚠ On ecrit dans le BROUILLON de la ligne (setValeur), jamais dans la serie : tant que
   *   l'utilisateur n'a pas valide, rien n'est un fait.
   */
  function preremplir(entryId) {
    const bloc = blocs.get(entryId);
    if (!bloc) return;
    const poignee = bloc.poigneeActive();
    const serie = bloc.serieActive();
    if (!poignee || !serie) return;

    const meta = store.meta();
    const resultat = prefill.valeursPour(bloc.entree.exerciceId, bloc.entree, seance, (meta && meta.lastPerf) || {});
    const champsAutorises = champsSaisieEntree(bloc.entree);
    for (const cle of champsAutorises) {
      if (!estNombre(resultat.champs[cle])) continue;
      poignee.setValeur(cle, resultat.champs[cle]);
    }
  }

  function prereplirActive() {
    for (const id of blocs.keys()) preremplir(id);
  }

  function brouillonActif() {
    const bloc = entryOuvert ? blocs.get(entryOuvert) : null;
    const poignee = bloc ? bloc.poigneeActive() : null;
    if (!bloc || !poignee) return null;
    return { entryId: bloc.entryId, serieId: (bloc.serieActive() || {}).id || null, valeurs: poignee.valeurs() };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Persistance
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ecrit la seance. hot en premier (synchrone, survit a un kill immediat), IndexedDB ensuite.
   * ⚠ Une vue n'ecrit JAMAIS dans IndexedDB : elle passe par store.commit().
   */
  function persister() {
    if (!seance) return;
    hot.ecrire(seance, brouillonActif(), { entryOuvert });
    store.commit('seance:mettre-a-jour', { seance }).catch((err) => {
      console.error('[seance] enregistrement en échec', err);
      toast.afficher('Enregistrement en échec — tes données restent dans le cache de reprise.', { duree: 8000 });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Actions de saisie
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enregistre la correction d'une serie DEJA validee. C'est le seul chemin qui fait redescendre
   * une edition de ligne figee dans le domaine puis dans la base : `at` n'est pas reecrit
   * (domain/session.modifierSerie s'en charge), le repos reel de l'exercice reste donc exact.
   */
  function validerCorrection(bloc) {
    const serie = bloc.serieCorrigee();
    if (!serie || !seance) return;
    const poignee = bloc.ligne(serie.id);
    if (poignee) session.modifierSerie(seance, bloc.entryId, serie.id, poignee.valeurs());

    // Mutations CIBLEES : la ligne se refige, l'en-tete du bloc suit, rien d'autre ne bouge.
    bloc.cloreCorrection();
    bloc.majEntete();
    persister();
    majEntete();
    majBarre();
    toast.afficher('Correction enregistrée', { duree: 4000 });
  }

  function validerSerie() {
    if (!seance) return;

    // Une correction en cours passe AVANT tout : sans cela, l'edition d'une ligne figee ne
    // redescendrait jamais et le bouton validerait une serie deja faite.
    const enCorrection = blocCorrige();
    if (enCorrection) { validerCorrection(enCorrection); return; }

    const position = session.prochainePosition(seance);
    if (!position) { terminerSeance(); return; }

    // La serie validee est celle du volet ouvert si elle est encore a faire, sinon celle que le
    // domaine designe. On ne valide jamais « la premiere non faite » implicitement : une serie
    // marquee « non faite » plus haut dans le bloc serait alors ecrasee.
    let entryId = position.entryId;
    let bloc = blocs.get(entryOuvert);
    let serie = bloc ? bloc.serieActive() : null;
    if (bloc && serie && serie.done !== true) entryId = bloc.entryId;
    else { bloc = blocs.get(entryId); serie = bloc ? bloc.serieActive() : null; }
    if (!bloc || !serie) return;

    const poignee = bloc.ligne(serie.id);
    if (!poignee) return;

    const champs = Object.assign({}, poignee.valeurs(), { serieId: serie.id, at: Date.now() });
    const resultat = session.validerSerie(seance, entryId, champs);
    if (!resultat.serie) return;

    // ── Mutations CIBLEES, aucune reconstruction ────────────────────────────
    poignee.figer(resultat.serie);
    if (resultat.suivante) bloc.ajouterLigne(resultat.suivante);
    bloc.majEntete();

    annulable = { entryId, serieId: resultat.serie.id, suivanteId: resultat.suivante ? resultat.suivante.id : null };

    // ⚠ AUCUN REPOS AUTOMATIQUE. domain/session.validerSerie arme encore le minuteur avec la
    //   duree de repos ciblee — c'est une fonction PURE et TESTEE, on ne la touche pas — mais
    //   valider une serie ne doit plus declencher de compte a rebours : le minuteur a quitte le
    //   flux des series et vit dans son propre tiroir, ou l'utilisateur le lance quand il veut.
    //   On desarme donc AVANT de persister, pour que ni la base ni le miroir chaud ne portent un
    //   repos que personne n'a demande. `entree.cibles.reposSec` n'est pas touche : le repos
    //   cible reste une donnee de la seance, lisible par le tiroir comme duree proposee.
    session.arreterRepos(seance);

    persister();

    toast.afficher('Série enregistrée', {
      duree: DUREE_ANNULATION_MS,
      annuler: () => annulerValidation()
    });

    // ── AVANCE AUTOMATIQUE ─────────────────────────────────────────────────
    // Le tap le plus facilement economisable de toute la seance : apres la derniere serie
    // ciblee, le volet suivant s'ouvre et defile en position, sans que rien ne soit tape.
    const suite = session.prochainePosition(seance);
    if (suite && suite.entryId !== entryId) {
      ouvrirBloc(suite.entryId, true);
      preremplir(suite.entryId);
    } else if (resultat.suivante) {
      preremplir(entryId);
    }

    majEntete();
    majBarre();
  }

  function annulerValidation() {
    const info = annulable;
    annulable = null;
    if (!info || !seance) return;
    const bloc = blocs.get(info.entryId);
    if (!bloc) return;

    // La serie proposee dans la foulee disparait avec l'annulation : la laisser ferait deux
    // lignes vides sur un bloc qui n'en attend qu'une.
    if (info.suivanteId) {
      session.supprimerSerie(seance, info.entryId, info.suivanteId);
      bloc.retirerLigne(info.suivanteId);
    }
    session.modifierSerie(seance, info.entryId, info.serieId, { done: false });
    // Filet : plus rien n'arme le repos a la validation, mais une seance reprise d'une version
    // precedente peut en porter un. L'annulation reste le bon endroit pour le desarmer.
    session.arreterRepos(seance);

    bloc.reactiver(info.serieId);
    bloc.majEntete();
    ouvrirBloc(info.entryId, false);
    persister();
    majEntete();
    majBarre();
    toast.afficher('Série annulée', { duree: 4000 });
  }

  /** « + Série » : une serie de plus AU-DELA de la cible. La cible n'est pas relevee. */
  function ajouterSerie(entryId) {
    const bloc = blocs.get(entryId);
    if (!bloc || !seance) return;
    session.ajouterSerie(seance, entryId, {});
    const serie = bloc.entree.series[bloc.entree.series.length - 1];
    if (!serie) return;
    bloc.ajouterLigne(serie);
    bloc.majEntete();
    preremplir(entryId);
    persister();
    majBarre();
  }

  /**
   * « Non faite » : done:false. La serie est CONSERVEE — elle porte l'information « c'était
   * prévu et ça n'a pas été fait », qui disparaitrait avec une suppression — mais estComptable()
   * l'exclut de tout agregat, courbe et record.
   */
  function marquerNonFaite(entryId, serieId) {
    const bloc = blocs.get(entryId);
    if (!bloc || !seance) return;
    const serie = serieId ? bloc.entree.series.find((s) => s.id === serieId) : bloc.serieActive();
    if (!serie) return;

    const avant = bloc.entree.series.length;
    session.marquerNonFaite(seance, entryId, serie.id);

    const poignee = bloc.ligne(serie.id);
    if (poignee) poignee.figer(serie);      // la ligne se barre, elle n'est pas retiree
    // marquerNonFaite propose la serie suivante dans la foulee : sauter une serie ne doit pas
    // laisser l'exercice sans ligne active.
    if (bloc.entree.series.length > avant) {
      bloc.ajouterLigne(bloc.entree.series[bloc.entree.series.length - 1]);
      preremplir(entryId);
    }
    bloc.majEntete();
    persister();
    majEntete();
    majBarre();
  }

  /**
   * « Passer » : reporte l'exercice a la FIN de la liste. Machine occupee, c'est le cas
   * non-nominal numero un en salle. On DEPLACE le noeud du bloc, on ne le reconstruit pas.
   */
  function passerExercice(entryId) {
    if (!seance) return;
    const bloc = blocs.get(entryId);
    if (!bloc) return;
    session.passerExercice(seance, entryId);
    zoneBlocs.appendChild(bloc.element);            // appendChild DEPLACE un noeud existant
    bloc.element.classList.add('exercice-reporte');

    const suite = session.prochainePosition(seance);
    if (suite) { ouvrirBloc(suite.entryId, true); preremplir(suite.entryId); }
    persister();
    majEntete();
    majBarre();
  }

  function demanderSuppression(entryId, serieId) {
    const bloc = blocs.get(entryId);
    if (!bloc || !seance) return;
    const jeton = { nom: 'suppression', interne: false, fermer: null };
    const poignee = sheet.ouvrir({
      titre: 'Supprimer la série ?',
      contenu: h('p', null, 'Cette série sera définitivement retirée de la séance.'),
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Supprimer',
          variante: 'danger',
          action: () => {
            session.supprimerSerie(seance, entryId, serieId);
            // Reconstruction des SEULES lignes de ce bloc : il en est proprietaire, et c'est le
            // seul moyen de garder une numerotation exacte apres un retrait au milieu.
            bloc.reconstruireLignes();
            preremplir(entryId);
            bloc.majEntete();
            persister();
            majEntete();
            majBarre();
          }
        }
      ],
      onFermer: () => { if (feuilleCourante === jeton) feuilleCourante = null; }
    });
    jeton.fermer = poignee.fermer;
    feuilleCourante = jeton;
  }

  function terminerSeance() {
    persister();
    router.aller('#/seance/fin');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Abandon — NETTEMENT distinct de « Terminer »
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Confirmation d'abandon. Elle DIT ce qui va se passer, parce que « abandonner » ne le dit pas :
   * on ne sait pas, en lisant le mot, si la seance sera effacee, cachee ou comptee.
   *
   * Feuille LOCALE et non parametre de route : l'action navigue, et pousser `?sheet=abandon` juste
   * avant de naviguer laisserait le retour rouvrir la confirmation d'un abandon deja fait.
   */
  function demanderAbandon() {
    if (!seance) return;
    const jeton = { nom: 'abandon', interne: false, fermer: null };
    fermerFeuilleLocale();

    const contenu = h('div', { class: 'confirmation' },
      h('p', { class: 'confirmation-texte' },
        'La séance est CONSERVÉE : elle restera visible dans l\'historique, marquée « Abandonnée ». ' +
        'Les séries déjà saisies ne sont pas effacées.'),
      h('p', { class: 'confirmation-consequence' },
        'Mais elle n\'entrera dans AUCUNE courbe ni statistique : ni tonnage, ni record, ni rappel ' +
        '« Dernière fois ».'),
      h('p', { class: 'confirmation-texte' },
        'Pour qu\'elle compte, choisis plutôt « Terminer la séance ».')
    );

    const poignee = sheet.ouvrir({
      titre: 'Abandonner la séance ?',
      contenu,
      actions: [
        { libelle: 'Continuer la séance', variante: 'fantome' },
        { libelle: 'Abandonner', variante: 'danger', action: abandonnerSeance }
      ],
      onFermer: () => { if (feuilleCourante === jeton) feuilleCourante = null; }
    });
    jeton.fermer = poignee.fermer;
    feuilleCourante = jeton;
  }

  /**
   * Abandonne pour de bon. La seance est passee en 'abandonnee' par store.commit — la vue n'ecrit
   * jamais dans IndexedDB elle-meme.
   *
   * ⚠ La derniere mise a jour est CHAINEE avant l'abandon. Les deux commits ecrivent la meme
   *   seance : lancer l'abandon sans attendre laisserait une ecriture « en-cours » encore en vol
   *   se poser APRES lui, et la seance rouvrirait au demarrage suivant comme si rien ne s'etait
   *   passe.
   */
  function abandonnerSeance() {
    if (!seance || seanceClose) return;
    const cible = seance;
    const id = cible.id;
    seanceClose = true;

    // Filet synchrone avant toute promesse : si l'application meurt ici, le miroir chaud porte
    // encore la derniere serie saisie.
    try { hot.ecrire(cible, brouillonActif(), { entryOuvert }); } catch (_) { /* cache seul */ }

    store.commit('seance:mettre-a-jour', { seance: cible })
      .catch((err) => { console.warn('[seance] dernière mise à jour avant abandon en échec', err); })
      .then(() => store.commit('seance:abandonner', { seance: cible }))
      .then(() => {
        toast.afficher('Séance abandonnée. Elle reste dans l\'historique, hors des statistiques.', { duree: 8000 });
        router.aller('#/historique/' + encodeURIComponent(id));
      })
      .catch((err) => {
        seanceClose = false;
        console.error('[seance] abandon en échec', err);
        toast.afficher('La séance n\'a pas pu être abandonnée. Elle reste en cours.', { duree: 8000 });
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Feuilles — jamais une navigation : #/seance n'est JAMAIS demonte par une saisie
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Demande l'ouverture d'une feuille. ⚠ Ce n'est PAS une navigation : la route de base ne
   * change pas et la vue n'est pas demontee — elle recoit simplement onParams({sheet}). Le seul
   * effet de bord est une entree d'historique, et c'est exactement ce qui fait que le bouton
   * retour d'Android ferme la feuille au lieu de quitter la seance.
   */
  function demanderFeuille(nom) {
    if (feuilleCourante && feuilleCourante.nom === nom) return;
    router.ouvrirFeuille(nom);
  }

  /** Ferme la feuille SANS toucher a l'URL (fermeture decidee par la vue, pas par l'utilisateur). */
  function fermerFeuilleLocale() {
    const f = feuilleCourante;
    feuilleCourante = null;
    if (!f) return;
    // Le jeton porte l'intention : son onFermer, appele apres la transition de sortie, sait
    // ainsi qu'il n'a pas a remonter l'historique.
    f.interne = true;
    if (typeof f.fermer === 'function') { try { f.fermer(); } catch (_) { /* deja fermee */ } }
  }

  function appliquerFeuille(nom) {
    if (!nom) { fermerFeuilleLocale(); return; }
    if (feuilleCourante && feuilleCourante.nom === nom) return;
    fermerFeuilleLocale();
    if (nom === 'ajout-exercice') ouvrirAjoutExercice();
    else if (nom === 'poids') ouvrirPoids();
  }

  /**
   * Ajout d'un exercice a la volee. FEUILLE, jamais une navigation : le volet ouvert, la
   * position de defilement et le minuteur en cours survivent par construction.
   */
  function ouvrirAjoutExercice() {
    const jeton = { nom: 'ajout-exercice', interne: false, fermer: null };
    const poignee = picker.ouvrir({
      onChoisir: (exercice) => {
        if (feuilleCourante === jeton) feuilleCourante = null;
        router.fermerFeuille();
        if (!exercice || !seance || detruit) return;
        session.ajouterExercice(seance, exercice.id, exercice, { lieuId: seance.lieuId });
        const entree = seance.entrees[seance.entrees.length - 1];
        const bloc = creerBloc(entree);
        blocs.set(entree.id, bloc);
        zoneBlocs.appendChild(bloc.element);
        ouvrirBloc(entree.id, true);
        preremplir(entree.id);
        persister();
        majEntete();
        majBarre();
      },
      // Fermeture par le voile, la poignee ou Echap : le selecteur nous la fait redescendre. Sans
      // ce rappel, `?sheet=ajout-exercice` resterait dans l'URL et le bouton retour rouvrirait la
      // feuille que l'utilisateur vient de fermer.
      onFermer: () => {
        if (feuilleCourante !== jeton) return;   // deja traitee par onChoisir
        feuilleCourante = null;
        if (!jeton.interne && !detruit) router.fermerFeuille();
      }
    });
    jeton.fermer = poignee.fermer;
    feuilleCourante = jeton;
  }

  /**
   * Poids de corps, demande AU LANCEMENT. Pre-rempli depuis le dernier connu : zero tap s'il
   * n'a pas bouge, ce qui est le cas neuf fois sur dix.
   */
  function ouvrirPoids() {
    const jeton = { nom: 'poids', interne: false, fermer: null };
    const depart = estNombre(seance && seance.poidsDeCorpsKg) ? seance.poidsDeCorpsKg : dernierPoidsConnu();
    let valeur = depart;

    const hote = h('div');
    const commande = stepper.monter(hote, {
      valeur: depart,
      pas: 0.5,
      min: 20,
      max: 300,
      unite: 'kg',
      libelle: 'Poids de corps',
      onChange: (v) => { valeur = v; },
      onTapValeur: () => keypad.ouvrir({
        champs: [{ cle: 'kg', label: 'Poids de corps', valeur, unite: 'kg', pas: 0.5, min: 20, max: 300 }],
        onValider: (valeurs) => {
          if (!estNombre(valeurs.kg)) return;
          valeur = valeurs.kg;
          commande.setValeur(valeur);
        }
      })
    });

    const contenu = h('div', null,
      h('p', { class: 'ligne-liste-secondaire' },
        'La charge effective des tractions, dips et gainages en dépend pendant toute la séance.'),
      hote
    );

    const poignee = sheet.ouvrir({
      titre: 'Poids de corps',
      contenu,
      actions: [
        { libelle: 'Passer', variante: 'fantome', action: () => { commande.detruire(); } },
        {
          libelle: 'Enregistrer',
          variante: 'primaire',
          action: () => {
            commande.detruire();
            if (!seance || !estNombre(valeur)) return;
            seance.poidsDeCorpsKg = valeur;
            seance.updatedAt = Date.now();
            persister();
            // Le poids du jour rejoint aussi son propre magasin : la date EST la cle primaire,
            // une re-saisie ecrase au lieu d'empiler.
            store.commit('poids:enregistrer', { poids: { date: dayKey(new Date()), kg: valeur, source: 'seance' } })
              .catch((err) => console.warn('[seance] poids non enregistré', err));
            majEntete();
          }
        }
      ],
      onFermer: () => {
        if (feuilleCourante === jeton) feuilleCourante = null;
        if (!jeton.interne) router.fermerFeuille();
      }
    });
    jeton.fermer = poignee.fermer;
    feuilleCourante = jeton;
  }

  /** Dernier poids de corps connu, cherche dans les seances deja chargees. */
  function dernierPoidsConnu() {
    for (const s of store.seances()) {
      if (estNombre(s.poidsDeCorpsKg)) return s.poidsDeCorpsKg;
    }
    return POIDS_PAR_DEFAUT_KG;
  }

  /**
   * Menu de seance. ⚠ Volontairement une feuille LOCALE, sans parametre de route : un de ses
   * items navigue (« Terminer la seance »), et pousser une entree d'historique juste avant de
   * naviguer laisserait `?sheet=menu` derriere soi — le retour depuis l'ecran de fin rouvrirait
   * alors le menu.
   */
  // Delegate des items du menu. UNE SEULE instance vivante a la fois : elle est detachee par tous
  // les chemins de fermeture (item, voile, croix, Echap) et par destroy(). L'empiler dans
  // `desabonnements` ne suffisait pas : la feuille se rouvre, l'ecouteur precedent restait.
  let offMenuItems = null;
  function detacherMenuItems() {
    if (!offMenuItems) return;
    const off = offMenuItems;
    offMenuItems = null;
    try { off(); } catch (_) { /* deja detache */ }
  }

  /** Un item du menu : pictogramme, libelle, et une ligne de consequence quand elle n'est pas
   *  evidente. Les deux items de sortie de seance en ont une — c'est ce qui les distingue. */
  function itemMenu(cle, nomIcone, libelle, consequence, ton) {
    // ⚠ Le ton passe par un attribut et non par une seconde classe : tests.html ne collecte les
    //   classes que dans les litteraux `class: '…'`, une classe posee conditionnellement
    //   echapperait donc a la verification « toute classe posee a une regle CSS ».
    return h('button', {
      class: 'ligne-liste menu-seance-item',
      type: 'button',
      'data-ton': ton || 'neutre',
      'data-menu': cle
    },
      h('span', { class: 'menu-seance-icone' }, icone(nomIcone, { taille: 24 })),
      h('span', { class: 'menu-seance-textes' },
        h('span', { class: 'ligne-liste-principal' }, libelle),
        consequence ? h('span', { class: 'ligne-liste-secondaire' }, consequence) : null
      )
    );
  }

  function ouvrirMenu() {
    const jeton = { nom: 'menu', interne: false, fermer: null };
    detacherMenuItems();
    fermerFeuilleLocale();
    const contenu = h('div', { class: 'liste menu-seance' },
      itemMenu('ajout', 'plus', 'Ajouter un exercice'),
      itemMenu('poids', 'poids-du-corps', 'Poids de corps'),
      itemMenu('terminer', 'coche', 'Terminer la séance',
        'Elle compte dans les courbes, les records et le tonnage.'),
      // ⚠ Separee des autres : abandonner et terminer se ressemblent trop pour cohabiter dans une
      //   liste uniforme. Le ton, le pictogramme et la consequence les opposent explicitement.
      h('div', { class: 'menu-seance-separateur', 'aria-hidden': 'true' }),
      itemMenu('abandonner', 'croix', 'Abandonner la séance',
        'Conservée dans l\'historique, mais hors de toute statistique.', 'danger')
    );

    const poignee = sheet.ouvrir({
      titre: 'Séance',
      contenu,
      // TOUS les chemins de fermeture passent par ici : c'est le seul endroit ou l'ecouteur des
      // items peut etre detache a coup sur.
      onFermer: () => {
        detacherMenuItems();
        if (feuilleCourante === jeton) feuilleCourante = null;
      }
    });
    jeton.fermer = poignee.fermer;
    feuilleCourante = jeton;

    const off = delegate(contenu, 'click', '[data-menu]', (ev, cible) => {
      ev.preventDefault();
      const quoi = cible.getAttribute('data-menu');
      // Detache tout de suite : la feuille met un instant a sortir, un second tap pendant la
      // transition declencherait deux fois l'item.
      detacherMenuItems();
      fermerFeuilleLocale();
      // On differe pour ne pas ouvrir une feuille pendant la sortie de la precedente : le voile
      // clignoterait et deux pieges a focus se superposeraient.
      //
      // ⚠ MAIS ce report ne peut pas reposer sur le seul requestAnimationFrame. rAF ne
      // s'execute pas quand la page n'est pas rendue, et « Terminer la seance » passe par ici :
      // le bouton ne faisait alors STRICTEMENT RIEN, sans erreur en console. On declenche donc
      // sur le premier des deux signaux qui arrive, cadre de rendu ou minuterie.
      // ⚠ « Abandonner » emprunte EXACTEMENT le meme chemin, et pour la meme raison.
      let lance = false;
      const executer = () => {
        if (lance || detruit) return;
        lance = true;
        if (quoi === 'ajout') demanderFeuille('ajout-exercice');
        else if (quoi === 'poids') demanderFeuille('poids');
        else if (quoi === 'terminer') terminerSeance();
        else if (quoi === 'abandonner') demanderAbandon();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(executer);
      setTimeout(executer, 50);
    });
    offMenuItems = off;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Ecouteurs — UN SEUL click delegue pour toute la vue
  // ═══════════════════════════════════════════════════════════════════════════

  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    const entryId = cible.getAttribute('data-entry');
    if (action === 'basculer') {
      ev.preventDefault();
      // Re-taper le volet ouvert ne le referme pas : un accordeon entierement replie n'offre
      // plus aucune cible de saisie, et le bouton primaire n'aurait plus rien a valider.
      ouvrirBloc(entryId, false);
      return;
    }
    if (action === 'plus-serie') { ev.preventDefault(); ajouterSerie(entryId); return; }
    if (action === 'non-faite') { ev.preventDefault(); marquerNonFaite(entryId, null); return; }
    if (action === 'passer') { ev.preventDefault(); passerExercice(entryId); return; }
    if (action === 'ajouter-exercice') { ev.preventDefault(); demanderFeuille('ajout-exercice'); return; }
  }));

  const offPrimaire = btnPrimaire ? on(btnPrimaire, 'click', (ev) => {
    ev.preventDefault();
    if (btnPrimaire.getAttribute('data-role') === 'terminer') terminerSeance();
    else validerSerie();
  }) : null;

  const offMenu = btnMenu ? on(btnMenu, 'click', (ev) => { ev.preventDefault(); ouvrirMenu(); }) : null;

  // Le minuteur — desormais un tiroir lateral, monte ailleurs — publie ses ajustements (+30 s,
  // pause, arret) sur le bus. La vue reste le seul endroit qui les rend DURABLES sur la seance :
  // c'est elle qui la possede. L'abonnement survit donc au retrait du minuteur de cette barre.
  desabonnements.push(bus.on('repos:modifie', ({ repos }) => {
    if (!seance || detruit) return;
    if (repos) seance.repos = { finAt: repos.finAt, totalSec: repos.totalSec };
    else session.arreterRepos(seance);
    seance.updatedAt = Date.now();
    hot.ecrire(seance, brouillonActif(), { entryOuvert });
  }));

  // L'historique arrive en tache de fond : lastPerf peut alors avoir ete complete, et le rappel
  // « Dernière fois » devenir disponible la ou il manquait. On ne remonte QUE le rappel.
  desabonnements.push(bus.on('historique:pret', () => {
    if (detruit) return;
    for (const bloc of blocs.values()) bloc.majRappel();
  }));

  desabonnements.push(bus.on('derives:recalcules', () => {
    if (detruit) return;
    for (const bloc of blocs.values()) bloc.majRappel();
  }));

  // Quota localStorage sature : la seance n'est pas menacee (IDB fait autorite), seule la
  // reprise apres coupure l'est. On le dit, une fois.
  desabonnements.push(bus.on('hot:quota', () => {
    if (detruit) return;
    toast.afficher('Cache de reprise saturé : pense à exporter tes données.', { duree: 8000 });
  }));

  // ── Demarrage asynchrone ───────────────────────────────────────────────────
  demarrer(params);

  // ═══════════════════════════════════════════════════════════════════════════
  // Contrat de vue
  // ═══════════════════════════════════════════════════════════════════════════

  return {
    /**
     * Seuls les parametres ont change : la vue n'est PAS remontee. C'est ce qui permet
     * d'ouvrir une feuille sans detruire le minuteur, le volet ouvert et le defilement.
     */
    onParams(p) {
      if (detruit) return;
      majEntete();                       // le routeur vient de reecrire le titre de la coquille
      if (!seance) return;
      const nom = (p && p.sheet) || null;
      appliquerFeuille(nom);
    },

    destroy() {
      detruit = true;

      // ⚠ `seanceClose` : la seance vient d'etre abandonnee. Le store a purge le miroir chaud et clos
      //   la seance — la reecrire ici la ferait reapparaitre comme reprenable au demarrage suivant.
      if (!seanceClose) {
        // Une correction laissee ouverte est deja dans la seance : on la fait descendre en base
        // avant de rendre la main, sinon elle ne vivrait plus que dans le miroir chaud.
        if (seance && blocCorrige()) { try { persister(); } catch (_) { /* cache seul */ } }

        // Dernier filet avant de rendre la main : le miroir chaud porte la serie en cours de
        // saisie, qui n'existe nulle part ailleurs.
        if (seance) { try { hot.ecrire(seance, brouillonActif(), { entryOuvert }); } catch (_) { /* cache seul */ } }
      }

      detacherMenuItems();
      for (const off of desabonnements) { try { off(); } catch (_) { /* deja detache */ } }
      desabonnements.length = 0;
      if (offPrimaire) offPrimaire();
      if (offMenu) offMenu();

      fermerFeuilleLocale();
      try { keypad.fermer(); } catch (_) { /* aucun pave ouvert */ }
      toast.masquer();

      for (const bloc of blocs.values()) bloc.detruire();
      blocs.clear();

      // Coquille : on la REMET dans son etat de repos, on ne supprime jamais ses noeuds.
      if (barre) { barre.hidden = true; barre.classList.remove('barre-action-pleine'); }
      // La zone minuteur est rendue telle qu'index.html la livre : cette vue l'a seulement
      // escamotee, elle n'en est pas proprietaire.
      if (zoneMinuteur) zoneMinuteur.hidden = false;
      if (btnPrimaire) {
        btnPrimaire.textContent = 'Valider la série';
        btnPrimaire.removeAttribute('data-role');
        btnPrimaire.disabled = false;
      }
      if (sousTitre) { sousTitre.textContent = ''; sousTitre.hidden = true; }
      if (btnMenu) btnMenu.hidden = true;
      coquille.removeAttribute('data-seance');

      if (racine.parentNode) racine.parentNode.removeChild(racine);
    }
  };
}

export default { mount };
