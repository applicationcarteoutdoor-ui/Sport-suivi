// js/views/seance-detail.js — route #/historique/:id.
//
// Detail d'une seance passee. LECTURE SEULE par defaut ; un tap sur une ligne de serie ouvre
// l'edition, exactement comme en salle — c'est le meme fragment vivant (ui/set-row.js) qui est
// remonte ici. Sans ce chemin, une erreur de saisie reperee le lendemain serait definitive.
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
//      plus departager deux versions de la meme seance.
//
//   3. AUCUN RE-RENDU. Corriger une serie mute la ligne concernee (figer) et les trois chiffres
//      d'en-tete. La liste des exercices, le defilement et la ligne voisine ne bougent pas.
//
// ⚠ store.commit remplace l'objet seance en memoire par une COPIE : aucune reference n'est
//   conservee entre deux operations, tout est re-resolu par id au moment de s'en servir.

import { h, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatLong } from '../lib/dates.js';
import { formatFr, formatDuree } from '../lib/num.js';
import {
  estComptable, estSeanceEnCours, estSeanceAbandonnee, LIBELLES_STATUTS_SEANCE
} from '../data/schema.js';
import { packDeLExercice } from '../data/packs.js';
import * as store from '../data/store.js';
import { tonnageSeance } from '../domain/metrics.js';
import * as session from '../domain/session.js';
import * as setRow from '../ui/set-row.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';
import * as router from '../ui/router.js';

