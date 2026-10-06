import type {
  EquipmentCode,
  ExclusionReason,
  ExperienceLevel,
  FatigueSource,
  FatigueStatus,
  MesocyclePhase,
  MovementPattern,
  MuscleCode,
  MuscleDefinition,
  ExerciseDefinition,
  SplitDefinition,
  TrainingGoal,
} from '@sport/shared';

/**
 * Types du moteur.
 *
 * Le moteur manipule des `Date` natives et jamais de chaînes ISO : la
 * conversion a lieu aux frontières (API, base de données). Aucune fonction
 * n'appelle `Date.now()` — l'instant courant est toujours passé en paramètre,
 * ce qui rend chaque calcul reproductible et testable.
 */

/* -------------------------------------------------------------------------- */
/*                              Entrées brutes                                */
/* -------------------------------------------------------------------------- */

/** Une série réellement effectuée, telle qu'enregistrée pendant la séance. */
export interface PerformedSet {
  exerciseId: number;
  isWarmup: boolean;
  reps: number | null;
  loadKg: number | null;
  bandLevel: string | null;
  /** Répétitions en réserve. `null` → une valeur prudente est supposée. */
  rir: number | null;
  toFailure: boolean;
  /** Durée pour les exercices isométriques (gainage, suspension). */
  durationSeconds: number | null;
  performedAt: Date;
}

/**
 * Événement du journal de fatigue, en mémoire.
 *
 * `halfLifeHours` est figée à la création : un changement ultérieur de l'état
 * de forme n'altère jamais le passé, il ajoute simplement de nouveaux
 * événements. C'est ce qui garantit que le score est rejouable à l'identique.
 */
