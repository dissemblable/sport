import {
  buildMuscleConfigs,
  buildSorenessEvents,
  buildStimulusEvents,
  EXERCISE_BY_ID,
  evaluateProgression,
  initialProgressionState,
  phaseForWeek,
  type PerformedSet,
  type RecoveryContext,
  type StimulusEvent,
} from '@sport/core';
import type { LogSetInput, SorenessReport } from '@sport/shared';
import {
  exerciseProgressionStates,
  muscleFatigueEvents,
  personalRecords,
  plannedSessions,
  sessionSets,
  workoutSessions,
  type Database,
} from '@sport/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../errors';
import {
  loadActivePlan,
  loadInventory,
  loadMuscleIds,
  loadMuscleOverrides,
  loadProfile,
  loadProgressionStates,
  num,
} from './loaders';
import {
  buildAthleteContext,
  loadLatestCheckin,
  mesocycleWeekFor,
  persistFatigueCache,
} from './recovery';

/**
 * Enregistrement de l'entraînement réellement effectué.
 *
 * C'est le point de bouclage du système : sans lui, le moteur de récupération
 * n'aurait rien à mesurer. Trois choses se produisent quand une séance est
 * clôturée :
 *
 *  1. les séries sont converties en **événements de fatigue** et ajoutées au
 *     journal — jamais mises à jour, toujours ajoutées ;
 *  2. l'**état de progression** de chaque exercice est réévalué (double
 *     progression) ;
 *  3. le **cache de récupération** est reprojeté.
 *
 * L'ordre importe : la progression se juge sur ce qui a été fait, et la fatigue
 * doit être écrite avant que le cache ne soit recalculé.
 */

/* -------------------------------------------------------------------------- */
/*                            Démarrage de séance                             */
/* -------------------------------------------------------------------------- */

export async function startWorkout(
  db: Database,
  userId: string,
  params: { plannedSessionId: string | null; startedAt: Date },
) {
  if (params.plannedSessionId) {
    const [planned] = await db
      .select({ id: plannedSessions.id, status: plannedSessions.status })
      .from(plannedSessions)
      .where(
        and(
          eq(plannedSessions.id, params.plannedSessionId),
          eq(plannedSessions.userId, userId),
        ),
      );

    if (!planned) throw notFound('Séance planifiée introuvable.');
    if (planned.status === 'completed') {
      throw badRequest('Cette séance a déjà été enregistrée comme terminée.');
    }
  }

  // Une séance déjà ouverte est reprise plutôt que dupliquée : on ne veut pas
  // deux séances actives si l'utilisateur recharge la page.
  const [open] = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), sql`${workoutSessions.endedAt} is null`))
    .orderBy(desc(workoutSessions.startedAt))
    .limit(1);

  if (open) return { workout: open, resumed: true };

  const [workout] = await db
    .insert(workoutSessions)
    .values({
      userId,
      plannedSessionId: params.plannedSessionId,
      startedAt: params.startedAt,
      isAdHoc: params.plannedSessionId === null,
    })
    .returning();

  return { workout: workout!, resumed: false };
}

/* -------------------------------------------------------------------------- */
/*                          Enregistrement d'une série                        */
/* -------------------------------------------------------------------------- */

export async function logSet(
  db: Database,
  userId: string,
  workoutId: string,
  input: LogSetInput,
  now: Date,
) {
  const workout = await requireOpenWorkout(db, userId, workoutId);

  if (!EXERCISE_BY_ID.has(input.exerciseId)) {
    throw badRequest(`Exercice inconnu : ${input.exerciseId}.`);
  }

  const [row] = await db
    .insert(sessionSets)
    .values({
      workoutSessionId: workout.id,
      exerciseId: input.exerciseId,
      setIndex: input.setIndex,
      isWarmup: input.isWarmup,
      reps: input.reps,
      loadKg: input.loadKg === null ? null : String(input.loadKg),
      bandLevel: input.bandLevel,
      rir: input.rir === null ? null : String(input.rir),
      toFailure: input.toFailure,
      tempo: input.tempo,
      durationSeconds: input.durationSeconds,
      performedAt: input.performedAt ? new Date(input.performedAt) : now,
    })
    .returning();

  return row!;
}