// Ecriture differee pendant l'edition : un commit par appui sur « + » ferait une transaction
// IndexedDB par tap. La correction est de toute facon flushee a la fermeture de l'edition et au
// demontage de la vue, donc aucune fenetre de perte n'est ouverte.
const DELAI_COMMIT_MS = 700;

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

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
      'courbe, aucun record et aucun tonnage cumulé.';
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

  // Fragments vivants montes par cette vue : elle seule a le droit de les detruire.
  /** @type {Array<{api:Object, entreeId:string, serieId:string}>} */
  let rangees = [];
  let chiffres = null;          // { duree, tonnage, series } — noeuds mutes, jamais remplaces
  let barreEdition = null;

  // Edition en cours : une seule ligne a la fois. Deux lignes ouvertes simultanement rendraient
  // le brouillon a enregistrer ambigu.
  let edition = null;           // { entreeId, serieId, api, kind }
  let minuteurCommit = 0;
  let chaine = Promise.resolve();

  // Feuille (confirmation) — c'est un PARAMETRE de la route courante, pas une navigation : le
  // bouton retour d'Android la ferme au lieu de quitter le detail.
  let feuilleNom = null;
  let feuilleHandle = null;

  // ── Ecriture ────────────────────────────────────────────────────────────────

  function planifierCommit() {
    if (minuteurCommit) clearTimeout(minuteurCommit);
    minuteurCommit = setTimeout(() => { minuteurCommit = 0; appliquerEdition(false); }, DELAI_COMMIT_MS);
  }

  /**
   * Ecrit le brouillon de la ligne en edition.
   * @param {boolean} figer true : referme l'edition une fois la ligne enregistree.
   */
  function appliquerEdition(figer) {
    if (minuteurCommit) { clearTimeout(minuteurCommit); minuteurCommit = 0; }
    const encours = edition;
    if (!encours) return chaine;

    const valeurs = Object.assign({}, encours.api.valeurs());
    if (encours.kind) valeurs.kind = encours.kind;

    chaine = chaine.then(async () => {
      const s = store.seance(idCourant);
      if (!s) return;
      // domain/session.js mute la seance en place et reecrit updatedAt ; store.commit en fait une
      // copie datee avant de l'ecrire.
      session.modifierSerie(s, encours.entreeId, encours.serieId, valeurs);
      const resultat = await store.commit('seance:modifier', { seance: s });
      const fraiche = resultat && resultat.seance;
      if (!fraiche) return;
      peindreResume(fraiche);
      if (figer) {
        const serie = retrouverSerie(fraiche, encours.entreeId, encours.serieId);
        if (serie) encours.api.figer(serie);
      }
    }).catch((err) => {
      console.error('[seance-detail] enregistrement de la correction en échec', err);
      toast.afficher('La correction n\'a pas pu être enregistrée.');
    });

    if (figer) {
      edition = null;
      if (barreEdition) barreEdition.hidden = true;
    }
    return chaine;
  }

  function retrouverSerie(seance, entreeId, serieId) {
    const entree = (seance.entrees || []).find((e) => e.id === entreeId);
    if (!entree) return null;
    return (entree.series || []).find((s) => s.id === serieId) || null;
  }

  function ouvrirEdition(info) {
    if (edition && edition.serieId === info.serieId) return;
    // La ligne precedente est enregistree ET refermee avant que la nouvelle ne s'ouvre.
    if (edition) appliquerEdition(true);
    edition = { entreeId: info.entreeId, serieId: info.serieId, api: info.api, kind: null };
    if (barreEdition) barreEdition.hidden = false;
  }

  // ── Peinture ciblee de l'en-tete ────────────────────────────────────────────

  function peindreResume(seance) {
    if (!chiffres || !seance) return;
    chiffres.duree.textContent = formatDureeCourte(seance.dureeSec);
    const t = tonnageSeance(seance);
    chiffres.tonnage.textContent = t.kg > 0
      ? (t.fiable ? '' : '≈ ') + formatFr(Math.round(t.kg)) + ' kg'
      : '—';
    chiffres.series.textContent = String(nombreSeries(seance));
  }

  // ── Suppressions ────────────────────────────────────────────────────────────

  function supprimerSeance() {
    const s = store.seance(idCourant);
    const libelle = s ? formatLong(s.date) : 'cette séance';
    store.commit('seance:supprimer', { id: idCourant })
      .then(() => {
        toast.afficher('Séance du ' + libelle + ' supprimée.');
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
      // lignes de series pour rien.
      .then(() => toast.afficher('Séance abandonnée. Elle reste ici, hors des statistiques.', { duree: 8000 }))
      .catch((err) => {
        console.error('[seance-detail] abandon en échec', err);
        toast.afficher('La séance n\'a pas pu être abandonnée.');
      });
  }

  function supprimerSerie(entreeId, serieId) {
    const s = store.seance(idCourant);
    if (!s) return;
    if (edition && edition.serieId === serieId) {
      // Le brouillon de cette ligne n'a plus d'objet : l'enregistrer ressusciterait la serie.
      if (minuteurCommit) { clearTimeout(minuteurCommit); minuteurCommit = 0; }
      edition = null;
      if (barreEdition) barreEdition.hidden = true;
    }
    session.supprimerSerie(s, entreeId, serieId);
    chaine = chaine.then(async () => {
      const resultat = await store.commit('seance:modifier', { seance: s });
      const i = rangees.findIndex((r) => r.serieId === serieId);
      if (i !== -1) { rangees[i].api.detruire(); rangees.splice(i, 1); }
      if (resultat && resultat.seance) peindreResume(resultat.seance);
      toast.afficher('Série supprimée.');
    }).catch((err) => {
      console.error('[seance-detail] suppression de série en échec', err);
      toast.afficher('La série n\'a pas pu être supprimée.');
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
      const s = store.seance(idCourant);
      ouvrirConfirmation('suppr-seance', {
        titre: 'Supprimer la séance ?',
        contenu: h('div', { class: 'confirmation' },
          h('p', { class: 'confirmation-texte' }, 'Séance du ' + (s ? formatLong(s.date) : '—') + '.'),
          h('p', { class: 'confirmation-consequence' },
            'Elle sera DÉFINITIVEMENT effacée, avec toutes ses séries. Rien ne permet de la rétablir.'),
          h('p', { class: 'confirmation-texte' },
            'Les exercices, les modèles et les autres séances ne sont pas touchés.')
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
            'Mais elle n\'entrera dans AUCUNE courbe ni statistique : ni tonnage, ni record, ni ' +
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

  function demonterRangees() {
    for (const r of rangees) r.api.detruire();
    rangees = [];
    edition = null;
    barreEdition = null;
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
    demonterRangees();
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
    const cDuree = chiffreCle('—', 'Durée');
    const cTonnage = chiffreCle('—', 'Tonnage');
    const cSeries = chiffreCle('0', 'Séries');
    chiffres = { duree: cDuree.val, tonnage: cTonnage.val, series: cSeries.val };

    const snapshot = seance.modeleSnapshot;
    const titre = snapshot && snapshot.nom
      ? snapshot.nom
      : (session.estCardioPure(seance) ? 'Sortie cardio' : 'Séance libre');

    const lieu = seance.lieuId ? store.lieu(seance.lieuId) : null;
    const complements = [];
    if (lieu && lieu.nom) complements.push('Lieu : ' + lieu.nom);
    if (estNombre(seance.poidsDeCorpsKg)) complements.push('Poids de corps : ' + formatFr(seance.poidsDeCorpsKg) + ' kg');
    if (estNombre(seance.ressenti)) complements.push('Ressenti : ' + seance.ressenti + '/5');

    const mentionStatut = texteStatut(seance);

    contenu.appendChild(h('div', { class: 'carte carte-detail-seance' },
      h('p', { class: 'carte-titre' }, formatLong(seance.date)),
      h('div', { class: 'detail-titre-rangee' },
        h('h2', { class: 'entete-titre detail-titre' }, titre),
        pastilleStatut(seance)
      ),
      mentionStatut ? h('p', { class: 'mention-statut' }, mentionStatut) : null,
      h('div', { class: 'entete-seance' }, cDuree.bloc, cTonnage.bloc, cSeries.bloc),
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

    // ── Exercices et series ───────────────────────────────────────────────────
    if (!seance.entrees || !seance.entrees.length) {
      contenu.appendChild(h('p', { class: 'historique-resume' }, 'Aucun exercice enregistré dans cette séance.'));
    }

    for (const entree of seance.entrees || []) {
      const hoteSeries = h('div', { class: 'liste' });
      const cibles = texteCibles(entree);
      const ex = entree.exerciceId ? store.exercice(entree.exerciceId) : null;

      // Vignette de l'exercice : le meme pictogramme que dans la liste d'historique et dans le
      // selecteur. C'est ce qui rend une seance passee reconnaissable en la faisant defiler,
      // sans lire un seul nom.
      contenu.appendChild(h('div', { class: 'entree' },
        h('div', { class: 'entree-entete' },
          h('span', {
            class: 'entree-vignette',
            'aria-hidden': 'true',
            'data-pack': packDeLExercice(ex || {})
          }, icone(iconePourExercice(ex || entree.exerciceId), { taille: 24 })),
          h('p', { class: 'entree-nom' }, nomEntree(entree))
        ),
        cibles ? h('p', { class: 'ligne-liste-secondaire' }, cibles) : null,
        hoteSeries
      ));

      const metriqueCardio = ex ? ex.metriqueCardio : null;

      (entree.series || []).forEach((serie, i) => {
        const api = setRow.monter(hoteSeries, {
          serie,
          entree,                                   // porteuse des COEFFICIENTS GELES
          numero: i + 1,
          etat: serie.done === true ? 'faite' : 'non-faite',
          metriqueCardio,
          callbacks: {
            // Tap : set-row est deja passe en edition, on ne fait qu'enregistrer laquelle.
            onEditer: () => ouvrirEdition({ entreeId: entree.id, serieId: serie.id, api }),
            onChange: () => { if (edition && edition.serieId === serie.id) planifierCommit(); },
            onKind: (kind) => {
              if (!edition || edition.serieId !== serie.id) {
                ouvrirEdition({ entreeId: entree.id, serieId: serie.id, api });
              }
              edition.kind = kind;
              planifierCommit();
            },
            // « Non faite » : la serie est CONSERVEE (elle porte l'information « c'etait prevu
            // et ca n'a pas ete fait »), simplement exclue de tout agregat.
            onNonFaite: () => {
              const s = store.seance(idCourant);
              if (!s) return;
              if (edition && edition.serieId === serie.id) {
                if (minuteurCommit) { clearTimeout(minuteurCommit); minuteurCommit = 0; }
                edition = null;
                if (barreEdition) barreEdition.hidden = true;
              }
              session.modifierSerie(s, entree.id, serie.id, { done: false });
              chaine = chaine.then(async () => {
                const resultat = await store.commit('seance:modifier', { seance: s });
                const fraiche = resultat && resultat.seance;
                if (!fraiche) return;
                peindreResume(fraiche);
                const maj = retrouverSerie(fraiche, entree.id, serie.id);
                if (maj) api.figer(maj);
              }).catch((err) => console.error('[seance-detail] marquage non faite en échec', err));
            },
            // Appui long : suppression, et JAMAIS sans confirmation sur une seance passee.
            onSupprimer: () => router.ouvrirFeuille('suppr-serie', { entree: entree.id, serie: serie.id })
          }
        });
        rangees.push({ api, entreeId: entree.id, serieId: serie.id });
      });
    }

    // ── Barre d'edition et zone dangereuse ────────────────────────────────────
    barreEdition = h('div', { class: 'carte', hidden: true },
      h('p', { class: 'ligne-liste-secondaire' }, 'Série en cours de modification.'),
      h('button', {
        class: 'bouton bouton-primaire bouton-large',
        type: 'button',
        dataset: { action: 'fin-edition' }
      }, 'Terminer la modification')
    );
    contenu.appendChild(barreEdition);

    contenu.appendChild(h('p', { class: 'historique-resume' },
      'Touche une série pour la corriger. Appui long pour la supprimer.'));

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
    if (action === 'fin-edition') { ev.preventDefault(); appliquerEdition(true); return; }
    if (action === 'suppr-seance') { ev.preventDefault(); router.ouvrirFeuille('suppr-seance'); return; }
    if (action === 'abandon-seance') { ev.preventDefault(); router.ouvrirFeuille('abandon-seance'); }
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
      // Flush : une correction saisie dans les 700 dernieres millisecondes ne doit pas se perdre
      // parce que l'utilisateur a change d'ecran.
      if (edition) appliquerEdition(true);
      if (minuteurCommit) { clearTimeout(minuteurCommit); minuteurCommit = 0; }
      off();
      for (const stop of desabonner) stop();
      desabonner.length = 0;
      if (feuilleNom) fermerFeuilleLocale();
      demonterRangees();
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    },

    onParams(p) {
      const params2 = p || {};
      // Meme cle de route pour deux seances differentes : le routeur n'a pas remonte la vue,
      // c'est donc a elle de reconstruire son propre contenu.
      if (params2.id && params2.id !== idCourant) {
        if (edition) appliquerEdition(true);
        construire(params2.id);
      }
      gererFeuille(params2);
    }
  };
}

export default { mount };
