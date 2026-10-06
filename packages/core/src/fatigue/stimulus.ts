import type { ExerciseDefinition, MuscleCode, SorenessReport } from '@sport/shared';
import { DIRECT_WORK_CONTRIBUTION, RECOVERY_HALF_LIFE_HOURS } from '@sport/shared';
import type {
  MuscleConfigMap,
  PerformedSet,
  RecoveryContext,
  StimulusEvent,
} from '../types';
import { clamp, round } from '../utils/math';
import { halfLifeMultiplier } from './modifiers';

/**
 * Conversion d'un travail réellement effectué en charge de fatigue.
 *
 * C'est l'étage d'entrée du moteur : tout ce qui suit — statuts, blocages,
 * génération — dépend de la justesse de ce calcul.
 *
 *     stimulus = contribution × f(RIR) × f(répétitions) × charge systémique
 *
 * L'unité de référence : **une série menée à l'échec sur un muscle moteur
 * principal d'un exercice standard vaut 1,0.**
 */

/** RIR supposé quand l'utilisateur ne l'a pas renseigné — hypothèse prudente. */
const ASSUMED_RIR = 2;

/** Une seconde d'isométrie équivaut à ~1/3 de répétition en coût de fatigue. */
const SECONDS_PER_REP_EQUIVALENT = 3;

/**
 * Facteur d'intensité selon les répétitions en réserve.
 *
 * La proximité de l'échec est le premier déterminant de la fatigue produite :
 * une série arrêtée 5 répétitions avant l'échec fatigue environ trois fois
 * moins qu'une série menée à l'échec, pour un volume identique.
 */
export function intensityFactor(rir: number | null, toFailure = false): number {
  const effectiveRir = toFailure ? 0 : (rir ?? ASSUMED_RIR);
  return clamp(1 - 0.13 * effectiveRir, 0.35, 1);
}

/**
 * Facteur de volume selon le nombre de répétitions.
 *
 * Les séries très courtes produisent peu de fatigue métabolique ; les séries
 * très longues en produisent davantage, sans stimulus mécanique proportionnel.
 * Le plateau 6–15 correspond à la zone d'hypertrophie de référence.
 */
export function volumeFactor(reps: number | null, durationSeconds: number | null): number {
  const effectiveReps =
    reps ?? (durationSeconds != null ? durationSeconds / SECONDS_PER_REP_EQUIVALENT : 10);

  if (effectiveReps < 5) return 0.85;
  if (effectiveReps <= 15) return 1;
  if (effectiveReps <= 20) return 1.05;
  return 1.1;
}

/** Charge de fatigue produite par une série sur un muscle donné. */
export function setStimulusForMuscle(
  set: PerformedSet,
  exercise: ExerciseDefinition,
  contribution: number,
): number {
  return (
    contribution *
    intensityFactor(set.rir, set.toFailure) *
    volumeFactor(set.reps, set.durationSeconds) *
    exercise.systemicLoad
  );
}

export interface BuildStimulusOptions {
  exercisesById: Map<number, ExerciseDefinition>;
  muscleConfigs: MuscleConfigMap;
  /** État de forme du jour — fige la demi-vie des événements créés. */
  recoveryContext?: RecoveryContext;
  workoutSessionId?: string | null;
}

/**
 * Transforme les séries d'une séance en événements de fatigue.
 *
 * Les séries sont **agrégées par muscle** plutôt qu'émises une par une : sur
 * une séance d'une heure, l'écart de décroissance entre la première et la
 * dernière série est négligeable devant une demi-vie de 20 à 34 heures, alors
 * que le gain en volume de données est d'un ordre de grandeur. L'instant
 * retenu est celui de la dernière série touchant le muscle.
 *
 * Les séries d'échauffement sont ignorées : elles ne produisent pas de fatigue
 * significative et fausseraient le comptage du volume.
 */
