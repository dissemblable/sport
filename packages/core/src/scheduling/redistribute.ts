import {
  DEFAULT_MIN_REST_HOURS,
  MUSCLE_CODES,
  MUSCLE_LABELS,
  SPLIT_TYPE_LABELS,
  type MesocyclePhase,
  type MuscleCode,
  type SplitDefinition,
} from '@sport/shared';
import { buildMuscleConfigs } from '../muscleConfig';
import type { AthleteProfile, MuscleConfigMap, MuscleSettingOverride } from '../types';
import { round } from '../utils/math';
import { placeSessions, type PlacementResult } from './placement';
import { getSplit } from './split';

/**
 * Changement de fréquence hebdomadaire.
 *
 * Principe directeur : **c'est le volume hebdomadaire qui produit
 * l'hypertrophie, pas le nombre de séances.** Passer de 3 à 4 entraînements ne
 * doit donc pas augmenter mécaniquement la charge de travail — cela répartit
 * le même volume sur davantage de séances, ce qui les raccourcit et améliore la
 * qualité de chaque série.
 *
 * Concrètement :
 *  - la cible hebdomadaire par muscle est **inchangée** (elle ne dépend que de
 *    la semaine du mésocycle, du niveau et des priorités de l'utilisateur) ;
 *  - le split et le placement des jours sont recalculés pour la nouvelle
 *    fréquence, en respectant le plancher de repos ;
 *  - les séries par séance deviennent `cible hebdomadaire ÷ nouvelle fréquence`.
 *
 * Les séances déjà réalisées ne sont jamais touchées : seule la partie future
 * du plan est régénérée, et l'ancienne version est archivée.
 */

export interface MuscleVolumeComparison {
  muscle: MuscleCode;
  label: string;
  weeklyTargetSets: number;
  /** Fréquence de sollicitation avant / après. */
  frequencyBefore: number;
  frequencyAfter: number;
  /** Séries par séance avant / après. */
  setsPerSessionBefore: number;
  setsPerSessionAfter: number;
}

export interface FrequencyChangeInput {
  currentSessionsPerWeek: number;
  newSessionsPerWeek: number;
  profile: AthleteProfile;
  /** Jours souhaités ; par défaut ceux du profil. */
  preferredWeekdays?: number[];
  mesocycleWeek: number;
  totalWeeks: number;
  phase: MesocyclePhase;
  overrides?: MuscleSettingOverride[];
}

export interface FrequencyChangeResult {
  previousSplit: SplitDefinition;
  newSplit: SplitDefinition;
  placement: PlacementResult;
  muscleConfigsBefore: MuscleConfigMap;
  muscleConfigsAfter: MuscleConfigMap;
  comparison: MuscleVolumeComparison[];
  /** Volume hebdomadaire total, toutes séries effectives confondues. */
  totalWeeklySetsBefore: number;
  totalWeeklySetsAfter: number;
  /** Le nouveau planning respecte-t-il le plancher de repos de 48 h ? */
  respectsMinRest: boolean;
  warnings: string[];
  summary: string;
}

/** Fréquence maximale soutenable selon le niveau d'expérience. */
const MAX_SUSTAINABLE_FREQUENCY = {
  beginner: 4,
  intermediate: 5,
  advanced: 6,
} as const;

