import type { ExerciseDefinition } from '@sport/shared';
import { getProgressionFamily } from '../catalog/exercises';
import type { EquipmentInventory, PerformedSet, ProgressionState } from '../types';
import { nextAvailableWeight } from './prescription';

/**
 * Surcharge progressive adaptée à l'entraînement à domicile.
 *
 * En salle, progresser consiste à ajouter 2,5 kg à la barre. À domicile, cet
 * axe est vite épuisé : les haltères sautent souvent de 5 kg, et le poids du
 * corps ne s'ajuste pas. Le moteur exploite donc plusieurs axes, dans cet ordre
 * de préférence :
 *
 *  1. **Répétitions** — monter dans la fourchette prescrite ;
 *  2. **Charge** — passer au palier d'haltère ou d'élastique suivant, en
 *     redescendant en bas de fourchette ;
 *  3. **Levier / variante** — quand aucune charge n'est disponible, passer à
 *     la variante plus difficile de la famille (pompes → pompes archer) ;
 *  4. **Tempo** — en dernier recours, ralentir la phase excentrique.
 *
 * La règle de déclenchement est la double progression classique : toutes les
 * séries au sommet de la fourchette avec au plus 1 répétition en réserve.
 */

export type ProgressionAction =
  | 'increase_reps'
  | 'increase_load'
  | 'increase_band'
  | 'advance_variant'
  | 'add_tempo'
  | 'hold'
  | 'regress';

export interface ProgressionDecision {
  action: ProgressionAction;
  nextState: ProgressionState;
  /** Message affiché à l'utilisateur lors de la prochaine séance. */
  note: string;
  /** Variante à proposer à la place, le cas échéant. */
  suggestedExerciseId: number | null;
}

/** Deux échecs consécutifs déclenchent une régression. */
const FAILURE_THRESHOLD = 2;

export interface EvaluateProgressionInput {
  exercise: ExerciseDefinition;
  /** Séries de travail réalisées sur cet exercice lors de la dernière séance. */
  sets: PerformedSet[];
  state: ProgressionState;
  inventory: EquipmentInventory;
  targetRepMin: number;
  targetRepMax: number;
}

/**
 * La séance valide-t-elle le palier ?
 * Toutes les séries de travail doivent atteindre le haut de fourchette en
 * restant à 1 répétition de l'échec au plus.
 */
function isSuccessful(sets: PerformedSet[], targetRepMax: number): boolean {
  const workingSets = sets.filter((s) => !s.isWarmup);
  if (workingSets.length === 0) return false;

  return workingSets.every((set) => {
    const reps = set.reps ?? 0;
    const rir = set.toFailure ? 0 : (set.rir ?? 3);
    return reps >= targetRepMax && rir <= 1;
  });
}

/** La séance est-elle un échec franc (sous le bas de fourchette) ? */
function isFailure(sets: PerformedSet[], targetRepMin: number): boolean {
  const workingSets = sets.filter((s) => !s.isWarmup);
  if (workingSets.length === 0) return false;
  return workingSets.some((set) => (set.reps ?? 0) < targetRepMin);
}