export async function deleteSet(db: Database, userId: string, workoutId: string, setId: string) {
  const workout = await requireOpenWorkout(db, userId, workoutId);

  const deleted = await db
    .delete(sessionSets)
    .where(and(eq(sessionSets.id, setId), eq(sessionSets.workoutSessionId, workout.id)))
    .returning({ id: sessionSets.id });

  if (deleted.length === 0) throw notFound('Série introuvable dans cette séance.');
  return { deleted: deleted.length };
}

async function requireOpenWorkout(db: Database, userId: string, workoutId: string) {
  const [workout] = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, workoutId), eq(workoutSessions.userId, userId)));

  if (!workout) throw notFound('Séance introuvable.');
  if (workout.endedAt) throw badRequest('Cette séance est déjà terminée.');
  return workout;
}

/* -------------------------------------------------------------------------- */
/*                            Clôture de séance                               */
/* -------------------------------------------------------------------------- */

export interface FinishWorkoutResult {
  workoutId: string;
  workingSets: number;
  fatigueEvents: number;
  progressionUpdates: { exerciseId: number; action: string; note: string }[];
  newRecords: { exerciseId: number; type: string; value: number }[];
}

export async function finishWorkout(
  db: Database,
  userId: string,
  workoutId: string,
  params: { sessionRpe: number | null; notes: string | null; endedAt: Date },
): Promise<FinishWorkoutResult> {
  const workout = await requireOpenWorkout(db, userId, workoutId);

  const rows = await db
    .select()
    .from(sessionSets)
    .where(eq(sessionSets.workoutSessionId, workout.id))
    .orderBy(sessionSets.performedAt);

  const performed: PerformedSet[] = rows.map((row) => ({
    exerciseId: row.exerciseId,
    isWarmup: row.isWarmup,
    reps: row.reps,
    loadKg: num(row.loadKg),
    bandLevel: row.bandLevel,
    rir: num(row.rir),
    toFailure: row.toFailure,
    durationSeconds: row.durationSeconds,
    performedAt: row.performedAt,
  }));

  await db
    .update(workoutSessions)
    .set({ endedAt: params.endedAt, sessionRpe: params.sessionRpe, notes: params.notes })
    .where(eq(workoutSessions.id, workout.id));

  if (workout.plannedSessionId) {
    await db
      .update(plannedSessions)
      .set({ status: 'completed' })
      .where(eq(plannedSessions.id, workout.plannedSessionId));
  }

  /* ---------------------------------------------------------------------- */
  /*  1. Conversion en fatigue                                               */
  /* ---------------------------------------------------------------------- */

  const muscleConfigs = await buildConfigsFor(db, userId, params.endedAt);

  // L'état de forme du jour est figé dans les événements créés : c'est ce qui
  // rend le score reproductible plus tard.
  const recoveryContext: RecoveryContext = {
    ...((await loadLatestCheckin(db, userId, params.endedAt)) ?? {}),
    age: (await loadProfile(db, userId)).profile.age,
    experienceLevel: (await loadProfile(db, userId)).profile.experienceLevel,
  };

  const events = buildStimulusEvents(performed, {
    exercisesById: EXERCISE_BY_ID,
    muscleConfigs,
    recoveryContext,
    workoutSessionId: workout.id,
  });

  await writeFatigueEvents(db, userId, events);

  /* ---------------------------------------------------------------------- */
  /*  2. Progression                                                         */
  /* ---------------------------------------------------------------------- */

  const progressionUpdates = await updateProgression(db, userId, performed, params.endedAt);

  /* ---------------------------------------------------------------------- */
  /*  3. Records et reprojection du cache                                    */
  /* ---------------------------------------------------------------------- */

  const newRecords = await detectPersonalRecords(db, userId, rows);

  const context = await buildAthleteContext(db, userId, params.endedAt);
  await persistFatigueCache(db, userId, context.snapshot);

  return {
    workoutId: workout.id,
    workingSets: performed.filter((s) => !s.isWarmup).length,
    fatigueEvents: events.length,
    progressionUpdates,
    newRecords,
  };
}

