import {
  DELOAD_VOLUME_FACTOR,
  MUSCLE_CODES,
  VOLUME_MULTIPLIER_BY_LEVEL,
  type ExperienceLevel,
  type MesocyclePhase,
  type MuscleCode,
  type MuscleDefinition,
} from '@sport/shared';
import { MUSCLE_BY_CODE } from './catalog/muscles';
import type { AthleteProfile, MuscleConfigMap, MuscleSettingOverride } from './types';
import { clamp, round } from './utils/math';

/**
 * Calcul des paramètres effectifs de chaque muscle.
 *
 * Deux grandeurs sont dérivées ici, et elles ne servent pas au même usage :
 *
 * - **La cible de volume hebdomadaire** varie d'une semaine à l'autre : elle
 *   monte progressivement du MEV vers le MAV au fil du mésocycle, puis chute
 *   pendant la décharge. C'est elle qui pilote la dette de volume.
 *
 * - **La capacité** est au contraire une référence *stable* : la charge de
 *   fatigue d'une séance pleine au volume de croisière. Si elle variait chaque
 *   semaine, un même travail produirait un statut de récupération différent
 *   selon la semaine du mésocycle, ce qui rendrait les seuils incompréhensibles
 *   pour l'utilisateur.
 */

/**
 * Cible de volume hebdomadaire, en séries effectives.
 *
 * Progression linéaire du MEV vers le MAV sur les semaines d'accumulation :
 * commencer d'emblée au volume maximal ne laisse aucune marge de progression
 * et amène au surmenage avant la fin du cycle.
 */
export function weeklyTargetSets(params: {
  definition: MuscleDefinition;
  mesocycleWeek: number;
  totalWeeks: number;
  phase: MesocyclePhase;
  experienceLevel: ExperienceLevel;
  priority: number;
}): number {
  const { definition, mesocycleWeek, totalWeeks, phase, experienceLevel, priority } = params;
  const levelMultiplier = VOLUME_MULTIPLIER_BY_LEVEL[experienceLevel];

  if (phase === 'deload') {
    return round(definition.weeklyMev * DELOAD_VOLUME_FACTOR * levelMultiplier * priority, 2);
  }

  // La dernière semaine du mésocycle est une décharge : la rampe s'étale donc
  // sur `totalWeeks - 1` semaines d'accumulation.
  const accumulationWeeks = Math.max(1, totalWeeks - 1);
  const progress =
    accumulationWeeks <= 1 ? 1 : clamp((mesocycleWeek - 1) / (accumulationWeeks - 1), 0, 1);

  const base = definition.weeklyMev + progress * (definition.weeklyMav - definition.weeklyMev);
  const adjusted = base * levelMultiplier * priority;

  return round(clamp(adjusted, definition.weeklyMev * 0.5, definition.weeklyMrv), 2);
}

/**
 * Charge de fatigue correspondant à une séance pleine — dénominateur du
 * pourcentage de fatigue.
 *
 * Calibrage : une séance au volume de croisière menée à 1–2 répétitions de
 * l'échec produit une fatigue d'environ 85–90 % de la capacité, soit le statut
 * « fatigué ». Le muscle repasse alors sous le seuil de blocage aux alentours
 * de 48 h et revient au statut « frais » avant 72 h — précisément la fenêtre
 * de récupération visée.
 */
export function sessionCapacity(params: {
  definition: MuscleDefinition;
  experienceLevel: ExperienceLevel;
  priority: number;
  weeklyFrequency: number;
}): number {
  const { definition, experienceLevel, priority, weeklyFrequency } = params;
  const levelMultiplier = VOLUME_MULTIPLIER_BY_LEVEL[experienceLevel];
  const perSession =
    (definition.weeklyMav * levelMultiplier * priority) / Math.max(1, weeklyFrequency);

  return round(Math.max(perSession, 1), 3);
}

export interface BuildMuscleConfigsInput {
  profile: AthleteProfile;
  /** Fréquence de sollicitation induite par le split retenu. */
  weeklyFrequencyByMuscle: Partial<Record<MuscleCode, number>>;
  mesocycleWeek: number;
  totalWeeks: number;
  phase: MesocyclePhase;
  overrides?: MuscleSettingOverride[];
}

export function buildMuscleConfigs(input: BuildMuscleConfigsInput): MuscleConfigMap {
  const { profile, weeklyFrequencyByMuscle, mesocycleWeek, totalWeeks, phase } = input;

  const overrideByMuscle = new Map<MuscleCode, MuscleSettingOverride>(
    (input.overrides ?? []).map((o) => [o.muscle, o]),
  );

  const configs = {} as MuscleConfigMap;

  for (const muscle of MUSCLE_CODES) {
    const definition = MUSCLE_BY_CODE[muscle];
    const override = overrideByMuscle.get(muscle);

    const priority = clamp(override?.priority ?? 1, 0.5, 2);

    // Un muscle absent du split reçoit tout de même du volume indirect ; on le
    // traite comme sollicité une fois par semaine pour ne pas fausser sa capacité.
    const weeklyFrequency = Math.max(1, weeklyFrequencyByMuscle[muscle] ?? 1);

    const computedTarget = weeklyTargetSets({
      definition,
      mesocycleWeek,
      totalWeeks,
      phase,
      experienceLevel: profile.experienceLevel,
      priority,
    });

    configs[muscle] = {
      definition,
      priority,
      // Le plancher personnalisé ne peut qu'allonger le repos, jamais le
      // raccourcir en dessous de la valeur du référentiel.
      minRestHours: Math.max(
        override?.minRestHoursOverride ?? definition.minRestHours,
        definition.minRestHours,
      ),
      weeklyTargetSets: override?.weeklySetsOverride ?? computedTarget,
      weeklyFrequency,
      capacity: sessionCapacity({
        definition,
        experienceLevel: profile.experienceLevel,
        priority,
        weeklyFrequency,
      }),
      isExcluded: override?.isExcluded ?? false,
    };
  }

  return configs;
}
