import {
  BLOCKING_FATIGUE_STATUSES,
  FATIGUE_BLOCKING_THRESHOLD,
  FATIGUE_THRESHOLDS,
  FATIGUE_WINDOW_DAYS,
  MUSCLE_CODES,
  type ExclusionReason,
  type FatigueStatus,
  type MuscleCode,
} from '@sport/shared';
import type {
  FatigueSnapshot,
  MuscleConfig,
  MuscleConfigMap,
  MuscleFatigueSnapshot,
  StimulusEvent,
} from '../types';
import { addHours, hoursBetween, round } from '../utils/math';
import { computeSystemicFatigue } from './systemic';

/**
 * Décroissance de la fatigue et calcul de l'état de récupération.
 *
 * Modèle : chaque événement de fatigue décroît exponentiellement selon sa
 * propre demi-vie, et la fatigue d'un muscle à l'instant `t` est la somme des
 * contributions résiduelles de tous ses événements.
 *
 *     fatigue(M, t) = Σᵢ stimulusᵢ × 2^(−(t − tᵢ) / demi-vieᵢ)
 *
 * Deux propriétés rendent ce modèle exploitable :
 *
 * 1. **Il est strictement décroissant dans le temps** en l'absence de nouvel
 *    événement — on peut donc résoudre par dichotomie « à quelle heure ce
 *    muscle repasse-t-il sous tel seuil ? ».
 * 2. **Il est additif** — la fatigue de deux séances rapprochées s'accumule,
 *    ce qu'une simple règle « dernière sollicitation + 48 h » ne capte pas.
 */

/** Part restante d'un stimulus après `hours` heures. */
export function decayFactor(hours: number, halfLifeHours: number): number {
  if (hours <= 0) return 1;
  if (halfLifeHours <= 0) return 0;
  return Math.pow(2, -hours / halfLifeHours);
}

/** Fatigue résiduelle d'un ensemble d'événements à un instant donné. */
export function fatigueScoreAt(events: StimulusEvent[], at: Date): number {
  let total = 0;
  for (const event of events) {
    const elapsed = hoursBetween(event.occurredAt, at);
    if (elapsed < 0) continue; // événement futur : ignoré
    total += event.stimulus * decayFactor(elapsed, event.halfLifeHours);
  }
  return total;
}

/** Statut de récupération correspondant à un pourcentage de fatigue. */
export function statusFromPct(pct: number): FatigueStatus {
  if (pct < FATIGUE_THRESHOLDS.fresh) return 'fresh';
  if (pct < FATIGUE_THRESHOLDS.ready) return 'ready';
  if (pct < FATIGUE_THRESHOLDS.recovering) return 'recovering';
  if (pct < FATIGUE_THRESHOLDS.fatigued) return 'fatigued';
  return 'overreached';
}

/**
 * Instant auquel la fatigue repassera sous un seuil donné.
 *
 * Résolu par dichotomie : la fonction étant monotone décroissante, 40
 * itérations suffisent à converger à la seconde près sur une fenêtre de
 * 14 jours. Renvoie `null` si le seuil n'est pas atteint dans la fenêtre —
 * situation qui ne devrait survenir qu'en cas de surmenage sévère.
 */
export function predictTimeBelow(
  events: StimulusEvent[],
  from: Date,
  absoluteThreshold: number,
): Date | null {
  if (fatigueScoreAt(events, from) < absoluteThreshold) return from;

  let low = 0;
  let high = FATIGUE_WINDOW_DAYS * 24;

  if (fatigueScoreAt(events, addHours(from, high)) >= absoluteThreshold) return null;

  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (fatigueScoreAt(events, addHours(from, mid)) < absoluteThreshold) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return addHours(from, high);
}

/** Événements d'un muscle encore significatifs à l'instant considéré. */
function relevantEvents(events: StimulusEvent[], muscle: MuscleCode, at: Date): StimulusEvent[] {
  const cutoff = addHours(at, -FATIGUE_WINDOW_DAYS * 24);
  return events.filter(
    (e) => e.muscle === muscle && e.occurredAt >= cutoff && e.occurredAt <= at,
  );
}

