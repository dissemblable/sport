import { zValidator } from '@hono/zod-validator';
import { SPLIT_TYPE_LABELS, changeFrequencySchema, generatePlanSchema } from '@sport/shared';
import { plannedSessionMuscles, plannedSessions, trainingPlans } from '@sport/db';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { notFound } from '../errors';
import { loadActivePlan } from '../services/loaders';
import { applyDeload, changeFrequency, generateMesocycle } from '../services/plan';
import { buildAthleteContext } from '../services/recovery';

/**
 * Plan d'entraînement : génération, consultation et modulation.
 */
export const planRoutes = new Hono<AppEnv>()

  .get('/plan/current', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');

    const plan = await loadActivePlan(db, userId);
    if (!plan) {
      return c.json({
        plan: null,
        message: 'Aucun plan actif. Générez un mésocycle via POST /api/plan/generate.',
      });
    }

    const context = await buildAthleteContext(db, userId, now);
    const today = now.toISOString().slice(0, 10);

    const upcoming = await db.query.plannedSessions.findMany({
      where: and(
        eq(plannedSessions.planId, plan.id),
        eq(plannedSessions.status, 'planned'),
        gte(plannedSessions.scheduledDate, today),
      ),
      orderBy: [asc(plannedSessions.scheduledDate)],
      limit: 14,
      with: { muscles: true },
    });

    return c.json({
      plan: {
        id: plan.id,
        version: plan.version,
        mesocycleId: plan.mesocycleId,
        sessionsPerWeek: plan.sessionsPerWeek,
        splitType: plan.split.type,
        splitLabel: SPLIT_TYPE_LABELS[plan.split.type],
        weekdays: plan.weekdays,
        minGapHours: plan.split.minGapHours,
        slots: plan.split.slots,
        weeklyFrequencyByMuscle: plan.split.weeklyFrequencyByMuscle,
        mesocycleStartDate: plan.mesocycleStartDate,
        durationWeeks: plan.durationWeeks,
      },
      currentWeek: context.mesocycleWeek,
      phase: context.phase,
      upcomingSessions: upcoming.map((session) => ({
        id: session.id,
        scheduledDate: session.scheduledDate,
        slotIndex: session.slotIndex,
        slotLabel: session.slotLabel,
        status: session.status,
        mesocycleWeek: session.mesocycleWeek,
        phase: session.phase,
        estimatedDurationMinutes: session.estimatedDurationMinutes,
        muscles: session.muscles.map((m) => ({
          muscle: m.muscleCode,
          plannedSets: Number(m.plannedSets),
        })),
      })),
    });
  })

  .get('/plan/versions', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const rows = await db
      .select()
      .from(trainingPlans)
      .where(eq(trainingPlans.userId, userId))
      .orderBy(desc(trainingPlans.version));

    return c.json(
      rows.map((row) => ({
        id: row.id,
        version: row.version,
        sessionsPerWeek: row.sessionsPerWeek,
        splitType: row.splitType,
        splitLabel: SPLIT_TYPE_LABELS[row.splitType],
        weekdays: row.weekdays,
        minGapHours: row.minGapHours,
        isActive: row.isActive,
        changeReason: row.changeReason,
        generatedAt: row.generatedAt.toISOString(),
        supersededAt: row.supersededAt?.toISOString() ?? null,
      })),
    );
  })

  .post('/plan/generate', zValidator('json', generatePlanSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const input = c.req.valid('json');

    const result = await generateMesocycle(db, userId, {
      now,
      startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : undefined,
      weeks: input.durationWeeks,
      sessionsPerWeek: input.sessionsPerWeek,
      preferredWeekdays: input.preferredWeekdays,
      restart: input.restart,
    });

    return c.json(
      {
        ...result,
        splitLabel: SPLIT_TYPE_LABELS[result.split.type],
        message:
          `Mésocycle de ${result.weeks} semaines généré : ${result.sessionCount} séances, ` +
          `écart minimal de ${result.minGapHours} h entre deux sollicitations d’un même muscle.`,
      },
      201,
    );
  })

  /**
   * Changement de fréquence hebdomadaire.
   *
   * Avec `preview: true`, renvoie l'impact sans rien écrire — l'interface
   * affiche ainsi la comparaison avant/après avant que l'utilisateur ne
   * confirme. Sinon, crée une nouvelle version du plan : les séances déjà
   * réalisées sont conservées, seules les séances futures sont régénérées.
   */
  .patch('/plan/frequency', zValidator('json', changeFrequencySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const input = c.req.valid('json');

    const result = await changeFrequency(db, userId, {
      sessionsPerWeek: input.sessionsPerWeek,
      preferredWeekdays: input.preferredWeekdays,
      preview: input.preview,
      reason: input.reason,
      now,
    });

    const { impact } = result;

    return c.json({
      applied: result.applied,
      planId: result.planId,
      version: result.version,
      summary: impact.summary,
      warnings: impact.warnings,
      respectsMinRest: impact.respectsMinRest,
      previousSplit: {
        type: impact.previousSplit.type,
        label: SPLIT_TYPE_LABELS[impact.previousSplit.type],
        sessionsPerWeek: impact.previousSplit.sessionsPerWeek,
      },
      newSplit: {
        type: impact.newSplit.type,
        label: SPLIT_TYPE_LABELS[impact.newSplit.type],
        sessionsPerWeek: impact.newSplit.sessionsPerWeek,
        slots: impact.newSplit.slots,
      },
      weekdays: impact.placement.weekdays,
      minGapHours: Math.round(impact.placement.minGapHours),
      totalWeeklySetsBefore: impact.totalWeeklySetsBefore,
      totalWeeklySetsAfter: impact.totalWeeklySetsAfter,
      comparison: impact.comparison,
    });
  })

  .post('/plan/deload', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');

    const result = await applyDeload(db, userId, now);
    return c.json({
      ...result,
      message:
        result.updated === 0
          ? 'Aucune séance à venir cette semaine : rien à alléger.'
          : `${result.updated} séance(s) passée(s) en décharge : volume réduit et intensité relâchée.`,
    });
  })

  /** Muscles ciblés par une séance planifiée — vue compacte pour le planning. */
  .get('/plan/sessions/:id/muscles', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const id = c.req.param('id');

    // La table de liaison ne porte pas l'utilisateur : on passe par la séance
    // pour ne jamais exposer le planning d'un autre compte.
    const rows = await db
      .select({
        muscleCode: plannedSessionMuscles.muscleCode,
        plannedSets: plannedSessionMuscles.plannedSets,
      })
      .from(plannedSessionMuscles)
      .innerJoin(plannedSessions, eq(plannedSessions.id, plannedSessionMuscles.plannedSessionId))
      .where(and(eq(plannedSessionMuscles.plannedSessionId, id), eq(plannedSessions.userId, userId)));

    if (rows.length === 0) throw notFound('Séance introuvable ou sans muscle ciblé.');

    return c.json(
      rows.map((row) => ({ muscle: row.muscleCode, plannedSets: Number(row.plannedSets) })),
    );
  });
