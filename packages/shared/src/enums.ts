/**
 * Énumérations du domaine.
 *
 * Chaque énumération est déclarée comme un tuple `as const` afin de servir
 * simultanément de source pour :
 *  - le type TypeScript (`(typeof X)[number]`),
 *  - l'enum PostgreSQL (`pgEnum(..., X)`) dans @sport/db,
 *  - le schéma zod (`z.enum(X)`) dans les contrats d'API.
 *
 * Une valeur ajoutée ici se propage donc partout, et une migration est requise
 * côté base : ne jamais retirer une valeur déjà utilisée en production.
 */

/* -------------------------------------------------------------------------- */
/*                                  Muscles                                   */
/* -------------------------------------------------------------------------- */

/**
 * Taxonomie musculaire à 17 groupes.
 *
 * Cette granularité n'est pas cosmétique : c'est l'unité de suivi de la fatigue.
 * Regrouper « épaules » en un seul bloc rendrait impossible d'enchaîner un jour
 * développé (deltoïde antérieur) et un jour tirage (deltoïde postérieur), alors
 * que ces deux faisceaux récupèrent indépendamment.
 */
export const MUSCLE_CODES = [
  'chest',
  'lats',
  'upper_back',
  'lower_back',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'adductors',
  'calves',
  'abs',
  'obliques',
] as const;
export type MuscleCode = (typeof MUSCLE_CODES)[number];

/** Région corporelle — sert à composer les splits (haut/bas/tronc). */
export const MUSCLE_REGIONS = ['upper_push', 'upper_pull', 'lower', 'core'] as const;
export type MuscleRegion = (typeof MUSCLE_REGIONS)[number];

/**
 * Classe de taille : détermine la demi-vie de récupération par défaut et le
 * poids du muscle dans le calcul de la fatigue systémique.
 */
export const MUSCLE_SIZE_CLASSES = ['large', 'medium', 'small'] as const;
export type MuscleSizeClass = (typeof MUSCLE_SIZE_CLASSES)[number];

/** Rôle d'un muscle dans un exercice donné. */
export const MUSCLE_ROLES = ['primary', 'secondary', 'stabilizer'] as const;
export type MuscleRole = (typeof MUSCLE_ROLES)[number];

/* -------------------------------------------------------------------------- */
/*                                  Matériel                                  */
/* -------------------------------------------------------------------------- */

/**
 * Matériel disponible — strictement limité à l'entraînement à domicile.
 * Aucune machine, aucune barre olympique, aucun banc.
 */
export const EQUIPMENT_CODES = [
  'bodyweight',
  'pull_up_bar',
  'dumbbells',
  'resistance_bands',
] as const;
export type EquipmentCode = (typeof EQUIPMENT_CODES)[number];

/* -------------------------------------------------------------------------- */
/*                                 Exercices                                  */
/* -------------------------------------------------------------------------- */

/**
 * Patron moteur. Le générateur s'en sert pour garantir la couverture d'une
 * séance (on ne veut pas trois exercices de poussée horizontale et zéro tirage).
 */
export const MOVEMENT_PATTERNS = [
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'squat',
  'hinge',
  'lunge',
  'core_antiextension',
  'core_flexion',
  'core_rotation',
  'isolation_upper',
  'isolation_lower',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const MECHANICS = ['compound', 'isolation'] as const;
export type Mechanic = (typeof MECHANICS)[number];

/**
 * Axe de progression utilisé pour un exercice. En l'absence de charges lourdes
 * (pas de barre), la progression passe souvent par le levier ou le tempo plutôt
 * que par les kilos.
 */
export const PROGRESSION_AXES = [
  'reps',
  'load',
  'band_level',
  'leverage',
  'tempo',
  'unilateral',
] as const;
export type ProgressionAxis = (typeof PROGRESSION_AXES)[number];

/** Bloc d'une séance — détermine l'ordre d'exécution. */
export const SESSION_BLOCKS = ['warmup', 'main', 'accessory', 'core', 'finisher'] as const;
export type SessionBlock = (typeof SESSION_BLOCKS)[number];

/* -------------------------------------------------------------------------- */
/*                                Utilisateur                                 */
/* -------------------------------------------------------------------------- */

export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const TRAINING_GOALS = ['hypertrophy', 'strength', 'recomposition', 'maintenance'] as const;
export type TrainingGoal = (typeof TRAINING_GOALS)[number];

export const BIOLOGICAL_SEXES = ['male', 'female', 'unspecified'] as const;
export type BiologicalSex = (typeof BIOLOGICAL_SEXES)[number];

/** Préférence utilisateur sur un exercice — sert notamment aux contre-indications. */
export const EXERCISE_PREFERENCES = ['favorite', 'disliked', 'banned'] as const;
export type ExercisePreference = (typeof EXERCISE_PREFERENCES)[number];

/* -------------------------------------------------------------------------- */
/*                                Planification                               */
/* -------------------------------------------------------------------------- */

/**
 * Types de split. Le choix est contraint par la fréquence hebdomadaire ET par
 * le plancher de repos de 48 h : au-delà de 4 séances/semaine, un full body
 * devient mathématiquement impossible à respecter.
 */
export const SPLIT_TYPES = [
  'full_body',
  'upper_lower',
  'push_pull_legs',
  'push_pull_legs_upper_lower',
  'push_pull_legs_x2',
] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export const SESSION_STATUSES = ['planned', 'completed', 'skipped', 'missed', 'superseded'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const MESOCYCLE_STATUSES = ['active', 'completed', 'abandoned'] as const;
export type MesocycleStatus = (typeof MESOCYCLE_STATUSES)[number];

/** Phase du mésocycle — pilote la cible de volume et le RIR prescrit. */
export const MESOCYCLE_PHASES = ['accumulation', 'intensification', 'deload'] as const;
export type MesocyclePhase = (typeof MESOCYCLE_PHASES)[number];

/* -------------------------------------------------------------------------- */
/*                                  Fatigue                                   */
/* -------------------------------------------------------------------------- */

/**
 * Statut de récupération d'un muscle, du plus frais au plus entamé.
 * `fatigued` et `overreached` bloquent la sollicitation en travail lourd.
 */
export const FATIGUE_STATUSES = [
  'fresh',
  'ready',
  'recovering',
  'fatigued',
  'overreached',
] as const;
export type FatigueStatus = (typeof FATIGUE_STATUSES)[number];

/** Origine d'un événement de fatigue dans le journal append-only. */
export const FATIGUE_SOURCES = ['training', 'soreness_report', 'manual', 'illness'] as const;
export type FatigueSource = (typeof FATIGUE_SOURCES)[number];

/**
 * Raison pour laquelle un muscle a été écarté d'une séance générée.
 * Exposée à l'utilisateur : l'application doit toujours pouvoir expliquer
 * pourquoi elle n'a pas programmé ce qu'il attendait.
 */
export const EXCLUSION_REASONS = [
  'min_rest_not_elapsed',
  'fatigue_too_high',
  'user_excluded',
  'no_volume_debt',
  'no_eligible_exercise',
  'time_budget_reached',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/* -------------------------------------------------------------------------- */
/*                                  Records                                   */
/* -------------------------------------------------------------------------- */

export const PR_TYPES = ['max_reps', 'max_load', 'estimated_1rm', 'max_hold_seconds'] as const;
export type PrType = (typeof PR_TYPES)[number];
