import { DEFAULT_MIN_REST_HOURS, type SplitSlot } from '@sport/shared';
import { minGapBetweenSharedMuscles } from './split';

/**
 * Placement des séances dans la semaine.
 *
 * Le problème est minuscule : au plus C(7,6) = 7 combinaisons de jours par
 * cardinal, soit 35 au total, multipliées par les rotations de l'ordre des
 * créneaux. On **énumère donc exhaustivement** plutôt que d'appliquer une
 * heuristique : la solution renvoyée est optimale au sens de la fonction de
 * score, et le résultat est parfaitement déterministe.
 *
 * Objectif de la fonction de score, par ordre d'importance :
 *  1. maximiser l'écart minimal entre deux séances partageant un muscle,
 *  2. respecter les jours souhaités par l'utilisateur,
 *  3. répartir les séances le plus régulièrement possible sur la semaine.
 */

export interface PlacementInput {
  slots: SplitSlot[];
  /** Jours souhaités, 0 = lundi … 6 = dimanche. */
  preferredWeekdays: number[];
  minRestHours?: number;
}

export interface SessionPlacement {
  /** Index du créneau dans le split. */
  slotIndex: number;
  slotLabel: string;
  /** Jour de la semaine retenu, 0 = lundi … 6 = dimanche. */
  weekday: number;
}

export interface PlacementResult {
  placements: SessionPlacement[];
  /** Jours retenus, triés. */
  weekdays: number[];
  minGapHours: number;
  respectsMinRest: boolean;
  /** Jours imposés hors des préférences de l'utilisateur. */
  daysOutsidePreference: number[];
  score: number;
}

/** Toutes les combinaisons de `k` jours parmi les 7 de la semaine. */
function combinations(pool: number[], k: number): number[][] {
  const result: number[][] = [];

  const walk = (start: number, current: number[]) => {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < pool.length; i += 1) {
      const day = pool[i];
      if (day === undefined) continue;
      current.push(day);
      walk(i + 1, current);
      current.pop();
    }
  };

  walk(0, []);
  return result;
}

/**
 * Irrégularité de la répartition : écart-type des intervalles entre séances
 * consécutives, en jours (cycle de 7 jours inclus).
 */
function spreadPenalty(weekdays: number[]): number {
  if (weekdays.length < 2) return 0;

  const gaps: number[] = [];
  for (let i = 0; i < weekdays.length; i += 1) {
    const current = weekdays[i];
    const next = weekdays[(i + 1) % weekdays.length];
    if (current === undefined || next === undefined) continue;
    const raw = next - current;
    gaps.push(raw > 0 ? raw : raw + 7);
  }

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance);
}

/**
 * Trouve la meilleure répartition des créneaux sur la semaine.
 *
 * L'ordre des créneaux est conservé à une rotation près : les splits sont
 * conçus pour que les créneaux voisins partagent peu de muscles, il serait
 * contre-productif de les permuter librement.
 */
export function placeSessions(input: PlacementInput): PlacementResult {
  const { slots, preferredWeekdays } = input;
  const minRestHours = input.minRestHours ?? DEFAULT_MIN_REST_HOURS;
  const n = slots.length;

  if (n === 0) {
    return {
      placements: [],
      weekdays: [],
      minGapHours: 7 * 24,
      respectsMinRest: true,
      daysOutsidePreference: [],
      score: 0,
    };
  }

  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const preferred = new Set(preferredWeekdays);

  let best: PlacementResult | null = null;

  for (const combo of combinations(allDays, Math.min(n, 7))) {
    const outside = combo.filter((d) => !preferred.has(d));

    for (let rotation = 0; rotation < n; rotation += 1) {
      // Rotation de l'ordre des créneaux : permet, par exemple, de démarrer la
      // semaine par « Jambes » plutôt que par « Push » si cela espace mieux.
      const rotated = Array.from({ length: n }, (_, i) => slots[(i + rotation) % n]!);

      const minGap = minGapBetweenSharedMuscles(rotated, combo);

      // Le respect du plancher domine tout le reste : un placement qui le viole
      // est pénalisé si lourdement qu'il ne peut gagner que s'il n'existe
      // aucune alternative valide.
      const restScore = minGap >= minRestHours ? 1000 + minGap : minGap;
      const score = restScore * 10 - outside.length * 60 - spreadPenalty(combo) * 12;

      if (best === null || score > best.score) {
        best = {
          placements: rotated.map((slot, i) => ({
            slotIndex: slot.index,
            slotLabel: slot.label,
            weekday: combo[i]!,
          })),
          weekdays: [...combo],
          minGapHours: minGap,
          respectsMinRest: minGap >= minRestHours,
          daysOutsidePreference: outside,
          score,
        };
      }
    }
  }

  // `combinations` renvoie toujours au moins une entrée pour 1 ≤ n ≤ 7.
  return best!;
}
