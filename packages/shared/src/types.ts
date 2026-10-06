import type {
  EquipmentCode,
  ExclusionReason,
  ExercisePreference,
  ExperienceLevel,
  FatigueSource,
  FatigueStatus,
  Mechanic,
  MesocyclePhase,
  MovementPattern,
  MuscleCode,
  MuscleRegion,
  MuscleRole,
  MuscleSizeClass,
  ProgressionAxis,
  SessionBlock,
  SessionStatus,
  SplitType,
  TrainingGoal,
} from './enums';

/* -------------------------------------------------------------------------- */
/*                                 Référentiel                                */
/* -------------------------------------------------------------------------- */

/**
 * Définition d'un groupe musculaire : identité, paramètres de récupération et
 * repères de volume hebdomadaire (landmarks type MEV/MAV/MRV).
 */
export interface MuscleDefinition {
  code: MuscleCode;
  name: string;
  region: MuscleRegion;
  sizeClass: MuscleSizeClass;
  /** Demi-vie de décroissance de la fatigue, en heures. */
  recoveryHalfLifeHours: number;
  /** Plancher de repos absolu entre deux sollicitations. */
  minRestHours: number;
  /** Durée au bout de laquelle le muscle est déclaré pleinement récupéré. */
  fullRecoveryHours: number;
  /** Volume minimum entraînant une progression (séries effectives / semaine). */
  weeklyMev: number;
  /** Volume adaptatif maximal — cible de croisière. */
  weeklyMav: number;
  /** Volume récupérable maximal — plafond absolu. */
  weeklyMrv: number;
  /** Plafond de séries effectives sur une seule séance (rendements décroissants). */
  maxSetsPerSession: number;
  displayOrder: number;
}

/** Implication d'un muscle dans un exercice. */
export interface ExerciseMuscleInvolvement {
  muscle: MuscleCode;
  role: MuscleRole;
  /** Part du stimulus attribuée à ce muscle, entre 0 et 1. */
  contribution: number;
}

export interface ExerciseDefinition {
  id: number;
  slug: string;
  name: string;
  pattern: MovementPattern;
  mechanic: Mechanic;
  /** 1 = accessible à tous, 5 = mouvement avancé. */
  difficulty: number;
  isUnilateral: boolean;
  /**
   * Coût systémique relatif du mouvement (0,5 à 1,5).
   * Une traction lestée fatigue l'organisme bien au-delà des muscles
   * qu'elle cible ; une extension mollet à l'élastique, non.
   */
  systemicLoad: number;
  equipment: EquipmentCode[];
  muscles: ExerciseMuscleInvolvement[];
  defaultRepMin: number;
  defaultRepMax: number;
  defaultRestSeconds: number;
  progressionAxes: ProgressionAxis[];
  /** Famille de progression (ex. « pompes ») pour chaîner les variantes. */
  progressionFamily: string | null;
  /** Rang dans la famille : 1 = variante la plus facile. */
  progressionRank: number;
  setupNotes: string | null;
  executionCues: string[];
}

/* -------------------------------------------------------------------------- */
/*                                 Utilisateur                                */
/* -------------------------------------------------------------------------- */

/** Détail du matériel possédé — conditionne les charges prescriptibles. */
export interface DumbbellDetails {
  /** Charges disponibles par haltère, en kg (ex. [5, 7.5, 10, 12.5, 15]). */
  availableWeightsKg: number[];
  /** Nombre d'haltères identiques disponibles (2 = travail bilatéral possible). */
  pairCount: number;
  /** Incrément le plus fin réalisable, utilisé par la double progression. */
  incrementKg: number;
}

export interface BandLevel {
  /** Libellé affiché (ex. « Rouge »). */
  name: string;
  /** Résistance approximative en kg-équivalent, pour ordonner les niveaux. */
  approxKg: number;
}

export interface BandDetails {
  levels: BandLevel[];
}

export interface PullUpBarDetails {
  /** L'utilisateur peut-il ajouter du lest (ceinture, haltère entre les pieds) ? */
  canAddWeight: boolean;
}

export interface UserEquipmentItem {
  equipment: EquipmentCode;
  details: DumbbellDetails | BandDetails | PullUpBarDetails | Record<string, never>;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  birthYear: number | null;
  sex: 'male' | 'female' | 'unspecified';
  heightCm: number | null;
  bodyWeightKg: number | null;
  experienceLevel: ExperienceLevel;
  primaryGoal: TrainingGoal;
  sessionsPerWeek: number;
  sessionDurationMinutes: number;
  /** Jours préférés, 0 = lundi … 6 = dimanche. */
  preferredWeekdays: number[];
  deloadEveryNWeeks: number;
}

