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
import { icone } from './icons.js';
import {
  NOMS_MODES, LIBELLES_MODES, CATEGORIES, LIBELLES_CATEGORIES, nouvelExercice
} from '../data/schema.js';

// Logos proposes : les dessins d'EXERCICE et de MATERIEL de ui/icons.js — jamais les icones
// d'interface (chevrons, poubelle…), qui n'ont aucun sens comme logo d'exercice. Toutes ces
// cles existent dans ICONES ; iconePourExercice les honore en priorite (v11).
const LOGOS = [
  'halteres', 'barre', 'poulie', 'machine', 'poids-du-corps', 'elastique', 'gainage', 'cardio',
  'developpe-couche-barre', 'developpe-couche-halteres', 'developpe-incline-barre', 'developpe-militaire',
  'pompes', 'dips-barres', 'elevations-laterales', 'oiseau', 'face-pull',
  'tractions-pronation', 'rowing-barre', 'rowing-halteres', 'tirage-vertical', 'souleve-de-terre',
  'curl-barre', 'curl-halteres', 'extensions-triceps-poulie',
  'squat', 'presse-a-cuisses', 'fentes', 'leg-curl', 'leg-extension', 'mollets',
  'squat-bulgare', 'goblet-squat', 'hip-thrust', 'souleve-de-terre-roumain',
  'planche', 'planche-laterale', 'suspension-barre', 'releve-de-jambes', 'crunchs',
  'burpees', 'course-a-pied', 'velo', 'rameur', 'elliptique', 'corde-a-sauter'
];

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
  let logoChoisi = null;             // cle d'icone, ou null (resolution automatique)
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

  // Mode de suivi : memes segments que la creation eclair du picker (role=tablist,
  // aria-selected — l'attribut que le CSS des segments stylise, jamais aria-pressed ici).
  // v12 : place EN PREMIER (au-dessus du muscle), retour utilisateur.
  const segmentsMode = h('div', { class: 'segments creer-exo-modes', role: 'tablist', 'aria-label': 'Mode de suivi' },
    ...NOMS_MODES.map((m) => h('button', {
      type: 'button', class: 'segment', role: 'tab',
      'data-action': 'mode', 'data-mode': m,
      'aria-selected': m === modeChoisi ? 'true' : 'false'
    }, LIBELLES_MODES[m] || m))
  );

  // Muscle principal : une tuile par categorie, choix UNIQUE (aria-pressed).
  const grillePrincipal = h('div', { class: 'creer-exo-grille', role: 'group', 'aria-label': 'Muscle principal' },
    ...CATEGORIES.map((c) => h('button', {
      type: 'button', class: 'creer-exo-muscle',
      'data-action': 'principal', 'data-cat': c, 'aria-pressed': 'false'
    }, LIBELLES_CATEGORIES[c] || c))
  );

  // Logo : une grille de pictogrammes (v11). Choix UNIQUE, deselectionnable — sans choix, l'icone
  // se resout automatiquement. Chaque tuile porte le dessin lui-meme, pas son nom.
  const grilleLogos = h('div', { class: 'creer-exo-logos', role: 'group', 'aria-label': 'Logo' },
    ...LOGOS.map((cle) => h('button', {
      type: 'button', class: 'creer-exo-logo',
      'data-action': 'logo', 'data-logo': cle, 'aria-pressed': 'false',
      'aria-label': 'Logo ' + cle
    }, icone(cle, { taille: 26 })))
  );

  // v12 : plus de champ Matériel ni Description (invisibles hors de l'ecran Exercices, orphelin) ;
  // plus de muscles secondaires (jamais lus). Le lien video reste : il alimente les fiches.
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
    libelle('Mode de suivi'),
    segmentsMode,
    libelle('Muscle principal'),
    grillePrincipal,
    libelle('Logo', true),
    grilleLogos,
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
      return;
    }

    if (action === 'logo') {
      const cle = cible.getAttribute('data-logo');
      logoChoisi = logoChoisi === cle ? null : cle;  // un second tap revient a l'auto
      for (const b of grilleLogos.children) {
        b.setAttribute('aria-pressed', b.getAttribute('data-logo') === logoChoisi ? 'true' : 'false');
      }
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
    // cardio pour le mode cardio, corps entier sinon.
    const categorie = principal || (modeChoisi === 'cardio' ? 'cardio' : 'corps-entier');
    const video = String(champVideo.value || '').trim();
    try {
      const brouillon = nouvelExercice({
        nom,
        mode: modeChoisi,
        categorie,
        icone: logoChoisi,
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
