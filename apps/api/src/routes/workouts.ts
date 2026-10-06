import { zValidator } from '@hono/zod-validator';
import { EXERCISE_BY_ID } from '@sport/core';
import { finishWorkoutSchema, logSetSchema, startWorkoutSchema } from '@sport/shared';
import { workoutSessions, type sessionSets } from '@sport/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { notFound } from '../errors';
import { num } from '../services/loaders';
import { deleteSet, finishWorkout, logSet, startWorkout } from '../services/workout';

/**
 * Séances réellement effectuées.
 *
 * C'est par ces routes que le travail réel entre dans le système. Le point
 * décisif est `POST /:id/finish` : c'est là que les séries deviennent des
 * événements de fatigue, que la progression est réévaluée et que le cache de
 * récupération est reprojeté.
 */
export const workoutRoutes = new Hono<AppEnv>()

  .post('/workouts/start', zValidator('json', startWorkoutSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const input = c.req.valid('json');

    const { workout, resumed } = await startWorkout(db, userId, {
      plannedSessionId: input.plannedSessionId,
      startedAt: input.startedAt ? new Date(input.startedAt) : now,
    });

    return c.json(
      {
        id: workout.id,
        plannedSessionId: workout.plannedSessionId,
        startedAt: workout.startedAt.toISOString(),
        isAdHoc: workout.isAdHoc,
        resumed,
        message: resumed
          ? 'Une séance était déjà en cours : elle a été reprise.'
          : 'Séance démarrée.',
      },
      resumed ? 200 : 201,
    );
  })

  /** Séance en cours, s'il y en a une. */
  .get('/workouts/active', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const workout = await db.query.workoutSessions.findFirst({
      where: and(eq(workoutSessions.userId, userId), isNull(workoutSessions.endedAt)),
      orderBy: [desc(workoutSessions.startedAt)],
      with: { sets: true },
    });

    if (!workout) return c.json({ active: null });

    return c.json({ active: presentWorkout(workout) });
  })

  .get('/workouts/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const id = c.req.param('id');

    const workout = await db.query.workoutSessions.findFirst({
      where: and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)),
      with: { sets: true },
    });

    if (!workout) throw notFound('Séance introuvable.');
    return c.json(presentWorkout(workout));
  })

  .post('/workouts/:id/sets', zValidator('json', logSetSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const id = c.req.param('id');

    const row = await logSet(db, userId, id, c.req.valid('json'), now);
    const exercise = EXERCISE_BY_ID.get(row.exerciseId);

    return c.json(
      {
        id: row.id,
        exerciseId: row.exerciseId,
        exerciseName: exercise?.name ?? null,
        setIndex: row.setIndex,
        isWarmup: row.isWarmup,
        reps: row.reps,
        loadKg: num(row.loadKg),
        bandLevel: row.bandLevel,
        rir: num(row.rir),
        toFailure: row.toFailure,
        durationSeconds: row.durationSeconds,
        performedAt: row.performedAt.toISOString(),
      },
      201,
    );
  })

  .delete('/workouts/:id/sets/:setId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const result = await deleteSet(db, userId, c.req.param('id'), c.req.param('setId'));
    return c.json(result);
  })

  /**
   * Clôture de la séance.
   *
   * Toute la mécanique de récupération se déclenche ici : conversion des séries
   * en fatigue, réévaluation de la progression, détection des records et
   * reprojection du cache.
   */
  .post('/workouts/:id/finish', zValidator('json', finishWorkoutSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const input = c.req.valid('json');

    const result = await finishWorkout(db, userId, c.req.param('id'), {
      sessionRpe: input.sessionRpe,
      notes: input.notes,
      endedAt: input.endedAt ? new Date(input.endedAt) : now,
    });

    return c.json({
      ...result,
      progressionUpdates: result.progressionUpdates.map((update) => ({
        ...update,
        exerciseName: EXERCISE_BY_ID.get(update.exerciseId)?.name ?? null,
      })),
      newRecords: result.newRecords.map((record) => ({
        ...record,
        exerciseName: EXERCISE_BY_ID.get(record.exerciseId)?.name ?? null,
      })),
      message:
        `Séance enregistrée : ${result.workingSets} séries de travail, ` +
        `${result.fatigueEvents} groupes musculaires mis à jour.`,
    });
  })

  .get('/workouts', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const rows = await db.query.workoutSessions.findMany({
      where: eq(workoutSessions.userId, userId),
      orderBy: [desc(workoutSessions.startedAt)],
      limit: 50,
      with: { sets: true },
    });

    return c.json(rows.map(presentWorkout));
  });

function presentWorkout(
  workout: typeof workoutSessions.$inferSelect & {
    sets: (typeof sessionSets.$inferSelect)[];
  },
) {
  return {
    id: workout.id,
    plannedSessionId: workout.plannedSessionId,
    startedAt: workout.startedAt.toISOString(),
    endedAt: workout.endedAt?.toISOString() ?? null,
    sessionRpe: workout.sessionRpe,
    notes: workout.notes,
    isAdHoc: workout.isAdHoc,
    sets: workout.sets
      .sort((a, b) => a.performedAt.getTime() - b.performedAt.getTime())
      .map((row) => ({
        id: row.id,
        exerciseId: row.exerciseId,
        exerciseName: EXERCISE_BY_ID.get(row.exerciseId)?.name ?? null,
        setIndex: row.setIndex,
        isWarmup: row.isWarmup,
        reps: row.reps,
        loadKg: num(row.loadKg),
        bandLevel: row.bandLevel,
        rir: num(row.rir),
        toFailure: row.toFailure,
        durationSeconds: row.durationSeconds,
        performedAt: row.performedAt.toISOString(),
      })),
  };
}
