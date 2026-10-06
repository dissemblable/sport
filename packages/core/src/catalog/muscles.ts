import {
  DEFAULT_MIN_REST_HOURS,
  RECOVERY_HALF_LIFE_HOURS,
  type MuscleCode,
  type MuscleDefinition,
  type MuscleRegion,
  type MuscleSizeClass,
  MUSCLE_LABELS,
} from '@sport/shared';

/**
 * Référentiel des 17 groupes musculaires.
 *
 * Deux familles de paramètres cohabitent ici :
 *
 * 1. **Récupération** — demi-vie de décroissance de la fatigue, plancher de
 *    repos et durée de récupération complète. Le plancher est fixé à 48 h pour
 *    tous les muscles conformément à l'exigence du produit ; la demi-vie et la
 *    borne haute varient selon la taille du groupe.
 *
 * 2. **Volume hebdomadaire** — repères MEV / MAV / MRV exprimés en *séries
 *    effectives*, c'est-à-dire pondérées par la contribution musculaire. Une
 *    traction compte 1 série pour les dorsaux et 0,5 pour les biceps : sans
 *    cette pondération, un programme de tirage lourd amènerait mécaniquement
 *    les biceps au-delà de leur volume récupérable.
 *
 * Les valeurs sont adaptées à l'entraînement à domicile : légèrement plus
 * basses en haut de fourchette qu'en salle, l'absence de charges lourdes
 * limitant le stimulus par série sur les grands groupes.
 */

interface MuscleSeed {
  code: MuscleCode;
  region: MuscleRegion;
  sizeClass: MuscleSizeClass;
  /** Volume minimum entraînant une progression. */
  mev: number;
  /** Volume adaptatif maximal — la cible de croisière. */
  mav: number;
  /** Volume récupérable maximal — plafond absolu. */
  mrv: number;
  /** Plafond par séance : au-delà, les rendements deviennent négligeables. */
  maxSetsPerSession: number;
  /**
   * Borne haute de la fenêtre de récupération. Les petits muscles récupèrent
   * physiologiquement plus vite ; c'est alors le plancher de 48 h qui gouverne.
   */
  fullRecoveryHours: number;
}

