import { z } from 'zod';
import {
  BIOLOGICAL_SEXES,
  EQUIPMENT_CODES,
  EXERCISE_PREFERENCES,
  EXPERIENCE_LEVELS,
  MOVEMENT_PATTERNS,
  MUSCLE_CODES,
  TRAINING_GOALS,
} from './enums';
import {
  DEFAULT_MIN_REST_HOURS,
  MAX_SESSION_DURATION_MINUTES,
  MAX_SESSIONS_PER_WEEK,
  MIN_SESSION_DURATION_MINUTES,
  MIN_SESSIONS_PER_WEEK,
} from './constants';

/**
 * Schémas zod du contrat d'API.
 *
 * Importés côté serveur par `@hono/zod-validator` et côté client pour valider
 * les formulaires : une règle de validation n'existe qu'à un seul endroit.
 */

/* -------------------------------------------------------------------------- */
/*                                Primitives                                  */
/* -------------------------------------------------------------------------- */

export const muscleCodeSchema = z.enum(MUSCLE_CODES);
export const equipmentCodeSchema = z.enum(EQUIPMENT_CODES);
export const movementPatternSchema = z.enum(MOVEMENT_PATTERNS);

/** Date au format ISO `AAAA-MM-JJ`. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Jour de la semaine, 0 = lundi … 6 = dimanche. */
export const weekdaySchema = z.number().int().min(0).max(6);

export const sessionsPerWeekSchema = z
  .number()
  .int()
  .min(MIN_SESSIONS_PER_WEEK, `Minimum ${MIN_SESSIONS_PER_WEEK} séances par semaine`)
  .max(MAX_SESSIONS_PER_WEEK, `Maximum ${MAX_SESSIONS_PER_WEEK} séances par semaine`);

/* -------------------------------------------------------------------------- */
/*                                  Profil                                    */
/* -------------------------------------------------------------------------- */

export const updateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    birthYear: z.number().int().min(1920).max(new Date().getFullYear()).nullable(),
    sex: z.enum(BIOLOGICAL_SEXES),
    heightCm: z.number().min(100).max(250).nullable(),
    bodyWeightKg: z.number().min(30).max(300).nullable(),
    experienceLevel: z.enum(EXPERIENCE_LEVELS),
    primaryGoal: z.enum(TRAINING_GOALS),
    sessionsPerWeek: sessionsPerWeekSchema,
    sessionDurationMinutes: z
      .number()
      .int()
      .min(MIN_SESSION_DURATION_MINUTES)
      .max(MAX_SESSION_DURATION_MINUTES),
    preferredWeekdays: z.array(weekdaySchema).min(1).max(7),
    deloadEveryNWeeks: z.number().int().min(3).max(12),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/* -------------------------------------------------------------------------- */
/*                                  Matériel                                  */
/* -------------------------------------------------------------------------- */

export const dumbbellDetailsSchema = z.object({
  availableWeightsKg: z.array(z.number().positive().max(100)).min(1),
  pairCount: z.number().int().min(1).max(2),
  incrementKg: z.number().positive().max(20),
});

export const bandDetailsSchema = z.object({
  levels: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        approxKg: z.number().positive().max(120),
      }),
    )
    .min(1),
});

export const pullUpBarDetailsSchema = z.object({
  canAddWeight: z.boolean(),
});

export const updateEquipmentSchema = z.object({
  items: z
    .array(
      z.object({
        equipment: equipmentCodeSchema,
        details: z.union([
          dumbbellDetailsSchema,
          bandDetailsSchema,
          pullUpBarDetailsSchema,
          z.object({}).strict(),
        ]),
      }),
    )
    .min(1, 'Au moins un équipement doit être déclaré'),
});
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;

/* -------------------------------------------------------------------------- */
/*                          Réglages par muscle                               */
/* -------------------------------------------------------------------------- */

export const updateMuscleSettingsSchema = z.object({
  settings: z.array(
    z.object({
      muscle: muscleCodeSchema,
      priority: z.number().min(0.5).max(2).default(1),
      // Le plancher de 48 h est une garantie du produit : un réglage
      // utilisateur peut allonger le repos d'un muscle, jamais le raccourcir.
      minRestHoursOverride: z
        .number()
        .int()
        .min(DEFAULT_MIN_REST_HOURS)
        .max(168)
        .nullable()
        .default(null),
      weeklySetsOverride: z.number().min(0).max(40).nullable().default(null),
      isExcluded: z.boolean().default(false),
    }),
  ),
});
export type UpdateMuscleSettingsInput = z.infer<typeof updateMuscleSettingsSchema>;

export const updateExercisePreferenceSchema = z.object({
  exerciseId: z.number().int().positive(),
  status: z.enum(EXERCISE_PREFERENCES).nullable(),
  reason: z.string().max(280).nullable().default(null),
});
export type UpdateExercisePreferenceInput = z.infer<typeof updateExercisePreferenceSchema>;

/* -------------------------------------------------------------------------- */
/*                                Récupération                                */
/* -------------------------------------------------------------------------- */