export function buildStimulusEvents(
  sets: PerformedSet[],
  options: BuildStimulusOptions,
): StimulusEvent[] {
  const { exercisesById, muscleConfigs, recoveryContext, workoutSessionId } = options;
  const multiplier = halfLifeMultiplier(recoveryContext);

  interface Accumulator {
    stimulus: number;
    effectiveSets: number;
    lastAt: Date;
    /** Au moins une série a-t-elle constitué un travail direct sur ce muscle ? */
    hasDirectWork: boolean;
    exerciseSlugs: Set<string>;
    setCount: number;
  }
  const byMuscle = new Map<MuscleCode, Accumulator>();

  for (const set of sets) {
    if (set.isWarmup) continue;

    const exercise = exercisesById.get(set.exerciseId);
    if (!exercise) continue;

    for (const involvement of exercise.muscles) {
      const stimulus = setStimulusForMuscle(set, exercise, involvement.contribution);
      if (stimulus <= 0) continue;

      const isDirect =
        involvement.role === 'primary' || involvement.contribution >= DIRECT_WORK_CONTRIBUTION;

      const current = byMuscle.get(involvement.muscle);
      if (current) {
        current.stimulus += stimulus;
        current.effectiveSets += involvement.contribution;
        current.setCount += 1;
        current.exerciseSlugs.add(exercise.slug);
        if (set.performedAt > current.lastAt) current.lastAt = set.performedAt;
        current.hasDirectWork ||= isDirect;
      } else {
        byMuscle.set(involvement.muscle, {
          stimulus,
          effectiveSets: involvement.contribution,
          lastAt: set.performedAt,
          hasDirectWork: isDirect,
          exerciseSlugs: new Set([exercise.slug]),
          setCount: 1,
        });
      }
    }
  }

  const events: StimulusEvent[] = [];
  for (const [muscle, acc] of byMuscle) {
    const config = muscleConfigs[muscle];
    const baseHalfLife =
      config?.definition.recoveryHalfLifeHours ?? RECOVERY_HALF_LIFE_HOURS.medium;

    events.push({
      muscle,
      occurredAt: acc.lastAt,
      stimulus: round(acc.stimulus),
      effectiveSets: round(acc.effectiveSets, 2),
      halfLifeHours: round(baseHalfLife * multiplier, 2),
      source: 'training',
      isDirectWork: acc.hasDirectWork,
      workoutSessionId: workoutSessionId ?? null,
      metadata: {
        setCount: acc.setCount,
        exercises: [...acc.exerciseSlugs],
        halfLifeMultiplier: round(multiplier, 3),
      },
    });
  }

  return events;
}

/** Demi-vie courte des événements de courbature : le signal doit s'estomper vite. */
const SORENESS_HALF_LIFE_HOURS = 12;

/** Part de capacité réinjectée par point de courbature déclaré. */
const SORENESS_STIMULUS_PER_POINT = 0.15;

/**
 * Convertit des courbatures déclarées en fatigue additionnelle.
 *
 * Une courbature persistante signale que le muscle n'a pas fini de réparer,
 * indépendamment de ce que prédit le modèle de décroissance. Plutôt que de
 * réécrire les événements passés — ce qui casserait la reproductibilité du
 * score — on ajoute un événement au journal. Le muscle est donc effectivement
 * repoussé, et la trace de la raison est conservée.
 *
 * Les courbatures inférieures à 3/5 sont ignorées : une légère raideur est un
 * état normal en phase d'accumulation et ne doit pas bloquer l'entraînement.
 */
export function buildSorenessEvents(
  reports: SorenessReport[],
  muscleConfigs: MuscleConfigMap,
  occurredAt: Date,
): StimulusEvent[] {
  const events: StimulusEvent[] = [];

  for (const report of reports) {
    if (report.soreness < 3) continue;

    const config = muscleConfigs[report.muscle];
    if (!config) continue;

    events.push({
      muscle: report.muscle,
      occurredAt,
      stimulus: round(SORENESS_STIMULUS_PER_POINT * report.soreness * config.capacity),
      effectiveSets: 0,
      halfLifeHours: SORENESS_HALF_LIFE_HOURS,
      source: 'soreness_report',
      // Une courbature ajoute de la fatigue mais ne redémarre pas le compteur
      // de repos : c'est le score continu qui doit décider, pas le plancher.
      isDirectWork: false,
      workoutSessionId: null,
      metadata: { soreness: report.soreness },
    });
  }

  return events;
}
