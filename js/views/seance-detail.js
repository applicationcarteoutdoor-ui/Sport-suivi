// js/views/seance-detail.js — route #/historique/:id.
//
// Detail d'une seance passee, EN TABLEAU — le MEME dessin que l'ecran de seance
// (views/seance-tableau.js), demande utilisateur v3 : « Dans l'historique, reprends
// l'affichage de tableau. » Colonne de gauche = exercice (icone, nom, compteur),
// colonnes suivantes = les series realisees. Les classes (tab-entete, tab-coin, tab-col,
// tab-rangee, tab-sport, tab-cellules, tab-cellule…) sont IDENTIQUES a celles de l'ecran de
// seance : la feuille de style garantit UNE seule geometrie pour les deux ecrans. Les petites
// fonctions de rendu (texteCellule, totalCible, exGele) sont RECOPIEES de seance-tableau.js
// plutot qu'importees : les deux vues partagent un vocabulaire CSS, pas un cycle de vie.
//
// Difference assumee avec l'ecran de salle : PAS de cellule « attente » ni « future » ici.
// La seance est close, on n'affiche que l'existant — faites, non faites, echauffements.
//
// Trois regles portent ce fichier :
//
//   1. LE SNAPSHOT FAIT FOI. Le nom du modele, les cibles et les coefficients affiches sont ceux
//      COPIES dans la seance le jour meme (modeleSnapshot, entree.cibles, *Utilise), jamais le
//      modele ni l'exercice tels qu'ils sont configures aujourd'hui. C'est tout l'interet de la
//      copie : relire une seance de 2023 doit montrer ce qui a ete fait, pas ce qui serait prevu
//      maintenant.
//
//   2. TOUTE MODIFICATION PASSE PAR store.commit('seance:modifier'). La vue n'ecrit jamais dans
//      IndexedDB, et le commit reecrit updatedAt — sans quoi l'import « fusionner » ne pourrait
//      plus departager deux versions de la meme seance. Un tap sur une cellule ouvre l'editeur
//      (steppers + pave, comme en salle) ; « Valider » = UN commit, pas d'ecriture differee.
//
//   3. AUCUN RE-RENDU global. Corriger une serie ne reconstruit que les cellules de SA rangee,
//      l'en-tete de colonnes et les deux chiffres du resume. Le defilement et les autres rangees
//      ne bougent pas.
//
// ⚠ store.commit remplace l'objet seance en memoire par une COPIE : aucune reference n'est
//   conservee entre deux operations, tout est re-resolu par id au moment de s'en servir.

import { h, on, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatLong } from '../lib/dates.js';
import { formatFr, formatDuree } from '../lib/num.js';
import {
  estComptable, estSeanceEnCours, estSeanceAbandonnee, estSeanceClose,
  LIBELLES_STATUTS_SEANCE, champsSaisieEntree, pasChamp, routineDepuisSeance
} from '../data/schema.js';
import * as store from '../data/store.js';
import * as session from '../domain/session.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import * as sheet from '../ui/sheet.js';
import * as stepper from '../ui/stepper.js';
import * as keypad from '../ui/keypad.js';
import * as toast from '../ui/toast.js';
import * as router from '../ui/router.js';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// Libelles et unites des champs de saisie — copie de seance-tableau.js. Locaux a l'editeur :
// c'est de l'affichage, pas du schema, et MODES reste le seul endroit qui sait QUELS champs
// existent par mode.
const LIBELLES_CHAMPS = {
  reps: 'Répétitions', chargeKg: 'Charge', lestKg: 'Lest',
  valeur: 'Cran', dureeSec: 'Durée', distanceM: 'Distance'
};
const UNITES_CHAMPS = { reps: '', chargeKg: 'kg', lestKg: 'kg', valeur: '', dureeSec: 's', distanceM: 'm' };

function formatDureeCourte(sec) {
  if (!estNombre(sec) || sec <= 0) return '—';
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return minutes + ' min';
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? heures + ' h' : heures + ' h ' + String(reste).padStart(2, '0');
}

function nombreSeries(seance) {
  let n = 0;
  for (const entree of seance.entrees || []) {
    for (const serie of entree.series || []) if (estComptable(serie)) n++;
  }
  return n;
}

// Pseudo-exercice construit depuis les coefficients GELES de l'entree (invariant n°7) : pasChamp
// lit mode/lestable/incrementKg, on lui donne ceux DU JOUR de la seance. Copie de seance-tableau.
function exGele(entree) {
  return {
    mode: entree.modeUtilise,
    lestable: entree.lestableUtilise === true,
    incrementKg: estNombre(entree.incrementKgUtilise) ? entree.incrementKgUtilise : 2.5
  };
}

// Copie de seance-tableau.js — nombre total de series prevues, echauffement compris.
function totalCible(entree) {
  const c = (entree && entree.cibles) || {};
  if (!estNombre(c.series)) return 0;
  return c.series + (estNombre(c.seriesEchauffement) ? c.seriesEchauffement : 0);
}

// Valeur principale (grande) et suffixes (petits) d'une cellule, derives des champs du mode.
// Copie EXACTE de seance-tableau.js : les deux ecrans doivent afficher la meme chose.
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

