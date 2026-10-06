import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCheckinInput, LogSetInput } from '@sport/shared';
import {
  api,
  type ActiveWorkoutDto,
  type CurrentPlanDto,
  type ExerciseListItemDto,
  type FrequencyImpactDto,
  type MeDto,
  type PreviewSessionDto,
  type ProfileDto,
  type RecoveryStateDto,
  type SessionDetailDto,
  type SummaryDto,
  type VolumeStatsDto,
} from './client';

/**
 * Accès aux données via TanStack Query.
 *
 * Une règle structure tout ce fichier : **toute mutation qui modifie
 * l'entraînement invalide l'état de récupération.** Enregistrer une série,
 * clôturer une séance ou déclarer des courbatures change immédiatement ce que
 * l'utilisateur peut faire ensuite ; afficher un état périmé le conduirait à
 * s'entraîner sur un muscle que l'application considère déjà comme bloqué.
 */

export const queryKeys = {
  me: ['me'] as const,
  profile: ['profile'] as const,
  recovery: ['recovery'] as const,
  systemic: ['recovery', 'systemic'] as const,
  timeline: (days: number) => ['recovery', 'timeline', days] as const,
  plan: ['plan'] as const,
  planVersions: ['plan', 'versions'] as const,
  sessions: (from?: string, to?: string) => ['sessions', from, to] as const,
  session: (id: string) => ['sessions', id] as const,
  exercises: (filters: string) => ['exercises', filters] as const,
  exercise: (slug: string) => ['exercises', 'detail', slug] as const,
  activeWorkout: ['workouts', 'active'] as const,
  volume: (weeks: number) => ['stats', 'volume', weeks] as const,
  summary: ['stats', 'summary'] as const,
};

/** Tout ce qui dépend de l'état de fatigue. */
const RECOVERY_DEPENDENT = [['recovery'], ['plan'], ['sessions'], ['stats']];

function useInvalidateRecovery() {
  const client = useQueryClient();
  return () => {
    for (const key of RECOVERY_DEPENDENT) {
      void client.invalidateQueries({ queryKey: key });
    }
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Lectures                                  */
/* -------------------------------------------------------------------------- */

/** Compte SSO de la session — constant pendant toute la visite. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<MeDto>('/me'),
    staleTime: Infinity,
  });
}

export function useProfile() {
  return useQuery({ queryKey: queryKeys.profile, queryFn: () => api.get<ProfileDto>('/profile') });
}

export function useRecoveryState() {
  return useQuery({
    queryKey: queryKeys.recovery,
    queryFn: () => api.get<RecoveryStateDto>('/recovery/state'),
    // La récupération évolue en continu : une minute de fraîcheur suffit à
    // éviter des rechargements inutiles sans jamais afficher un état trompeur.
    staleTime: 60_000,
  });
}

export function useCurrentPlan() {
  return useQuery({
    queryKey: queryKeys.plan,
    queryFn: () => api.get<CurrentPlanDto>('/plan/current'),
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.session(id ?? ''),
    queryFn: () => api.get<SessionDetailDto>(`/sessions/${id}`),
    enabled: Boolean(id),
  });
}

export function useSessions(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  return useQuery({
    queryKey: queryKeys.sessions(from, to),
    queryFn: () => api.get<SessionDetailDto[]>(`/sessions?${params.toString()}`),
  });
}

export function useExercises(filters: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();

  return useQuery({
    queryKey: queryKeys.exercises(query),
    queryFn: () =>
      api.get<{ total: number; items: ExerciseListItemDto[] }>(`/exercises?${query}`),
    // Le catalogue est immuable : inutile de le recharger.
    staleTime: Infinity,
  });
}

export function useActiveWorkout() {
  return useQuery({
    queryKey: queryKeys.activeWorkout,
    queryFn: () => api.get<{ active: ActiveWorkoutDto | null }>('/workouts/active'),
  });
}

export function useVolumeStats(weeks: number) {
  return useQuery({
    queryKey: queryKeys.volume(weeks),
    queryFn: () => api.get<VolumeStatsDto>(`/stats/volume?weeks=${weeks}`),
  });
}

export function useSummary() {
  return useQuery({ queryKey: queryKeys.summary, queryFn: () => api.get<SummaryDto>('/stats/summary') });
}

/* -------------------------------------------------------------------------- */
/*                                 Mutations                                  */
/* -------------------------------------------------------------------------- */

export function useGeneratePlan() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: (body: { sessionsPerWeek?: number; durationWeeks?: number; restart?: boolean }) =>
      api.post<{ message: string; minGapHours: number }>('/plan/generate', body),
    onSuccess: invalidate,
  });
}

