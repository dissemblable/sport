/**
 * @sport/core — moteur de coaching.
 *
 * Paquet strictement pur : aucune I/O, aucun accès base de données, aucun
 * appel à `Date.now()`. Tout état extérieur entre par les paramètres, ce qui
 * rend chaque décision de l'algorithme reproductible et testable en isolation.
 *
 * Chaîne de traitement :
 *
 *   séries effectuées → événements de fatigue → cliché de récupération
 *                                                      ↓
 *                                      dette de volume → sélection → prescription
 */

export * from './types';
export * from './catalog/index';
export * from './muscleConfig';

export * from './fatigue/stimulus';
export * from './fatigue/decay';
export * from './fatigue/modifiers';
export * from './fatigue/systemic';

export * from './scheduling/split';
export * from './scheduling/placement';
export * from './scheduling/mesocycle';
export * from './scheduling/redistribute';

export * from './generation/volumeDebt';
export * from './generation/exercisePool';
export * from './generation/selector';
export * from './generation/session';

export * from './progression/prescription';
export * from './progression/doubleProgression';

export {
  clamp,
  round,
  hoursBetween,
  addHours,
  addDays,
  toIsoDate,
  weekdayIndex,
  HOUR_MS,
  DAY_MS,
} from './utils/math';
