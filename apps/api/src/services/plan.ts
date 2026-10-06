import {
  buildFatigueSnapshot,
  buildMesocycleSchedule,
  buildMuscleConfigs,
  buildStimulusEvents,
  EXERCISE_BY_ID,
  EXERCISE_CATALOG,
  generateSession,
  phaseForWeek,
  planFrequencyChange,
  startOfWeek,
  toIsoDate,
  type GeneratedSession,
  type MuscleConfigMap,
  type PerformedSet,
} from '@sport/core';
import {
  EXCLUSION_REASON_LABELS,
  MUSCLE_LABELS,
  SPLIT_TYPE_LABELS,
  type MuscleCode,
  type Prescription,
} from '@sport/shared';
import {
  mesocycles,
  plannedExercises,
  plannedSessionMuscles,
  plannedSessions,
  trainingPlans,
  type Database,
} from '@sport/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../errors';
import {
  loadActivePlan,
  loadExercisePreferences,
  loadFatigueEvents,
  loadInventory,
  loadMuscleOverrides,
  loadProfile,
  loadProgressionStates,
} from './loaders';
import { buildAthleteContext } from './recovery';

/**
 * Génération et modulation du plan d'entraînement.
 *
 * Deux opérations structurent ce module :
 *
 * - **`generateMesocycle`** crée un bloc complet : split, placement des jours,
 *   puis génération de chaque séance à partir de l'état de fatigue *projeté* à
 *   sa date.
 *
 * - **`changeFrequency`** applique un changement de rythme. Le principe
 *   directeur est que les séances déjà réalisées ne bougent jamais : une
 *   nouvelle version de plan est créée, l'ancienne archivée, et seules les
 *   séances futures encore au statut « planifiée » sont régénérées.
 */

/* -------------------------------------------------------------------------- */
/*                          Génération d'un mésocycle                         */
/* -------------------------------------------------------------------------- */

export interface GenerateMesocycleOptions {
  startDate?: Date;
  weeks?: number;
  sessionsPerWeek?: number;
  preferredWeekdays?: number[];
  /** Archive le mésocycle en cours au lieu de le compléter. */
  restart?: boolean;
  now: Date;
}

export async function generateMesocycle(
  db: Database,
  userId: string,
  options: GenerateMesocycleOptions,
) {
  const { profile } = await loadProfile(db, userId);
  const inventory = await loadInventory(db, userId);
  const overrides = await loadMuscleOverrides(db, userId);
  const { banned, favorites } = await loadExercisePreferences(db, userId);
  const progression = await loadProgressionStates(db, userId);

  const sessionsPerWeek = options.sessionsPerWeek ?? profile.sessionsPerWeek;
  const preferredWeekdays = options.preferredWeekdays ?? profile.preferredWeekdays;
  const startDate = options.startDate ?? options.now;

  const schedule = buildMesocycleSchedule({
    startDate,
    weeks: options.weeks,
    profile: { ...profile, sessionsPerWeek, preferredWeekdays },
    sessionsPerWeek,
    preferredWeekdays,
  });

  // Archivage de l'existant : un seul plan actif à la fois.
  if (options.restart) {
    await db
      .update(mesocycles)
      .set({ status: 'abandoned', completedAt: options.now })
      .where(and(eq(mesocycles.userId, userId), eq(mesocycles.status, 'active')));
  }
  await db
    .update(trainingPlans)
    .set({ isActive: false, supersededAt: options.now })
    .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.isActive, true)));

  const [mesocycle] = await db
    .insert(mesocycles)
    .values({
      userId,
      name: `Bloc ${SPLIT_TYPE_LABELS[schedule.split.type]} — ${schedule.weeks} semaines`,
      startDate: toIsoDate(startOfWeek(startDate)),
      durationWeeks: schedule.weeks,
      status: 'active',
    })
    .returning();

  const [plan] = await db
    .insert(trainingPlans)
    .values({
      userId,
      mesocycleId: mesocycle!.id,
      version: 1,
      sessionsPerWeek,
      splitType: schedule.split.type,
      splitDefinition: schedule.split.slots,
      weekdays: schedule.placement.weekdays,
      minGapHours: Math.round(schedule.placement.minGapHours),
      isActive: true,
      changeReason: 'Création du mésocycle',
      generatedAt: options.now,
    })
    .returning();

  const events = await loadFatigueEvents(db, userId, options.now);

  await materializeSessions(db, {
    userId,
    planId: plan!.id,
    schedule,
    profile: { ...profile, sessionsPerWeek, preferredWeekdays },
    inventory,
    overrides,
    banned,
    favorites,
    progression,
    events,
    now: options.now,
  });

  return {
    mesocycleId: mesocycle!.id,
    planId: plan!.id,
    split: schedule.split,
    weekdays: schedule.placement.weekdays,
    weeks: schedule.weeks,
    sessionCount: schedule.sessions.length,
    minGapHours: Math.round(schedule.placement.minGapHours),
    warnings: schedule.warnings,
  };
}

