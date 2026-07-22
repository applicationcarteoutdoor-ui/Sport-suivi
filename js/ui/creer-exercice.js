// ui/creer-exercice.js — feuille « Créer un exercice » (v11).
//
// Le parcours COMPLET de creation, la ou la « creation eclair » du picker reste a deux champs :
// nom, muscle principal, muscles secondaires, mode de suivi, materiel, description, lien video.
// Esprit minimaliste : une colonne, des tuiles a ETAT (aria-pressed) pour les muscles, et les
// vocabulaires FERMES de data/schema.js (CATEGORIES, MATERIELS, MODES) — aucune valeur inventee.
//
// FRAGMENT VIVANT (zone C) : sous-arbre construit UNE fois, possede integralement, monte dans la
// feuille basse (ui/sheet.js). L'ecriture passe par le commit EXISTANT
// store.commit('exercice:enregistrer', { exercice }) — exactement celui de la creation eclair.
// Pas de toast de succes (regle v6) : l'exercice apparait dans le catalogue, c'est le feedback.

import { h, delegate } from '../lib/dom.js';
import * as store from '../data/store.js';
import * as sheet from './sheet.js';
import {
  NOMS_MODES, LIBELLES_MODES, CATEGORIES, LIBELLES_CATEGORIES,
  MATERIELS, LIBELLES_MATERIELS, nouvelExercice
} from '../data/schema.js';

/**
 * Ouvre la feuille de creation d'exercice.
 *
 * @param {Object} [options]
 * @param {(exercice:Object)=>void} [options.onCree] appele avec l'exercice cree, feuille fermee
 * @param {Function} [options.onFermer] appele UNE fois a la fermeture, quel que soit le chemin
 * @returns {{fermer:()=>void}}
 */
