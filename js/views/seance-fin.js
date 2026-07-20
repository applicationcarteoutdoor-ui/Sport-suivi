// views/seance-fin.js — cloture de seance, route #/seance/fin.
//
// L'ecran repond a une seule question : « qu'est-ce que je viens de faire ? », puis demande le
// strict minimum avant de fermer le carnet. Trois regles :
//
//   1. LE POIDS DE CORPS N'EST PAS REDEMANDE. Il a ete saisi au lancement (views/accueil.js) et
//      chargeEffectiveKg en a dependu pendant toute la seance : le changer ici reecrirait
//      retroactivement la charge de chaque serie deja validee.
//   2. LE LIEU N'APPARAIT QUE S'IL Y A UN CHOIX. Un unique lieu se selectionne tout seul au
//      lancement ; afficher un selecteur a une seule option est un tap gratuit.
//   3. AUCUN RE-RENDU. Le bilan est peint une fois, le ressenti et le lieu ne mutent que
//      `aria-pressed` sur des boutons deja en place.
//
// La cloture passe par domain/session.terminer() (calcul de la duree bornee, purge des series
// vierges) PUIS par store.commit('seance:terminer'), unique porte d'ecriture.

import { h, on, delegate } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatDuree, formatFr } from '../lib/num.js';
import { MODES, UNITES, LIBELLES_METRIQUES, estComptable, estSeanceComptable } from '../data/schema.js';
import * as store from '../data/store.js';
import { tonnageSeance, estRecord } from '../domain/metrics.js';
import { serieTemporelle } from '../domain/progression.js';
import * as session from '../domain/session.js';
import * as router from '../ui/router.js';
import * as toast from '../ui/toast.js';

// Marge appliquee a la duree affichee, identique a celle de session.terminer() : une seance
// laissee ouverte dans une poche ne doit pas s'afficher « 4:12:00 » avant meme d'etre close.
const MARGE_CLOTURE_MS = 10 * 60 * 1000;

const RESSENTIS = [
  { valeur: 1, libelle: 'Très facile' },
  { valeur: 2, libelle: 'Facile' },
  { valeur: 3, libelle: 'Correct' },
  { valeur: 4, libelle: 'Difficile' },
  { valeur: 5, libelle: 'Très difficile' }
];

// Modes cardio DERIVES de la table des modes (presence de distanceM en saisie), jamais d'un test
// sur le nom du mode : un mode ajoute demain compte ses minutes sans toucher ce fichier.
const MODES_CARDIO = new Set(
  Object.keys(MODES).filter((m) => MODES[m].saisie.indexOf('distanceM') !== -1)
);

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// ─────────────────────────────────────────────────────────────────────────────
// Bilan — calculs locaux sur une seance ENCORE EN COURS
// ─────────────────────────────────────────────────────────────────────────────
// Les agregats de domain/progression.js ignorent volontairement les seances non terminees (un
// point de courbe ne doit pas bouger a chaque serie validee) : le bilan est donc calcule ici.

function dernierHorodatage(seance) {
  let max = 0;
  for (const entree of seance.entrees || []) {
    for (const serie of entree.series || []) {
      if (serie.done === true && estNombre(serie.at) && serie.at > max) max = serie.at;
    }
  }
  return max || null;
}

function dureeEstimeeSec(seance) {
  const fin = Date.now();
  const dernier = dernierHorodatage(seance);
  const borne = dernier != null ? Math.min(fin, dernier + MARGE_CLOTURE_MS) : fin;
  return Math.max(0, Math.round((borne - (seance.startedAt || fin)) / 1000));
}

function compterSeries(seance) {
  let n = 0;
  for (const entree of seance.entrees || []) {
    n += (entree.series || []).filter(estComptable).length;
  }
  return n;
}

