// js/views/historique.js — route #/historique.
//
// Liste ANTICHRONOLOGIQUE des seances CLOSES — terminees ET abandonnees —, groupee par mois.
//
// Trois contraintes structurent ce fichier :
//
//   1. L'HISTORIQUE ARRIVE EN TACHE DE FOND. boot.js appelle store.chargerHistorique() SANS
//      await : au montage de cette vue, store.seances() ne contient le plus souvent rien. La vue
//      se peint donc immediatement (etat de chargement), s'abonne a bus('historique:pret') et
//      COMPLETE la liste a l'arrivee. Attendre l'historique avant de peindre rendrait l'onglet
//      blanc pendant plusieurs centaines de millisecondes sur trois ans de seances.
//
//   2. AUCUN RE-RENDU. La liste n'est jamais reconstruite : integrer() n'insere que les lignes
//      MANQUANTES, a leur place dans l'ordre, et mute le texte de celles qui existent deja. Une
//      reconstruction ferait sauter le defilement au moment exact ou l'historique arrive —
//      c'est-a-dire pendant que l'utilisateur lit la liste.
//
//   3. LE PICTOGRAMME PORTE L'INFORMATION. Une ligne d'historique se reconnait a sa vignette
//      (l'icone du premier exercice, ou celle du type de seance) et a sa rangee d'icones
//      defilante, pas a la lecture d'un libelle. Le texte restant tient en deux lignes courtes.
//
// La vue ne lit jamais IndexedDB : elle lit store.seances(), qui est synchrone. Elle n'y ecrit
// jamais non plus : toute mutation passe par store.commit().

import { h, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { moisDe, cleMois, formatLong } from '../lib/dates.js';
import { formatFr } from '../lib/num.js';
import { estComptable, estSeanceClose, estSeanceAbandonnee, LIBELLES_STATUTS_SEANCE } from '../data/schema.js';
import { packDeLExercice } from '../data/packs.js';
import * as store from '../data/store.js';
import { tonnageSeance, resumeSerie } from '../domain/metrics.js';
import { estCardioPure } from '../domain/session.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';
import * as router from '../ui/router.js';

// Abreviations de mois. Ce sont des libelles d'INTERFACE : lib/dates.js nomme les mois en toutes
// lettres pour les titres de groupe, la colonne de gauche des lignes n'a que 52 px.
const MOIS_COURTS = [
  'janv.', 'févr.', 'mars', 'avril', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'
];

// Au-dela, la rangee d'icones deborde et ne se lit plus d'un coup d'oeil : le surplus devient un
// compteur. Six tient sur la largeur d'un telephone etroit sans imposer de defilement.
const MAX_ICONES = 6;

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

/** '2026-07-12' -> { jour:'12', mois:'juil.' } */
function decouper(cle) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cle || '');
  if (!m) return { jour: '?', mois: '' };
  return { jour: String(+m[3]), mois: MOIS_COURTS[+m[2] - 1] || '' };
}

/**
 * Duree lisible en un coup d'oeil : « 47 min », « 1 h 12 ».
 * formatDuree ('47:12') est le format du MINUTEUR : a la seconde pres, il est illisible en liste
 * et suggere une precision que la duree d'une seance n'a pas.
 */
function formatDureeCourte(sec) {
  if (!estNombre(sec) || sec <= 0) return '';
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return minutes + ' min';
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? heures + ' h' : heures + ' h ' + String(reste).padStart(2, '0');
}

/** Nombre de series COMPTABLES : un echauffement n'est pas une serie de plus a afficher. */
function nombreSeries(seance) {
  let n = 0;
  for (const entree of seance.entrees || []) {
    for (const serie of entree.series || []) if (estComptable(serie)) n++;
  }
  return n;
}

/** Nom du modele TEL QU'IL ETAIT ce jour-la (snapshot), jamais le modele actuel. */
function nomSeance(seance) {
  const snap = seance.modeleSnapshot;
  if (snap && snap.nom) return snap.nom;
  if (estCardioPure(seance)) {
    const entree = seance.entrees[0];
    return entree.nomAffiche || 'Sortie cardio';
  }
  return 'Séance libre';
}

/** L'exercice courant s'il existe encore ; sinon rien — l'id suffit a resoudre un pictogramme. */
function exerciceDe(entree) {
  if (!entree || !entree.exerciceId) return null;
  return store.exercice(entree.exerciceId) || null;
}

