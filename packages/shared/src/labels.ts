import type {
  EquipmentCode,
  ExclusionReason,
  ExperienceLevel,
  FatigueStatus,
  Mechanic,
  MesocyclePhase,
  MovementPattern,
  MuscleCode,
  MuscleRegion,
  MuscleRole,
  SessionBlock,
  SessionStatus,
  SplitType,
  TrainingGoal,
} from './enums';

/**
 * Libellés français de toutes les énumérations.
 * Source unique pour l'interface : aucun libellé ne doit être écrit en dur
 * dans un composant React.
 */

export const MUSCLE_LABELS: Record<MuscleCode, string> = {
  chest: 'Pectoraux',
  lats: 'Grands dorsaux',
  upper_back: 'Haut du dos',
  lower_back: 'Lombaires',
  front_delts: 'Deltoïdes antérieurs',
  side_delts: 'Deltoïdes latéraux',
  rear_delts: 'Deltoïdes postérieurs',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Avant-bras',
  quads: 'Quadriceps',
  hamstrings: 'Ischio-jambiers',
  glutes: 'Fessiers',
  adductors: 'Adducteurs',
  calves: 'Mollets',
  abs: 'Abdominaux',
  obliques: 'Obliques',
};

/** Libellés courts pour la silhouette SVG et les graphiques compacts. */
export const MUSCLE_SHORT_LABELS: Record<MuscleCode, string> = {
  chest: 'Pecs',
  lats: 'Dorsaux',
  upper_back: 'Haut dos',
  lower_back: 'Lombaires',
  front_delts: 'Delt. ant.',
  side_delts: 'Delt. lat.',
  rear_delts: 'Delt. post.',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Avant-bras',
  quads: 'Quadris',
  hamstrings: 'Ischios',
  glutes: 'Fessiers',
  adductors: 'Adducteurs',
  calves: 'Mollets',
  abs: 'Abdos',
  obliques: 'Obliques',
};

export const MUSCLE_REGION_LABELS: Record<MuscleRegion, string> = {
  upper_push: 'Haut du corps — poussée',
  upper_pull: 'Haut du corps — tirage',
  lower: 'Bas du corps',
  core: 'Tronc',
};

export const MUSCLE_ROLE_LABELS: Record<MuscleRole, string> = {
  primary: 'Moteur principal',
  secondary: 'Muscle secondaire',
  stabilizer: 'Stabilisateur',
};

export const EQUIPMENT_LABELS: Record<EquipmentCode, string> = {
  bodyweight: 'Poids du corps',
  pull_up_bar: 'Barre de traction',
  dumbbells: 'Haltères',
  resistance_bands: 'Élastiques',
};

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  horizontal_push: 'Poussée horizontale',
  vertical_push: 'Poussée verticale',
  horizontal_pull: 'Tirage horizontal',
  vertical_pull: 'Tirage vertical',
  squat: 'Flexion de genoux',
  hinge: 'Charnière de hanche',
  lunge: 'Fente / unilatéral',
  core_antiextension: 'Gainage anti-extension',
  core_flexion: 'Flexion du tronc',
  core_rotation: 'Rotation / anti-rotation',
  isolation_upper: 'Isolation haut du corps',
  isolation_lower: 'Isolation bas du corps',
};

export const MECHANIC_LABELS: Record<Mechanic, string> = {
  compound: 'Polyarticulaire',
  isolation: 'Isolation',
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

export const TRAINING_GOAL_LABELS: Record<TrainingGoal, string> = {
  hypertrophy: 'Prise de masse musculaire',
  strength: 'Force',
  recomposition: 'Recomposition corporelle',
  maintenance: 'Entretien',
};

export const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  full_body: 'Full body',
  upper_lower: 'Haut / Bas',
  push_pull_legs: 'Push / Pull / Jambes',
  push_pull_legs_upper_lower: 'Push / Pull / Jambes + Haut / Bas',
  push_pull_legs_x2: 'Push / Pull / Jambes ×2',
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  planned: 'Planifiée',
  completed: 'Terminée',
  skipped: 'Passée',
  missed: 'Manquée',
  superseded: 'Remplacée',
};

export const SESSION_BLOCK_LABELS: Record<SessionBlock, string> = {
  warmup: 'Échauffement',
  main: 'Travail principal',
  accessory: 'Accessoires',
  core: 'Gainage',
  finisher: 'Finisher',
};

export const MESOCYCLE_PHASE_LABELS: Record<MesocyclePhase, string> = {
  accumulation: 'Accumulation',
  intensification: 'Intensification',
  deload: 'Décharge',
};

export const FATIGUE_STATUS_LABELS: Record<FatigueStatus, string> = {
  fresh: 'Frais',
  ready: 'Prêt',
  recovering: 'En récupération',
  fatigued: 'Fatigué',
  overreached: 'Surmené',
};

/** Description destinée à l'utilisateur, affichée au clic sur un muscle. */
export const FATIGUE_STATUS_DESCRIPTIONS: Record<FatigueStatus, string> = {
  fresh: 'Totalement récupéré, prêt pour un volume complet.',
  ready: 'Récupéré, disponible pour une séance normale.',
  recovering: 'Récupération en cours : volume réduit, on évite l’échec musculaire.',
  fatigued: 'Pas encore récupéré — écarté du travail lourd.',
  overreached: 'Fatigue accumulée trop élevée : repos ou décharge recommandés.',
};

/** Couleur associée à chaque statut (silhouette, jauges, badges). */
export const FATIGUE_STATUS_COLORS: Record<FatigueStatus, string> = {
  fresh: '#22c55e',
  ready: '#84cc16',
  recovering: '#eab308',
  fatigued: '#f97316',
  overreached: '#ef4444',
};

/**
 * Explication affichée quand un muscle a été retiré d'une séance générée.
 * L'application doit toujours pouvoir justifier ce qu'elle n'a pas programmé.
 */
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  min_rest_not_elapsed: 'Repos minimum de 48 h non écoulé',
  fatigue_too_high: 'Fatigue résiduelle trop élevée',
  user_excluded: 'Muscle exclu dans vos réglages',
  no_volume_debt: 'Volume hebdomadaire déjà atteint',
  no_eligible_exercise: 'Aucun exercice disponible avec votre matériel',
  time_budget_reached: 'Durée de séance atteinte',
};
