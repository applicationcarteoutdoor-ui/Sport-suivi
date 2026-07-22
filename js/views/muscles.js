// views/muscles.js — route #/muscles : le corps humain (v10, 5e onglet de navigation).
//
// La silhouette cliquable (ui/silhouette.js, partagee avec la vue anatomique du composeur)
// occupe le haut de l'ecran ; toucher un muscle affiche EN DESSOUS sa fiche (role, maniere de
// le travailler — data/muscles-info.js) et TOUS les exercices qui le sollicitent, chacun avec
// son lien video et un raccourci vers sa courbe de progression.
//
// CONTRAT DE RENDU (zone B) : DOM construit UNE fois au montage ; seul le contenu de la zone
// de detail est reconstruit au choix d'un muscle (aucun fragment vivant dedans — que des
// lignes inertes sous delegation). La vue ne lit que le store (synchrone) et n'ecrit rien.

import { h, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { LIBELLES_CATEGORIES } from '../data/schema.js';
import { infoMuscle } from '../data/muscles-info.js';
import * as store from '../data/store.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import { creerSilhouette } from '../ui/silhouette.js';
import * as router from '../ui/router.js';

/**
 * @param {Element} conteneur
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur) {
  let groupeChoisi = null;

  const silhouette = creerSilhouette({ onGroupe: choisir });

  const detail = h('div', { class: 'muscles-detail', hidden: true });

  const racine = h('section', { class: 'vue vue-muscles' },
    silhouette,
    detail
  );
  conteneur.appendChild(racine);

  // ── Choix d'un muscle ───────────────────────────────────────────────────────

  /** Surbrillance : data-actif sur les zones du groupe choisi, retire des autres. */
  function marquer(categorie) {
    for (const zone of racine.querySelectorAll('[data-groupe]')) {
      const actif = zone.getAttribute('data-groupe') === categorie;
      if (actif) zone.setAttribute('data-actif', 'oui');
      else zone.removeAttribute('data-actif');
    }
  }

  /** Exercices ACTIFS de la categorie, catalogue et personnels confondus, tries par nom. */
  function exercicesDe(categorie) {
    return store.exercices()
      .filter((ex) => ex && ex.categorie === categorie && ex.archived !== true)
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' }));
  }

  function ligneExercice(ex) {
    return h('div', { class: 'anatomie-ligne' },
      h('span', { class: 'anatomie-dessin' }, icone(iconePourExercice(ex), { taille: 24 })),
      // Le nom OUVRE la progression de l'exercice : c'est la question qu'on se pose ici
      // (« et ou j'en suis, sur ce muscle ? »). Bouton et lien FRERES, jamais imbriques.
      h('button', {
        class: 'anatomie-nom muscles-vers-progression',
        type: 'button',
        dataset: { action: 'progression', id: ex.id }
      }, ex.nom),
      h('a', {
        class: 'anatomie-video',
        // v11 : un lien video POSE sur l'exercice (videoUrl) prime ; la recherche reste le repli.
        href: (typeof ex.videoUrl === 'string' && ex.videoUrl)
          ? ex.videoUrl
          : 'https://www.youtube.com/results?search_query=' +
            encodeURIComponent((ex.nom || '') + ' musculation technique'),
        target: '_blank',
        rel: 'noopener',
        'aria-label': 'Vidéo : ' + (ex.nom || 'exercice')
      }, icone('lecture', { taille: 18 })));
  }

  function choisir(categorie) {
    groupeChoisi = categorie;
    marquer(categorie);

    const fiche = infoMuscle(categorie);
    vider(detail);
    detail.hidden = false;

    detail.appendChild(h('h2', { class: 'anatomie-titre' },
      LIBELLES_CATEGORIES[categorie] || fiche.nom));
    detail.appendChild(h('p', { class: 'muscles-role' }, fiche.role));
    detail.appendChild(h('p', { class: 'muscles-conseil' }, fiche.conseil));

    const exs = exercicesDe(categorie);
    if (!exs.length) {
      detail.appendChild(h('p', { class: 'anatomie-vide' },
        'Aucun exercice de ce groupe dans le catalogue pour l\'instant.'));
      return;
    }
    detail.appendChild(h('h3', { class: 'muscles-sous-titre' },
      exs.length + (exs.length > 1 ? ' exercices' : ' exercice')));
    for (const ex of exs) detail.appendChild(ligneExercice(ex));

    // La fiche vient d'apparaitre sous la silhouette : on l'amene en vue, sans animation
    // (le defilement instantane respecte prefers-reduced-motion par construction).
    detail.scrollIntoView({ block: 'nearest' });
  }

  // ── Delegation : un seul ecouteur pour la vue ───────────────────────────────
  const off = delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    if (action === 'progression') {
      ev.preventDefault();
      const id = cible.getAttribute('data-id');
      if (id) router.aller('#/progression/' + encodeURIComponent(id));
    }
  });

  // Un exercice cree ou archive pendant que la vue est ouverte : la liste du groupe choisi
  // est repeinte, rien d'autre ne bouge.
  const desabonner = [
    bus.on('store:commit', ({ type }) => {
      if (typeof type === 'string' && type.indexOf('exercice:') === 0 && groupeChoisi) {
        choisir(groupeChoisi);
      }
    })
  ];

  return {
    destroy() {
      off();
      for (const stop of desabonner) stop();
      desabonner.length = 0;
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    },
    onParams() {
      // Aucun parametre de route en v10 : le muscle choisi est un etat d'ecran, pas une adresse.
    }
  };
}

export default { mount };
