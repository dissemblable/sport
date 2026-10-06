import {
  buildFatigueSnapshot,
  buildMuscleConfigs,
  phaseForWeek,
  startOfWeek,
  type AthleteProfile,
  type FatigueSnapshot,
  type MuscleConfigMap,
  type StimulusEvent,
} from '@sport/core';
import {
  MUSCLE_LABELS,
  EXCLUSION_REASON_LABELS,
  type MesocyclePhase,
  type MuscleCode,
  type MuscleRecoveryState,
  type SplitDefinition,
} from '@sport/shared';
import {
  muscleFatigueStates,
  recoveryCheckins,
  workoutSessions,
  type Database,
} from '@sport/db';
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import {
  fallbackSplit,
  loadActivePlan,
  loadFatigueEvents,
  loadMuscleIds,
  loadMuscleOverrides,
  loadProfile,
  num,
} from './loaders';

/**
 * Assemblage de l'état de récupération.
 *
 * Ce module est la seule porte d'entrée vers le moteur de fatigue : les routes
 * ne recalculent jamais un snapshot elles-mêmes, ce qui garantit que l'écran de
 * récupération, le générateur de séance et l'aperçu de changement de fréquence
 * voient tous exactement le même état.
 */

export interface AthleteContext {
  userId: string;
  profile: AthleteProfile;
  split: SplitDefinition;
  muscleConfigs: MuscleConfigMap;
  snapshot: FatigueSnapshot;
  events: StimulusEvent[];
  mesocycleWeek: number;
  totalWeeks: number;
  phase: MesocyclePhase;
  at: Date;
}

/**
 * Semaine du mésocycle correspondant à une date, à partir de 1.
 *
 * Au-delà de la durée du bloc, le compteur boucle : un utilisateur qui ne
 * régénère pas son plan enchaîne des cycles identiques plutôt que de sortir du
 * barème de volume et de se retrouver sans prescription.
 */
export function mesocycleWeekFor(startDate: string, at: Date, totalWeeks: number): number {
  const start = startOfWeek(new Date(`${startDate}T00:00:00.000Z`));
  const elapsedWeeks = Math.floor(
    (startOfWeek(at).getTime() - start.getTime()) / (7 * 86_400_000),
  );

  if (elapsedWeeks < 0) return 1;
  return (elapsedWeeks % totalWeeks) + 1;
}

/**
 * Construit l'état complet de l'athlète à un instant donné.
 *
 * `at` est toujours explicite : cela permet aux aperçus (« et si je
 * m'entraînais demain matin ? ») et aux tests de simuler n'importe quel moment
 * sans manipuler l'horloge système.
 */
export async function buildAthleteContext(
  db: Database,
  userId: string,
  at: Date,
): Promise<AthleteContext> {
  const { profile } = await loadProfile(db, userId);
  const plan = await loadActivePlan(db, userId);

  const split = plan?.split ?? fallbackSplit(profile.sessionsPerWeek);
  const totalWeeks = plan?.durationWeeks ?? 5;
  const mesocycleWeek = plan ? mesocycleWeekFor(plan.mesocycleStartDate, at, totalWeeks) : 1;
  const phase = phaseForWeek(mesocycleWeek, totalWeeks);

  const overrides = await loadMuscleOverrides(db, userId);
  const muscleConfigs = buildMuscleConfigs({
    profile,
    weeklyFrequencyByMuscle: split.weeklyFrequencyByMuscle,
    mesocycleWeek,
    totalWeeks,
    phase,
    overrides,
  });

  const events = await loadFatigueEvents(db, userId, at);
  const { rpes, sleepHours } = await loadRecentSubjectiveSignals(db, userId, at);

  const snapshot = buildFatigueSnapshot({
    now: at,
    events,
    muscleConfigs,
    weekStartedAt: startOfWeek(at),
    recentSessionRpes: rpes,
    recentSleepHours: sleepHours,
    consecutiveHighFatigueDays: 0,
    stalledSessions: 0,
  });

  return {
    userId,
    profile,
    split,
    muscleConfigs,
    snapshot,
    events,
    mesocycleWeek,
    totalWeeks,
    phase,
    at,
  };
}

/** RPE de séance et heures de sommeil des 7 derniers jours. */
async function loadRecentSubjectiveSignals(db: Database, userId: string, at: Date) {
  const since = new Date(at.getTime() - 7 * 86_400_000);

  const rpeRows = await db
    .select({ rpe: workoutSessions.sessionRpe })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        gte(workoutSessions.startedAt, since),
        isNotNull(workoutSessions.sessionRpe),
      ),
    );

  const sleepRows = await db
    .select({ sleepHours: recoveryCheckins.sleepHours })
    .from(recoveryCheckins)
    .where(and(eq(recoveryCheckins.userId, userId), gte(recoveryCheckins.checkedAt, since)));

  return {
    rpes: rpeRows.map((r) => r.rpe).filter((v): v is number => v !== null),
    sleepHours: sleepRows.map((r) => num(r.sleepHours)).filter((v): v is number => v !== null),
  };
}

