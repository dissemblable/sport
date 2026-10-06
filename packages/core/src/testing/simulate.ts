import type { MuscleCode } from '@sport/shared';
import { EXERCISE_CATALOG } from '../catalog/exercises';
import { buildFatigueSnapshot } from '../fatigue/decay';
import { buildStimulusEvents } from '../fatigue/stimulus';
import { SIGNIFICANT_CONTRIBUTION } from '../generation/exercisePool';
import { generateSession } from '../generation/session';
import { buildMuscleConfigs } from '../muscleConfig';
import { buildMesocycleSchedule, startOfWeek } from '../scheduling/mesocycle';
import type {
  AthleteProfile,
  EquipmentInventory,
  GeneratedSession,
  MuscleSettingOverride,
  PerformedSet,
  StimulusEvent,
} from '../types';
import { catalogById } from './fixtures';

/**
 * Simulation d'un bloc d'entraînement complet.
 *
 * Le générateur est exécuté séance après séance, et **le travail qu'il prescrit
 * est réinjecté dans le journal de fatigue** avant la séance suivante — comme
 * le ferait un utilisateur réel qui suit le programme à la lettre.
 *
 * C'est ce bouclage qui rend le test de la garantie de repos significatif : il
 * ne vérifie pas une règle isolée, mais le comportement du système entier sur
 * plusieurs semaines d'utilisation.
 */

export interface SimulatedSession {
  date: Date;
  week: number;
  generated: GeneratedSession;
  performedSets: PerformedSet[];
}

export interface SimulationResult {
  sessions: SimulatedSession[];
  events: StimulusEvent[];
  /**
   * Pour chaque muscle, les instants où il a reçu une charge significative
   * (moteur principal ou secondaire lourd), triés chronologiquement.
   */
  significantLoads: Map<MuscleCode, Date[]>;
}

export interface SimulationOptions {
  profile: AthleteProfile;
  inventory: EquipmentInventory;
  startDate: Date;
  weeks?: number;
  overrides?: MuscleSettingOverride[];
  /** Heure de la séance dans la journée (UTC). */
  hourOfDay?: number;
}

export function simulateTrainingBlock(options: SimulationOptions): SimulationResult {
  const { profile, inventory, startDate } = options;
  const weeks = options.weeks ?? 4;
  const hourOfDay = options.hourOfDay ?? 18;

  const schedule = buildMesocycleSchedule({ startDate, weeks, profile });
  const split = schedule.split;

  const events: StimulusEvent[] = [];
  const sessions: SimulatedSession[] = [];
  const significantLoads = new Map<MuscleCode, Date[]>();

  let previousSessionExerciseIds = new Set<number>();
  let currentWeek = 0;
  let sessionsThisWeek = 0;

  for (const scheduled of schedule.sessions) {
    if (scheduled.week !== currentWeek) {
      currentWeek = scheduled.week;
      sessionsThisWeek = 0;
    }

    const now = new Date(scheduled.date.getTime() + hourOfDay * 3_600_000);

    const muscleConfigs = buildMuscleConfigs({
      profile,
      weeklyFrequencyByMuscle: split.weeklyFrequencyByMuscle,
      mesocycleWeek: scheduled.week,
      totalWeeks: weeks,
      phase: scheduled.phase,
      overrides: options.overrides,
    });

    const snapshot = buildFatigueSnapshot({
      now,
      events,
      muscleConfigs,
      weekStartedAt: startOfWeek(now),
    });

    const generated = generateSession({
      now,
      slotIndex: scheduled.slotIndex,
      split,
      profile,
      inventory,
      muscleConfigs,
      snapshot,
      mesocycleWeek: scheduled.week,
      phase: scheduled.phase,
      exercises: EXERCISE_CATALOG,
      previousSessionExerciseIds,
      sessionsCompletedThisWeek: sessionsThisWeek,
    });

    // L'utilisateur exécute la séance telle qu'elle est prescrite : haut de
    // fourchette, au RIR demandé.
    const performedSets: PerformedSet[] = [];
    for (const prescribed of generated.exercises) {
      if (prescribed.block === 'warmup') continue;

      for (let i = 0; i < prescribed.targetSets; i += 1) {
        performedSets.push({
          exerciseId: prescribed.exercise.id,
          isWarmup: false,
          reps: prescribed.targetRepMax,
          loadKg: prescribed.loadKg,
          bandLevel: prescribed.bandLevel,
          rir: prescribed.targetRir,
          toFailure: prescribed.targetRir === 0,
          durationSeconds: null,
          performedAt: now,
        });
      }

      for (const involvement of prescribed.exercise.muscles) {
        const isSignificant =
          involvement.role === 'primary' || involvement.contribution >= SIGNIFICANT_CONTRIBUTION;
        if (!isSignificant) continue;

        const history = significantLoads.get(involvement.muscle) ?? [];
        if (!history.some((d) => d.getTime() === now.getTime())) history.push(now);
        significantLoads.set(involvement.muscle, history);
      }
    }

    events.push(
      ...buildStimulusEvents(performedSets, {
        exercisesById: catalogById,
        muscleConfigs,
      }),
    );

    sessions.push({ date: now, week: scheduled.week, generated, performedSets });
    previousSessionExerciseIds = new Set(generated.exercises.map((e) => e.exercise.id));
    sessionsThisWeek += 1;
  }

  for (const history of significantLoads.values()) {
    history.sort((a, b) => a.getTime() - b.getTime());
  }

  return { sessions, events, significantLoads };
}

/**
 * Plus petit écart, en heures, entre deux charges significatives sur un même
 * muscle. `Infinity` si aucun muscle n'a été sollicité deux fois.
 */
export function smallestGapHours(result: SimulationResult): {
  hours: number;
  muscle: MuscleCode | null;
} {
  let smallest = Number.POSITIVE_INFINITY;
  let culprit: MuscleCode | null = null;

  for (const [muscle, dates] of result.significantLoads) {
    for (let i = 1; i < dates.length; i += 1) {
      const gap = (dates[i]!.getTime() - dates[i - 1]!.getTime()) / 3_600_000;
      if (gap < smallest) {
        smallest = gap;
        culprit = muscle;
      }
    }
  }

  return { hours: smallest, muscle: culprit };
}
