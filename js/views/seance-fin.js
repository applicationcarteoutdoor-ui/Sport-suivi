// views/seance-fin.js — cloture de seance, route #/seance/fin.
//
// Ecran volontairement MINIMAL (retour utilisateur v3 : « le bilan avec le tonnage et tout,
// tu peux enlever ») : un titre, le commentaire, le lieu s'il y a un choix, la confirmation.
// Tout tient sans defiler. Trois regles conservees de la version bilan :
//
//   1. LE POIDS DE CORPS N'EST PAS REDEMANDE. Il a ete saisi au lancement (views/accueil.js) et
//      chargeEffectiveKg en a dependu pendant toute la seance : le changer ici reecrirait
//      retroactivement la charge de chaque serie deja validee.
//   2. LE LIEU N'APPARAIT QUE S'IL Y A UN CHOIX. Un unique lieu se selectionne tout seul au
//      lancement ; afficher un selecteur a une seule option est un tap gratuit.
//   3. AUCUN RE-RENDU. La vue est peinte une fois, le lieu ne mute que `aria-pressed` sur des
//      boutons deja en place.
//
// La cloture passe par domain/session.terminer() (calcul de la duree bornee, purge des series
// vierges) PUIS par store.commit('seance:terminer'), unique porte d'ecriture.

import { h, on, delegate } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import * as store from '../data/store.js';
import * as session from '../domain/session.js';
import * as router from '../ui/router.js';
import * as toast from '../ui/toast.js';

// ─────────────────────────────────────────────────────────────────────────────
// Montage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Element} conteneur le <main> de la coquille
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur) {
  const desabos = [];
  const etat = { lieuId: null, cloture: false, detruit: false };

  // La barre d'action appartient a l'ecran de seance : ici, le bouton de cloture est dans le
  // flux de la vue et deux boutons primaires simultanes se disputeraient le pouce.
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

  // ── Titre ─────────────────────────────────────────────────────────────────

  const titre = h('h2', { class: 'fin-titre' }, 'Séance terminée');

  // ── Commentaire ───────────────────────────────────────────────────────────

  const champNotes = h('textarea', {
    class: 'zone-notes',
    id: 'notes-seance',
    rows: '3',
    placeholder: 'Sensations, douleurs, matériel occupé…'
  });
  if (typeof seance.notes === 'string') champNotes.value = seance.notes;

  const blocNotes = h('section', {},
    h('h2', { class: 'section-titre' }, h('label', { for: 'notes-seance' }, 'Commentaire')),
    champNotes
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
    titre,
    blocNotes,
    blocLieu,
    btnTerminer,
    btnRetour
  );
  conteneur.appendChild(racine);

  // ── Mutations ciblees ─────────────────────────────────────────────────────

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

      // domain/session : duree bornee, purge des series vierges, report des notes.
      const finale = session.terminer(seance, {
        notes: champNotes.value.trim()
      });

      // data/store : unique porte d'ecriture. Elle relit et verifie AVANT de purger le miroir
      // chaud — si la relecture echoue, elle leve et la seance reste reprenable.
      await store.commit('seance:terminer', { seance: finale, endedAt: finale.endedAt });

      if (etat.detruit) return;
      /* v6 : pas de popup de succes — on arrive sur l'accueil, la seance est dans l'historique */
      // remplacer : le bouton retour ne doit pas ramener sur la cloture d'une seance close.
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
    if (action === 'lieu') { choisirLieu(cible.getAttribute('data-id')); return; }
    if (action === 'reprendre') { router.aller('#/seance'); return; }
    if (action === 'terminer') { terminer(); }
  }));

  // Le commentaire est recopie sur la seance a la volee : un ecran tue pendant la frappe ne doit
  // pas emporter le texte. L'ecriture durable, elle, reste celle de la cloture.
  desabos.push(on(champNotes, 'input', () => { seance.notes = champNotes.value; }));

  // Une seance supprimee ou close ailleurs (autre onglet, ecran de reprise) rend cet ecran caduc.
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
