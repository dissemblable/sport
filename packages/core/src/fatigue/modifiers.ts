import type { RecoveryContext } from '../types';
import { clamp } from '../utils/math';

/**
 * Modulation de la vitesse de récupération par l'état de forme.
 *
 * Le multiplicateur s'applique à la **demi-vie** : au-dessus de 1, la fatigue
 * met plus longtemps à retomber (mauvaise nuit, stress élevé) ; en dessous,
 * elle retombe plus vite (sommeil abondant et réparateur).
 *
 * Ce multiplicateur est figé au moment où l'événement de fatigue est créé.
 * Il n'est jamais recalculé rétroactivement : une mauvaise nuit d'aujourd'hui
 * ne doit pas réécrire la fatigue générée la semaine dernière.
 */

/** Manque de sommeil : facteur de récupération le plus documenté. */
function sleepMultiplier(hours: number | null | undefined, quality: number | null | undefined) {
  if (hours == null) return 1;
  if (hours < 5) return 1.35;
  if (hours < 6) return 1.25;
  if (hours < 7) return 1.1;
  if (hours >= 8 && (quality ?? 3) >= 4) return 0.9;
  return 1;
}

/** Le stress chronique élève le cortisol et ralentit la réparation tissulaire. */
function stressMultiplier(stress: number | null | undefined) {
  if (stress == null) return 1;
  if (stress >= 5) return 1.2;
  if (stress >= 4) return 1.15;
  if (stress === 3) return 1.05;
  return 1;
}

/** La capacité de récupération décline progressivement après 40 ans. */
function ageMultiplier(age: number | null | undefined) {
  if (age == null) return 1;
  if (age >= 55) return 1.25;
  if (age >= 45) return 1.15;
  if (age >= 40) return 1.1;
  if (age <= 20) return 0.95;
  return 1;
}

/**
 * Un débutant subit paradoxalement plus de dommages musculaires à volume égal :
 * ses tissus ne sont pas encore adaptés (effet « repeated bout »).
 */
function levelMultiplier(level: RecoveryContext['experienceLevel']) {
  switch (level) {
    case 'beginner':
      return 1.15;
    case 'advanced':
      return 0.95;
    default:
      return 1;
  }
}

/**
 * Multiplicateur global appliqué à la demi-vie de récupération.
 * Borné à [0,8 ; 1,6] : aucun facteur subjectif ne doit pouvoir doubler ou
 * annihiler le temps de récupération physiologique.
 */
export function halfLifeMultiplier(context: RecoveryContext = {}): number {
  const multiplier =
    sleepMultiplier(context.sleepHours, context.sleepQuality) *
    stressMultiplier(context.stress) *
    ageMultiplier(context.age) *
    levelMultiplier(context.experienceLevel);

  return clamp(multiplier, 0.8, 1.6);
}

/**
 * Explique en français les facteurs qui ralentissent ou accélèrent la
 * récupération — affiché sur l'écran de récupération.
 */
export function describeRecoveryModifiers(context: RecoveryContext = {}): string[] {
  const reasons: string[] = [];

  if (context.sleepHours != null && context.sleepHours < 6) {
    reasons.push(`Sommeil insuffisant (${context.sleepHours} h) : récupération ralentie`);
  }
  if (context.sleepHours != null && context.sleepHours >= 8 && (context.sleepQuality ?? 3) >= 4) {
    reasons.push('Sommeil long et de bonne qualité : récupération accélérée');
  }
  if (context.stress != null && context.stress >= 4) {
    reasons.push('Niveau de stress élevé : récupération ralentie');
  }
  if (context.age != null && context.age >= 40) {
    reasons.push('Récupération naturellement plus lente après 40 ans');
  }
  if (context.experienceLevel === 'beginner') {
    reasons.push('Débutant : dommages musculaires plus marqués à volume égal');
  }

  return reasons;
}