export function evaluateProgression(input: EvaluateProgressionInput): ProgressionDecision {
  const { exercise, sets, state, inventory, targetRepMin, targetRepMax } = input;
  const lastPerformedAt = sets.at(-1)?.performedAt ?? state.lastPerformedAt;

  /* ---------------------------------------------------------------------- */
  /*  Échec : régression avant que la technique ne se dégrade                */
  /* ---------------------------------------------------------------------- */
  if (isFailure(sets, targetRepMin)) {
    const failures = state.consecutiveFailures + 1;

    if (failures >= FAILURE_THRESHOLD) {
      const lighter =
        state.currentLoadKg != null && inventory.dumbbells
          ? [...inventory.dumbbells.availableWeightsKg]
              .filter((w) => w < state.currentLoadKg!)
              .sort((a, b) => b - a)[0]
          : undefined;

      return {
        action: 'regress',
        nextState: {
          ...state,
          currentLoadKg: lighter ?? state.currentLoadKg,
          currentRepTarget: targetRepMin,
          consecutiveSuccesses: 0,
          consecutiveFailures: 0,
          lastPerformedAt,
        },
        suggestedExerciseId: lighter === undefined ? findEasierVariant(exercise) : null,
        note:
          lighter !== undefined
            ? `Deux séances sous l’objectif : retour à ${lighter} kg pour reconstruire`
            : 'Deux séances sous l’objectif : on repasse à une variante plus accessible',
      };
    }

    return {
      action: 'hold',
      nextState: {
        ...state,
        consecutiveSuccesses: 0,
        consecutiveFailures: failures,
        lastPerformedAt,
      },
      suggestedExerciseId: null,
      note: 'Objectif non atteint : on reste sur la même charge pour consolider',
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Palier non validé : on progresse en répétitions                        */
  /* ---------------------------------------------------------------------- */
  if (!isSuccessful(sets, targetRepMax)) {
    const bestReps = Math.max(...sets.filter((s) => !s.isWarmup).map((s) => s.reps ?? 0), 0);
    const nextTarget = Math.min(targetRepMax, Math.max(state.currentRepTarget, bestReps + 1));

    return {
      action: 'increase_reps',
      nextState: {
        ...state,
        currentRepTarget: nextTarget,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        lastPerformedAt,
      },
      suggestedExerciseId: null,
      note: `Objectif : ${nextTarget} répétitions par série`,
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Palier validé : on monte d'un cran sur l'axe disponible                */
  /* ---------------------------------------------------------------------- */
  const successes = state.consecutiveSuccesses + 1;

  // Axe 1 : charge additionnelle (haltères)
  if (state.currentLoadKg != null && inventory.dumbbells) {
    const heavier = nextAvailableWeight(
      state.currentLoadKg,
      inventory.dumbbells.availableWeightsKg,
    );
    if (heavier !== null) {
      return {
        action: 'increase_load',
        nextState: {
          ...state,
          currentLoadKg: heavier,
          currentRepTarget: targetRepMin,
          consecutiveSuccesses: 0,
          consecutiveFailures: 0,
          lastPerformedAt,
        },
        suggestedExerciseId: null,
        note: `+${heavier - state.currentLoadKg} kg (${heavier} kg) — repartez en bas de fourchette`,
      };
    }
  }

  // Axe 2 : élastique plus résistant
  if (state.currentBandLevel && inventory.bands) {
    const levels = [...inventory.bands.levels].sort((a, b) => a.approxKg - b.approxKg);
    const currentIndex = levels.findIndex((l) => l.name === state.currentBandLevel);
    const next = currentIndex >= 0 ? levels[currentIndex + 1] : undefined;

    if (next) {
      return {
        action: 'increase_band',
        nextState: {
          ...state,
          currentBandLevel: next.name,
          currentRepTarget: targetRepMin,
          consecutiveSuccesses: 0,
          consecutiveFailures: 0,
          lastPerformedAt,
        },
        suggestedExerciseId: null,
        note: `Passez à l’élastique ${next.name}`,
      };
    }
  }

  // Axe 3 : variante plus difficile dans la même famille
  const harder = findHarderVariant(exercise);
  if (harder !== null) {
    return {
      action: 'advance_variant',
      nextState: {
        ...state,
        currentRepTarget: targetRepMin,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        lastPerformedAt,
      },
      suggestedExerciseId: harder,
      note: 'Palier validé : passez à la variante supérieure',
    };
  }

  // Axe 4 : plus rien à ajouter — on ralentit l'excentrique.
  return {
    action: 'add_tempo',
    nextState: {
      ...state,
      currentRepTarget: targetRepMax,
      consecutiveSuccesses: successes,
      consecutiveFailures: 0,
      lastPerformedAt,
    },
    suggestedExerciseId: null,
    note: 'Aucun palier supérieur disponible : ralentissez la descente à 4 secondes',
  };
}

/** Variante immédiatement plus difficile de la même famille. */
export function findHarderVariant(exercise: ExerciseDefinition): number | null {
  if (!exercise.progressionFamily) return null;
  const family = getProgressionFamily(exercise.progressionFamily);
  const next = family.find((e) => e.progressionRank > exercise.progressionRank);
  return next?.id ?? null;
}

/** Variante immédiatement plus accessible de la même famille. */
export function findEasierVariant(exercise: ExerciseDefinition): number | null {
  if (!exercise.progressionFamily) return null;
  const family = getProgressionFamily(exercise.progressionFamily);
  const easier = family.filter((e) => e.progressionRank < exercise.progressionRank);
  return easier.at(-1)?.id ?? null;
}

/** État de progression initial pour un exercice jamais réalisé. */
export function initialProgressionState(exercise: ExerciseDefinition): ProgressionState {
  return {
    exerciseId: exercise.id,
    currentLoadKg: null,
    currentBandLevel: null,
    currentRepTarget: exercise.defaultRepMin,
    consecutiveSuccesses: 0,
    consecutiveFailures: 0,
    lastPerformedAt: null,
  };
}
