// views/modeles.js — ecran des ROUTINES. Routes #/modeles et #/modeles/:id.
//
// Une routine est un Modele cree par l'utilisateur ; un modele livre est un Modele fourni avec
// l'application. Meme type, meme magasin, meme snapshot au lancement d'une seance — seule leur
// ORIGINE differe (data/schema.js : origineModele / estRoutine), et avec elle UNE regle :
//
//   · une ROUTINE se SUPPRIME      -> commit 'routine:supprimer' (suppression dure assumee) ;
//   · un MODELE LIVRE s'ARCHIVE    -> commit 'modele:archiver'. Le supprimer serait de toute
//     facon vain (il resurgirait au prochain semis), et surtout l'archivage est REVERSIBLE.
//
// Cet ecran DIT cette regle plutot que de la cacher derriere un bouton absent : un bouton qui
// manque sans explication se lit comme un bug.
//
// ⚠ L'EDITION N'EST PAS ICI. Creer et modifier une routine passent par #/composer/routine, qui
//   est le seul editeur de l'application (un second editeur, c'est deux regles de validation qui
//   divergent au premier correctif). Cet ecran ne fait que LISTER, MONTRER, DUPLIQUER et
//   SUPPRIMER — et rediriger vers le compositeur pour tout le reste.
//
// ⚠ LA PHRASE LA PLUS IMPORTANTE de l'ecran est la garantie « modifier une routine ne change RIEN
//   a l'historique ». Sans elle, personne n'ose corriger son programme de peur de « fausser » ses
//   statistiques, la routine derive de la realite et devient inutile. La garantie technique, elle,
//   vient de schema.nouvelleSeance() qui copie le modele entier dans `modeleSnapshot` au
//   lancement de chaque seance.
//
// CONTRAT DE RENDU (zone B) : le DOM est construit UNE SEULE FOIS au montage. Les listes sont
// RECONCILIEES par cle — un noeud existant est conserve et mute, un noeud disparu retire, un
// noeud nouveau insere. Aucune fonction de re-rendu global, aucun innerHTML.

import { h, delegate } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatFr, formatDuree } from '../lib/num.js';
import * as store from '../data/store.js';
import { estRoutine, LIBELLES_MODES } from '../data/schema.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';
import { aller } from '../ui/router.js';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// Le compositeur est l'unique editeur de routines. Ces deux chemins sont le CONTRAT avec lui :
// sans id -> creation, avec `?id=` -> modification de la routine existante.
const ROUTE_COMPOSER = '#/composer/routine';
const routeEdition = (id) => ROUTE_COMPOSER + '?id=' + encodeURIComponent(id);

// ─────────────────────────────────────────────────────────────────────────────
// Lectures derivees
// ─────────────────────────────────────────────────────────────────────────────

function nomExercice(exerciceId) {
  const ex = store.exercice(exerciceId);
  return ex ? ex.nom : 'Exercice inconnu';
}

/**
 * Icone d'un modele : celle de son PREMIER exercice.
 * Resolue par l'id de l'exercice et jamais par le nom du modele — les ids du catalogue sont figes
 * a vie, les libelles se corrigent.
 */
function iconeDuModele(modele) {
  for (const item of (modele && modele.items) || []) {
    if (!item || !item.exerciceId) continue;
    const ex = store.exercice(item.exerciceId);
    if (ex) return iconePourExercice(ex);
  }
  return 'exercice';
}

/** « 5 exercices · 18 séries · ≈ 60 min ». Une ligne, jamais deux. */
function resumeModele(modele) {
  const items = (modele && modele.items) || [];
  const bouts = [items.length + (items.length > 1 ? ' exercices' : ' exercice')];
  const series = items.reduce((t, it) => t + (estNombre(it && it.seriesCibles) ? it.seriesCibles : 0), 0);
  if (series > 0) bouts.push(series + ' séries');
  if (estNombre(modele && modele.dureeEstimeeMin) && modele.dureeEstimeeMin > 0) {
    bouts.push('≈ ' + modele.dureeEstimeeMin + ' min');
  }
  return bouts.join(' · ');
}

/**
 * Resume d'un item, en une ligne.
 * ⚠ Les repetitions s'affichent TOUJOURS en fourchette (« 6 à 8 »), jamais en entier seul : un
 *   entier se lit comme un ordre rate des qu'on en fait un de moins.
 */
