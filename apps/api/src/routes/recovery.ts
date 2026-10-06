import { zValidator } from '@hono/zod-validator';
import { buildFatigueSnapshot, addHours } from '@sport/core';
import {
  FATIGUE_STATUS_DESCRIPTIONS,
  FATIGUE_STATUS_LABELS,
  MUSCLE_LABELS,
  createCheckinSchema,
  recoveryTimelineQuerySchema,
  type MuscleCode,
} from '@sport/shared';
import { muscleSorenessReports, muscles, recoveryCheckins } from '@sport/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { loadFatigueEvents, loadMuscleIds } from '../services/loaders';
import {
  buildAthleteContext,
  explainBlock,
  persistFatigueCache,
  toRecoveryResponse,
} from '../services/recovery';
import { recordCheckinSoreness } from '../services/workout';

/**
 * État de récupération musculaire.
 *
 * Ces routes alimentent l'écran le plus important de l'application : la
 * silhouette colorée qui répond, d'un coup d'œil, à la question « qu'est-ce que
 * je peux entraîner aujourd'hui ? ».
 */
export const recoveryRoutes = new Hono<AppEnv>()

  .get('/recovery/state', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');

    const context = await buildAthleteContext(db, userId, now);
    await persistFatigueCache(db, userId, context.snapshot);

    const muscleStates = toRecoveryResponse(context.snapshot).map((state) => ({
      ...state,
      statusLabel: FATIGUE_STATUS_LABELS[state.status],
      statusDescription: FATIGUE_STATUS_DESCRIPTIONS[state.status],
      blockedExplanation: explainBlock(state),
    }));

    return c.json({
      at: now.toISOString(),
      mesocycleWeek: context.mesocycleWeek,
      phase: context.phase,
      available: muscleStates.filter((m) => m.isAvailable).map((m) => m.muscle),
      blocked: muscleStates.filter((m) => !m.isAvailable).map((m) => m.muscle),
      muscles: muscleStates,
      systemic: context.snapshot.systemic,
    });
  })

  .get('/recovery/systemic', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');

    const context = await buildAthleteContext(db, userId, now);
    return c.json({
      at: now.toISOString(),
      ...context.snapshot.systemic,
      mesocycleWeek: context.mesocycleWeek,
      phase: context.phase,
    });
  })

  /**
   * Projection de la récupération sur les jours à venir.
   *
   * Le moteur étant déterministe et sans I/O, il suffit de rejouer le calcul de
   * fatigue à intervalles réguliers : aucune donnée supplémentaire n'est
   * nécessaire pour savoir quand chaque muscle redeviendra disponible.
   */
  .get('/recovery/timeline', zValidator('query', recoveryTimelineQuerySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const { days } = c.req.valid('query');

    const context = await buildAthleteContext(db, userId, now);
    const events = await loadFatigueEvents(db, userId, now);

    const stepHours = 6;
    const start = addHours(now, -Math.min(days, 7) * 24);
    const totalSteps = Math.round(((days + 4) * 24) / stepHours);

    const points = Array.from({ length: totalSteps }, (_, index) => {
      const at = addHours(start, index * stepHours);
      const snapshot = buildFatigueSnapshot({
        now: at,
        events,
        muscleConfigs: context.muscleConfigs,
      });

      const values: Partial<Record<MuscleCode, number>> = {};
      for (const state of Object.values(snapshot.byMuscle)) {
        if (state.fatiguePct > 0.005) values[state.muscle] = state.fatiguePct;
      }
      return { at: at.toISOString(), isFuture: at > now, values };
    });

    return c.json({ from: start.toISOString(), stepHours, points });
  })

  /**
   * Point de forme quotidien.
   *
   * Les courbatures déclarées au-delà de 3/5 injectent de la fatigue
   * supplémentaire dans le journal : le muscle concerné voit sa disponibilité
   * repoussée, sans que l'historique passé ne soit réécrit.
   */
  .post('/recovery/checkin', zValidator('json', createCheckinSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const input = c.req.valid('json');

    const checkedAt = input.checkedAt ? new Date(input.checkedAt) : now;

    const [checkin] = await db
      .insert(recoveryCheckins)
      .values({
        userId,
        checkedAt,
        sleepHours: input.sleepHours === null ? null : String(input.sleepHours),
        sleepQuality: input.sleepQuality,
        stress: input.stress,
        energy: input.energy,
        restingHeartRate: input.restingHeartRate,
        notes: input.notes,
      })
      .returning();

    if (input.soreness.length > 0) {
      const muscleIds = await loadMuscleIds(db);
      const rows = input.soreness.flatMap((report) => {
        const muscleId = muscleIds.get(report.muscle);
        if (muscleId === undefined) return [];
        return [{ checkinId: checkin!.id, muscleId, soreness: report.soreness }];
      });
      if (rows.length > 0) await db.insert(muscleSorenessReports).values(rows);
    }

    const fatigueEvents = await recordCheckinSoreness(db, userId, input.soreness, checkedAt);

    const context = await buildAthleteContext(db, userId, now);
    await persistFatigueCache(db, userId, context.snapshot);

    const affected = input.soreness
      .filter((s) => s.soreness >= 3)
      .map((s) => MUSCLE_LABELS[s.muscle]);

    return c.json(
      {
        id: checkin!.id,
        checkedAt: checkedAt.toISOString(),
        fatigueEventsCreated: fatigueEvents,
        message:
          affected.length > 0
            ? `Courbatures prises en compte : ${affected.join(', ')}. Leur disponibilité a été repoussée.`
            : 'Point de forme enregistré.',
        systemic: context.snapshot.systemic,
      },
      201,
    );
  })

  .get('/recovery/checkins', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const rows = await db.query.recoveryCheckins.findMany({
      where: eq(recoveryCheckins.userId, userId),
      orderBy: (table, { desc }) => [desc(table.checkedAt)],
      limit: 30,
      with: { soreness: { with: { muscle: true } } },
    });

    return c.json(
      rows.map((row) => ({
        id: row.id,
        checkedAt: row.checkedAt.toISOString(),
        sleepHours: row.sleepHours === null ? null : Number(row.sleepHours),
        sleepQuality: row.sleepQuality,
        stress: row.stress,
        energy: row.energy,
        restingHeartRate: row.restingHeartRate,
        notes: row.notes,
        soreness: row.soreness.map((entry) => ({
          muscle: entry.muscle.code,
          label: MUSCLE_LABELS[entry.muscle.code],
          soreness: entry.soreness,
        })),
      })),
    );
  })

  /** Référentiel musculaire — sert à construire la silhouette côté frontend. */
  .get('/muscles', async (c) => {
    const db = c.get('db');
    const rows = await db.select().from(muscles).orderBy(muscles.displayOrder);

    return c.json(
      rows.map((row) => ({
        code: row.code,
        label: MUSCLE_LABELS[row.code],
        region: row.region,
        sizeClass: row.sizeClass,
        minRestHours: row.minRestHours,
        fullRecoveryHours: row.fullRecoveryHours,
        weeklyMev: row.weeklyMev,
        weeklyMav: row.weeklyMav,
        weeklyMrv: row.weeklyMrv,
      })),
    );
  });
