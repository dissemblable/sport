import {
  DEFAULT_MIN_REST_HOURS,
  MAX_SESSIONS_PER_WEEK,
  MIN_SESSIONS_PER_WEEK,
  SPLIT_BY_FREQUENCY,
  SPLIT_TYPE_LABELS,
  type MovementPattern,
  type MuscleCode,
  type SplitDefinition,
  type SplitSlot,
  type SplitType,
} from '@sport/shared';

/**
 * Choix et définition du split hebdomadaire.
 *
 * Le principe directeur : **c'est la contrainte de récupération qui impose le
 * split, et non l'inverse.** À 2 ou 3 séances par semaine, un full body permet
 * de solliciter chaque muscle plusieurs fois tout en gardant 48 h d'écart. À
 * partir de 4 séances, c'est mathématiquement impossible — il faut découper le
 * corps pour que les jours consécutifs ne se recouvrent pas.
 *
 * Chaque créneau (« slot ») déclare :
 *  - les muscles qu'il cible en priorité,
 *  - les patrons moteurs qu'il doit obligatoirement couvrir.
 *
 * Les créneaux voisins partagent volontairement le moins de muscles possible :
 * ainsi, une séance avancée de quelques heures ne vient pas buter contre le
 * plancher de repos.
 */

interface SlotSeed {
  label: string;
  targetMuscles: MuscleCode[];
  requiredPatterns: MovementPattern[];
}

/* -------------------------------------------------------------------------- */
/*                          Définition des créneaux                           */
/* -------------------------------------------------------------------------- */

/** 2 séances : chaque séance couvre l'ensemble du corps, avec 72 h d'écart. */
const FULL_BODY_2: SlotSeed[] = [
  {
    label: 'Full body A',
    targetMuscles: [
      'chest',
      'front_delts',
      'triceps',
      'lats',
      'upper_back',
      'biceps',
      'quads',
      'glutes',
      'abs',
    ],
    requiredPatterns: ['horizontal_push', 'vertical_pull', 'squat', 'core_antiextension'],
  },
  {
    label: 'Full body B',
    targetMuscles: [
      'chest',
      'side_delts',
      'triceps',
      'lats',
      'rear_delts',
      'biceps',
      'hamstrings',
      'glutes',
      'calves',
      'obliques',
    ],
    requiredPatterns: ['vertical_push', 'horizontal_pull', 'hinge', 'core_rotation'],
  },
];

/**
 * 3 séances : rotation A/B/C.
 *
 * Chaque muscle majeur apparaît dans deux créneaux sur trois. Deux séances
 * consécutives partagent donc peu de muscles, ce qui laisse naturellement
 * 96 h de repos aux groupes lourds au lieu des 48 h minimum.
 */
const FULL_BODY_3: SlotSeed[] = [
  {
    label: 'Full body A — poussée & quadriceps',
    targetMuscles: ['chest', 'front_delts', 'triceps', 'quads', 'glutes', 'abs', 'lats', 'biceps'],
    requiredPatterns: ['horizontal_push', 'squat', 'vertical_pull', 'core_antiextension'],
  },
  {
    label: 'Full body B — tirage & chaîne postérieure',
    targetMuscles: [
      'lats',
      'upper_back',
      'rear_delts',
      'biceps',
      'hamstrings',
      'glutes',
      'calves',
      'obliques',
    ],
    requiredPatterns: ['horizontal_pull', 'hinge', 'core_rotation', 'isolation_lower'],
  },
  {
    label: 'Full body C — épaules & unilatéral',
    targetMuscles: [
      'chest',
      'side_delts',
      'triceps',
      'quads',
      'hamstrings',
      'adductors',
      'abs',
      'lower_back',
    ],
    requiredPatterns: ['vertical_push', 'lunge', 'core_flexion', 'isolation_upper'],
  },
];

