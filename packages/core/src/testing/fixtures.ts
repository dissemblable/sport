import type { EquipmentCode, MesocyclePhase } from '@sport/shared';
import { EXERCISE_BY_ID, EXERCISE_BY_SLUG, EXERCISE_CATALOG } from '../catalog/exercises';
import { buildMuscleConfigs } from '../muscleConfig';
import { getSplit } from '../scheduling/split';
import type {
  AthleteProfile,
  EquipmentInventory,
  MuscleConfigMap,
  MuscleSettingOverride,
  PerformedSet,
} from '../types';

/**
 * Fixtures partagées par les tests du moteur.
 *
 * Ce module n'est pas exporté par `index.ts` : il n'a d'existence que dans les
 * tests, mais reste sous `src/` pour être vérifié par le compilateur.
 */

export function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    experienceLevel: 'intermediate',
    primaryGoal: 'hypertrophy',
    sessionsPerWeek: 4,
    sessionDurationMinutes: 60,
    preferredWeekdays: [0, 1, 3, 4],
    age: 30,
    bodyWeightKg: 75,
    deloadEveryNWeeks: 5,
    ...overrides,
  };
}

/** Inventaire complet : les quatre équipements autorisés. */
export function makeFullInventory(): EquipmentInventory {
  return {
    owned: ['bodyweight', 'pull_up_bar', 'dumbbells', 'resistance_bands'],
    dumbbells: {
      availableWeightsKg: [4, 6, 8, 10, 12, 14, 16, 20, 24],
      pairCount: 2,
      incrementKg: 2,
    },
    bands: {
      levels: [
        { name: 'Jaune', approxKg: 5 },
        { name: 'Rouge', approxKg: 12 },
        { name: 'Noir', approxKg: 25 },
      ],
    },
    pullUpBarCanAddWeight: true,
  };
}

/** Inventaire restreint, pour vérifier le filtrage matériel. */
export function makeInventory(owned: EquipmentCode[]): EquipmentInventory {
  const full = makeFullInventory();
  return {
    owned: owned.includes('bodyweight') ? owned : ['bodyweight', ...owned],
    dumbbells: owned.includes('dumbbells') ? full.dumbbells : null,
    bands: owned.includes('resistance_bands') ? full.bands : null,
    pullUpBarCanAddWeight: owned.includes('pull_up_bar') && owned.includes('dumbbells'),
  };
}

export interface MakeConfigsOptions {
  profile?: AthleteProfile;
  sessionsPerWeek?: number;
  mesocycleWeek?: number;
  totalWeeks?: number;
  phase?: MesocyclePhase;
  overrides?: MuscleSettingOverride[];
}

export function makeConfigs(options: MakeConfigsOptions = {}): MuscleConfigMap {
  const profile = options.profile ?? makeProfile();
  const split = getSplit(options.sessionsPerWeek ?? profile.sessionsPerWeek);

  return buildMuscleConfigs({
    profile,
    weeklyFrequencyByMuscle: split.weeklyFrequencyByMuscle,
    mesocycleWeek: options.mesocycleWeek ?? 1,
    totalWeeks: options.totalWeeks ?? 5,
    phase: options.phase ?? 'accumulation',
    overrides: options.overrides,
  });
}

export interface MakeSetsOptions {
  reps?: number;
  loadKg?: number | null;
  rir?: number;
  isWarmup?: boolean;
  /**
   * Espacement entre séries, en minutes. Nul par défaut : les tests raisonnent
   * sur des échéances à l'heure près, un décalage même minime déplacerait le
   * plancher de repos et rendrait les assertions illisibles.
   */
  spacingMinutes?: number;
}

/** Fabrique `count` séries de travail sur un exercice. */
export function makeSets(
  slug: string,
  count: number,
  performedAt: Date,
  options: MakeSetsOptions = {},
): PerformedSet[] {
  const exercise = EXERCISE_BY_SLUG[slug];
  if (!exercise) throw new Error(`Exercice inconnu dans le catalogue : ${slug}`);

  const spacing = (options.spacingMinutes ?? 0) * 60_000;

  return Array.from({ length: count }, (_, index) => ({
    exerciseId: exercise.id,
    isWarmup: options.isWarmup ?? false,
    reps: options.reps ?? 10,
    loadKg: options.loadKg ?? null,
    bandLevel: null,
    rir: options.rir ?? 1,
    toFailure: false,
    durationSeconds: null,
    performedAt: new Date(performedAt.getTime() + index * spacing),
  }));
}

export const catalogById = EXERCISE_BY_ID;
export const catalog = EXERCISE_CATALOG;

/** Instant de référence des tests : lundi 6 janvier 2025, 18 h UTC. */
export const MONDAY_18H = new Date('2025-01-06T18:00:00.000Z');
