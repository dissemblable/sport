import { zValidator } from '@hono/zod-validator';
import {
  EXERCISE_BY_ID,
  EXERCISE_CATALOG,
  generateSession,
  hoursBetween,
  toIsoDate,
} from '@sport/core';
import {
  DEFAULT_MIN_REST_HOURS,
  EXCLUSION_REASON_LABELS,
  MUSCLE_LABELS,
  SESSION_BLOCK_LABELS,
  listSessionsQuerySchema,
  moveSessionSchema,
  previewSessionSchema,
  type MuscleCode,
} from '@sport/shared';
import { plannedSessions, type plannedExercises } from '@sport/db';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { badRequest, notFound } from '../errors';
import {
  loadActivePlan,
  loadExercisePreferences,
  loadInventory,
  loadProgressionStates,
} from '../services/loaders';
import { persistPlannedSession, serializeReport } from '../services/plan';
import { buildAthleteContext } from '../services/recovery';

/**
 * Séances planifiées : consultation, régénération, déplacement.
 *
 * La régénération est au cœur de l'adaptabilité : une séance planifiée il y a
 * deux semaines a été calculée sur une projection de fatigue. Si la réalité
 * s'en écarte — séance manquée, courbatures, mauvaise nuit — la régénérer à
 * l'instant présent produit une séance juste plutôt qu'une séance périmée.
 */

/** Met une séance planifiée en forme pour l'API. */
function presentSession(
  session: typeof plannedSessions.$inferSelect & {
    exercises: (typeof plannedExercises.$inferSelect)[];
  },
) {
  return {
    id: session.id,
    planId: session.planId,
    scheduledDate: session.scheduledDate,
    slotIndex: session.slotIndex,
    slotLabel: session.slotLabel,
    status: session.status,
    mesocycleWeek: session.mesocycleWeek,
    phase: session.phase,
    estimatedDurationMinutes: session.estimatedDurationMinutes,
    rationale: session.generationSnapshot,
    exercises: session.exercises
      .sort((a, b) => a.position - b.position)
      .map((row) => {
        const exercise = EXERCISE_BY_ID.get(row.exerciseId);
        return {
          id: row.id,
          exerciseId: row.exerciseId,
          slug: exercise?.slug ?? null,
          name: exercise?.name ?? `Exercice ${row.exerciseId}`,
          block: row.block,
          blockLabel: SESSION_BLOCK_LABELS[row.block],
          position: row.position,
          targetSets: row.targetSets,
          targetRepMin: row.targetRepMin,
          targetRepMax: row.targetRepMax,
          targetRir: row.targetRir,
          restSeconds: row.restSeconds,
          prescription: row.prescription,
          rationale: row.rationale,
          executionCues: exercise?.executionCues ?? [],
          setupNotes: exercise?.setupNotes ?? null,
          muscles:
            exercise?.muscles.map((m) => ({
              muscle: m.muscle,
              label: MUSCLE_LABELS[m.muscle],
              role: m.role,
              contribution: m.contribution,
            })) ?? [],
        };
      }),
  };
}