/** Écrit des événements de fatigue dans le journal. */
export async function writeFatigueEvents(
  db: Database,
  userId: string,
  events: StimulusEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const muscleIds = await loadMuscleIds(db);

  const rows = events.flatMap((event) => {
    const muscleId = muscleIds.get(event.muscle);
    if (muscleId === undefined) return [];
    return [
      {
        userId,
        muscleId,
        workoutSessionId: event.workoutSessionId ?? null,
        occurredAt: event.occurredAt,
        stimulus: String(event.stimulus),
        effectiveSets: String(event.effectiveSets),
        halfLifeHours: String(event.halfLifeHours),
        isDirectWork: event.isDirectWork,
        source: event.source,
        metadata: event.metadata ?? null,
      },
    ];
  });

  if (rows.length === 0) return 0;
  await db.insert(muscleFatigueEvents).values(rows);
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/*                              Check-in                                      */
/* -------------------------------------------------------------------------- */

/**
 * Enregistre un point de forme et, si des courbatures sont signalées, ajoute
 * les événements de fatigue correspondants.
 *
 * Les courbatures ne réécrivent jamais l'historique : elles ajoutent de la
 * fatigue au présent, ce qui repousse la disponibilité du muscle sans altérer
 * la reproductibilité des calculs passés.
 */
export async function recordCheckinSoreness(
  db: Database,
  userId: string,
  soreness: SorenessReport[],
  at: Date,
) {
  if (soreness.length === 0) return 0;

  const muscleConfigs = await buildConfigsFor(db, userId, at);
  const events = buildSorenessEvents(soreness, muscleConfigs, at);
  return writeFatigueEvents(db, userId, events);
}

/* -------------------------------------------------------------------------- */
/*                         Progression et records                             */
/* -------------------------------------------------------------------------- */

async function updateProgression(
  db: Database,
  userId: string,
  performed: PerformedSet[],
  at: Date,
) {
  const inventory = await loadInventory(db, userId);
  const states = await loadProgressionStates(db, userId);

  const byExercise = new Map<number, PerformedSet[]>();
  for (const set of performed) {
    if (set.isWarmup) continue;
    const list = byExercise.get(set.exerciseId) ?? [];
    list.push(set);
    byExercise.set(set.exerciseId, list);
  }

  const updates: { exerciseId: number; action: string; note: string }[] = [];

  for (const [exerciseId, sets] of byExercise) {
    const exercise = EXERCISE_BY_ID.get(exerciseId);
    if (!exercise) continue;

    const state = states.get(exerciseId) ?? initialProgressionState(exercise);

    // La charge réellement utilisée fait foi : l'utilisateur a pu s'écarter de
    // la prescription, et la progression doit partir de la réalité.
    const usedLoad = sets.find((s) => s.loadKg !== null)?.loadKg ?? state.currentLoadKg;
    const usedBand = sets.find((s) => s.bandLevel !== null)?.bandLevel ?? state.currentBandLevel;

    const decision = evaluateProgression({
      exercise,
      sets,
      state: { ...state, currentLoadKg: usedLoad, currentBandLevel: usedBand },
      inventory,
      targetRepMin: exercise.defaultRepMin,
      targetRepMax: exercise.defaultRepMax,
    });

    await db
      .insert(exerciseProgressionStates)
      .values({
        userId,
        exerciseId,
        currentLoadKg:
          decision.nextState.currentLoadKg === null
            ? null
            : String(decision.nextState.currentLoadKg),
        currentBandLevel: decision.nextState.currentBandLevel,
        currentRepTarget: decision.nextState.currentRepTarget,
        consecutiveSuccesses: decision.nextState.consecutiveSuccesses,
        consecutiveFailures: decision.nextState.consecutiveFailures,
        lastPerformedAt: at,
      })
      .onConflictDoUpdate({
        target: [exerciseProgressionStates.userId, exerciseProgressionStates.exerciseId],
        set: {
          currentLoadKg: sql`excluded.current_load_kg`,
          currentBandLevel: sql`excluded.current_band_level`,
          currentRepTarget: sql`excluded.current_rep_target`,
          consecutiveSuccesses: sql`excluded.consecutive_successes`,
          consecutiveFailures: sql`excluded.consecutive_failures`,
          lastPerformedAt: sql`excluded.last_performed_at`,
          updatedAt: sql`now()`,
        },
      });

    updates.push({ exerciseId, action: decision.action, note: decision.note });
  }

  return updates;
}

/** Détecte les records battus pendant la séance. */
async function detectPersonalRecords(
  db: Database,
  userId: string,
  rows: (typeof sessionSets.$inferSelect)[],
) {
  const existing = await db
    .select({
      exerciseId: personalRecords.exerciseId,
      type: personalRecords.type,
      value: personalRecords.value,
    })
    .from(personalRecords)
    .where(eq(personalRecords.userId, userId));

  const best = new Map<string, number>();
  for (const record of existing) {
    best.set(`${record.exerciseId}:${record.type}`, num(record.value) ?? 0);
  }

  const created: { exerciseId: number; type: string; value: number }[] = [];

  const candidates: { exerciseId: number; type: 'max_reps' | 'max_load' | 'max_hold_seconds'; value: number; setId: string }[] = [];
  for (const row of rows) {
    if (row.isWarmup) continue;
    if (row.reps !== null) {
      candidates.push({ exerciseId: row.exerciseId, type: 'max_reps', value: row.reps, setId: row.id });
    }
    const load = num(row.loadKg);
    if (load !== null && load > 0) {
      candidates.push({ exerciseId: row.exerciseId, type: 'max_load', value: load, setId: row.id });
    }
    if (row.durationSeconds !== null) {
      candidates.push({
        exerciseId: row.exerciseId,
        type: 'max_hold_seconds',
        value: row.durationSeconds,
        setId: row.id,
      });
    }
  }

  for (const candidate of candidates) {
    const key = `${candidate.exerciseId}:${candidate.type}`;
    const previous = best.get(key);
    if (previous !== undefined && previous >= candidate.value) continue;

    best.set(key, candidate.value);
    await db.insert(personalRecords).values({
      userId,
      exerciseId: candidate.exerciseId,
      type: candidate.type,
      value: String(candidate.value),
      sessionSetId: candidate.setId,
    });
    created.push({ exerciseId: candidate.exerciseId, type: candidate.type, value: candidate.value });
  }

  return created;
}

/* -------------------------------------------------------------------------- */
/*                                Utilitaires                                 */
/* -------------------------------------------------------------------------- */

/** Configuration des muscles à une date, selon le plan actif. */
async function buildConfigsFor(db: Database, userId: string, at: Date) {
  const { profile } = await loadProfile(db, userId);
  const plan = await loadActivePlan(db, userId);
  const totalWeeks = plan?.durationWeeks ?? 5;
  const week = plan ? mesocycleWeekFor(plan.mesocycleStartDate, at, totalWeeks) : 1;

  return buildMuscleConfigs({
    profile,
    weeklyFrequencyByMuscle:
      plan?.split.weeklyFrequencyByMuscle ?? ({} as Record<string, number>),
    mesocycleWeek: week,
    totalWeeks,
    phase: phaseForWeek(week, totalWeeks),
    overrides: await loadMuscleOverrides(db, userId),
  });
}
