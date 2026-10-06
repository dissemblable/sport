import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BandDetails,
  DumbbellDetails,
  PullUpBarDetails,
} from '@sport/shared';
import { equipment, exercises, muscles } from './catalog';
import {
  biologicalSexEnum,
  equipmentCodeEnum,
  exercisePreferenceEnum,
  experienceLevelEnum,
  trainingGoalEnum,
} from './enums';

/**
 * Utilisateur et ses réglages.
 *
 * Deux modes coexistent. En local, un seul profil amorcé par `pnpm db:seed`,
 * sans authentification. Derrière le SSO, un profil par compte, créé à la
 * première visite et rattaché par `external_id`. Le `user_id` présent sur
 * toutes les tables de données personnelles rend ce passage possible sans
 * migration des données.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  /**
   * Identifiant du compte SSO (en-tête `Remote-User` posé par Authelia).
   * `null` pour le profil local, qui n'est rattaché à aucun compte.
   */
  externalId: text('external_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  birthYear: smallint('birth_year'),
  sex: biologicalSexEnum('sex').notNull().default('unspecified'),
  heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
  bodyWeightKg: numeric('body_weight_kg', { precision: 5, scale: 1 }),

  experienceLevel: experienceLevelEnum('experience_level').notNull().default('beginner'),
  primaryGoal: trainingGoalEnum('primary_goal').notNull().default('hypertrophy'),

  sessionsPerWeek: smallint('sessions_per_week').notNull().default(3),
  sessionDurationMinutes: smallint('session_duration_minutes').notNull().default(60),
  /** Jours souhaités, 0 = lundi … 6 = dimanche. */
  preferredWeekdays: smallint('preferred_weekdays').array().notNull().default([0, 2, 4]),
  deloadEveryNWeeks: smallint('deload_every_n_weeks').notNull().default(5),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Matériel possédé.
 *
 * `details` porte les spécificités qui conditionnent ce que le moteur peut
 * réellement prescrire : les charges d'haltères disponibles, les niveaux
 * d'élastiques, la possibilité de se lester. Sans elles, l'application
 * proposerait « 12,5 kg » à quelqu'un qui n'a que des haltères de 5 et 10.
 */
export const userEquipment = pgTable(
  'user_equipment',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    equipmentId: integer('equipment_id')
      .notNull()
      .references(() => equipment.id, { onDelete: 'cascade' }),
    code: equipmentCodeEnum('code').notNull(),
    details: jsonb('details')
      .$type<DumbbellDetails | BandDetails | PullUpBarDetails | Record<string, never>>()
      .notNull()
      .default({}),
  },
  (table) => [primaryKey({ columns: [table.userId, table.equipmentId] })],
);

/**
 * Réglages par muscle : priorité de volume, repos personnalisé, exclusion.
 *
 * `min_rest_hours_override` ne peut qu'allonger le repos : le moteur retient
 * toujours le maximum entre cette valeur et celle du référentiel. La garantie
 * de 48 h n'est donc pas contournable par un réglage.
 */
export const userMuscleSettings = pgTable(
  'user_muscle_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    muscleId: integer('muscle_id')
      .notNull()
      .references(() => muscles.id, { onDelete: 'cascade' }),
    /** Pondération du volume, de 0,5 (moins) à 2,0 (priorité forte). */
    priority: numeric('priority', { precision: 3, scale: 2 }).notNull().default('1'),
    minRestHoursOverride: smallint('min_rest_hours_override'),
    weeklySetsOverride: numeric('weekly_sets_override', { precision: 5, scale: 2 }),
    /** Muscle totalement écarté : blessure, contre-indication. */
    isExcluded: boolean('is_excluded').notNull().default(false),
    note: text('note'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.muscleId] })],
);

/** Contre-indications et préférences sur des exercices précis. */
export const userExercisePreferences = pgTable(
  'user_exercise_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    status: exercisePreferenceEnum('status').notNull(),
    /** Motif libre : « douleur épaule », « pas de place au sol ». */
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.exerciseId] })],
);

/** Suivi corporel — hors du moteur, mais utile à l'utilisateur. */
export const bodyMetrics = pgTable('body_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
  weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
  /** Mensurations libres, en centimètres. */
  measurements: jsonb('measurements').$type<Record<string, number>>().default(sql`'{}'::jsonb`),
  notes: text('notes'),
});

/* -------------------------------------------------------------------------- */
/*                                 Relations                                  */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  equipment: many(userEquipment),
  muscleSettings: many(userMuscleSettings),
  exercisePreferences: many(userExercisePreferences),
}));

export const userEquipmentRelations = relations(userEquipment, ({ one }) => ({
  user: one(users, { fields: [userEquipment.userId], references: [users.id] }),
  equipment: one(equipment, {
    fields: [userEquipment.equipmentId],
    references: [equipment.id],
  }),
}));

export const userMuscleSettingsRelations = relations(userMuscleSettings, ({ one }) => ({
  user: one(users, { fields: [userMuscleSettings.userId], references: [users.id] }),
  muscle: one(muscles, { fields: [userMuscleSettings.muscleId], references: [muscles.id] }),
}));
