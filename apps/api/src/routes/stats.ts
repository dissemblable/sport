import { zValidator } from '@hono/zod-validator';
import { EXERCISE_BY_ID, MUSCLE_BY_CODE, startOfWeek, toIsoDate } from '@sport/core';
import { MUSCLE_LABELS, volumeStatsQuerySchema, type MuscleCode } from '@sport/shared';
import {
  muscleFatigueEvents,
  muscles,
  personalRecords,
  sessionSets,
  workoutSessions,
} from '@sport/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { notFound } from '../errors';
import { num } from '../services/loaders';
import { buildAthleteContext } from '../services/recovery';

/**
 * Statistiques d'entraînement.
 *
 * Le volume est agrégé côté SQL à partir du journal de fatigue : les séries
 * effectives y sont déjà pondérées par la contribution musculaire, ce qui
 * évite de recharger toute la cartographie des exercices pour recalculer la
 * même chose en mémoire.
 */
export const statsRoutes = new Hono<AppEnv>()

  /**
   * Volume hebdomadaire par muscle, comparé aux repères MEV / MAV / MRV.
   *
   * C'est le graphique qui permet de vérifier d'un coup d'œil qu'on entraîne
   * assez pour progresser, sans dépasser ce que l'on peut récupérer.
   */
  .get('/stats/volume', zValidator('query', volumeStatsQuerySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const { weeks, muscle } = c.req.valid('query');

    const since = new Date(startOfWeek(now).getTime() - (weeks - 1) * 7 * 86_400_000);

    const conditions = [
      eq(muscleFatigueEvents.userId, userId),
      gte(muscleFatigueEvents.occurredAt, since),
      eq(muscleFatigueEvents.source, 'training'),
    ];

    const rows = await db
      .select({
        muscle: muscles.code,
        weekStart: sql<string>`to_char(date_trunc('week', ${muscleFatigueEvents.occurredAt}), 'YYYY-MM-DD')`,
        effectiveSets: sql<string>`sum(${muscleFatigueEvents.effectiveSets})`,
      })
      .from(muscleFatigueEvents)
      .innerJoin(muscles, eq(muscles.id, muscleFatigueEvents.muscleId))
      .where(and(...conditions))
      .groupBy(muscles.code, sql`date_trunc('week', ${muscleFatigueEvents.occurredAt})`);

    const context = await buildAthleteContext(db, userId, now);

    const points = rows
      .filter((row) => !muscle || row.muscle === muscle)
      .map((row) => {
        const definition = MUSCLE_BY_CODE[row.muscle];
        return {
          weekStart: row.weekStart,
          muscle: row.muscle,
          label: MUSCLE_LABELS[row.muscle],
          effectiveSets: Math.round((num(row.effectiveSets) ?? 0) * 100) / 100,
          mev: definition.weeklyMev,
          mav: definition.weeklyMav,
          mrv: definition.weeklyMrv,
          target: context.muscleConfigs[row.muscle]?.weeklyTargetSets ?? definition.weeklyMev,
        };
      })
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    return c.json({
      from: toIsoDate(since),
      weeks,
      currentWeekStart: toIsoDate(startOfWeek(now)),
      points,
    });
  })

  /** Historique de performance sur un exercice : charge, répétitions, volume. */
  .get('/stats/progression/:exerciseId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const exerciseId = Number(c.req.param('exerciseId'));

    const exercise = EXERCISE_BY_ID.get(exerciseId);
    if (!exercise) throw notFound(`Exercice inconnu : ${exerciseId}.`);

    const rows = await db
      .select({
        performedAt: sessionSets.performedAt,
        reps: sessionSets.reps,
        loadKg: sessionSets.loadKg,
        bandLevel: sessionSets.bandLevel,
        rir: sessionSets.rir,
        durationSeconds: sessionSets.durationSeconds,
      })
      .from(sessionSets)
      // Les séries ne portent pas l'identifiant utilisateur : on passe par la
      // séance pour garantir qu'on ne lit que les données de cet athlète.
      .innerJoin(workoutSessions, eq(workoutSessions.id, sessionSets.workoutSessionId))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(sessionSets.exerciseId, exerciseId),
          eq(sessionSets.isWarmup, false),
        ),
      )
      .orderBy(sessionSets.performedAt);

    // Regroupement par séance : c'est la meilleure série du jour qui raconte la
    // progression, pas chaque série prise isolément.
    const byDay = new Map<
      string,
      { date: string; bestLoadKg: number | null; bestReps: number | null; totalSets: number }
    >();

    for (const row of rows) {
      const date = toIsoDate(row.performedAt);
      const entry = byDay.get(date) ?? { date, bestLoadKg: null, bestReps: null, totalSets: 0 };
      const load = num(row.loadKg);

      entry.totalSets += 1;
      if (load !== null && (entry.bestLoadKg === null || load > entry.bestLoadKg)) {
        entry.bestLoadKg = load;
      }
      if (row.reps !== null && (entry.bestReps === null || row.reps > entry.bestReps)) {
        entry.bestReps = row.reps;
      }
      byDay.set(date, entry);
    }

    const records = await db
      .select()
      .from(personalRecords)
      .where(and(eq(personalRecords.userId, userId), eq(personalRecords.exerciseId, exerciseId)))
      .orderBy(desc(personalRecords.achievedAt));

    return c.json({
      exercise: { id: exercise.id, slug: exercise.slug, name: exercise.name },
      history: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      records: records.map((record) => ({
        type: record.type,
        value: num(record.value),
        achievedAt: record.achievedAt.toISOString(),
      })),
    });
  })

  /** Vue d'ensemble : volume 7 jours, séances réalisées, muscles disponibles. */
  .get('/stats/summary', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');

    const context = await buildAthleteContext(db, userId, now);

    const byMuscle = Object.values(context.snapshot.byMuscle);
    const totalWeeklySets = byMuscle.reduce((sum, state) => sum + state.weeklySets, 0);
    const totalTarget = byMuscle.reduce((sum, state) => sum + state.weeklySetsTarget, 0);

    const underTrained = byMuscle
      .filter((state) => state.weeklySets < MUSCLE_BY_CODE[state.muscle].weeklyMev * 0.75)
      .map((state) => ({
        muscle: state.muscle,
        label: MUSCLE_LABELS[state.muscle],
        weeklySets: state.weeklySets,
        mev: MUSCLE_BY_CODE[state.muscle].weeklyMev,
      }));

    const overReached = byMuscle
      .filter((state) => state.weeklySets > MUSCLE_BY_CODE[state.muscle].weeklyMrv)
      .map((state) => ({
        muscle: state.muscle,
        label: MUSCLE_LABELS[state.muscle],
        weeklySets: state.weeklySets,
        mrv: MUSCLE_BY_CODE[state.muscle].weeklyMrv,
      }));

    return c.json({
      at: now.toISOString(),
      mesocycleWeek: context.mesocycleWeek,
      phase: context.phase,
      totalWeeklySets: Math.round(totalWeeklySets * 10) / 10,
      totalWeeklyTarget: Math.round(totalTarget * 10) / 10,
      availableMuscles: byMuscle.filter((s) => s.isAvailable).length,
      blockedMuscles: byMuscle.filter((s) => !s.isAvailable).length,
      systemic: context.snapshot.systemic,
      underTrained,
      overReached,
    });
  });

export type { MuscleCode };