export function ouvrir({ onCree, onFermer } = {}) {
  const desabonnements = [];
  let modeChoisi = 'charge';
  let principal = null;              // categorie principale, ou null (defaut au moment de creer)
  const secondaires = new Set();     // categories secondaires, multi-selection
  let poignee = null;                // { fermer } rendu par sheet.ouvrir
  let ferme = false;

  // ── Sous-arbre, construit UNE fois ────────────────────────────────────────

  // Champ natif admis hors ecran de seance ; la police >= 16px vient du CSS (zoom iOS).
  const champNom = h('input', {
    type: 'text',
    class: 'creer-exo-champ',
    placeholder: 'Nom de l’exercice',
    'aria-label': 'Nom de l’exercice',
    autocomplete: 'off',
    maxlength: '60',
    enterkeyhint: 'next'
  });

  // Les MEMES tuiles pour le principal (choix unique) et les secondaires (multi-selection) :
  // etat porte par aria-pressed, jamais par une classe conditionnelle.
  function grilleMuscles(role, libelleGroupe) {
    return h('div', { class: 'creer-exo-grille', role: 'group', 'aria-label': libelleGroupe },
      ...CATEGORIES.map((c) => h('button', {
        type: 'button',
        class: 'creer-exo-muscle',
        'data-action': role,
        'data-cat': c,
        'aria-pressed': 'false'
      }, LIBELLES_CATEGORIES[c] || c))
    );
  }
  const grillePrincipal = grilleMuscles('principal', 'Muscle principal');
  const grilleSecondaires = grilleMuscles('secondaire', 'Muscles secondaires');

  // Mode de suivi : memes segments que la creation eclair du picker (role=tablist,
  // aria-selected — l'attribut que le CSS des segments stylise, jamais aria-pressed ici).
  const segmentsMode = h('div', { class: 'segments creer-exo-modes', role: 'tablist', 'aria-label': 'Mode de suivi' },
    ...NOMS_MODES.map((m) => h('button', {
      type: 'button', class: 'segment', role: 'tab',
      'data-action': 'mode', 'data-mode': m,
      'aria-selected': m === modeChoisi ? 'true' : 'false'
    }, LIBELLES_MODES[m] || m))
  );

  // Materiel : le vocabulaire ferme MATERIELS du schema, dans un <select> natif — compact,
  // accessible, et le clavier systeme n'a rien a y faire.
  const champMateriel = h('select', { class: 'creer-exo-champ', 'aria-label': 'Matériel' },
    ...MATERIELS.map((m) => h('option', { value: m }, LIBELLES_MATERIELS[m] || m))
  );

  const champDescription = h('textarea', {
    class: 'creer-exo-champ creer-exo-description',
    rows: '3',
    placeholder: 'Consignes, réglages, points de forme…',
    'aria-label': 'Description'
  });

  const champVideo = h('input', {
    type: 'url',
    class: 'creer-exo-champ',
    placeholder: 'https://…',
    'aria-label': 'Lien ou vidéo d’exécution',
    autocomplete: 'off',
    inputmode: 'url',
    enterkeyhint: 'done'
  });

  const message = h('p', { class: 'creer-exo-message', hidden: true, role: 'alert' });

  function libelle(texte, optionnel) {
    return h('p', { class: 'creer-exo-libelle' }, texte,
      optionnel ? h('span', { class: 'creer-exo-note' }, ' — optionnel') : null);
  }

  const racine = h('div', { class: 'creer-exo' },
    libelle('Nom'),
    champNom,
    libelle('Muscle principal'),
    grillePrincipal,
    libelle('Muscles secondaires', true),
    grilleSecondaires,
    libelle('Mode de suivi'),
    segmentsMode,
    libelle('Matériel'),
    champMateriel,
    libelle('Description', true),
    champDescription,
    libelle('Lien ou vidéo d’exécution', true),
    champVideo,
    message
  );

  // ── Delegation : UN seul ecouteur click pour tout le fragment ─────────────
  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');

    if (action === 'mode') {
      const m = cible.getAttribute('data-mode');
      modeChoisi = NOMS_MODES.indexOf(m) !== -1 ? m : 'charge';
      for (const b of segmentsMode.children) {
        b.setAttribute('aria-selected', b.getAttribute('data-mode') === modeChoisi ? 'true' : 'false');
      }
      return;
    }

    if (action === 'principal') {
      const cat = cible.getAttribute('data-cat');
      principal = principal === cat ? null : cat;   // un second tap deselectionne
      for (const b of grillePrincipal.children) {
        b.setAttribute('aria-pressed', b.getAttribute('data-cat') === principal ? 'true' : 'false');
      }
      // Le principal ne peut pas aussi etre secondaire : on l'y retire s'il y etait.
      if (principal && secondaires.has(principal)) {
        secondaires.delete(principal);
        for (const b of grilleSecondaires.children) {
          if (b.getAttribute('data-cat') === principal) b.setAttribute('aria-pressed', 'false');
        }
      }
      return;
    }

    if (action === 'secondaire') {
      const cat = cible.getAttribute('data-cat');
      if (cat === principal) return;                // deja principal : rien a faire
      if (secondaires.has(cat)) secondaires.delete(cat);
      else secondaires.add(cat);
      cible.setAttribute('aria-pressed', secondaires.has(cat) ? 'true' : 'false');
    }
  }));

  // ── Creation ──────────────────────────────────────────────────────────────
  async function creer() {
    const nom = String(champNom.value || '').trim();
    if (!nom) {
      message.textContent = 'Donne un nom à l’exercice.';
      message.hidden = false;
      champNom.focus();
      return;
    }
    // Muscle principal non choisi : on DEDUIT une categorie valide plutot que de bloquer —
    // cardio pour le mode cardio, corps entier sinon. Completable plus tard depuis Exercices.
    const categorie = principal || (modeChoisi === 'cardio' ? 'cardio' : 'corps-entier');
    const description = String(champDescription.value || '').trim();
    const video = String(champVideo.value || '').trim();
    try {
      const brouillon = nouvelExercice({
        nom,
        mode: modeChoisi,
        categorie,
        materiel: MATERIELS.indexOf(champMateriel.value) !== -1 ? champMateriel.value : 'aucun',
        musclesSecondaires: Array.from(secondaires).filter((c) => c !== categorie),
        notes: description || null,
        videoUrl: video || null,
        metriqueCardio: modeChoisi === 'cardio' ? 'allure' : null,
        userModified: true
      });
      const resultat = await store.commit('exercice:enregistrer', { exercice: brouillon });
      const cree = (resultat && resultat.exercice) || brouillon;
      fermer();
      /* pas de toast de succes : l'exercice est dans le catalogue, c'est le feedback */
      if (typeof onCree === 'function') onCree(cree);
    } catch (err) {
      console.error('[creer-exercice] création en échec', err);
      message.textContent = 'Création impossible : ' + (err && err.message ? err.message : 'erreur inconnue');
      message.hidden = false;
    }
  }

  // ── Montage dans la feuille basse ─────────────────────────────────────────
  function nettoyer() {
    if (ferme) return;
    ferme = true;
    for (const off of desabonnements) { try { off(); } catch (_) { /* deja detache */ } }
    desabonnements.length = 0;
    if (typeof onFermer === 'function') {
      try { onFermer(); } catch (err) { console.error('[creer-exercice] onFermer en échec', err); }
    }
  }

  function fermer() {
    const p = poignee;
    poignee = null;
    nettoyer();
    if (p && typeof p.fermer === 'function') p.fermer();
  }

  poignee = sheet.ouvrir({
    titre: 'Créer un exercice',
    contenu: racine,
    // ⚠ La cle est « onFermer » — la SEULE que sheet.js lit : toute autre orthographe serait
    //   ignoree en silence et ferait fuir les ecouteurs de ce fragment.
    onFermer: nettoyer,
    actions: [
      { libelle: 'Annuler', variante: 'fantome' },
      // fermeApres:false — la feuille reste ouverte si la creation echoue, sinon la saisie
      // disparaitrait avec le message d'erreur.
      { libelle: 'Créer l’exercice', variante: 'primaire', fermeApres: false, action: creer }
    ]
  }) || { fermer: nettoyer };

  return { fermer };
}

export default { ouvrir };
