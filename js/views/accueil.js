// views/accueil.js — ecran racine #/. VITRINE VISUELLE de l'application (v2).
//
// Ce que la v2 change ici, et pourquoi :
//   · PLUSIEURS seances en cours cohabitent (store.seancesEnCours()). L'accueil ne montre donc
//     plus « la » seance active mais une RANGEE de cartes qui defile horizontalement. Une seance
//     oubliee doit rester atteignable : c'est le seul ecran qui la liste.
//   · Le LANCEMENT est une GRILLE VERTICALE pleine largeur (2 colonnes de tuiles hautes), plus
//     une rangee defilante : retour utilisateur v3, chaque point d'entree doit etre visible sans
//     defiler de cote. Ordre IMPOSE : Composer (mis en avant), Seance libre, Sortie cardio, puis
//     les routines de l'utilisateur, puis les modeles livres. La grille est la vedette de
//     l'ecran ; le resume de la semaine passe apres elle.
//   · Moins de phrases, plus de pictogrammes. Chaque tuile porte une icone DOMINANTE issue de
//     ui/icons.js, resolue depuis le PREMIER exercice du modele : deux routines differentes ne se
//     ressemblent donc jamais, et on les distingue sans lire.
//
// ⚠ CE QUI N'EST PAS NEGOCIABLE, meme au nom du visuel : les CHIFFRES du resume de la semaine
//   restent des chiffres lisibles, jamais des jauges decoratives. Une icone qui remplace un
//   nombre pendant une seance est une regression, pas un progres.
//
// CONTRAT DE RENDU (zone B). Le sous-arbre est construit UNE FOIS au montage. Il n'existe aucune
// fonction de re-rendu global. La rangee des seances en cours et la grille de lancement sont
// RECONCILIEES par cle : un noeud deja
// construit est conserve et mute (textContent, attributs), un noeud disparu est retire, un noeud
// nouveau est insere a sa place. Rien de vivant (minuteur, saisie) n'y est monte ; les feuilles,
// elles, vivent dans la coquille et sont fermees par destroy().
//
// Direction des dependances : cette vue n'ouvre JAMAIS IndexedDB. Elle lit le store (synchrone),
// ecrit par store.commit(), et apprend les changements par le bus.

import { MAX_SEANCES_EN_COURS, JOURS_AVANT_RAPPEL_EXPORT } from '../config.js';
import { h, delegate } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { dayKey, joursEntre } from '../lib/dates.js';
import { formatFr } from '../lib/num.js';
import { estSeanceComptable, estRoutine, LIBELLES_STATUTS_SEANCE } from '../data/schema.js';
import * as store from '../data/store.js';
import * as prefs from '../data/prefs.js';
import { icone, iconePourExercice } from '../ui/icons.js';
import { resumeSemaine } from '../domain/progression.js';
import * as session from '../domain/session.js';
import * as router from '../ui/router.js';
import * as toast from '../ui/toast.js';
import * as sheet from '../ui/sheet.js';
import * as picker from '../ui/picker-exercice.js';
import * as install from '../ui/install.js';

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// Au-dela de ce delai sans la moindre serie, une seance restee ouverte n'est plus une seance
// « en cours » mais un oubli : la carte le dit, et son menu propose la cloture retroactive en
// premier. Meme seuil que la reprise silencieuse de data/store.js, pour que les deux ecrans ne
// racontent pas deux histoires differentes du meme fait.
const SEUIL_OUBLI_MS = 6 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Lectures derivees
// ─────────────────────────────────────────────────────────────────────────────

/** Seances qui alimentent les agregats. store.seances() contient aussi les en-cours et abandons. */
function seancesTerminees() {
  return store.seances().filter(estSeanceComptable);
}

/**
 * Poids de corps a geler sur la seance qui demarre, ou null.
 *
 * ⚠ On ne reporte QUE le poids du jour. Un poids d'hier serait faux sans que rien ne le signale,
 *   et surtout il empecherait views/seance.js — a qui appartient la saisie du poids — de la
 *   proposer : sa feuille ne s'ouvre que si `poidsDeCorpsKg` est absent. Rendre null ici, c'est
 *   donc demander la saisie, pas la perdre.
 */
function poidsDuJour() {
  const aujourdHui = dayKey();
  for (const s of store.seances()) {
    if (!estNombre(s.poidsDeCorpsKg)) continue;
    return s.date === aujourdHui ? s.poidsDeCorpsKg : null;
  }
  return null;
}

/** Lieu a preselectionner : le lieu unique s'il n'y en a qu'un, sinon rien (choisi a la cloture). */
function lieuParDefaut() {
  const actifs = store.lieux().filter((l) => l && l.archived !== true);
  return actifs.length === 1 ? actifs[0].id : null;
}

