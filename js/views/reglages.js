// views/reglages.js — routes #/reglages et #/aide/installation.
//
// Un ecran de reglages n'est pas un ecran de confort dans cette application : c'est celui qui
// porte l'export, c'est-a-dire la SEULE copie des donnees que l'utilisateur controle reellement.
// D'ou l'ordre de la page : la sauvegarde en premier, tout le reste ensuite. Un export enterre
// sous huit interrupteurs est un export qui n'est jamais fait.
//
// Contrat de rendu (zone B) : le DOM est construit UNE FOIS au montage. Aucune fonction ne
// reconstruit la page. Chaque changement d'etat mute des noeuds nommes, conserves dans des
// variables ou dans des petites fabriques de lignes qui possedent leur sous-arbre.

import { h, on, delegate, vider } from '../lib/dom.js';
import * as bus from '../lib/bus.js';
import { formatFr, formatDuree, parseFr } from '../lib/num.js';
import { dayKey, formatLong, joursEntre } from '../lib/dates.js';
import { APP_VERSION, SCHEMA_VERSION, JOURS_AVANT_RAPPEL_EXPORT } from '../config.js';

import * as store from '../data/store.js';
import * as prefs from '../data/prefs.js';
import * as backup from '../data/backup.js';
import { nouveauLieu, nouveauPoids } from '../data/schema.js';

import * as sheet from '../ui/sheet.js';
import * as toast from '../ui/toast.js';
import * as keypad from '../ui/keypad.js';
import { estIOS, estStandalone, estInstallable, proposer } from '../ui/install.js';
import { verifier } from '../ui/update.js';
import { ouvrirFeuille, fermerFeuille, aller } from '../ui/router.js';

