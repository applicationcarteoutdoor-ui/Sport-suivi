// views/exercices.js — routes #/exercices et #/exercices/:id
//
// CONTRAT DE RENDU (zone B). La vue construit son DOM UNE fois au montage. Il n'existe aucune
// fonction rerender() : enregistrer une modification mute le textContent des <dd> concernes et
// rien d'autre. Le seul sous-arbre reconstruit est la LISTE d'exercices, dont cette vue est la
// proprietaire exclusive — et elle est reconstruite hors du champ de recherche, qui garde donc
// son focus et son curseur pendant la frappe.
//
// Deux ecrans, un seul module :
//   #/exercices      liste (catalogue livre + personnalises + archives masquees par defaut)
//   #/exercices/:id  fiche complete d'un exercice
// Les deux cles de route etant distinctes, le routeur demonte l'une pour monter l'autre : chaque
// fonction de montage rend son propre { destroy, onParams }.
//
// Trois regles produit portees par ce fichier :
//   1. ARCHIVER, JAMAIS SUPPRIMER. Des seances de 2023 referencent cet identifiant a vie. Une
//      suppression dure ferait perdre le mode gele de leurs entrees, donc l'interpretation de
//      leurs series. L'interface le dit explicitement, elle ne se contente pas de l'appliquer.
//   2. LE CHANGEMENT DE MODE est regi par schema.transitionPermise. Un refus n'est jamais un
//      cul-de-sac : il propose de creer un nouvel exercice, qui est la vraie reponse au besoin.
//   3. FUSIONNER est une fonctionnalite de la v1, pas « plus tard ». Le doublon personnalise
//      arrive toujours, et sans fusion la courbe de progression est scindee definitivement.
//
// Toute modification passe par store.commit() et marque userModified, ce qui interdit a la
// synchronisation du catalogue livre d'ecraser la valeur au prochain demarrage.

import { h, on, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatFr, parseFr, formatDuree } from '../lib/num.js';
import * as store from '../data/store.js';
import {
  MODES, NOMS_MODES, LIBELLES_MODES, CATEGORIES, LIBELLES_CATEGORIES,
  MATERIELS, LIBELLES_MATERIELS, LIBELLES_METRIQUES,
  nouvelExercice, transitionPermise
} from '../data/schema.js';
import * as router from '../ui/router.js';
import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';

// ─────────────────────────────────────────────────────────────────────────────
// Recherche insensible aux accents et a la casse
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ Sans normalize('NFD') + suppression des diacritiques, « developpe » ne trouve JAMAIS
//   « Développé couché » : c'est la requete la plus naturelle au clavier d'un telephone, ou
//   personne ne compose les accents. La ponctuation devient une espace pour que « pull-up » et
//   « pull up » soient la meme chose.
// Bloc Unicode « Combining Diacritical Marks », ecrit en echappements et non en caracteres
// litteraux pour que la regle survive a n'importe quel outil qui reencoderait le fichier.
const DIACRITIQUES = /[\u0300-\u036f]/g;

