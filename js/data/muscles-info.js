// data/muscles-info.js — fiches des groupes musculaires pour la vue #/muscles (v10).
//
// Une fiche par CATEGORIE d'exercice (data/schema.js CATEGORIES) : le role du muscle, puis la
// maniere de le travailler. Textes ORIGINAUX, volontairement courts : deux ou trois phrases
// lisibles en salle, pas un manuel d'anatomie. La vue retombe sur un texte generique si une
// categorie n'a pas de fiche — ajouter une categorie au schema ne casse donc rien ici.

export const INFOS_MUSCLES = {
  'pectoraux': {
    nom: 'Pectoraux',
    role: 'Ils poussent les bras vers l\'avant et les ramènent vers l\'axe du corps : chaque '
      + 'poussée horizontale ou oblique passe par eux.',
    conseil: 'Les développés (barre, haltères, incliné) construisent la masse ; les dips et les '
      + 'pompes complètent. Varie l\'inclinaison pour toucher le haut et le bas du muscle, et '
      + 'garde les omoplates serrées pendant les poussées.'
  },
  'dos': {
    nom: 'Dos',
    role: 'Grand dorsal, trapèzes et lombaires tirent les bras vers le corps et tiennent la '
      + 'colonne droite : c\'est le socle de la posture et de la force de tirage.',
    conseil: 'Alterne tirages VERTICAUX (tractions, tirage poulie) et HORIZONTAUX (rowings) '
      + 'pour couvrir la largeur et l\'épaisseur. Tire avec les coudes, pas avec les mains, et '
      + 'contrôle la descente.'
  },
  'epaules': {
    nom: 'Épaules',
    role: 'Le deltoïde lève le bras dans toutes les directions ; ses trois faisceaux (avant, '
      + 'côté, arrière) donnent la largeur et la carrure.',
    conseil: 'Le développé militaire charge l\'ensemble ; les élévations latérales isolent le '
      + 'faisceau moyen et l\'oiseau l\'arrière — souvent négligé, il équilibre l\'épaule et '
      + 'protège l\'articulation. Charges modérées, exécution stricte.'
  },
  'biceps': {
    nom: 'Biceps',
    role: 'Il plie le coude et fait tourner l\'avant-bras : tout tirage le sollicite déjà, '
      + 'les curls le finissent.',
    conseil: 'Travaille-le après le dos, en 8 à 12 répétitions strictes : coudes fixes le long '
      + 'du corps, descente contrôlée. Varier barre, haltères et prise marteau suffit — le '
      + 'volume utile est vite atteint.'
  },
  'triceps': {
    nom: 'Triceps',
    role: 'Il tend le coude et fait les deux tiers du volume du bras : toutes les poussées '
      + '(développés, dips, pompes) le mettent déjà au travail.',
    conseil: 'Après les poussées lourdes, deux exercices d\'isolation suffisent : extensions '
      + 'poulie et extensions nuque, 10 à 12 répétitions, coudes serrés et immobiles.'
  },
  'quadriceps': {
    nom: 'Quadriceps',
    role: 'Les quatre chefs de l\'avant de la cuisse tendent le genou : ils portent le squat, '
      + 'la presse, les fentes — et tout ce qui monte un escalier.',
    conseil: 'Le squat est le maître-exercice : descends au moins à la parallèle, genoux dans '
      + 'l\'axe des pieds. Presse et fentes complètent, le leg extension isole en finition.'
  },
  'ischios': {
    nom: 'Ischio-jambiers',
    role: 'L\'arrière de la cuisse plie le genou et étend la hanche : c\'est le moteur du '
      + 'sprint et le garde-fou du genou.',
    conseil: 'Deux gestes les couvrent : la flexion (leg curl) et l\'extension de hanche '
      + '(soulevé de terre roumain, jambes presque tendues, dos plat). Étire-les '
      + 'régulièrement, ils raccourcissent vite.'
  },
  'fessiers': {
    nom: 'Fessiers',
    role: 'Le grand fessier est le muscle le plus puissant du corps : il étend la hanche et '
      + 'stabilise le bassin à chaque pas, chaque saut, chaque squat.',
    conseil: 'Hip thrust et squat profond le chargent le mieux ; fentes et squat bulgare le '
      + 'travaillent jambe par jambe. Serre volontairement en haut de chaque répétition.'
  },
  'mollets': {
    nom: 'Mollets',
    role: 'Gastrocnémiens et soléaire tendent la cheville : ils propulsent la marche, la '
      + 'course et chaque saut.',
    conseil: 'Ils encaissent beaucoup : monte à 12-20 répétitions, amplitude COMPLÈTE — étire '
      + 'en bas, monte haut sur la pointe, marque un temps d\'arrêt. Debout pour les '
      + 'gastrocnémiens, assis pour le soléaire.'
  },
  'abdos': {
    nom: 'Abdominaux',
    role: 'Grand droit, obliques et transverse fléchissent le buste et gainent tout ce que tu '
      + 'soulèves : aucun mouvement lourd ne tient sans eux.',
    conseil: 'Mélange flexion (crunchs, relevés de jambes) et GAINAGE (planche, planche '
      + 'latérale) : le gainage construit la stabilité, la flexion dessine. Le souffle sort à '
      + 'l\'effort, le bas du dos reste plaqué.'
  },
  'cardio': {
    nom: 'Cardio',
    role: 'Le cœur et le souffle : la capacité à soutenir un effort. C\'est aussi le meilleur '
      + 'outil de récupération entre les séances de force.',
    conseil: 'Deux registres : long et facile (marche, vélo, footing — on peut parler), ou '
      + 'court et intense (rameur, corde, burpees). L\'un construit la base, l\'autre le '
      + 'plafond ; alterne-les.'
  },
  'corps-entier': {
    nom: 'Corps entier',
    role: 'Les mouvements complets (burpees, soulevé de terre) enchaînent plusieurs '
      + 'articulations : tout le corps travaille en même temps.',
    conseil: 'Place-les en début de séance quand tu es frais : ce sont les plus exigeants '
      + 'techniquement. La qualité d\'exécution prime toujours sur le chrono.'
  }
};

/** Fiche d'une categorie, ou un repli generique — jamais null, la vue affiche toujours. */
export function infoMuscle(categorie) {
  return INFOS_MUSCLES[categorie] || {
    nom: categorie || 'Muscle',
    role: 'Groupe musculaire du catalogue.',
    conseil: 'Choisis un exercice ci-dessous et regarde sa vidéo pour la technique.'
  };
}