/** 4 séances : haut / bas alterné, chaque moitié travaillée deux fois. */
const UPPER_LOWER_4: SlotSeed[] = [
  {
    label: 'Haut du corps A — poussée',
    targetMuscles: [
      'chest',
      'front_delts',
      'side_delts',
      'triceps',
      'lats',
      'upper_back',
      'biceps',
    ],
    requiredPatterns: ['horizontal_push', 'vertical_pull', 'isolation_upper'],
  },
  {
    label: 'Bas du corps A — quadriceps',
    targetMuscles: ['quads', 'glutes', 'adductors', 'calves', 'abs'],
    requiredPatterns: ['squat', 'lunge', 'isolation_lower', 'core_flexion'],
  },
  {
    label: 'Haut du corps B — tirage',
    targetMuscles: [
      'lats',
      'upper_back',
      'rear_delts',
      'biceps',
      'chest',
      'side_delts',
      'triceps',
    ],
    requiredPatterns: ['vertical_push', 'horizontal_pull', 'isolation_upper'],
  },
  {
    label: 'Bas du corps B — chaîne postérieure',
    targetMuscles: ['hamstrings', 'glutes', 'lower_back', 'calves', 'quads', 'obliques'],
    requiredPatterns: ['hinge', 'lunge', 'isolation_lower', 'core_rotation'],
  },
];

/** 5 séances : Push / Pull / Jambes puis Haut / Bas pour boucler le volume. */
const PPL_UL_5: SlotSeed[] = [
  {
    label: 'Push — pectoraux, épaules, triceps',
    targetMuscles: ['chest', 'front_delts', 'side_delts', 'triceps'],
    requiredPatterns: ['horizontal_push', 'vertical_push', 'isolation_upper'],
  },
  {
    label: 'Pull — dos et biceps',
    targetMuscles: ['lats', 'upper_back', 'rear_delts', 'biceps', 'forearms'],
    requiredPatterns: ['vertical_pull', 'horizontal_pull', 'isolation_upper'],
  },
  {
    label: 'Jambes — complet',
    targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abs'],
    requiredPatterns: ['squat', 'hinge', 'lunge', 'isolation_lower'],
  },
  {
    label: 'Haut du corps — rappel',
    targetMuscles: ['chest', 'lats', 'side_delts', 'upper_back', 'triceps', 'biceps'],
    requiredPatterns: ['horizontal_push', 'horizontal_pull', 'isolation_upper'],
  },
  {
    label: 'Bas du corps — rappel',
    targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'lower_back', 'obliques'],
    requiredPatterns: ['squat', 'hinge', 'core_rotation'],
  },
];

/** 6 séances : Push / Pull / Jambes répété deux fois, 72 h par groupe. */
const PPL_X2_6: SlotSeed[] = [
  {
    label: 'Push A — force',
    targetMuscles: ['chest', 'front_delts', 'triceps', 'side_delts'],
    requiredPatterns: ['horizontal_push', 'vertical_push', 'isolation_upper'],
  },
  {
    label: 'Pull A — force',
    targetMuscles: ['lats', 'upper_back', 'biceps', 'rear_delts', 'forearms'],
    requiredPatterns: ['vertical_pull', 'horizontal_pull', 'isolation_upper'],
  },
  {
    label: 'Jambes A — quadriceps',
    targetMuscles: ['quads', 'glutes', 'adductors', 'calves', 'abs'],
    requiredPatterns: ['squat', 'lunge', 'isolation_lower', 'core_flexion'],
  },
  {
    label: 'Push B — volume',
    targetMuscles: ['chest', 'side_delts', 'triceps', 'front_delts'],
    requiredPatterns: ['horizontal_push', 'vertical_push', 'isolation_upper'],
  },
  {
    label: 'Pull B — volume',
    targetMuscles: ['lats', 'upper_back', 'rear_delts', 'biceps', 'forearms'],
    requiredPatterns: ['horizontal_pull', 'vertical_pull', 'isolation_upper'],
  },
  {
    label: 'Jambes B — chaîne postérieure',
    targetMuscles: ['hamstrings', 'glutes', 'lower_back', 'calves', 'obliques'],
    requiredPatterns: ['hinge', 'lunge', 'isolation_lower', 'core_rotation'],
  },
];

const SLOTS_BY_FREQUENCY: Record<number, SlotSeed[]> = {
  2: FULL_BODY_2,
  3: FULL_BODY_3,
  4: UPPER_LOWER_4,
  5: PPL_UL_5,
  6: PPL_X2_6,
};

/* -------------------------------------------------------------------------- */
/*                            Construction du split                           */
/* -------------------------------------------------------------------------- */

/** Nombre de créneaux dans lesquels chaque muscle apparaît. */
export function computeWeeklyFrequency(
  slots: SplitSlot[],
): Partial<Record<MuscleCode, number>> {
  const frequency: Partial<Record<MuscleCode, number>> = {};
  for (const slot of slots) {
    for (const muscle of slot.targetMuscles) {
      frequency[muscle] = (frequency[muscle] ?? 0) + 1;
    }
  }
  return frequency;
}

