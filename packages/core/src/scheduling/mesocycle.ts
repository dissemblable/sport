import {
  DEFAULT_MESOCYCLE_WEEKS,
  DEFAULT_MIN_REST_HOURS,
  type MesocyclePhase,
  type SplitDefinition,
} from '@sport/shared';
import type { AthleteProfile } from '../types';
import { addDays, weekdayIndex } from '../utils/math';
import { placeSessions, type PlacementResult } from './placement';
import { getSplit } from './split';

/**
 * Construction du calendrier d'un mésocycle.
 *
 * Un mésocycle est un bloc de progression : le volume monte semaine après
 * semaine et le RIR descend, jusqu'à une semaine de décharge qui permet à la
 * fatigue accumulée de retomber. Sans cette structure, l'entraînement finit
 * mécaniquement par buter sur le volume récupérable maximal.
 */

export interface ScheduledSession {
  /** Date de la séance, à minuit UTC. */
  date: Date;
  /** Semaine du mésocycle, à partir de 1. */
  week: number;
  phase: MesocyclePhase;
  slotIndex: number;
  slotLabel: string;
}

export interface MesocycleScheduleInput {
  startDate: Date;
  weeks?: number;
  profile: AthleteProfile;
  preferredWeekdays?: number[];
  sessionsPerWeek?: number;
}

export interface MesocycleSchedule {
  split: SplitDefinition;
  placement: PlacementResult;
  sessions: ScheduledSession[];
  weeks: number;
  respectsMinRest: boolean;
  warnings: string[];
}

/** Lundi de la semaine contenant la date donnée (repère UTC). */
export function startOfWeek(date: Date): Date {
  const monday = addDays(date, -weekdayIndex(date));
  return new Date(
    Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0, 0),
  );
}

/**
 * Phase d'une semaine donnée.
 *
 * La dernière semaine est toujours une décharge ; la seconde moitié du bloc
 * passe en intensification (volume stable, RIR plus bas) pour éviter que le
 * volume seul ne finisse par dépasser la capacité de récupération.
 */
export function phaseForWeek(week: number, totalWeeks: number): MesocyclePhase {
  if (week >= totalWeeks) return 'deload';
  if (week > Math.ceil((totalWeeks - 1) / 2)) return 'intensification';
  return 'accumulation';
}

export function buildMesocycleSchedule(input: MesocycleScheduleInput): MesocycleSchedule {
  const { startDate, profile } = input;
  const weeks = input.weeks ?? DEFAULT_MESOCYCLE_WEEKS;
  const sessionsPerWeek = input.sessionsPerWeek ?? profile.sessionsPerWeek;
  const preferredWeekdays = input.preferredWeekdays ?? profile.preferredWeekdays;

  const split = getSplit(sessionsPerWeek);
  const placement = placeSessions({
    slots: split.slots,
    preferredWeekdays,
    minRestHours: DEFAULT_MIN_REST_HOURS,
  });

  const warnings: string[] = [];
  if (!placement.respectsMinRest) {
    warnings.push(
      `L’écart minimal entre deux sollicitations d’un même muscle est de ${Math.round(placement.minGapHours)} h, sous le plancher de ${DEFAULT_MIN_REST_HOURS} h. Les séances concernées seront allégées automatiquement.`,
    );
  }

  const weekStart = startOfWeek(startDate);
  const sessions: ScheduledSession[] = [];

  for (let weekOffset = 0; weekOffset < weeks; weekOffset += 1) {
    const week = weekOffset + 1;
    const phase = phaseForWeek(week, weeks);

    for (const placed of placement.placements) {
      const date = addDays(weekStart, weekOffset * 7 + placed.weekday);

      // Les séances antérieures à la date de départ sont ignorées : un plan
      // créé un mercredi ne doit pas afficher une séance « manquée » le lundi.
      if (date < startOfWeek(startDate) || (weekOffset === 0 && date < truncate(startDate))) {
        continue;
      }

      sessions.push({
        date,
        week,
        phase,
        slotIndex: placed.slotIndex,
        slotLabel: placed.slotLabel,
      });
    }
  }

  sessions.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    split: { ...split, minGapHours: placement.minGapHours },
    placement,
    sessions,
    weeks,
    respectsMinRest: placement.respectsMinRest,
    warnings,
  };
}

/** Minuit UTC du jour de la date donnée. */
function truncate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}
