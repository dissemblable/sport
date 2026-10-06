import type { ExerciseDefinition } from '@sport/shared';
import type { EquipmentInventory, ProgressionState } from '../types';

/**
 * Choix de la charge à prescrire pour un exercice.
 *
 * Contrainte forte : on ne propose **que des charges réellement disponibles**.
 * Un utilisateur qui possède des haltères de 5, 10 et 15 kg ne doit jamais lire
 * « 12,5 kg » sur son écran. La progression se fait donc par paliers réels, et
 * lorsque le palier suivant est trop grand, elle bascule sur un autre axe
 * (répétitions, tempo, variante plus difficile).
 */

export interface LoadPrescription {
  loadKg: number | null;
  bandLevel: string | null;
  /** Explication du changement par rapport à la dernière séance. */
  note: string | null;
}

/** Charge disponible la plus proche d'une cible, parmi celles possédées. */
export function nearestAvailableWeight(target: number, available: number[]): number | null {
  if (available.length === 0) return null;
  return available.reduce((best, weight) =>
    Math.abs(weight - target) < Math.abs(best - target) ? weight : best,
  );
}

/** Charge disponible immédiatement supérieure — `null` si la cible est au plafond. */
export function nextAvailableWeight(current: number, available: number[]): number | null {
  const heavier = available.filter((w) => w > current).sort((a, b) => a - b);
  return heavier[0] ?? null;
}

/**
 * Charge de départ quand aucun historique n'existe.
 *
 * On vise volontairement bas : une première séance trop légère coûte une
 * séance, une première séance trop lourde coûte une blessure. Le moteur de
 * progression corrigera dès la séance suivante.
 */
function startingWeight(exercise: ExerciseDefinition, available: number[]): number | null {
  if (available.length === 0) return null;
  const sorted = [...available].sort((a, b) => a - b);
  const ratio = exercise.mechanic === 'compound' ? 0.4 : 0.25;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? sorted[0] ?? null;
}

export function prescribeLoad(
  exercise: ExerciseDefinition,
  inventory: EquipmentInventory,
  state: ProgressionState | undefined,
): LoadPrescription {
  const usesDumbbells = exercise.equipment.includes('dumbbells');
  const usesBands = exercise.equipment.includes('resistance_bands');

  if (usesDumbbells && inventory.dumbbells) {
    const available = inventory.dumbbells.availableWeightsKg;

    if (state?.currentLoadKg != null) {
      const loadKg = nearestAvailableWeight(state.currentLoadKg, available);
      return { loadKg, bandLevel: null, note: null };
    }

    return {
      loadKg: startingWeight(exercise, available),
      bandLevel: null,
      note: 'Première séance : charge de départ prudente, à ajuster selon vos sensations',
    };
  }

  if (usesBands && inventory.bands && inventory.bands.levels.length > 0) {
    const levels = [...inventory.bands.levels].sort((a, b) => a.approxKg - b.approxKg);

    if (state?.currentBandLevel) {
      const known = levels.find((l) => l.name === state.currentBandLevel);
      if (known) return { loadKg: null, bandLevel: known.name, note: null };
    }

    // À défaut d'historique, l'élastique le plus léger permet de valider la
    // technique et l'amplitude complète.
    const first = levels[0];
    return {
      loadKg: null,
      bandLevel: first ? first.name : null,
      note: 'Commencez par l’élastique le plus léger et montez si l’amplitude reste facile',
    };
  }

  return { loadKg: null, bandLevel: null, note: null };
}