/**
 * Ligne de resume : duree · tonnage · series. Pour une sortie cardio autonome, le tonnage n'a
 * aucun sens (aucune charge) : on affiche le resume de la sortie a la place.
 */
function texteResume(seance) {
  const morceaux = [];
  const duree = formatDureeCourte(seance.dureeSec);
  if (duree) morceaux.push(duree);

  if (estCardioPure(seance)) {
    const entree = seance.entrees[0];
    const serie = (entree.series || []).find(estComptable);
    const texte = serie ? resumeSerie(serie, entree) : '';
    if (texte) morceaux.push(texte);
    return morceaux.join(' · ');
  }

  const tonnage = tonnageSeance(seance);
  if (tonnage.kg > 0) {
    // Le tilde n'est pas decoratif : une seule serie non convertible en kilos (machine sans
    // profil, poids de corps inconnu) fait du total un MINORANT. L'afficher net serait faux.
    morceaux.push((tonnage.fiable ? '' : '≈ ') + formatFr(Math.round(tonnage.kg)) + ' kg');
  }
  const n = nombreSeries(seance);
  if (n > 0) morceaux.push(n + (n > 1 ? ' séries' : ' série'));
  return morceaux.join(' · ');
}

/**
 * Pictogramme representant la seance ENTIERE : celui du premier exercice, ou le coeur du cardio
 * pour une sortie autonome.
 *
 * ⚠ On resout par l'EXERCICE et non par le nom de la seance : l'icone doit rester juste quand le
 *   modele a ete renomme, et un exercice supprime du catalogue retombe proprement sur le dessin
 *   de son pack via iconePourExercice().
 */
function iconeSeance(seance) {
  if (estCardioPure(seance)) return 'cardio';
  const premiere = (seance.entrees || [])[0];
  if (!premiere) return 'exercice';
  return iconePourExercice(exerciceDe(premiere) || premiere.exerciceId);
}

/** Pack du premier exercice : sert de couleur de vignette, jamais de calcul. */
function packSeance(seance) {
  const premiere = (seance.entrees || [])[0];
  return packDeLExercice(exerciceDe(premiere) || {});
}

