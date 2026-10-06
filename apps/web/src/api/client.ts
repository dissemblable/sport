import type {
  EquipmentCode,
  ExclusionReason,
  FatigueStatus,
  MesocyclePhase,
  MovementPattern,
  MuscleCode,
  MuscleRole,
  SessionBlock,
  SessionStatus,
  SplitType,
  SystemicFatigueState,
} from '@sport/shared';

/**
 * Client HTTP de l'API.
 *
 * Les appels passent par `/api` en relatif : Vite proxifie en développement et
 * la même application servie derrière un reverse-proxy fonctionne sans
 * reconfiguration.
 *
 * Les erreurs de l'API suivent toutes la même forme ; elles sont converties en
 * `ApiClientError` pour que l'interface puisse afficher le message français
 * renvoyé par le serveur plutôt qu'un « Failed to fetch » générique.
 *
 * Derrière le SSO, une session expirée se traduit par une redirection de nginx
 * vers le portail de connexion. Suivie par `fetch`, elle échouerait (autre
 * origine, réponse HTML) : elle est interceptée, et la page rechargée passe
 * alors par le portail avant de revenir ici.
 */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (response.type === 'opaqueredirect') {
    reloadForLogin();
    throw new ApiClientError(
      401,
      'session_expired',
      'Session expirée : redirection vers la page de connexion…',
    );
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiClientError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Une erreur est survenue.',
      error?.details,
    );
  }

  return payload as T;
}

/**
 * Recharge la page pour repasser par le portail de connexion.
 *
 * Plusieurs requêtes échouent en même temps à l'expiration de la session, et
 * une redirection persistante (configuration nginx erronée, cookie refusé)
 * provoquerait une boucle : un seul rechargement par fenêtre de 30 secondes.
 */
function reloadForLogin() {
  const key = 'sso-reload-at';
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 30_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Stockage indisponible (navigation privée stricte) : on recharge quand même.
  }
  window.location.reload();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/* -------------------------------------------------------------------------- */
/*                       Formes de réponse de l'API                           */
/* -------------------------------------------------------------------------- */

export interface MuscleRecoveryDto {
  muscle: MuscleCode;
  label: string;
  fatigueScore: number;
  fatiguePct: number;
  status: FatigueStatus;
  statusLabel: string;
  statusDescription: string;
  isAvailable: boolean;
  blockedBy: ExclusionReason | null;
  blockedExplanation: string | null;
  lastStimulusAt: string | null;
  hoursSinceLastStimulus: number | null;
  availableAt: string | null;
  hoursUntilAvailable: number | null;
  weeklySets: number;
  weeklySetsTarget: number;
}

export interface RecoveryStateDto {
  at: string;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  available: MuscleCode[];
  blocked: MuscleCode[];
  muscles: MuscleRecoveryDto[];
  systemic: SystemicFatigueState;
}

export interface PlanSlotDto {
  index: number;
  label: string;
  targetMuscles: MuscleCode[];
  requiredPatterns: MovementPattern[];
}

export interface UpcomingSessionDto {
  id: string;
  scheduledDate: string;
  slotIndex: number;
  slotLabel: string;
  status: SessionStatus;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  estimatedDurationMinutes: number;
  muscles: { muscle: MuscleCode; plannedSets: number }[];
}

export interface CurrentPlanDto {
  plan: {
    id: string;
    version: number;
    mesocycleId: string;
    sessionsPerWeek: number;
    splitType: SplitType;
    splitLabel: string;
    weekdays: number[];
    minGapHours: number;
    slots: PlanSlotDto[];
    weeklyFrequencyByMuscle: Partial<Record<MuscleCode, number>>;
    mesocycleStartDate: string;
    durationWeeks: number;
  } | null;
  currentWeek?: number;
  phase?: MesocyclePhase;
  upcomingSessions?: UpcomingSessionDto[];
  message?: string;
}

export interface PrescribedExerciseDto {
  id?: string;
  exerciseId: number;
  slug: string | null;
  name: string;
  block: SessionBlock;
  blockLabel: string;
  position?: number;
  targetSets: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number;
  restSeconds: number;
  prescription?: {
    loadKg: number | null;
    bandLevel: string | null;
    tempo: string | null;
    perSide: boolean;
    progressionNote: string | null;
  };
  loadKg?: number | null;
  bandLevel?: string | null;
  perSide?: boolean;
  progressionNote?: string | null;
  rationale: string | null;
  executionCues: string[];
  setupNotes?: string | null;
  muscles?: { muscle: MuscleCode; label: string; role: MuscleRole; contribution: number }[];
}