export const sessionRoutes = new Hono<AppEnv>()

  .get('/sessions', zValidator('query', listSessionsQuerySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { from, to, limit } = c.req.valid('query');

    const conditions = [eq(plannedSessions.userId, userId)];
    if (from) conditions.push(gte(plannedSessions.scheduledDate, from));
    if (to) conditions.push(lte(plannedSessions.scheduledDate, to));

    const rows = await db.query.plannedSessions.findMany({
      where: and(...conditions),
      orderBy: [asc(plannedSessions.scheduledDate)],
      limit,
      with: { exercises: true, muscles: true },
    });

    return c.json(
      rows
        // Les séances remplacées par une nouvelle version du plan restent en
        // base pour l'historique, mais n'ont pas leur place dans le planning.
        .filter((row) => row.status !== 'superseded')
        .map((row) => ({
          ...presentSession(row),
          muscles: row.muscles.map((m) => ({
            muscle: m.muscleCode,
            label: MUSCLE_LABELS[m.muscleCode as MuscleCode],
            plannedSets: Number(m.plannedSets),
          })),
        })),
    );
  })

  .get('/sessions/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const id = c.req.param('id');

    const session = await db.query.plannedSessions.findFirst({
      where: and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId)),
      with: { exercises: true },
    });

    if (!session) throw notFound('Séance introuvable.');
    return c.json(presentSession(session));
  })

  /**
   * Régénère une séance avec l'état de fatigue à l'instant présent.
   *
   * Une séance déjà réalisée n'est jamais régénérée : l'historique est
   * intouchable.
   */
  .post('/sessions/:id/regenerate', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const id = c.req.param('id');

    const existing = await db.query.plannedSessions.findFirst({
      where: and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId)),
    });
    if (!existing) throw notFound('Séance introuvable.');
    if (existing.status === 'completed') {
      throw badRequest('Cette séance a déjà été réalisée et ne peut plus être régénérée.');
    }

    const context = await buildAthleteContext(db, userId, now);
    const inventory = await loadInventory(db, userId);
    const { banned, favorites } = await loadExercisePreferences(db, userId);
    const progression = await loadProgressionStates(db, userId);

    const generated = generateSession({
      now,
      slotIndex: existing.slotIndex,
      split: context.split,
      profile: context.profile,
      inventory,
      muscleConfigs: context.muscleConfigs,
      snapshot: context.snapshot,
      mesocycleWeek: existing.mesocycleWeek,
      phase: existing.phase,
      exercises: EXERCISE_CATALOG,
      bannedExerciseIds: banned,
      favoriteExerciseIds: favorites,
      progression,
    });

    // L'ancienne version est supprimée puis remplacée : conserver deux séances
    // pour la même date sèmerait la confusion dans le planning.
    await db.delete(plannedSessions).where(eq(plannedSessions.id, id));

    const created = await persistPlannedSession(db, {
      userId,
      planId: existing.planId,
      scheduledDate: existing.scheduledDate,
      mesocycleWeek: existing.mesocycleWeek,
      phase: existing.phase,
      generated,
    });

    const full = await db.query.plannedSessions.findFirst({
      where: eq(plannedSessions.id, created.id),
      with: { exercises: true },
    });

    return c.json({
      session: full ? presentSession(full) : null,
      report: serializeReport(generated),
    });
  })

  /**
   * Déplace une séance à une autre date.
   *
   * La contrainte de repos est revalidée : si le nouveau créneau amène un
   * muscle à travailler moins de 48 h après sa dernière sollicitation, le
   * déplacement est refusé — sauf demande explicite de l'utilisateur, qui
   * reste maître de ses décisions.
   */
  .post('/sessions/:id/move', zValidator('json', moveSessionSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const id = c.req.param('id');
    const { scheduledDate, force } = c.req.valid('json');

    const session = await db.query.plannedSessions.findFirst({
      where: and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId)),
      with: { muscles: true },
    });
    if (!session) throw notFound('Séance introuvable.');
    if (session.status === 'completed') {
      throw badRequest('Une séance déjà réalisée ne peut pas être déplacée.');
    }

    const targetAt = new Date(`${scheduledDate}T18:00:00.000Z`);
    const context = await buildAthleteContext(db, userId, targetAt);

    const conflicts = session.muscles
      .map((entry) => context.snapshot.byMuscle[entry.muscleCode as MuscleCode])
      .filter((state) => state && !state.isAvailable)
      .map((state) => ({
        muscle: state.muscle,
        label: MUSCLE_LABELS[state.muscle],
        reason: state.blockedBy,
        reasonLabel: state.blockedBy ? EXCLUSION_REASON_LABELS[state.blockedBy] : null,
        hoursSinceLastStimulus: state.hoursSinceLastStimulus,
        availableAt: state.availableAt?.toISOString() ?? null,
      }));

    if (conflicts.length > 0 && !force) {
      return c.json(
        {
          moved: false,
          conflicts,
          message:
            `Ce déplacement ne respecterait pas le repos minimum de ${DEFAULT_MIN_REST_HOURS} h pour ` +
            `${conflicts.map((conflict) => conflict.label).join(', ')}. ` +
            'Renvoyez la demande avec `force: true` pour passer outre, ou choisissez une autre date.',
        },
        409,
      );
    }

    await db
      .update(plannedSessions)
      .set({ scheduledDate })
      .where(eq(plannedSessions.id, id));

    return c.json({
      moved: true,
      scheduledDate,
      conflicts,
      message:
        conflicts.length > 0
          ? 'Séance déplacée malgré un repos incomplet : le volume sera automatiquement réduit.'
          : 'Séance déplacée.',
    });
  })

  .post('/sessions/:id/skip', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const id = c.req.param('id');

    const updated = await db
      .update(plannedSessions)
      .set({ status: 'skipped' })
      .where(and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId)))
      .returning({ id: plannedSessions.id });

    if (updated.length === 0) throw notFound('Séance introuvable.');

    return c.json({
      skipped: true,
      message:
        'Séance passée. Le volume manquant sera automatiquement réparti sur les séances restantes de la semaine.',
    });
  })

  /**
   * « Que puis-je faire maintenant ? »
   *
   * Génère une séance à la volée à partir de l'état de fatigue de l'instant,
   * sans rien écrire. C'est la réponse à l'usage réel : on ouvre l'application
   * un mardi soir en se demandant ce qui est possible aujourd'hui.
   */
  .post('/sessions/preview', zValidator('json', previewSessionSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = c.get('now');
    const input = c.req.valid('json');

    const at = input.at ? new Date(input.at) : now;
    const context = await buildAthleteContext(db, userId, at);
    const inventory = await loadInventory(db, userId);
    const { banned, favorites } = await loadExercisePreferences(db, userId);
    const progression = await loadProgressionStates(db, userId);
    const plan = await loadActivePlan(db, userId);

    // Créneau retenu : celui du jour s'il existe, sinon celui qui suit le
    // dernier réalisé — l'utilisateur reste dans la rotation de son split.
    const slotIndex = await resolveSlotIndex(db, userId, at, context.split.slots.length, plan?.id);

    const generated = generateSession({
      now: at,
      slotIndex,
      split: context.split,
      profile: context.profile,
      inventory,
      muscleConfigs: context.muscleConfigs,
      snapshot: context.snapshot,
      mesocycleWeek: context.mesocycleWeek,
      phase: context.phase,
      exercises: EXERCISE_CATALOG,
      bannedExerciseIds: banned,
      favoriteExerciseIds: favorites,
      progression,
      durationMinutes: input.durationMinutes,
    });

    return c.json({
      at: at.toISOString(),
      persisted: false,
      slotIndex,
      slotLabel: generated.slotLabel,
      estimatedDurationMinutes: generated.estimatedDurationMinutes,
      exercises: generated.exercises.map((prescribed) => ({
        exerciseId: prescribed.exercise.id,
        slug: prescribed.exercise.slug,
        name: prescribed.exercise.name,
        block: prescribed.block,
        blockLabel: SESSION_BLOCK_LABELS[prescribed.block],
        targetSets: prescribed.targetSets,
        targetRepMin: prescribed.targetRepMin,
        targetRepMax: prescribed.targetRepMax,
        targetRir: prescribed.targetRir,
        restSeconds: prescribed.restSeconds,
        loadKg: prescribed.loadKg,
        bandLevel: prescribed.bandLevel,
        perSide: prescribed.perSide,
        progressionNote: prescribed.progressionNote,
        rationale: prescribed.rationale,
        executionCues: prescribed.exercise.executionCues,
      })),
      report: serializeReport(generated),
      excludedExplanations: generated.report.excludedMuscles.map((entry) => {
        const hours = entry.hoursUntilAvailable;
        const label = MUSCLE_LABELS[entry.muscle];
        const reason = EXCLUSION_REASON_LABELS[entry.reason];
        return hours == null
          ? `${label} — ${reason}`
          : `${label} — ${reason}, disponible dans ${Math.round(hours)} h`;
      }),
    });
  });