/* -------------------------------------------------------------------------- */
/*                          Projection du cache                               */
/* -------------------------------------------------------------------------- */

/**
 * Écrit le cache d'état de récupération.
 *
 * Le cache n'est jamais lu par le moteur — il recalcule toujours depuis le
 * journal. Il sert aux lectures rapides du frontend et aux futurs agrégats SQL.
 * Le régénérer intégralement à chaque écriture est sans risque : 17 lignes.
 */
export async function persistFatigueCache(
  db: Database,
  userId: string,
  snapshot: FatigueSnapshot,
): Promise<void> {
  const muscleIds = await loadMuscleIds(db);

  const rows = Object.values(snapshot.byMuscle).flatMap((state) => {
    const muscleId = muscleIds.get(state.muscle);
    if (muscleId === undefined) return [];
    return [
      {
        userId,
        muscleId,
        fatigueScore: state.fatigueScore.toString(),
        fatiguePct: state.fatiguePct.toString(),
        status: state.status,
        lastStimulusAt: state.lastStimulusAt,
        availableAt: state.availableAt,
        fullyRecoveredAt: state.fullyRecoveredAt,
        weeklySets: state.weeklySets.toString(),
        currentWeekSets: state.currentWeekSets.toString(),
        weeklySetsTarget: state.weeklySetsTarget.toString(),
        computedAt: snapshot.at,
      },
    ];
  });

  if (rows.length === 0) return;

  await db
    .insert(muscleFatigueStates)
    .values(rows)
    .onConflictDoUpdate({
      target: [muscleFatigueStates.userId, muscleFatigueStates.muscleId],
      set: {
        fatigueScore: sql`excluded.fatigue_score`,
        fatiguePct: sql`excluded.fatigue_pct`,
        status: sql`excluded.status`,
        lastStimulusAt: sql`excluded.last_stimulus_at`,
        availableAt: sql`excluded.available_at`,
        fullyRecoveredAt: sql`excluded.fully_recovered_at`,
        weeklySets: sql`excluded.weekly_sets`,
        currentWeekSets: sql`excluded.current_week_sets`,
        weeklySetsTarget: sql`excluded.weekly_sets_target`,
        computedAt: sql`excluded.computed_at`,
      },
    });
}

/* -------------------------------------------------------------------------- */
/*                          Présentation pour l'API                           */
/* -------------------------------------------------------------------------- */

/** Convertit le cliché du moteur en réponse d'API sérialisable. */
export function toRecoveryResponse(snapshot: FatigueSnapshot): MuscleRecoveryState[] {
  return Object.values(snapshot.byMuscle)
    .map((state) => ({
      muscle: state.muscle,
      label: MUSCLE_LABELS[state.muscle],
      fatigueScore: state.fatigueScore,
      fatiguePct: state.fatiguePct,
      status: state.status,
      isAvailable: state.isAvailable,
      blockedBy: state.blockedBy,
      lastStimulusAt: state.lastStimulusAt?.toISOString() ?? null,
      hoursSinceLastStimulus: state.hoursSinceLastStimulus,
      availableAt: state.availableAt?.toISOString() ?? null,
      hoursUntilAvailable: state.hoursUntilAvailable,
      weeklySets: state.weeklySets,
      weeklySetsTarget: state.weeklySetsTarget,
    }))
    .sort((a, b) => b.fatiguePct - a.fatiguePct);
}

/** Phrase expliquant pourquoi un muscle est indisponible. */
export function explainBlock(state: MuscleRecoveryState): string | null {
  if (state.isAvailable || !state.blockedBy) return null;
  const reason = EXCLUSION_REASON_LABELS[state.blockedBy];
  if (state.hoursUntilAvailable == null) return reason;
  return `${reason} — disponible dans ${Math.round(state.hoursUntilAvailable)} h`;
}

/** Dernier check-in enregistré, pour moduler la récupération d'une séance. */
export async function loadLatestCheckin(db: Database, userId: string, at: Date) {
  const since = new Date(at.getTime() - 36 * 3_600_000);
  const [row] = await db
    .select()
    .from(recoveryCheckins)
    .where(and(eq(recoveryCheckins.userId, userId), gte(recoveryCheckins.checkedAt, since)))
    .orderBy(desc(recoveryCheckins.checkedAt))
    .limit(1);

  if (!row) return null;

  return {
    sleepHours: num(row.sleepHours),
    sleepQuality: row.sleepQuality,
    stress: row.stress,
    energy: row.energy,
  };
}

export type { MuscleCode };
