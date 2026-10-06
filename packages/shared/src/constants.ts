import type {
  ExperienceLevel,
  FatigueStatus,
  MuscleRole,
  MuscleSizeClass,
  SplitType,
} from './enums';

/* -------------------------------------------------------------------------- */
/*                        Politique de repos musculaire                       */
/* -------------------------------------------------------------------------- */

/**
 * Plancher de repos absolu entre deux sollicitations d'un même muscle.
 *
 * C'est l'exigence n°1 de l'application : quel que soit le score de fatigue
 * calculé, un muscle sollicité il y a moins de 48 h n'est jamais reprogrammé
 * en travail lourd. Le score continu ne peut que *repousser* cette échéance,
 * jamais l'avancer — la fenêtre 48–72 h est donc garantie par construction.
 *
 * Réglable par muscle via `user_muscle_settings.min_rest_hours_override`.
 */
export const DEFAULT_MIN_REST_HOURS = 48;

/**
 * Durée au bout de laquelle un muscle est considéré comme pleinement récupéré,
 * même si le score de fatigue résiduel n'est pas tout à fait retombé.
 * Borne haute de la fenêtre de récupération.
 */
export const DEFAULT_FULL_RECOVERY_HOURS = 72;

/**
 * Demi-vie de récupération par classe de taille, en heures.
 *
 * Un grand groupe musculaire subit plus de dommages structurels et met plus
 * longtemps à revenir à sa ligne de base.
 *
 * Calibrage — ces valeurs ne sont pas arbitraires, elles sont dérivées de la
 * fenêtre 48–72 h exigée. Une séance pleine porte la fatigue à ~0,87 fois la
 * capacité ; le retour au statut « frais » (0,15) demande donc
 * `demi-vie × log₂(0,87 / 0,15) ≈ demi-vie × 2,54` heures :
 *
 *   - grands muscles  : 28 h → récupération complète en ~71 h
 *   - muscles moyens  : 22 h → ~56 h
 *   - petits muscles  : 17 h → ~43 h, donc gouvernés par le plancher de 48 h
 *
 * Les trois valeurs tombent ainsi dans la fenêtre visée, et une séance
 * volontairement excessive la dépasse — ce qui est le comportement recherché.
 */
export const RECOVERY_HALF_LIFE_HOURS: Record<MuscleSizeClass, number> = {
  large: 28,
  medium: 22,
  small: 17,
};

/** Fenêtre au-delà de laquelle un événement de fatigue est négligeable (< 0,1 %). */
export const FATIGUE_WINDOW_DAYS = 14;

/* -------------------------------------------------------------------------- */
/*                       Seuils de statut de récupération                     */
/* -------------------------------------------------------------------------- */

/**
 * Bornes hautes (exclusives) de `fatiguePct` pour chaque statut.
 * `fatiguePct` = fatigue résiduelle / capacité d'une séance pleine.
 */
export const FATIGUE_THRESHOLDS = {
  fresh: 0.15,
  ready: 0.4,
  recovering: 0.65,
  fatigued: 0.9,
} as const;

/**
 * Au-delà de ce niveau de fatigue, le muscle est écarté du travail lourd.
 * Correspond à la frontière `recovering` → `fatigued`.
 */
export const FATIGUE_BLOCKING_THRESHOLD = FATIGUE_THRESHOLDS.recovering;

/** Statuts qui interdisent de programmer un muscle en travail principal. */
export const BLOCKING_FATIGUE_STATUSES: readonly FatigueStatus[] = ['fatigued', 'overreached'];

/**
 * Modulation du volume de séance selon l'état de récupération.
 * Un muscle `recovering` peut encore travailler, mais à volume réduit et
 * sans approcher l'échec.
 */
export const VOLUME_FACTOR_BY_STATUS: Record<FatigueStatus, number> = {
  fresh: 1.1,
  ready: 1.0,
  recovering: 0.6,
  fatigued: 0,
  overreached: 0,
};

/** Seuil de fatigue systémique au-delà duquel un deload est proposé. */
export const SYSTEMIC_DELOAD_THRESHOLD = 0.75;

