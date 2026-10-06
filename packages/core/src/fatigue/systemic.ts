import {
  SYSTEMIC_DELOAD_THRESHOLD,
  type MuscleCode,
  type MuscleSizeClass,
  MUSCLE_LABELS,
} from '@sport/shared';
import type {
  MuscleConfigMap,
  MuscleFatigueSnapshot,
  SystemicFatigueSnapshot,
} from '../types';
import { clamp, round } from '../utils/math';

/**
 * Fatigue systémique et détection de la nécessité d'une décharge.
 *
 * La fatigue locale d'un muscle ne raconte qu'une partie de l'histoire :
 * l'organisme accumule aussi une fatigue centrale (système nerveux, sommeil,
 * stress) qui se manifeste par une baisse de performance globale alors même
 * que chaque muscle pris isolément semble récupéré.
 *
 * On l'estime en pondérant la fatigue musculaire par la masse concernée, puis
 * en la corrigeant par les signaux subjectifs disponibles.
 */

/** Poids d'un muscle dans la moyenne : un quadriceps pèse plus qu'un mollet. */
const SIZE_WEIGHT: Record<MuscleSizeClass, number> = {
  large: 3,
  medium: 2,
  small: 1,
};

export interface SystemicInput {
  byMuscle: Record<MuscleCode, MuscleFatigueSnapshot>;
  muscleConfigs: MuscleConfigMap;
  recentSessionRpes: number[];
  recentSleepHours: number[];
  consecutiveHighFatigueDays: number;
  stalledSessions: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeSystemicFatigue(input: SystemicInput): SystemicFatigueSnapshot {
  const {
    byMuscle,
    muscleConfigs,
    recentSessionRpes,
    recentSleepHours,
    consecutiveHighFatigueDays,
    stalledSessions,
  } = input;

  // --- Moyenne de fatigue musculaire pondérée par la masse ------------------
  let weightedSum = 0;
  let weightTotal = 0;
  for (const snapshot of Object.values(byMuscle)) {
    const config = muscleConfigs[snapshot.muscle];
    if (!config || config.isExcluded) continue;
    const weight = SIZE_WEIGHT[config.definition.sizeClass];
    weightedSum += clamp(snapshot.fatiguePct, 0, 1.5) * weight;
    weightTotal += weight;
  }
  const muscularComponent = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // --- Corrections par les signaux subjectifs ------------------------------
  const averageRpe = average(recentSessionRpes);
  const averageSleep = average(recentSleepHours);

  // Un RPE moyen de 8+ sur la semaine signale un entraînement mené trop près
  // de l'échec de façon soutenue.
  let rpePenalty = 0;
  if (averageRpe !== null && averageRpe > 7) {
    rpePenalty = (averageRpe - 7) * 0.06;
  }

  // Le déficit de sommeil est le premier facteur de fatigue centrale.
  let sleepPenalty = 0;
  if (averageSleep !== null && averageSleep < 7) {
    sleepPenalty = (7 - averageSleep) * 0.05;
  }

  const score = clamp(muscularComponent + rpePenalty + sleepPenalty, 0, 1.5);

  /* ---------------------------------------------------------------------- */
  /*  Décision de décharge                                                   */
  /* ---------------------------------------------------------------------- */

  const reasons: string[] = [];

  // Un pic ponctuel de fatigue est normal le lendemain d'une grosse séance.
  // Ce qui justifie une décharge, c'est la persistance sur plusieurs jours.
  const sustainedHighFatigue =
    score >= SYSTEMIC_DELOAD_THRESHOLD && consecutiveHighFatigueDays >= 3;
  if (sustainedHighFatigue) {
    reasons.push(
      `Fatigue générale élevée depuis ${consecutiveHighFatigueDays} jours (${Math.round(score * 100)} %)`,
    );
  }

  // La stagnation de performance est le signal le plus fiable de surmenage.
  const performanceStalled = stalledSessions >= 2;
  if (performanceStalled) {
    reasons.push(`Aucune progression sur les ${stalledSessions} dernières séances`);
  }

  // Un muscle en surmenage franc suffit à justifier une décharge ciblée.
  const overreachedMuscles = Object.values(byMuscle).filter((m) => m.status === 'overreached');
  if (overreachedMuscles.length > 0) {
    const names = overreachedMuscles.map((m) => MUSCLE_LABELS[m.muscle]).join(', ');
    reasons.push(`Surmenage détecté : ${names}`);
  }

  if (averageSleep !== null && averageSleep < 6) {
    reasons.push(`Sommeil moyen de ${averageSleep.toFixed(1)} h : récupération compromise`);
  }

  return {
    score: round(score, 3),
    averageSessionRpe: averageRpe === null ? null : round(averageRpe, 1),
    averageSleepHours: averageSleep === null ? null : round(averageSleep, 1),
    deloadRecommended: sustainedHighFatigue || performanceStalled || overreachedMuscles.length > 0,
    reasons,
  };
}