function minutesCardio(seance) {
  let secondes = 0;
  for (const entree of seance.entrees || []) {
    if (!MODES_CARDIO.has(entree.modeUtilise)) continue;
    for (const serie of (entree.series || []).filter(estComptable)) {
      if (estNombre(serie.dureeSec)) secondes += serie.dureeSec;
    }
  }
  return Math.round(secondes / 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// Records du jour
// ─────────────────────────────────────────────────────────────────────────────

function extreme(points, sens) {
  let retenu = null;
  for (const p of points) {
    if (!retenu || (sens === 'bas' ? p.y < retenu.y : p.y > retenu.y)) retenu = p;
  }
  return retenu;
}

/**
 * Records etablis pendant CETTE seance, toutes metriques du mode gele sur chaque entree.
 *
 * ⚠ Un record exige une REFERENCE : sans point anterieur, tout serait un record et le badge ne
 *   voudrait plus rien dire — la premiere seance en afficherait une pleine page. ⚠ Un point non
 *   fiable (machine sans profil de plaques) ne peut jamais en porter un.
 *
 * La seance en cours est passee aux reducteurs sous une COPIE de surface marquee « terminee » :
 * serieTemporelle ignore les seances ouvertes, et muter l'objet du store pour la contourner
 * ferait apparaitre une seance close dans l'historique avant sa cloture reelle.
 */
function recordsDuJour(seance) {
  const anterieures = store.seances().filter((s) => estSeanceComptable(s) && s.id !== seance.id);
  const liste = anterieures.concat([Object.assign({}, seance, { statut: 'terminee' })]);

  const sorties = [];
  const vus = new Set();

  for (const entree of seance.entrees || []) {
    const def = MODES[entree.modeUtilise];
    if (!def) continue;
    const exercice = store.exercice(entree.exerciceId);
    const nom = (exercice && exercice.nom) || entree.nomAffiche || 'Exercice';

    for (const demandee of def.metriques) {
      const resultat = serieTemporelle(liste, entree.exerciceId, demandee, null);
      const cle = entree.exerciceId + '/' + resultat.metrique;
      if (vus.has(cle)) continue;

      const dujour = resultat.points.filter((p) => p.seanceId === seance.id && p.fiable);
      const avant = resultat.points.filter((p) => p.seanceId !== seance.id && p.fiable);
      if (!dujour.length || !avant.length) continue;

      const meilleurJour = extreme(dujour, resultat.sens);
      const meilleurAvant = extreme(avant, resultat.sens);
      if (!estRecord(meilleurJour.y, meilleurAvant.y, entree.incrementKgUtilise, resultat.sens)) continue;

      vus.add(cle);
      sorties.push({
        nom,
        metrique: LIBELLES_METRIQUES[resultat.metrique] || resultat.metrique,
        libelle: meilleurJour.libelle ||
          (formatFr(meilleurJour.y) + ' ' + (UNITES[resultat.metrique] || ''))
      });
    }
  }
  return sorties;
}

// ─────────────────────────────────────────────────────────────────────────────
// Montage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Element} conteneur le <main> de la coquille
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur) {
  const desabos = [];
  const etat = { ressenti: null, lieuId: null, cloture: false, detruit: false };

  // La barre d'action appartient a l'ecran de seance : sur le bilan, le bouton de cloture est
  // dans le flux de la vue et deux boutons primaires simultanes se disputeraient le pouce.
  const barre = document.getElementById('barre-action');
  if (barre) barre.hidden = true;

  const seance = store.seanceActive();

  // ── Aucune seance ouverte : jamais d'ecran vide, toujours une issue ────────
  if (!seance) {
    const secours = h('section', { class: 'vue vue-seance-fin' },
      h('div', { class: 'etat-vide' },
        h('p', { class: 'etat-vide-titre' }, 'Aucune séance en cours'),
        h('p', { class: 'etat-vide-texte' },
          'Elle a déjà été enregistrée, ou n\'a jamais été ouverte sur cet appareil.'),
        h('a', { class: 'bouton bouton-primaire', href: '#/' }, 'Revenir à l\'accueil')
      )
    );
    conteneur.appendChild(secours);
    return {
      destroy() { if (secours.parentNode) secours.parentNode.removeChild(secours); },
      onParams() { /* rien a resynchroniser */ }
    };
  }

  etat.lieuId = seance.lieuId || null;

  // ── Bilan ─────────────────────────────────────────────────────────────────

  function tuile(valeur, libelle) {
    return h('div', {},
      h('span', { class: 'chiffre-cle' }, valeur),
      h('span', { class: 'chiffre-cle-libelle' }, libelle)
    );
  }

  const tonnage = tonnageSeance(seance);
  const cardio = minutesCardio(seance);

  const blocBilan = h('section', { class: 'carte' },
    h('h2', { class: 'carte-titre' }, 'Bilan'),
    h('div', { class: 'bilan' },
      tuile(formatDuree(dureeEstimeeSec(seance)) || '0:00', 'Durée'),
      tuile(estNombre(tonnage.kg) && tonnage.kg > 0 ? formatFr(tonnage.kg, 0) + ' kg' : '—', 'Tonnage'),
      tuile(String(compterSeries(seance)), 'Séries'),
      tuile(cardio > 0 ? cardio + ' min' : '—', 'Cardio')
    ),
    // Le tonnage d'une machine sans profil de plaques n'est pas calculable : on le DIT plutot
    // que d'afficher un chiffre faux avec assurance.
    tonnage.fiable === false
      ? h('p', { class: 'reprendre-mention' },
          'Tonnage partiel : une machine sans profil de plaques n\'est pas convertible en kilos.')
      : null
  );

  // ── Records du jour ───────────────────────────────────────────────────────

  const records = recordsDuJour(seance);
  const blocRecords = h('section', { class: 'carte', hidden: records.length === 0 },
    h('h2', { class: 'carte-titre' }, 'Records du jour'),
    h('div', { class: 'records-du-jour' },
      records.map((r) => h('div', { class: 'ligne-liste' },
        h('span', { class: 'ligne-liste-principal' }, r.nom),
        h('span', { class: 'ligne-liste-secondaire' }, r.metrique + ' — ' + r.libelle),
        h('span', { class: 'badge-record' }, 'Record')
      ))
    )
  );

  // ── Ressenti ──────────────────────────────────────────────────────────────

  const boutonsRessenti = RESSENTIS.map((r) => h('button', {
    class: 'bouton',
    type: 'button',
    dataset: { action: 'ressenti', valeur: r.valeur },
    'aria-pressed': 'false',
    'aria-label': 'Ressenti ' + r.valeur + ' sur 5 : ' + r.libelle,
    title: r.libelle
  }, String(r.valeur)));

  const legendeRessenti = h('p', { class: 'reprendre-mention' }, '1 très facile · 5 très difficile');

  const blocRessenti = h('section', {},
    h('h2', { class: 'section-titre' }, 'Ressenti'),
    h('div', { class: 'ressenti' }, boutonsRessenti),
    legendeRessenti
  );

  // ── Lieu — uniquement si plus d'un lieu existe ────────────────────────────

  const lieux = store.lieux().filter((l) => l && l.archived !== true);
  const boutonsLieu = lieux.map((l) => h('button', {
    class: 'bouton',
    type: 'button',
    dataset: { action: 'lieu', id: l.id },
    'aria-pressed': etat.lieuId === l.id ? 'true' : 'false'
  }, l.nom || 'Lieu'));

  const blocLieu = h('section', { hidden: lieux.length <= 1 },
    h('h2', { class: 'section-titre' }, 'Lieu'),
    h('div', { class: 'demarrages-libres' }, boutonsLieu)
  );

  // ── Notes ─────────────────────────────────────────────────────────────────

  const champNotes = h('textarea', {
    class: 'zone-notes',
    id: 'notes-seance',
    rows: '3',
    placeholder: 'Sensations, douleurs, matériel occupé…'
  });
  if (typeof seance.notes === 'string') champNotes.value = seance.notes;

  const blocNotes = h('section', {},
    h('h2', { class: 'section-titre' }, h('label', { for: 'notes-seance' }, 'Notes')),
    champNotes
  );

  // ── Confirmation ──────────────────────────────────────────────────────────

  const btnTerminer = h('button', {
    class: 'bouton bouton-primaire bouton-geant',
    type: 'button',
    'data-action': 'terminer'
  }, 'Terminer la séance');

  const btnRetour = h('button', {
    class: 'bouton bouton-fantome bouton-large',
    type: 'button',
    'data-action': 'reprendre'
  }, 'Revenir à la séance');

  const racine = h('section', { class: 'vue vue-seance-fin' },
    blocBilan,
    blocRecords,
    blocRessenti,
    blocLieu,
    blocNotes,
    btnTerminer,
    btnRetour
  );
  conteneur.appendChild(racine);

  // ── Mutations ciblees ─────────────────────────────────────────────────────

  function choisirRessenti(valeur) {
    // Re-tap sur le meme chiffre : on deselectionne. Le ressenti est facultatif, et rien ne
    // permettrait sinon de revenir en arriere apres un tap accidentel.
    etat.ressenti = etat.ressenti === valeur ? null : valeur;
    for (const btn of boutonsRessenti) {
      const v = Number(btn.getAttribute('data-valeur'));
      btn.setAttribute('aria-pressed', v === etat.ressenti ? 'true' : 'false');
    }
  }

  function choisirLieu(id) {
    etat.lieuId = etat.lieuId === id ? null : id;
    for (const btn of boutonsLieu) {
      const v = btn.getAttribute('data-id');
      btn.setAttribute('aria-pressed', v === etat.lieuId ? 'true' : 'false');
    }
  }

  // ── Cloture ───────────────────────────────────────────────────────────────

  async function terminer() {
    if (etat.cloture) return;                   // double-tap : une seule cloture
    etat.cloture = true;
    btnTerminer.disabled = true;
    btnTerminer.textContent = 'Enregistrement…';

    try {
      // ⚠ Pose directe : session.terminer() n'applique ctx.lieuId que s'il est non nul, ce qui
      //    rend une DESELECTION impossible a exprimer par le contexte.
      seance.lieuId = etat.lieuId || null;

      // domain/session : duree bornee, purge des series vierges, report du ressenti et des notes.
      const finale = session.terminer(seance, {
        ressenti: estNombre(etat.ressenti) ? etat.ressenti : undefined,
        notes: champNotes.value.trim()
      });

      // data/store : unique porte d'ecriture. Elle relit et verifie AVANT de purger le miroir
      // chaud — si la relecture echoue, elle leve et la seance reste reprenable.
      await store.commit('seance:terminer', { seance: finale, endedAt: finale.endedAt });

      if (etat.detruit) return;
      toast.afficher('Séance enregistrée');
      // remplacer : le bouton retour ne doit pas ramener sur le bilan d'une seance close.
      router.aller('#/', { remplacer: true });
    } catch (err) {
      console.error('[seance-fin] clôture en échec', err);
      etat.cloture = false;
      btnTerminer.disabled = false;
      btnTerminer.textContent = 'Terminer la séance';
      toast.afficher(err && err.message
        ? err.message
        : 'La séance n\'a pas pu être enregistrée. Elle reste ouverte.', { duree: 0 });
    }
  }

  // ── Delegation : un seul ecouteur click pour toute la vue ─────────────────

  desabos.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    if (action === 'ressenti') { choisirRessenti(Number(cible.getAttribute('data-valeur'))); return; }
    if (action === 'lieu') { choisirLieu(cible.getAttribute('data-id')); return; }
    if (action === 'reprendre') { router.aller('#/seance'); return; }
    if (action === 'terminer') { terminer(); }
  }));

  // Les notes sont recopiees sur la seance a la volee : un ecran tue pendant la frappe ne doit
  // pas emporter le texte. L'ecriture durable, elle, reste celle de la cloture.
  desabos.push(on(champNotes, 'input', () => { seance.notes = champNotes.value; }));

  // Une seance supprimee ou close ailleurs (autre onglet, ecran de reprise) rend ce bilan caduc.
  desabos.push(bus.on('seance:supprimer', () => {
    if (etat.detruit || etat.cloture) return;
    router.aller('#/', { remplacer: true });
  }));

  return {
    destroy() {
      etat.detruit = true;
      for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
      desabos.length = 0;
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    },
    onParams() {
      // Aucune feuille portee par l'URL sur cet ecran.
    }
  };
}

export default { mount };