export interface StimulusEvent {
  muscle: MuscleCode;
  occurredAt: Date;
  stimulus: number;
  /** Séries pondérées par la contribution — sert au comptage du volume. */
  effectiveSets: number;
  halfLifeHours: number;
  source: FatigueSource;
  /**
   * Le muscle a-t-il été travaillé directement (moteur principal ou secondaire
   * lourd) ? Seul le travail direct déclenche le plancher de repos de 48 h ; la
   * participation d'un stabilisateur n'immobilise pas le muscle pour deux jours.
   */
  isDirectWork: boolean;
  workoutSessionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** État de forme du jour, modulant la vitesse de récupération. */
export interface RecoveryContext {
  sleepHours?: number | null;
  /** 1 (très mauvaise) à 5 (excellente). */
  sleepQuality?: number | null;
  /** 1 (nul) à 5 (très élevé). */
  stress?: number | null;
  age?: number | null;
  experienceLevel?: ExperienceLevel;
}

/* -------------------------------------------------------------------------- */
/*                          Configuration par muscle                          */
/* -------------------------------------------------------------------------- */

/**
 * Paramètres effectifs d'un muscle, après application des réglages
 * utilisateur et de la phase du mésocycle.
 */
export interface MuscleConfig {
  definition: MuscleDefinition;
  /** Pondération du volume voulue par l'utilisateur (0,5 à 2,0). */
  priority: number;
  /** Plancher de repos effectif, override utilisateur inclus. */
  minRestHours: number;
  /** Cible de séries effectives sur la semaine courante. */
  weeklyTargetSets: number;
  /** Nombre de fois où ce muscle est sollicité par semaine dans le split. */
  weeklyFrequency: number;
  /**
   * Charge de fatigue correspondant à une séance « pleine ».
   * Sert de dénominateur au pourcentage de fatigue.
   */
  capacity: number;
  isExcluded: boolean;
}

export type MuscleConfigMap = Record<MuscleCode, MuscleConfig>;

/* -------------------------------------------------------------------------- */
/*                             État de fatigue                                */
/* -------------------------------------------------------------------------- */

export interface MuscleFatigueSnapshot {
  muscle: MuscleCode;
  /** Fatigue résiduelle absolue (somme des stimuli décrus). */
  fatigueScore: number;
  /** Fatigue rapportée à la capacité — base des statuts et des seuils. */
  fatiguePct: number;
  status: FatigueStatus;
  /** Le muscle peut-il être programmé en travail lourd à cet instant ? */
  isAvailable: boolean;
  blockedBy: ExclusionReason | null;
  lastStimulusAt: Date | null;
  hoursSinceLastStimulus: number | null;
  /** Instant de disponibilité — jamais avant le plancher de 48 h. */
  availableAt: Date | null;
  hoursUntilAvailable: number | null;
  /** Instant estimé de récupération complète (retour au statut « frais »). */
  fullyRecoveredAt: Date | null;
  /**
   * Séries effectives sur les 7 derniers jours glissants.
   * Mesure de suivi, affichée à l'utilisateur.
   */
  weeklySets: number;
  /**
   * Séries effectives depuis le début de la semaine d'entraînement en cours.
   *
   * C'est cette valeur — et non la fenêtre glissante — qui pilote la dette de
   * volume : au premier jour d'une nouvelle semaine, le volume de la semaine
   * écoulée ne doit plus compter, sans quoi aucune séance ne serait programmée.
   */
  currentWeekSets: number;
  weeklySetsTarget: number;
  capacity: number;
}

export interface SystemicFatigueSnapshot {
  score: number;
  averageSessionRpe: number | null;
  averageSleepHours: number | null;
  deloadRecommended: boolean;
  reasons: string[];
}

export interface FatigueSnapshot {
  at: Date;
  byMuscle: Record<MuscleCode, MuscleFatigueSnapshot>;
  systemic: SystemicFatigueSnapshot;
}

/* -------------------------------------------------------------------------- */
/*                          Matériel et disponibilité                         */
/* -------------------------------------------------------------------------- */

export interface DumbbellInventory {
  availableWeightsKg: number[];
  pairCount: number;
  incrementKg: number;
}

export interface BandInventory {
  levels: { name: string; approxKg: number }[];
}

/** Ce que l'utilisateur possède réellement — filtre absolu du générateur. */
export interface EquipmentInventory {
  owned: EquipmentCode[];
  dumbbells?: DumbbellInventory | null;
  bands?: BandInventory | null;
  pullUpBarCanAddWeight?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                 Athlète                                    */
/* -------------------------------------------------------------------------- */

export interface AthleteProfile {
  experienceLevel: ExperienceLevel;
  primaryGoal: TrainingGoal;
  sessionsPerWeek: number;
  sessionDurationMinutes: number;
  /** 0 = lundi … 6 = dimanche. */
  preferredWeekdays: number[];
  age: number | null;
  bodyWeightKg: number | null;
  deloadEveryNWeeks: number;
}

export interface MuscleSettingOverride {
  muscle: MuscleCode;
  priority?: number;
  minRestHoursOverride?: number | null;
  weeklySetsOverride?: number | null;
  isExcluded?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                Progression                                 */
/* -------------------------------------------------------------------------- */

/** État de la double progression pour un exercice donné. */
export interface ProgressionState {
  exerciseId: number;
  currentLoadKg: number | null;
  currentBandLevel: string | null;
  /** Cible de répétitions courante, dans la fourchette de l'exercice. */
  currentRepTarget: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastPerformedAt: Date | null;
}

/* -------------------------------------------------------------------------- */
/*                            Génération de séance                            */
/* -------------------------------------------------------------------------- */

export interface PrescribedExercise {
  exercise: ExerciseDefinition;
  block: 'warmup' | 'main' | 'accessory' | 'core' | 'finisher';
  position: number;
  targetSets: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number;
  restSeconds: number;
  loadKg: number | null;
  bandLevel: string | null;
  tempo: string | null;
  perSide: boolean;
  progressionNote: string | null;
  /** Justification de la sélection, affichée à l'utilisateur. */
  rationale: string;
}

export interface ExcludedMuscleInfo {
  muscle: MuscleCode;
  reason: ExclusionReason;
  availableAt: Date | null;
  hoursUntilAvailable: number | null;
}

/**
 * Compte rendu complet d'une génération.
 *
 * Sérialisé en base avec la séance : n'importe quelle décision passée de
 * l'algorithme peut ainsi être relue et auditée des mois plus tard.
 */
export interface GenerationReport {
  generatedAt: Date;
  slotLabel: string;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  targetedMuscles: MuscleCode[];
  excludedMuscles: ExcludedMuscleInfo[];
  plannedSetsByMuscle: Partial<Record<MuscleCode, number>>;
  remainingDebtByMuscle: Partial<Record<MuscleCode, number>>;
  coveredPatterns: MovementPattern[];
  isFallbackSession: boolean;
  warnings: string[];
}

export interface GeneratedSession {
  slotIndex: number;
  slotLabel: string;
  exercises: PrescribedExercise[];
  estimatedDurationMinutes: number;
  report: GenerationReport;
}

export interface GenerateSessionInput {
  now: Date;
  slotIndex: number;
  split: SplitDefinition;
  profile: AthleteProfile;
  inventory: EquipmentInventory;
  muscleConfigs: MuscleConfigMap;
  snapshot: FatigueSnapshot;
  mesocycleWeek: number;
  phase: MesocyclePhase;
  /** Catalogue disponible — injecté pour permettre des tests sur un sous-ensemble. */
  exercises: ExerciseDefinition[];
  /** Exercices interdits (blessure, aversion). */
  bannedExerciseIds?: Set<number>;
  favoriteExerciseIds?: Set<number>;
  /** État de progression connu, par identifiant d'exercice. */
  progression?: Map<number, ProgressionState>;
  /** Exercices de la séance précédente — favorise la variété. */
  previousSessionExerciseIds?: Set<number>;
  /** Budget temps ; par défaut celui du profil. */
  durationMinutes?: number;
  /**
   * Séances déjà effectuées cette semaine — sert à lisser la dette de volume
   * sur les séances restantes plutôt qu'à tout programmer d'un coup.
   */
  sessionsCompletedThisWeek?: number;
}