/** Créneau du split le plus pertinent à une date donnée. */
async function resolveSlotIndex(
  db: AppEnv['Variables']['db'],
  userId: string,
  at: Date,
  slotCount: number,
  planId: string | undefined,
): Promise<number> {
  if (!planId) return 0;

  const today = toIsoDate(at);

  const [scheduledToday] = await db
    .select({ slotIndex: plannedSessions.slotIndex })
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, userId),
        eq(plannedSessions.planId, planId),
        eq(plannedSessions.scheduledDate, today),
      ),
    )
    .limit(1);

  if (scheduledToday) return scheduledToday.slotIndex;

  const [lastCompleted] = await db
    .select({
      slotIndex: plannedSessions.slotIndex,
      scheduledDate: plannedSessions.scheduledDate,
    })
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, userId),
        eq(plannedSessions.planId, planId),
        eq(plannedSessions.status, 'completed'),
      ),
    )
    .orderBy(asc(plannedSessions.scheduledDate))
    .limit(1);

  if (!lastCompleted) return 0;

  // Si la dernière séance remonte à plus de deux semaines, on repart du début
  // de la rotation plutôt que de reprendre au hasard du cycle.
  const elapsed = hoursBetween(new Date(`${lastCompleted.scheduledDate}T18:00:00.000Z`), at);
  if (elapsed > 14 * 24) return 0;

  return (lastCompleted.slotIndex + 1) % slotCount;
}