export interface GenerationRationaleDto {
  generatedAt: string;
  splitSlotLabel: string;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  targetedMuscles: MuscleCode[];
  excludedMuscles: {
    muscle: MuscleCode;
    label: string;
    reason: ExclusionReason;
    reasonLabel: string;
    availableAt: string | null;
    hoursUntilAvailable: number | null;
  }[];
  plannedSetsByMuscle: Partial<Record<MuscleCode, number>>;
  remainingDebtByMuscle: Partial<Record<MuscleCode, number>>;
  coveredPatterns: MovementPattern[];
  isFallbackSession: boolean;
  warnings: string[];
}

export interface SessionDetailDto {
  id: string;
  planId: string;
  scheduledDate: string;
  slotIndex: number;
  slotLabel: string;
  status: SessionStatus;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  estimatedDurationMinutes: number;
  rationale: GenerationRationaleDto | null;
  exercises: PrescribedExerciseDto[];
  muscles?: { muscle: MuscleCode; label: string; plannedSets: number }[];
}

export interface PreviewSessionDto {
  at: string;
  persisted: false;
  slotIndex: number;
  slotLabel: string;
  estimatedDurationMinutes: number;
  exercises: PrescribedExerciseDto[];
  report: GenerationRationaleDto;
  excludedExplanations: string[];
}

export interface FrequencyImpactDto {
  applied: boolean;
  planId: string;
  version: number;
  summary: string;
  warnings: string[];
  respectsMinRest: boolean;
  previousSplit: { type: SplitType; label: string; sessionsPerWeek: number };
  newSplit: { type: SplitType; label: string; sessionsPerWeek: number; slots: PlanSlotDto[] };
  weekdays: number[];
  minGapHours: number;
  totalWeeklySetsBefore: number;
  totalWeeklySetsAfter: number;
  comparison: {
    muscle: MuscleCode;
    label: string;
    weeklyTargetSets: number;
    frequencyBefore: number;
    frequencyAfter: number;
    setsPerSessionBefore: number;
    setsPerSessionAfter: number;
  }[];
}

export interface ExerciseListItemDto {
  id: number;
  slug: string;
  name: string;
  pattern: MovementPattern;
  patternLabel: string;
  mechanic: 'compound' | 'isolation';
  mechanicLabel: string;
  difficulty: number;
  isUnilateral: boolean;
  systemicLoad: number;
  equipment: { code: EquipmentCode; label: string }[];
  isAvailable: boolean;
  muscles: {
    muscle: MuscleCode;
    label: string;
    role: MuscleRole;
    roleLabel: string;
    contribution: number;
  }[];
  defaultRepMin: number;
  defaultRepMax: number;
  defaultRestSeconds: number;
  progressionFamily: string | null;
  progressionRank: number;
  setupNotes: string | null;
  executionCues: string[];
}

export interface ActiveWorkoutDto {
  id: string;
  plannedSessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  sessionRpe: number | null;
  notes: string | null;
  isAdHoc: boolean;
  sets: {
    id: string;
    exerciseId: number;
    exerciseName: string | null;
    setIndex: number;
    isWarmup: boolean;
    reps: number | null;
    loadKg: number | null;
    bandLevel: string | null;
    rir: number | null;
    toFailure: boolean;
    durationSeconds: number | null;
    performedAt: string;
  }[];
}

export interface MeDto {
  authMode: 'local' | 'forward-auth';
  username: string | null;
  displayName: string | null;
  email: string | null;
  groups: string[];
  logoutUrl: string | null;
}

export interface ProfileDto {
  userId: string;
  displayName: string;
  birthYear: number | null;
  sex: 'male' | 'female' | 'unspecified';
  heightCm: number | null;
  bodyWeightKg: number | null;
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
  primaryGoal: 'hypertrophy' | 'strength' | 'recomposition' | 'maintenance';
  sessionsPerWeek: number;
  sessionDurationMinutes: number;
  preferredWeekdays: number[];
  deloadEveryNWeeks: number;
  equipment: {
    owned: EquipmentCode[];
    dumbbells: { availableWeightsKg: number[]; pairCount: number; incrementKg: number } | null;
    bands: { levels: { name: string; approxKg: number }[] } | null;
    pullUpBarCanAddWeight: boolean;
  };
  muscleSettings: {
    muscle: MuscleCode;
    label: string;
    priority: number;
    minRestHoursOverride: number | null;
    weeklySetsOverride: number | null;
    isExcluded: boolean;
  }[];
}

export interface VolumeStatsDto {
  from: string;
  weeks: number;
  currentWeekStart: string;
  points: {
    weekStart: string;
    muscle: MuscleCode;
    label: string;
    effectiveSets: number;
    mev: number;
    mav: number;
    mrv: number;
    target: number;
  }[];
}

export interface SummaryDto {
  at: string;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  totalWeeklySets: number;
  totalWeeklyTarget: number;
  availableMuscles: number;
  blockedMuscles: number;
  systemic: SystemicFatigueState;
  underTrained: { muscle: MuscleCode; label: string; weeklySets: number; mev: number }[];
  overReached: { muscle: MuscleCode; label: string; weeklySets: number; mrv: number }[];
}