export function planFrequencyChange(input: FrequencyChangeInput): FrequencyChangeResult {
  const {
    currentSessionsPerWeek,
    newSessionsPerWeek,
    profile,
    mesocycleWeek,
    totalWeeks,
    phase,
    overrides,
  } = input;

  const preferredWeekdays = input.preferredWeekdays ?? profile.preferredWeekdays;
  const warnings: string[] = [];

  const previousSplit = getSplit(currentSessionsPerWeek);
  const newSplit = getSplit(newSessionsPerWeek);

  // Placement optimal des jours pour le nouveau split.
  const placement = placeSessions({
    slots: newSplit.slots,
    preferredWeekdays,
    minRestHours: DEFAULT_MIN_REST_HOURS,
  });

  const splitWithPlacement: SplitDefinition = {
    ...newSplit,
    minGapHours: placement.minGapHours,
  };

  // Les cibles de volume ne dépendent pas de la fréquence : c'est précisément
  // ce qui permet de changer de rythme sans perdre le bénéfice du mésocycle.
  const muscleConfigsBefore = buildMuscleConfigs({
    profile: { ...profile, sessionsPerWeek: currentSessionsPerWeek },
    weeklyFrequencyByMuscle: previousSplit.weeklyFrequencyByMuscle,
    mesocycleWeek,
    totalWeeks,
    phase,
    overrides,
  });

  const muscleConfigsAfter = buildMuscleConfigs({
    profile: { ...profile, sessionsPerWeek: newSessionsPerWeek },
    weeklyFrequencyByMuscle: splitWithPlacement.weeklyFrequencyByMuscle,
    mesocycleWeek,
    totalWeeks,
    phase,
    overrides,
  });

  /* ---------------------------------------------------------------------- */
  /*  Comparaison muscle par muscle                                          */
  /* ---------------------------------------------------------------------- */

  const comparison: MuscleVolumeComparison[] = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const muscle of MUSCLE_CODES) {
    const before = muscleConfigsBefore[muscle];
    const after = muscleConfigsAfter[muscle];
    if (!before || !after || after.isExcluded) continue;

    const frequencyBefore = previousSplit.weeklyFrequencyByMuscle[muscle] ?? 0;
    const frequencyAfter = splitWithPlacement.weeklyFrequencyByMuscle[muscle] ?? 0;

    totalBefore += before.weeklyTargetSets;
    totalAfter += after.weeklyTargetSets;

    comparison.push({
      muscle,
      label: MUSCLE_LABELS[muscle],
      weeklyTargetSets: after.weeklyTargetSets,
      frequencyBefore,
      frequencyAfter,
      setsPerSessionBefore: round(before.weeklyTargetSets / Math.max(1, frequencyBefore), 1),
      setsPerSessionAfter: round(after.weeklyTargetSets / Math.max(1, frequencyAfter), 1),
    });

    if (frequencyBefore > 0 && frequencyAfter === 0) {
      warnings.push(
        `${MUSCLE_LABELS[muscle]} n’est plus ciblé directement par le nouveau découpage : il ne recevra que du volume indirect.`,
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Avertissements                                                         */
  /* ---------------------------------------------------------------------- */

  if (!placement.respectsMinRest) {
    warnings.push(
      `Avec ${newSessionsPerWeek} séances sur les jours souhaités, l’écart minimum entre deux sollicitations d’un même muscle tombe à ${Math.round(placement.minGapHours)} h (minimum requis : ${DEFAULT_MIN_REST_HOURS} h). Certaines séances seront automatiquement allégées.`,
    );
  }

  const sustainable = MAX_SUSTAINABLE_FREQUENCY[profile.experienceLevel];
  if (newSessionsPerWeek > sustainable) {
    warnings.push(
      `${newSessionsPerWeek} séances par semaine dépassent la fréquence habituellement soutenable à votre niveau (${sustainable}). Le volume par séance a été réduit en conséquence ; surveillez votre récupération.`,
    );
  }

  if (placement.daysOutsidePreference.length > 0) {
    warnings.push(
      `${placement.daysOutsidePreference.length} séance(s) placée(s) en dehors de vos jours habituels pour préserver les temps de repos.`,
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Résumé                                                                 */
  /* ---------------------------------------------------------------------- */

  const direction = newSessionsPerWeek > currentSessionsPerWeek ? 'réparti sur' : 'concentré sur';
  const summary =
    `Passage de ${currentSessionsPerWeek} à ${newSessionsPerWeek} séances par semaine : ` +
    `${SPLIT_TYPE_LABELS[previousSplit.type]} → ${SPLIT_TYPE_LABELS[splitWithPlacement.type]}. ` +
    `Volume hebdomadaire conservé (${round(totalAfter, 1)} séries effectives), ` +
    `${direction} ${newSessionsPerWeek} séances, ` +
    `écart minimal entre deux sollicitations : ${Math.round(placement.minGapHours)} h.`;

  return {
    previousSplit,
    newSplit: splitWithPlacement,
    placement,
    muscleConfigsBefore,
    muscleConfigsAfter,
    comparison,
    totalWeeklySetsBefore: round(totalBefore, 2),
    totalWeeklySetsAfter: round(totalAfter, 2),
    respectsMinRest: placement.respectsMinRest,
    warnings,
    summary,
  };
}
