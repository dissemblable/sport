import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { GenerationRationale, MuscleCode, Prescription, SplitSlot } from '@sport/shared';
import { exercises } from './catalog';
import {
  mesocyclePhaseEnum,
  mesocycleStatusEnum,
  prTypeEnum,
  sessionBlockEnum,
  sessionStatusEnum,
  splitTypeEnum,
} from './enums';
import { users } from './users';

/**
 * Planification et exécution de l'entraînement.
 *
 * La chaîne est : mésocycle → plan (versionné) → séances planifiées →
 * exercices prescrits, puis, côté réel : séance effectuée → séries.
 *
 * Le point de conception important est la **version de plan**. Changer de
 * fréquence n'écrase jamais le plan existant : une nouvelle version est créée
 * et l'ancienne archivée. Les séances déjà réalisées restent rattachées à la
 * version sous laquelle elles ont été faites, ce qui garde l'historique
 * cohérent et permet de comprendre après coup pourquoi telle séance existait.
 */

/* -------------------------------------------------------------------------- */
/*                                 Mésocycle                                  */
/* -------------------------------------------------------------------------- */

export const mesocycles = pgTable(
  'mesocycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    durationWeeks: smallint('duration_weeks').notNull().default(5),
    status: mesocycleStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('mesocycles_user_status_idx').on(table.userId, table.status)],
);

/* -------------------------------------------------------------------------- */
/*                            Plan d'entraînement                             */
/* -------------------------------------------------------------------------- */

export const trainingPlans = pgTable(
  'training_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mesocycleId: uuid('mesocycle_id')
      .notNull()
      .references(() => mesocycles.id, { onDelete: 'cascade' }),

    /** Incrémentée à chaque changement de fréquence ou de découpage. */
    version: smallint('version').notNull().default(1),
    sessionsPerWeek: smallint('sessions_per_week').notNull(),
    splitType: splitTypeEnum('split_type').notNull(),

    /** Créneaux du split, tels qu'appliqués — figés avec la version. */
    splitDefinition: jsonb('split_definition').$type<SplitSlot[]>().notNull(),
    /** Jours retenus, 0 = lundi … 6 = dimanche. */
    weekdays: smallint('weekdays').array().notNull(),
    /** Écart minimal obtenu entre deux sollicitations d'un même muscle. */
    minGapHours: smallint('min_gap_hours').notNull(),

    isActive: boolean('is_active').notNull().default(true),
    /** Motif du changement, affiché dans l'historique. */
    changeReason: text('change_reason'),

    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [
    index('training_plans_user_active_idx').on(table.userId, table.isActive),
    uniqueIndex('training_plans_meso_version_idx').on(table.mesocycleId, table.version),
  ],
);

/* -------------------------------------------------------------------------- */
/*                            Séances planifiées                              */
/* -------------------------------------------------------------------------- */

export const plannedSessions = pgTable(
  'planned_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => trainingPlans.id, { onDelete: 'cascade' }),

    scheduledDate: date('scheduled_date').notNull(),
    slotIndex: smallint('slot_index').notNull(),
    slotLabel: text('slot_label').notNull(),
    mesocycleWeek: smallint('mesocycle_week').notNull(),
    phase: mesocyclePhaseEnum('phase').notNull().default('accumulation'),

    status: sessionStatusEnum('status').notNull().default('planned'),
    estimatedDurationMinutes: smallint('estimated_duration_minutes').notNull().default(60),

    /**
     * Compte rendu complet de la génération : état de fatigue au moment du
     * calcul, muscles écartés et leur motif, dette de volume couverte.
     *
     * Conservé tel quel pour que n'importe quelle décision passée de
     * l'algorithme reste explicable des mois plus tard — c'est ce qui distingue
     * un coach dont on peut discuter les choix d'une boîte noire.
     */
    generationSnapshot: jsonb('generation_snapshot').$type<GenerationRationale>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('planned_sessions_user_date_idx').on(table.userId, table.scheduledDate),
    index('planned_sessions_plan_idx').on(table.planId, table.scheduledDate),
  ],
);

export const plannedExercises = pgTable(
  'planned_exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    plannedSessionId: uuid('planned_session_id')
      .notNull()
      .references(() => plannedSessions.id, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),

    position: smallint('position').notNull(),
    block: sessionBlockEnum('block').notNull().default('main'),

    targetSets: smallint('target_sets').notNull(),
    targetRepMin: smallint('target_rep_min').notNull(),
    targetRepMax: smallint('target_rep_max').notNull(),
    /** Répétitions en réserve visées : 0 = échec musculaire. */
    targetRir: smallint('target_rir').notNull().default(2),
    restSeconds: smallint('rest_seconds').notNull().default(120),

    /** Charge, élastique, tempo — uniquement du matériel réellement possédé. */
    prescription: jsonb('prescription').$type<Prescription>().notNull(),
    /** Pourquoi cet exercice a été retenu, en français. */
    rationale: text('rationale'),
  },
  (table) => [index('planned_exercises_session_idx').on(table.plannedSessionId, table.position)],
);

/* -------------------------------------------------------------------------- */
/*                            Séances réalisées                               */
/* -------------------------------------------------------------------------- */

export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Séance planifiée correspondante, ou `null` pour une séance improvisée. */
    plannedSessionId: uuid('planned_session_id').references(() => plannedSessions.id, {
      onDelete: 'set null',
    }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    /** RPE global, 1 (très facile) à 10 (maximal) — alimente la fatigue systémique. */
    sessionRpe: smallint('session_rpe'),
    notes: text('notes'),
    isAdHoc: boolean('is_ad_hoc').notNull().default(false),
  },
  (table) => [index('workout_sessions_user_time_idx').on(table.userId, table.startedAt.desc())],
);

