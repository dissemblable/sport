import {
  computeWeeklyFrequency,
  EXERCISE_BY_ID,
  EXERCISE_CATALOG,
  getSplit,
  type AthleteProfile,
  type EquipmentInventory,
  type MuscleSettingOverride,
  type ProgressionState,
  type StimulusEvent,
} from '@sport/core';
import {
  FATIGUE_WINDOW_DAYS,
  type BandDetails,
  type DumbbellDetails,
  type EquipmentCode,
  type MuscleCode,
  type PullUpBarDetails,
  type SplitDefinition,
  type SplitSlot,
} from '@sport/shared';
import {
  exerciseProgressionStates,
  muscleFatigueEvents,
  muscles,
  trainingPlans,
  userEquipment,
  userExercisePreferences,
  userMuscleSettings,
  userProfiles,
  users,
  type Database,
} from '@sport/db';
import { and, desc, eq, gte } from 'drizzle-orm';
import { notFound } from '../errors';

/**
 * Chargement de l'état de l'athlète depuis la base, vers les structures
 * attendues par le moteur.
 *
 * Toute la conversion de types vit ici : PostgreSQL renvoie les colonnes
 * `numeric` sous forme de chaînes (pour préserver la précision décimale) et
 * les dates sous forme d'objets `Date`. Le moteur, lui, ne manipule que des
 * nombres et des `Date`. Concentrer ces traductions dans un seul module évite
 * qu'un `parseFloat` oublié ne fasse silencieusement dériver un calcul de
 * fatigue.
 *
 * Le catalogue d'exercices n'est pas relu en base : il vient de `@sport/core`,
 * d'où provient aussi l'amorçage. Les tables `exercises` et `exercise_muscles`
 * assurent l'intégrité référentielle et permettent les agrégats SQL, mais la
 * source de vérité du domaine reste le code.
 */

/** Conversion d'une colonne `numeric` en nombre. */
export function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Idem, avec valeur de repli — pour les colonnes non nulles. */
export function numOr(value: string | null | undefined, fallback: number): number {
  return num(value) ?? fallback;
}

/* -------------------------------------------------------------------------- */
/*                                  Profil                                    */
/* -------------------------------------------------------------------------- */

export interface LoadedProfile {
  userId: string;
  displayName: string;
  profile: AthleteProfile;
  birthYear: number | null;
  sex: 'male' | 'female' | 'unspecified';
  heightCm: number | null;
}