function computeMuscleSnapshot(
  muscle: MuscleCode,
  events: StimulusEvent[],
  config: MuscleConfig,
  at: Date,
  weekStartedAt: Date,
): MuscleFatigueSnapshot {
  const muscleEvents = relevantEvents(events, muscle, at);
  const fatigueScore = fatigueScoreAt(muscleEvents, at);
  const capacity = Math.max(config.capacity, 0.001);
  const fatiguePct = fatigueScore / capacity;
  const status = statusFromPct(fatiguePct);

  // Le volume ne compte que le travail réel : les événements de courbature
  // ajoutent de la fatigue, jamais des séries.
  const trainingVolume = muscleEvents.filter((e) => e.source === 'training');
  const rollingCutoff = addHours(at, -7 * 24);

  const weeklySets = trainingVolume
    .filter((e) => e.occurredAt >= rollingCutoff)
    .reduce((sum, e) => sum + e.effectiveSets, 0);

  const currentWeekSets = trainingVolume
    .filter((e) => e.occurredAt >= weekStartedAt)
    .reduce((sum, e) => sum + e.effectiveSets, 0);

  // Seul le travail *direct* (moteur principal ou secondaire lourd) déclenche
  // le plancher de repos. La participation d'un stabilisateur — les lombaires
  // sur un squat, le haut du dos sur un soulevé de terre — ajoute de la fatigue
  // au score continu mais n'immobilise pas le muscle pendant deux jours.
  const directEvents = muscleEvents.filter((e) => e.source === 'training' && e.isDirectWork);
  const lastStimulusAt = directEvents.reduce<Date | null>(
    (latest, e) => (latest === null || e.occurredAt > latest ? e.occurredAt : latest),
    null,
  );
  const hoursSinceLastStimulus =
    lastStimulusAt === null ? null : hoursBetween(lastStimulusAt, at);

  /* ---------------------------------------------------------------------- */
  /*  Le garde-fou : plancher horaire ET seuil de fatigue                     */
  /* ---------------------------------------------------------------------- */

  // Plancher dur : tant que le repos minimum n'est pas écoulé, le muscle est
  // indisponible quel que soit son score. C'est la garantie 48 h.
  const minRestUntil =
    lastStimulusAt === null ? null : addHours(lastStimulusAt, config.minRestHours);
  const minRestElapsed = minRestUntil === null || at >= minRestUntil;

  // Second verrou : même le repos écoulé, la fatigue accumulée peut suffire à
  // écarter le muscle (par exemple après deux séances rapprochées).
  const fatigueCleared = fatiguePct < FATIGUE_BLOCKING_THRESHOLD;

  const isAvailable = !config.isExcluded && minRestElapsed && fatigueCleared;

  let blockedBy: ExclusionReason | null = null;
  if (config.isExcluded) blockedBy = 'user_excluded';
  else if (!minRestElapsed) blockedBy = 'min_rest_not_elapsed';
  else if (!fatigueCleared) blockedBy = 'fatigue_too_high';

  // La disponibilité est la plus tardive des deux contraintes : le score ne
  // peut que repousser l'échéance du plancher, jamais l'avancer.
  const fatigueClearAt = predictTimeBelow(
    muscleEvents,
    at,
    FATIGUE_BLOCKING_THRESHOLD * capacity,
  );
  let availableAt: Date | null = null;
  if (!isAvailable && !config.isExcluded) {
    const candidates: Date[] = [];
    if (minRestUntil && minRestUntil > at) candidates.push(minRestUntil);
    if (fatigueClearAt && fatigueClearAt > at) candidates.push(fatigueClearAt);
    availableAt =
      candidates.length > 0
        ? new Date(Math.max(...candidates.map((d) => d.getTime())))
        : null;
  }

  // Récupération complète : retour au statut « frais », jamais avant le plancher.
  const freshAt = predictTimeBelow(muscleEvents, at, FATIGUE_THRESHOLDS.fresh * capacity);
  let fullyRecoveredAt: Date | null = null;
  if (freshAt) {
    const floor = minRestUntil ?? at;
    fullyRecoveredAt = freshAt > floor ? freshAt : floor;
    if (fullyRecoveredAt <= at) fullyRecoveredAt = null;
  }

  return {
    muscle,
    fatigueScore: round(fatigueScore),
    fatiguePct: round(fatiguePct),
    status,
    isAvailable,
    blockedBy,
    lastStimulusAt,
    hoursSinceLastStimulus:
      hoursSinceLastStimulus === null ? null : round(hoursSinceLastStimulus, 1),
    availableAt,
    hoursUntilAvailable: availableAt === null ? null : round(hoursBetween(at, availableAt), 1),
    fullyRecoveredAt,
    weeklySets: round(weeklySets, 2),
    currentWeekSets: round(currentWeekSets, 2),
    weeklySetsTarget: round(config.weeklyTargetSets, 2),
    capacity: round(capacity, 3),
  };
}

