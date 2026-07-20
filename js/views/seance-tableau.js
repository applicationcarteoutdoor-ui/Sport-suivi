// views/seance-tableau.js — l'ecran de saisie en salle, EN TABLEAU, facon carnet papier.
//
// Demande explicite de l'utilisateur : « quand je lance ma seance, je veux que cela fasse comme
// un tableau avec des cases a remplir. La colonne de gauche est le sport, le reste des colonnes
// sont les series. Je rentre mes series en cliquant, avec un + et un − ou en ecrivant dedans.
// Quand je clique sur la colonne du sport, je peux mettre si c'est leste ou non.
// Tous les exercices s'affichent les uns a la suite des autres. »
//
//   | Exercice        | S1     | S2     | S3    | +  |
//   | [icone] Squat   | 8 ×60  | 8 ×60  | 6-8   |    |   <- cellule en attente : prefill fantome
//   | [icone] Pompes  | 12     | ...    |       |    |
//
// CONTRAT DE RENDU (zone B). Le DOM est construit UNE FOIS. Chaque rangee possede sa zone de
// cellules et ne reconstruit QUE cette zone quand une de ses series change : le defilement du
// tableau, les autres rangees et le bouton sous le doigt survivent par construction.
// Les ETATS des cellules passent par data-etat (faite | attente | ratee | future), pas par des
// classes : une classe d'etat oubliee dans css/ casserait l'assertion d'integrite de tests.html.
//
// ⚠ AUCUN <input> (invariant n°13 du CLAUDE.md) : « ecrire dedans » passe par le pave interne
//   (ui/keypad.js), ouvert d'un tap sur la valeur du stepper.
// ⚠ AUCUN etat fonctionnel dans requestAnimationFrame (invariant n°2).

import { h, on, delegate, vider } from '../lib/dom.js';
import { formatFr, formatDuree } from '../lib/num.js';
import * as store from '../data/store.js';
import * as hot from '../data/hot.js';
import { champsSaisieEntree, champsSaisie, pasChamp } from '../data/schema.js';
import * as session from '../domain/session.js';
import * as prefill from '../domain/prefill.js';
import * as router from '../ui/router.js';
import { icone } from '../ui/icons.js';
import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';
import * as stepper from '../ui/stepper.js';
import * as keypad from '../ui/keypad.js';
import * as picker from '../ui/picker-exercice.js';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// Libelles et unites des champs de saisie. Locaux a l'editeur : c'est de l'affichage, pas du
// schema — et MODES reste le seul endroit qui sait QUELS champs existent par mode.
const LIBELLES_CHAMPS = {
  reps: 'Répétitions', chargeKg: 'Charge', lestKg: 'Lest',
  valeur: 'Cran', dureeSec: 'Durée', distanceM: 'Distance'
};
const UNITES_CHAMPS = { reps: '', chargeKg: 'kg', lestKg: 'kg', valeur: '', dureeSec: 's', distanceM: 'm' };

function noeud(id) { return document.getElementById(id); }