/** Aperçu du changement de fréquence — n'écrit rien en base. */
export function usePreviewFrequency() {
  return useMutation({
    mutationFn: (sessionsPerWeek: number) =>
      api.patch<FrequencyImpactDto>('/plan/frequency', { sessionsPerWeek, preview: true }),
  });
}

export function useApplyFrequency() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: (body: { sessionsPerWeek: number; reason?: string }) =>
      api.patch<FrequencyImpactDto>('/plan/frequency', { ...body, preview: false }),
    onSuccess: invalidate,
  });
}

export function usePreviewSession() {
  return useMutation({
    mutationFn: (body: { durationMinutes?: number }) =>
      api.post<PreviewSessionDto>('/sessions/preview', body),
  });
}

export function useRegenerateSession() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ session: SessionDetailDto }>(`/sessions/${id}/regenerate`),
    onSuccess: invalidate,
  });
}

export function useSkipSession() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/sessions/${id}/skip`),
    onSuccess: invalidate,
  });
}

export function useMoveSession() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: (input: { id: string; scheduledDate: string; force?: boolean }) =>
      api.post<{ moved: boolean; message: string }>(`/sessions/${input.id}/move`, {
        scheduledDate: input.scheduledDate,
        force: input.force ?? false,
      }),
    onSuccess: invalidate,
  });
}

export function useStartWorkout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (plannedSessionId: string | null) =>
      api.post<{ id: string; resumed: boolean }>('/workouts/start', { plannedSessionId }),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.activeWorkout }),
  });
}

export function useLogSet(workoutId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LogSetInput) => api.post(`/workouts/${workoutId}/sets`, input),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.activeWorkout }),
  });
}

export function useDeleteSet(workoutId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (setId: string) => api.delete(`/workouts/${workoutId}/sets/${setId}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.activeWorkout }),
  });
}

export interface FinishWorkoutResponse {
  message: string;
  workingSets: number;
  fatigueEvents: number;
  progressionUpdates: { exerciseId: number; exerciseName: string | null; note: string }[];
  newRecords: { exerciseId: number; exerciseName: string | null; type: string; value: number }[];
}

export function useFinishWorkout(workoutId: string | undefined) {
  const invalidate = useInvalidateRecovery();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: { sessionRpe: number | null; notes?: string | null }) =>
      api.post<FinishWorkoutResponse>(`/workouts/${workoutId}/finish`, body),
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: queryKeys.activeWorkout });
    },
  });
}

export function useCheckin() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: (body: Partial<CreateCheckinInput>) =>
      api.post<{ message: string; fatigueEventsCreated: number }>('/recovery/checkin', body),
    onSuccess: invalidate,
  });
}

export function useUpdateProfile() {
  const invalidate = useInvalidateRecovery();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/profile', body),
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdateEquipment() {
  const invalidate = useInvalidateRecovery();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (items: { equipment: string; details: unknown }[]) =>
      api.put('/profile/equipment', { items }),
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdateMuscleSettings() {
  const invalidate = useInvalidateRecovery();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      settings: {
        muscle: string;
        priority: number;
        minRestHoursOverride: number | null;
        weeklySetsOverride: number | null;
        isExcluded: boolean;
      }[],
    ) => api.put('/profile/muscles', { settings }),
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}