function nomDeSeance(s) {
  return (s && s.modeleSnapshot && s.modeleSnapshot.nom) || 'Séance libre';
}

/** Horodatage du dernier fait connu : derniere serie validee, sinon les metadonnees. */
function derniereActivite(s) {
  let max = 0;
  for (const entree of (s && s.entrees) || []) {
    for (const serie of (entree && entree.series) || []) {
      if (serie && serie.done === true && estNombre(serie.at) && serie.at > max) max = serie.at;
    }
  }
  if (max) return max;
  if (estNombre(s && s.updatedAt)) return s.updatedAt;
  return estNombre(s && s.startedAt) ? s.startedAt : 0;
}

function nbSeriesValidees(s) {
  let n = 0;
  for (const entree of (s && s.entrees) || []) {
    for (const serie of (entree && entree.series) || []) {
      if (serie && serie.done === true) n += 1;
    }
  }
  return n;
}

/** « Exercice 3/6 », ou null quand la seance n'a encore aucun exercice. */
function progressionDeSeance(s) {
  const total = ((s && s.entrees) || []).length;
  if (!total) return null;
  const position = session.prochainePosition(s);
  const rang = position
    ? s.entrees.findIndex((e) => e.id === position.entryId) + 1
    : total;
  return { rang: Math.max(1, rang), total };
}

/** Heure locale de debut, en 24 h. Construite a la main : aucune dependance, aucun Intl requis. */
function formatHeure(ts) {
  if (!estNombre(ts)) return '';
  const d = new Date(ts);
  const deuxChiffres = (n) => (n < 10 ? '0' + n : String(n));
  return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes());
}

function formatAnciennete(ms) {
  const heures = Math.max(1, Math.round(ms / 3600000));
  if (heures < 48) return 'il y a environ ' + heures + ' h';
  return 'il y a ' + Math.round(heures / 24) + ' jours';
}

/**
 * Icone d'un modele : celle de son PREMIER exercice.
 *
 * ⚠ Resolue par l'id de l'exercice, jamais par le nom du modele : un « Push » et un « Pull »
 *   partageraient la meme icone si l'on se fiait au libelle, alors que le developpe couche et les
 *   tractions ont deux dessins tres differents. C'est ce qui rend la rangee lisible sans lire.
 */
function iconeDuModele(modele) {
  const items = (modele && modele.items) || [];
  for (const item of items) {
    if (!item || !item.exerciceId) continue;
    const ex = store.exercice(item.exerciceId);
    if (ex) return iconePourExercice(ex);
  }
  return 'exercice';
}

/** Icone d'une seance en cours : celle de sa premiere entree. Meme raison que ci-dessus. */
function iconeDeSeance(s) {
  for (const entree of (s && s.entrees) || []) {
    if (!entree || !entree.exerciceId) continue;
    const ex = store.exercice(entree.exerciceId);
    if (ex) return iconePourExercice(ex);
  }
  return 'chronometre';
}