function heureDe(ts) {
  const d = new Date(estNombre(ts) ? ts : Date.now());
  return String(d.getHours()) + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Pseudo-exercice construit depuis les coefficients GELES de l'entree (invariant n°7) : pasChamp
// et champsSaisie lisent mode/lestable/incrementKg, on leur donne ceux DU JOUR de la seance.
function exGele(entree) {
  return {
    mode: entree.modeUtilise,
    lestable: entree.lestableUtilise === true,
    incrementKg: estNombre(entree.incrementKgUtilise) ? entree.incrementKgUtilise : 2.5
  };
}

function totalCible(entree) {
  const c = (entree && entree.cibles) || {};
  if (!estNombre(c.series)) return 0;
  return c.series + (estNombre(c.seriesEchauffement) ? c.seriesEchauffement : 0);
}

// Valeur principale (grande) et suffixes (petits) d'une cellule, derives des champs du mode.
function texteCellule(entree, serie) {
  const champs = champsSaisieEntree(entree);
  let grand = '';
  const petits = [];
  for (const c of champs) {
    const v = serie ? serie[c] : null;
    if (!estNombre(v)) continue;
    if (!grand) { grand = c === 'dureeSec' ? formatDuree(v) : formatFr(v); continue; }
    if (c === 'chargeKg') petits.push('×' + formatFr(v));
    else if (c === 'lestKg') { if (v !== 0) petits.push((v > 0 ? '+' : '') + formatFr(v)); }
    else if (c === 'valeur') petits.push('n°' + formatFr(v));
    else if (c === 'distanceM') petits.push(formatFr(v) + ' m');
    else if (c === 'dureeSec') petits.push(formatDuree(v));
    else petits.push(formatFr(v));
  }
  return { grand, petit: petits.join(' ') };
}

// ─────────────────────────────────────────────────────────────────────────────
// mount
// ─────────────────────────────────────────────────────────────────────────────

export function mount(conteneur, params) {
  let seance = null;
  let detruit = false;
  let seanceClose = false;   // vraie apres abandon/terminaison : coupe les ecritures de destroy()
  const desabonnements = [];
  /** entryId -> { entree, rangee, zoneCellules } */
  const rangees = new Map();

  // ── Coquille : noeuds empruntes, jamais remplaces ──────────────────────────
  const barre = noeud('barre-action');
  const btnPrimaire = noeud('btn-primaire');
  const zoneMinuteur = noeud('zone-minuteur');
  const sousTitre = noeud('sous-titre-ecran');
  const btnMenu = noeud('btn-menu');
  const coquille = document.querySelector('.coquille') || document.body;

  // ── Squelette, construit UNE fois ──────────────────────────────────────────
  const bandeauPoids = h('button', {
    class: 'tab-poids', type: 'button', 'data-action': 'poids'
  }, 'Poids de corps…');

  const enteteRangee = h('div', { class: 'tab-entete' });
  const zoneRangees = h('div', { class: 'tab-corps' });
  const defile = h('div', { class: 'tableau-defile' }, enteteRangee, zoneRangees);

  const btnAjouter = h('button', {
    class: 'bouton bouton-large ajouter-exercice', type: 'button', 'data-action': 'ajouter-exercice'
  }, '+ Ajouter un exercice');

  const vide = h('div', { class: 'etat-vide' },
    h('p', { class: 'etat-vide-titre' }, 'Aucune séance en cours'),
    h('button', { class: 'bouton bouton-primaire', type: 'button', 'data-action': 'accueil' }, 'Revenir à l’accueil'));
  vide.hidden = true;

  const racine = h('section', { class: 'vue vue-seance tableau-seance' }, bandeauPoids, defile, btnAjouter, vide);
  conteneur.appendChild(racine);

  // ─────────────────────────────────────────────────────────────────────────
  // Rendu cible : rangees et cellules
  // ─────────────────────────────────────────────────────────────────────────

  function nomExercice(entree) {
    const ex = store.exercice(entree.exerciceId);
    return (ex && ex.nom) || entree.nomAffiche || 'Exercice';
  }

  function iconeDe(entree) {
    const ex = store.exercice(entree.exerciceId);
    return (ex && ex.icone) || 'exercice';
  }

  function sousTexteSport(entree) {
    const morceaux = [];
    // « Lesté » est l'information que l'utilisateur regle depuis cette colonne : on l'affiche.
    if (champsSaisieEntree(entree).indexOf('lestKg') !== -1) morceaux.push('lesté');
    const faites = entree.series.filter((s) => s.done === true).length;
    const cible = totalCible(entree);
    morceaux.push(cible ? faites + '/' + cible : String(faites));
    return morceaux.join(' · ');
  }

  function creerRangee(entree) {
    const zoneCellules = h('div', { class: 'tab-cellules' });
    const sport = h('button', {
      class: 'tab-sport', type: 'button', 'data-action': 'sport', 'data-entry': entree.id
    },
      h('span', { class: 'tab-sport-dessin' }, icone(iconeDe(entree))),
      h('span', { class: 'tab-sport-textes' },
        h('span', { class: 'tab-sport-nom' }, nomExercice(entree)),
        h('span', { class: 'tab-sport-sous' }, sousTexteSport(entree))));
    const rangee = h('div', { class: 'tab-rangee', 'data-entry': entree.id }, sport, zoneCellules);
    const r = { entree, rangee, zoneCellules, sport };
    rangees.set(entree.id, r);
    majRangee(r);
    return r;
  }

  /** Reconstruit LES CELLULES d'une rangee (et rien d'autre) depuis l'etat de son entree. */
  function majRangee(r) {
    const entree = r.entree;
    // Sous-texte du sport (compteur, mention lesté) : mutation ciblee.
    const sous = r.sport.querySelector('.tab-sport-sous');
    if (sous) sous.textContent = sousTexteSport(entree);

    vider(r.zoneCellules);
    const nb = Math.max(entree.series.length, totalCible(entree));

    for (let i = 0; i < nb; i++) {
      const serie = entree.series[i] || null;
      const btn = h('button', {
        class: 'tab-cellule', type: 'button', 'data-action': 'cellule',
        'data-entry': entree.id, 'data-serie': serie ? serie.id : '', 'data-rang': String(i)
      });

      if (serie && serie.done === true) {
        btn.setAttribute('data-etat', 'faite');
        if (serie.kind === 'echauffement') btn.setAttribute('data-kind', 'echauffement');
        const t = texteCellule(entree, serie);
        btn.appendChild(h('span', { class: 'tab-cellule-grand' }, t.grand || '✓'));
        if (t.petit) btn.appendChild(h('span', { class: 'tab-cellule-petit' }, t.petit));
      } else if (serie && i === entree.series.length - 1) {
        // Serie EN ATTENTE : la prochaine a faire. On y montre le prefill en fantome — c'est
        // exactement ce que fait le carnet papier : on voit le chiffre de la derniere fois.
        btn.setAttribute('data-etat', 'attente');
        if (serie.kind === 'echauffement') btn.setAttribute('data-kind', 'echauffement');
        const meta = store.meta();
        const p = prefill.valeursPour(entree.exerciceId, entree, seance, (meta && meta.lastPerf) || {});
        const t = texteCellule(entree, Object.assign({}, p.champs, serie));
        btn.appendChild(h('span', { class: 'tab-cellule-grand' }, t.grand || '·'));
        if (t.petit) btn.appendChild(h('span', { class: 'tab-cellule-petit' }, t.petit));
      } else if (serie) {
        // Prevue et explicitement NON FAITE (machine prise…) : conservee, exclue des agregats.
        btn.setAttribute('data-etat', 'ratee');
        btn.appendChild(h('span', { class: 'tab-cellule-grand' }, '✕'));
      } else {
        // Au-dela des series existantes, jusqu'a la cible : cases futures, fourchette en fantome.
        btn.setAttribute('data-etat', 'future');
        const reps = entree.cibles && entree.cibles.reps;
        const texte = reps && estNombre(reps.min)
          ? (estNombre(reps.max) && reps.max !== reps.min ? reps.min + '–' + reps.max : String(reps.min))
          : '·';
        btn.appendChild(h('span', { class: 'tab-cellule-grand' }, texte));
      }
      r.zoneCellules.appendChild(btn);
    }

    r.zoneCellules.appendChild(h('button', {
      class: 'tab-cellule tab-plus', type: 'button', 'data-action': 'plus',
      'data-entry': entree.id, 'aria-label': 'Ajouter une série'
    }, '+'));
  }

  /** L'entete « Exercice | S1 S2 … » suit la rangee la plus longue. */
  function majEntete() {
    vider(enteteRangee);
    let max = 0;
    for (const r of rangees.values()) {
      max = Math.max(max, Math.max(r.entree.series.length, totalCible(r.entree)));
    }
    enteteRangee.appendChild(h('span', { class: 'tab-coin' }, 'Exercice'));
    for (let i = 1; i <= max; i++) enteteRangee.appendChild(h('span', { class: 'tab-col' }, 'S' + i));
    enteteRangee.appendChild(h('span', { class: 'tab-col' }, '+'));
  }

  function majSituation() {
    if (!seance) return;
    let faites = 0;
    for (const e of seance.entrees) faites += e.series.filter((s) => s.done === true).length;
    if (sousTitre) sousTitre.textContent = heureDe(seance.startedAt) + ' · ' + faites + ' série' + (faites > 1 ? 's' : '');
    bandeauPoids.textContent = estNombre(seance.poidsDeCorpsKg)
      ? 'Poids de corps : ' + formatFr(seance.poidsDeCorpsKg) + ' kg'
      : 'Poids de corps non renseigné — toucher pour le saisir';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistance — hot en filet, commit en source de verite
  // ─────────────────────────────────────────────────────────────────────────

  function persister() {
    if (!seance || seanceClose) return;
    hot.ecrire(seance, null, {});
    store.commit('seance:mettre-a-jour', { seance }).catch((err) => {
      console.error('[seance-tableau] enregistrement en échec', err);
      toast.afficher('Enregistrement en échec — tes données restent dans le cache de reprise.', { duree: 8000 });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Editeur de cellule : steppers +/− et pave pour « ecrire dedans »
  // ─────────────────────────────────────────────────────────────────────────

  function ouvrirEditeur(entree, serie, rang) {
    const ex = exGele(entree);
    const champs = champsSaisieEntree(entree);
    const valeurs = {};
    if (serie) for (const c of champs) { if (estNombre(serie[c])) valeurs[c] = serie[c]; }
    const manquants = champs.filter((c) => !estNombre(valeurs[c]));
    if (manquants.length) {
      const meta = store.meta();
      const p = prefill.valeursPour(entree.exerciceId, entree, seance, (meta && meta.lastPerf) || {});
      for (const c of manquants) if (estNombre(p.champs[c])) valeurs[c] = p.champs[c];
    }

    let kind = serie && serie.kind === 'echauffement' ? 'echauffement' : 'effective';
    const poignees = [];

    const contenu = h('div', { class: 'editeur-serie' });
    for (const c of champs) {
      const hote = h('div', { class: 'editeur-stepper' });
      contenu.appendChild(h('div', { class: 'editeur-champ' },
        h('span', { class: 'editeur-libelle' },
          LIBELLES_CHAMPS[c] + (UNITES_CHAMPS[c] ? ' (' + UNITES_CHAMPS[c] + ')' : '')),
        hote));
      const p = stepper.monter(hote, {
        valeur: estNombre(valeurs[c]) ? valeurs[c] : 0,
        pas: pasChamp(ex, c),
        // Le lest est SIGNE : −20 = assistance elastique. Tout le reste part de zero.
        min: c === 'lestKg' ? undefined : 0,
        onChange: (v) => { valeurs[c] = v; },
        onTapValeur: () => {
          keypad.ouvrir({
            champs: [{
              cle: c, label: LIBELLES_CHAMPS[c], valeur: estNombre(valeurs[c]) ? valeurs[c] : 0,
              unite: UNITES_CHAMPS[c], pas: pasChamp(ex, c),
              entier: c === 'reps' || c === 'dureeSec' || c === 'distanceM',
              signe: c === 'lestKg'
            }],
            onValider: (res) => {
              if (res && estNombre(res[c])) { valeurs[c] = res[c]; p.setValeur(res[c]); }
            }
          });
        }
      });
      poignees.push(p);
    }

    const puceEchauf = h('button', {
      class: 'puce-echauf', type: 'button', 'aria-pressed': kind === 'echauffement' ? 'true' : 'false'
    }, 'Échauffement');
    desabonnements.push(on(puceEchauf, 'click', () => {
      kind = kind === 'echauffement' ? 'effective' : 'echauffement';
      puceEchauf.setAttribute('aria-pressed', kind === 'echauffement' ? 'true' : 'false');
    }));
    contenu.appendChild(h('div', { class: 'editeur-options' }, puceEchauf));

    const btnValider = h('button', { class: 'bouton bouton-primaire bouton-large', type: 'button' }, 'Valider la série');
    const btnNonFaite = h('button', { class: 'bouton bouton-fantome', type: 'button' }, 'Non faite');
    const btnSupprimer = serie
      ? h('button', { class: 'bouton bouton-fantome bouton-danger-doux', type: 'button' }, 'Supprimer')
      : null;
    const actions = h('div', { class: 'editeur-actions' }, btnValider, btnNonFaite, btnSupprimer);
    contenu.appendChild(actions);

    const poignee = sheet.ouvrir({
      titre: nomExercice(entree) + ' — Série ' + (rang + 1),
      contenu,
      onFermer: () => { for (const p of poignees) p.detruire(); }
    });

    const fini = (r) => {
      persister();
      majRangee(r);
      majEntete();
      majSituation();
      poignee.fermer();
    };
    const r = rangees.get(entree.id);

    desabonnements.push(on(btnValider, 'click', () => {
      if (detruit || !seance) return;
      const opts = Object.assign({}, valeurs, { kind });
      if (serie && serie.done === true) {
        session.modifierSerie(seance, entree.id, serie.id, opts);
        fini(r);
        toast.afficher('Série corrigée');
      } else {
        // validerSerie cible la serie designee, ou en cree une si la rangee est deja pleine.
        if (serie) opts.serieId = serie.id;
        session.validerSerie(seance, entree.id, opts);
        fini(r);
        toast.afficher('Série enregistrée');
      }
    }));
    desabonnements.push(on(btnNonFaite, 'click', () => {
      if (detruit || !seance) return;
      session.marquerNonFaite(seance, entree.id, serie ? serie.id : undefined);
      fini(r);
    }));
    if (btnSupprimer) desabonnements.push(on(btnSupprimer, 'click', () => {
      if (detruit || !seance) return;
      session.supprimerSerie(seance, entree.id, serie.id);
      fini(r);
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fiche exercice : la colonne « sport » — leste ou non, + serie, passer, retirer
  // ─────────────────────────────────────────────────────────────────────────

  function ouvrirFicheExercice(entree) {
    const r = rangees.get(entree.id);
    const contenu = h('div', { class: 'menu-seance' });

    // Le toggle « Lesté » n'a de sens que si le MODE l'admet (poids du corps, temps) : on le
    // derive du schema, jamais d'un test sur le mode ici.
    const modeAdmetLest = champsSaisie({ mode: entree.modeUtilise, lestable: true }).indexOf('lestKg') !== -1;
    if (modeAdmetLest) {
      const toggle = h('button', {
        class: 'menu-seance-item', type: 'button',
        'aria-pressed': entree.lestableUtilise === true ? 'true' : 'false'
      },
        h('span', { class: 'menu-seance-icone' }, icone('halteres')),
        h('span', { class: 'menu-seance-textes' },
          h('span', null, 'Lesté'),
          h('span', { class: 'texte-attenue' }, entree.lestableUtilise === true
            ? 'Le champ « lest » est proposé à chaque série'
            : 'Poids du corps seul')));
      desabonnements.push(on(toggle, 'click', () => {
        // Coefficient GELE de CETTE seance : le basculer ici est legitime, c'est le fait du jour
        // qu'on decrit. L'exercice du catalogue, lui, n'est pas touche.
        entree.lestableUtilise = entree.lestableUtilise !== true;
        toggle.setAttribute('aria-pressed', entree.lestableUtilise ? 'true' : 'false');
        persister(); majRangee(r); majSituation();
      }));
      contenu.appendChild(toggle);
      contenu.appendChild(h('div', { class: 'menu-seance-separateur' }));
    }

    const item = (ic, texte, action) => {
      const b = h('button', { class: 'menu-seance-item', type: 'button' },
        h('span', { class: 'menu-seance-icone' }, icone(ic)),
        h('span', { class: 'menu-seance-textes' }, h('span', null, texte)));
      desabonnements.push(on(b, 'click', action));
      return b;
    };

    let confirmationRetrait = false;
    const btnRetirer = item('poubelle', 'Retirer de la séance', () => {
      if (!confirmationRetrait) {
        confirmationRetrait = true;
        btnRetirer.querySelector('.menu-seance-textes span').textContent =
          'Confirmer le retrait ? Les séries faites seront perdues.';
        return;
      }
      session.retirerExercice(seance, entree.id);
      rangees.delete(entree.id);
      r.rangee.remove();
      persister(); majEntete(); majSituation();
      poignee.fermer();
    });

    contenu.appendChild(item('plus', 'Ajouter une série', () => {
      session.ajouterSerie(seance, entree.id);
      persister(); majRangee(r); majEntete();
      poignee.fermer();
      const nouvelle = entree.series[entree.series.length - 1];
      ouvrirEditeur(entree, nouvelle, entree.series.length - 1);
    }));
    contenu.appendChild(item('chevron-droit', 'Passer — remettre à la fin', () => {
      session.passerExercice(seance, entree.id);
      zoneRangees.appendChild(r.rangee);   // mutation ciblee : la rangee se deplace, rien d'autre
      persister();
      poignee.fermer();
    }));
    contenu.appendChild(h('div', { class: 'menu-seance-separateur' }));
    contenu.appendChild(btnRetirer);

    const poignee = sheet.ouvrir({ titre: nomExercice(entree), contenu });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Poids de corps, menu, terminer, abandonner
  // ─────────────────────────────────────────────────────────────────────────

  function ouvrirPoids() {
    let valeur = estNombre(seance.poidsDeCorpsKg) ? seance.poidsDeCorpsKg : 75;
    const hote = h('div', { class: 'editeur-stepper' });
    const contenu = h('div', { class: 'editeur-serie' },
      h('p', { class: 'texte-attenue' },
        'La charge effective des tractions, dips et gainages en dépend pendant toute la séance.'),
      hote);
    const p = stepper.monter(hote, { valeur, pas: 0.5, min: 20, onChange: (v) => { valeur = v; } });
    const btnOk = h('button', { class: 'bouton bouton-primaire bouton-large', type: 'button' }, 'Enregistrer');
    contenu.appendChild(h('div', { class: 'editeur-actions' }, btnOk));
    const poignee = sheet.ouvrir({ titre: 'Poids de corps', contenu, onFermer: () => p.detruire() });
    desabonnements.push(on(btnOk, 'click', () => {
      seance.poidsDeCorpsKg = valeur;
      persister(); majSituation();
      poignee.fermer();
    }));
  }

  function ouvrirMenu() {
    const contenu = h('div', { class: 'menu-seance' });
    const item = (ic, texte, sous, action) => {
      const b = h('button', { class: 'menu-seance-item', type: 'button' },
        h('span', { class: 'menu-seance-icone' }, icone(ic)),
        h('span', { class: 'menu-seance-textes' }, h('span', null, texte),
          sous ? h('span', { class: 'texte-attenue' }, sous) : null));
      desabonnements.push(on(b, 'click', action));
      return b;
    };
    contenu.appendChild(item('coche', 'Terminer la séance', 'Elle compte dans tes courbes', () => {
      poignee.fermer(); terminerSeance();
    }));
    contenu.appendChild(h('div', { class: 'menu-seance-separateur' }));
    contenu.appendChild(item('croix', 'Abandonner la séance',
      'Conservée dans l’historique, exclue des courbes et statistiques', () => {
        poignee.fermer(); abandonner();
      }));
    const poignee = sheet.ouvrir({ titre: 'Séance', contenu });
  }

  function terminerSeance() {
    persister();
    router.aller('#/seance/fin');
  }

  function abandonner() {
    const contenu = h('div', { class: 'confirmation' },
      h('p', { class: 'confirmation-texte' }, 'Abandonner cette séance ?'),
      h('p', { class: 'confirmation-consequence' },
        'Elle restera visible dans l’historique, mais n’entrera dans aucune courbe ni statistique.'));
    const btnOui = h('button', { class: 'bouton bouton-danger bouton-large', type: 'button' }, 'Abandonner');
    contenu.appendChild(h('div', { class: 'editeur-actions' }, btnOui));
    const poignee = sheet.ouvrir({ titre: 'Abandonner', contenu });
    desabonnements.push(on(btnOui, 'click', async () => {
      poignee.fermer();
      try {
        await store.commit('seance:abandonner', { id: seance.id });
        seanceClose = true;
        hot.purger();
        router.aller('#/');
      } catch (err) {
        console.error('[seance-tableau] abandon en échec', err);
        toast.afficher('Abandon impossible : ' + err.message, { duree: 8000 });
      }
    }));
  }

  function ouvrirAjoutExercice() {
    picker.ouvrir({
      onChoisir: (exercice) => {
        if (!exercice || !seance || detruit) return;
        session.ajouterExercice(seance, exercice.id, exercice, { lieuId: seance.lieuId });
        const entree = seance.entrees[seance.entrees.length - 1];
        const r = creerRangee(entree);
        zoneRangees.appendChild(r.rangee);
        persister(); majEntete(); majSituation();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Construction et cycle de vie
  // ─────────────────────────────────────────────────────────────────────────

  async function demarrerSiDemande(p) {
    let active = store.seanceActive();
    const veutDemarrer = p && (p.modele || p.libre || p.cardio);
    if (veutDemarrer && !p.reprendre) {
      try {
        const ctx = { exercices: store.exercice };
        const brouillon = p.cardio
          ? session.demarrerCardio(p.cardio, ctx)
          : session.demarrer(p.modele ? store.modele(p.modele) : null, ctx);
        const resultat = await store.commit('seance:demarrer', { seance: brouillon });
        active = (resultat && resultat.seance) || brouillon;
      } catch (err) {
        console.error('[seance-tableau] démarrage impossible', err);
        toast.afficher('Démarrage impossible : ' + err.message, { duree: 8000 });
      }
    }
    return active;
  }

  function construire() {
    if (barre) barre.hidden = false;
    if (btnMenu) btnMenu.hidden = false;
    if (sousTitre) sousTitre.hidden = false;
    // v2 : plus de zone minuteur dans la barre — le bouton primaire prend toute la largeur.
    if (zoneMinuteur) zoneMinuteur.hidden = true;
    if (btnPrimaire) {
      btnPrimaire.textContent = 'Terminer la séance';
      btnPrimaire.classList.add('barre-action-pleine');
      btnPrimaire.disabled = false;
    }
    coquille.setAttribute('data-seance', 'active');

    for (const entree of seance.entrees) {
      zoneRangees.appendChild(creerRangee(entree).rangee);
    }
    majEntete();
    majSituation();

    if (!estNombre(seance.poidsDeCorpsKg)) ouvrirPoids();
  }

  // Un SEUL ecouteur delegue pour toute la vue (invariant : delegation par data-action).
  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    if (detruit) return;
    const action = cible.getAttribute('data-action');
    if (action === 'accueil') { router.aller('#/'); return; }
    if (!seance) return;
    if (action === 'poids') { ouvrirPoids(); return; }
    if (action === 'ajouter-exercice') { ouvrirAjoutExercice(); return; }

    const entryId = cible.getAttribute('data-entry');
    const entree = seance.entrees.find((e) => e.id === entryId);
    if (!entree) return;

    if (action === 'sport') { ouvrirFicheExercice(entree); return; }
    if (action === 'plus') {
      session.ajouterSerie(seance, entree.id);
      const r = rangees.get(entree.id);
      persister(); majRangee(r); majEntete();
      const nouvelle = entree.series[entree.series.length - 1];
      ouvrirEditeur(entree, nouvelle, entree.series.length - 1);
      return;
    }
    if (action === 'cellule') {
      const serieId = cible.getAttribute('data-serie');
      const rang = Number(cible.getAttribute('data-rang')) || 0;
      let serie = serieId ? entree.series.find((s) => s.id === serieId) : null;
      // Case FUTURE (au-dela des series existantes) : on remplit dans l'ordre — la cible reelle
      // est la serie en attente si elle existe, sinon une nouvelle. Jamais « la premiere non
      // faite » implicite : une serie marquee non faite plus haut serait ecrasee.
      if (!serie) {
        const derniere = entree.series[entree.series.length - 1];
        serie = derniere && derniere.done !== true ? derniere : null;
      }
      ouvrirEditeur(entree, serie, serie ? entree.series.indexOf(serie) : entree.series.length);
    }
  }));

  if (btnPrimaire) desabonnements.push(on(btnPrimaire, 'click', () => {
    if (!detruit && seance) terminerSeance();
  }));
  if (btnMenu) desabonnements.push(on(btnMenu, 'click', () => {
    if (!detruit && seance) ouvrirMenu();
  }));

  // ── Amorce ─────────────────────────────────────────────────────────────────
  (async () => {
    seance = await demarrerSiDemande(params);
    if (detruit) return;
    if (!seance) {
      vide.hidden = false;
      bandeauPoids.hidden = true;
      defile.hidden = true;
      btnAjouter.hidden = true;
      if (sousTitre) sousTitre.hidden = true;
      return;
    }
    construire();
  })();

  return {
    onParams() { /* les feuilles sont gerees en interne ; rien a remonter ici */ },
    destroy() {
      detruit = true;
      if (!seanceClose && seance) {
        // Dernier filet : la seance en cours survit a la navigation et au kill.
        hot.ecrire(seance, null, {});
      }
      for (const off of desabonnements) { try { off(); } catch (_) { /* deja detache */ } }
      racine.remove();
      coquille.removeAttribute('data-seance');
      if (barre) barre.hidden = true;
      if (zoneMinuteur) zoneMinuteur.hidden = false;
      if (btnPrimaire) btnPrimaire.classList.remove('barre-action-pleine');
      if (btnMenu) btnMenu.hidden = true;
      if (sousTitre) { sousTitre.hidden = true; sousTitre.textContent = ''; }
    }
  };
}