/**
 * Génère et enregistre chaque séance planifiée du bloc.
 *
 * Point délicat : la fatigue est **projetée dans le futur**. Pour la séance de
 * jeudi, l'algorithme doit connaître l'effet de celle de mardi, qui n'a pas
 * encore eu lieu. On simule donc le travail prescrit et on l'ajoute au journal
 * en mémoire — sans jamais l'écrire en base, puisqu'il n'a pas été réalisé.
 * Ces séances sont de toute façon régénérées si la réalité s'écarte du plan.
 */
async function materializeSessions(
  db: Database,
  params: {
    userId: string;
    planId: string;
    schedule: ReturnType<typeof buildMesocycleSchedule>;
    profile: Parameters<typeof buildMuscleConfigs>[0]['profile'];
    inventory: Awaited<ReturnType<typeof loadInventory>>;
    overrides: Awaited<ReturnType<typeof loadMuscleOverrides>>;
    banned: Set<number>;
    favorites: Set<number>;
    progression: Awaited<ReturnType<typeof loadProgressionStates>>;
    events: Awaited<ReturnType<typeof loadFatigueEvents>>;
    now: Date;
    fromDate?: Date;
  },
) {
  const { schedule, profile, inventory, overrides, banned, favorites, progression } = params;
  const projectedEvents = [...params.events];

  let previousSessionExerciseIds = new Set<number>();
  let currentWeek = 0;
  let sessionsThisWeek = 0;

  for (const scheduled of schedule.sessions) {
    if (params.fromDate && scheduled.date < params.fromDate) continue;

    if (scheduled.week !== currentWeek) {
      currentWeek = scheduled.week;
      sessionsThisWeek = 0;
    }

    // Heure conventionnelle de séance : le placement raisonne en jours, la
    // fatigue en heures. 18 h est un compromis neutre pour l'entraînement
    // à domicile en semaine.
    const at = new Date(scheduled.date.getTime() + 18 * 3_600_000);

    const muscleConfigs = buildMuscleConfigs({
      profile,
      weeklyFrequencyByMuscle: schedule.split.weeklyFrequencyByMuscle,
      mesocycleWeek: scheduled.week,
      totalWeeks: schedule.weeks,
      phase: scheduled.phase,
      overrides,
    });

    const snapshot = buildFatigueSnapshot({
      now: at,
      events: projectedEvents,
      muscleConfigs,
      weekStartedAt: startOfWeek(at),
    });

    const generated = generateSession({
      now: at,
      slotIndex: scheduled.slotIndex,
      split: schedule.split,
      profile,
      inventory,
      muscleConfigs,
      snapshot,
      mesocycleWeek: scheduled.week,
      phase: scheduled.phase,
      exercises: EXERCISE_CATALOG,
      bannedExerciseIds: banned,
      favoriteExerciseIds: favorites,
      progression,
      previousSessionExerciseIds,
      sessionsCompletedThisWeek: sessionsThisWeek,
    });

    await persistPlannedSession(db, {
      userId: params.userId,
      planId: params.planId,
      scheduledDate: toIsoDate(scheduled.date),
      mesocycleWeek: scheduled.week,
      phase: scheduled.phase,
      generated,
    });

    projectedEvents.push(...projectSessionFatigue(generated, at, muscleConfigs));
    previousSessionExerciseIds = new Set(generated.exercises.map((e) => e.exercise.id));
    sessionsThisWeek += 1;
  }
}

/** Simule la fatigue qu'une séance planifiée produira si elle est suivie. */
function projectSessionFatigue(
  generated: GeneratedSession,
  at: Date,
  muscleConfigs: MuscleConfigMap,
) {
  const sets: PerformedSet[] = generated.exercises
    .filter((e) => e.block !== 'warmup')
    .flatMap((prescribed) =>
      Array.from({ length: prescribed.targetSets }, () => ({
        exerciseId: prescribed.exercise.id,
        isWarmup: false,
        reps: prescribed.targetRepMax,
        loadKg: prescribed.loadKg,
        bandLevel: prescribed.bandLevel,
        rir: prescribed.targetRir,
        toFailure: prescribed.targetRir === 0,
        durationSeconds: null,
        performedAt: at,
      })),
    );

  return buildStimulusEvents(sets, { exercisesById: EXERCISE_BY_ID, muscleConfigs });
}

