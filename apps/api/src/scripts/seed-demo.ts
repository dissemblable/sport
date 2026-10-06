import {
  closeDatabase,
  getDatabase,
  getSingleUserId,
  muscleFatigueEvents,
  muscleFatigueStates,
  personalRecords,
  plannedSessions,
  recoveryCheckins,
  seedReference,
  seedUser,
  trainingPlans,
  mesocycles,
  workoutSessions,
  exerciseProgressionStates,
  type Database,
} from '@sport/db';
import { EXERCISE_BY_ID, startOfWeek, toIsoDate } from '@sport/core';
import { asc, eq } from 'drizzle-orm';
import { generateMesocycle } from '../services/plan';
import { buildAthleteContext, persistFatigueCache } from '../services/recovery';
import { finishWorkout, logSet, recordCheckinSoreness, startWorkout } from '../services/workout';

/**
 * Jeu de données de démonstration : quatre semaines d'historique réaliste.
 *
 * Le but n'est pas de remplir des tables, mais de rendre l'application
 * immédiatement explorable : au premier lancement, la silhouette est colorée,
 * les courbes de volume ont une histoire, et l'on peut constater de visu que
 * certains muscles sont bloqués avec une échéance précise.
 *
 * L'historique est **volontairement imparfait** — séances manquées,
 * répétitions en dessous de l'objectif, nuits courtes. Un historique parfait
 * ne montrerait jamais l'algorithme en train de compenser, ce qui est
 * précisément ce qu'il y a d'intéressant à voir.
 */

/** Générateur pseudo-aléatoire déterministe : la démo est reproductible. */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20250106);

/** Proportion de séances réellement effectuées — la vraie vie n'est pas parfaite. */
const COMPLETION_RATE = 0.85;

const WEEKS_OF_HISTORY = 4;

async function clearTrainingData(db: Database, userId: string) {
  // L'ordre suit les dépendances : les événements de fatigue référencent les
  // séances, les séances référencent les plans.
  await db.delete(muscleFatigueEvents).where(eq(muscleFatigueEvents.userId, userId));
  await db.delete(muscleFatigueStates).where(eq(muscleFatigueStates.userId, userId));
  await db.delete(personalRecords).where(eq(personalRecords.userId, userId));
  await db
    .delete(exerciseProgressionStates)
    .where(eq(exerciseProgressionStates.userId, userId));
  await db.delete(recoveryCheckins).where(eq(recoveryCheckins.userId, userId));
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(plannedSessions).where(eq(plannedSessions.userId, userId));
  await db.delete(trainingPlans).where(eq(trainingPlans.userId, userId));
  await db.delete(mesocycles).where(eq(mesocycles.userId, userId));
}

