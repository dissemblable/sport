import {
  DELOAD_RIR,
  EXCLUSION_REASON_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_CODES,
  MUSCLE_LABELS,
  RIR_BY_MESOCYCLE_WEEK,
  TIME_BUDGET_TOLERANCE,
  WARMUP_DURATION_SECONDS,
  type ExerciseDefinition,
  type MuscleCode,
} from '@sport/shared';
import { getProgressionFamily } from '../catalog/exercises';
import { prescribeLoad } from '../progression/prescription';
import type {
  ExcludedMuscleInfo,
  GeneratedSession,
  GenerateSessionInput,
  GenerationReport,
  PrescribedExercise,
} from '../types';
import { round } from '../utils/math';
import { buildExercisePool } from './exercisePool';
import { selectExercises, type SelectedExercise } from './selector';
import { computeVolumeTargets, remainingSessionsForWeek } from './volumeDebt';

/**
 * Génération d'une séance complète.
 *
 * Orchestration des étages précédents, dans un ordre qui n'est pas négociable :
 *
 *  1. lire l'état de récupération et **écarter les muscles non disponibles** ;
 *  2. calculer la dette de volume sur les muscles restants ;
 *  3. filtrer le catalogue par le matériel réellement possédé ;
 *  4. sélectionner les exercices ;
 *  5. prescrire charges, répétitions et repos via l'état de progression ;
 *  6. ordonner la séance ;
 *  7. produire un compte rendu expliquant chaque décision.
 *
 * L'étape 1 précède tout le reste : la récupération n'est pas un critère parmi
 * d'autres que l'on pondère, c'est un filtre appliqué avant même de se demander
 * quoi entraîner.
 */

/** Au-delà de cette proportion de muscles bloqués, le créneau est abandonné. */
const FALLBACK_BLOCKED_RATIO = 0.6;

/** Nombre de muscles retenus pour une séance de repli. */
const FALLBACK_FOCUS_SIZE = 6;