/* -------------------------------------------------------------------------- */
/*                        Persistance d'une séance                            */
/* -------------------------------------------------------------------------- */

export async function persistPlannedSession(
  db: Database,
  params: {
    userId: string;
    planId: string;
    scheduledDate: string;
    mesocycleWeek: number;
    phase: 'accumulation' | 'intensification' | 'deload';
    generated: GeneratedSession;
  },
) {
  const { generated } = params;

  const [session] = await db
    .insert(plannedSessions)
    .values({
      userId: params.userId,
      planId: params.planId,
      scheduledDate: params.scheduledDate,
      slotIndex: generated.slotIndex,
      slotLabel: generated.slotLabel,
      mesocycleWeek: params.mesocycleWeek,
      phase: params.phase,
      status: 'planned',
      estimatedDurationMinutes: generated.estimatedDurationMinutes,
      generationSnapshot: serializeReport(generated),
    })
    .returning();

  if (generated.exercises.length > 0) {
    await db.insert(plannedExercises).values(
      generated.exercises.map((prescribed) => ({
        plannedSessionId: session!.id,
        exerciseId: prescribed.exercise.id,
        position: prescribed.position,
        block: prescribed.block,
        targetSets: prescribed.targetSets,
        targetRepMin: prescribed.targetRepMin,
        targetRepMax: prescribed.targetRepMax,
        targetRir: prescribed.targetRir,
        restSeconds: prescribed.restSeconds,
        prescription: {
          loadKg: prescribed.loadKg,
          bandLevel: prescribed.bandLevel,
          tempo: prescribed.tempo,
          perSide: prescribed.perSide,
          progressionNote: prescribed.progressionNote,
        } satisfies Prescription,
        rationale: prescribed.rationale,
      })),
    );
  }

  const muscleRows = Object.entries(generated.report.plannedSetsByMuscle).map(
    ([muscle, sets]) => ({
      plannedSessionId: session!.id,
      muscleCode: muscle as MuscleCode,
      plannedSets: String(sets ?? 0),
    }),
  );
  if (muscleRows.length > 0) await db.insert(plannedSessionMuscles).values(muscleRows);

  return session!;
}

/** Sérialise le compte rendu du moteur pour la colonne JSONB. */
export function serializeReport(generated: GeneratedSession) {
  const report = generated.report;
  return {
    generatedAt: report.generatedAt.toISOString(),
    splitSlotLabel: report.slotLabel,
    mesocycleWeek: report.mesocycleWeek,
    phase: report.phase,
    targetedMuscles: report.targetedMuscles,
    excludedMuscles: report.excludedMuscles.map((entry) => ({
      muscle: entry.muscle,
      label: MUSCLE_LABELS[entry.muscle],
      reason: entry.reason,
      reasonLabel: EXCLUSION_REASON_LABELS[entry.reason],
      availableAt: entry.availableAt?.toISOString() ?? null,
      hoursUntilAvailable: entry.hoursUntilAvailable,
    })),
    plannedSetsByMuscle: report.plannedSetsByMuscle,
    remainingDebtByMuscle: report.remainingDebtByMuscle,
    coveredPatterns: report.coveredPatterns,
    isFallbackSession: report.isFallbackSession,
    warnings: report.warnings,
  };
}

/* -------------------------------------------------------------------------- */
/*                          Changement de fréquence                           */
/* -------------------------------------------------------------------------- */

export interface ChangeFrequencyOptions {
  sessionsPerWeek: number;
  preferredWeekdays?: number[];
  /** Calcule l'impact sans rien écrire. */
  preview: boolean;
  reason?: string;
  now: Date;
}