/**
 * Écart minimal, en heures, entre deux créneaux partageant au moins un muscle,
 * pour une distribution de jours donnée.
 *
 * C'est la mesure qui valide qu'un split respecte réellement le plancher de
 * repos : deux séances « différentes » qui partagent les pectoraux à 24 h
 * d'intervalle violent la contrainte tout autant que deux séances identiques.
 */
export function minGapBetweenSharedMuscles(slots: SplitSlot[], weekdays: number[]): number {
  let minGap = Number.POSITIVE_INFINITY;

  for (let i = 0; i < slots.length; i += 1) {
    for (let j = 0; j < slots.length; j += 1) {
      if (i === j) continue;

      const a = slots[i];
      const b = slots[j];
      const dayA = weekdays[i];
      const dayB = weekdays[j];
      if (a === undefined || b === undefined || dayA === undefined || dayB === undefined) continue;

      const shares = a.targetMuscles.some((m) => b.targetMuscles.includes(m));
      if (!shares) continue;

      // Écart cyclique sur 7 jours : de vendredi à lundi, il y a 3 jours.
      const rawGap = dayB - dayA;
      const gapDays = rawGap > 0 ? rawGap : rawGap + 7;
      minGap = Math.min(minGap, gapDays * 24);
    }
  }

  return Number.isFinite(minGap) ? minGap : 7 * 24;
}

/**
 * Split correspondant à une fréquence hebdomadaire.
 *
 * @throws si la fréquence sort de la plage supportée (2 à 6).
 */
export function getSplit(sessionsPerWeek: number, weekdays?: number[]): SplitDefinition {
  if (sessionsPerWeek < MIN_SESSIONS_PER_WEEK || sessionsPerWeek > MAX_SESSIONS_PER_WEEK) {
    throw new RangeError(
      `Fréquence non supportée : ${sessionsPerWeek}. Attendu entre ${MIN_SESSIONS_PER_WEEK} et ${MAX_SESSIONS_PER_WEEK}.`,
    );
  }

  const seeds = SLOTS_BY_FREQUENCY[sessionsPerWeek];
  const type = SPLIT_BY_FREQUENCY[sessionsPerWeek];
  if (!seeds || !type) {
    throw new RangeError(`Aucun split défini pour ${sessionsPerWeek} séances par semaine.`);
  }

  const slots: SplitSlot[] = seeds.map((seed, index) => ({
    index,
    label: seed.label,
    targetMuscles: seed.targetMuscles,
    requiredPatterns: seed.requiredPatterns,
  }));

  const effectiveWeekdays = weekdays ?? defaultWeekdays(sessionsPerWeek);

  return {
    type,
    sessionsPerWeek,
    slots,
    weeklyFrequencyByMuscle: computeWeeklyFrequency(slots),
    minGapHours: minGapBetweenSharedMuscles(slots, effectiveWeekdays),
  };
}

/**
 * Répartition par défaut des jours, choisie pour maximiser l'espacement.
 * 0 = lundi … 6 = dimanche.
 */
export function defaultWeekdays(sessionsPerWeek: number): number[] {
  switch (sessionsPerWeek) {
    case 2:
      return [0, 3]; // lundi, jeudi
    case 3:
      return [0, 2, 4]; // lundi, mercredi, vendredi
    case 4:
      return [0, 1, 3, 4]; // lundi, mardi, jeudi, vendredi
    case 5:
      return [0, 1, 2, 4, 5]; // lundi, mardi, mercredi, vendredi, samedi
    case 6:
      return [0, 1, 2, 3, 4, 5]; // lundi à samedi
    default:
      return [0, 3];
  }
}

export function splitLabel(type: SplitType): string {
  return SPLIT_TYPE_LABELS[type];
}

/**
 * Vérifie qu'un split, placé sur des jours donnés, respecte le plancher de repos.
 * Utilisé par les tests et par l'aperçu de changement de fréquence.
 */
export function respectsMinRest(
  slots: SplitSlot[],
  weekdays: number[],
  minRestHours = DEFAULT_MIN_REST_HOURS,
): boolean {
  return minGapBetweenSharedMuscles(slots, weekdays) >= minRestHours;
}
