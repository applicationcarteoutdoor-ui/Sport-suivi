// data/templates.js — MODELES livres : 6 seances pretes a lancer.
//
// Un modele est une INTENTION, mutable et sans valeur historique. Au lancement d'une seance,
// domain/session.js en fait une COPIE INTEGRALE (modeleSnapshot) : modifier un modele demain ne
// change donc rien a ce qui a ete reellement fait aujourd'hui.
//
// Les exerciceId pointent vers data/catalog.js et sont figes : renommer un id ici sans le
// renommer la-bas produirait un modele qui lance des exercices fantomes.

// ⚠ AUCUN kilo en dur dans un modele livre. chargeCible vaut TOUJOURS { type:'derniere', delta:0 }
//   parce qu'un modele qui annonce « Developpe couche 4 x 8 a 60 kg » ment des la troisieme
//   semaine de progression, puis ment de plus en plus fort, et finit par etre plus faux que le
//   carnet papier qu'il remplace. « la derniere fois, sans variation » est la seule cible qui
//   reste vraie a vie ; le pre-remplissage (domain/prefill.js) fait le reste.
const REPRENDRE_LA_DERNIERE = Object.freeze({ type: 'derniere', delta: 0 });

// ⚠ repsCibles est TOUJOURS une fourchette min/max, jamais un entier : « 8 » se lit comme un
//   ordre rate des qu'on en fait 7, alors que « 6 a 8 » decrit ce qui est reellement vise et
//   rend la serie a 7 reps satisfaisante. Sur les exercices en duree ou en cardio, il vaut null
//   (aucune repetition n'y est comptee) — un entier n'y apparait pas davantage.

// Horodatage FIXE des modeles livres, jamais Date.now() : cf. data/catalog.js.
const LIVRE_LE = Date.parse('2026-01-01T00:00:00Z');

/**
 * Fabrique un item de modele avec tous ses champs presents.
 * L'id d'item est DETERMINISTE ('<idModele>:<n>') et non un ULID : un ulid() genere au
 * chargement du module changerait a chaque ouverture de l'application, et deux installations
 * du meme modele livre ne se reconnaitraient plus a l'import « fusionner ».
 */
function item(idModele, n, p) {
  return {
    id: idModele + ':' + n,
    exerciceId: p.exerciceId,
    // ⚠ Supersets et circuits : le schema conserve les deux champs pour l'avenir, mais l'interface
    //   v1 n'en cree aucun et AUCUN modele livre n'en contient. Les laisser nuls partout evite
    //   qu'une vue future herite d'un groupage jamais teste.
    groupeId: null,
    groupeType: null,
    seriesCibles: p.seriesCibles,
    // Series de montee en charge sur les mouvements lourds uniquement : elles sont exclues de
    // tous les agregats (estComptable) et du pre-remplissage.
    seriesEchauffement: p.seriesEchauffement || 0,
    repsCibles: p.repsCibles || null,
    dureeCibleSec: p.dureeCibleSec != null ? p.dureeCibleSec : null,
    distanceCibleM: p.distanceCibleM != null ? p.distanceCibleM : null,
    chargeCible: REPRENDRE_LA_DERNIERE,
    reposSec: p.reposSec,
    note: p.note || null
  };
}

function modele(p) {
  return {
    id: p.id,
    nom: p.nom,
    description: p.description,
    dureeEstimeeMin: p.dureeEstimeeMin,
    items: p.items.map((it, i) => item(p.id, i + 1, it)),
    archived: false,
    createdAt: LIVRE_LE,
    updatedAt: LIVRE_LE
  };
}