/** Cibles GELEES sur l'entree — la copie du modele au lancement, jamais le modele d'aujourd'hui. */
function texteCibles(entree) {
  const c = (entree && entree.cibles) || {};
  const morceaux = [];
  if (estNombre(c.series)) {
    morceaux.push(c.series + ' série' + (c.series > 1 ? 's' : '') +
      (estNombre(c.seriesEchauffement) && c.seriesEchauffement > 0
        ? ' + ' + c.seriesEchauffement + ' échauf.' : ''));
  }
  if (c.reps && (estNombre(c.reps.min) || estNombre(c.reps.max))) {
    const min = c.reps.min;
    const max = c.reps.max;
    // La cible est une FOURCHETTE : l'ecraser en un entier ferait mentir l'objectif du jour.
    if (estNombre(min) && estNombre(max) && min !== max) morceaux.push(min + ' à ' + max + ' répétitions');
    else morceaux.push((estNombre(min) ? min : max) + ' répétitions');
  }
  if (estNombre(c.dureeSec) && c.dureeSec > 0) morceaux.push(formatDuree(c.dureeSec));
  if (estNombre(c.distanceM) && c.distanceM > 0) morceaux.push(formatFr(c.distanceM / 1000) + ' km');
  if (estNombre(c.reposSec) && c.reposSec > 0) morceaux.push('repos ' + formatDuree(c.reposSec));
  return morceaux.length ? 'Objectif : ' + morceaux.join(' · ') : '';
}

function nomEntree(entree) {
  // L'exercice courant donne le nom LISIBLE (il a pu etre renomme) ; nomAffiche est le secours
  // a l'import corrompu, quand l'exercice n'existe plus du tout.
  const ex = entree && entree.exerciceId ? store.exercice(entree.exerciceId) : null;
  return (ex && ex.nom) || (entree && entree.nomAffiche) || 'Exercice inconnu';
}

/**
 * Pastille de statut, affichee UNIQUEMENT quand le statut n'est pas 'terminee'.
 *
 * ⚠ Une seance terminee est le cas normal : le dire serait du bruit sur tous les ecrans. Un
 *   abandon ou une seance encore ouverte, en revanche, expliquent a eux seuls pourquoi ses
 *   chiffres n'apparaissent dans aucune courbe — sans la pastille, l'ecart passerait pour un bug.
 *   Le libelle vient de LIBELLES_STATUTS_SEANCE, jamais d'une chaine ecrite ici.
 */
function pastilleStatut(seance) {
  if (!seance || seance.statut === 'terminee') return null;
  const libelle = LIBELLES_STATUTS_SEANCE[seance.statut] || seance.statut;
  // ⚠ Une seule classe, litterale : le ton passe par data-ton. tests.html ne collecte que les
  //   litteraux `class: '…'`, une classe conditionnelle echapperait a sa verification.
  return h('span', {
    class: 'pastille pastille-statut',
    'data-ton': estSeanceAbandonnee(seance) ? 'danger' : 'accent'
  }, libelle);
}

/** Une phrase, une seule, qui dit la consequence du statut. Absente quand la seance est terminee. */
function texteStatut(seance) {
  if (estSeanceAbandonnee(seance)) {
    return 'Séance abandonnée : elle est conservée telle quelle, mais elle n\'entre dans aucune ' +
      'courbe, aucun record ni statistique.';
  }
  if (estSeanceEnCours(seance)) {
    return 'Séance encore en cours : ses chiffres évolueront jusqu\'à la clôture et n\'entrent ' +
      'pas encore dans les statistiques.';
  }
  return '';
}

function chiffreCle(valeur, libelle) {
  const val = h('span', { class: 'chiffre-cle' }, valeur);
  const bloc = h('div', {}, val, h('span', { class: 'chiffre-cle-libelle' }, libelle));
  return { bloc, val };
}