export const sessionSets = pgTable(
  'session_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workoutSessionId: uuid('workout_session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),

    setIndex: smallint('set_index').notNull(),
    /** Les séries d'échauffement ne produisent aucune fatigue comptabilisée. */
    isWarmup: boolean('is_warmup').notNull().default(false),

    reps: smallint('reps'),
    loadKg: numeric('load_kg', { precision: 6, scale: 2 }),
    bandLevel: text('band_level'),
    /** Répétitions en réserve — premier déterminant de la fatigue produite. */
    rir: numeric('rir', { precision: 3, scale: 1 }),
    toFailure: boolean('to_failure').notNull().default(false),
    tempo: text('tempo'),
    /** Durée pour les exercices isométriques (gainage, suspension). */
    durationSeconds: smallint('duration_seconds'),

    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('session_sets_session_idx').on(table.workoutSessionId, table.setIndex),
    index('session_sets_exercise_time_idx').on(table.exerciseId, table.performedAt.desc()),
  ],
);

/* -------------------------------------------------------------------------- */
/*                          Progression et records                            */
/* -------------------------------------------------------------------------- */

/**
 * État de la double progression, par exercice.
 *
 * Sans cette table, chaque séance repartirait de zéro et l'application
 * proposerait éternellement la même charge : la surcharge progressive
 * disparaîtrait, et avec elle toute la progression.
 */
export const exerciseProgressionStates = pgTable(
  'exercise_progression_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),

    currentLoadKg: numeric('current_load_kg', { precision: 6, scale: 2 }),
    currentBandLevel: text('current_band_level'),
    currentRepTarget: smallint('current_rep_target').notNull(),

    consecutiveSuccesses: smallint('consecutive_successes').notNull().default(0),
    /** Deux échecs consécutifs déclenchent une régression. */
    consecutiveFailures: smallint('consecutive_failures').notNull().default(0),

    estimatedOneRepMax: numeric('estimated_one_rep_max', { precision: 6, scale: 2 }),
    lastPerformedAt: timestamp('last_performed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.exerciseId] })],
);

export const personalRecords = pgTable(
  'personal_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    type: prTypeEnum('type').notNull(),
    value: numeric('value', { precision: 8, scale: 2 }).notNull(),
    achievedAt: timestamp('achieved_at', { withTimezone: true }).notNull().defaultNow(),
    sessionSetId: uuid('session_set_id').references(() => sessionSets.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [index('personal_records_user_exercise_idx').on(table.userId, table.exerciseId)],
);

/**
 * Muscles ciblés par une séance planifiée, dénormalisés.
 *
 * Permet aux écrans de planning d'afficher « Pectoraux, Triceps, Épaules »
 * sans recharger tous les exercices et leur cartographie musculaire.
 */
export const plannedSessionMuscles = pgTable(
  'planned_session_muscles',
  {
    plannedSessionId: uuid('planned_session_id')
      .notNull()
      .references(() => plannedSessions.id, { onDelete: 'cascade' }),
    muscleCode: text('muscle_code').$type<MuscleCode>().notNull(),
    plannedSets: numeric('planned_sets', { precision: 5, scale: 2 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.plannedSessionId, table.muscleCode] })],
);

/* -------------------------------------------------------------------------- */
/*                                 Relations                                  */
/* -------------------------------------------------------------------------- */

export const mesocyclesRelations = relations(mesocycles, ({ one, many }) => ({
  user: one(users, { fields: [mesocycles.userId], references: [users.id] }),
  plans: many(trainingPlans),
}));

export const trainingPlansRelations = relations(trainingPlans, ({ one, many }) => ({
  mesocycle: one(mesocycles, {
    fields: [trainingPlans.mesocycleId],
    references: [mesocycles.id],
  }),
  sessions: many(plannedSessions),
}));

export const plannedSessionsRelations = relations(plannedSessions, ({ one, many }) => ({
  plan: one(trainingPlans, { fields: [plannedSessions.planId], references: [trainingPlans.id] }),
  exercises: many(plannedExercises),
  muscles: many(plannedSessionMuscles),
}));

// Drizzle exige les deux côtés d'une relation : sans cette déclaration, toute
// requête chargeant `plannedSessions.muscles` échoue à l'exécution.
export const plannedSessionMusclesRelations = relations(plannedSessionMuscles, ({ one }) => ({
  session: one(plannedSessions, {
    fields: [plannedSessionMuscles.plannedSessionId],
    references: [plannedSessions.id],
  }),
}));

export const plannedExercisesRelations = relations(plannedExercises, ({ one }) => ({
  session: one(plannedSessions, {
    fields: [plannedExercises.plannedSessionId],
    references: [plannedSessions.id],
  }),
  exercise: one(exercises, {
    fields: [plannedExercises.exerciseId],
    references: [exercises.id],
  }),
}));

export const workoutSessionsRelations = relations(workoutSessions, ({ one, many }) => ({
  user: one(users, { fields: [workoutSessions.userId], references: [users.id] }),
  plannedSession: one(plannedSessions, {
    fields: [workoutSessions.plannedSessionId],
    references: [plannedSessions.id],
  }),
  sets: many(sessionSets),
}));

export const sessionSetsRelations = relations(sessionSets, ({ one }) => ({
  workoutSession: one(workoutSessions, {
    fields: [sessionSets.workoutSessionId],
    references: [workoutSessions.id],
  }),
  exercise: one(exercises, { fields: [sessionSets.exerciseId], references: [exercises.id] }),
}));