/** Réglages par muscle : priorité de volume et contraintes personnelles. */
export interface UserMuscleSetting {
  muscle: MuscleCode;
  /** Pondération du volume, 0,5 (moins) à 2,0 (priorité forte). */
  priority: number;
  /** Repos minimum personnalisé, sinon la valeur du référentiel s'applique. */
  minRestHoursOverride: number | null;
  weeklySetsOverride: number | null;
  /** Muscle totalement écarté (blessure, contre-indication). */
  isExcluded: boolean;
}

export interface UserExercisePreferenceItem {
  exerciseId: number;
  status: ExercisePreference;
  reason: string | null;
}

/* -------------------------------------------------------------------------- */
/*                          Fatigue et récupération                           */
/* -------------------------------------------------------------------------- */

/**
 * Événement du journal de fatigue — append-only, jamais modifié.
 *
 * `halfLifeHours` est figée au moment de l'enregistrement, après modulation par
 * l'état de forme du jour. Un check-in ultérieur n'altère donc jamais le passé :
 * il ajoute un nouvel événement. C'est ce qui rend le score reproductible.
 */
export interface FatigueEvent {
  muscle: MuscleCode;
  occurredAt: string;
  /** Charge de fatigue normalisée (1,0 ≈ une série primaire menée à l'échec). */
  stimulus: number;
  /** Séries pondérées par la contribution musculaire — sert au comptage du volume. */
  effectiveSets: number;
  halfLifeHours: number;
  source: FatigueSource;
  workoutSessionId: string | null;
  metadata: Record<string, unknown> | null;
}

/** État de récupération d'un muscle à un instant donné. */
export interface MuscleRecoveryState {
  muscle: MuscleCode;
  label: string;
  /** Fatigue résiduelle absolue (somme des stimuli décrus). */
  fatigueScore: number;
  /** Fatigue rapportée à la capacité d'une séance pleine — base des statuts. */
  fatiguePct: number;
  status: FatigueStatus;
  /** Le muscle peut-il être programmé en travail lourd maintenant ? */
  isAvailable: boolean;
  /** Raison du blocage, si le muscle est indisponible. */
  blockedBy: ExclusionReason | null;
  lastStimulusAt: string | null;
  hoursSinceLastStimulus: number | null;
  /** Instant estimé de disponibilité (respecte le plancher de 48 h). */
  availableAt: string | null;
  hoursUntilAvailable: number | null;
  /** Séries effectives réalisées sur les 7 derniers jours. */
  weeklySets: number;
  /** Cible hebdomadaire courante pour ce muscle. */
  weeklySetsTarget: number;
}

export interface SystemicFatigueState {
  /** Score global 0–1, moyenne pondérée par la taille des muscles. */
  score: number;
  /** RPE moyen des séances sur 7 jours, si renseigné. */
  averageSessionRpe: number | null;
  /** Moyenne d'heures de sommeil sur 7 jours, si renseignée. */
  averageSleepHours: number | null;
  deloadRecommended: boolean;
  reasons: string[];
}

export interface SorenessReport {
  muscle: MuscleCode;
  /** Courbature ressentie de 0 (aucune) à 5 (invalidante). */
  soreness: number;
}

export interface RecoveryCheckin {
  id: string;
  checkedAt: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  stress: number | null;
  energy: number | null;
  restingHeartRate: number | null;
  soreness: SorenessReport[];
  notes: string | null;
}

/* -------------------------------------------------------------------------- */
/*                                Planification                               */
/* -------------------------------------------------------------------------- */

/** Un créneau du split : ce qu'une séance de ce type est censée travailler. */
export interface SplitSlot {
  index: number;
  label: string;
  /** Muscles ciblés en priorité par ce créneau. */
  targetMuscles: MuscleCode[];
  /** Patrons moteurs à couvrir obligatoirement. */
  requiredPatterns: MovementPattern[];
}

export interface SplitDefinition {
  type: SplitType;
  sessionsPerWeek: number;
  slots: SplitSlot[];
  /** Fréquence de sollicitation hebdomadaire par muscle induite par ce split. */
  weeklyFrequencyByMuscle: Partial<Record<MuscleCode, number>>;
  /** Écart minimal, en heures, entre deux créneaux partageant un muscle. */
  minGapHours: number;
}

