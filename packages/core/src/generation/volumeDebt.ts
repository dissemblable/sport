import {
  VOLUME_FACTOR_BY_STATUS,
  MUSCLE_CODES,
  type MuscleCode,
} from '@sport/shared';
import type { FatigueSnapshot, MuscleConfigMap } from '../types';
import { clamp, round } from '../utils/math';

/**
 * Dette de volume : combien de séries chaque muscle doit encore recevoir.
 *
 * C'est le moteur de la sélection d'exercices. Sans cette notion, l'algorithme
 * proposerait la même séance chaque semaine ; avec elle, il compense
 * automatiquement une séance manquée, une baisse de volume liée à la fatigue,
 * ou un changement de fréquence.
 *
 *     dette(M) = cible hebdomadaire − séries effectives des 7 derniers jours
 *
 * La dette est ensuite répartie sur les séances restantes de la semaine, puis
 * plafonnée par le maximum réalisable en une séance et modulée par l'état de
 * récupération : un muscle en cours de récupération reçoit moins, un muscle
 * bloqué ne reçoit rien.
 */

export interface MuscleVolumeTarget {
  muscle: MuscleCode;
  /** Séries manquantes sur la fenêtre hebdomadaire glissante. */
  debt: number;
  /** Séries à programmer sur cette séance précisément. */
  setsThisSession: number;
  /** Plafond appliqué (rendements décroissants ou fatigue). */
  cappedBy: 'none' | 'session_max' | 'fatigue' | 'blocked';
}

export interface VolumeDebtInput {
  snapshot: FatigueSnapshot;
  muscleConfigs: MuscleConfigMap;
  /**
   * Nombre de séances restantes cette semaine qui solliciteront ce muscle,
   * séance en cours comprise. Au minimum 1.
   */
  remainingSessionsByMuscle: Partial<Record<MuscleCode, number>>;
}

export function computeVolumeTargets(
  input: VolumeDebtInput,
): Record<MuscleCode, MuscleVolumeTarget> {
  const { snapshot, muscleConfigs, remainingSessionsByMuscle } = input;

  const targets = {} as Record<MuscleCode, MuscleVolumeTarget>;

  for (const muscle of MUSCLE_CODES) {
    const config = muscleConfigs[muscle];
    const state = snapshot.byMuscle[muscle];

    if (!config || !state) {
      targets[muscle] = { muscle, debt: 0, setsThisSession: 0, cappedBy: 'blocked' };
      continue;
    }

    // La cible porte déjà la réduction de décharge (voir `weeklyTargetSets`) :
    // la réappliquer ici l'annulerait deux fois et viderait la séance.
    // La dette se mesure sur la semaine en cours, pas sur les 7 derniers jours.
    const debt = Math.max(0, config.weeklyTargetSets - state.currentWeekSets);

    if (!state.isAvailable) {
      // Un muscle indisponible garde sa dette — elle sera honorée dès qu'il
      // repassera disponible, ce qui évite qu'une semaine chargée efface
      // définitivement le volume prévu.
      targets[muscle] = { muscle, debt: round(debt, 2), setsThisSession: 0, cappedBy: 'blocked' };
      continue;
    }

    const remaining = Math.max(1, remainingSessionsByMuscle[muscle] ?? 1);
    const perSession = debt / remaining;

    const statusFactor = VOLUME_FACTOR_BY_STATUS[state.status];
    const sessionMax = config.definition.maxSetsPerSession;
    const fatigueCap = sessionMax * statusFactor;

    const capped = clamp(perSession, 0, fatigueCap);

    let cappedBy: MuscleVolumeTarget['cappedBy'] = 'none';
    if (capped < perSession) {
      cappedBy = statusFactor < 1 ? 'fatigue' : 'session_max';
    }

    targets[muscle] = {
      muscle,
      debt: round(debt, 2),
      setsThisSession: round(capped, 2),
      cappedBy,
    };
  }

  return targets;
}

/**
 * Séances restantes dans la semaine pour chaque muscle.
 *
 * Sert à lisser la dette : s'il reste deux séances qui sollicitent les
 * pectoraux, on n'en programme pas tout le volume d'un coup.
 */
export function remainingSessionsForWeek(params: {
  weeklyFrequencyByMuscle: Partial<Record<MuscleCode, number>>;
  /** Séances déjà réalisées ou passées cette semaine. */
  sessionsCompletedThisWeek: number;
  sessionsPerWeek: number;
}): Partial<Record<MuscleCode, number>> {
  const { weeklyFrequencyByMuscle, sessionsCompletedThisWeek, sessionsPerWeek } = params;

  const remainingSessions = Math.max(1, sessionsPerWeek - sessionsCompletedThisWeek);
  const ratio = remainingSessions / Math.max(1, sessionsPerWeek);

  const result: Partial<Record<MuscleCode, number>> = {};
  for (const [muscle, frequency] of Object.entries(weeklyFrequencyByMuscle)) {
    result[muscle as MuscleCode] = Math.max(1, Math.round((frequency ?? 1) * ratio));
  }
  return result;
}