/**
 * Monte la vue.
 * @param {Element} conteneur
 * @param {Object} params params de route : { id, sheet?, serie?, entree? }
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur, params = {}) {
  // Le contenu est reconstruit quand l'ID CHANGE — et uniquement dans ce cas. Le routeur ne
  // remonte pas la vue entre deux seances (meme cle de route '#/historique/:id') : c'est donc a
  // elle de gerer ce changement, sans jamais toucher a ce qui l'entoure.
  const contenu = h('div', {
    class: 'detail-contenu',
    // .vue pose l'espacement entre ses enfants directs ; le contenu etant un seul enfant, il
    // reprend la meme respiration a son compte.
    style: { display: 'flex', flexDirection: 'column', gap: 'var(--esp-4)' }
  });
  const racine = h('section', { class: 'vue vue-seance-detail' }, contenu);
  conteneur.appendChild(racine);

  let idCourant = null;
  let attenteHistorique = false;

  // Noeuds du tableau, reconstruits avec le contenu. rangees : entryId -> { rangee, zoneCellules,
  // sport }. Les ENTREES n'y sont PAS conservees (le commit remplace la seance par une copie) :
  // chaque peinture les re-resout depuis store.seance(idCourant).
  const rangees = new Map();
  let enteteRangee = null;
  let chiffres = null;          // { duree, series } — noeuds mutes, jamais remplaces

  // Ecouteurs poses sur les boutons des feuilles (editeur) : detaches au demontage. Les feuilles
  // vivent HORS du sous-arbre de la vue, leurs noeuds ne partent pas avec racine.remove().
  const desabonnements = [];

  // Serialisation des ecritures : deux corrections rapprochees ne doivent jamais se doubler.
  let chaine = Promise.resolve();

  // Feuille d'edition ou d'information ouverte par cette vue (hors confirmations routees).
  let editeurHandle = null;

  // Feuille (confirmation) — c'est un PARAMETRE de la route courante, pas une navigation : le
  // bouton retour d'Android la ferme au lieu de quitter le detail.
  let feuilleNom = null;
  let feuilleHandle = null;

  // ── Ecriture ────────────────────────────────────────────────────────────────

  /**
   * Applique une correction a UNE serie et repeint ce qui en depend : les cellules de sa rangee,
   * l'en-tete de colonnes et le resume. Un appel = un commit ('seance:modifier').
   */
  function corrigerSerie(entreeId, serieId, champs) {
    chaine = chaine.then(async () => {
      const s = store.seance(idCourant);
      if (!s) return;
      // domain/session.js mute la seance en place et reecrit updatedAt ; store.commit en fait une
      // copie datee avant de l'ecrire.
      session.modifierSerie(s, entreeId, serieId, champs);
      const resultat = await store.commit('seance:modifier', { seance: s });
      const fraiche = resultat && resultat.seance;
      if (!fraiche) return;
      peindreResume(fraiche);
      majRangee(entreeId, fraiche);
      majEntete(fraiche);
    }).catch((err) => {
      console.error('[seance-detail] enregistrement de la correction en échec', err);
      toast.afficher('La correction n\'a pas pu être enregistrée.');
    });
    return chaine;
  }

  // ── Peinture ciblee ─────────────────────────────────────────────────────────

  function peindreResume(seance) {
    if (!chiffres || !seance) return;
    chiffres.duree.textContent = formatDureeCourte(seance.dureeSec);
    chiffres.series.textContent = String(nombreSeries(seance));
  }

  // Copie de seance-tableau.js, sans la mention d'attente : compteur fait/cible et mention
  // « lesté » derivee des coefficients GELES.
  function sousTexteSport(entree) {
    const morceaux = [];
    if (champsSaisieEntree(entree).indexOf('lestKg') !== -1) morceaux.push('lesté');
    const faites = (entree.series || []).filter((s) => s.done === true).length;
    const cible = totalCible(entree);
    morceaux.push(cible ? faites + '/' + cible : String(faites));
    return morceaux.join(' · ');
  }

  /**
   * Une cellule de serie EXISTANTE. Deux etats seulement — la seance est close :
   *   faite (chiffres du jour, data-kind pour l'echauffement) | ratee (✕, hors agregats).
   * Structure DOM et classes STRICTEMENT identiques a l'ecran de seance.
   */
  function cellule(entree, serie, rang) {
    const btn = h('button', {
      class: 'tab-cellule', type: 'button', 'data-action': 'cellule',
      'data-entry': entree.id, 'data-serie': serie.id, 'data-rang': String(rang)
    });
    if (serie.done === true) {
      btn.setAttribute('data-etat', 'faite');
      if (serie.kind === 'echauffement') btn.setAttribute('data-kind', 'echauffement');
      const t = texteCellule(entree, serie);
      btn.appendChild(h('span', { class: 'tab-cellule-grand' }, t.grand || '✓'));
      if (t.petit) btn.appendChild(h('span', { class: 'tab-cellule-petit' }, t.petit));
    } else {
      // Prevue et non faite ce jour-la : conservee (elle porte l'information « c'etait prevu et
      // ca n'a pas ete fait »), exclue de tout agregat. Meme dessin qu'en salle.
      btn.setAttribute('data-etat', 'ratee');
      btn.appendChild(h('span', { class: 'tab-cellule-grand' }, '✕'));
    }
    return btn;
  }

  /** Reconstruit LES CELLULES d'une rangee (et rien d'autre) depuis la seance fournie. */
  function majRangee(entreeId, seance) {
    const r = rangees.get(entreeId);
    const entree = (seance.entrees || []).find((e) => e.id === entreeId);
    if (!r || !entree) return;
    const sous = r.sport.querySelector('.tab-sport-sous');
    if (sous) sous.textContent = sousTexteSport(entree);
    vider(r.zoneCellules);
    (entree.series || []).forEach((serie, i) => {
      r.zoneCellules.appendChild(cellule(entree, serie, i));
    });
  }

  /** L'entete « Exercice | S1 S2 … » suit la rangee la plus longue. Pas de colonne « + » ici. */
  function majEntete(seance) {
    if (!enteteRangee) return;
    vider(enteteRangee);
    let max = 0;
    for (const e of seance.entrees || []) max = Math.max(max, (e.series || []).length);
    enteteRangee.appendChild(h('span', { class: 'tab-coin' }, 'Exercice'));
    for (let i = 1; i <= max; i++) enteteRangee.appendChild(h('span', { class: 'tab-col' }, 'S' + i));
  }

  function creerRangee(entree) {
    const ex = entree.exerciceId ? store.exercice(entree.exerciceId) : null;
    const zoneCellules = h('div', { class: 'tab-cellules' });
    const sport = h('button', {
      class: 'tab-sport', type: 'button', 'data-action': 'sport', 'data-entry': entree.id
    },
      // ⚠ iconePourExercice et non ex.icone : un exercice cree par l'utilisateur n'a pas de champ
      //   `icone`, la resolution passe par l'id puis le pack — comme partout ailleurs.
      h('span', { class: 'tab-sport-dessin' }, icone(iconePourExercice(ex || entree.exerciceId))),
      h('span', { class: 'tab-sport-textes' },
        h('span', { class: 'tab-sport-nom' }, nomEntree(entree)),
        h('span', { class: 'tab-sport-sous' }, sousTexteSport(entree))));
    const rangee = h('div', { class: 'tab-rangee', 'data-entry': entree.id }, sport, zoneCellules);
    rangees.set(entree.id, { rangee, zoneCellules, sport });
    return rangee;
  }

  // ── Editeur de cellule : steppers +/− et pave, comme en salle ───────────────

  function fermerEditeur() {
    const poignee = editeurHandle;
    editeurHandle = null;
    if (poignee) poignee.fermer();
  }

  /**
   * Tap sur une cellule : correction d'une serie EXISTANTE. « Valider » enregistre les valeurs
   * (et re-valide une serie marquee non faite par erreur) ; « Non faite » la sort des agregats
   * sans la perdre ; « Supprimer » passe par la feuille de confirmation routee — JAMAIS de
   * suppression sans confirmation sur une seance passee.
   */
  function ouvrirEditeur(entreeId, serieId) {
    const seance = store.seance(idCourant);
    const entree = seance && (seance.entrees || []).find((e) => e.id === entreeId);
    const serie = entree && (entree.series || []).find((s) => s.id === serieId);
    if (!entree || !serie) return;

    const ex = exGele(entree);
    const champs = champsSaisieEntree(entree);
    const rang = entree.series.indexOf(serie);
    const etaitFaite = serie.done === true;
    const valeurs = {};
    for (const c of champs) { if (estNombre(serie[c])) valeurs[c] = serie[c]; }

    let kind = serie.kind === 'echauffement' ? 'echauffement' : 'effective';
    const poignees = [];

    const contenuEditeur = h('div', { class: 'editeur-serie' });
    for (const c of champs) {
      const hote = h('div', { class: 'editeur-stepper' });
      contenuEditeur.appendChild(h('div', { class: 'editeur-champ' },
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
    contenuEditeur.appendChild(h('div', { class: 'editeur-options' }, puceEchauf));

    const btnValider = h('button', { class: 'bouton bouton-primaire bouton-large', type: 'button' }, 'Valider la série');
    const btnNonFaite = h('button', { class: 'bouton bouton-fantome', type: 'button' }, 'Non faite');
    const btnSupprimer = h('button', { class: 'bouton bouton-fantome bouton-danger-doux', type: 'button' }, 'Supprimer');
    contenuEditeur.appendChild(h('div', { class: 'editeur-actions' }, btnValider, btnNonFaite, btnSupprimer));

    fermerEditeur();
    const poignee = sheet.ouvrir({
      titre: nomEntree(entree) + ' — Série ' + (rang + 1),
      contenu: contenuEditeur,
      onFermer: () => {
        for (const p of poignees) p.detruire();
        if (editeurHandle === poignee) editeurHandle = null;
      }
    });
    editeurHandle = poignee;

    desabonnements.push(on(btnValider, 'click', () => {
      const opts = Object.assign({}, valeurs, { kind });
      // Une serie « non faite » que l'on valide ici redevient faite : c'est la correction
      // inverse de « Non faite ». modifierSerie pose l'horodatage exige par le schema.
      if (!etaitFaite) opts.done = true;
      corrigerSerie(entreeId, serieId, opts);
      poignee.fermer();
    }));
    desabonnements.push(on(btnNonFaite, 'click', () => {
      // La serie est CONSERVEE (elle porte l'information « c'etait prevu et ca n'a pas ete
      // fait »), simplement exclue de tout agregat.
      corrigerSerie(entreeId, serieId, { done: false });
      poignee.fermer();
    }));
    desabonnements.push(on(btnSupprimer, 'click', () => {
      poignee.fermer();
      router.ouvrirFeuille('suppr-serie', { entree: entreeId, serie: serieId });
    }));
  }

  // ── Date de la seance : modifiable, passee OU future ────────────────────────

  /**
   * Deplace la seance a une autre date. `date` est deja au format dayKey 'YYYY-MM-DD' LOCAL —
   * c'est la valeur brute d'un <input type=date>, on ne passe JAMAIS par new Date/toISOString
   * (invariant n°10 : une seance a 23 h basculerait au lendemain). L'historique se regroupe
   * tout seul via le bus, et le contenu de CETTE vue est reconstruit : la date est dans
   * l'en-tete et la mention du snapshot.
   */
  function modifierDate(date) {
    chaine = chaine.then(async () => {
      const s = store.seance(idCourant);
      if (!s || s.date === date) return;
      s.date = date;
      await store.commit('seance:modifier', { seance: s });
      construire(idCourant);
      /* v6 : pas de popup de succes — la date change a l'ecran, c'est le feedback */
    }).catch((err) => {
      console.error('[seance-detail] changement de date en échec', err);
      toast.afficher('La date n\'a pas pu être modifiée.');
    });
    return chaine;
  }

  /**
   * Feuille « Modifier la date » : un champ natif <input type=date> — autorise ICI, l'interdit
   * du projet ne vise que l'ecran de saisie de seance. Police >= 16px (css) pour eviter le zoom
   * iOS. N'importe quelle date est acceptee, passee ou future.
   */
  function ouvrirEditeurDate() {
    const seance = store.seance(idCourant);
    if (!seance) return;

    const champ = h('input', {
      type: 'date',
      class: 'champ-date-seance',
      value: seance.date,
      'aria-label': 'Date de la séance'
    });
    const btnEnregistrer = h('button', {
      class: 'bouton bouton-primaire bouton-large', type: 'button'
    }, 'Enregistrer la date');

    fermerEditeur();
    const poignee = sheet.ouvrir({
      titre: 'Modifier la date',
      contenu: h('div', { class: 'editeur-date' },
        h('p', { class: 'texte-attenue' },
          'Passée ou future : la séance se rangera à cette date dans l\'historique.'),
        champ,
        h('div', { class: 'editeur-actions' }, btnEnregistrer)),
      onFermer: () => { if (editeurHandle === poignee) editeurHandle = null; }
    });
    editeurHandle = poignee;

    desabonnements.push(on(btnEnregistrer, 'click', () => {
      const valeur = champ.value; // deja 'YYYY-MM-DD' local : on la prend TELLE QUELLE
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
        toast.afficher('Choisis une date valide.');
        return;
      }
      poignee.fermer();
      modifierDate(valeur);
    }));
  }

  // ── Nom de la seance : renommable (v5, retour utilisateur) ──────────────────

  /**
   * Renomme la seance. Le nom personnalise vit dans `seance.nom` : le modeleSnapshot n'est
   * JAMAIS reecrit (il decrit ce qui etait prevu ce jour-la, pas ce qu'on veut afficher).
   * Toutes les vues (historique, accueil, ce detail) lisent `nom` en premier.
   */
  function modifierNom(nom) {
    chaine = chaine.then(async () => {
      const s = store.seance(idCourant);
      if (!s || (s.nom || '') === nom) return;
      s.nom = nom;
      await store.commit('seance:modifier', { seance: s });
      construire(idCourant);
    }).catch((err) => {
      console.error('[seance-detail] renommage en échec', err);
      toast.afficher('La séance n\'a pas pu être renommée.');
    });
    return chaine;
  }

  /** Feuille « Renommer » : un champ texte natif — autorise ici, comme le champ de date. */
  function ouvrirEditeurNom() {
    const seance = store.seance(idCourant);
    if (!seance) return;

    const snapshot = seance.modeleSnapshot;
    const actuel = seance.nom || (snapshot && snapshot.nom) ||
      (session.estCardioPure(seance) ? 'Sortie cardio' : 'Séance libre');

    const champ = h('input', {
      type: 'text',
      class: 'champ-nom-seance',
      value: actuel,
      maxlength: '60',
      'aria-label': 'Nom de la séance'
    });
    const btnEnregistrer = h('button', {
      class: 'bouton bouton-primaire bouton-large', type: 'button'
    }, 'Enregistrer le nom');

    fermerEditeur();
    const poignee = sheet.ouvrir({
      titre: 'Renommer la séance',
      contenu: h('div', { class: 'editeur-date' },
        champ,
        h('div', { class: 'editeur-actions' }, btnEnregistrer)),
      onFermer: () => { if (editeurHandle === poignee) editeurHandle = null; }
    });
    editeurHandle = poignee;
    champ.focus();
    champ.select();

    desabonnements.push(on(btnEnregistrer, 'click', () => {
      const valeur = String(champ.value || '').trim();
      if (!valeur) {
        toast.afficher('Donne un nom à la séance.');
        return;
      }
      poignee.fermer();
      modifierNom(valeur);
    }));
  }

  /** Tap sur la colonne exercice : l'objectif GELE du jour, en lecture seule. */
  function ouvrirFicheExercice(entreeId) {
    const seance = store.seance(idCourant);
    const entree = seance && (seance.entrees || []).find((e) => e.id === entreeId);
    if (!entree) return;
    const cibles = texteCibles(entree);
    fermerEditeur();
    const poignee = sheet.ouvrir({
      titre: nomEntree(entree),
      contenu: h('div', { class: 'confirmation' },
        h('p', { class: 'confirmation-texte' },
          cibles || 'Aucun objectif enregistré pour cet exercice ce jour-là.'),
        h('p', { class: 'texte-attenue' },
          'Objectif tel qu\'il était le jour de la séance. Le modèle actuel a pu changer depuis.')),
      onFermer: () => { if (editeurHandle === poignee) editeurHandle = null; }
    });
    editeurHandle = poignee;
  }

  // ── Suppressions ────────────────────────────────────────────────────────────

  function supprimerSeance() {
    const s = store.seance(idCourant);
    const libelle = s ? formatLong(s.date) : 'cette séance';
    store.commit('seance:supprimer', { id: idCourant })
      .then(() => {
        /* v4 : pas de popup de succes */
        router.aller('#/historique');
      })
      .catch((err) => {
        console.error('[seance-detail] suppression en échec', err);
        toast.afficher('La séance n\'a pas pu être supprimée.');
      });
  }

  /**
   * Abandonner depuis le detail — possible pour la SEULE seance encore en cours.
   *
   * ⚠ Ce n'est pas une suppression : la seance reste, ses series restent, elle change de statut.
   *   La vue ne fait rien d'autre que reconstruire son propre contenu a la reponse du store,
   *   pour que la pastille et la zone dangereuse disent la verite immediatement.
   */
  function abandonnerSeance() {
    const s = store.seance(idCourant);
    if (!estSeanceEnCours(s)) return;
    store.commit('seance:abandonner', { id: idCourant })
      // La reconstruction du contenu n'est PAS faite ici : l'abonnement a 'seance:abandonner'
      // s'en charge deja, et le declencher deux fois demonterait puis remonterait toutes les
      // rangees pour rien.
      /* v6 : pas de popup de succes — la pastille de statut change, c'est le feedback */
      .catch((err) => {
        console.error('[seance-detail] abandon en échec', err);
        toast.afficher('La séance n\'a pas pu être abandonnée.');
      });
  }

  function supprimerSerie(entreeId, serieId) {
    chaine = chaine.then(async () => {
      const s = store.seance(idCourant);
      if (!s) return;
      session.supprimerSerie(s, entreeId, serieId);
      const resultat = await store.commit('seance:modifier', { seance: s });
      const fraiche = (resultat && resultat.seance) || s;
      peindreResume(fraiche);
      majRangee(entreeId, fraiche);
      majEntete(fraiche);
      /* v6 : pas de popup de succes — la case disparait, c'est le feedback */
    }).catch((err) => {
      console.error('[seance-detail] suppression de série en échec', err);
      toast.afficher('La série n\'a pas pu être supprimée.');
    });
  }

  // ── Favoris : « refaire cette seance » ──────────────────────────────────────

  /**
   * Cree une SEANCE TYPE (v6, ex-favoris) a partir de la seance affichee ('routine:creer').
   * chargeCible reste { type:'derniere', delta:0 } : jamais un kilo en dur dans un modele.
   * Meme regle de nommage que l'historique — nom personnalise d'abord ; c'est la cle par
   * laquelle le « + » de l'historique detecte « deja creee ». Doublon : on ne fait rien.
   */
  function ajouterFavori() {
    const seance = store.seance(idCourant);
    if (!seance || !estSeanceClose(seance)) return;

    const snap = seance.modeleSnapshot;
    const nom = seance.nom || (snap && snap.nom) || ('Séance du ' + formatLong(seance.date));
    const brute = routineDepuisSeance(seance, { nom });

    if (!brute.items.length) {
      toast.afficher('Aucune série comptabilisée dans cette séance : rien à réutiliser.');
      return;
    }
    if (store.routines().some((r) => r && (r.nom || '') === nom)) {
      toast.afficher('« ' + nom + ' » existe déjà sur l\'accueil.');
      return;
    }

    store.commit('routine:creer', { routine: brute })
      .catch((err) => {
        console.error('[seance-detail] création de la séance type en échec', err);
        toast.afficher('La séance type n\'a pas pu être créée.');
      });
  }

  // ── Feuilles de confirmation ────────────────────────────────────────────────

  function fermerFeuilleLocale() {
    const handle = feuilleHandle;
    feuilleHandle = null;
    feuilleNom = null;
    if (handle) handle.fermer();
  }

  function ouvrirConfirmation(nom, config) {
    feuilleNom = nom;
    feuilleHandle = sheet.ouvrir({
      titre: config.titre,
      classe: config.classe || null,
      contenu: config.contenu,
      actions: config.actions,
      onFermer() {
        feuilleHandle = null;
        feuilleNom = null;
        // Ne retire `?sheet=…` que si l'URL le porte encore : quand la fermeture VIENT de l'URL
        // (bouton retour d'Android), rappeler fermerFeuille reculerait d'un cran de trop.
        if (router.courant().feuille === nom) router.fermerFeuille();
      }
    });
  }

  function gererFeuille(p) {
    const demandee = p && p.sheet ? p.sheet : null;
    if (demandee === feuilleNom) return;
    if (feuilleNom) fermerFeuilleLocale();
    if (!demandee) return;

    if (demandee === 'suppr-seance') {
      // v4 : forme UNIQUE de la confirmation de suppression, partagee avec l'historique et
      // l'accueil — titre, date et nom en clair, consequence en rouge, boutons pleine largeur.
      const s = store.seance(idCourant);
      const nom = (s && s.nom) || (s && s.modeleSnapshot && s.modeleSnapshot.nom) ||
        (s && session.estCardioPure(s) ? 'Sortie cardio' : 'Séance libre');
      ouvrirConfirmation('suppr-seance', {
        titre: 'Supprimer cette séance ?',
        classe: 'feuille-confirmation',
        contenu: h('div', { class: 'confirmation' },
          h('p', { class: 'confirmation-texte' },
            'Séance du ' + (s ? formatLong(s.date) : '—') + ' — ' + nom + '.'),
          h('p', { class: 'confirmation-consequence' },
            'Définitif. Elle disparaîtra des courbes et des records.')
        ),
        actions: [
          { libelle: 'Annuler', variante: 'fantome' },
          { libelle: 'Supprimer', variante: 'danger', action: supprimerSeance }
        ]
      });
      return;
    }

    // ⚠ Abandonner et supprimer ne se ressemblent que dans le vocabulaire : l'un conserve tout,
    //   l'autre n'en laisse rien. Les deux confirmations le disent en toutes lettres.
    if (demandee === 'abandon-seance') {
      const s = store.seance(idCourant);
      ouvrirConfirmation('abandon-seance', {
        titre: 'Abandonner la séance ?',
        contenu: h('div', { class: 'confirmation' },
          h('p', { class: 'confirmation-texte' },
            'La séance du ' + (s ? formatLong(s.date) : '—') + ' est CONSERVÉE, avec toutes ses ' +
            'séries, et reste visible dans l\'historique, marquée « ' +
            LIBELLES_STATUTS_SEANCE.abandonnee + ' ».'),
          h('p', { class: 'confirmation-consequence' },
            'Mais elle n\'entrera dans AUCUNE courbe ni statistique : ni record, ni ' +
            'rappel « Dernière fois ».')
        ),
        actions: [
          { libelle: 'Annuler', variante: 'fantome' },
          { libelle: 'Abandonner', variante: 'danger', action: abandonnerSeance }
        ]
      });
      return;
    }

    if (demandee === 'suppr-serie') {
      const entreeId = p.entree || null;
      const serieId = p.serie || null;
      ouvrirConfirmation('suppr-serie', {
        titre: 'Supprimer cette série ?',
        contenu: h('p', {}, 'La série sera effacée de la séance. Les autres séries ne bougent pas.'),
        actions: [
          { libelle: 'Annuler', variante: 'fantome' },
          {
            libelle: 'Supprimer',
            variante: 'danger',
            action: () => { if (entreeId && serieId) supprimerSerie(entreeId, serieId); }
          }
        ]
      });
    }
  }

  // ── Construction ────────────────────────────────────────────────────────────

  function demonterTableau() {
    rangees.clear();
    enteteRangee = null;
    chiffres = null;
  }

  function afficherMessage(titre, texte, avecLien) {
    contenu.appendChild(h('div', { class: 'etat-vide' },
      h('p', { class: 'etat-vide-titre' }, titre),
      h('p', { class: 'etat-vide-texte' }, texte),
      avecLien ? h('a', { class: 'bouton', href: '#/historique' }, 'Retour à l\'historique') : null
    ));
  }

  function construire(id) {
    fermerEditeur();
    demonterTableau();
    vider(contenu);
    idCourant = id || null;
    attenteHistorique = false;

    if (!idCourant) { afficherMessage('Séance introuvable', 'Aucun identifiant de séance n\'a été fourni.', true); return; }

    const seance = store.seance(idCourant);
    if (!seance) {
      // L'historique arrive en tache de fond : tant qu'il n'est pas la, « introuvable » serait un
      // mensonge. On attend l'evenement, une seule fois.
      if (!store.historiquePret()) {
        attenteHistorique = true;
        contenu.appendChild(h('p', { class: 'historique-resume' }, 'Chargement de la séance…'));
        store.chargerHistorique();
        return;
      }
      afficherMessage('Séance introuvable',
        'Cette séance a peut-être été supprimée, ou le lien provient d\'une autre installation.', true);
      return;
    }

    // ── En-tete : les faits du jour ───────────────────────────────────────────
    // v3 : plus de tonnage ici — coherence avec l'ecran de fin simplifie.
    const cDuree = chiffreCle('—', 'Durée');
    const cSeries = chiffreCle('0', 'Séries');
    chiffres = { duree: cDuree.val, series: cSeries.val };

    const snapshot = seance.modeleSnapshot;
    // v5 : le nom personnalise (« Renommer ») prime sur le snapshot.
    const titre = seance.nom || (snapshot && snapshot.nom) ||
      (session.estCardioPure(seance) ? 'Sortie cardio' : 'Séance libre');

    const lieu = seance.lieuId ? store.lieu(seance.lieuId) : null;
    const complements = [];
    if (lieu && lieu.nom) complements.push('Lieu : ' + lieu.nom);
    if (estNombre(seance.poidsDeCorpsKg)) complements.push('Poids de corps : ' + formatFr(seance.poidsDeCorpsKg) + ' kg');
    if (estNombre(seance.ressenti)) complements.push('Ressenti : ' + seance.ressenti + '/5');

    const mentionStatut = texteStatut(seance);

    contenu.appendChild(h('div', { class: 'carte carte-detail-seance' },
      // La date est MODIFIABLE, passee ou future : le crayon a cote ouvre la feuille dediee.
      h('div', { class: 'detail-date-rangee' },
        h('p', { class: 'carte-titre' }, formatLong(seance.date)),
        h('button', {
          class: 'bouton bouton-fantome bouton-date',
          type: 'button',
          dataset: { action: 'modifier-date' },
          'aria-label': 'Modifier la date de la séance'
        }, icone('crayon', { taille: 16 }), h('span', null, 'Modifier la date'))
      ),
      h('div', { class: 'detail-titre-rangee' },
        h('h2', { class: 'entete-titre detail-titre' }, titre),
        h('button', {
          class: 'bouton bouton-fantome bouton-date',
          type: 'button',
          dataset: { action: 'renommer' },
          'aria-label': 'Renommer la séance'
        }, icone('crayon', { taille: 16 }), h('span', null, 'Renommer')),
        pastilleStatut(seance)
      ),
      mentionStatut ? h('p', { class: 'mention-statut' }, mentionStatut) : null,
      h('div', { class: 'entete-seance' }, cDuree.bloc, cSeries.bloc),
      // ⚠ Le snapshot est la COPIE du modele au lancement. Le dire evite que l'ecart avec le
      //   modele d'aujourd'hui soit pris pour un bug.
      h('p', { class: 'mention-snapshot' }, snapshot && snapshot.nom
        ? 'Modèle « ' + snapshot.nom + ' » tel qu\'il était le ' + formatLong(seance.date) +
          '. Le modèle actuel a pu changer depuis.'
        : 'Séance sans modèle : les objectifs affichés sont ceux enregistrés ce jour-là.'),
      complements.length
        ? h('p', { class: 'ligne-liste-secondaire' }, complements.join(' · '))
        : null,
      seance.notes ? h('p', {}, seance.notes) : null
    ));

    peindreResume(seance);

    // ── Le tableau : memes rangees, memes cellules que l'ecran de seance ──────
    if (!seance.entrees || !seance.entrees.length) {
      contenu.appendChild(h('p', { class: 'historique-resume' }, 'Aucun exercice enregistré dans cette séance.'));
    } else {
      enteteRangee = h('div', { class: 'tab-entete' });
      const zoneRangees = h('div', { class: 'tab-corps' });
      for (const entree of seance.entrees) {
        zoneRangees.appendChild(creerRangee(entree));
        majRangee(entree.id, seance);
      }
      majEntete(seance);
      contenu.appendChild(h('div', { class: 'detail-tableau' },
        h('div', { class: 'tableau-defile' }, enteteRangee, zoneRangees)));
      contenu.appendChild(h('p', { class: 'historique-resume' },
        'Touche une case pour corriger la série.'));
    }

    // ── Refaire cette seance (favoris) ────────────────────────────────────────
    // Seulement sur une seance CLOSE : une seance en cours n'a rien de fini a refaire.
    if (estSeanceClose(seance)) {
      contenu.appendChild(h('div', { class: 'zone-refaire' },
        h('button', {
          class: 'bouton bouton-large detail-refaire',
          type: 'button',
          dataset: { action: 'refaire' }
        },
          icone('plus', { taille: 20 }),
          h('span', null, 'Créer une séance type'))
      ));
    }

    // ── Zone dangereuse ───────────────────────────────────────────────────────
    // L'abandon n'a de sens que sur une seance ENCORE OUVERTE : sur une seance close il n'aurait
    // rien a interrompre, et le store le refuserait de toute facon (estSeanceEnCours).
    contenu.appendChild(h('div', { class: 'zone-danger' },
      estSeanceEnCours(seance)
        ? h('button', {
          class: 'bouton bouton-danger-doux bouton-large',
          type: 'button',
          dataset: { action: 'abandon-seance' }
        },
          icone('croix', { taille: 20 }),
          h('span', null, 'Abandonner la séance'))
        : null,
      estSeanceEnCours(seance)
        ? h('p', { class: 'zone-danger-note' },
          'Conservée dans l\'historique, mais hors de toute statistique.')
        : null,
      h('button', {
        class: 'bouton bouton-danger bouton-large',
        type: 'button',
        dataset: { action: 'suppr-seance' }
      },
        icone('poubelle', { taille: 20 }),
        h('span', null, 'Supprimer la séance')),
      h('p', { class: 'zone-danger-note' }, 'La suppression est définitive.')
    ));
  }

  // ── Delegation : un seul ecouteur click pour la vue ─────────────────────────
  const off = delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    if (action === 'suppr-seance') { ev.preventDefault(); router.ouvrirFeuille('suppr-seance'); return; }
    if (action === 'modifier-date') { ev.preventDefault(); ouvrirEditeurDate(); return; }
    if (action === 'renommer') { ev.preventDefault(); ouvrirEditeurNom(); return; }
    if (action === 'refaire') { ev.preventDefault(); ajouterFavori(); return; }
    if (action === 'abandon-seance') { ev.preventDefault(); router.ouvrirFeuille('abandon-seance'); return; }
    if (action === 'cellule') {
      ev.preventDefault();
      ouvrirEditeur(cible.getAttribute('data-entry'), cible.getAttribute('data-serie'));
      return;
    }
    if (action === 'sport') { ev.preventDefault(); ouvrirFicheExercice(cible.getAttribute('data-entry')); }
  });

  const desabonner = [
    bus.on('historique:pret', () => {
      // La seance demandee n'etait pas encore chargee : on construit maintenant, sans toucher au
      // reste de l'ecran.
      if (attenteHistorique) construire(idCourant);
    }),
    bus.on('seance:supprimer', ({ id }) => {
      // Supprimee ailleurs (import, reglages) : rester sur un detail fantome n'a aucun sens.
      if (id === idCourant) router.aller('#/historique');
    }),
    // Abandonnee ou terminee ailleurs (l'ecran de seance, la reprise proposee au demarrage) :
    // le statut affiche ici serait faux. On reconstruit le contenu de CETTE vue, rien d'autre.
    bus.on('seance:abandonner', ({ seance }) => {
      if (seance && seance.id === idCourant) construire(idCourant);
    }),
    bus.on('seance:terminer', ({ seance }) => {
      if (seance && seance.id === idCourant) construire(idCourant);
    })
  ];

  construire(params.id);
  gererFeuille(params);

  return {
    destroy() {
      off();
      for (const stop of desabonner) stop();
      desabonner.length = 0;
      for (const stop of desabonnements) { try { stop(); } catch (_) { /* deja detache */ } }
      desabonnements.length = 0;
      if (feuilleNom) fermerFeuilleLocale();
      // ⚠ Feuille d'edition et pave vivent HORS du sous-arbre retire ci-dessous : sans fermeture
      //   explicite, ils resteraient ouverts par-dessus l'ecran suivant.
      try { fermerEditeur(); } catch (_) { /* deja fermee */ }
      try { keypad.fermer(); } catch (_) { /* deja ferme */ }
      demonterTableau();
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    },

    onParams(p) {
      const params2 = p || {};
      // Meme cle de route pour deux seances differentes : le routeur n'a pas remonte la vue,
      // c'est donc a elle de reconstruire son propre contenu.
      if (params2.id && params2.id !== idCourant) construire(params2.id);
      gererFeuille(params2);
    }
  };
}

export default { mount };