export interface TrainingPlanSummary {
  id: string;
  mesocycleId: string;
  version: number;
  sessionsPerWeek: number;
  splitType: SplitType;
  splitLabel: string;
  isActive: boolean;
  generatedAt: string;
  supersededAt: string | null;
  changeReason: string | null;
}

/* -------------------------------------------------------------------------- */
/*                                   Séance                                   */
/* -------------------------------------------------------------------------- */

/** Charge prescrite pour un exercice — dépend du matériel utilisé. */
export interface Prescription {
  loadKg: number | null;
  bandLevel: string | null;
  tempo: string | null;
  /** Séries à effectuer de chaque côté pour un mouvement unilatéral. */
  perSide: boolean;
  /** Ce qui a changé par rapport à la dernière fois (ex. « +2,5 kg »). */
  progressionNote: string | null;
}

export interface PlannedExercise {
  id: string;
  exerciseId: number;
  slug: string;
  name: string;
  block: SessionBlock;
  position: number;
  targetSets: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number;
  restSeconds: number;
  prescription: Prescription;
  muscles: ExerciseMuscleInvolvement[];
  /** Pourquoi cet exercice a été retenu — affiché à l'utilisateur. */
  rationale: string;
}

/** Muscle écarté de la séance, avec sa justification et son heure de retour. */
export interface ExcludedMuscle {
  muscle: MuscleCode;
  label: string;
  reason: ExclusionReason;
  reasonLabel: string;
  availableAt: string | null;
  hoursUntilAvailable: number | null;
}

/**
 * Justification complète d'une séance générée.
 * Conservée en base (`planned_sessions.generation_snapshot`) : on peut ainsi
 * rejouer et auditer n'importe quelle décision passée de l'algorithme.
 */
export interface GenerationRationale {
  generatedAt: string;
  splitSlotLabel: string;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  targetedMuscles: MuscleCode[];
  excludedMuscles: ExcludedMuscle[];
  /** Séries effectives programmées par muscle. */
  plannedSetsByMuscle: Partial<Record<MuscleCode, number>>;
  /** Dette de volume restante par muscle après cette séance. */
  remainingDebtByMuscle: Partial<Record<MuscleCode, number>>;
  coveredPatterns: MovementPattern[];
  /** Séance de repli déclenchée parce que trop de muscles étaient bloqués. */
  isFallbackSession: boolean;
  warnings: string[];
}

export interface SessionPlan {
  id: string;
  planId: string;
  scheduledDate: string;
  slotIndex: number;
  slotLabel: string;
  status: SessionStatus;
  estimatedDurationMinutes: number;
  exercises: PlannedExercise[];
  rationale: GenerationRationale;
}

/* -------------------------------------------------------------------------- */
/*                                 Exécution                                  */
/* -------------------------------------------------------------------------- */

export interface LoggedSet {
  id: string;
  exerciseId: number;
  exerciseName: string;
  setIndex: number;
  isWarmup: boolean;
  reps: number | null;
  loadKg: number | null;
  bandLevel: string | null;
  /** Répétitions en réserve — premier déterminant de la fatigue générée. */
  rir: number | null;
  toFailure: boolean;
  /** Durée pour les exercices isométriques (gainage). */
  durationSeconds: number | null;
  performedAt: string;
}

export interface WorkoutSessionDetail {
  id: string;
  plannedSessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  sessionRpe: number | null;
  notes: string | null;
  isAdHoc: boolean;
  sets: LoggedSet[];
}

/** État de progression sur un exercice donné (double progression). */
export interface ExerciseProgressionState {
  exerciseId: number;
  currentLoadKg: number | null;
  currentBandLevel: string | null;
  currentRepTarget: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  estimatedOneRepMax: number | null;
  lastPerformedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/*                                Statistiques                                */
/* -------------------------------------------------------------------------- */

export interface WeeklyVolumePoint {
  weekStart: string;
  muscle: MuscleCode;
  effectiveSets: number;
  mev: number;
  mav: number;
  mrv: number;
}

export interface FatigueTimelinePoint {
  at: string;
  /** Fatigue en pourcentage de capacité, par muscle. */
  values: Partial<Record<MuscleCode, number>>;
}
