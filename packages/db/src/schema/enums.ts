import {
  BIOLOGICAL_SEXES,
  EQUIPMENT_CODES,
  EXERCISE_PREFERENCES,
  EXPERIENCE_LEVELS,
  FATIGUE_SOURCES,
  FATIGUE_STATUSES,
  MECHANICS,
  MESOCYCLE_PHASES,
  MESOCYCLE_STATUSES,
  MOVEMENT_PATTERNS,
  MUSCLE_CODES,
  MUSCLE_REGIONS,
  MUSCLE_ROLES,
  MUSCLE_SIZE_CLASSES,
  PR_TYPES,
  PROGRESSION_AXES,
  SESSION_BLOCKS,
  SESSION_STATUSES,
  SPLIT_TYPES,
  TRAINING_GOALS,
} from '@sport/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Types énumérés PostgreSQL.
 *
 * Chacun est dérivé de la liste correspondante de `@sport/shared` : le domaine
 * possède une seule définition, et la base ne peut pas diverger silencieusement
 * du code. Ajouter une valeur côté partagé produit automatiquement une
 * migration ; en retirer une casse la génération, ce qui est le comportement
 * souhaité (une valeur déjà stockée ne doit jamais disparaître sans migration
 * de données explicite).
 */

export const muscleCodeEnum = pgEnum('muscle_code', MUSCLE_CODES);
export const muscleRegionEnum = pgEnum('muscle_region', MUSCLE_REGIONS);
export const muscleSizeClassEnum = pgEnum('muscle_size_class', MUSCLE_SIZE_CLASSES);
export const muscleRoleEnum = pgEnum('muscle_role', MUSCLE_ROLES);

export const equipmentCodeEnum = pgEnum('equipment_code', EQUIPMENT_CODES);
export const movementPatternEnum = pgEnum('movement_pattern', MOVEMENT_PATTERNS);
export const mechanicEnum = pgEnum('mechanic', MECHANICS);
export const progressionAxisEnum = pgEnum('progression_axis', PROGRESSION_AXES);
export const sessionBlockEnum = pgEnum('session_block', SESSION_BLOCKS);

export const experienceLevelEnum = pgEnum('experience_level', EXPERIENCE_LEVELS);
export const trainingGoalEnum = pgEnum('training_goal', TRAINING_GOALS);
export const biologicalSexEnum = pgEnum('biological_sex', BIOLOGICAL_SEXES);
export const exercisePreferenceEnum = pgEnum('exercise_preference', EXERCISE_PREFERENCES);

export const splitTypeEnum = pgEnum('split_type', SPLIT_TYPES);
export const sessionStatusEnum = pgEnum('session_status', SESSION_STATUSES);
export const mesocycleStatusEnum = pgEnum('mesocycle_status', MESOCYCLE_STATUSES);
export const mesocyclePhaseEnum = pgEnum('mesocycle_phase', MESOCYCLE_PHASES);

export const fatigueStatusEnum = pgEnum('fatigue_status', FATIGUE_STATUSES);
export const fatigueSourceEnum = pgEnum('fatigue_source', FATIGUE_SOURCES);

export const prTypeEnum = pgEnum('pr_type', PR_TYPES);