/** « 4 exercices · ≈ 55 min », sans jamais depasser une ligne de tuile. */
function resumeModele(modele) {
  const n = ((modele && modele.items) || []).length;
  const bouts = [];
  if (n > 0) bouts.push(n + (n > 1 ? ' exercices' : ' exercice'));
  if (estNombre(modele && modele.dureeEstimeeMin) && modele.dureeEstimeeMin > 0) {
    bouts.push('≈ ' + modele.dureeEstimeeMin + ' min');
  }
  return bouts.join(' · ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation d'une rangee par cle
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ Ni vider() ni reconstruction : la rangee des seances DEFILE horizontalement et perdrait sa
//   position a chaque reconstruction ; la grille de lancement vit dans le defilement VERTICAL de
//   la page, et une reconstruction deroberait la tuile sous le doigt. On conserve donc les noeuds
//   existants, on ne cree que ce qui manque, on ne retire que ce qui a disparu, et on remet tout
//   dans l'ordre par insertBefore.
//
// @param {Element} hote
// @param {string[]} cles ordre voulu
// @param {Map<string, Element>} index cle -> noeud deja construit
// @param {(cle:string) => Element} fabriquer
// @param {(cle:string, noeud:Element) => void} [mettreAJour]
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
// Montage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Element} conteneur le <main> de la coquille
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur) {
  const desabos = [];
  const etat = { lancement: false, bandeau: null, detruit: false, feuille: null };

  // Index de reconciliation. Les noeuds y sont memorises par cle stable (id de seance, id de
  // modele) pour survivre a toutes les mises a jour.
  const noeudsSeances = new Map();
  const noeudsLanceurs = new Map();

  // La barre d'action basse appartient a l'ecran de seance. Sur l'accueil elle n'a aucun role :
  // la laisser visible masquerait la navigation basse si la vue de seance a leve dans destroy().
  const barre = document.getElementById('barre-action');
  if (barre) barre.hidden = true;

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Seances en cours — rangee qui defile horizontalement
  // ═══════════════════════════════════════════════════════════════════════════

  const rangeeSeances = h('div', { class: 'rangee-defilante rangee-seances', role: 'list' });
  const compteurSeances = h('span', { class: 'compteur-section' });

  const blocSeances = h('section', { class: 'bloc-seances-en-cours', hidden: true },
    h('h2', { class: 'section-titre' },
      icone('chronometre', { taille: 20, classe: 'section-titre-icone' }),
      h('span', {}, 'En cours'),
      compteurSeances
    ),
    rangeeSeances
  );

  /**
   * Une carte de seance en cours.
   *
   * Le corps ENTIER est un bouton : un tap n'importe ou active la seance et l'ouvre. Le menu est
   * un second bouton, pose a cote et non dedans — un bouton dans un bouton est du HTML invalide,
   * et le navigateur y decide seul lequel recoit le clic.
   */
  function carteSeance(id) {
    const s = store.seance(id);
    if (!s) return null;

    const nom = h('span', { class: 'carte-seance-nom' });
    const heure = h('span', { class: 'carte-seance-heure' });
    const progression = h('span', { class: 'carte-seance-progression' });
    const mention = h('span', { class: 'carte-seance-mention', hidden: true });

    const corps = h('button', {
      type: 'button',
      class: 'carte-seance-corps',
      dataset: { action: 'ouvrir-seance', id }
    },
      h('span', { class: 'carte-seance-icone' }, icone(iconeDeSeance(s), { taille: 32 })),
      h('span', { class: 'carte-seance-textes' }, nom, heure, progression, mention)
    );

    const carte = h('article', { class: 'carte-seance', role: 'listitem', dataset: { id } },
      corps,
      h('button', {
        type: 'button',
        class: 'bouton-icone carte-seance-menu',
        dataset: { action: 'menu-seance', id }
      }, icone('chevron-bas', { taille: 22, titre: 'Autres actions' })),
      h('div', { class: 'carte-seance-actions' },
        h('button', {
          type: 'button',
          class: 'bouton bouton-primaire carte-seance-reprendre',
          dataset: { action: 'ouvrir-seance', id }
        },
          icone('lecture', { taille: 18 }),
          h('span', {}, 'Reprendre')
        )
      )
    );

    // Les noeuds mutables sont memorises sur la carte : les retrouver par querySelector a chaque
    // rafraichissement couterait un balayage par carte et par evenement.
    carte._nom = nom;
    carte._heure = heure;
    carte._progression = progression;
    carte._mention = mention;
    majCarteSeance(id, carte);
    return carte;
  }

  function majCarteSeance(id, carte) {
    const s = store.seance(id);
    if (!s) return;
    carte._nom.textContent = nomDeSeance(s);
    carte._heure.textContent = formatHeure(s.startedAt);

    const p = progressionDeSeance(s);
    carte._progression.textContent = p
      ? 'Exercice ' + p.rang + '/' + p.total
      : 'Aucun exercice';

    const age = Date.now() - derniereActivite(s);
    const oubliee = age > SEUIL_OUBLI_MS;
    // ⚠ Attribut et non classe conditionnelle : le CSS pilote l'alerte visuelle, le JS n'a qu'un
    //   fait a poser. Une seance oubliee est signalee, jamais masquee ni fermee d'office.
    carte.setAttribute('data-oubliee', oubliee ? 'oui' : 'non');
    carte._mention.hidden = !oubliee;
    if (oubliee) carte._mention.textContent = 'Sans activité ' + formatAnciennete(age);
  }

  function majSeancesEnCours() {
    const ouvertes = store.seancesEnCours();
    blocSeances.hidden = ouvertes.length === 0;
    compteurSeances.textContent = ouvertes.length > 1 ? String(ouvertes.length) : '';
    compteurSeances.hidden = ouvertes.length <= 1;
    // Une seule carte : elle occupe toute la largeur plutot que de flotter a gauche d'un vide.
    rangeeSeances.setAttribute('data-unique', ouvertes.length === 1 ? 'oui' : 'non');
    reconcilier(rangeeSeances, ouvertes.map((s) => s.id), noeudsSeances, carteSeance, majCarteSeance);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Lancer une seance — grille verticale pleine largeur de tuiles a icone
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // ⚠ Retour utilisateur v3 : plus de defilement lateral ici. La grille occupe la page sur
  //   2 colonnes de tuiles hautes — icone dominante, nom dessous — et l'ordre est IMPOSE :
  //   Composer (premiere tuile, mise en avant), Seance libre, Sortie cardio, routines de
  //   l'utilisateur, modeles livres.

  const grilleLanceurs = h('div', { class: 'grille-lanceurs', role: 'list' });

  const mentionPlafond = h('p', { class: 'mention-plafond', hidden: true });

  const blocLanceurs = h('section', { class: 'bloc-lancement' },
    h('h2', { class: 'section-titre' },
      icone('lecture', { taille: 20, classe: 'section-titre-icone' }),
      h('span', {}, 'Lancer une séance')
    ),
    grilleLanceurs,
    mentionPlafond
  );

  // Cles synthetiques des trois entrees fixes de la grille. Prefixees pour ne jamais entrer en
  // collision avec un id de modele ('usr:…', 'mod:…', 'tpl:…').
  const CLE_COMPOSER = 'action:composer';
  const CLE_LIBRE = 'action:libre';
  const CLE_CARDIO = 'action:cardio';

  function tuile({ cle, nomIcone, titre, detail, pastille, action, id, classe }) {
    return h('button', {
      type: 'button',
      class: ['tuile-lanceur', classe],
      dataset: id ? { action, id } : { action },
      role: 'listitem',
      'data-cle': cle
    },
      h('span', { class: 'tuile-lanceur-icone' }, icone(nomIcone, { taille: 48 })),
      h('span', { class: 'tuile-lanceur-nom' }, titre),
      detail ? h('span', { class: 'tuile-lanceur-detail' }, detail) : null,
      pastille ? h('span', { class: 'pastille-origine' }, pastille) : null
    );
  }

  function fabriquerLanceur(cle) {
    if (cle === CLE_COMPOSER) {
      return tuile({
        cle, nomIcone: 'plus', titre: 'Composer', detail: 'Exercice par exercice',
        action: 'composer', classe: 'tuile-composer'
      });
    }
    if (cle === CLE_LIBRE) {
      return tuile({
        cle, nomIcone: 'halteres', titre: 'Séance libre', detail: 'Sans plan préparé',
        action: 'libre', classe: 'tuile-libre'
      });
    }
    if (cle === CLE_CARDIO) {
      return tuile({
        cle, nomIcone: 'cardio', titre: 'Sortie cardio', detail: 'Durée et distance',
        action: 'cardio', classe: 'tuile-cardio'
      });
    }
    const modele = store.modele(cle);
    if (!modele) return null;
    return tuile({
      cle,
      nomIcone: iconeDuModele(modele),
      titre: modele.nom || 'Séance',
      detail: resumeModele(modele),
      // ⚠ La pastille n'est posee que sur les modeles LIVRES : marquer aussi les routines
      //   couvrirait toute la grille d'etiquettes et n'apprendrait plus rien. On distingue ce qui
      //   est minoritaire, jamais ce qui est majoritaire.
      pastille: estRoutine(modele) ? null : 'Livré',
      action: 'modele',
      id: modele.id,
      classe: estRoutine(modele) ? 'tuile-routine' : 'tuile-modele-livre'
    });
  }

  function majLanceur(cle, noeud) {
    if (cle === CLE_COMPOSER || cle === CLE_LIBRE || cle === CLE_CARDIO) return;
    const modele = store.modele(cle);
    if (!modele) return;
    const nom = noeud.querySelector('.tuile-lanceur-nom');
    const detail = noeud.querySelector('.tuile-lanceur-detail');
    if (nom) nom.textContent = modele.nom || 'Séance';
    if (detail) detail.textContent = resumeModele(modele);
  }

  function majLanceurs() {
    const actifs = store.modeles().filter((m) => m && m.archived !== true);
    // ⚠ ORDRE IMPOSE par le retour utilisateur v3 : les trois gestes de creation d'abord —
    //   Composer en tete de grille — puis les ROUTINES de l'utilisateur (ce qu'on a ecrit
    //   soi-meme se lance plus souvent que ce qui est livre), et les modeles livres en dernier.
    const routines = actifs.filter(estRoutine).map((m) => m.id);
    const livres = actifs.filter((m) => !estRoutine(m)).map((m) => m.id);
    const cles = [CLE_COMPOSER, CLE_LIBRE, CLE_CARDIO].concat(routines, livres);
    reconcilier(grilleLanceurs, cles, noeudsLanceurs, fabriquerLanceur, majLanceur);
    majPlafond();
  }

  /**
   * Plafond de seances simultanees.
   *
   * ⚠ Le store REFUSE le demarrage au-dela de MAX_SEANCES_EN_COURS. Laisser les tuiles actives
   *   ferait echouer le tap avec un message d'erreur technique, apres coup. On desarme donc la
   *   grille et on DIT pourquoi, avant le geste.
   */
  function majPlafond() {
    const atteint = store.seancesEnCours().length >= MAX_SEANCES_EN_COURS;
    mentionPlafond.hidden = !atteint;
    if (atteint) {
      mentionPlafond.textContent = MAX_SEANCES_EN_COURS + ' séances sont déjà en cours, ' +
        'le maximum. Termine ou abandonne l\'une d\'elles pour en lancer une nouvelle.';
    }
    blocLanceurs.setAttribute('data-plafond', atteint ? 'atteint' : 'libre');
    for (const bouton of grilleLanceurs.children) {
      bouton.disabled = atteint;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Resume de la semaine — tuiles chiffrees compactes, SOUS la grille de lancement
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // ⚠ Le CHIFFRE d'abord, l'icone ensuite. C'est l'inverse du reste de l'ecran, et c'est
  //   volontaire : un pictogramme ne remplace jamais un nombre. Le bloc vient APRES la grille
  //   (retour v3) : lancer est le geste principal, consulter vient ensuite.

  function tuileChiffree(nomIcone, libelle) {
    const valeur = h('span', { class: 'tuile-chiffre-valeur' }, '—');
    const noeud = h('div', { class: 'tuile-chiffre' },
      icone(nomIcone, { taille: 20, classe: 'tuile-chiffre-icone' }),
      valeur,
      h('span', { class: 'tuile-chiffre-libelle' }, libelle)
    );
    return { noeud, valeur };
  }

  const tSeances = tuileChiffree('coche', 'Séances');
  const tTonnage = tuileChiffree('barre', 'Tonnage');
  const tSeries = tuileChiffree('halteres', 'Séries');
  const tCardio = tuileChiffree('cardio', 'Cardio');

  const blocSemaine = h('section', { class: 'bloc-semaine' },
    h('h2', { class: 'section-titre' },
      icone('minuteur', { taille: 20, classe: 'section-titre-icone' }),
      h('span', {}, 'Cette semaine')
    ),
    h('div', { class: 'grille-tuiles-chiffrees' },
      tSeances.noeud, tTonnage.noeud, tSeries.noeud, tCardio.noeud
    )
  );

  function majSemaine() {
    const r = resumeSemaine(seancesTerminees(), new Date());
    tSeances.valeur.textContent = String(r.seances);
    tTonnage.valeur.textContent = r.tonnage > 0 ? formatFr(Math.round(r.tonnage), 0) + ' kg' : '0 kg';
    tSeries.valeur.textContent = String(r.series);
    tCardio.valeur.textContent = r.minutesCardio > 0 ? r.minutesCardio + ' min' : '0 min';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Premier lancement — des icones, pas un pave de texte
  // ═══════════════════════════════════════════════════════════════════════════

  function etape(nomIcone, texte) {
    return h('li', { class: 'etape-bienvenue' },
      icone(nomIcone, { taille: 28, classe: 'etape-icone' }),
      h('span', { class: 'etape-texte' }, texte)
    );
  }

  const blocBienvenue = h('section', { class: 'bloc-bienvenue', hidden: true },
    h('h2', { class: 'section-titre' }, 'Premiers pas'),
    h('ol', { class: 'etapes-bienvenue' },
      etape('lecture', 'Choisis une séance ci-dessus'),
      etape('halteres', 'Valide chaque série en un tap'),
      etape('coche', 'Termine : tout est enregistré'),
      etape('telecharger', 'Exporte de temps en temps')
    )
  );

  function majBienvenue() {
    // ⚠ Tant que l'historique n'est pas charge, on ne conclut RIEN : afficher « aucune donnée »
    //   pendant le chargement serait un mensonge d'un dixieme de seconde, et le pire moment pour
    //   faire douter quelqu'un de ses trois ans de seances.
    if (!store.historiquePret()) { blocBienvenue.hidden = true; return; }
    const vide = seancesTerminees().length === 0 && store.seancesEnCours().length === 0;
    blocBienvenue.hidden = !vide;
    // Sur une base vierge, le resume de la semaine n'apprend rien : quatre zeros alignes.
    blocSemaine.hidden = vide;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Rappel d'export — discret, jamais modal
  // ═══════════════════════════════════════════════════════════════════════════

  const rappelTexte = h('span', { class: 'rappel-texte' });
  const rappelRenfort = h('p', { class: 'rappel-renfort', hidden: true });

  const blocRappel = h('section', { class: 'bloc-rappel-export', hidden: true },
    h('a', { class: 'rappel-lien', href: '#/reglages' },
      icone('telecharger', { taille: 22, classe: 'rappel-icone' }),
      rappelTexte,
      icone('chevron-droit', { taille: 18, classe: 'rappel-chevron' })
    ),
    rappelRenfort
  );

  function majRappelExport() {
    if (!store.historiquePret()) return;
    if (seancesTerminees().length === 0) { blocRappel.hidden = true; return; }

    // Deux traces existent : celle des prefs (survit a une base morte) et celle de meta (survit a
    // un localStorage efface). On retient la PLUS RECENTE — retenir la plus ancienne ferait
    // reclamer un export a quelqu'un qui vient d'en faire un.
    const desPrefs = prefs.lire().dernierExportAt;
    const deMeta = (store.meta() || {}).dernierExportAt;
    const dernier = Math.max(estNombre(desPrefs) ? desPrefs : 0, estNombre(deMeta) ? deMeta : 0);

    const jours = dernier > 0 ? joursEntre(dayKey(new Date(dernier)), dayKey()) : null;
    const du = jours == null || jours > JOURS_AVANT_RAPPEL_EXPORT;
    blocRappel.hidden = !du;
    if (!du) return;

    rappelTexte.textContent = jours == null
      ? 'Jamais exporté — tes séances ne vivent que sur cet appareil.'
      : 'Dernier export il y a ' + jours + ' jours.';

    // Renfort : sans stockage persistant, le systeme peut evincer la base pour recuperer de la
    // place. C'est exactement la situation ou le rappel doit hausser le ton — sans pour autant
    // devenir modal : on n'interrompt jamais quelqu'un qui veut s'entrainer.
    if (!navigator.storage || typeof navigator.storage.persisted !== 'function') return;
    navigator.storage.persisted().then((persistant) => {
      if (etat.detruit || persistant) return;
      rappelRenfort.hidden = false;
      blocRappel.setAttribute('data-renforce', 'oui');
      // L'icone d'avertissement est reconstruite a chaque passage : le noeud precedent est
      // remplace par vidage explicite, jamais par innerHTML.
      while (rappelRenfort.firstChild) rappelRenfort.removeChild(rappelRenfort.firstChild);
      rappelRenfort.appendChild(icone('avertissement', { taille: 18, classe: 'rappel-icone' }));
      rappelRenfort.appendChild(h('span', {},
        'Stockage non persistant : le système peut effacer les données pour libérer de la place.'));
    }).catch(() => { /* API refusee : le rappel simple suffit */ });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Assemblage
  // ═══════════════════════════════════════════════════════════════════════════

  const hoteInstall = h('div', { class: 'hote-installation' });

  const racine = h('section', { class: 'vue vue-accueil' },
    blocSeances,
    blocLanceurs,
    blocBienvenue,
    blocSemaine,
    blocRappel,
    hoteInstall
  );
  conteneur.appendChild(racine);

  function majTout() {
    majSeancesEnCours();
    majLanceurs();
    majSemaine();
    majBienvenue();
    majRappelExport();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lancement d'une seance
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Lance une seance. UN SEUL TAP separe la tuile de l'ecran de saisie : aucune confirmation,
   * aucun formulaire. Le poids de corps, quand il manque, est demande par views/seance.js une
   * fois l'ecran affiche — donc sans jamais retarder le lancement.
   *
   * ⚠ v2 : on ne detourne PLUS vers la seance active quand il en existe une. Plusieurs seances
   *   cohabitent ; c'est le plafond, et lui seul, qui borne le geste.
   *
   * @param {object|null} modele null = seance libre
   * @param {string|null} [exerciceCardioId] non nul = sortie cardio autonome
   */
  async function demarrerSeance(modele, exerciceCardioId) {
    if (etat.lancement) return;   // double-tap sur une tuile : un seul lancement
    etat.lancement = true;

    try {
      const ctx = {
        // domain/ n'a pas le droit de lire le store : on lui passe le resolveur.
        exercices: (id) => store.exercice(id),
        poidsDeCorpsKg: poidsDuJour(),
        lieuId: lieuParDefaut()
      };

      const seance = exerciceCardioId
        ? session.demarrerCardio(exerciceCardioId, ctx)
        : session.demarrer(modele, ctx);

      await store.commit('seance:demarrer', { seance });
      if (etat.detruit) return;

      prefs.ecrire({ dernierModeleId: modele ? modele.id : null });
      router.aller('#/seance');
    } catch (err) {
      console.error('[accueil] lancement de la séance en échec', err);
      if (etat.detruit) return;
      toast.afficher(err && err.message ? err.message : 'La séance n\'a pas pu démarrer.');
      majTout();
    } finally {
      etat.lancement = false;
    }
  }

  /** Sortie cardio : le type est un EXERCICE du catalogue, choisi dans la feuille filtrable. */
  function choisirCardio() {
    etat.feuille = picker.ouvrir({
      filtreCategorie: 'cardio',
      onChoisir: (exercice) => {
        etat.feuille = null;
        if (!exercice || etat.detruit) return;
        demarrerSeance(null, exercice.id);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ouvrir / gerer une seance en cours
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Active la seance tapee, puis ouvre l'ecran de seance.
   * ⚠ L'activation passe par store.activer(), qui commit 'seance:activer'. Naviguer sans activer
   *   ouvrirait l'ecran de seance sur une AUTRE seance que celle qu'on vient de taper.
   */
  async function ouvrirSeance(id) {
    if (etat.lancement) return;
    etat.lancement = true;
    try {
      await store.activer(id);
      if (etat.detruit) return;
      router.aller('#/seance');
    } catch (err) {
      console.error('[accueil] activation de la séance en échec', err);
      if (etat.detruit) return;
      toast.afficher('Cette séance n\'est plus disponible.');
      majTout();
    } finally {
      etat.lancement = false;
    }
  }

  /**
   * Execute une issue de seance.
   * ⚠ Les noms d'operations sont ceux de data/store.js : 'seance:terminer' (avec retroactif:true,
   *   qui date la fin de la derniere serie validee), 'seance:abandonner', 'seance:supprimer'.
   * @param {string} quoi 'cloturer' | 'abandonner' | 'supprimer'
   */
  async function resoudreSeance(quoi, seance) {
    if (!seance) return;
    try {
      if (quoi === 'cloturer') {
        await store.commit('seance:terminer', { seance, retroactif: true });
        if (etat.detruit) return;
        toast.afficher('Séance clôturée à l\'heure de ta dernière série.');
      } else if (quoi === 'abandonner') {
        await store.commit('seance:abandonner', { id: seance.id });
        if (etat.detruit) return;
        toast.afficher('Séance abandonnée. Elle reste dans l\'historique.');
      } else {
        await store.commit('seance:supprimer', { id: seance.id });
        if (etat.detruit) return;
        toast.afficher('Séance supprimée.');
      }
      majTout();
    } catch (err) {
      console.error('[accueil] ' + quoi + ' en échec', err);
      if (etat.detruit) return;
      toast.afficher(err && err.message ? err.message : 'L\'action n\'a pas pu être effectuée.');
      majTout();
    }
  }

  /** Second palier : supprimer detruit des series reellement faites, on la fait confirmer. */
  function confirmerSuppression(seance) {
    const series = nbSeriesValidees(seance);
    etat.feuille = sheet.ouvrir({
      titre: 'Supprimer cette séance ?',
      fermable: false,
      contenu: [
        h('p', {}, series > 0
          ? 'Les ' + series + ' série(s) déjà enregistrées seront définitivement perdues. ' +
            'Cette action ne peut pas être annulée.'
          : 'Cette séance ne contient aucune série. Sa suppression ne perd rien.'),
        series > 0
          ? h('p', { class: 'note-discrete' },
              'Si tu l\'as réellement faite, préfère « Abandonner » : elle reste dans ' +
              'l\'historique sans entrer dans les statistiques.')
          : null
      ],
      actions: [
        { libelle: 'Annuler', action: () => { ouvrirMenuSeance(seance.id); return false; } },
        { libelle: 'Supprimer', variante: 'danger', action: () => { resoudreSeance('supprimer', seance); } }
      ],
      onFermer: () => { etat.feuille = null; }
    });
  }

  /**
   * Menu d'une seance en cours : reprendre, cloturer, abandonner, supprimer.
   *
   * ⚠ « Cloturer » est propose EN PREMIER sur une seance oubliee, et « Reprendre » sur une seance
   *   fraiche. Reprendre une seance d'avant-hier ajouterait des series d'aujourd'hui a la date
   *   d'avant-hier, et « Dernière fois » — le derive le plus consulte de l'application —
   *   mentirait durablement.
   */
  function ouvrirMenuSeance(id) {
    const seance = store.seance(id);
    if (!seance) { majTout(); return; }

    const series = nbSeriesValidees(seance);
    const age = Date.now() - derniereActivite(seance);
    const oubliee = age > SEUIL_OUBLI_MS;

    const reprendre = {
      libelle: 'Reprendre',
      variante: oubliee ? null : 'primaire',
      action: () => { ouvrirSeance(id); }
    };
    const cloturer = {
      libelle: 'Clôturer à la dernière série',
      variante: oubliee ? 'primaire' : null,
      action: () => { resoudreSeance('cloturer', seance); }
    };

    etat.feuille = sheet.ouvrir({
      titre: nomDeSeance(seance),
      classe: 'menu-seance',
      contenu: [
        h('p', { class: 'note-discrete' },
          'Commencée à ' + formatHeure(seance.startedAt) + ' · ' +
          (series > 0 ? series + (series > 1 ? ' séries validées' : ' série validée') : 'aucune série validée') +
          ' · ' + (LIBELLES_STATUTS_SEANCE['en-cours'] || 'En cours')),
        oubliee
          ? h('p', {}, 'Sans activité ' + formatAnciennete(age) + '. La clôturer la datera de ta ' +
              'dernière série, pas de maintenant.')
          : null
      ],
      actions: (oubliee ? [cloturer, reprendre] : [reprendre, cloturer]).concat([
        {
          libelle: 'Abandonner',
          action: () => { resoudreSeance('abandonner', seance); }
        },
        {
          libelle: 'Supprimer',
          variante: 'danger',
          action: () => { confirmerSuppression(seance); return false; }
        }
      ]),
      onFermer: () => { etat.feuille = null; }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Delegation : UN seul ecouteur click pour toute la vue
  // ─────────────────────────────────────────────────────────────────────────

  desabos.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    const id = cible.getAttribute('data-id');

    if (action === 'ouvrir-seance') { ouvrirSeance(id); return; }
    if (action === 'menu-seance') { ouvrirMenuSeance(id); return; }
    if (action === 'composer') { router.aller('#/composer'); return; }
    if (action === 'libre') { demarrerSeance(null, null); return; }
    if (action === 'cardio') { choisirCardio(); return; }
    if (action === 'modele') {
      const modele = store.modele(id);
      if (modele) demarrerSeance(modele, null);
    }
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // Abonnements : l'invalidation arrive par le bus, jamais par appel direct
  // ─────────────────────────────────────────────────────────────────────────

  // Idempotent : le declencher ici couvre le rechargement direct sur '#/' apres un echec de la
  // premiere tentative de boot.js.
  store.chargerHistorique();

  desabos.push(bus.on('historique:pret', majTout));
  desabos.push(bus.on('seance:demarrer', majTout));
  desabos.push(bus.on('seance:activer', majSeancesEnCours));
  desabos.push(bus.on('seance:reprise', majSeancesEnCours));
  desabos.push(bus.on('seance:reprendre', majSeancesEnCours));
  desabos.push(bus.on('seance:retrouvee', majTout));
  desabos.push(bus.on('seance:mettre-a-jour', majSeancesEnCours));
  desabos.push(bus.on('seance:terminer', majTout));
  desabos.push(bus.on('seance:abandonner', majTout));
  desabos.push(bus.on('seance:supprimer', majTout));
  desabos.push(bus.on('export:effectue', majRappelExport));

  // Une routine creee ou supprimee depuis #/composer ou #/modeles change la rangee de lancement.
  desabos.push(bus.on('store:commit', ({ type }) => {
    if (typeof type !== 'string') return;
    if (type.indexOf('routine:') === 0 || type.indexOf('modele:') === 0) majLanceurs();
  }));

  // beforeinstallprompt peut arriver APRES le montage : le bandeau se monte alors.
  desabos.push(bus.on('install:disponible', () => {
    if (etat.bandeau || etat.detruit) return;
    etat.bandeau = install.monterBandeau(hoteInstall, { onFerme: () => { etat.bandeau = null; } });
  }));

  etat.bandeau = install.monterBandeau(hoteInstall, { onFerme: () => { etat.bandeau = null; } });

  majTout();

  return {
    destroy() {
      etat.detruit = true;
      for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
      desabos.length = 0;
      if (etat.bandeau) { try { etat.bandeau.detruire(); } catch (_) { /* deja detruit */ } etat.bandeau = null; }
      // La feuille vit dans la zone A, hors du sous-arbre retire ci-dessous : sans cette
      // fermeture explicite elle survivrait au demontage, par-dessus l'ecran suivant.
      if (etat.feuille && typeof etat.feuille.fermer === 'function') {
        try { etat.feuille.fermer(); } catch (_) { /* deja fermee */ }
      }
      etat.feuille = null;
      noeudsSeances.clear();
      noeudsLanceurs.clear();
      if (racine.parentNode) racine.parentNode.removeChild(racine);
    },
    onParams() {
      // L'accueil n'a aucune feuille portee par l'URL : il n'y a rien a resynchroniser.
    }
  };
}

export default { mount };