export async function loadProfile(db: Database, userId: string): Promise<LoadedProfile> {
  const [row] = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      birthYear: userProfiles.birthYear,
      sex: userProfiles.sex,
      heightCm: userProfiles.heightCm,
      bodyWeightKg: userProfiles.bodyWeightKg,
      experienceLevel: userProfiles.experienceLevel,
      primaryGoal: userProfiles.primaryGoal,
      sessionsPerWeek: userProfiles.sessionsPerWeek,
      sessionDurationMinutes: userProfiles.sessionDurationMinutes,
      preferredWeekdays: userProfiles.preferredWeekdays,
      deloadEveryNWeeks: userProfiles.deloadEveryNWeeks,
    })
    .from(users)
    .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, userId));

  if (!row) throw notFound('Profil introuvable. Lancez `pnpm db:seed`.');

  const currentYear = new Date().getUTCFullYear();

  return {
    userId: row.userId,
    displayName: row.displayName,
    birthYear: row.birthYear,
    sex: row.sex,
    heightCm: num(row.heightCm),
    profile: {
      experienceLevel: row.experienceLevel,
      primaryGoal: row.primaryGoal,
      sessionsPerWeek: row.sessionsPerWeek,
      sessionDurationMinutes: row.sessionDurationMinutes,
      preferredWeekdays: row.preferredWeekdays,
      age: row.birthYear === null ? null : currentYear - row.birthYear,
      bodyWeightKg: num(row.bodyWeightKg),
      deloadEveryNWeeks: row.deloadEveryNWeeks,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                                 Matériel                                   */
/* -------------------------------------------------------------------------- */

/**
 * Matériel réellement possédé.
 *
 * Le poids du corps est ajouté d'office : c'est le socle de l'entraînement à
 * domicile, pas un équipement que l'on peut ne pas avoir.
 */
export async function loadInventory(db: Database, userId: string): Promise<EquipmentInventory> {
  const rows = await db
    .select({ code: userEquipment.code, details: userEquipment.details })
    .from(userEquipment)
    .where(eq(userEquipment.userId, userId));

  const owned = new Set<EquipmentCode>(['bodyweight']);
  let dumbbells: DumbbellDetails | null = null;
  let bands: BandDetails | null = null;
  let pullUpBarCanAddWeight = false;

  for (const row of rows) {
    owned.add(row.code);
    if (row.code === 'dumbbells') dumbbells = row.details as DumbbellDetails;
    if (row.code === 'resistance_bands') bands = row.details as BandDetails;
    if (row.code === 'pull_up_bar') {
      pullUpBarCanAddWeight = (row.details as PullUpBarDetails)?.canAddWeight ?? false;
    }
  }

  return {
    owned: [...owned],
    dumbbells: dumbbells && dumbbells.availableWeightsKg?.length ? dumbbells : null,
    bands: bands && bands.levels?.length ? bands : null,
    pullUpBarCanAddWeight,
  };
}

/* -------------------------------------------------------------------------- */
/*                          Réglages par muscle                               */
/* -------------------------------------------------------------------------- */

export async function loadMuscleOverrides(
  db: Database,
  userId: string,
): Promise<MuscleSettingOverride[]> {
  const rows = await db
    .select({
      code: muscles.code,
      priority: userMuscleSettings.priority,
      minRestHoursOverride: userMuscleSettings.minRestHoursOverride,
      weeklySetsOverride: userMuscleSettings.weeklySetsOverride,
      isExcluded: userMuscleSettings.isExcluded,
    })
    .from(userMuscleSettings)
    .innerJoin(muscles, eq(muscles.id, userMuscleSettings.muscleId))
    .where(eq(userMuscleSettings.userId, userId));

  return rows.map((row) => ({
    muscle: row.code,
    priority: numOr(row.priority, 1),
    minRestHoursOverride: row.minRestHoursOverride,
    weeklySetsOverride: num(row.weeklySetsOverride),
    isExcluded: row.isExcluded,
  }));
}

/** Exercices bannis (douleur, contre-indication) et favoris. */
export async function loadExercisePreferences(
  db: Database,
  userId: string,
): Promise<{ banned: Set<number>; favorites: Set<number> }> {
  const rows = await db
    .select({
      exerciseId: userExercisePreferences.exerciseId,
      status: userExercisePreferences.status,
    })
    .from(userExercisePreferences)
    .where(eq(userExercisePreferences.userId, userId));

  const banned = new Set<number>();
  const favorites = new Set<number>();
  for (const row of rows) {
    if (row.status === 'banned') banned.add(row.exerciseId);
    if (row.status === 'favorite') favorites.add(row.exerciseId);
  }
  return { banned, favorites };
}

/* -------------------------------------------------------------------------- */
/*                          Journal de fatigue                                */
/* -------------------------------------------------------------------------- */

/**
 * Événements de fatigue de la fenêtre utile.
 *
 * Au-delà de 14 jours, la contribution résiduelle d'un événement est inférieure
 * à 0,1 % : les charger n'apporterait rien et alourdirait chaque requête.
 */
export async function loadFatigueEvents(
  db: Database,
  userId: string,
  at: Date,
  windowDays = FATIGUE_WINDOW_DAYS,
): Promise<StimulusEvent[]> {
  const since = new Date(at.getTime() - windowDays * 86_400_000);

  const rows = await db
    .select({
      muscle: muscles.code,
      occurredAt: muscleFatigueEvents.occurredAt,
      stimulus: muscleFatigueEvents.stimulus,
      effectiveSets: muscleFatigueEvents.effectiveSets,
      halfLifeHours: muscleFatigueEvents.halfLifeHours,
      isDirectWork: muscleFatigueEvents.isDirectWork,
      source: muscleFatigueEvents.source,
      workoutSessionId: muscleFatigueEvents.workoutSessionId,
      metadata: muscleFatigueEvents.metadata,
    })
    .from(muscleFatigueEvents)
    .innerJoin(muscles, eq(muscles.id, muscleFatigueEvents.muscleId))
    .where(
      and(eq(muscleFatigueEvents.userId, userId), gte(muscleFatigueEvents.occurredAt, since)),
    )
    .orderBy(desc(muscleFatigueEvents.occurredAt));

  return rows.map((row) => ({
    muscle: row.muscle,
    occurredAt: row.occurredAt,
    stimulus: numOr(row.stimulus, 0),
    effectiveSets: numOr(row.effectiveSets, 0),
    halfLifeHours: numOr(row.halfLifeHours, 24),
    isDirectWork: row.isDirectWork,
    source: row.source,
    workoutSessionId: row.workoutSessionId,
    metadata: row.metadata,
  }));
}

/* -------------------------------------------------------------------------- */
/*                          État de progression                               */
/* -------------------------------------------------------------------------- */

export async function loadProgressionStates(
  db: Database,
  userId: string,
): Promise<Map<number, ProgressionState>> {
  const rows = await db
    .select()
    .from(exerciseProgressionStates)
    .where(eq(exerciseProgressionStates.userId, userId));

  return new Map(
    rows.map((row) => [
      row.exerciseId,
      {
        exerciseId: row.exerciseId,
        currentLoadKg: num(row.currentLoadKg),
        currentBandLevel: row.currentBandLevel,
        currentRepTarget: row.currentRepTarget,
        consecutiveSuccesses: row.consecutiveSuccesses,
        consecutiveFailures: row.consecutiveFailures,
        lastPerformedAt: row.lastPerformedAt,
      } satisfies ProgressionState,
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Plan                                     */
/* -------------------------------------------------------------------------- */

export interface ActivePlan {
  id: string;
  mesocycleId: string;
  version: number;
  sessionsPerWeek: number;
  split: SplitDefinition;
  weekdays: number[];
  mesocycleStartDate: string;
  durationWeeks: number;
}

/**
 * Plan actif, avec son split reconstruit.
 *
 * Le découpage est relu depuis `split_definition` plutôt que recalculé : il a
 * été figé à la création du plan, et le recalculer ferait silencieusement
 * changer un programme en cours si les définitions de split évoluaient.
 */
export async function loadActivePlan(db: Database, userId: string): Promise<ActivePlan | null> {
  const rows = await db.query.trainingPlans.findMany({
    where: and(eq(trainingPlans.userId, userId), eq(trainingPlans.isActive, true)),
    with: { mesocycle: true },
    orderBy: [desc(trainingPlans.version)],
    limit: 1,
  });

  const row = rows[0];
  if (!row) return null;

  const slots = row.splitDefinition as SplitSlot[];

  return {
    id: row.id,
    mesocycleId: row.mesocycleId,
    version: row.version,
    sessionsPerWeek: row.sessionsPerWeek,
    weekdays: row.weekdays,
    mesocycleStartDate: row.mesocycle.startDate,
    durationWeeks: row.mesocycle.durationWeeks,
    split: {
      type: row.splitType,
      sessionsPerWeek: row.sessionsPerWeek,
      slots,
      weeklyFrequencyByMuscle: computeWeeklyFrequency(slots),
      minGapHours: row.minGapHours,
    },
  };
}

/** Split par défaut, quand aucun plan n'a encore été généré. */
export function fallbackSplit(sessionsPerWeek: number): SplitDefinition {
  return getSplit(sessionsPerWeek);
}

/* -------------------------------------------------------------------------- */
/*                         Correspondances muscles                            */
/* -------------------------------------------------------------------------- */

export async function loadMuscleIds(db: Database): Promise<Map<MuscleCode, number>> {
  const rows = await db.select({ id: muscles.id, code: muscles.code }).from(muscles);
  return new Map(rows.map((row) => [row.code, row.id]));
}

export { EXERCISE_BY_ID, EXERCISE_CATALOG };