/* -------------------------------------------------------------------------- */
/*                          Contribution musculaire                           */
/* -------------------------------------------------------------------------- */

/**
 * Part du stimulus d'une série attribuée à un muscle selon son rôle.
 *
 * Un curl biceps compte 1 série pour les biceps ; une traction compte 1 série
 * pour les dorsaux et 0,5 pour les biceps. C'est ainsi que le volume indirect
 * est comptabilisé — sans cela, l'application prescrirait 15 séries de biceps
 * par semaine en plus de 20 séries de tirage, et le muscle ne récupérerait jamais.
 */
export const ROLE_CONTRIBUTION: Record<MuscleRole, number> = {
  primary: 1.0,
  secondary: 0.5,
  stabilizer: 0.2,
};

/**
 * Contribution à partir de laquelle un muscle est considéré comme **travaillé
 * directement**, et non simplement mis à contribution.
 *
 * Cette frontière détermine deux comportements symétriques :
 *  - elle déclenche le plancher de repos de 48 h ;
 *  - elle interdit de retenir un exercice tant que ce repos n'est pas écoulé.
 *
 * Sans elle, le gainage isométrique d'un soulevé de terre (lombaires à 0,2)
 * bloquerait le haut du dos pendant deux jours, et l'application deviendrait
 * inutilisable. Avec un seuil trop bas, à l'inverse, la garantie de repos se
 * contournerait par les muscles secondaires.
 */
export const DIRECT_WORK_CONTRIBUTION = 0.5;

/* -------------------------------------------------------------------------- */
/*                          Paramètres d'entraînement                         */
/* -------------------------------------------------------------------------- */

export const MIN_SESSIONS_PER_WEEK = 2;
export const MAX_SESSIONS_PER_WEEK = 6;

export const MIN_SESSION_DURATION_MINUTES = 20;
export const MAX_SESSION_DURATION_MINUTES = 150;
export const DEFAULT_SESSION_DURATION_MINUTES = 60;

/** Durée du mésocycle par défaut : 4 semaines d'accumulation + 1 de deload. */
export const DEFAULT_MESOCYCLE_WEEKS = 5;

/**
 * Split retenu pour chaque fréquence hebdomadaire.
 *
 * Chaque association est choisie pour que l'écart minimal entre deux
 * sollicitations d'un même muscle reste ≥ 48 h. C'est la contrainte de
 * récupération qui impose le split, et non l'inverse.
 */
export const SPLIT_BY_FREQUENCY: Record<number, SplitType> = {
  2: 'full_body',
  3: 'full_body',
  4: 'upper_lower',
  5: 'push_pull_legs_upper_lower',
  6: 'push_pull_legs_x2',
};

/**
 * Multiplicateur de volume hebdomadaire selon l'expérience.
 * Un débutant progresse au MEV ; un avancé a besoin de s'approcher du MAV.
 */
export const VOLUME_MULTIPLIER_BY_LEVEL: Record<ExperienceLevel, number> = {
  beginner: 0.7,
  intermediate: 1.0,
  advanced: 1.2,
};

/** RIR (répétitions en réserve) prescrit par défaut selon la semaine du mésocycle. */
export const RIR_BY_MESOCYCLE_WEEK = [3, 2, 1, 0] as const;

/** RIR imposé pendant une semaine de deload. */
export const DELOAD_RIR = 4;

/** Facteur appliqué au volume pendant un deload. */
export const DELOAD_VOLUME_FACTOR = 0.5;

/* -------------------------------------------------------------------------- */
/*                              Estimation temps                              */
/* -------------------------------------------------------------------------- */

/** Durée moyenne d'exécution d'une série, hors repos (secondes). */
export const SECONDS_PER_SET_EXECUTION = 40;

/** Temps d'installation entre deux exercices (changement de charge, position). */
export const SECONDS_PER_EXERCISE_TRANSITION = 60;

/** Durée de l'échauffement général en début de séance. */
export const WARMUP_DURATION_SECONDS = 300;

/** Tolérance acceptée sur le budget temps d'une séance générée. */
export const TIME_BUDGET_TOLERANCE = 0.15;