// ─────────────────────────────────────────────────────────────────────────────
// Petits utilitaires locaux
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applique le theme sur <html>.
 *
 * ⚠ Duplique volontairement quatre lignes de boot.js : une vue ne peut pas importer boot.js
 *   (c'est la racine de composition, elle importe le routeur qui importe les vues). Personne
 *   d'autre n'ecoute 'prefs:modifiees' pour reappliquer le theme — sans ce code, changer le
 *   theme ici n'aurait aucun effet visible avant le prochain demarrage.
 */
function appliquerTheme(theme) {
  const racine = document.documentElement;
  // 'auto' n'est PAS pose en attribut : data-theme="auto" ne correspondrait a aucun selecteur
  // CSS et figerait l'application sur le theme clair au lieu de suivre le systeme.
  if (theme === 'clair' || theme === 'sombre') racine.setAttribute('data-theme', theme);
  else racine.removeAttribute('data-theme');
}

/** Taille lisible. Les octets bruts d'un storage.estimate() ne disent rien a personne. */
function formatOctets(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return Math.round(n) + ' o';
  if (n < 1024 * 1024) return formatFr(n / 1024, 0) + ' Ko';
  if (n < 1024 * 1024 * 1024) return formatFr(n / (1024 * 1024), 1) + ' Mo';
  return formatFr(n / (1024 * 1024 * 1024), 2) + ' Go';
}

/** Titre de groupe + conteneur. Le groupe possede son sous-arbre, la vue garde le conteneur. */
function groupe(titre, ...enfants) {
  return h('section', { class: 'groupe-reglages' },
    titre ? h('h2', { class: 'groupe-reglages-titre' }, titre) : null,
    ...enfants
  );
}

/** Ligne d'information non tapable : libelle a gauche, valeur a droite. */
function ligneInfo(libelle, valeurNoeud, aide) {
  return h('div', { class: 'ligne-reglage' },
    h('div', {},
      h('div', { class: 'ligne-liste-principal' }, libelle),
      aide ? h('div', { class: 'ligne-reglage-aide' }, aide) : null
    ),
    valeurNoeud
  );
}

/** Ligne tapable : toute la ligne est la cible, pas seulement un chevron de 20 px. */
function ligneAction(libelle, aide, action, valeurNoeud) {
  return h('button', { class: 'ligne-liste', type: 'button', dataset: { action } },
    h('div', {},
      h('div', { class: 'ligne-liste-principal' }, libelle),
      aide ? h('div', { class: 'ligne-liste-secondaire' }, aide) : null
    ),
    valeurNoeud || h('span', { class: 'ligne-liste-secondaire', 'aria-hidden': 'true' }, '›')
  );
}

/**
 * Interrupteur de preference — fragment vivant minuscule.
 * Il possede son sous-arbre et expose `synchroniser()` : personne ne le remplace jamais.
 * La zone tapable est la LIGNE entiere (cf. .ligne-reglage dans components.css).
 */
function interrupteur({ cle, libelle, aide, indisponible }) {
  const pastille = h('span', { class: 'pastille' }, '');
  const racine = h('button', {
    class: 'ligne-reglage',
    type: 'button',
    role: 'switch',
    'aria-checked': 'false',
    disabled: indisponible === true,
    dataset: { action: 'basculer-pref', cle }
  },
    h('div', {},
      h('div', { class: 'ligne-liste-principal' }, libelle),
      aide ? h('div', { class: 'ligne-reglage-aide' }, aide) : null
    ),
    pastille
  );

  function synchroniser(valeur) {
    const actif = valeur === true && indisponible !== true;
    racine.setAttribute('aria-checked', actif ? 'true' : 'false');
    pastille.textContent = indisponible === true ? 'Indisponible' : (actif ? 'Activé' : 'Désactivé');
    if (actif) pastille.setAttribute('data-ton', 'accent');
    else pastille.removeAttribute('data-ton');
  }

  return { cle, racine, synchroniser };
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Element} conteneur le <main> de la zone B
 * @param {Object} params parametres de route (dont `sheet`)
 * @returns {{destroy: Function, onParams: Function}}
 */
export function mount(conteneur, params) {
  // Les deux routes partagent ce module (voir ROUTES dans boot.js). Elles ont des cles de route
  // distinctes : le routeur demonte et remonte, il n'y a donc aucun etat a partager.
  const hash = location.hash || '#/';
  if (hash.indexOf('#/aide/installation') === 0) return monterAide(conteneur);
  return monterReglages(conteneur, params || {});
}

export default { mount };

// ═════════════════════════════════════════════════════════════════════════════
// #/reglages
// ═════════════════════════════════════════════════════════════════════════════

function monterReglages(conteneur, paramsInitiaux) {
  const desabos = [];
  let detruit = false;

  // Etat local de la vue. Aucune de ces valeurs n'est une source de verite : ce sont des copies
  // de travail, relues du store ou des prefs a chaque action.
  let preferences = prefs.lire();
  let analyseImport = null;      // { rapport, donnees } produit par backup.analyserImport
  let poidsConnus = [];          // pesees, antichronologiques
  let feuilleCourante = null;    // nom de la feuille routee actuellement ouverte
  let feuilleOuverte = null;     // instance rendue par sheet.ouvrir

  const racine = h('section', { class: 'vue vue-reglages' });

  // ── 1. Sauvegarde ────────────────────────────────────────────────────────
  // EN HAUT. C'est le filet de securite : trois ans de seances vivent dans un IndexedDB que le
  // navigateur a le droit d'evincer sans prevenir, et l'export est la seule copie que
  // l'utilisateur possede vraiment.

  const etatExport = h('p', { class: 'ligne-reglage-aide', role: 'status' }, '');
  const btnExport = h('button', {
    class: 'bouton bouton-primaire bouton-large', type: 'button', dataset: { action: 'exporter' }
  }, 'Exporter mes données');
  // Conteneur du 3e canal d'export (zone de texte selectionnable). Vide tant qu'il ne sert pas :
  // backup.monterRecoursTexte y construit son propre sous-arbre et le possede.
  const zoneRecours = h('div', {});

  const groupeExport = groupe('Sauvegarde',
    h('div', { class: 'carte', style: { margin: 'var(--esp-3)' } },
      h('p', {},
        'L\'export est la seule copie de tes données que tu contrôles. Fais-le régulièrement et ' +
        'range le fichier ailleurs que sur ce téléphone.'),
      btnExport,
      etatExport,
      zoneRecours
    )
  );

  // ── 2. Import ────────────────────────────────────────────────────────────
  // Analyser d'abord, montrer le rapport, demander la strategie, n'ecrire qu'apres confirmation.
  // Remplacer trois ans de seances sans savoir ce que contient le fichier est irrattrapable.

  const champFichier = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    'aria-label': 'Choisir un fichier de sauvegarde'
  });

  const rapportImport = h('pre', { class: 'rapport-import', hidden: true, role: 'status' }, '');

  const btnFusionner = h('button', {
    class: 'bouton bouton-primaire bouton-large', type: 'button', dataset: { action: 'import-fusionner' }
  }, 'Fusionner avec mes données');

  const btnRemplacer = h('button', {
    class: 'bouton bouton-danger bouton-large', type: 'button', dataset: { action: 'import-remplacer' }
  }, 'Tout remplacer');

  const choixImport = h('div', { hidden: true },
    h('p', { class: 'ligne-reglage-aide', style: { padding: '0 var(--esp-4)' } },
      'Fusionner conserve tes données actuelles et ajoute ce qui manque ; en cas de doublon, ' +
      'l\'enregistrement le plus récemment modifié gagne.'),
    h('div', { style: { padding: '0 var(--esp-4) var(--esp-3)' } }, btnFusionner),
    h('div', { class: 'zone-danger' },
      h('p', {},
        'Tout remplacer efface les séances, exercices, modèles, lieux et pesées présents sur cet ' +
        'appareil, puis écrit ceux du fichier. Cette action est irréversible.'),
      btnRemplacer
    )
  );

  const bilanImport = h('div', { hidden: true, style: { padding: 'var(--esp-3) var(--esp-4)' } });

  const groupeImport = groupe('Importer une sauvegarde',
    h('div', { style: { padding: 'var(--esp-3) var(--esp-4)' } },
      h('p', { class: 'ligne-reglage-aide' },
        'Rien n\'est écrit avant que tu aies lu le rapport et choisi.'),
      h('button', { class: 'bouton bouton-large', type: 'button', dataset: { action: 'import-fichier' } },
        'Choisir un fichier…'),
      h('button', { class: 'bouton bouton-large', type: 'button', dataset: { action: 'import-texte' } },
        'Coller le contenu d\'une sauvegarde'),
      champFichier
    ),
    rapportImport,
    choixImport,
    bilanImport
  );

  // ── 3. Maintenance ───────────────────────────────────────────────────────

  const etatDerives = h('span', { class: 'ligne-liste-secondaire', role: 'status' }, '');
  const groupeMaintenance = groupe('Maintenance',
    ligneAction('Recalculer les données dérivées',
      'Reconstruit les rappels « Dernière fois » à partir de tout l\'historique. Sans effet sur ' +
      'tes séances.',
      'recalculer', etatDerives)
  );

  // ── 4. Poids de corps ────────────────────────────────────────────────────

  const valeurPoidsJour = h('span', { class: 'ligne-liste-secondaire' }, '—');
  const listePoids = h('div', { class: 'liste' });
  const lignesPoids = new Map();   // date -> { racine, maj }
  const videPoids = h('p', { class: 'ligne-reglage-aide', style: { padding: 'var(--esp-3) var(--esp-4)' } },
    'Chargement des pesées…');

  const groupePoids = groupe('Poids de corps',
    ligneAction('Mon poids aujourd\'hui',
      'Sert à calculer la charge effective des tractions, pompes et dips.',
      'saisir-poids', valeurPoidsJour),
    videPoids,
    listePoids
  );

  // ── 5. Lieux ─────────────────────────────────────────────────────────────

  const listeLieux = h('div', { class: 'liste' });
  const lignesLieux = new Map();   // id -> { racine, maj }
  const videLieux = h('p', { class: 'ligne-reglage-aide', style: { padding: 'var(--esp-3) var(--esp-4)' } },
    'Aucun lieu enregistré. Un lieu sert à mémoriser les réglages de machines propres à ta salle.');

  const groupeLieux = groupe('Lieux d\'entraînement',
    videLieux,
    listeLieux,
    h('div', { style: { padding: 'var(--esp-3) var(--esp-4)' } },
      h('button', { class: 'bouton bouton-large', type: 'button', dataset: { action: 'lieu-creer' } },
        'Ajouter un lieu'))
  );

  // ── 6. Apparence ─────────────────────────────────────────────────────────

  const THEMES = [
    { cle: 'clair', libelle: 'Clair' },
    { cle: 'sombre', libelle: 'Sombre' },
    { cle: 'auto', libelle: 'Système' }
  ];
  const segmentsTheme = THEMES.map((t) => h('button', {
    class: 'segment', type: 'button', role: 'tab', 'aria-selected': 'false',
    dataset: { action: 'theme', theme: t.cle }
  }, t.libelle));

  const groupeApparence = groupe('Apparence',
    h('div', { class: 'ligne-reglage' },
      h('div', {},
        h('div', { class: 'ligne-liste-principal' }, 'Thème'),
        h('div', { class: 'ligne-reglage-aide' },
          '« Système » suit le réglage clair/sombre du téléphone.')
      )
    ),
    h('div', { style: { padding: '0 var(--esp-4) var(--esp-3)' } },
      h('div', { class: 'segments', role: 'tablist', 'aria-label': 'Thème' }, ...segmentsTheme))
  );

  // ── 7. Pendant la séance ─────────────────────────────────────────────────

  const wakeLockDispo = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const interrupteurs = [
    interrupteur({
      cle: 'son',
      libelle: 'Bip de fin de repos',
      aide: 'Reste silencieux si le téléphone est en mode silencieux.'
    }),
    interrupteur({
      cle: 'vibration',
      libelle: 'Vibration de fin de repos',
      aide: 'Sans aucun effet sur iPhone : Safari n\'implémente pas la vibration.'
    }),
    interrupteur({
      cle: 'wakeLockRepos',
      libelle: 'Garder l\'écran allumé pendant le repos',
      aide: wakeLockDispo
        ? 'Garde l\'écran allumé pendant le repos — consomme de la batterie et chauffe le téléphone.'
        : 'Garde l\'écran allumé pendant le repos. Ton navigateur ne propose pas cette fonction ' +
          '(absente de Safari avant iOS 16.4).',
      indisponible: !wakeLockDispo
    }),
    interrupteur({
      cle: 'clavierSysteme',
      libelle: 'Utiliser le clavier du téléphone',
      aide: 'Remplace le pavé numérique de l\'application par le clavier système. Sur iPhone, ' +
        'celui-ci fait zoomer la page à chaque saisie.'
    })
  ];

  const valeurRepos = h('span', { class: 'ligne-liste-secondaire' }, '');

  const groupeSeance = groupe('Pendant la séance',
    ligneAction('Repos par défaut', 'Utilisé quand l\'exercice n\'en impose pas.',
      'repos-defaut', valeurRepos),
    ...interrupteurs.map((i) => i.racine)
  );

  // ── 8. Stockage ──────────────────────────────────────────────────────────

  const valeurUsage = h('span', { class: 'ligne-liste-secondaire' }, 'Calcul…');
  const valeurPersistance = h('span', { class: 'ligne-liste-secondaire' }, 'Vérification…');
  const btnPersister = h('button', {
    class: 'bouton bouton-large', type: 'button', hidden: true, dataset: { action: 'persister' }
  }, 'Demander la persistance du stockage');

  const groupeStockage = groupe('Stockage',
    ligneInfo('Espace utilisé', valeurUsage),
    ligneInfo('Stockage persistant', valeurPersistance),
    h('div', { style: { padding: '0 var(--esp-4) var(--esp-3)' } }, btnPersister),
    // Hierarchie de protection, dite honnetement. Presenter ces trois lignes comme une « defense
    // en profondeur » serait un mensonge : sur iPhone, la troisieme n'existe simplement pas.
    h('div', { class: 'avertissement' },
      h('p', {},
        h('strong', {}, 'Ce qui protège vraiment tes données, dans l\'ordre :')),
      h('p', {},
        '1. L\'export manuel. C\'est le seul filet réel : la seule copie qui ne dépend ni de ce ' +
        'navigateur, ni de ce téléphone.'),
      h('p', {},
        '2. Installer l\'application sur l\'écran d\'accueil. Un navigateur évince en priorité ' +
        'les sites simplement visités. Cela aide, cela ne garantit rien.'),
      h('p', {},
        '3. La persistance du stockage. Elle n\'existe pas sur Safari : sur iPhone et iPad, ' +
        'cette protection-là est inexistante, quoi qu\'affiche cette page.')
    )
  );

  // ── 9. À propos ──────────────────────────────────────────────────────────

  // v4 : verification manuelle de mise a jour — l'utilisateur a du changer de navigateur pour
  // voir une nouvelle version, ce bouton lui evite d'attendre le prochain passage du throttle.
  const etatMaj = h('span', { class: 'ligne-liste-secondaire', role: 'status' }, '');
  let verificationMajEnCours = false;

  const groupeApropos = groupe('À propos',
    ligneInfo('Version de l\'application',
      h('span', { class: 'ligne-liste-secondaire' }, APP_VERSION)),
    ligneInfo('Version du schéma de données',
      h('span', { class: 'ligne-liste-secondaire' }, String(SCHEMA_VERSION))),
    ligneAction('Rechercher une mise à jour',
      'Compare la version installée à la dernière publiée.',
      'verifier-maj', etatMaj),
    h('p', { class: 'ligne-reglage-aide', style: { padding: '0 var(--esp-4) var(--esp-3)' } },
      'Après une publication, la mise à jour peut mettre jusqu\'à 10 minutes à apparaître ' +
      '(cache du CDN de GitHub Pages).'),
    h('a', { class: 'ligne-liste', href: '#/aide/installation' },
      h('div', {},
        h('div', { class: 'ligne-liste-principal' }, 'Installer l\'application'),
        h('div', { class: 'ligne-liste-secondaire' }, 'Instructions Android et iPhone')),
      h('span', { class: 'ligne-liste-secondaire', 'aria-hidden': 'true' }, '›')),
    // Chemin RELATIF : « /verif.html » pointerait hors du depot sur GitHub Pages.
    h('a', {
      class: 'ligne-liste', href: './verif.html', target: '_blank', rel: 'noopener'
    },
      h('div', {},
        h('div', { class: 'ligne-liste-principal' }, 'Diagnostic des fichiers'),
        h('div', { class: 'ligne-liste-secondaire' },
          'Vérifie que tous les fichiers de l\'application répondent. S\'ouvre hors de l\'application.')),
      h('span', { class: 'ligne-liste-secondaire', 'aria-hidden': 'true' }, '↗'))
  );

  racine.appendChild(groupeExport);
  racine.appendChild(groupeImport);
  racine.appendChild(groupeMaintenance);
  racine.appendChild(groupePoids);
  racine.appendChild(groupeLieux);
  racine.appendChild(groupeApparence);
  racine.appendChild(groupeSeance);
  racine.appendChild(groupeStockage);
  racine.appendChild(groupeApropos);
  conteneur.appendChild(racine);

  // ═══════════════════════════════════════════════════════════════════════
  // Synchronisations ciblees — aucune ne reconstruit quoi que ce soit
  // ═══════════════════════════════════════════════════════════════════════

  function majEtatExport() {
    const at = preferences.dernierExportAt;
    if (!at) {
      etatExport.textContent = 'Aucune sauvegarde n\'a encore été faite depuis ce téléphone.';
      return;
    }
    const jours = joursEntre(dayKey(new Date(at)), dayKey(new Date()));
    if (jours != null && jours >= JOURS_AVANT_RAPPEL_EXPORT) {
      etatExport.textContent = 'Dernière sauvegarde il y a ' + jours + ' jours (' +
        formatLong(dayKey(new Date(at))) + '). C\'est beaucoup : refais-en une.';
      return;
    }
    etatExport.textContent = 'Dernière sauvegarde : ' + formatLong(dayKey(new Date(at))) +
      (jours === 0 ? ' (aujourd\'hui).' : '.');
  }

  function majTheme() {
    for (const btn of segmentsTheme) {
      const actif = btn.getAttribute('data-theme') === preferences.theme;
      btn.setAttribute('aria-selected', actif ? 'true' : 'false');
    }
  }

  function majInterrupteurs() {
    for (const i of interrupteurs) i.synchroniser(preferences[i.cle]);
  }

  function majRepos() {
    valeurRepos.textContent = formatDuree(preferences.reposParDefautSec);
  }

  function majPreferences() {
    preferences = prefs.lire();
    majTheme();
    majInterrupteurs();
    majRepos();
    majEtatExport();
  }

  // ── Poids ────────────────────────────────────────────────────────────────

  function poidsDuJour() {
    const cle = dayKey(new Date());
    return poidsConnus.find((p) => p.date === cle) || null;
  }

  function majPoidsJour() {
    const p = poidsDuJour();
    valeurPoidsJour.textContent = p && p.kg != null ? formatFr(p.kg) + ' kg' : 'Non renseigné';
  }

  /** Fabrique de ligne de pesee. Elle possede son sous-arbre : rien ne la remplace. */
  function ligneDePoids(p) {
    const valeur = h('span', { class: 'ligne-liste-secondaire' }, '');
    const source = h('span', { class: 'ligne-liste-secondaire' }, '');
    const racineLigne = h('div', { class: 'ligne-reglage' },
      h('div', {},
        h('div', { class: 'ligne-liste-principal' }, formatLong(p.date)),
        source),
      valeur
    );
    function maj(pesee) {
      valeur.textContent = pesee.kg != null ? formatFr(pesee.kg) + ' kg' : '—';
      source.textContent = pesee.source === 'seance' ? 'Saisi au lancement d\'une séance' : 'Saisi à la main';
    }
    maj(p);
    return { racine: racineLigne, maj };
  }

  function insererPoids(p) {
    const existante = lignesPoids.get(p.date);
    if (existante) { existante.maj(p); return; }
    const ligne = ligneDePoids(p);
    lignesPoids.set(p.date, ligne);
    // Antichronologique : la pesee du jour se place en tete, les anciennes suivent.
    const suivante = Array.from(lignesPoids.keys())
      .filter((d) => d < p.date)
      .sort()
      .pop();
    const noeudSuivant = suivante ? lignesPoids.get(suivante).racine : null;
    if (noeudSuivant) listePoids.insertBefore(ligne.racine, noeudSuivant);
    else listePoids.appendChild(ligne.racine);
    videPoids.hidden = lignesPoids.size > 0;
  }

  /**
   * Charge l'historique des pesees.
   * ⚠ data/store.js n'expose AUCUN lecteur pour le magasin `poids` (ni `poids()`, ni un
   *   equivalent de `chargerHistorique`). construireExport() est le seul chemin de la couche
   *   data/ qui les rend lisibles depuis une vue — une vue ne doit jamais ouvrir IndexedDB
   *   elle-meme. Le cout (serialisation de toute la base) est assume ici, et seulement ici.
   */
  async function chargerPoids() {
    try {
      const { enveloppe } = await backup.construireExport();
      if (detruit) return;
      const brut = (enveloppe && enveloppe.data && enveloppe.data.poids) || [];
      poidsConnus = brut.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      // 30 pesees suffisent : au-dela, c'est la courbe de progression qui est l'outil de lecture.
      for (const p of poidsConnus.slice(0, 30)) insererPoids(p);
      videPoids.textContent = 'Aucune pesée enregistrée pour l\'instant.';
      videPoids.hidden = lignesPoids.size > 0;
      majPoidsJour();
    } catch (err) {
      if (detruit) return;
      videPoids.textContent = 'Historique des pesées illisible : ' + (err && err.message ? err.message : 'erreur inconnue');
      videPoids.hidden = false;
    }
  }

  // ── Lieux ────────────────────────────────────────────────────────────────

  function ligneDeLieu(l) {
    const nom = h('div', { class: 'ligne-liste-principal' }, l.nom || 'Sans nom');
    const etat = h('div', { class: 'ligne-liste-secondaire' }, '');
    const btnArchiver = h('button', {
      class: 'bouton bouton-fantome', type: 'button', dataset: { action: 'lieu-archiver', id: l.id }
    }, '');
    const racineLigne = h('div', { class: 'ligne-reglage', dataset: { archive: 'non' } },
      h('button', {
        type: 'button', style: { textAlign: 'left' },
        dataset: { action: 'lieu-renommer', id: l.id }
      }, nom, etat),
      btnArchiver
    );
    function maj(lieu) {
      nom.textContent = lieu.nom || 'Sans nom';
      etat.textContent = lieu.archived ? 'Archivé — conservé, car des séances le référencent' : 'Actif';
      racineLigne.setAttribute('data-archive', lieu.archived ? 'oui' : 'non');
      btnArchiver.textContent = lieu.archived ? 'Réactiver' : 'Archiver';
    }
    maj(l);
    return { racine: racineLigne, maj };
  }

  function insererLieu(l) {
    const existante = lignesLieux.get(l.id);
    if (existante) { existante.maj(l); return; }
    const ligne = ligneDeLieu(l);
    lignesLieux.set(l.id, ligne);
    listeLieux.appendChild(ligne.racine);
    videLieux.hidden = lignesLieux.size > 0;
  }

  function chargerLieux() {
    for (const l of store.lieux()) insererLieu(l);
    videLieux.hidden = lignesLieux.size > 0;
  }

  // ── Stockage ─────────────────────────────────────────────────────────────

  async function majStockage() {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const st = nav && nav.storage;

    if (!st || typeof st.estimate !== 'function') {
      valeurUsage.textContent = 'Information indisponible';
    } else {
      try {
        const { usage, quota } = await st.estimate();
        if (detruit) return;
        valeurUsage.textContent = quota
          ? formatOctets(usage) + ' sur ' + formatOctets(quota)
          : formatOctets(usage);
      } catch (_) {
        if (detruit) return;
        valeurUsage.textContent = 'Information indisponible';
      }
    }

    // ⚠ persisted() n'existe PAS sur Safari. L'absence de la fonction n'est donc pas un detail
    //   technique a masquer : c'est l'information la plus importante de ce bloc.
    if (!st || typeof st.persisted !== 'function') {
      valeurPersistance.textContent = 'Non implémenté par ce navigateur';
      btnPersister.hidden = true;
      return;
    }
    try {
      const persistant = await st.persisted();
      if (detruit) return;
      valeurPersistance.textContent = persistant ? 'Accordé' : 'Non accordé';
      btnPersister.hidden = persistant || typeof st.persist !== 'function';
    } catch (_) {
      if (detruit) return;
      valeurPersistance.textContent = 'Vérification impossible';
      btnPersister.hidden = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Saisie d'un nombre — pave in-app, ou clavier systeme si l'utilisateur l'a choisi
  // ═══════════════════════════════════════════════════════════════════════

  function demanderNombre(champ, onValider) {
    if (!preferences.clavierSysteme) {
      keypad.ouvrir({ champs: [champ], onValider: (valeurs) => onValider(valeurs[champ.cle]) });
      return;
    }
    // Repli clavier systeme : obligatoire, pas optionnel. inputmode='decimal' fait apparaitre le
    // pave numerique du telephone ; parseFr accepte la virgule comme le point.
    const saisie = h('input', {
      type: 'text', inputmode: 'decimal', class: 'champ-recherche',
      value: champ.valeur == null ? '' : formatFr(champ.valeur),
      'aria-label': champ.label
    });
    const erreur = h('p', { class: 'ligne-reglage-aide', role: 'alert' }, '');
    sheet.ouvrir({
      titre: champ.label,
      contenu: [saisie, champ.unite ? h('p', { class: 'ligne-reglage-aide' }, 'En ' + champ.unite) : null, erreur],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Valider',
          variante: 'primaire',
          action() {
            const n = parseFr(saisie.value);
            if (n == null) { erreur.textContent = 'Valeur illisible. Utilise des chiffres.'; return false; }
            if (champ.min != null && n < champ.min) { erreur.textContent = 'Minimum : ' + formatFr(champ.min); return false; }
            if (champ.max != null && n > champ.max) { erreur.textContent = 'Maximum : ' + formatFr(champ.max); return false; }
            onValider(n);
          }
        }
      ]
    });
    try { saisie.focus(); } catch (_) { /* focus refuse : la saisie reste tapable */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════════════

  async function actionExporter() {
    btnExport.disabled = true;
    etatExport.textContent = 'Préparation de la sauvegarde…';
    vider(zoneRecours);
    try {
      // conteneurRecours fourni : le 3e canal se monte ICI, sous le bouton, plutot que d'etre
      // emis sur le bus et de n'etre affiche nulle part.
      const canal = await backup.exporter({ conteneurRecours: zoneRecours });
      if (detruit) return;

      if (canal === 'partage') {
        etatExport.textContent = 'Sauvegarde envoyée au partage. Vérifie qu\'elle est bien arrivée à destination.';
      } else if (canal === 'telechargement') {
        etatExport.textContent = 'Sauvegarde téléchargée. Retrouve-la dans les fichiers de ton téléphone.';
      } else if (canal === 'texte') {
        etatExport.textContent = 'Ni partage ni téléchargement disponibles ici : copie le texte ci-dessous et conserve-le.';
      } else {
        etatExport.textContent = 'Partage annulé — aucune sauvegarde n\'a été enregistrée.';
      }

      if (canal === 'partage' || canal === 'telechargement') {
        // backup.exporter a deja ecrit prefs.dernierExportAt. On aligne meta pour que l'accueil,
        // qui lit le store, cesse d'afficher son rappel.
        try { await store.commit('export:effectue', { at: Date.now() }); }
        catch (err) { console.warn('[reglages] meta.dernierExportAt non mis a jour', err); }
        preferences = prefs.lire();
        if (!detruit) majEtatExport();
      }
    } catch (err) {
      if (detruit) return;
      // Un export qui echoue doit le DIRE. Un bouton qui ne fait visiblement rien laisserait
      // croire a une sauvegarde qui n'existe pas.
      etatExport.textContent = 'L\'export a échoué : ' + (err && err.message ? err.message : 'erreur inconnue') +
        '. Tes données ne sont pas perdues, réessaie.';
    } finally {
      if (!detruit) btnExport.disabled = false;
    }
  }

  function afficherAnalyse(texte) {
    const resultat = backup.analyserImport(texte);
    analyseImport = resultat.ok ? resultat : null;

    rapportImport.textContent = resultat.rapport.lignes.join('\n');
    rapportImport.hidden = false;
    choixImport.hidden = !resultat.ok;
    bilanImport.hidden = true;
    vider(bilanImport);

    if (!resultat.ok) toast.afficher('Sauvegarde non importable', { duree: 6000 });
  }

  async function lireFichier(fichier) {
    try {
      const texte = typeof fichier.text === 'function'
        ? await fichier.text()
        : await new Promise((resolve, reject) => {
          // Repli pour les WebView anciennes ou Blob.text() n'existe pas.
          const lecteur = new FileReader();
          lecteur.onload = () => resolve(String(lecteur.result || ''));
          lecteur.onerror = () => reject(lecteur.error || new Error('Lecture du fichier impossible.'));
          lecteur.readAsText(fichier);
        });
      if (detruit) return;
      afficherAnalyse(texte);
    } catch (err) {
      if (detruit) return;
      rapportImport.textContent = 'Fichier illisible : ' + (err && err.message ? err.message : 'erreur inconnue');
      rapportImport.hidden = false;
      choixImport.hidden = true;
    }
  }

  function confirmerImport(strategie) {
    if (!analyseImport) return;
    const remplace = strategie === 'remplacer';
    sheet.ouvrir({
      titre: remplace ? 'Tout remplacer ?' : 'Fusionner ?',
      contenu: [
        h('p', {}, remplace
          ? 'Les séances, exercices, modèles, lieux et pesées de cet appareil seront effacés et ' +
            'remplacés par ceux du fichier. Il n\'y a pas de retour en arrière.'
          : 'Les données du fichier seront ajoutées aux tiennes. En cas de doublon, ' +
            'l\'enregistrement le plus récemment modifié est conservé.'),
        remplace
          ? h('p', { class: 'ligne-reglage-aide' },
            'Si tu n\'as pas exporté tes données actuelles, ferme cette fenêtre et fais-le d\'abord.')
          : null,
        h('pre', { class: 'rapport-import' }, analyseImport.rapport.lignes.join('\n'))
      ],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: remplace ? 'Remplacer définitivement' : 'Fusionner',
          variante: remplace ? 'danger' : 'primaire',
          action() { appliquer(strategie); }
        }
      ]
    });
  }

  async function appliquer(strategie) {
    const donnees = analyseImport && analyseImport.donnees;
    if (!donnees) return;
    btnFusionner.disabled = true;
    btnRemplacer.disabled = true;
    try {
      const bilan = await backup.appliquerImport(donnees, strategie);
      if (detruit) return;

      const lignes = Object.keys(bilan.ecrits)
        .map((nom) => nom + ' : ' + bilan.ecrits[nom])
        .join(' · ');

      vider(bilanImport);
      bilanImport.appendChild(h('p', {},
        'Import terminé (' + (strategie === 'remplacer' ? 'remplacement' : 'fusion') + '). ' + lignes + '.'));
      if (bilan.fantomes.length) {
        bilanImport.appendChild(h('p', { class: 'ligne-reglage-aide' },
          bilan.fantomes.length + ' exercice(s) manquant(s) ont été recréés archivés pour que ' +
          'l\'historique reste lisible : ' + bilan.fantomes.map((f) => f.nom).join(', ') + '.'));
      }
      // ⚠ Les caches memoire de store.js ont ete ecrits par-dessous : personne n'ecoute
      //   'donnees:importees' pour les recharger, et store.js n'expose pas de reinitialisation.
      //   Un rechargement complet est la seule facon HONNETE de repartir d'un etat coherent.
      bilanImport.appendChild(h('p', {},
        'Recharge l\'application pour utiliser ces données, puis lance « Recalculer les données ' +
        'dérivées » : les rappels « Dernière fois » datent encore d\'avant l\'import.'));
      bilanImport.appendChild(h('button', {
        class: 'bouton bouton-primaire bouton-large', type: 'button', dataset: { action: 'recharger' }
      }, 'Recharger l\'application'));
      bilanImport.hidden = false;

      choixImport.hidden = true;
      analyseImport = null;
    } catch (err) {
      if (detruit) return;
      vider(bilanImport);
      bilanImport.appendChild(h('p', {},
        'L\'import a échoué : ' + (err && err.message ? err.message : 'erreur inconnue')));
      bilanImport.hidden = false;
    } finally {
      if (detruit) return;
      btnFusionner.disabled = false;
      btnRemplacer.disabled = false;
    }
  }

  async function actionRecalculer() {
    etatDerives.textContent = 'Calcul…';
    try {
      const lastPerf = await store.recalculerDerives();
      if (detruit) return;
      etatDerives.textContent = Object.keys(lastPerf || {}).length + ' exercice(s) à jour';
      toast.afficher('Données dérivées recalculées', { duree: 5000 });
    } catch (err) {
      if (detruit) return;
      etatDerives.textContent = 'Échec';
      toast.afficher('Recalcul impossible : ' + (err && err.message ? err.message : 'erreur'), { duree: 8000 });
    }
  }

  function actionSaisirPoids() {
    const actuel = poidsDuJour();
    demanderNombre({
      cle: 'kg',
      label: 'Poids de corps (kg)',
      valeur: actuel ? actuel.kg : null,
      unite: 'kg',
      pas: 0.1,
      min: 20,
      max: 400
    }, async (kg) => {
      if (kg == null) return;
      const pesee = nouveauPoids({ date: dayKey(new Date()), kg, source: 'manuel' });
      try {
        await store.commit('poids:enregistrer', { poids: pesee });
        if (detruit) return;
        // Etat local tenu a jour a la main : la date etant la cle primaire, une re-saisie du jour
        // ecrase, elle n'empile pas.
        poidsConnus = poidsConnus.filter((p) => p.date !== pesee.date);
        poidsConnus.unshift(pesee);
        insererPoids(pesee);
        majPoidsJour();
        toast.afficher('Poids enregistré : ' + formatFr(kg) + ' kg', { duree: 5000 });
      } catch (err) {
        if (detruit) return;
        toast.afficher('Enregistrement impossible : ' + (err && err.message ? err.message : 'erreur'), { duree: 8000 });
      }
    });
  }

  function actionReposDefaut() {
    demanderNombre({
      cle: 'sec',
      label: 'Repos par défaut (secondes)',
      valeur: preferences.reposParDefautSec,
      unite: 's',
      pas: 15,
      entier: true,
      min: 15,
      max: 900,
      format: (v) => formatDuree(v)
    }, (sec) => {
      if (sec == null) return;
      prefs.ecrire({ reposParDefautSec: Math.round(sec) });
      // majPreferences est declenche par l'evenement 'prefs:modifiees' : rien a faire ici.
    });
  }

  async function actionPersister() {
    const st = navigator && navigator.storage;
    if (!st || typeof st.persist !== 'function') return;
    btnPersister.disabled = true;
    try {
      const accorde = await st.persist();
      if (detruit) return;
      toast.afficher(accorde
        ? 'Stockage persistant accordé. Cela aide, mais ne remplace pas un export.'
        : 'Le navigateur a refusé. Seul l\'export protège vraiment tes données.', { duree: 8000 });
      await majStockage();
    } catch (_) {
      if (!detruit) btnPersister.disabled = false;
      return;
    }
    if (!detruit) btnPersister.disabled = false;
  }

  /**
   * Verification manuelle de mise a jour. verifier({ force: true }) ignore le throttle de
   * 15 minutes et ne rejette jamais : elle rend une issue, traduite ici en toast. L'affichage
   * du bandeau « recharger », lui, reste entierement pilote par ui/update.js.
   */
  async function actionVerifierMaj() {
    if (verificationMajEnCours) return;
    verificationMajEnCours = true;
    etatMaj.textContent = 'Vérification…';
    try {
      const issue = await verifier({ force: true });
      if (detruit) return;
      if (issue === 'a-jour') {
        etatMaj.textContent = 'À jour';
        toast.afficher('Application à jour.', { duree: 5000 });
      } else if (issue === 'precache') {
        etatMaj.textContent = 'Téléchargement…';
        toast.afficher('Nouvelle version en téléchargement… Un bandeau proposera de recharger ' +
          'dès qu\'elle sera prête.', { duree: 8000 });
      } else if (issue === 'kill') {
        etatMaj.textContent = '—';
        toast.afficher('Cette version a été désactivée : un rechargement va être proposé.', { duree: 8000 });
      } else if (issue === 'indisponible') {
        etatMaj.textContent = '—';
        toast.afficher('Vérification indisponible : ce navigateur ne prend pas en charge la ' +
          'mise à jour automatique.', { duree: 8000 });
      } else {
        etatMaj.textContent = 'Échec';
        toast.afficher('Vérification impossible. Es-tu hors ligne ?', { duree: 8000 });
      }
    } finally {
      verificationMajEnCours = false;
    }
  }

  async function actionArchiverLieu(id) {
    const l = store.lieu(id);
    if (!l) return;
    try {
      // Archiver, jamais supprimer : des seances referencent ce lieu a vie, et les profils de
      // machines y sont accroches. La ligne est mise a jour par l'abonnement bus.
      await store.commit('lieu:archiver', { id, archived: !l.archived });
    } catch (err) {
      if (detruit) return;
      toast.afficher('Action impossible : ' + (err && err.message ? err.message : 'erreur'), { duree: 8000 });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Feuilles routees — une feuille est un PARAMETRE de la route, jamais une route
  // ═══════════════════════════════════════════════════════════════════════

  function fermerFeuilleCourante() {
    feuilleCourante = null;
    if (feuilleOuverte) { const f = feuilleOuverte; feuilleOuverte = null; f.fermer(); }
  }

  function feuilleLieu(params) {
    const id = params.lieuId || null;
    const existant = id ? store.lieu(id) : null;
    const saisie = h('input', {
      type: 'text', class: 'champ-recherche', autocomplete: 'off',
      value: existant ? existant.nom : '',
      'aria-label': 'Nom du lieu'
    });
    const erreur = h('p', { class: 'ligne-reglage-aide', role: 'alert' }, '');

    feuilleOuverte = sheet.ouvrir({
      titre: existant ? 'Renommer le lieu' : 'Nouveau lieu',
      contenu: [
        h('p', { class: 'ligne-reglage-aide' },
          'Un lieu est une entité, pas un texte libre : c\'est lui qui porte les réglages de ' +
          'machines propres à cette salle.'),
        saisie,
        erreur
      ],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: existant ? 'Renommer' : 'Créer',
          variante: 'primaire',
          action() {
            const nom = String(saisie.value || '').trim();
            if (!nom) { erreur.textContent = 'Donne un nom à ce lieu.'; return false; }
            const lieu = existant
              ? Object.assign({}, existant, { nom })
              : nouveauLieu({ nom });
            // L'insertion de la ligne n'est PAS faite ici : elle arrive par l'abonnement bus a
            // 'lieu:enregistrer', qui couvre aussi les creations venues d'un autre ecran.
            store.commit('lieu:enregistrer', { lieu })
              .catch((err) => toast.afficher('Enregistrement impossible : ' +
                (err && err.message ? err.message : 'erreur'), { duree: 8000 }));
          }
        }
      ],
      onFermer() { feuilleOuverte = null; if (feuilleCourante) { feuilleCourante = null; fermerFeuille(); } }
    });
    try { saisie.focus(); } catch (_) { /* sans consequence */ }
  }

  function feuilleImportTexte() {
    const zone = h('textarea', {
      class: 'zone-texte-export', rows: 10, spellcheck: 'false',
      'aria-label': 'Contenu de la sauvegarde à importer'
    });
    feuilleOuverte = sheet.ouvrir({
      titre: 'Coller une sauvegarde',
      contenu: [
        h('p', { class: 'ligne-reglage-aide' },
          'Colle ici le contenu complet d\'un fichier de sauvegarde. Rien ne sera écrit : ' +
          'tu verras d\'abord le rapport.'),
        zone
      ],
      actions: [
        { libelle: 'Annuler', variante: 'fantome' },
        {
          libelle: 'Analyser',
          variante: 'primaire',
          action() { afficherAnalyse(String(zone.value || '')); }
        }
      ],
      onFermer() { feuilleOuverte = null; if (feuilleCourante) { feuilleCourante = null; fermerFeuille(); } }
    });
    try { zone.focus(); } catch (_) { /* sans consequence */ }
  }

  const FEUILLES = { lieu: feuilleLieu, 'import-texte': feuilleImportTexte };

  /**
   * Aligne la feuille reellement ouverte sur le parametre `sheet` de la route.
   * ⚠ feuilleCourante est mis a jour AVANT la fermeture : l'`onFermer` de la feuille sortante
   *   verifie ce drapeau pour decider s'il doit, lui aussi, retirer `?sheet=…` de l'URL. Le poser
   *   apres provoquerait un second history.back() et ferait sortir de l'ecran des reglages.
   */
  function synchroniserFeuille(params) {
    const voulue = (params && params.sheet) || null;
    if (voulue === feuilleCourante) return;
    const fabrique = voulue ? FEUILLES[voulue] : null;
    feuilleCourante = fabrique ? voulue : null;
    if (feuilleOuverte) { const f = feuilleOuverte; feuilleOuverte = null; f.fermer(); }
    if (fabrique) fabrique(params || {});
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Un seul ecouteur click, delegue, sur la racine de la vue
  // ═══════════════════════════════════════════════════════════════════════

  desabos.push(delegate(racine, 'click', '[data-action]', (ev, cible) => {
    const action = cible.getAttribute('data-action');
    switch (action) {
      case 'exporter': actionExporter(); break;
      case 'import-fichier': champFichier.click(); break;
      case 'import-texte': ouvrirFeuille('import-texte'); break;
      case 'import-fusionner': confirmerImport('fusionner'); break;
      case 'import-remplacer': confirmerImport('remplacer'); break;
      case 'recharger': location.reload(); break;
      case 'recalculer': actionRecalculer(); break;
      case 'saisir-poids': actionSaisirPoids(); break;
      case 'lieu-creer': ouvrirFeuille('lieu'); break;
      case 'lieu-renommer': ouvrirFeuille('lieu', { lieuId: cible.getAttribute('data-id') }); break;
      case 'lieu-archiver': actionArchiverLieu(cible.getAttribute('data-id')); break;
      case 'repos-defaut': actionReposDefaut(); break;
      case 'persister': actionPersister(); break;
      case 'theme': {
        const theme = cible.getAttribute('data-theme');
        prefs.ecrire({ theme });
        appliquerTheme(theme);
        break;
      }
      case 'basculer-pref': {
        const cle = cible.getAttribute('data-cle');
        prefs.ecrire({ [cle]: !prefs.lire()[cle] });
        break;
      }
      default: break;
    }
  }));

  desabos.push(on(champFichier, 'change', () => {
    const fichier = champFichier.files && champFichier.files[0];
    // La valeur est remise a zero pour que re-choisir LE MEME fichier reemette bien 'change'.
    if (fichier) lireFichier(fichier);
    champFichier.value = '';
  }));

  // Une modification de preference peut venir d'ailleurs (import, autre écran) : on se cale sur
  // l'evenement plutot que sur le clic, ce qui evite un etat d'interrupteur qui ment.
  desabos.push(bus.on('prefs:modifiees', () => { if (!detruit) majPreferences(); }));
  desabos.push(bus.on('lieu:enregistrer', ({ lieu }) => { if (!detruit && lieu) insererLieu(lieu); }));
  desabos.push(bus.on('lieu:archiver', ({ lieu }) => { if (!detruit && lieu) insererLieu(lieu); }));

  // ── Peinture initiale ────────────────────────────────────────────────────
  majPreferences();
  chargerLieux();
  majPoidsJour();
  chargerPoids();
  majStockage();
  synchroniserFeuille(paramsInitiaux);

  return {
    destroy() {
      detruit = true;
      for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
      desabos.length = 0;
      fermerFeuilleCourante();
      lignesPoids.clear();
      lignesLieux.clear();
      vider(conteneur);
    },
    onParams(p) {
      // Seul le parametre de feuille change ici : la vue n'est jamais remontee, donc ni le
      // scroll, ni le rapport d'import affiche, ni la saisie en cours ne sont perdus.
      synchroniserFeuille(p || {});
    }
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// #/aide/installation
// ═════════════════════════════════════════════════════════════════════════════

function monterAide(conteneur) {
  const desabos = [];
  let detruit = false;

  const ios = estIOS();
  const installee = estStandalone();

  const racine = h('section', { class: 'vue vue-reglages' });

  if (installee) {
    racine.appendChild(h('div', { class: 'etat-vide' },
      h('p', { class: 'etat-vide-titre' }, 'L\'application est déjà installée'),
      h('p', { class: 'etat-vide-texte' },
        'Tu l\'utilises en ce moment depuis l\'écran d\'accueil. Rien de plus à faire.'),
      h('a', { class: 'bouton bouton-primaire', href: '#/' }, 'Revenir à l\'accueil')
    ));
    conteneur.appendChild(racine);
    return { destroy() { vider(conteneur); }, onParams() { /* rien */ } };
  }

  racine.appendChild(h('div', { style: { padding: 'var(--esp-4)' } },
    h('p', {},
      'Installer l\'application n\'est pas obligatoire : tout fonctionne déjà dans le navigateur, ' +
      'y compris hors connexion. L\'installation ajoute une icône, le plein écran, et protège ' +
      'un peu mieux tes données d\'un nettoyage automatique du navigateur.')
  ));

  // ── iOS ──────────────────────────────────────────────────────────────────
  if (ios) {
    // ⚠ LE POINT CRITIQUE DE CET ECRAN. iOS capture l'URL COURANTE, hash compris, au moment de
    //   « Sur l'écran d'accueil ». Installer depuis #/aide/installation fabriquerait un raccourci
    //   qui ouvre la page d'aide A VIE, sans aucun moyen visible d'en sortir. On impose donc le
    //   retour a #/ AVANT de donner l'instruction, et on la rappelle par un toast persistant qui
    //   survit au changement de route (le toast vit dans la coquille, zone A).
    const avertissement = h('div', { class: 'avertissement' },
      h('p', {},
        h('strong', {}, 'À lire avant de partager. '),
        'iPhone et iPad enregistrent l\'adresse exacte affichée au moment de l\'ajout — cette ' +
        'page d\'aide comprise. Si tu installes depuis ici, ton icône ouvrira cette page d\'aide ' +
        'et non ton carnet.'),
      h('p', {}, 'Reviens d\'abord à l\'accueil, puis suis les trois étapes.')
    );

    const btnRetour = h('button', {
      class: 'bouton bouton-primaire bouton-large', type: 'button', dataset: { action: 'retour-accueil' }
    }, 'Revenir à l\'accueil, puis installer');

    const etapes = h('ol', { class: 'etapes-installation', style: { padding: 'var(--esp-4)' } },
      h('li', { class: 'etape-installation' },
        h('div', {},
          h('p', {}, h('strong', {}, 'Reviens à l\'accueil du carnet.')),
          h('p', { class: 'ligne-reglage-aide' },
            'L\'adresse doit se terminer par « #/ » et l\'écran doit afficher tes modèles de séance.'))),
      h('li', { class: 'etape-installation' },
        h('div', {},
          h('p', {}, h('strong', {}, 'Touche le bouton Partager de Safari.')),
          h('p', { class: 'ligne-reglage-aide' },
            'Le carré avec une flèche vers le haut, en bas de l\'écran (ou en haut à droite sur iPad).'))),
      h('li', { class: 'etape-installation' },
        h('div', {},
          h('p', {}, h('strong', {}, 'Choisis « Sur l\'écran d\'accueil », puis « Ajouter ».')),
          h('p', { class: 'ligne-reglage-aide' },
            'Si l\'entrée n\'apparaît pas, fais défiler la liste des actions vers le bas. ' +
            'Elle n\'existe que dans Safari : Chrome ou Firefox sur iPhone ne la proposent pas.')))
    );

    racine.appendChild(h('h2', { class: 'section-titre' }, 'Sur iPhone ou iPad'));
    racine.appendChild(avertissement);
    racine.appendChild(h('div', { style: { padding: '0 var(--esp-4)' } }, btnRetour));
    racine.appendChild(etapes);
  }

  // ── Android ──────────────────────────────────────────────────────────────
  // Affiche meme sur iOS : un meme utilisateur peut lire cette page depuis un autre appareil.
  const btnInstaller = h('button', {
    class: 'bouton bouton-primaire bouton-large', type: 'button',
    hidden: !estInstallable(), dataset: { action: 'installer' }
  }, 'Installer maintenant');

  const etatInstall = h('p', { class: 'ligne-reglage-aide', role: 'status' }, '');

  racine.appendChild(h('h2', { class: 'section-titre' }, 'Sur Android'));
  racine.appendChild(h('div', { style: { padding: '0 var(--esp-4)' } }, btnInstaller, etatInstall));
  racine.appendChild(h('ol', { class: 'etapes-installation', style: { padding: 'var(--esp-4)' } },
    h('li', { class: 'etape-installation' },
      h('div', {},
        h('p', {}, h('strong', {}, 'Ouvre le menu du navigateur.')),
        h('p', { class: 'ligne-reglage-aide' }, 'Les trois points, en haut à droite de Chrome.'))),
    h('li', { class: 'etape-installation' },
      h('div', {},
        h('p', {}, h('strong', {}, 'Choisis « Installer l\'application ».')),
        h('p', { class: 'ligne-reglage-aide' },
          'Selon la version, l\'entrée s\'appelle « Ajouter à l\'écran d\'accueil ».'))),
    h('li', { class: 'etape-installation' },
      h('div', {},
        h('p', {}, h('strong', {}, 'Confirme.')),
        h('p', { class: 'ligne-reglage-aide' },
          'L\'icône apparaît sur ton écran d\'accueil et l\'application s\'ouvre en plein écran.')))
  ));

  racine.appendChild(h('div', { style: { padding: '0 var(--esp-4) var(--esp-5)' } },
    h('p', { class: 'ligne-reglage-aide' },
      'Installer aide, mais ne remplace jamais un export : c\'est la sauvegarde manuelle, et elle ' +
      'seule, qui met tes données à l\'abri d\'un téléphone perdu ou réinitialisé.'),
    h('a', { class: 'bouton bouton-large', href: '#/reglages' }, 'Retour aux réglages')
  ));

  conteneur.appendChild(racine);

  desabos.push(delegate(racine, 'click', '[data-action]', async (ev, cible) => {
    const action = cible.getAttribute('data-action');
    if (action === 'retour-accueil') {
      // Toast PERSISTANT (duree 0) : il vit dans la coquille, donc il survit au demontage de
      // cette vue. C'est lui qui porte l'instruction une fois l'utilisateur revenu sur #/.
      toast.afficher('Tu es sur l\'accueil. Touche Partager, puis « Sur l\'écran d\'accueil ».', {
        duree: 0,
        annuler: () => { /* fermeture simple */ },
        libelleAnnuler: 'Compris'
      });
      aller('#/');
      return;
    }
    if (action === 'installer') {
      cible.disabled = true;
      const issue = await proposer();
      if (detruit) return;
      cible.disabled = false;
      if (issue === 'accepted') etatInstall.textContent = 'Installation lancée.';
      else if (issue === 'dismissed') etatInstall.textContent = 'Installation refusée. Tu pourras revenir ici plus tard.';
      else if (issue === 'aide') { cible.hidden = true; etatInstall.textContent = 'Suis les étapes ci-dessus.'; }
      else { cible.hidden = true; etatInstall.textContent = 'Ton navigateur ne propose pas l\'installation automatique : passe par son menu.'; }
    }
  }));

  // L'invite native arrive parfois APRES le montage de cette page : on devoile le bouton a ce
  // moment-la plutot que de laisser l'utilisateur croire que l'installation est impossible.
  desabos.push(bus.on('install:disponible', () => { if (!detruit) btnInstaller.hidden = false; }));
  desabos.push(bus.on('install:installee', () => {
    if (detruit) return;
    btnInstaller.hidden = true;
    etatInstall.textContent = 'Application installée. Tu peux la lancer depuis ton écran d\'accueil.';
  }));

  return {
    destroy() {
      detruit = true;
      for (const off of desabos) { try { off(); } catch (_) { /* deja detache */ } }
      desabos.length = 0;
      vider(conteneur);
    },
    onParams() { /* cette page n'a aucun parametre */ }
  };
}