export interface FatigueSnapshotInput {
  now: Date;
  events: StimulusEvent[];
  muscleConfigs: MuscleConfigMap;
  /** RPE des séances des 7 derniers jours, pour la fatigue systémique. */
  recentSessionRpes?: number[];
  /** Heures de sommeil des 7 derniers jours. */
  recentSleepHours?: number[];
  /** Nombre de jours consécutifs au-dessus du seuil systémique. */
  consecutiveHighFatigueDays?: number;
  /** Séances consécutives sans progression de performance. */
  stalledSessions?: number;
  /**
   * Début de la semaine d'entraînement en cours. Par défaut, une fenêtre
   * glissante de 7 jours — mais le planificateur passe le vrai lundi, sans
   * quoi la dette de volume ne se réinitialiserait jamais.
   */
  weekStartedAt?: Date;
}

/**
 * Photographie complète de l'état de récupération à un instant donné.
 *
 * C'est l'unique porte d'entrée du reste du moteur : le planificateur et le
 * générateur ne lisent jamais les événements bruts, seulement ce cliché.
 */
export function buildFatigueSnapshot(input: FatigueSnapshotInput): FatigueSnapshot {
  const { now, events, muscleConfigs } = input;
  const weekStartedAt = input.weekStartedAt ?? addHours(now, -7 * 24);

  const byMuscle = {} as Record<MuscleCode, MuscleFatigueSnapshot>;
  for (const muscle of MUSCLE_CODES) {
    const config = muscleConfigs[muscle];
    if (!config) continue;
    byMuscle[muscle] = computeMuscleSnapshot(muscle, events, config, now, weekStartedAt);
  }

  const systemic = computeSystemicFatigue({
    byMuscle,
    muscleConfigs,
    recentSessionRpes: input.recentSessionRpes ?? [],
    recentSleepHours: input.recentSleepHours ?? [],
    consecutiveHighFatigueDays: input.consecutiveHighFatigueDays ?? 0,
    stalledSessions: input.stalledSessions ?? 0,
  });

  return { at: now, byMuscle, systemic };
}

/** Muscles disponibles pour du travail lourd à l'instant du cliché. */
export function availableMuscles(snapshot: FatigueSnapshot): MuscleCode[] {
  return (Object.keys(snapshot.byMuscle) as MuscleCode[]).filter(
    (m) => snapshot.byMuscle[m].isAvailable,
  );
}

/** Muscles écartés, avec la raison du blocage. */
export function blockedMuscles(snapshot: FatigueSnapshot): MuscleFatigueSnapshot[] {
  return Object.values(snapshot.byMuscle).filter((m) => !m.isAvailable);
}

/** Le statut interdit-il de programmer ce muscle en travail principal ? */
export function isBlockingStatus(status: FatigueStatus): boolean {
  return BLOCKING_FATIGUE_STATUSES.includes(status);
}