export const MODELES = [

  // ── 1. Push ────────────────────────────────────────────────────────────────
  modele({
    id: 'mod:push',
    nom: 'Push',
    description: 'Pectoraux, épaules et triceps. Les mouvements de poussée.',
    dureeEstimeeMin: 60,
    items: [
      { exerciceId: 'cat:developpe-couche-barre', seriesCibles: 4, seriesEchauffement: 2,
        repsCibles: { min: 5, max: 8 }, reposSec: 180 },
      { exerciceId: 'cat:developpe-incline-barre', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:dips-barres', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:developpe-militaire', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 8 }, reposSec: 150 },
      { exerciceId: 'cat:elevations-laterales', seriesCibles: 3,
        repsCibles: { min: 12, max: 15 }, reposSec: 75 },
      { exerciceId: 'cat:extensions-triceps-poulie', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 90 }
    ]
  }),

  // ── 2. Pull ────────────────────────────────────────────────────────────────
  modele({
    id: 'mod:pull',
    nom: 'Pull',
    description: 'Dos et biceps. Les mouvements de tirage.',
    dureeEstimeeMin: 60,
    items: [
      { exerciceId: 'cat:tractions-pronation', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 5, max: 8 }, reposSec: 150 },
      { exerciceId: 'cat:rowing-barre', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:tirage-vertical', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 120 },
      { exerciceId: 'cat:rowing-halteres', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 120,
        note: 'Par cote' },
      { exerciceId: 'cat:oiseau', seriesCibles: 3,
        repsCibles: { min: 12, max: 15 }, reposSec: 75 },
      { exerciceId: 'cat:curl-barre', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 90 }
    ]
  }),

  // ── 3. Jambes ──────────────────────────────────────────────────────────────
  modele({
    id: 'mod:jambes',
    nom: 'Jambes',
    description: 'Quadriceps, ischios, fessiers et mollets.',
    dureeEstimeeMin: 65,
    items: [
      { exerciceId: 'cat:squat', seriesCibles: 4, seriesEchauffement: 2,
        repsCibles: { min: 5, max: 8 }, reposSec: 210 },
      { exerciceId: 'cat:souleve-de-terre', seriesCibles: 3, seriesEchauffement: 2,
        repsCibles: { min: 4, max: 6 }, reposSec: 210 },
      { exerciceId: 'cat:presse-a-cuisses', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 8, max: 12 }, reposSec: 180 },
      { exerciceId: 'cat:leg-curl', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 120 },
      { exerciceId: 'cat:fentes', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 120,
        note: 'Par jambe' },
      { exerciceId: 'cat:mollets', seriesCibles: 4,
        repsCibles: { min: 12, max: 20 }, reposSec: 90 }
    ]
  }),

  // ── 4. Haut du corps ───────────────────────────────────────────────────────
  modele({
    id: 'mod:haut-du-corps',
    nom: 'Haut du corps',
    description: 'Une séance complète du haut : poussée, tirage et bras.',
    dureeEstimeeMin: 55,
    items: [
      { exerciceId: 'cat:tractions-pronation', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 5, max: 8 }, reposSec: 150 },
      { exerciceId: 'cat:developpe-couche-halteres', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 8, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:rowing-poulie-basse', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 120 },
      { exerciceId: 'cat:developpe-militaire', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:curl-halteres', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 90 },
      { exerciceId: 'cat:extensions-triceps-nuque', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 90 }
    ]
  }),

  // ── 5. Full body ───────────────────────────────────────────────────────────
  modele({
    id: 'mod:full-body',
    nom: 'Full body',
    description: 'Corps entier en cinq mouvements. Idéal à deux ou trois séances par semaine.',
    dureeEstimeeMin: 50,
    items: [
      { exerciceId: 'cat:squat', seriesCibles: 4, seriesEchauffement: 2,
        repsCibles: { min: 5, max: 8 }, reposSec: 210 },
      { exerciceId: 'cat:developpe-couche-barre', seriesCibles: 4, seriesEchauffement: 2,
        repsCibles: { min: 5, max: 8 }, reposSec: 180 },
      { exerciceId: 'cat:tractions-supination', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:rowing-barre', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 8, max: 10 }, reposSec: 150 },
      // Mode 'temps' : la cible est une duree, repsCibles reste null.
      { exerciceId: 'cat:planche', seriesCibles: 3,
        dureeCibleSec: 45, reposSec: 60 }
    ]
  }),

  // ── 6. Cardio et gainage ───────────────────────────────────────────────────
  modele({
    id: 'mod:cardio-gainage',
    nom: 'Cardio et gainage',
    description: 'Séance courte : vingt minutes de cardio puis le tronc.',
    dureeEstimeeMin: 35,
    items: [
      // ⚠ distanceCibleM est indicative : la distance reste OPTIONNELLE a la saisie, et l'allure
      //   comme la vitesse en sont derivees. Aucune des deux n'est jamais saisie ni stockee.
      { exerciceId: 'cat:rameur', seriesCibles: 1,
        dureeCibleSec: 1200, distanceCibleM: 4000, reposSec: 120 },
      { exerciceId: 'cat:corde-a-sauter', seriesCibles: 3,
        dureeCibleSec: 120, reposSec: 60 },
      { exerciceId: 'cat:planche', seriesCibles: 3,
        dureeCibleSec: 60, reposSec: 60 },
      { exerciceId: 'cat:planche-laterale', seriesCibles: 2,
        dureeCibleSec: 45, reposSec: 45,
        note: 'Par cote' },
      { exerciceId: 'cat:releve-de-jambes', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 90 }
    ]
  }),

  // ═══ v9 — « de vraies séances types » (retour utilisateur) ═══════════════════
  // Splits par SEGMENT, dans l'esprit des guides de mouvements classiques (un segment = une
  // seance, du mouvement lourd vers l'isolation), et full body au POIDS DU CORPS dans l'esprit
  // des methodes sans materiel (circuits, repos courts, hautes repetitions). Compositions
  // ORIGINALES : aucun programme publie n'est recopie.

  // ── 7. Pecs et triceps ─────────────────────────────────────────────────────
  modele({
    id: 'mod:pecs-triceps',
    nom: 'Pecs et triceps',
    description: 'Le segment pectoraux, du développé lourd à l\'isolation des triceps.',
    dureeEstimeeMin: 55,
    items: [
      { exerciceId: 'cat:developpe-couche-barre', seriesCibles: 4, seriesEchauffement: 2,
        repsCibles: { min: 5, max: 8 }, reposSec: 180 },
      { exerciceId: 'cat:developpe-incline-barre', seriesCibles: 3, seriesEchauffement: 1,
        repsCibles: { min: 8, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:dips-barres', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 120 },
      { exerciceId: 'cat:pompes', seriesCibles: 2,
        repsCibles: { min: 12, max: 20 }, reposSec: 90,
        note: 'Finisher, jusqu\'à la limite propre' },
      { exerciceId: 'cat:extensions-triceps-poulie', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 90 },
      { exerciceId: 'cat:extensions-triceps-nuque', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 90 }
    ]
  }),

  // ── 8. Dos et biceps ───────────────────────────────────────────────────────
  modele({
    id: 'mod:dos-biceps',
    nom: 'Dos et biceps',
    description: 'Le segment dos : tirages verticaux, horizontaux, puis les bras.',
    dureeEstimeeMin: 55,
    items: [
      { exerciceId: 'cat:tractions-pronation', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 5, max: 8 }, reposSec: 150 },
      { exerciceId: 'cat:rowing-barre', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 8, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:tirage-vertical', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 120 },
      { exerciceId: 'cat:face-pull', seriesCibles: 3,
        repsCibles: { min: 12, max: 15 }, reposSec: 75 },
      { exerciceId: 'cat:curl-barre', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 90 },
      { exerciceId: 'cat:curl-halteres', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 90 }
    ]
  }),

  // ── 9. Épaules et abdos ────────────────────────────────────────────────────
  modele({
    id: 'mod:epaules-abdos',
    nom: 'Épaules et abdos',
    description: 'Les trois faisceaux de l\'épaule, puis la sangle abdominale.',
    dureeEstimeeMin: 45,
    items: [
      { exerciceId: 'cat:developpe-militaire', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 10 }, reposSec: 150 },
      { exerciceId: 'cat:elevations-laterales', seriesCibles: 4,
        repsCibles: { min: 12, max: 15 }, reposSec: 75 },
      { exerciceId: 'cat:oiseau', seriesCibles: 3,
        repsCibles: { min: 12, max: 15 }, reposSec: 75 },
      { exerciceId: 'cat:crunchs', seriesCibles: 3,
        repsCibles: { min: 15, max: 20 }, reposSec: 60 },
      { exerciceId: 'cat:releve-de-jambes', seriesCibles: 3,
        repsCibles: { min: 10, max: 15 }, reposSec: 75 },
      { exerciceId: 'cat:planche', seriesCibles: 3,
        dureeCibleSec: 45, reposSec: 60 }
    ]
  }),

  // ── 10. Chaîne postérieure ─────────────────────────────────────────────────
  modele({
    id: 'mod:chaine-posterieure',
    nom: 'Chaîne postérieure',
    description: 'Fessiers, ischios et bas du dos — le complément de la séance Jambes.',
    dureeEstimeeMin: 50,
    items: [
      { exerciceId: 'cat:souleve-de-terre-roumain', seriesCibles: 4, seriesEchauffement: 1,
        repsCibles: { min: 6, max: 10 }, reposSec: 180 },
      { exerciceId: 'cat:hip-thrust', seriesCibles: 4,
        repsCibles: { min: 8, max: 12 }, reposSec: 150 },
      { exerciceId: 'cat:leg-curl', seriesCibles: 3,
        repsCibles: { min: 10, max: 12 }, reposSec: 120 },
      { exerciceId: 'cat:squat-bulgare', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 120,
        note: 'Par jambe' },
      { exerciceId: 'cat:mollets', seriesCibles: 4,
        repsCibles: { min: 12, max: 20 }, reposSec: 90 }
    ]
  }),

  // ── 11. Full body sans matériel 1 ──────────────────────────────────────────
  // Esprit « methode sans materiel » : tout le corps a chaque seance, repos courts, hautes
  // repetitions — 2 a 3 fois par semaine.
  modele({
    id: 'mod:fullbody-pdc-1',
    nom: 'Full body sans matériel 1',
    description: 'Tout le corps au poids du corps, repos courts. 2 à 3 fois par semaine.',
    dureeEstimeeMin: 40,
    items: [
      { exerciceId: 'cat:pompes', seriesCibles: 5,
        repsCibles: { min: 8, max: 15 }, reposSec: 60 },
      { exerciceId: 'cat:dips-banc', seriesCibles: 4,
        repsCibles: { min: 8, max: 15 }, reposSec: 60 },
      { exerciceId: 'cat:tractions-supination', seriesCibles: 4,
        repsCibles: { min: 5, max: 10 }, reposSec: 75 },
      { exerciceId: 'cat:squat-poids-du-corps', seriesCibles: 4,
        repsCibles: { min: 15, max: 20 }, reposSec: 60 },
      { exerciceId: 'cat:releve-de-jambes', seriesCibles: 3,
        repsCibles: { min: 10, max: 15 }, reposSec: 60 },
      { exerciceId: 'cat:planche', seriesCibles: 3,
        dureeCibleSec: 45, reposSec: 45 }
    ]
  }),

  // ── 12. Full body sans matériel 2 ──────────────────────────────────────────
  modele({
    id: 'mod:fullbody-pdc-2',
    nom: 'Full body sans matériel 2',
    description: 'La séance jumelle : variantes plus dures, à alterner avec la 1.',
    dureeEstimeeMin: 40,
    items: [
      { exerciceId: 'cat:pompes-declinees', seriesCibles: 4,
        repsCibles: { min: 6, max: 12 }, reposSec: 75 },
      { exerciceId: 'cat:tractions-pronation', seriesCibles: 4,
        repsCibles: { min: 5, max: 10 }, reposSec: 75 },
      { exerciceId: 'cat:dips-barres', seriesCibles: 4,
        repsCibles: { min: 6, max: 12 }, reposSec: 75 },
      { exerciceId: 'cat:squat-bulgare', seriesCibles: 3,
        repsCibles: { min: 8, max: 12 }, reposSec: 75,
        note: 'Par jambe' },
      { exerciceId: 'cat:burpees', seriesCibles: 3,
        repsCibles: { min: 10, max: 15 }, reposSec: 60 },
      { exerciceId: 'cat:planche-laterale', seriesCibles: 3,
        dureeCibleSec: 30, reposSec: 45,
        note: 'Par côté' }
    ]
  })
];

// Index par id, pour eviter un find() lineaire depuis l'accueil et depuis store.js.
export const MODELES_PAR_ID = new Map(MODELES.map((m) => [m.id, m]));

/** true si cet id provient des modeles livres (par opposition a un modele cree par l'utilisateur). */
export function estModeleLivre(id) {
  return typeof id === 'string' && MODELES_PAR_ID.has(id);
}