export const createCheckinSchema = z.object({
  checkedAt: isoDateTimeSchema.optional(),
  sleepHours: z.number().min(0).max(16).nullable().default(null),
  /** Qualité perçue du sommeil, 1 (très mauvaise) à 5 (excellente). */
  sleepQuality: z.number().int().min(1).max(5).nullable().default(null),
  /** Niveau de stress, 1 (nul) à 5 (très élevé). */
  stress: z.number().int().min(1).max(5).nullable().default(null),
  /** Énergie ressentie, 1 (épuisé) à 5 (au top). */
  energy: z.number().int().min(1).max(5).nullable().default(null),
  restingHeartRate: z.number().int().min(30).max(140).nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
  /** Courbatures déclarées par muscle, 0 (aucune) à 5 (invalidante). */
  soreness: z
    .array(
      z.object({
        muscle: muscleCodeSchema,
        soreness: z.number().int().min(0).max(5),
      }),
    )
    .default([]),
});
export type CreateCheckinInput = z.infer<typeof createCheckinSchema>;

export const recoveryTimelineQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

/* -------------------------------------------------------------------------- */
/*                                    Plan                                    */
/* -------------------------------------------------------------------------- */

export const generatePlanSchema = z.object({
  startDate: isoDateSchema.optional(),
  sessionsPerWeek: sessionsPerWeekSchema.optional(),
  durationWeeks: z.number().int().min(2).max(12).optional(),
  preferredWeekdays: z.array(weekdaySchema).min(1).max(7).optional(),
  /** Repart de zéro et archive le mésocycle en cours. */
  restart: z.boolean().default(false),
});
export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;

/**
 * Changement de fréquence hebdomadaire.
 *
 * Déclenche la création d'une nouvelle version de plan : les séances déjà
 * réalisées sont conservées telles quelles, les séances futures sont
 * régénérées avec le volume hebdomadaire redistribué.
 */
export const changeFrequencySchema = z.object({
  sessionsPerWeek: sessionsPerWeekSchema,
  preferredWeekdays: z.array(weekdaySchema).min(1).max(7).optional(),
  /** Calcule et renvoie l'impact sans rien écrire en base. */
  preview: z.boolean().default(false),
  reason: z.string().max(280).optional(),
});
export type ChangeFrequencyInput = z.infer<typeof changeFrequencySchema>;

/* -------------------------------------------------------------------------- */
/*                                  Séances                                   */
/* -------------------------------------------------------------------------- */

export const listSessionsQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export const moveSessionSchema = z.object({
  scheduledDate: isoDateSchema,
  /** Déplace malgré une violation du repos minimum (décision de l'utilisateur). */
  force: z.boolean().default(false),
});
export type MoveSessionInput = z.infer<typeof moveSessionSchema>;

export const previewSessionSchema = z.object({
  /** Instant de référence — permet de simuler « et demain matin ? ». */
  at: isoDateTimeSchema.optional(),
  durationMinutes: z
    .number()
    .int()
    .min(MIN_SESSION_DURATION_MINUTES)
    .max(MAX_SESSION_DURATION_MINUTES)
    .optional(),
});
export type PreviewSessionInput = z.infer<typeof previewSessionSchema>;

/* -------------------------------------------------------------------------- */
/*                                 Entraînement                               */
/* -------------------------------------------------------------------------- */

export const startWorkoutSchema = z.object({
  plannedSessionId: z.string().uuid().nullable().default(null),
  startedAt: isoDateTimeSchema.optional(),
});
export type StartWorkoutInput = z.infer<typeof startWorkoutSchema>;

/**
 * Enregistrement d'une série.
 *
 * `reps` ou `durationSeconds` doit être renseigné : un gainage n'a pas de
 * répétitions, une série de pompes n'a pas de durée.
 */
export const logSetSchema = z
  .object({
    exerciseId: z.number().int().positive(),
    setIndex: z.number().int().min(1).max(30),
    isWarmup: z.boolean().default(false),
    reps: z.number().int().min(1).max(200).nullable().default(null),
    loadKg: z.number().min(0).max(300).nullable().default(null),
    bandLevel: z.string().max(40).nullable().default(null),
    /** Répétitions en réserve, 0 = échec musculaire. */
    rir: z.number().min(0).max(10).nullable().default(null),
    toFailure: z.boolean().default(false),
    tempo: z.string().max(12).nullable().default(null),
    durationSeconds: z.number().int().min(1).max(1200).nullable().default(null),
    performedAt: isoDateTimeSchema.optional(),
  })
  .refine((v) => v.reps !== null || v.durationSeconds !== null, {
    message: 'Renseignez soit un nombre de répétitions, soit une durée',
    path: ['reps'],
  });
export type LogSetInput = z.infer<typeof logSetSchema>;

export const finishWorkoutSchema = z.object({
  /** RPE global de la séance, 1 (très facile) à 10 (maximal). */
  sessionRpe: z.number().int().min(1).max(10).nullable().default(null),
  notes: z.string().max(1000).nullable().default(null),
  endedAt: isoDateTimeSchema.optional(),
});
export type FinishWorkoutInput = z.infer<typeof finishWorkoutSchema>;

/* -------------------------------------------------------------------------- */
/*                                 Exercices                                  */
/* -------------------------------------------------------------------------- */

export const listExercisesQuerySchema = z.object({
  muscle: muscleCodeSchema.optional(),
  pattern: movementPatternSchema.optional(),
  equipment: equipmentCodeSchema.optional(),
  maxDifficulty: z.coerce.number().int().min(1).max(5).optional(),
  /** Ne renvoie que les exercices réalisables avec le matériel déclaré. */
  onlyAvailable: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  search: z.string().max(80).optional(),
});

/* -------------------------------------------------------------------------- */
/*                                Statistiques                                */
/* -------------------------------------------------------------------------- */

export const volumeStatsQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(8),
  muscle: muscleCodeSchema.optional(),
});