function resumeItem(item) {
  const bouts = [];
  const series = estNombre(item.seriesCibles) ? item.seriesCibles : 0;
  bouts.push(series + (series > 1 ? ' séries' : ' série'));
  if (estNombre(item.seriesEchauffement) && item.seriesEchauffement > 0) {
    bouts.push('+ ' + item.seriesEchauffement + ' échauff.');
  }
  if (item.repsCibles && (estNombre(item.repsCibles.min) || estNombre(item.repsCibles.max))) {
    const min = estNombre(item.repsCibles.min) ? item.repsCibles.min : item.repsCibles.max;
    const max = estNombre(item.repsCibles.max) ? item.repsCibles.max : item.repsCibles.min;
    bouts.push(min === max ? min + ' répétitions' : min + ' à ' + max + ' répétitions');
  }
  if (estNombre(item.dureeCibleSec) && item.dureeCibleSec > 0) bouts.push(formatDuree(item.dureeCibleSec));
  if (estNombre(item.distanceCibleM) && item.distanceCibleM > 0) bouts.push(formatFr(item.distanceCibleM) + ' m');
  if (estNombre(item.reposSec)) bouts.push('repos ' + formatDuree(item.reposSec));
  // La charge n'est mentionnee que lorsqu'elle est FIGEE : c'est l'exception, et c'est elle
  // qu'il faut voir sans ouvrir l'item.
  if (item.chargeCible && item.chargeCible.type === 'fixe' && estNombre(item.chargeCible.kg)) {
    bouts.push('charge figée à ' + formatFr(item.chargeCible.kg) + ' kg');
  }
  if (item.note) bouts.push(item.note);
  return bouts.join(' · ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation d'une liste par cle
// ─────────────────────────────────────────────────────────────────────────────
// Ni vider() ni reconstruction : reconstruire perdrait le focus du bouton qu'on vient de taper,
// et la position de defilement de la liste.
function reconcilier(hote, cles, index, fabriquer, mettreAJour) {
  const voulues = new Set(cles);
  for (const [cle, noeud] of Array.from(index.entries())) {
    if (voulues.has(cle)) continue;
    if (noeud.parentNode === hote) hote.removeChild(noeud);
    index.delete(cle);
  }
  let position = 0;
  for (const cle of cles) {
    let noeud = index.get(cle);
    if (!noeud) {
      noeud = fabriquer(cle);
      if (!noeud) continue;
      index.set(cle, noeud);
    } else if (mettreAJour) {
      mettreAJour(cle, noeud);
    }
    const actuel = hote.children[position];
    if (actuel !== noeud) hote.insertBefore(noeud, actuel || null);
    position += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bandeau de garantie — present sur LES DEUX ecrans
// ─────────────────────────────────────────────────────────────────────────────

function bandeauGarantie() {
  return h('div', { class: 'bandeau-garantie' },
    icone('coche', { taille: 22, classe: 'garantie-icone' }),
    h('p', { class: 'garantie-texte' },
      h('strong', {}, 'Modifier une routine ne change rien à l’historique.'),
      ' Chaque séance déjà enregistrée garde sa propre copie du programme, telle qu’elle était ' +
      'le jour où tu l’as lancée.')
  );
}

/** Commit protege : un enchainement de taps ne doit produire qu'une seule ecriture. */
function fabriquerCommetteur() {
  let occupe = false;
  return async function commettre(type, payload, message) {
    if (occupe) return null;
    occupe = true;
    try {
      const resultat = await store.commit(type, payload);
      if (message) toast.afficher(message);
      return resultat;
    } catch (err) {
      console.error('[routines] ' + type + ' en échec', err);
      // ⚠ Le message du store est AFFICHE tel quel : c'est lui qui explique qu'un modele livre
      //   s'archive au lieu de se supprimer. Le remplacer par « erreur » perdrait la seule
      //   explication utile.
      toast.afficher(err && err.message ? err.message : 'Action impossible.');
      return null;
    } finally {
      occupe = false;
    }
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Ecran 1 — liste (#/modeles)
// ═════════════════════════════════════════════════════════════════════════════

function monterListe(conteneur) {
  const desabos = [];
  const commettre = fabriquerCommetteur();
  // ⚠ DEUX index, un par liste. Un index partage ferait supprimer de la table les noeuds de
  //   l'autre liste a chaque reconciliation (ils sont absents des cles voulues), et les deux
  //   listes se reconstruiraient integralement a chaque ecriture.
  const noeudsRoutines = new Map();
  const noeudsLivres = new Map();
  let feuille = null;
  let montrerArchives = false;

  const listeRoutines = h('div', { class: 'grille-routines', role: 'list' });
  const listeLivres = h('div', { class: 'grille-routines', role: 'list' });

  const videRoutines = h('div', { class: 'etat-vide etat-vide-routines', hidden: true },
    icone('plus', { taille: 34, classe: 'etat-vide-icone' }),
    h('p', { class: 'etat-vide-titre' }, 'Aucune routine'),
    h('p', { class: 'etat-vide-texte' },
      'Compose la tienne, ou duplique un modèle livré ci-dessous pour partir d’une base.')
  );

  const boutonArchives = h('button', {
    type: 'button', class: 'bouton bouton-fantome', 'data-action': 'basculer-archives'
  }, 'Afficher les archivés');

  const blocRoutines = h('section', { class: 'bloc-routines' },
    h('h2', { class: 'section-titre' },
      icone('crayon', { taille: 20, classe: 'section-titre-icone' }),
      h('span', {}, 'Mes routines')
    ),
    listeRoutines,
    videRoutines
  );

  const blocLivres = h('section', { class: 'bloc-modeles-livres' },
    h('h2', { class: 'section-titre' },
      icone('telecharger', { taille: 20, classe: 'section-titre-icone' }),
      h('span', {}, 'Modèles livrés')
    ),
    h('p', { class: 'note-discrete' },
      'Duplique-en un pour en faire ta routine : tu pourras ensuite la modifier librement. ' +
      'Un modèle livré ne se supprime pas — il s’archive, et revient quand tu veux.'),
    listeLivres
  );

  const racine = h('section', { class: 'vue vue-routines' },
    bandeauGarantie(),
    h('button', {
      type: 'button', class: 'bouton bouton-primaire bouton-large action-nouvelle-routine',
      'data-action': 'nouvelle'
    },
      icone('plus', { taille: 22 }),
      h('span', {}, 'Nouvelle routine')
    ),
    blocRoutines,
    blocLivres,
    h('div', { class: 'bandeau-archives' }, boutonArchives)
  );

  // ── Une carte par modele ───────────────────────────────────────────────────

  function carte(id) {
    const modele = store.modele(id);
    if (!modele) return null;
    const routine = estRoutine(modele);

    const nom = h('span', { class: 'carte-routine-nom' });
    const resume = h('span', { class: 'carte-routine-resume' });
    const pastilles = h('span', { class: 'carte-routine-pastilles' });

    // Le corps entier est un bouton : un tap ouvre la fiche. Le menu est POSE A COTE et non
    // dedans — un bouton dans un bouton est du HTML invalide, et le navigateur y decide seul
    // lequel recoit le clic.
    const corps = h('button', {
      type: 'button',
      class: 'carte-routine-corps',
      dataset: { action: 'ouvrir', id }
    },
      h('span', { class: 'carte-routine-icone' }, icone(iconeDuModele(modele), { taille: 30 })),
      h('span', { class: 'carte-routine-textes' }, nom, resume, pastilles)
    );

    const actions = h('div', { class: 'carte-routine-actions' },
      // ⚠ Le coeur BASCULE favori (commit 'routine:modifier') : il n'existe que sur les routines
      //   utilisateur. L'etat allume/eteint passe par data-favori, mute par majCarte — jamais
      //   par une reconstruction de la barre d'actions.
      routine
        ? h('button', {
            type: 'button', class: 'bouton-icone bouton-favori',
            dataset: { action: 'favori', id }
          }, icone('coeur', { taille: 20, titre: 'Favori' }))
        : null,
      routine
        ? h('button', {
            type: 'button', class: 'bouton-icone',
            dataset: { action: 'modifier', id }
          }, icone('crayon', { taille: 20, titre: 'Modifier' }))
        : null,
      h('button', {
        type: 'button', class: 'bouton-icone',
        dataset: { action: 'dupliquer', id }
      }, icone('plus', { taille: 20, titre: 'Dupliquer' })),
      // ⚠ Une ROUTINE se supprime, un MODELE LIVRE s'archive. Les deux boutons d'archivage sont
      //   construits d'avance et bascules par `hidden` : reconstruire la barre d'actions apres un
      //   archivage retirerait sous le doigt le bouton qu'on vient de taper.
      routine
        ? h('button', {
            type: 'button', class: 'bouton-icone bouton-icone-danger',
            dataset: { action: 'supprimer', id }
          }, icone('poubelle', { taille: 20, titre: 'Supprimer' }))
        : null,
      routine ? null : h('button', {
        type: 'button', class: 'bouton-icone', hidden: true,
        dataset: { action: 'archiver', id }
      }, icone('croix', { taille: 20, titre: 'Archiver' })),
      routine ? null : h('button', {
        type: 'button', class: 'bouton-icone', hidden: true,
        dataset: { action: 'restaurer', id }
      }, icone('coche', { taille: 20, titre: 'Restaurer' }))
    );

    const noeud = h('article', {
      class: 'carte-routine', role: 'listitem',
      dataset: { id, origine: routine ? 'utilisateur' : 'livre' }
    }, corps, actions);

    noeud._nom = nom;
    noeud._resume = resume;
    noeud._pastilles = pastilles;
    noeud._archiver = actions.querySelector('[data-action="archiver"]');
    noeud._restaurer = actions.querySelector('[data-action="restaurer"]');
    noeud._favori = actions.querySelector('[data-action="favori"]');
    majCarte(id, noeud);
    return noeud;
  }

  function majCarte(id, noeud) {
    const modele = store.modele(id);
    if (!modele) return;
    noeud._nom.textContent = modele.nom || 'Sans nom';
    noeud._resume.textContent = resumeModele(modele);

    while (noeud._pastilles.firstChild) noeud._pastilles.removeChild(noeud._pastilles.firstChild);
    if (!estRoutine(modele)) {
      noeud._pastilles.appendChild(h('span', { class: 'pastille-origine' }, 'Livré'));
    }
    if (modele.archived === true) {
      noeud._pastilles.appendChild(h('span', { class: 'pastille-archive' }, 'Archivé'));
    }
    const archive = modele.archived === true;
    noeud.setAttribute('data-archive', archive ? 'oui' : 'non');
    if (noeud._archiver) noeud._archiver.hidden = archive;
    if (noeud._restaurer) noeud._restaurer.hidden = !archive;
    if (noeud._favori) {
      const fav = modele.favori === true;
      noeud._favori.setAttribute('data-favori', fav ? 'oui' : 'non');
      noeud._favori.setAttribute('aria-pressed', fav ? 'true' : 'false');
    }
  }

  function remplir() {
    const tous = store.modeles().filter((m) => m && (montrerArchives || m.archived !== true));
    const routines = tous.filter(estRoutine).map((m) => m.id);
    const livres = tous.filter((m) => !estRoutine(m)).map((m) => m.id);

    reconcilier(listeRoutines, routines, noeudsRoutines, carte, majCarte);
    reconcilier(listeLivres, livres, noeudsLivres, carte, majCarte);

    videRoutines.hidden = routines.length > 0;
    blocLivres.hidden = livres.length === 0;
  }

  // ── Suppression d'une routine : dure, donc confirmee UNE fois ──────────────
  //
  // ⚠ On ne propose PAS d'annulation par toast : la suppression est immediate en base, et un
  //   « Annuler » qui recreerait la routine sous un NOUVEL id la ferait disparaitre de toutes les
  //   seances qui la referencent par modeleId. La confirmation prealable est le bon palier.

  function confirmerSuppression(modele) {
    feuille = sheet.ouvrir({
      titre: 'Supprimer « ' + (modele.nom || 'Sans nom') + ' » ?',
      fermable: false,
      contenu: [
        h('p', {}, 'La routine est supprimée définitivement.'),
        h('p', { class: 'note-discrete' },
          'Tes séances déjà faites ne bougent pas d’un pouce : chacune garde sa propre copie du ' +
          'programme. Supprimer la routine ne retire rien à ton historique.')
      ],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Supprimer',
          variante: 'danger',
          action: () => { commettre('routine:supprimer', { id: modele.id }, 'Routine supprimée'); }
        }
      ],
      onFermer: () => { feuille = null; }
    });
  }

  // ── Delegation : UN seul ecouteur click ───────────────────────────────────

  desabos.push(delegate(racine, 'click', '[data-action]', async (ev, cible) => {
    const action = cible.getAttribute('data-action');
    const id = cible.getAttribute('data-id');

    if (action === 'basculer-archives') {
      montrerArchives = !montrerArchives;
      boutonArchives.textContent = montrerArchives ? 'Masquer les archivés' : 'Afficher les archivés';
      remplir();
      return;
    }

    // Creation et modification : le compositeur, jamais un editeur local.
    if (action === 'nouvelle') { aller(ROUTE_COMPOSER); return; }
    if (action === 'modifier') { if (id) aller(routeEdition(id)); return; }
    if (action === 'ouvrir') { if (id) aller('#/modeles/' + encodeURIComponent(id)); return; }

    if (action === 'dupliquer') {
      // ⚠ 'routine:dupliquer' produit TOUJOURS une routine utilisateur, meme a partir d'un modele
      //   livre : c'est le geste par lequel « les modeles livres » deviennent « mes séances ».
      const resultat = await commettre('routine:dupliquer', { id }, 'Routine créée à partir du modèle');
      const creee = resultat && (resultat.routine || resultat.modele);
      // On n'ouvre l'edition qu'apres une ecriture REUSSIE : ouvrir une routine absente de la base
      // afficherait un ecran vide au premier rechargement.
      if (creee) aller(routeEdition(creee.id));
      return;
    }

    if (action === 'favori') {
      // Bascule favori sur une ROUTINE utilisateur. 'routine:modifier' preserve l'origine et
      // laisse passer le champ favori tel quel.
      const modele = store.modele(id);
      if (!modele || !estRoutine(modele)) return;
      const vers = modele.favori !== true;
      await commettre('routine:modifier',
        { routine: Object.assign({}, modele, { favori: vers }) },
        vers ? 'Ajoutée aux favoris' : 'Retirée des favoris');
      return;
    }

    if (action === 'supprimer') {
      const modele = store.modele(id);
      if (modele) confirmerSuppression(modele);
      return;
    }

    if (action === 'archiver') {
      await commettre('modele:archiver', { id, archived: true }, 'Modèle archivé');
      return;
    }

    if (action === 'restaurer') {
      await commettre('modele:archiver', { id, archived: false }, 'Modèle restauré');
    }
  }));

  // Le store notifie toute ecriture, d'ou qu'elle vienne : du compositeur, d'un import, d'ici.
  desabos.push(bus.on('store:commit', ({ type }) => {
    if (typeof type !== 'string') return;
    if (type.indexOf('modele:') === 0 || type.indexOf('routine:') === 0) remplir();
  }));

  remplir();
  conteneur.appendChild(racine);

  return {
    onParams() { /* la liste n'a aucun parametre */ },
    destroy() {
      for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
      desabos.length = 0;
      if (feuille && typeof feuille.fermer === 'function') {
        try { feuille.fermer(); } catch (_) { /* deja fermee */ }
      }
      feuille = null;
      noeudsRoutines.clear();
      noeudsLivres.clear();
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    }
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Ecran 2 — fiche d'une routine (#/modeles/:id)
// ═════════════════════════════════════════════════════════════════════════════
//
// LECTURE SEULE, assumee. Tout ce qui modifie le contenu part vers #/composer/routine. Cet ecran
// repond a « qu'est-ce qu'il y a dedans ? » — et cette question se pose une fois par routine,
// alors que l'edition se fait dans un ecran concu pour elle.

function monterFiche(conteneur, params) {
  const desabos = [];
  const commettre = fabriquerCommetteur();
  const noeuds = new Map();
  let feuille = null;

  const id = (params && params.id) || null;
  const source = id ? store.modele(id) : null;

  if (!source) {
    const absent = h('section', { class: 'vue vue-routines' },
      h('div', { class: 'etat-vide' },
        icone('avertissement', { taille: 34, classe: 'etat-vide-icone' }),
        h('p', { class: 'etat-vide-titre' }, 'Routine introuvable'),
        h('p', { class: 'etat-vide-texte' }, 'Elle a peut-être été supprimée, ici ou sur un autre appareil.'),
        h('p', {}, h('a', { class: 'bouton', href: '#/modeles' }, 'Revenir aux routines'))
      )
    );
    conteneur.appendChild(absent);
    return {
      onParams() {},
      destroy() { if (absent.parentNode) absent.parentNode.removeChild(absent); }
    };
  }

  const routine = estRoutine(source);

  const titre = h('h2', { class: 'fiche-titre' });
  const sousTitre = h('p', { class: 'fiche-resume' });
  const description = h('p', { class: 'fiche-description', hidden: true });
  const pastilles = h('div', { class: 'fiche-pastilles' });
  const iconeFiche = h('div', { class: 'fiche-icone' });

  const entete = h('header', { class: 'fiche-entete' },
    iconeFiche,
    h('div', { class: 'fiche-textes' }, titre, sousTitre, pastilles)
  );

  const listeItems = h('ol', { class: 'liste-items-routine' });
  const videItems = h('div', { class: 'etat-vide', hidden: true },
    icone('plus', { taille: 30, classe: 'etat-vide-icone' }),
    h('p', { class: 'etat-vide-titre' }, 'Aucun exercice'),
    h('p', { class: 'etat-vide-texte' }, 'Ajoute-les dans l’ordre où tu les fais.')
  );

  function noeudItem(cle) {
    const modele = store.modele(id);
    const item = ((modele && modele.items) || []).find((it) => it && it.id === cle);
    if (!item) return null;
    const exercice = store.exercice(item.exerciceId);
    return h('li', { class: 'item-routine', dataset: { id: cle } },
      h('span', { class: 'item-routine-icone' },
        icone(exercice ? iconePourExercice(exercice) : 'exercice', { taille: 24 })),
      h('span', { class: 'item-routine-textes' },
        h('span', { class: 'item-routine-nom' }, nomExercice(item.exerciceId)),
        h('span', { class: 'item-routine-resume' }, resumeItem(item)),
        exercice
          ? h('span', { class: 'item-routine-mode' }, LIBELLES_MODES[exercice.mode] || exercice.mode)
          : null
      )
    );
  }

  function majFiche() {
    const modele = store.modele(id);
    if (!modele) { aller('#/modeles'); return; }

    titre.textContent = modele.nom || 'Sans nom';
    sousTitre.textContent = resumeModele(modele);

    description.hidden = !modele.description;
    if (modele.description) description.textContent = modele.description;

    while (iconeFiche.firstChild) iconeFiche.removeChild(iconeFiche.firstChild);
    iconeFiche.appendChild(icone(iconeDuModele(modele), { taille: 40 }));

    while (pastilles.firstChild) pastilles.removeChild(pastilles.firstChild);
    pastilles.appendChild(h('span', {
      class: estRoutine(modele) ? 'pastille-origine pastille-routine' : 'pastille-origine'
    }, estRoutine(modele) ? 'Ma routine' : 'Modèle livré'));
    if (modele.archived === true) {
      pastilles.appendChild(h('span', { class: 'pastille-archive' }, 'Archivé'));
    }

    const cles = ((modele.items) || []).map((it) => it && it.id).filter(Boolean);
    reconcilier(listeItems, cles, noeuds, noeudItem, null);
    videItems.hidden = cles.length > 0;

    boutonArchiver.textContent = modele.archived === true ? 'Restaurer ce modèle' : 'Archiver ce modèle';
  }

  // ── Zone d'actions ─────────────────────────────────────────────────────────

  const boutonArchiver = h('button', {
    type: 'button', class: 'bouton', 'data-action': 'basculer-archive'
  }, 'Archiver ce modèle');

  // ⚠ La regle est ECRITE, pas seulement appliquee : un bouton « Supprimer » absent sans
  //   explication se lit comme un bug, pas comme une protection.
  const zoneActions = h('div', { class: 'zone-actions-routine' },
    h('div', { class: 'bandeau-actions' },
      routine
        ? h('button', { type: 'button', class: 'bouton bouton-primaire', 'data-action': 'modifier' },
            icone('crayon', { taille: 20 }), h('span', {}, 'Modifier'))
        : null,
      h('button', {
        type: 'button',
        class: ['bouton', routine ? null : 'bouton-primaire'],
        'data-action': 'dupliquer'
      }, icone('plus', { taille: 20 }), h('span', {}, routine ? 'Dupliquer' : 'En faire ma routine')),
      routine
        ? h('button', { type: 'button', class: 'bouton bouton-danger', 'data-action': 'supprimer' },
            icone('poubelle', { taille: 20 }), h('span', {}, 'Supprimer'))
        : boutonArchiver
    ),
    h('p', { class: 'note-discrete' },
      routine
        ? 'Supprimer une routine est définitif — mais sans aucun effet sur tes séances passées, ' +
          'qui en gardent chacune une copie.'
        : 'Ce modèle est livré avec l’application : il ne se supprime pas, il s’archive. ' +
          'Duplique-le pour obtenir une routine que tu pourras modifier et supprimer librement.')
  );

  const racine = h('section', { class: 'vue vue-routines vue-fiche-routine' },
    h('p', {}, h('a', { class: 'lien-retour', href: '#/modeles' },
      icone('chevron-droit', { taille: 16, classe: 'lien-retour-icone' }),
      h('span', {}, 'Toutes les routines'))),
    entete,
    description,
    bandeauGarantie(),
    h('h3', { class: 'section-titre' },
      icone('halteres', { taille: 20, classe: 'section-titre-icone' }),
      h('span', {}, 'Exercices')
    ),
    listeItems,
    videItems,
    zoneActions
  );

  function confirmerSuppression() {
    const modele = store.modele(id);
    if (!modele) return;
    feuille = sheet.ouvrir({
      titre: 'Supprimer « ' + (modele.nom || 'Sans nom') + ' » ?',
      fermable: false,
      contenu: [
        h('p', {}, 'La routine est supprimée définitivement.'),
        h('p', { class: 'note-discrete' },
          'Tes séances déjà faites ne bougent pas : chacune garde sa propre copie du programme. ' +
          'Supprimer la routine ne retire rien à ton historique.')
      ],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Supprimer',
          variante: 'danger',
          action: async () => {
            const ok = await commettre('routine:supprimer', { id }, 'Routine supprimée');
            if (ok) aller('#/modeles');
          }
        }
      ],
      onFermer: () => { feuille = null; }
    });
  }

  desabos.push(delegate(racine, 'click', '[data-action]', async (ev, cible) => {
    const action = cible.getAttribute('data-action');

    if (action === 'modifier') { aller(routeEdition(id)); return; }

    if (action === 'dupliquer') {
      const resultat = await commettre('routine:dupliquer', { id }, 'Routine créée');
      const creee = resultat && (resultat.routine || resultat.modele);
      if (creee) aller(routeEdition(creee.id));
      return;
    }

    if (action === 'supprimer') { confirmerSuppression(); return; }

    if (action === 'basculer-archive') {
      const modele = store.modele(id);
      if (!modele) return;
      const vers = modele.archived !== true;
      await commettre('modele:archiver', { id, archived: vers }, vers ? 'Modèle archivé' : 'Modèle restauré');
    }
  }));

  desabos.push(bus.on('store:commit', ({ type }) => {
    if (typeof type !== 'string') return;
    if (type.indexOf('modele:') === 0 || type.indexOf('routine:') === 0) {
      // La suppression de CETTE routine renvoie a la liste : rester sur une fiche vide n'a
      // aucun sens, et rien ne permettrait d'en sortir sans le lien de retour.
      if (!store.modele(id)) { aller('#/modeles'); return; }
      majFiche();
    }
  }));

  majFiche();
  conteneur.appendChild(racine);

  return {
    onParams() { /* le changement d'id est traite par l'enveloppe de mount() */ },
    destroy() {
      for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
      desabos.length = 0;
      if (feuille && typeof feuille.fermer === 'function') {
        try { feuille.fermer(); } catch (_) { /* deja fermee */ }
      }
      feuille = null;
      noeuds.clear();
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    }
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Point d'entree du routeur
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param {Element} conteneur zone B (le <main> d'index.html)
 * @param {Object} params params de route ; `id` present sur #/modeles/:id
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur, params) {
  // Les deux routes partagent ce module mais PAS la meme cle de route : le routeur remonte de
  // lui-meme en passant de #/modeles a #/modeles/:id. Le seul cas ou il ne le fait pas est le
  // passage d'une routine a une autre (meme cle, id different) : cette enveloppe s'en charge, en
  // demontant proprement l'instance courante avant d'en monter une neuve. Chaque instance
  // construit donc son DOM une seule fois, conformement au contrat de rendu.
  let idCourant = (params && params.id) || null;
  let interne = idCourant ? monterFiche(conteneur, params) : monterListe(conteneur);

  const appeler = (methode, arg) => {
    if (!interne || typeof interne[methode] !== 'function') return;
    try { interne[methode](arg); }
    catch (err) { console.error('[routines] ' + methode + '() en échec', err); }
  };

  return {
    onParams(p) {
      const suivant = (p && p.id) || null;
      if (suivant === idCourant) { appeler('onParams', p); return; }
      idCourant = suivant;
      appeler('destroy');
      interne = suivant ? monterFiche(conteneur, p) : monterListe(conteneur);
    },
    destroy() {
      appeler('destroy');
      interne = null;
    }
  };
}

export default { mount };