function normaliser(texte) {
  return String(texte == null ? '' : texte)
    .normalize('NFD')
    .replace(DIACRITIQUES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Index de recherche : nom + alias UNIQUEMENT. La categorie et le materiel en sont exclus
// volontairement — chercher « barre » ne doit pas remonter les douze exercices a la barre avant
// celui dont c'est le nom.
function indexer(ex) {
  return normaliser([ex.nom].concat(ex.alias || []).join(' '));
}

function correspond(index, mots) {
  for (const mot of mots) if (index.indexOf(mot) === -1) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires communs
// ─────────────────────────────────────────────────────────────────────────────

const estPerso = (ex) => String(ex && ex.id).startsWith('usr:');

function sousTitre(ex) {
  const bouts = [];
  if (ex.materiel && ex.materiel !== 'aucun') bouts.push(LIBELLES_MATERIELS[ex.materiel] || ex.materiel);
  bouts.push(LIBELLES_MODES[ex.mode] || ex.mode);
  if (ex.lestable) bouts.push('lestable');
  if (ex.unilateral) bouts.push('par côté');
  return bouts.join(' · ');
}

/**
 * Compte ce que la fusion et l'archivage devront affronter.
 * ⚠ Depend de l'historique complet : tant que 'historique:pret' n'a pas ete emis, ce compte est
 *   partiel et les actions destructrices restent desactivees. Annoncer « 0 séance concernée »
 *   avant la fin du chargement ferait fusionner a l'aveugle.
 */
function usage(exerciceId) {
  let seances = 0;
  let entrees = 0;
  let series = 0;
  let derniere = null;
  for (const s of store.seances()) {
    let touchee = false;
    for (const e of s.entrees || []) {
      if (e.exerciceId !== exerciceId) continue;
      touchee = true;
      entrees++;
      series += (e.series || []).length;
    }
    if (touchee) {
      seances++;
      if (!derniere || s.date > derniere) derniere = s.date;
    }
  }
  return { seances, entrees, series, derniere };
}

function pluriel(n, singulier, plurielMot) {
  return n + ' ' + (n > 1 ? (plurielMot || singulier + 's') : singulier);
}

// ⚠ Fermer une feuille remonte l'historique (history.back), ce qui est ASYNCHRONE. Naviguer dans
//   la foulee ferait courir les deux mouvements l'un contre l'autre : le retour arriverait apres
//   la navigation et ramenerait l'utilisateur sur l'ecran qu'il vient de quitter. On differe donc
//   d'un tour de boucle, une fois le hashchange de la fermeture consomme.
function naviguerApresFeuille(hash) {
  setTimeout(() => router.aller(hash), 0);
}

// Champ de saisie d'une feuille : rend { ligne, lire() }. Les feuilles de cette vue utilisent des
// <input> ordinaires — l'interdit « aucun <input> » du plan vise l'ecran de SEANCE, ou la saisie
// se fait entre deux series avec des mains moites ; ici on remplit un formulaire, une fois.
function champTexte(label, valeur, opts = {}) {
  const input = h('input', Object.assign({
    type: opts.type || 'text',
    class: 'champ-recherche',
    value: valeur == null ? '' : String(valeur),
    autocomplete: 'off',
    autocapitalize: opts.autocapitalize || 'sentences',
    spellcheck: 'false'
  }, opts.attrs || {}));
  const ligne = h('label', { class: 'ligne-reglage', style: { display: 'block', paddingTop: 'var(--esp-3)', paddingBottom: 'var(--esp-3)' } },
    h('div', { class: 'ligne-reglage-aide', style: { marginBottom: 'var(--esp-1)' } }, label),
    input,
    opts.aide ? h('div', { class: 'ligne-reglage-aide', style: { marginTop: 'var(--esp-1)' } }, opts.aide) : null
  );
  return { ligne, lire: () => input.value, element: input };
}

function champInterrupteur(label, actif, aide) {
  const input = h('input', { type: 'checkbox', checked: actif === true });
  const ligne = h('label', { class: 'ligne-reglage' },
    h('span', null,
      h('span', { class: 'ligne-liste-principal' }, label),
      aide ? h('br') : null,
      aide ? h('span', { class: 'ligne-reglage-aide' }, aide) : null
    ),
    input
  );
  return { ligne, lire: () => input.checked === true };
}

// Liste de choix exclusifs. Retenue plutot qu'un <select> : sur iOS, une roue de defilement a
// douze entrees se manipule mal a une main et masque le reste de la feuille.
function champChoix(valeurCourante, options) {
  const liste = h('div', { class: 'liste', role: 'radiogroup' });
  let choisie = valeurCourante;
  const boutons = new Map();
  for (const opt of options) {
    const btn = h('button', {
      type: 'button',
      class: 'ligne-liste',
      role: 'radio',
      disabled: opt.desactive === true,
      'aria-checked': opt.cle === valeurCourante ? 'true' : 'false'
    },
      h('span', null,
        h('span', { class: 'ligne-liste-principal' }, opt.libelle),
        opt.aide ? h('br') : null,
        opt.aide ? h('span', { class: 'ligne-liste-secondaire' }, opt.aide) : null
      ),
      h('span', { class: 'ligne-liste-secondaire', 'data-role': 'coche' }, opt.cle === valeurCourante ? '✓' : '')
    );
    on(btn, 'click', () => {
      if (opt.desactive === true) return;
      choisie = opt.cle;
      // Mutation ciblee : aucun noeud n'est remplace, seule la coche et aria-checked changent.
      for (const [cle, autre] of boutons) {
        const actif = cle === choisie;
        autre.setAttribute('aria-checked', actif ? 'true' : 'false');
        const coche = autre.querySelector('[data-role="coche"]');
        if (coche) coche.textContent = actif ? '✓' : '';
      }
    });
    boutons.set(opt.cle, btn);
    liste.appendChild(btn);
  }
  return { ligne: liste, lire: () => choisie };
}

/** Enregistre un exercice modifie. userModified passe a true : la synchronisation du catalogue
 *  livre ne pourra plus ecraser ces valeurs au prochain demarrage. */
async function enregistrer(ex, patch) {
  const maj = Object.assign({}, ex, patch, { userModified: true });
  const resultat = await store.commit('exercice:enregistrer', { exercice: maj });
  return resultat.exercice;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gestion des feuilles — une feuille est un PARAMETRE de la route, pas une route
// ─────────────────────────────────────────────────────────────────────────────
// L'ouverture pousse une entree d'historique : le bouton retour d'Android referme la feuille au
// lieu de quitter l'ecran. La vue n'est jamais demontee, onParams() suffit.

function gestionnaireFeuilles(construire) {
  let nom = null;
  let argument = null;
  let poignee = null;
  // ⚠ Le drapeau « fermeture voulue par nous » ne peut PAS etre une variable partagee levee puis
  //   rabaissee autour de poignee.fermer() : sheet.js differe son onFermer jusqu'a transitionend
  //   ou jusqu'a sa minuterie de sortie. Un drapeau rabaisse de facon synchrone serait deja
  //   retombe quand le rappel arrive enfin, et l'on effacerait `?sheet=…` — donc la feuille que
  //   l'on vient d'ouvrir. Chaque feuille porte donc SON etat, ferme sur son propre onFermer :
  //   il reste juste quel que soit le moment ou la fermeture est reellement consommee.
  let courante = null;

  function fermerCourante() {
    if (!poignee) return;
    const aFermer = poignee;
    if (courante) courante.ignorer = true;
    poignee = null;
    courante = null;
    nom = null;
    argument = null;
    try { aFermer.fermer(); } catch (err) { console.error('[exercices] fermeture de feuille en echec', err); }
  }

  function synchroniser(params) {
    const p = params || {};
    const demande = p.sheet || null;
    // `arg` distingue deux feuilles de meme nom : editer le nom puis la categorie passe par
    // sheet=champ&champ=nom puis sheet=champ&champ=categorie.
    const arg = p.champ || p.lieu || null;
    if (demande === nom && arg === argument) return;
    fermerCourante();
    if (!demande) return;
    nom = demande;
    argument = arg;
    const config = construire(demande, p);
    if (!config) { nom = null; argument = null; return; }
    // Etat propre a CETTE feuille. Pose avant l'ouverture : sheet.ouvrir ferme immediatement la
    // feuille precedente, dont le onFermer peut donc s'executer pendant cet appel.
    const etat = { ignorer: false };
    courante = etat;
    const poigneeOuverte = sheet.ouvrir(Object.assign({}, config, {
      onFermer() {
        // On ne remet a zero que si cette feuille est TOUJOURS la courante : une fermeture
        // consommee en retard ne doit pas effacer l'etat d'une feuille ouverte entre-temps.
        if (courante === etat) {
          poignee = null;
          courante = null;
          nom = null;
          argument = null;
        }
        // ⚠ Ne pas retirer `?sheet=…` quand c'est justement le changement de parametre qui a
        //   provoque la fermeture : on effacerait la feuille que l'on vient d'ouvrir.
        if (!etat.ignorer) router.fermerFeuille();
        if (typeof config.onFermer === 'function') config.onFermer();
      }
    }));
    // Affectation APRES l'ouverture : `poignee` ne doit jamais designer la feuille precedente
    // pendant que sheet.ouvrir la demonte.
    if (courante === etat) poignee = poigneeOuverte;
  }

  return { synchroniser, fermer: fermerCourante };
}

// ═════════════════════════════════════════════════════════════════════════════
// LISTE — #/exercices
// ═════════════════════════════════════════════════════════════════════════════

function monterListe(conteneur, params) {
  const desabonnements = [];
  let requete = '';
  let categorie = 'tout';
  let montrerArchives = false;

  const racine = h('div', { class: 'vue vue-exercices' });

  // ── Recherche ──────────────────────────────────────────────────────────────
  const champ = h('input', {
    type: 'search',
    class: 'champ-recherche',
    placeholder: 'Rechercher un exercice…',
    'aria-label': 'Rechercher un exercice par nom ou par alias',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'search'
  });
  // ⚠ Aucun focus automatique : ouvrir le clavier des l'apparition masquerait la liste elle-meme.
  racine.appendChild(h('div', { class: 'barre-recherche' }, champ));

  // ── Filtres de categorie ───────────────────────────────────────────────────
  const filtres = h('div', { class: 'filtres-categorie', role: 'tablist', 'aria-label': 'Filtrer par catégorie' });
  const boutonsFiltre = new Map();
  function ajouterFiltre(cle, libelle) {
    const btn = h('button', {
      type: 'button',
      class: 'segment',
      role: 'tab',
      'data-action': 'filtrer',
      'data-categorie': cle,
      'aria-selected': cle === 'tout' ? 'true' : 'false'
    }, libelle);
    boutonsFiltre.set(cle, btn);
    filtres.appendChild(btn);
  }
  ajouterFiltre('tout', 'Toutes');
  for (const cat of CATEGORIES) ajouterFiltre(cat, LIBELLES_CATEGORIES[cat] || cat);
  racine.appendChild(filtres);

  // ── Barre d'actions ────────────────────────────────────────────────────────
  const btnArchives = h('button', {
    type: 'button', class: 'bouton bouton-fantome', 'data-action': 'archives', 'aria-pressed': 'false'
  }, 'Afficher les archivés');

  racine.appendChild(h('div', { class: 'bandeau-actions', style: { padding: '0 var(--esp-3)' } },
    h('button', { type: 'button', class: 'bouton bouton-primaire', 'data-action': 'creer' }, 'Nouvel exercice'),
    btnArchives
  ));

  // ── Liste : SEUL sous-arbre reconstruit, et cette vue en est proprietaire ───
  const liste = h('div', { class: 'liste', 'aria-live': 'polite' });
  racine.appendChild(liste);

  const compteur = h('p', { class: 'ligne-reglage-aide', style: { padding: '0 var(--esp-4)' } }, '');
  racine.appendChild(compteur);

  conteneur.appendChild(racine);

  function ligneExercice(ex) {
    const marques = [];
    if (estPerso(ex)) marques.push('perso');
    if (ex.archived) marques.push('archivé');
    return h('button', {
      type: 'button',
      class: 'ligne-liste',
      'data-action': 'ouvrir',
      'data-id': ex.id,
      'data-archive': ex.archived ? 'oui' : null
    },
      h('span', null,
        h('span', { class: 'ligne-liste-principal' }, ex.nom || 'Sans nom'),
        h('br'),
        h('span', { class: 'ligne-liste-secondaire' }, sousTitre(ex))
      ),
      marques.length
        ? h('span', { class: 'pastille', 'data-ton': ex.archived ? 'alerte' : 'accent' }, marques.join(' · '))
        : h('span', { class: 'ligne-liste-secondaire' }, LIBELLES_CATEGORIES[ex.categorie] || '')
    );
  }

  function peindreListe() {
    vider(liste);
    const mots = normaliser(requete).split(' ').filter(Boolean);
    const actifs = [];
    const archives = [];

    for (const ex of store.exercices()) {
      if (categorie !== 'tout' && ex.categorie !== categorie) continue;
      if (mots.length && !correspond(indexer(ex), mots)) continue;
      if (ex.archived) archives.push(ex); else actifs.push(ex);
    }

    // Groupement par categorie, dans l'ordre du vocabulaire ferme et non alphabetique : c'est
    // l'ordre anatomique attendu, et il ne bouge pas quand un exercice est renomme.
    const parCategorie = new Map();
    for (const ex of actifs) {
      if (!parCategorie.has(ex.categorie)) parCategorie.set(ex.categorie, []);
      parCategorie.get(ex.categorie).push(ex);
    }
    for (const cat of CATEGORIES) {
      const groupe = parCategorie.get(cat);
      if (!groupe || !groupe.length) continue;
      liste.appendChild(h('h2', {
        class: 'section-titre',
        style: { padding: 'var(--esp-3) var(--esp-4) var(--esp-1)' }
      }, LIBELLES_CATEGORIES[cat] || cat));
      for (const ex of groupe) liste.appendChild(ligneExercice(ex));
    }

    if (montrerArchives && archives.length) {
      liste.appendChild(h('h2', {
        class: 'section-titre',
        style: { padding: 'var(--esp-4) var(--esp-4) var(--esp-1)' }
      }, 'Archivés'));
      for (const ex of archives) liste.appendChild(ligneExercice(ex));
    }

    if (!actifs.length && !(montrerArchives && archives.length)) {
      // Un etat vide sans issue est un ecran d'erreur deguise : il porte toujours une action.
      liste.appendChild(h('div', { class: 'etat-vide' },
        h('p', { class: 'etat-vide-titre' }, mots.length ? 'Aucun exercice trouvé' : 'Aucun exercice'),
        h('p', { class: 'etat-vide-texte' }, mots.length
          ? 'La recherche porte sur le nom et les alias. Essayez un mot plus court.'
          : 'Le catalogue livré aurait dû se charger au démarrage.'),
        h('button', { type: 'button', class: 'bouton bouton-primaire', 'data-action': 'creer' },
          mots.length ? 'Créer « ' + requete.trim() + ' »' : 'Nouvel exercice')
      ));
    }

    const total = actifs.length + (montrerArchives ? archives.length : 0);
    const restant = !montrerArchives && archives.length
      ? ' · ' + pluriel(archives.length, 'archivé', 'archivés') + ' masqué' + (archives.length > 1 ? 's' : '')
      : '';
    compteur.textContent = pluriel(total, 'exercice') + restant;
  }

  // ── Feuille de creation ────────────────────────────────────────────────────
  const feuilles = gestionnaireFeuilles((nom) => {
    if (nom !== 'creer') return null;
    return feuilleCreation(requete.trim());
  });

  function feuilleCreation(nomPropose) {
    const nom = champTexte('Nom', nomPropose, { attrs: { placeholder: 'Développé couché' } });
    const mode = champChoix('charge', NOMS_MODES.map((m) => ({
      cle: m, libelle: LIBELLES_MODES[m] || m, aide: MODES[m].saisie.join(' · ')
    })));
    const cat = champChoix('corps-entier', CATEGORIES.map((c) => ({
      cle: c, libelle: LIBELLES_CATEGORIES[c] || c
    })));
    const erreur = h('p', { class: 'avertissement', hidden: true }, '');

    return {
      titre: 'Nouvel exercice',
      contenu: [
        nom.ligne,
        h('h3', { class: 'section-titre', style: { padding: 'var(--esp-3) var(--esp-4) var(--esp-1)' } }, 'Mode de suivi'),
        mode.ligne,
        h('h3', { class: 'section-titre', style: { padding: 'var(--esp-3) var(--esp-4) var(--esp-1)' } }, 'Catégorie'),
        cat.ligne,
        erreur
      ],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Créer',
          variante: 'primaire',
          async action() {
            const valeur = nom.lire().trim();
            if (!valeur) {
              erreur.textContent = 'Le nom est obligatoire.';
              erreur.hidden = false;
              return false; // la feuille reste ouverte : la saisie n'est pas perdue
            }
            const ex = nouvelExercice({ nom: valeur, mode: mode.lire(), categorie: cat.lire(), userModified: true });
            try {
              await store.commit('exercice:enregistrer', { exercice: ex });
              toast.afficher('Exercice « ' + valeur + ' » créé');
              naviguerApresFeuille('#/exercices/' + encodeURIComponent(ex.id));
            } catch (err) {
              console.error('[exercices] création en échec', err);
              erreur.textContent = 'Enregistrement impossible : ' + err.message;
              erreur.hidden = false;
              return false;
            }
          }
        }
      ]
    };
  }

  // ── Delegation : UN seul ecouteur click pour toute la vue ───────────────────
  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    if (action === 'ouvrir') {
      router.aller('#/exercices/' + encodeURIComponent(cible.getAttribute('data-id')));
      return;
    }
    if (action === 'creer') { router.ouvrirFeuille('creer'); return; }
    if (action === 'filtrer') {
      categorie = cible.getAttribute('data-categorie');
      for (const [cle, btn] of boutonsFiltre) btn.setAttribute('aria-selected', cle === categorie ? 'true' : 'false');
      peindreListe();
      return;
    }
    if (action === 'archives') {
      montrerArchives = !montrerArchives;
      btnArchives.setAttribute('aria-pressed', montrerArchives ? 'true' : 'false');
      btnArchives.textContent = montrerArchives ? 'Masquer les archivés' : 'Afficher les archivés';
      peindreListe();
    }
  }));

  desabonnements.push(on(champ, 'input', () => { requete = champ.value; peindreListe(); }));

  // Le catalogue peut changer sous nos pieds : creation depuis le selecteur d'exercice, import,
  // archivage depuis une fiche. On repeint la liste, jamais la vue.
  desabonnements.push(bus.on('exercice:enregistrer', peindreListe));
  desabonnements.push(bus.on('exercice:archiver', peindreListe));

  peindreListe();
  feuilles.synchroniser(params);

  return {
    destroy() {
      feuilles.fermer();
      for (const off of desabonnements) { try { off(); } catch (_) { /* deja detache */ } }
      desabonnements.length = 0;
    },
    onParams(p) { feuilles.synchroniser(p); }
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// FICHE — #/exercices/:id
// ═════════════════════════════════════════════════════════════════════════════

function monterFiche(conteneur, params) {
  const desabonnements = [];
  const id = params && params.id ? params.id : null;
  let ex = id ? store.exercice(id) : null;

  if (!ex) {
    conteneur.appendChild(h('div', { class: 'vue vue-exercices' },
      h('div', { class: 'etat-vide' },
        h('p', { class: 'etat-vide-titre' }, 'Exercice introuvable'),
        h('p', { class: 'etat-vide-texte' }, 'Cet identifiant ne correspond à aucun exercice connu.'),
        h('a', { class: 'bouton bouton-primaire', href: '#/exercices' }, 'Retour à la liste')
      )
    ));
    return { destroy() {}, onParams() {} };
  }

  const racine = h('div', { class: 'vue vue-exercices' });

  // ── En-tete ────────────────────────────────────────────────────────────────
  const titre = h('div', { class: 'carte-modele-nom' }, ex.nom);
  const detail = h('div', { class: 'carte-modele-detail' }, sousTitre(ex));
  const pastilleArchive = h('span', { class: 'pastille', 'data-ton': 'alerte', hidden: !ex.archived }, 'Archivé');
  racine.appendChild(h('div', { class: 'carte', style: { margin: '0 var(--esp-3)' } },
    titre, detail, h('div', { style: { marginTop: 'var(--esp-2)' } }, pastilleArchive)
  ));

  // ── Bandeau d'usage : combien de seances referencent cet exercice ───────────
  const bandeauUsage = h('p', { class: 'ligne-reglage-aide', style: { padding: '0 var(--esp-4)' } },
    'Chargement de l\'historique…');

  racine.appendChild(bandeauUsage);

  // ── Fiche : une definition par ligne ───────────────────────────────────────
  // Chaque <dd> est memorise : enregistrer une modification mute son textContent, et rien
  // d'autre. Aucun noeud n'est remplace, la position de scroll est intacte.
  const valeurs = new Map();
  const dl = h('dl', { class: 'fiche-exercice' });

  function ajouterDefinition(cle, label, texte, champEditable) {
    const dd = h('dd', null, texte);
    valeurs.set(cle, dd);
    const dt = champEditable
      ? h('dt', null, h('button', {
          type: 'button',
          class: 'bouton-fantome',
          style: { padding: '0', minHeight: 'auto', textAlign: 'left' },
          'data-action': 'editer',
          'data-champ': cle
        }, label + ' ✎'))
      : h('dt', null, label);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function texteDe(cle) {
    switch (cle) {
      case 'nom': return ex.nom || '—';
      case 'alias': return (ex.alias && ex.alias.length) ? ex.alias.join(', ') : 'Aucun';
      case 'categorie': return LIBELLES_CATEGORIES[ex.categorie] || ex.categorie;
      case 'materiel': return LIBELLES_MATERIELS[ex.materiel] || ex.materiel;
      case 'mode': return LIBELLES_MODES[ex.mode] || ex.mode;
      case 'lestable': return ex.lestable ? 'Oui (lest signé : +10 kg, −20 kg d\'assistance)' : 'Non';
      case 'unilateral': return ex.unilateral ? 'Oui (tonnage compté double)' : 'Non';
      case 'incrementKg': return formatFr(ex.incrementKg) + ' kg';
      case 'bodyweightFactor': return formatFr(ex.bodyweightFactor);
      case 'reposParDefautSec': return formatDuree(ex.reposParDefautSec);
      case 'metriquePreferee': return ex.metriquePreferee
        ? (LIBELLES_METRIQUES[ex.metriquePreferee] || ex.metriquePreferee)
        : 'Automatique';
      case 'notes': return ex.notes || 'Aucune';
      default: return '—';
    }
  }

  ajouterDefinition('nom', 'Nom', texteDe('nom'), true);
  ajouterDefinition('alias', 'Alias', texteDe('alias'), true);
  ajouterDefinition('categorie', 'Catégorie', texteDe('categorie'), true);
  ajouterDefinition('materiel', 'Matériel', texteDe('materiel'), true);
  ajouterDefinition('mode', 'Mode de suivi', texteDe('mode'), true);
  ajouterDefinition('lestable', 'Lestable', texteDe('lestable'), true);
  ajouterDefinition('unilateral', 'Unilatéral', texteDe('unilateral'), true);
  ajouterDefinition('incrementKg', 'Incrément', texteDe('incrementKg'), true);
  ajouterDefinition('bodyweightFactor', 'Facteur poids du corps', texteDe('bodyweightFactor'), true);
  ajouterDefinition('reposParDefautSec', 'Repos par défaut', texteDe('reposParDefautSec'), true);
  ajouterDefinition('metriquePreferee', 'Métrique affichée', texteDe('metriquePreferee'), true);
  ajouterDefinition('notes', 'Notes', texteDe('notes'), true);

  racine.appendChild(h('h2', { class: 'section-titre', style: { padding: 'var(--esp-2) var(--esp-4) 0' } }, 'Réglages'));
  racine.appendChild(dl);

  const mentionUserModified = h('p', { class: 'ligne-reglage-aide', style: { padding: '0 var(--esp-4)' } }, '');
  racine.appendChild(mentionUserModified);

  // ── Profils machine, PAR LIEU ──────────────────────────────────────────────
  // ⚠ Le selecteur de lieu n'apparait que si plus d'un lieu existe : tant qu'il n'y en a qu'un,
  //   l'exposer serait un choix a faire pour une question qui ne se pose pas.
  const titreProfils = h('h2', { class: 'section-titre', style: { padding: 'var(--esp-2) var(--esp-4) 0' } }, 'Profils machine');
  const aideProfils = h('p', { class: 'ligne-reglage-aide', style: { padding: '0 var(--esp-4) var(--esp-2)' } },
    'Sans profil, la courbe reste en crans et les métriques en kilos sont marquées non fiables.');
  const listeProfils = h('div', { class: 'liste' });
  racine.appendChild(titreProfils);
  racine.appendChild(aideProfils);
  racine.appendChild(listeProfils);

  function peindreProfils() {
    const visible = ex.mode === 'machine';
    titreProfils.hidden = !visible;
    aideProfils.hidden = !visible;
    listeProfils.hidden = !visible;
    vider(listeProfils);
    if (!visible) return;

    const lieux = store.lieux().filter((l) => !l.archived);
    if (!lieux.length) {
      listeProfils.appendChild(h('div', { class: 'etat-vide' },
        h('p', { class: 'etat-vide-texte' },
          'Aucun lieu enregistré. Créez une salle dans les réglages pour convertir les crans en kilos.'),
        h('a', { class: 'bouton bouton-fantome', href: '#/reglages' }, 'Ouvrir les réglages')
      ));
      return;
    }
    const profils = ex.machineProfiles || {};
    for (const lieu of lieux) {
      const p = profils[lieu.id];
      listeProfils.appendChild(h('button', {
        type: 'button', class: 'ligne-liste', 'data-action': 'profil', 'data-lieu': lieu.id
      },
        h('span', null,
          // Un seul lieu : son nom reste affiche, mais il n'y a aucun choix a faire.
          h('span', { class: 'ligne-liste-principal' }, lieux.length > 1 ? lieu.nom : 'Profil de cette salle'),
          h('br'),
          h('span', { class: 'ligne-liste-secondaire' }, p
            ? formatFr(p.kgParPlaque) + ' kg par plaque · départ ' + formatFr(p.offsetKg) + ' kg'
            : 'Non renseigné')
        ),
        h('span', { class: 'ligne-liste-secondaire' }, '✎')
      ));
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const btnFusion = h('button', {
    type: 'button', class: 'bouton bouton-large', 'data-action': 'fusion', disabled: true
  }, 'Fusionner avec un autre exercice');

  racine.appendChild(h('h2', { class: 'section-titre', style: { padding: 'var(--esp-4) var(--esp-4) 0' } }, 'Actions'));
  racine.appendChild(h('div', { style: { padding: '0 var(--esp-3)' } },
    btnFusion,
    h('a', { class: 'bouton bouton-large', href: '#/progression/' + encodeURIComponent(ex.id) }, 'Voir la progression')
  ));

  const btnArchiver = h('button', { type: 'button', class: 'bouton bouton-danger bouton-large', 'data-action': 'archiver' },
    ex.archived ? 'Réactiver cet exercice' : 'Archiver cet exercice');

  racine.appendChild(h('div', { class: 'zone-danger' },
    h('p', { class: 'ligne-reglage-aide', style: { marginBottom: 'var(--esp-3)' } },
      'Un exercice ne se supprime jamais : vos séances passées le référencent à vie et perdraient '
      + 'l\'interprétation de leurs séries. L\'archivage le retire des listes et des propositions, '
      + 'sans toucher à une seule donnée enregistrée.'),
    btnArchiver
  ));

  conteneur.appendChild(racine);

  // ── Rafraichissements cibles ───────────────────────────────────────────────

  function rafraichirFiche() {
    ex = store.exercice(ex.id) || ex;
    titre.textContent = ex.nom;
    detail.textContent = sousTitre(ex);
    pastilleArchive.hidden = !ex.archived;
    btnArchiver.textContent = ex.archived ? 'Réactiver cet exercice' : 'Archiver cet exercice';
    for (const [cle, dd] of valeurs) dd.textContent = texteDe(cle);
    mentionUserModified.textContent = ex.userModified
      ? 'Modifié par vous : ces valeurs sont protégées contre la synchronisation du catalogue livré.'
      : (String(ex.id).startsWith('cat:') ? 'Valeurs du catalogue livré. Toute modification les protège de la synchronisation.' : '');
    peindreProfils();
  }

  let compte = { seances: 0, entrees: 0, series: 0, derniere: null };

  function rafraichirUsage() {
    if (!store.historiquePret()) {
      bandeauUsage.textContent = 'Chargement de l\'historique…';
      btnFusion.disabled = true;
      return;
    }
    compte = usage(ex.id);
    btnFusion.disabled = false;
    bandeauUsage.textContent = compte.seances
      ? pluriel(compte.seances, 'séance') + ' · ' + pluriel(compte.series, 'série') + ' enregistrée'
        + (compte.series > 1 ? 's' : '') + (compte.derniere ? ' · dernière le ' + compte.derniere : '')
      : 'Aucune séance enregistrée avec cet exercice.';
  }

  // ── Feuilles ───────────────────────────────────────────────────────────────

  const feuilles = gestionnaireFeuilles((nom, p) => {
    if (nom === 'champ') return feuilleChamp(p.champ);
    if (nom === 'profil') return feuilleProfil(p.lieu);
    if (nom === 'fusion') return feuilleFusion();
    if (nom === 'archiver') return feuilleArchivage();
    return null;
  });

  /** Applique un patch, referme la feuille et mute les seuls noeuds concernes. */
  function appliquer(patch, message) {
    return enregistrer(ex, patch).then((maj) => {
      ex = maj;
      rafraichirFiche();
      if (message) toast.afficher(message);
    });
  }

  function feuilleChamp(cle) {
    if (cle === 'mode') return feuilleMode();

    let saisie = null;
    let titreFeuille = '';
    let lire = null;

    if (cle === 'nom') {
      titreFeuille = 'Nom';
      saisie = champTexte('Nom affiché', ex.nom);
      lire = () => {
        const v = saisie.lire().trim();
        return v ? { nom: v } : null;
      };
    } else if (cle === 'alias') {
      titreFeuille = 'Alias';
      saisie = champTexte('Alias, séparés par des virgules', (ex.alias || []).join(', '), {
        aide: 'Servent uniquement à la recherche : « pull-up » retrouve « Tractions pronation ». '
          + 'Ils ne regroupent jamais deux exercices.'
      });
      lire = () => ({ alias: saisie.lire().split(',').map((s) => s.trim()).filter(Boolean) });
    } else if (cle === 'categorie') {
      titreFeuille = 'Catégorie';
      saisie = champChoix(ex.categorie, CATEGORIES.map((c) => ({ cle: c, libelle: LIBELLES_CATEGORIES[c] || c })));
      lire = () => ({ categorie: saisie.lire() });
    } else if (cle === 'materiel') {
      titreFeuille = 'Matériel';
      saisie = champChoix(ex.materiel, MATERIELS.map((m) => ({ cle: m, libelle: LIBELLES_MATERIELS[m] || m })));
      lire = () => ({ materiel: saisie.lire() });
    } else if (cle === 'lestable') {
      titreFeuille = 'Lestable';
      saisie = champInterrupteur('Cet exercice accepte un lest', ex.lestable,
        'Le lest est SIGNÉ : +10 kg de ceinture, −20 kg d\'assistance élastique. La progression '
        + 'reste sur une seule droite. Modifiable à tout moment, sans migration.');
      lire = () => ({ lestable: saisie.lire() });
    } else if (cle === 'unilateral') {
      titreFeuille = 'Unilatéral';
      saisie = champInterrupteur('Exercice exécuté un côté à la fois', ex.unilateral,
        'Dimension d\'affichage : le libellé indique « par côté » et le tonnage compte double. '
        + 'Aucun champ n\'est ajouté à la saisie d\'une série.');
      lire = () => ({ unilateral: saisie.lire() });
    } else if (cle === 'incrementKg') {
      titreFeuille = 'Incrément';
      saisie = champTexte('Incrément en kilos', formatFr(ex.incrementKg), {
        type: 'text',
        attrs: { inputmode: 'decimal' },
        aide: 'Pas des boutons + / − ET tolérance de détection d\'un record (écart supérieur à la '
          + 'moitié de l\'incrément). La virgule est acceptée.'
      });
      lire = () => {
        const v = parseFr(saisie.lire());
        return (typeof v === 'number' && v > 0) ? { incrementKg: v } : null;
      };
    } else if (cle === 'bodyweightFactor') {
      titreFeuille = 'Facteur poids du corps';
      saisie = champTexte('Facteur', formatFr(ex.bodyweightFactor), {
        type: 'text',
        attrs: { inputmode: 'decimal' },
        aide: 'Part du poids du corps réellement soulevée : 1 pour les tractions et les dips, '
          + '0,65 pour les pompes, 0,75 pour les pompes déclinées. '
          + '⚠ Les séances déjà enregistrées gardent le facteur gelé le jour où elles ont été '
          + 'faites : les modifier ici ne réécrit aucune donnée passée.'
      });
      lire = () => {
        const v = parseFr(saisie.lire());
        return (typeof v === 'number' && v >= 0) ? { bodyweightFactor: v } : null;
      };
    } else if (cle === 'reposParDefautSec') {
      titreFeuille = 'Repos par défaut';
      saisie = champTexte('Repos en secondes', String(ex.reposParDefautSec), {
        type: 'text', attrs: { inputmode: 'numeric' }
      });
      lire = () => {
        const v = parseFr(saisie.lire());
        return (typeof v === 'number' && v >= 0) ? { reposParDefautSec: Math.round(v) } : null;
      };
    } else if (cle === 'metriquePreferee') {
      titreFeuille = 'Métrique affichée';
      const dispo = (MODES[ex.mode] ? MODES[ex.mode].metriques : []).map((m) => ({
        cle: m, libelle: LIBELLES_METRIQUES[m] || m
      }));
      saisie = champChoix(ex.metriquePreferee || '', [{ cle: '', libelle: 'Automatique', aide: 'La première métrique du mode' }].concat(dispo));
      lire = () => ({ metriquePreferee: saisie.lire() || null });
    } else if (cle === 'notes') {
      titreFeuille = 'Notes';
      const zone = h('textarea', { class: 'champ-recherche', rows: 4, style: { minHeight: '6rem', padding: 'var(--esp-2) var(--esp-3)' } });
      zone.value = ex.notes || '';
      saisie = { ligne: h('div', { class: 'zone-notes', style: { padding: 'var(--esp-3) var(--esp-4)' } }, zone) };
      lire = () => ({ notes: zone.value.trim() || null });
    } else {
      return null;
    }

    const erreur = h('p', { class: 'avertissement', hidden: true }, 'Valeur invalide.');

    return {
      titre: titreFeuille,
      contenu: [saisie.ligne, erreur],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Enregistrer',
          variante: 'primaire',
          async action() {
            const patch = lire();
            if (!patch) { erreur.hidden = false; return false; }
            try { await appliquer(patch, 'Modification enregistrée'); }
            catch (err) {
              console.error('[exercices] enregistrement en échec', err);
              erreur.textContent = 'Enregistrement impossible : ' + err.message;
              erreur.hidden = false;
              return false;
            }
          }
        }
      ]
    };
  }

  // ── Mode : la seule modification qui puisse REFUSER ────────────────────────
  function feuilleMode() {
    // ⚠ Tant que l'historique n'est pas charge, on SUPPOSE qu'il existe. Le contraire ouvrirait
    //   toutes les transitions sur un compte de zero seance qui n'est qu'une ignorance.
    const aHistorique = !store.historiquePret() || compte.seances > 0;
    const options = NOMS_MODES.map((m) => {
      const permise = !aHistorique || transitionPermise(ex.mode, m);
      let aide = MODES[m].saisie.join(' · ');
      if (!permise) {
        aide = 'Transition refusée depuis « ' + (LIBELLES_MODES[ex.mode] || ex.mode) + ' » : '
          + (compte.seances > 0
            ? pluriel(compte.seances, 'séance') + ' déjà enregistrée' + (compte.seances > 1 ? 's' : '')
              + ' n\'' + (compte.seances > 1 ? 'ont' : 'a') + ' pas d\'équivalent dans ce mode.'
            : 'les séances déjà enregistrées n\'auraient pas d\'équivalent dans ce mode.');
      }
      return { cle: m, libelle: LIBELLES_MODES[m] || m, aide, desactive: !permise };
    });
    const saisie = champChoix(ex.mode, options);

    const explication = h('p', { class: 'ligne-reglage-aide', style: { padding: 'var(--esp-3) var(--esp-4)' } },
      aHistorique
        ? 'Les séances déjà enregistrées gardent le mode gelé le jour où elles ont été faites : '
          + 'changer de mode ici n\'affecte que les séances à venir. Les transitions grisées '
          + 'convertiraient une métrique en une autre, ce qui réécrirait l\'historique.'
        : 'Aucune séance n\'utilise encore cet exercice : tous les modes sont ouverts.');

    const issue = h('div', { hidden: !aHistorique, style: { padding: '0 var(--esp-3)' } },
      h('p', { class: 'avertissement' },
        'Besoin d\'un mode indisponible ? Créez un nouvel exercice plutôt que de convertir '
        + 'celui-ci : vos deux historiques restent lisibles, chacun dans sa propre unité.'),
      h('button', { type: 'button', class: 'bouton bouton-large', 'data-action': 'creer-depuis' },
        'Créer un nouvel exercice à partir de celui-ci')
    );

    const erreur = h('p', { class: 'avertissement', hidden: true }, '');

    return {
      titre: 'Mode de suivi',
      contenu: [saisie.ligne, explication, issue, erreur],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Enregistrer',
          variante: 'primaire',
          async action() {
            const vers = saisie.lire();
            if (vers === ex.mode) return;
            if (aHistorique && !transitionPermise(ex.mode, vers)) {
              erreur.textContent = 'Cette transition est refusée. Créez un nouvel exercice.';
              erreur.hidden = false;
              return false;
            }
            try { await appliquer({ mode: vers }, 'Mode changé pour les séances à venir'); }
            catch (err) {
              erreur.textContent = 'Enregistrement impossible : ' + err.message;
              erreur.hidden = false;
              return false;
            }
          }
        }
      ]
    };
  }

  // ── Profil machine d'un lieu ───────────────────────────────────────────────
  function feuilleProfil(lieuId) {
    const lieu = store.lieu(lieuId);
    if (!lieu) return null;
    const actuel = (ex.machineProfiles || {})[lieuId] || null;
    const kg = champTexte('Kilos par plaque', actuel ? formatFr(actuel.kgParPlaque) : '', {
      attrs: { inputmode: 'decimal', placeholder: '5' }
    });
    const offset = champTexte('Charge de départ (cran 0)', actuel ? formatFr(actuel.offsetKg) : '', {
      attrs: { inputmode: 'decimal', placeholder: '2,5' },
      aide: 'Charge effective = départ + numéro de cran × kilos par plaque.'
    });
    const erreur = h('p', { class: 'avertissement', hidden: true }, '');

    const actions = [
      { libelle: 'Annuler', variante: 'fantome' },
      {
        libelle: 'Enregistrer',
        variante: 'primaire',
        async action() {
          const vKg = parseFr(kg.lire());
          const vOffset = parseFr(offset.lire());
          if (!(typeof vKg === 'number' && vKg > 0) || typeof vOffset !== 'number') {
            erreur.textContent = 'Renseignez les deux valeurs : kilos par plaque (> 0) et charge de départ.';
            erreur.hidden = false;
            return false;
          }
          const profils = Object.assign({}, ex.machineProfiles || {});
          profils[lieuId] = { kgParPlaque: vKg, offsetKg: vOffset };
          try { await appliquer({ machineProfiles: profils }, 'Profil machine enregistré'); }
          catch (err) {
            erreur.textContent = 'Enregistrement impossible : ' + err.message;
            erreur.hidden = false;
            return false;
          }
        }
      }
    ];

    if (actuel) {
      actions.splice(1, 0, {
        libelle: 'Effacer',
        variante: 'danger',
        async action() {
          const profils = Object.assign({}, ex.machineProfiles || {});
          delete profils[lieuId];
          await appliquer({ machineProfiles: profils }, 'Profil effacé');
        }
      });
    }

    return {
      titre: 'Profil machine — ' + lieu.nom,
      contenu: [
        h('p', { class: 'ligne-reglage-aide', style: { padding: 'var(--esp-3) var(--esp-4) 0' } },
          'Le profil est gelé sur chaque entrée de séance : déménager de salle ne réinterprète '
          + 'jamais les anciens crans.'),
        kg.ligne, offset.ligne, erreur
      ],
      actions
    };
  }

  // ── FUSION ─────────────────────────────────────────────────────────────────
  // Le doublon personnalise arrive toujours : « Developpé couché » cree a la main alors qu'il
  // existe deja au catalogue. Sans fusion, la courbe de progression est scindee definitivement.
  function feuilleFusion() {
    let cibleId = null;
    let requete = '';

    const champ = h('input', {
      type: 'search', class: 'champ-recherche', placeholder: 'Rechercher l\'exercice à conserver…',
      'aria-label': 'Rechercher l\'exercice à conserver', autocomplete: 'off', spellcheck: 'false'
    });
    const liste = h('div', { class: 'liste' });
    const resume = h('p', { class: 'avertissement', hidden: true }, '');
    const erreur = h('p', { class: 'avertissement', hidden: true }, '');

    function peindre() {
      vider(liste);
      const mots = normaliser(requete).split(' ').filter(Boolean);
      const candidats = store.exercices().filter((autre) => {
        if (autre.id === ex.id) return false;
        if (mots.length && !correspond(indexer(autre), mots)) return false;
        return true;
      }).slice(0, 40);
      if (!candidats.length) {
        liste.appendChild(h('p', { class: 'ligne-reglage-aide', style: { padding: 'var(--esp-3) var(--esp-4)' } },
          'Aucun exercice ne correspond.'));
        return;
      }
      for (const autre of candidats) {
        liste.appendChild(h('button', {
          type: 'button', class: 'ligne-liste', 'data-fusion-id': autre.id,
          'aria-pressed': autre.id === cibleId ? 'true' : 'false'
        },
          h('span', null,
            h('span', { class: 'ligne-liste-principal' }, autre.nom),
            h('br'),
            h('span', { class: 'ligne-liste-secondaire' }, sousTitre(autre))
          ),
          h('span', { class: 'ligne-liste-secondaire' }, autre.id === cibleId ? '✓' : '')
        ));
      }
    }

    function majResume() {
      const cible = cibleId ? store.exercice(cibleId) : null;
      if (!cible) { resume.hidden = true; return; }
      const usageCible = usage(cible.id);
      const lignes = [
        'Toutes les séries de « ' + ex.nom + ' » seront réaffectées à « ' + cible.nom + ' ».',
        pluriel(compte.seances, 'séance') + ' concernée' + (compte.seances > 1 ? 's' : '')
          + ' · ' + pluriel(compte.entrees, 'entrée') + ' · ' + pluriel(compte.series, 'série'),
        '« ' + cible.nom + ' » en compte déjà ' + pluriel(usageCible.seances, 'séance') + '.',
        '« ' + ex.nom + ' » sera archivé, jamais supprimé.'
      ];
      if (cible.mode !== ex.mode) {
        lignes.push('⚠ Les deux exercices n\'ont pas le même mode (' + (LIBELLES_MODES[ex.mode] || ex.mode)
          + ' contre ' + (LIBELLES_MODES[cible.mode] || cible.mode) + '). Les séries gardent le mode '
          + 'gelé le jour où elles ont été faites : la courbe mélangera deux unités.');
      }
      vider(resume);
      for (const l of lignes) resume.appendChild(h('p', { style: { marginBottom: 'var(--esp-1)' } }, l));
      resume.hidden = false;
    }

    const detacher = [];
    detacher.push(on(champ, 'input', () => { requete = champ.value; peindre(); }));
    detacher.push(delegate(liste, 'click', '[data-fusion-id]', (ev, cible) => {
      cibleId = cible.getAttribute('data-fusion-id');
      peindre();
      majResume();
    }));

    peindre();

    return {
      titre: 'Fusionner',
      contenu: [
        h('p', { class: 'ligne-reglage-aide', style: { padding: 'var(--esp-2) var(--esp-4)' } },
          'Choisissez l\'exercice à CONSERVER. Les séances de « ' + ex.nom + ' » lui seront '
          + 'réaffectées et les deux courbes n\'en feront plus qu\'une.'),
        h('div', { style: { padding: '0 var(--esp-3) var(--esp-2)' } }, champ),
        liste, resume, erreur
      ],
      onFermer() { for (const off of detacher) { try { off(); } catch (_) { /* deja detache */ } } },
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Fusionner',
          variante: 'danger',
          async action() {
            const cible = cibleId ? store.exercice(cibleId) : null;
            if (!cible) {
              erreur.textContent = 'Choisissez d\'abord l\'exercice à conserver.';
              erreur.hidden = false;
              return false;
            }
            try { await fusionner(cible); }
            catch (err) {
              console.error('[exercices] fusion en échec', err);
              erreur.textContent = 'Fusion interrompue : ' + err.message
                + ' Les séances déjà réaffectées le restent, relancez la fusion.';
              erreur.hidden = false;
              return false;
            }
          }
        }
      ]
    };
  }

  /**
   * Reaffecte toutes les entrees de l'exercice courant vers `cible`, puis archive la source.
   *
   * ⚠ Les coefficients GELES (modeUtilise, incrementKgUtilise, bodyweightFactorUtilise,
   *   machineProfileUtilise) ne sont PAS touches : ils decrivent ce qui s'est reellement passe
   *   ce jour-la. Seuls exerciceId et nomAffiche changent — la reference, pas le fait.
   */
  async function fusionner(cible) {
    const source = ex.id;
    const concernees = store.seances().filter((s) => (s.entrees || []).some((e) => e.exerciceId === source));

    for (const s of concernees) {
      const copie = JSON.parse(JSON.stringify(s));
      for (const e of copie.entrees || []) {
        if (e.exerciceId !== source) continue;
        e.exerciceId = cible.id;
        e.nomAffiche = cible.nom;
      }
      // Une seance en cours passe par 'seance:mettre-a-jour' : 'seance:modifier' rafraichirait
      // lastPerf a partir d'une seance encore incomplete.
      await store.commit(copie.statut === 'en-cours' ? 'seance:mettre-a-jour' : 'seance:modifier', { seance: copie });
    }

    await store.commit('exercice:archiver', { id: source, archived: true });

    // lastPerf pointe encore sur l'ancien identifiant : reconstruit integralement plutot que
    // corrige sur place, une correction partielle laisserait un rappel fantome.
    try { await store.recalculerDerives(); }
    catch (err) { console.warn('[exercices] recalcul des dérivés après fusion impossible', err); }

    toast.afficher(pluriel(concernees.length, 'séance') + ' réaffectée' + (concernees.length > 1 ? 's' : '')
      + ' à « ' + cible.nom + ' »');
    naviguerApresFeuille('#/exercices/' + encodeURIComponent(cible.id));
  }

  // ── Archivage ──────────────────────────────────────────────────────────────
  function feuilleArchivage() {
    if (ex.archived) {
      return {
        titre: 'Réactiver',
        contenu: h('p', { style: { padding: 'var(--esp-4)' } },
          '« ' + ex.nom + ' » réapparaîtra dans les listes et dans le sélecteur d\'exercice.'),
        actions: [
          { libelle: 'Annuler', variante: 'fantome' },
          {
            libelle: 'Réactiver',
            variante: 'primaire',
            async action() {
              await store.commit('exercice:archiver', { id: ex.id, archived: false });
              ex = store.exercice(ex.id) || ex;
              rafraichirFiche();
              toast.afficher('Exercice réactivé');
            }
          }
        ]
      };
    }

    return {
      titre: 'Archiver',
      fermable: true,
      contenu: [
        h('p', { style: { padding: 'var(--esp-4) var(--esp-4) 0' } },
          '« ' + ex.nom + ' » sera retiré des listes et des propositions.'),
        h('p', { class: 'avertissement' },
          'AUCUNE donnée n\'est supprimée. '
          + (store.historiquePret()
            ? pluriel(compte.seances, 'séance') + ' référence' + (compte.seances > 1 ? 'nt' : '')
              + ' cet exercice et ' + (compte.seances > 1 ? 'restent' : 'reste') + ' intacte'
              + (compte.seances > 1 ? 's' : '') + ' : '
            : 'Les séances qui référencent cet exercice restent intactes : ')
          + 'historique, courbes et records inchangés. '
          + 'La suppression définitive n\'existe pas — elle ferait perdre à ces séances '
          + 'l\'interprétation de leurs séries.'),
        h('p', { class: 'ligne-reglage-aide', style: { padding: '0 var(--esp-4)' } },
          'Vous pourrez le réactiver à tout moment depuis la liste, en affichant les archivés.')
      ],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Archiver',
          variante: 'danger',
          async action() {
            await store.commit('exercice:archiver', { id: ex.id, archived: true });
            ex = store.exercice(ex.id) || ex;
            rafraichirFiche();
            toast.afficher('Exercice archivé — aucune donnée supprimée');
          }
        }
      ]
    };
  }

  // ── Delegation : UN seul ecouteur click pour toute la vue ───────────────────
  desabonnements.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    if (action === 'editer') { router.ouvrirFeuille('champ', { champ: cible.getAttribute('data-champ') }); return; }
    if (action === 'profil') { router.ouvrirFeuille('profil', { lieu: cible.getAttribute('data-lieu') }); return; }
    if (action === 'fusion') { router.ouvrirFeuille('fusion'); return; }
    if (action === 'archiver') { router.ouvrirFeuille('archiver'); }
  }));

  // Le bouton « Créer un nouvel exercice » vit DANS la feuille de mode, hors de `racine` : la
  // delegation de la vue ne l'atteint pas, il lui faut son propre ecouteur, pose sur le document
  // au niveau capture le temps de la feuille. Plus simple : on ecoute le conteneur de feuille.
  const hoteFeuille = document.getElementById('conteneur-feuille');
  if (hoteFeuille) {
    desabonnements.push(delegate(hoteFeuille, 'click', '[data-action="creer-depuis"]', async () => {
      const clone = nouvelExercice(Object.assign({}, ex, {
        id: undefined, nom: ex.nom + ' (nouveau mode)', userModified: true,
        archived: false, archivedAt: null, createdAt: undefined, updatedAt: undefined
      }));
      try {
        await store.commit('exercice:enregistrer', { exercice: clone });
        router.fermerFeuille();
        toast.afficher('Exercice créé — choisissez son mode');
        naviguerApresFeuille('#/exercices/' + encodeURIComponent(clone.id));
      } catch (err) {
        console.error('[exercices] création depuis un exercice existant en échec', err);
        toast.afficher('Création impossible : ' + err.message);
      }
    }));
  }

  // ── Abonnements ────────────────────────────────────────────────────────────
  desabonnements.push(bus.on('historique:pret', rafraichirUsage));
  desabonnements.push(bus.on('exercice:enregistrer', ({ exercice: maj }) => {
    if (maj && maj.id === ex.id) { ex = maj; rafraichirFiche(); }
  }));
  desabonnements.push(bus.on('exercice:archiver', ({ exercice: maj }) => {
    if (maj && maj.id === ex.id) { ex = maj; rafraichirFiche(); }
  }));
  desabonnements.push(bus.on('lieu:enregistrer', peindreProfils));

  // L'historique n'est pas necessaire pour PEINDRE la fiche : il l'est pour compter ce que la
  // fusion et l'archivage affecteront. Il est donc demande ici, sans await, et le bandeau se
  // remplit a son arrivee. Idempotent cote store.
  store.chargerHistorique();

  rafraichirFiche();
  rafraichirUsage();
  feuilles.synchroniser(params);

  return {
    destroy() {
      feuilles.fermer();
      for (const off of desabonnements) { try { off(); } catch (_) { /* deja detache */ } }
      desabonnements.length = 0;
    },
    onParams(p) { feuilles.synchroniser(p); }
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Point d'entree du routeur
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param {Element} conteneur zone B (le <main> d'index.html)
 * @param {Object} params params de route ; `id` distingue la fiche de la liste
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur, params) {
  const p = params || {};
  return p.id ? monterFiche(conteneur, p) : monterListe(conteneur, p);
}

export default { mount };
