import { relations } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
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
import { muscles } from './catalog';
import { fatigueSourceEnum, fatigueStatusEnum } from './enums';
import { users } from './users';
import { workoutSessions } from './training';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LE CŒUR DU SYSTÈME : la gestion de la fatigue musculaire
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le modèle repose sur une séparation stricte entre **source de vérité** et
 * **cache de lecture** :
 *
 *   muscle_fatigue_events   journal immuable, en ajout seul
 *   muscle_fatigue_states   projection recalculée, reconstructible à tout moment
 *
 * Pourquoi ne pas simplement stocker un score courant et le mettre à jour ?
 *
 * 1. **Reproductibilité.** La demi-vie de chaque événement est figée à
 *    l'enregistrement, après modulation par l'état de forme du jour. Le score à
 *    n'importe quelle date passée est donc recalculable à l'identique. Un score
 *    mis à jour en place perdrait cette information à jamais.
 *
 * 2. **Auditabilité.** Quand l'application refuse de programmer les pectoraux,
 *    elle doit pouvoir montrer *pourquoi* : quelles séries, quel jour, quelle
 *    intensité. Le journal porte cette trace.
 *
 * 3. **Correction sans réécriture.** Une courbature déclarée après coup n'altère
 *    pas le passé — elle ajoute un événement. L'historique reste vrai.
 *
 * Le cache n'est qu'une optimisation de lecture : `pnpm db:rebuild-fatigue` le
 * régénère intégralement à partir du journal.
 */

/* -------------------------------------------------------------------------- */
/*                    Journal de fatigue — source de vérité                   */
/* -------------------------------------------------------------------------- */

export const muscleFatigueEvents = pgTable(
  'muscle_fatigue_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    muscleId: integer('muscle_id')
      .notNull()
      .references(() => muscles.id, { onDelete: 'cascade' }),

    /** Séance à l'origine de l'événement, si applicable. */
    workoutSessionId: uuid('workout_session_id').references(() => workoutSessions.id, {
      onDelete: 'cascade',
    }),

    /**
     * Instant de référence de la décroissance : la dernière série ayant
     * sollicité ce muscle pendant la séance.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    /**
     * Charge de fatigue normalisée.
     * Unité : une série menée à l'échec sur un moteur principal vaut 1,0.
     */
    stimulus: numeric('stimulus', { precision: 8, scale: 3 }).notNull(),

    /** Séries pondérées par la contribution — alimente le comptage du volume. */
    effectiveSets: numeric('effective_sets', { precision: 6, scale: 2 }).notNull().default('0'),

    /**
     * Demi-vie retenue pour cet événement, **figée à l'enregistrement**.
     *
     * C'est la colonne qui rend le modèle reproductible : elle intègre déjà la
     * modulation par le sommeil, le stress, l'âge et le niveau au moment où le
     * travail a été effectué. Elle ne doit jamais être recalculée.
     */
    halfLifeHours: numeric('half_life_hours', { precision: 6, scale: 2 }).notNull(),

    /**
     * Le muscle a-t-il été travaillé **directement** (moteur principal ou
     * secondaire lourd) ?
     *
     * Seul le travail direct déclenche le plancher de repos de 48 h. Sans cette
     * distinction, le rôle de stabilisateur des lombaires sur un squat
     * immobiliserait le bas du dos pendant deux jours.
     */
    isDirectWork: boolean('is_direct_work').notNull().default(true),

    source: fatigueSourceEnum('source').notNull().default('training'),

    /** Détail de traçabilité : séries, exercices, modulateurs appliqués. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Index principal : « tous les événements de ce muscle, du plus récent au
    // plus ancien » — la requête que fait le moteur à chaque calcul d'état.
    index('fatigue_events_user_muscle_time_idx').on(
      table.userId,
      table.muscleId,
      table.occurredAt.desc(),
    ),
    index('fatigue_events_session_idx').on(table.workoutSessionId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                        Cache de l'état de récupération                     */
/* -------------------------------------------------------------------------- */

export const muscleFatigueStates = pgTable(
  'muscle_fatigue_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    muscleId: integer('muscle_id')
      .notNull()
      .references(() => muscles.id, { onDelete: 'cascade' }),

    /** Fatigue résiduelle absolue, somme des stimuli décrus. */
    fatigueScore: numeric('fatigue_score', { precision: 8, scale: 3 }).notNull().default('0'),
    /** Fatigue rapportée à la capacité d'une séance pleine. */
    fatiguePct: numeric('fatigue_pct', { precision: 6, scale: 3 }).notNull().default('0'),
    status: fatigueStatusEnum('status').notNull().default('fresh'),

    /** Dernier travail direct — point de départ du plancher de 48 h. */
    lastStimulusAt: timestamp('last_stimulus_at', { withTimezone: true }),
    /** Instant de disponibilité prédit ; jamais avant le plancher. */
    availableAt: timestamp('available_at', { withTimezone: true }),
    /** Instant de retour au statut « frais ». */
    fullyRecoveredAt: timestamp('fully_recovered_at', { withTimezone: true }),

    /** Séries effectives sur les 7 derniers jours glissants. */
    weeklySets: numeric('weekly_sets', { precision: 6, scale: 2 }).notNull().default('0'),
    /** Séries effectives depuis le début de la semaine d'entraînement. */
    currentWeekSets: numeric('current_week_sets', { precision: 6, scale: 2 })
      .notNull()
      .default('0'),
    weeklySetsTarget: numeric('weekly_sets_target', { precision: 6, scale: 2 })
      .notNull()
      .default('0'),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.muscleId] })],
);

