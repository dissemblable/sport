/** Utilitaires numériques et temporels du moteur. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Arrondi à `decimals` décimales — évite les 0,30000000000000004 en base. */
export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Date du jour à minuit UTC, au format `AAAA-MM-JJ`. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Jour de la semaine avec 0 = lundi … 6 = dimanche (et non 0 = dimanche). */
export function weekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * Le moteur n'utilise volontairement aucune source d'aléa — pas même un
 * générateur ensemencé. Toute la variété (rotation des exercices, alternance
 * des créneaux) provient de l'état réel de l'athlète : dette de volume,
 * fatigue, exercices de la séance précédente.
 *
 * Le déterminisme est donc structurel plutôt que reproductible par graine : à
 * état identique, la séance générée est strictement la même, ce qui rend les
 * tests de non-régression exacts et les décisions rejouables.
 */