const MUSCLE_SEEDS: MuscleSeed[] = [
  // --- Haut du corps : poussée -------------------------------------------
  {
    code: 'chest',
    region: 'upper_push',
    sizeClass: 'large',
    mev: 8,
    mav: 16,
    mrv: 22,
    maxSetsPerSession: 10,
    fullRecoveryHours: 72,
  },
  {
    code: 'front_delts',
    region: 'upper_push',
    sizeClass: 'medium',
    mev: 4,
    mav: 10,
    mrv: 16,
    maxSetsPerSession: 8,
    fullRecoveryHours: 60,
  },
  {
    code: 'side_delts',
    region: 'upper_push',
    sizeClass: 'medium',
    mev: 8,
    mav: 18,
    mrv: 26,
    maxSetsPerSession: 10,
    fullRecoveryHours: 60,
  },
  {
    code: 'triceps',
    region: 'upper_push',
    sizeClass: 'medium',
    mev: 6,
    mav: 14,
    mrv: 20,
    maxSetsPerSession: 9,
    fullRecoveryHours: 60,
  },

  // --- Haut du corps : tirage --------------------------------------------
  {
    code: 'lats',
    region: 'upper_pull',
    sizeClass: 'large',
    mev: 10,
    mav: 18,
    mrv: 25,
    maxSetsPerSession: 10,
    fullRecoveryHours: 72,
  },
  {
    code: 'upper_back',
    region: 'upper_pull',
    sizeClass: 'medium',
    mev: 8,
    mav: 16,
    mrv: 25,
    maxSetsPerSession: 10,
    fullRecoveryHours: 60,
  },
  {
    code: 'rear_delts',
    region: 'upper_pull',
    sizeClass: 'small',
    mev: 6,
    mav: 14,
    mrv: 22,
    maxSetsPerSession: 10,
    fullRecoveryHours: 48,
  },
  {
    code: 'biceps',
    region: 'upper_pull',
    sizeClass: 'small',
    mev: 6,
    mav: 14,
    mrv: 20,
    maxSetsPerSession: 9,
    fullRecoveryHours: 48,
  },
  {
    code: 'forearms',
    region: 'upper_pull',
    sizeClass: 'small',
    mev: 2,
    mav: 8,
    mrv: 14,
    maxSetsPerSession: 6,
    fullRecoveryHours: 48,
  },

  // --- Bas du corps -------------------------------------------------------
  {
    code: 'quads',
    region: 'lower',
    sizeClass: 'large',
    mev: 8,
    mav: 16,
    mrv: 22,
    maxSetsPerSession: 10,
    fullRecoveryHours: 72,
  },
  {
    code: 'hamstrings',
    region: 'lower',
    sizeClass: 'large',
    mev: 6,
    mav: 14,
    mrv: 20,
    maxSetsPerSession: 8,
    fullRecoveryHours: 72,
  },
  {
    code: 'glutes',
    region: 'lower',
    sizeClass: 'large',
    mev: 4,
    mav: 12,
    mrv: 18,
    maxSetsPerSession: 9,
    fullRecoveryHours: 72,
  },
  {
    code: 'adductors',
    region: 'lower',
    sizeClass: 'medium',
    mev: 2,
    mav: 8,
    mrv: 12,
    maxSetsPerSession: 6,
    fullRecoveryHours: 60,
  },
  {
    code: 'calves',
    region: 'lower',
    sizeClass: 'small',
    mev: 6,
    mav: 14,
    mrv: 20,
    maxSetsPerSession: 8,
    fullRecoveryHours: 48,
  },
  {
    // Les lombaires accumulent la fatigue de tous les mouvements de charnière
    // et de gainage : leur MRV est bas et leur récupération lente. C'est le
    // groupe le plus facile à surcharger involontairement à domicile.
    code: 'lower_back',
    region: 'lower',
    sizeClass: 'large',
    mev: 4,
    mav: 8,
    mrv: 12,
    maxSetsPerSession: 6,
    fullRecoveryHours: 72,
  },

  // --- Tronc --------------------------------------------------------------
  {
    code: 'abs',
    region: 'core',
    sizeClass: 'small',
    mev: 6,
    mav: 14,
    mrv: 22,
    maxSetsPerSession: 9,
    fullRecoveryHours: 48,
  },
  {
    code: 'obliques',
    region: 'core',
    sizeClass: 'small',
    mev: 4,
    mav: 10,
    mrv: 16,
    maxSetsPerSession: 7,
    fullRecoveryHours: 48,
  },
];

export const MUSCLE_CATALOG: MuscleDefinition[] = MUSCLE_SEEDS.map((seed, index) => ({
  code: seed.code,
  name: MUSCLE_LABELS[seed.code],
  region: seed.region,
  sizeClass: seed.sizeClass,
  recoveryHalfLifeHours: RECOVERY_HALF_LIFE_HOURS[seed.sizeClass],
  minRestHours: DEFAULT_MIN_REST_HOURS,
  fullRecoveryHours: seed.fullRecoveryHours,
  weeklyMev: seed.mev,
  weeklyMav: seed.mav,
  weeklyMrv: seed.mrv,
  maxSetsPerSession: seed.maxSetsPerSession,
  displayOrder: index,
}));

export const MUSCLE_BY_CODE: Record<MuscleCode, MuscleDefinition> = Object.fromEntries(
  MUSCLE_CATALOG.map((m) => [m.code, m]),
) as Record<MuscleCode, MuscleDefinition>;

/** Muscles d'une région donnée, dans l'ordre d'affichage. */
export function musclesInRegion(region: MuscleRegion): MuscleDefinition[] {
  return MUSCLE_CATALOG.filter((m) => m.region === region);
}