/* -------------------------------------------------------------------------- */
/*                          Auto-évaluation quotidienne                       */
/* -------------------------------------------------------------------------- */

/**
 * Point de forme déclaré par l'utilisateur.
 *
 * Ces valeurs modulent la demi-vie des événements de fatigue *créés ensuite* :
 * une mauvaise nuit ralentit la récupération à venir, elle ne réécrit pas
 * celle qui a déjà eu lieu.
 */
export const recoveryCheckins = pgTable(
  'recovery_checkins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),

    sleepHours: numeric('sleep_hours', { precision: 4, scale: 1 }),
    /** Qualité perçue, 1 (très mauvaise) à 5 (excellente). */
    sleepQuality: smallint('sleep_quality'),
    /** Stress, 1 (nul) à 5 (très élevé). */
    stress: smallint('stress'),
    /** Énergie, 1 (épuisé) à 5 (au top). */
    energy: smallint('energy'),
    restingHeartRate: smallint('resting_heart_rate'),
    notes: text('notes'),
  },
  (table) => [index('recovery_checkins_user_time_idx').on(table.userId, table.checkedAt.desc())],
);

/**
 * Courbatures déclarées, muscle par muscle.
 *
 * Une courbature persistante signale que la réparation n'est pas terminée,
 * indépendamment de ce que prédit le modèle. Au-delà de 3/5, un événement de
 * fatigue à demi-vie courte est ajouté au journal, ce qui repousse
 * effectivement la sollicitation du muscle.
 */
export const muscleSorenessReports = pgTable(
  'muscle_soreness_reports',
  {
    checkinId: uuid('checkin_id')
      .notNull()
      .references(() => recoveryCheckins.id, { onDelete: 'cascade' }),
    muscleId: integer('muscle_id')
      .notNull()
      .references(() => muscles.id, { onDelete: 'cascade' }),
    /** 0 (aucune) à 5 (invalidante). */
    soreness: smallint('soreness').notNull(),
  },
  (table) => [primaryKey({ columns: [table.checkinId, table.muscleId] })],
);

/* -------------------------------------------------------------------------- */
/*                                 Relations                                  */
/* -------------------------------------------------------------------------- */

export const muscleFatigueEventsRelations = relations(muscleFatigueEvents, ({ one }) => ({
  user: one(users, { fields: [muscleFatigueEvents.userId], references: [users.id] }),
  muscle: one(muscles, { fields: [muscleFatigueEvents.muscleId], references: [muscles.id] }),
  workoutSession: one(workoutSessions, {
    fields: [muscleFatigueEvents.workoutSessionId],
    references: [workoutSessions.id],
  }),
}));

export const muscleFatigueStatesRelations = relations(muscleFatigueStates, ({ one }) => ({
  user: one(users, { fields: [muscleFatigueStates.userId], references: [users.id] }),
  muscle: one(muscles, { fields: [muscleFatigueStates.muscleId], references: [muscles.id] }),
}));

export const recoveryCheckinsRelations = relations(recoveryCheckins, ({ one, many }) => ({
  user: one(users, { fields: [recoveryCheckins.userId], references: [users.id] }),
  soreness: many(muscleSorenessReports),
}));

export const muscleSorenessReportsRelations = relations(muscleSorenessReports, ({ one }) => ({
  checkin: one(recoveryCheckins, {
    fields: [muscleSorenessReports.checkinId],
    references: [recoveryCheckins.id],
  }),
  muscle: one(muscles, { fields: [muscleSorenessReports.muscleId], references: [muscles.id] }),
}));