async function main() {
  const db = getDatabase();

  try {
    await seedReference(db);

    let userId = await getSingleUserId(db);
    if (!userId) {
      userId = await seedUser(db, {
        displayName: 'Athlète',
        sessionsPerWeek: 4,
        preferredWeekdays: [0, 1, 3, 4],
        experienceLevel: 'intermediate',
      });
    }

    console.log('Réinitialisation de l’historique d’entraînement…');
    await clearTrainingData(db, userId);

    const now = new Date();
    const start = startOfWeek(new Date(now.getTime() - WEEKS_OF_HISTORY * 7 * 86_400_000));

    console.log(`Génération du mésocycle à partir du ${toIsoDate(start)}…`);
    const plan = await generateMesocycle(db, userId, {
      now: start,
      startDate: start,
      weeks: 5,
      restart: true,
    });
    console.log(`  ${plan.sessionCount} séances planifiées, écart minimal ${plan.minGapHours} h.`);

    /* ---------------------------------------------------------------------- */
    /*  Rejeu de l'historique, séance par séance                               */
    /* ---------------------------------------------------------------------- */

    const sessions = await db.query.plannedSessions.findMany({
      where: eq(plannedSessions.planId, plan.planId),
      orderBy: [asc(plannedSessions.scheduledDate)],
      with: { exercises: true },
    });

    let completed = 0;
    let skipped = 0;
    let totalSets = 0;

    for (const session of sessions) {
      const at = new Date(`${session.scheduledDate}T18:00:00.000Z`);
      if (at > now) break; // on ne réalise pas les séances futures

      if (random() > COMPLETION_RATE) {
        await db
          .update(plannedSessions)
          .set({ status: 'skipped' })
          .where(eq(plannedSessions.id, session.id));
        skipped += 1;
        continue;
      }

      const { workout } = await startWorkout(db, userId, {
        plannedSessionId: session.id,
        startedAt: at,
      });

      let setIndex = 0;
      for (const prescribed of session.exercises.sort((a, b) => a.position - b.position)) {
        if (prescribed.block === 'warmup') continue;

        const exercise = EXERCISE_BY_ID.get(prescribed.exerciseId);
        if (!exercise) continue;

        const prescription = prescribed.prescription as { loadKg: number | null };

        for (let i = 0; i < prescribed.targetSets; i += 1) {
          setIndex += 1;

          // Les dernières séries baissent légèrement, et l'athlète manque
          // parfois l'objectif : c'est ce qui alimente la double progression.
          const fatigueDrop = i >= 2 && random() < 0.35 ? 2 : 0;
          const variance = random() < 0.2 ? -1 : 0;
          const reps = Math.max(
            prescribed.targetRepMin - 1,
            prescribed.targetRepMax - fatigueDrop + variance,
          );

          await logSet(
            db,
            userId,
            workout.id,
            {
              exerciseId: prescribed.exerciseId,
              setIndex,
              isWarmup: false,
              reps,
              loadKg: prescription?.loadKg ?? null,
              bandLevel: null,
              rir: Math.max(0, prescribed.targetRir + (random() < 0.3 ? -1 : 0)),
              toFailure: false,
              tempo: null,
              durationSeconds: null,
            },
            new Date(at.getTime() + setIndex * 150_000),
          );
        }
      }

      const endedAt = new Date(at.getTime() + 60 * 60_000);
      await finishWorkout(db, userId, workout.id, {
        sessionRpe: 6 + Math.round(random() * 3),
        notes: null,
        endedAt,
      });

      totalSets += setIndex;
      completed += 1;
    }

    console.log(`  ${completed} séances réalisées, ${skipped} manquées, ${totalSets} séries.`);

    /* ---------------------------------------------------------------------- */
    /*  Points de forme quotidiens                                             */
    /* ---------------------------------------------------------------------- */

    let checkins = 0;
    for (let dayOffset = WEEKS_OF_HISTORY * 7; dayOffset >= 0; dayOffset -= 1) {
      const at = new Date(now.getTime() - dayOffset * 86_400_000);
      if (random() > 0.5) continue; // l'utilisateur ne remplit pas tous les jours

      const sleepHours = 6 + Math.round(random() * 5) / 2;

      await db.insert(recoveryCheckins).values({
        userId,
        checkedAt: at,
        sleepHours: String(sleepHours),
        sleepQuality: 2 + Math.round(random() * 3),
        stress: 1 + Math.round(random() * 3),
        energy: 2 + Math.round(random() * 3),
        restingHeartRate: 52 + Math.round(random() * 12),
        notes: null,
      });
      checkins += 1;
    }

    // Une courbature récente, pour que l'effet soit visible dès l'ouverture.
    const yesterday = new Date(now.getTime() - 20 * 3_600_000);
    await recordCheckinSoreness(db, userId, [{ muscle: 'quads', soreness: 4 }], yesterday);

    console.log(`  ${checkins} points de forme, 1 courbature déclarée.`);

    /* ---------------------------------------------------------------------- */
    /*  Reprojection du cache et récapitulatif                                 */
    /* ---------------------------------------------------------------------- */

    const context = await buildAthleteContext(db, userId, now);
    await persistFatigueCache(db, userId, context.snapshot);

    const states = Object.values(context.snapshot.byMuscle);
    const blocked = states.filter((state) => !state.isAvailable);

    console.log('\n── État actuel ────────────────────────────────────────────');
    console.log(
      `Semaine ${context.mesocycleWeek} du mésocycle · phase ${context.phase} · ` +
        `fatigue générale ${Math.round(context.snapshot.systemic.score * 100)} %`,
    );
    console.log(`${states.length - blocked.length} muscles disponibles, ${blocked.length} en récupération`);

    for (const state of blocked.sort(
      (a, b) => (a.hoursUntilAvailable ?? 0) - (b.hoursUntilAvailable ?? 0),
    )) {
      const hours = state.hoursUntilAvailable;
      console.log(
        `  ${state.muscle.padEnd(14)} ${state.status.padEnd(12)} ` +
          (hours === null ? 'exclu' : `disponible dans ${Math.round(hours)} h`),
      );
    }

    console.log('\nDémonstration prête. Lancez `pnpm dev`.');
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error('Échec de l’amorçage de démonstration :', error);
  process.exit(1);
});