export function generateSession(input: GenerateSessionInput): GeneratedSession {
  const {
    now,
    slotIndex,
    split,
    profile,
    inventory,
    muscleConfigs,
    snapshot,
    mesocycleWeek,
    phase,
    exercises,
  } = input;

  const slot = split.slots[slotIndex];
  if (!slot) {
    throw new RangeError(`Créneau inexistant : ${slotIndex} (split de ${split.slots.length}).`);
  }

  const warnings: string[] = [];
  const bannedExerciseIds = input.bannedExerciseIds ?? new Set<number>();
  const favoriteExerciseIds = input.favoriteExerciseIds ?? new Set<number>();
  const previousSessionExerciseIds = input.previousSessionExerciseIds ?? new Set<number>();
  const progression = input.progression ?? new Map();

  /* ---------------------------------------------------------------------- */
  /*  1. Filtrage par la récupération — l'étape qui prime sur tout le reste   */
  /* ---------------------------------------------------------------------- */

  const blockedMuscles = new Set<MuscleCode>(
    MUSCLE_CODES.filter((m) => !snapshot.byMuscle[m]?.isAvailable),
  );

  const availableFocus = slot.targetMuscles.filter((m) => !blockedMuscles.has(m));
  const blockedInSlot = slot.targetMuscles.filter((m) => blockedMuscles.has(m));
  const blockedRatio =
    slot.targetMuscles.length === 0 ? 0 : blockedInSlot.length / slot.targetMuscles.length;

  let focusMuscles = new Set<MuscleCode>(availableFocus);
  let requiredPatterns = [...slot.requiredPatterns];
  let isFallbackSession = false;
  let slotLabel = slot.label;

  if (blockedRatio > FALLBACK_BLOCKED_RATIO) {
    // Trop de muscles du créneau sont encore en récupération. Plutôt que de
    // produire une séance amputée, on bascule vers les groupes réellement
    // disponibles : l'utilisateur s'entraîne quand même, sans compromettre la
    // récupération en cours.
    isFallbackSession = true;

    const fallback = MUSCLE_CODES.filter((m) => !blockedMuscles.has(m))
      .map((m) => ({
        muscle: m,
        debt: Math.max(
          0,
          (muscleConfigs[m]?.weeklyTargetSets ?? 0) - (snapshot.byMuscle[m]?.currentWeekSets ?? 0),
        ),
      }))
      .filter((entry) => entry.debt > 0)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, FALLBACK_FOCUS_SIZE)
      .map((entry) => entry.muscle);

    focusMuscles = new Set(fallback);
    // Aucun patron n'est imposé : le créneau d'origine n'est plus applicable.
    requiredPatterns = [];
    slotLabel = `Séance adaptée (créneau « ${slot.label} » reporté)`;

    warnings.push(
      `${blockedInSlot.length} des ${slot.targetMuscles.length} muscles prévus n’ont pas terminé leur récupération : la séance a été réorientée.`,
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  2. Dette de volume                                                     */
  /* ---------------------------------------------------------------------- */

  const remainingSessionsByMuscle = remainingSessionsForWeek({
    weeklyFrequencyByMuscle: split.weeklyFrequencyByMuscle,
    sessionsCompletedThisWeek: input.sessionsCompletedThisWeek ?? 0,
    sessionsPerWeek: split.sessionsPerWeek,
  });

  const targets = computeVolumeTargets({ snapshot, muscleConfigs, remainingSessionsByMuscle });

  /* ---------------------------------------------------------------------- */
  /*  3. Vivier d'exercices réalisables                                      */
  /* ---------------------------------------------------------------------- */

  const pool = buildExercisePool({
    exercises,
    inventory,
    experienceLevel: profile.experienceLevel,
    muscleConfigs,
    bannedExerciseIds,
  });

  if (pool.length === 0) {
    warnings.push(
      'Aucun exercice ne correspond au matériel déclaré : vérifiez vos réglages d’équipement.',
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  4. Sélection                                                           */
  /* ---------------------------------------------------------------------- */

  const durationMinutes = input.durationMinutes ?? profile.sessionDurationMinutes;

  // L'échauffement est déduit du budget : ce que l'utilisateur demande, c'est
  // une séance d'une heure au total, pas une heure de travail plus dix minutes.
  const timeBudgetSeconds = durationMinutes * 60 - WARMUP_DURATION_SECONDS;
  const hardCapSeconds =
    durationMinutes * 60 * (1 + TIME_BUDGET_TOLERANCE) - WARMUP_DURATION_SECONDS;

  const selection = selectExercises({
    pool,
    targets,
    focusMuscles,
    requiredPatterns,
    blockedMuscles,
    snapshot,
    muscleConfigs,
    timeBudgetSeconds,
    hardCapSeconds,
    previousSessionExerciseIds,
    favoriteExerciseIds,
  });

  // L'explication donnée à l'utilisateur doit correspondre à la vraie raison
  // pour laquelle la sélection s'est arrêtée. Invoquer le manque de temps quand
  // le volume hebdomadaire est simplement atteint serait trompeur, et le
  // pousserait à rallonger ses séances sans aucune raison.
  const uncovered = selection.uncoveredPatterns
    .map((pattern) => MOVEMENT_PATTERN_LABELS[pattern])
    .join(', ');

  if (selection.selected.length === 0) {
    warnings.push(
      selection.stoppedBy === 'targets_met'
        ? 'Votre volume hebdomadaire est déjà atteint pour les groupes disponibles : repos ou mobilité recommandés.'
        : 'Aucun groupe musculaire n’a suffisamment récupéré pour un travail productif : journée de repos ou mobilité recommandée.',
    );
  } else if (selection.stoppedBy === 'targets_met' && selection.selected.length <= 2) {
    warnings.push(
      'Séance courte : le volume hebdomadaire prévu pour ces groupes est presque entièrement réalisé.',
    );
  }

  if (uncovered.length > 0 && !isFallbackSession) {
    if (selection.stoppedBy === 'time_budget') {
      warnings.push(`Durée de séance atteinte : ${uncovered} non couvert(s).`);
    } else if (selection.stoppedBy === 'no_candidate') {
      warnings.push(`Aucun exercice disponible avec votre matériel pour : ${uncovered}.`);
    } else if (selection.stoppedBy === 'targets_met') {
      warnings.push(`Volume déjà atteint : ${uncovered} reporté(s) à la prochaine séance.`);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  5. Prescription et 6. ordonnancement                                   */
  /* ---------------------------------------------------------------------- */

  const targetRir = resolveTargetRir(mesocycleWeek, phase);
  const ordered = orderSession(selection.selected);

  const prescribed: PrescribedExercise[] = [];
  let position = 0;

  // Échauffement spécifique : la variante la plus accessible du premier
  // mouvement, une série longue et facile. Plus utile qu'un échauffement
  // générique, car il prépare exactement l'articulation qui va travailler.
  const firstMain = ordered.find((s) => s.exercise.mechanic === 'compound') ?? ordered[0];
  if (firstMain) {
    const warmupExercise = easiestVariantOf(firstMain.exercise, pool);
    prescribed.push({
      exercise: warmupExercise,
      block: 'warmup',
      position: position++,
      targetSets: 1,
      targetRepMin: warmupExercise.defaultRepMax,
      targetRepMax: warmupExercise.defaultRepMax + 5,
      targetRir: 5,
      restSeconds: 60,
      loadKg: null,
      bandLevel: null,
      tempo: null,
      perSide: warmupExercise.isUnilateral,
      progressionNote: null,
      rationale: 'Échauffement spécifique du premier mouvement de la séance',
    });
  }

  for (const item of ordered) {
    const state = progression.get(item.exercise.id);
    const load = prescribeLoad(item.exercise, inventory, state);

    const repMin = item.exercise.defaultRepMin;
    const repMax = item.exercise.defaultRepMax;
    const repTarget = state?.currentRepTarget;

    prescribed.push({
      exercise: item.exercise,
      block: blockFor(item.exercise),
      position: position++,
      targetSets: item.sets,
      targetRepMin: repTarget != null ? Math.max(repMin, Math.min(repTarget, repMax)) : repMin,
      targetRepMax: repMax,
      targetRir,
      restSeconds: item.exercise.defaultRestSeconds,
      loadKg: load.loadKg,
      bandLevel: load.bandLevel,
      tempo: null,
      perSide: item.exercise.isUnilateral,
      progressionNote: load.note,
      rationale: item.rationale,
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  7. Compte rendu                                                        */
  /* ---------------------------------------------------------------------- */

  const plannedSetsByMuscle: Partial<Record<MuscleCode, number>> = {};
  for (const item of selection.selected) {
    for (const involvement of item.exercise.muscles) {
      const current = plannedSetsByMuscle[involvement.muscle] ?? 0;
      plannedSetsByMuscle[involvement.muscle] = round(
        current + item.sets * involvement.contribution,
        2,
      );
    }
  }

  const excludedMuscles: ExcludedMuscleInfo[] = slot.targetMuscles
    .filter((m) => blockedMuscles.has(m))
    .map((muscle) => {
      const state = snapshot.byMuscle[muscle];
      return {
        muscle,
        reason: state?.blockedBy ?? 'fatigue_too_high',
        availableAt: state?.availableAt ?? null,
        hoursUntilAvailable: state?.hoursUntilAvailable ?? null,
      };
    });

  const estimatedSeconds = WARMUP_DURATION_SECONDS + selection.estimatedSeconds;

  const report: GenerationReport = {
    generatedAt: now,
    slotLabel,
    mesocycleWeek,
    phase,
    targetedMuscles: [...focusMuscles],
    excludedMuscles,
    plannedSetsByMuscle,
    remainingDebtByMuscle: selection.remainingDebt,
    coveredPatterns: selection.coveredPatterns,
    isFallbackSession,
    warnings,
  };

  return {
    slotIndex,
    slotLabel,
    exercises: prescribed,
    estimatedDurationMinutes: Math.round(estimatedSeconds / 60),
    report,
  };
}

/* -------------------------------------------------------------------------- */
/*                                 Utilitaires                                */
/* -------------------------------------------------------------------------- */

/**
 * RIR prescrit selon la semaine du mésocycle.
 *
 * On démarre loin de l'échec et on s'en rapproche semaine après semaine : le
 * stimulus augmente sans que le volume ait à croître indéfiniment.
 */
export function resolveTargetRir(mesocycleWeek: number, phase: GenerateSessionInput['phase']) {
  if (phase === 'deload') return DELOAD_RIR;
  const index = Math.min(mesocycleWeek - 1, RIR_BY_MESOCYCLE_WEEK.length - 1);
  return RIR_BY_MESOCYCLE_WEEK[Math.max(0, index)] ?? 2;
}

function blockFor(exercise: ExerciseDefinition): PrescribedExercise['block'] {
  if (exercise.pattern.startsWith('core_')) return 'core';
  return exercise.mechanic === 'compound' ? 'main' : 'accessory';
}

/**
 * Ordre d'exécution : polyarticulaires du plus exigeant au moins exigeant,
 * puis isolation, puis gainage.
 *
 * Les mouvements les plus coûteux passent en premier, quand le système nerveux
 * est frais — l'inverse dégraderait la technique là où le risque est le plus élevé.
 */
function orderSession(selected: SelectedExercise[]): SelectedExercise[] {
  const rank = (item: SelectedExercise) => {
    const block = blockFor(item.exercise);
    if (block === 'main') return 0;
    if (block === 'accessory') return 1;
    return 2;
  };

  return [...selected].sort((a, b) => {
    const byBlock = rank(a) - rank(b);
    if (byBlock !== 0) return byBlock;

    const byLoad = b.exercise.systemicLoad - a.exercise.systemicLoad;
    if (byLoad !== 0) return byLoad;

    // Départage stable : l'identifiant du catalogue.
    return a.exercise.id - b.exercise.id;
  });
}

/** Variante la plus accessible d'un exercice, pour l'échauffement. */
function easiestVariantOf(
  exercise: ExerciseDefinition,
  pool: ExerciseDefinition[],
): ExerciseDefinition {
  if (!exercise.progressionFamily) return exercise;

  const available = new Set(pool.map((e) => e.id));
  const family = getProgressionFamily(exercise.progressionFamily).filter(
    (e) => available.has(e.id) && e.progressionRank <= exercise.progressionRank,
  );

  return family[0] ?? exercise;
}

/** Résumé lisible des muscles écartés, destiné à l'utilisateur. */
export function describeExclusions(report: GenerationReport): string[] {
  return report.excludedMuscles.map((entry) => {
    const label = MUSCLE_LABELS[entry.muscle];
    const reason = EXCLUSION_REASON_LABELS[entry.reason];
    if (entry.hoursUntilAvailable == null) return `${label} — ${reason}`;
    return `${label} — ${reason}, disponible dans ${Math.round(entry.hoursUntilAvailable)} h`;
  });
}