/**
 * Monte la vue.
 * @param {Element} conteneur
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur) {
  // ── Sous-arbre, construit UNE SEULE FOIS ────────────────────────────────────
  const liste = h('div', { class: 'liste-mois' });

  const chargement = h('p', { class: 'historique-chargement' }, 'Chargement de l\'historique…');

  const vide = h('div', { class: 'etat-vide', hidden: true },
    h('p', { class: 'etat-vide-titre' }, 'Aucune séance enregistrée'),
    h('p', { class: 'etat-vide-texte' },
      'Tes séances terminées apparaîtront ici, de la plus récente à la plus ancienne.'),
    h('a', { class: 'bouton bouton-primaire', href: '#/' }, 'Commencer une séance')
  );

  const erreur = h('p', { class: 'avertissement', hidden: true },
    'L\'historique n\'a pas pu être chargé. Tes données ne sont pas perdues : réessaie en rouvrant l\'application.');

  const racine = h('section', { class: 'vue vue-historique' }, chargement, erreur, liste, vide);
  conteneur.appendChild(racine);

  // ── Etat de rendu ───────────────────────────────────────────────────────────
  // groupes : cleMois ('2026-07') -> { section, corps }   ·  ordreGroupes : cles, antichrono
  // lignes  : seanceId -> { rangee, bouton, nom, resume, marque, vignette, icones }
  const groupes = new Map();
  const ordreGroupes = [];
  const lignes = new Map();

  // Feuille de confirmation. LOCALE et non parametre de route : l'historique n'a pas de feuille
  // dans son contrat de route, et une confirmation de suppression n'a aucune raison de survivre
  // a un partage d'URL ni de se rouvrir au bouton retour.
  let feuille = null;

  function fermerFeuille() {
    const f = feuille;
    feuille = null;
    if (f && typeof f.fermer === 'function') { try { f.fermer(); } catch (_) { /* deja fermee */ } }
  }

  function creerGroupe(cle, dateExemple) {
    const corps = h('div', { class: 'liste' });
    const section = h('section', { class: 'historique-groupe' },
      h('h2', { class: 'historique-mois' }, moisDe(dateExemple)),
      corps
    );
    // Insertion a la bonne place : les cles de mois se comparent en chaine, l'ordre
    // lexicographique EST l'ordre chronologique (voir lib/dates.js).
    let position = ordreGroupes.findIndex((c) => c < cle);
    if (position === -1) {
      liste.appendChild(section);
      ordreGroupes.push(cle);
    } else {
      liste.insertBefore(section, groupes.get(ordreGroupes[position]).section);
      ordreGroupes.splice(position, 0, cle);
    }
    const groupe = { section, corps };
    groupes.set(cle, groupe);
    return groupe;
  }

  // ── Peinture des pictogrammes ───────────────────────────────────────────────

  /** Vignette de tete : une icone dans une pastille teintee par le pack. */
  function peindreVignette(ref, seance) {
    vider(ref.vignette);
    ref.vignette.setAttribute('data-pack', packSeance(seance));
    ref.vignette.appendChild(icone(iconeSeance(seance), { taille: 28 }));
  }

  /**
   * Rangee d'icones, une par exercice distinct de la seance : ce que la seance CONTENAIT se lit
   * sans ouvrir le detail et sans une seule phrase.
   * ⚠ Decorative : l'aria-label du bouton porte deja la date et le nom, faire annoncer six
   *   pictogrammes de plus rendrait la liste inutilisable au lecteur d'ecran.
   */
  function peindreIcones(ref, seance) {
    vider(ref.icones);
    const vus = new Set();
    let surplus = 0;
    for (const entree of seance.entrees || []) {
      const cle = entree.exerciceId || entree.nomAffiche || '';
      if (vus.has(cle)) continue;
      vus.add(cle);
      if (vus.size > MAX_ICONES) { surplus++; continue; }
      const ex = exerciceDe(entree);
      ref.icones.appendChild(h('span', {
        class: 'historique-icone-exercice',
        'data-pack': packDeLExercice(ex || {})
      }, icone(iconePourExercice(ex || entree.exerciceId), { taille: 18 })));
    }
    if (surplus > 0) ref.icones.appendChild(h('span', { class: 'historique-icones-reste' }, '+' + surplus));
  }

  /**
   * Pastilles de droite : le type de seance et, quand il ne va PAS de soi, son statut.
   *
   * ⚠ Une seance abandonnee doit se distinguer AU PREMIER COUP D'OEIL d'une seance terminee : ses
   *   chiffres sont reels mais elle n'entre dans aucune courbe ni statistique. Sans la pastille,
   *   l'utilisateur chercherait pendant des semaines pourquoi une seance « manque » a sa
   *   progression. Le libelle vient de LIBELLES_STATUTS_SEANCE, jamais d'une chaine ecrite ici.
   */
  function peindreMarque(ref, seance) {
    vider(ref.marque);
    if (estSeanceAbandonnee(seance)) {
      ref.marque.appendChild(h('span', {
        class: 'pastille pastille-statut',
        'data-ton': 'danger'
      }, LIBELLES_STATUTS_SEANCE.abandonnee));
    }
    if (estCardioPure(seance)) {
      // ⚠ estCardioPure est DERIVE, jamais stocke : ajouter des pompes a la fin d'une sortie
      //   course fait disparaitre la pastille, et c'est le comportement voulu.
      ref.marque.appendChild(h('span', { class: 'pastille', 'data-ton': 'accent' }, 'Cardio'));
    }
  }

  function etiquette(seance) {
    const statut = estSeanceAbandonnee(seance) ? ' — ' + LIBELLES_STATUTS_SEANCE.abandonnee : '';
    return formatLong(seance.date) + ' — ' + nomSeance(seance) + statut;
  }

  // ── Lignes ──────────────────────────────────────────────────────────────────

  function creerLigne(seance) {
    const d = decouper(seance.date);
    const nom = h('span', { class: 'ligne-liste-principal' }, nomSeance(seance));
    const resume = h('span', { class: 'historique-resume' }, texteResume(seance));
    const marque = h('span', { class: 'historique-marque' });
    const vignette = h('span', { class: 'historique-vignette', 'aria-hidden': 'true' });
    const icones = h('span', { class: 'historique-icones', 'aria-hidden': 'true' });

    const bouton = h('button', {
      class: 'historique-ligne',
      type: 'button',
      dataset: { action: 'ouvrir', id: seance.id },
      'aria-label': etiquette(seance)
    },
      h('span', { class: 'historique-jour' },
        h('span', { class: 'historique-jour-nombre' }, d.jour),
        h('span', { class: 'historique-jour-mois' }, d.mois)
      ),
      vignette,
      h('span', { class: 'historique-ligne-texte' }, nom, resume, icones),
      marque
    );

    // Suppression : bouton FRERE et non enfant — un bouton dans un bouton n'est pas du HTML
    // valide et le tap y devient indecidable. La rangee est le seul noeud que la liste manipule.
    const supprimer = h('button', {
      class: 'historique-supprimer',
      type: 'button',
      dataset: { action: 'supprimer', id: seance.id },
      'aria-label': 'Supprimer la séance du ' + formatLong(seance.date)
    }, icone('poubelle', { taille: 20 }));

    const rangee = h('div', { class: 'historique-rangee' }, bouton, supprimer);

    const ref = { rangee, bouton, supprimer, nom, resume, marque, vignette, icones };
    peindreVignette(ref, seance);
    peindreIcones(ref, seance);
    peindreMarque(ref, seance);
    return ref;
  }

  /** Met a jour une ligne existante : des textContent et des sous-arbres qu'elle POSSEDE. */
  function majLigne(seance) {
    const ref = lignes.get(seance.id);
    if (!ref) return;
    ref.nom.textContent = nomSeance(seance);
    ref.resume.textContent = texteResume(seance);
    ref.bouton.setAttribute('aria-label', etiquette(seance));
    peindreVignette(ref, seance);
    peindreIcones(ref, seance);
    peindreMarque(ref, seance);
  }

  /**
   * Insere dans la liste toutes les seances manquantes de `ordonnees` (deja antichronologique),
   * chacune a sa place. Les lignes deja presentes sont seulement rafraichies.
   */
  function integrer(ordonnees) {
    for (let i = 0; i < ordonnees.length; i++) {
      const seance = ordonnees[i];
      if (lignes.has(seance.id)) { majLigne(seance); continue; }

      const cle = cleMois(seance.date);
      const groupe = groupes.get(cle) || creerGroupe(cle, seance.date);
      const ref = creerLigne(seance);

      // La ligne se place AVANT la premiere seance suivante du meme mois deja rendue. Les
      // precedentes ont ete traitees avant elle et sont donc deja au-dessus.
      let suivante = null;
      for (let j = i + 1; j < ordonnees.length && !suivante; j++) {
        if (cleMois(ordonnees[j].date) !== cle) break;
        const candidate = lignes.get(ordonnees[j].id);
        if (candidate) suivante = candidate.rangee;
      }
      if (suivante) groupe.corps.insertBefore(ref.rangee, suivante);
      else groupe.corps.appendChild(ref.rangee);

      lignes.set(seance.id, ref);
    }
  }

  function retirerLigne(id) {
    const ref = lignes.get(id);
    if (!ref) return;
    const corps = ref.rangee.parentNode;
    if (corps) corps.removeChild(ref.rangee);
    lignes.delete(id);
    // Un mois vide n'a plus de titre a porter : le laisser afficherait « juillet 2026 » suivi de
    // rien du tout.
    if (corps && !corps.firstChild) {
      for (const [cle, groupe] of groupes) {
        if (groupe.corps !== corps) continue;
        if (groupe.section.parentNode) groupe.section.parentNode.removeChild(groupe.section);
        groupes.delete(cle);
        const i = ordreGroupes.indexOf(cle);
        if (i !== -1) ordreGroupes.splice(i, 1);
        break;
      }
    }
    majEtats();
  }

  // ── Suppression ─────────────────────────────────────────────────────────────

  /**
   * Confirmation de suppression. Elle NOMME la seance et dit que c'est definitif : c'est la seule
   * suppression dure d'un fait dans toute l'application, et aucun export n'a forcement ete fait.
   */
  function demanderSuppression(id) {
    const seance = store.seance(id);
    if (!seance) return;
    fermerFeuille();

    const jeton = { fermer: null };
    const poignee = sheet.ouvrir({
      titre: 'Supprimer cette séance ?',
      contenu: h('div', { class: 'confirmation' },
        h('p', { class: 'confirmation-texte' },
          'Séance du ' + formatLong(seance.date) + ' — ' + nomSeance(seance) + '.'),
        h('p', { class: 'confirmation-consequence' },
          'Elle sera DÉFINITIVEMENT effacée, avec toutes ses séries. Rien ne permet de la rétablir.'),
        h('p', { class: 'confirmation-texte' },
          'Les exercices, les modèles et les autres séances ne sont pas touchés.')
      ),
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        { libelle: 'Supprimer', variante: 'danger', action: () => supprimer(id) }
      ],
      onFermer: () => { if (feuille === jeton) feuille = null; }
    });
    jeton.fermer = poignee.fermer;
    feuille = jeton;
  }

  function supprimer(id) {
    const seance = store.seance(id);
    const quand = seance ? formatLong(seance.date) : '';
    // ⚠ La vue n'ecrit jamais dans IndexedDB. La ligne, elle, n'est pas retiree ici : c'est
    //   l'evenement 'seance:supprimer' du bus qui la retire, quelle que soit l'origine de la
    //   suppression (cet ecran, le detail, un import). Un seul chemin, donc un seul comportement.
    store.commit('seance:supprimer', { id })
      .then(() => toast.afficher(quand ? 'Séance du ' + quand + ' supprimée.' : 'Séance supprimée.', { duree: 5000 }))
      .catch((err) => {
        console.error('[historique] suppression en échec', err);
        toast.afficher('La séance n\'a pas pu être supprimée.', { duree: 6000 });
      });
  }

  // ── Alimentation ────────────────────────────────────────────────────────────

  function seancesAffichables() {
    // ⚠ estSeanceClose et non estSeanceComptable : une seance ABANDONNEE est exclue des courbes et
    //   des agregats, mais elle reste VISIBLE ici, avec sa pastille. Sans cela elle n'apparait
    //   nulle part et devient inatteignable alors qu'elle est conservee en base — abandonner est
    //   une information d'entrainement, pas une donnee a cacher.
    //   Les seances EN COURS, elles, appartiennent a #/seance et a l'accueil : leur duree et leur
    //   tonnage seraient encore faux.
    return store.seances().filter((s) => estSeanceClose(s));
  }

  function majEtats() {
    const pret = store.historiquePret();
    chargement.hidden = pret || lignes.size > 0;
    vide.hidden = !pret || lignes.size > 0;
  }

  function rafraichir() {
    integrer(seancesAffichables());
    majEtats();
  }

  // ── Premier remplissage ─────────────────────────────────────────────────────
  // store.seances() peut deja contenir quelque chose si un autre ecran a declenche le
  // chargement : on peint ce qui est disponible sans attendre.
  rafraichir();
  // Idempotente : appelable par l'accueil, l'historique et la progression au meme moment sans
  // provoquer trois balayages de la base.
  store.chargerHistorique();

  // ── Abonnements ─────────────────────────────────────────────────────────────
  const desabonner = [
    bus.on('historique:pret', (charge) => {
      erreur.hidden = !charge || charge.ok !== false;
      rafraichir();
    }),
    // Une seance close depuis un autre ecran s'ajoute en tete sans re-rendre la liste. L'abandon
    // compte autant que la cloture : il fait lui aussi ENTRER une seance dans cette liste.
    bus.on('seance:terminer', rafraichir),
    bus.on('seance:abandonner', rafraichir),
    bus.on('seance:modifier', ({ seance }) => { if (seance) majLigne(seance); }),
    bus.on('seance:supprimer', ({ id }) => retirerLigne(id))
  ];

  // Un seul ecouteur click pour toute la vue, dispatche par data-action.
  const off = delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    const id = cible.getAttribute('data-id');
    if (!id) return;
    if (action === 'ouvrir') { ev.preventDefault(); router.aller('#/historique/' + encodeURIComponent(id)); return; }
    if (action === 'supprimer') { ev.preventDefault(); demanderSuppression(id); }
  });

  return {
    destroy() {
      off();
      for (const stop of desabonner) stop();
      desabonner.length = 0;
      fermerFeuille();
      lignes.clear();
      groupes.clear();
      ordreGroupes.length = 0;
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    },
    onParams() {
      // Aucun parametre de route : l'historique n'a ni feuille de route ni filtre en v1.
    }
  };
}

export default { mount };