export async function changeFrequency(
  db: Database,
  userId: string,
  options: ChangeFrequencyOptions,
) {
  const context = await buildAthleteContext(db, userId, options.now);
  const plan = await loadActivePlan(db, userId);

  if (!plan) {
    throw notFound('Aucun plan actif. Générez d’abord un mésocycle via POST /api/plan/generate.');
  }
  if (plan.sessionsPerWeek === options.sessionsPerWeek && !options.preferredWeekdays) {
    throw badRequest(`Votre plan est déjà réglé sur ${options.sessionsPerWeek} séances par semaine.`);
  }

  const impact = planFrequencyChange({
    currentSessionsPerWeek: plan.sessionsPerWeek,
    newSessionsPerWeek: options.sessionsPerWeek,
    profile: context.profile,
    preferredWeekdays: options.preferredWeekdays,
    mesocycleWeek: context.mesocycleWeek,
    totalWeeks: context.totalWeeks,
    phase: context.phase,
    overrides: await loadMuscleOverrides(db, userId),
  });

  if (options.preview) {
    return { applied: false, impact, planId: plan.id, version: plan.version };
  }

  /* ---------------------------------------------------------------------- */
  /*  Application : nouvelle version, séances passées intactes               */
  /* ---------------------------------------------------------------------- */

  // Le nouveau plan démarre au début de la semaine en cours : la semaine
  // partiellement réalisée est reprise en compte, sans effacer ce qui a été fait.
  const fromDate = startOfWeek(options.now);

  await db
    .update(trainingPlans)
    .set({ isActive: false, supersededAt: options.now })
    .where(eq(trainingPlans.id, plan.id));

  const [newPlan] = await db
    .insert(trainingPlans)
    .values({
      userId,
      mesocycleId: plan.mesocycleId,
      version: plan.version + 1,
      sessionsPerWeek: options.sessionsPerWeek,
      splitType: impact.newSplit.type,
      splitDefinition: impact.newSplit.slots,
      weekdays: impact.placement.weekdays,
      minGapHours: Math.round(impact.placement.minGapHours),
      isActive: true,
      changeReason:
        options.reason ??
        `Passage de ${plan.sessionsPerWeek} à ${options.sessionsPerWeek} séances par semaine`,
      generatedAt: options.now,
    })
    .returning();

  // Les séances futures encore planifiées de l'ancien plan sont marquées
  // « remplacées » : elles restent visibles dans l'historique du plan précédent,
  // mais ne sont plus proposées. Les séances réalisées ne sont jamais touchées.
  await db
    .update(plannedSessions)
    .set({ status: 'superseded' })
    .where(
      and(
        eq(plannedSessions.planId, plan.id),
        eq(plannedSessions.status, 'planned'),
        gte(plannedSessions.scheduledDate, toIsoDate(fromDate)),
      ),
    );

  const remainingWeeks = Math.max(
    1,
    context.totalWeeks - (context.mesocycleWeek - 1),
  );

  const schedule = buildMesocycleSchedule({
    startDate: fromDate,
    weeks: remainingWeeks,
    profile: { ...context.profile, sessionsPerWeek: options.sessionsPerWeek },
    sessionsPerWeek: options.sessionsPerWeek,
    preferredWeekdays: options.preferredWeekdays ?? context.profile.preferredWeekdays,
  });

  // Les semaines du nouveau planning reprennent là où le mésocycle en est.
  const offsetSchedule = {
    ...schedule,
    weeks: context.totalWeeks,
    sessions: schedule.sessions.map((session) => {
      const week = context.mesocycleWeek + session.week - 1;
      return { ...session, week, phase: phaseForWeek(week, context.totalWeeks) };
    }),
  };

  const { banned, favorites } = await loadExercisePreferences(db, userId);

  await materializeSessions(db, {
    userId,
    planId: newPlan!.id,
    schedule: offsetSchedule,
    profile: { ...context.profile, sessionsPerWeek: options.sessionsPerWeek },
    inventory: await loadInventory(db, userId),
    overrides: await loadMuscleOverrides(db, userId),
    banned,
    favorites,
    progression: await loadProgressionStates(db, userId),
    events: context.events,
    now: options.now,
    fromDate: new Date(Math.max(fromDate.getTime(), startOfDay(options.now).getTime())),
  });

  await db
    .update(mesocycles)
    .set({ durationWeeks: context.totalWeeks })
    .where(eq(mesocycles.id, plan.mesocycleId));

  return {
    applied: true,
    impact,
    planId: newPlan!.id,
    version: newPlan!.version,
  };
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Deload                                    */
/* -------------------------------------------------------------------------- */

/** Bascule les séances futures de la semaine en cours en décharge. */
export async function applyDeload(db: Database, userId: string, now: Date) {
  const plan = await loadActivePlan(db, userId);
  if (!plan) throw notFound('Aucun plan actif.');

  const weekStart = toIsoDate(startOfWeek(now));

  const upcoming = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.planId, plan.id),
        eq(plannedSessions.status, 'planned'),
        gte(plannedSessions.scheduledDate, weekStart),
      ),
    );

  if (upcoming.length === 0) return { updated: 0 };

  await db
    .update(plannedSessions)
    .set({ phase: 'deload' })
    .where(
      inArray(
        plannedSessions.id,
        upcoming.map((s) => s.id),
      ),
    );

  // Les séances sont régénérées par le service de séance à la demande ; on se
  // contente ici de marquer la phase, ce qui suffit à réduire volume et RIR.
  await db
    .update(plannedExercises)
    .set({ targetRir: sql`${plannedExercises.targetRir} + 2` })
    .where(
      inArray(
        plannedExercises.plannedSessionId,
        upcoming.map((s) => s.id),
      ),
    );

  return { updated: upcoming.length };
}
