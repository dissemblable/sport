import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  equipmentCodeEnum,
  mechanicEnum,
  movementPatternEnum,
  muscleCodeEnum,
  muscleRegionEnum,
  muscleRoleEnum,
  muscleSizeClassEnum,
  progressionAxisEnum,
} from './enums';

/**
 * Référentiel : muscles, matériel et exercices.
 *
 * Ces tables sont peuplées par le script d'amorçage à partir du catalogue de
 * `@sport/core` et ne sont jamais modifiées par l'application. Les stocker en
 * base plutôt que de tout garder en mémoire permet aux requêtes de filtrer et
 * de joindre côté serveur, et laisse la porte ouverte à des exercices
 * personnalisés par l'utilisateur.
 */

/* -------------------------------------------------------------------------- */
/*                                  Muscles                                   */
/* -------------------------------------------------------------------------- */

export const muscles = pgTable('muscles', {
  id: serial('id').primaryKey(),
  code: muscleCodeEnum('code').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  region: muscleRegionEnum('region').notNull(),
  sizeClass: muscleSizeClassEnum('size_class').notNull(),

  /* --- Paramètres de récupération --- */

  /** Demi-vie de décroissance de la fatigue, en heures. */
  recoveryHalfLifeHours: numeric('recovery_half_life_hours', { precision: 5, scale: 2 }).notNull(),
  /**
   * Plancher de repos absolu entre deux sollicitations directes.
   * Garantie produit : 48 h par défaut, jamais moins.
   */
  minRestHours: smallint('min_rest_hours').notNull().default(48),
  /** Borne haute de la fenêtre de récupération. */
  fullRecoveryHours: smallint('full_recovery_hours').notNull().default(72),

  /* --- Repères de volume hebdomadaire, en séries effectives --- */

  /** Volume minimum entraînant une progression. */
  weeklyMev: smallint('weekly_mev').notNull(),
  /** Volume adaptatif maximal — cible de croisière. */
  weeklyMav: smallint('weekly_mav').notNull(),
  /** Volume récupérable maximal — plafond absolu. */
  weeklyMrv: smallint('weekly_mrv').notNull(),
  /** Plafond de séries sur une seule séance (rendements décroissants). */
  maxSetsPerSession: smallint('max_sets_per_session').notNull(),

  displayOrder: smallint('display_order').notNull().default(0),
});

/* -------------------------------------------------------------------------- */
/*                                  Matériel                                  */
/* -------------------------------------------------------------------------- */

export const equipment = pgTable('equipment', {
  id: serial('id').primaryKey(),
  code: equipmentCodeEnum('code').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  description: text('description'),
});

/* -------------------------------------------------------------------------- */
/*                                 Exercices                                  */
/* -------------------------------------------------------------------------- */

export const exercises = pgTable(
  'exercises',
  {
    id: integer('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    nameFr: text('name_fr').notNull(),
    pattern: movementPatternEnum('pattern').notNull(),
    mechanic: mechanicEnum('mechanic').notNull(),
    /** 1 = accessible à tous, 5 = mouvement avancé. */
    difficulty: smallint('difficulty').notNull(),
    isUnilateral: boolean('is_unilateral').notNull().default(false),
    /**
     * Coût systémique relatif du mouvement (0,5 à 1,5).
     * Multiplie la fatigue produite et pénalise l'exercice dans la sélection,
     * à couverture musculaire égale.
     */
    systemicLoad: numeric('systemic_load', { precision: 4, scale: 2 }).notNull().default('1'),

    defaultRepMin: smallint('default_rep_min').notNull(),
    defaultRepMax: smallint('default_rep_max').notNull(),
    defaultRestSeconds: smallint('default_rest_seconds').notNull(),

    progressionAxes: progressionAxisEnum('progression_axes').array().notNull().default([]),
    /** Famille chaînant les variantes, de la plus facile à la plus difficile. */
    progressionFamily: text('progression_family'),
    progressionRank: smallint('progression_rank').notNull().default(1),

    setupNotes: text('setup_notes'),
    executionCues: text('execution_cues').array().notNull().default([]),
  },
  (table) => [
    index('exercises_pattern_idx').on(table.pattern),
    index('exercises_family_idx').on(table.progressionFamily, table.progressionRank),
  ],
);

/** Matériel requis par un exercice — tout doit être possédé pour le proposer. */
export const exerciseEquipment = pgTable(
  'exercise_equipment',
  {
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    equipmentId: integer('equipment_id')
      .notNull()
      .references(() => equipment.id, { onDelete: 'cascade' }),
    isRequired: boolean('is_required').notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.exerciseId, table.equipmentId] })],
);

/**
 * Cartographie musculaire pondérée.
 *
 * `contribution` est la part du stimulus d'une série attribuée au muscle. Cette
 * pondération est le socle de tout le suivi de fatigue : une traction compte
 * 1 série pour les dorsaux et 0,7 pour les biceps. Une cartographie erronée
 * fausse silencieusement toute la gestion de la récupération.
 */
export const exerciseMuscles = pgTable(
  'exercise_muscles',
  {
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    muscleId: integer('muscle_id')
      .notNull()
      .references(() => muscles.id, { onDelete: 'cascade' }),
    role: muscleRoleEnum('role').notNull(),
    contribution: numeric('contribution', { precision: 3, scale: 2 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.exerciseId, table.muscleId] }),
    index('exercise_muscles_muscle_idx').on(table.muscleId, table.role),
  ],
);

/** Graphe de progression entre variantes d'une même famille. */
export const exerciseProgressions = pgTable(
  'exercise_progressions',
  {
    fromExerciseId: integer('from_exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    toExerciseId: integer('to_exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    /** Conditions de passage, ex. `{ "sets": 3, "reps": 15, "rir": 1 }`. */
    criteria: jsonb('criteria').$type<Record<string, unknown>>(),
  },
  (table) => [
    primaryKey({ columns: [table.fromExerciseId, table.toExerciseId] }),
    uniqueIndex('exercise_progressions_unique_idx').on(table.fromExerciseId, table.toExerciseId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                 Relations                                  */
/* -------------------------------------------------------------------------- */

export const musclesRelations = relations(muscles, ({ many }) => ({
  exercises: many(exerciseMuscles),
}));

export const equipmentRelations = relations(equipment, ({ many }) => ({
  exercises: many(exerciseEquipment),
}));

export const exercisesRelations = relations(exercises, ({ many }) => ({
  muscles: many(exerciseMuscles),
  equipment: many(exerciseEquipment),
}));

export const exerciseMusclesRelations = relations(exerciseMuscles, ({ one }) => ({
  exercise: one(exercises, {
    fields: [exerciseMuscles.exerciseId],
    references: [exercises.id],
  }),
  muscle: one(muscles, {
    fields: [exerciseMuscles.muscleId],
    references: [muscles.id],
  }),
}));

export const exerciseEquipmentRelations = relations(exerciseEquipment, ({ one }) => ({
  exercise: one(exercises, {
    fields: [exerciseEquipment.exerciseId],
    references: [exercises.id],
  }),
  equipment: one(equipment, {
    fields: [exerciseEquipment.equipmentId],
    references: [equipment.id],
  }),
}));
