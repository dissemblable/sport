import {
  MUSCLE_CODES,
  SECONDS_PER_EXERCISE_TRANSITION,
  SECONDS_PER_SET_EXECUTION,
  type ExerciseDefinition,
  type MovementPattern,
  type MuscleCode,
} from '@sport/shared';
import type { FatigueSnapshot, MuscleConfigMap } from '../types';
import { clamp, round } from '../utils/math';
import { respectsBlockedMuscles } from './exercisePool';
import type { MuscleVolumeTarget } from './volumeDebt';

/**
 * Sélection des exercices d'une séance.
 *
 * Problème : choisir un sous-ensemble d'exercices maximisant la couverture de
 * la dette de volume, sous contraintes de temps, de patrons moteurs à couvrir
 * et de muscles indisponibles. C'est un problème de couverture pondérée —
 * NP-difficile dans le cas général, mais dont l'instance est ici minuscule
 * (quelques dizaines de candidats, 6 à 8 sélections).
 *
 * Une **heuristique gloutonne** est donc employée : elle donne une solution
 * de qualité quasi optimale sur des instances de cette taille, reste
 * parfaitement déterministe et — surtout — produit un ordre de sélection
 * lisible que l'on peut expliquer à l'utilisateur exercice par exercice.
 *
 * Les contraintes dures (matériel, muscles bloqués) ne sont jamais arbitrées
 * par le score : elles filtrent les candidats en amont.
 */

/** Nombre maximal d'exercices partageant un même patron moteur. */
const MAX_EXERCISES_PER_PATTERN = 2;

/** Nombre maximal d'exercices ciblant le même muscle en moteur principal. */
const MAX_EXERCISES_PER_PRIMARY_MUSCLE = 3;

/** Plafond d'exercices sur une séance, lisibilité et concentration obligent. */
const MAX_EXERCISES_PER_SESSION = 9;

/** En deçà de cette dette résiduelle, ajouter un exercice n'apporte plus rien. */
const MIN_USEFUL_DEBT = 1.2;

/**
 * Bornes du nombre de séries par exercice : en dessous de 2 le stimulus est
 * marginal, au-dessus de 4 les rendements décroissent fortement sur un même
 * mouvement — mieux vaut alors varier l'exercice.
 */
const MIN_SETS_PER_EXERCISE = 2;
const MAX_SETS_PER_EXERCISE = 4;

/** Pondération d'un muscle hors du créneau : travaillé si l'occasion se présente. */
const OFF_FOCUS_WEIGHT = 0.35;

export interface SelectedExercise {
  exercise: ExerciseDefinition;
  sets: number;
  /** Justification affichée à l'utilisateur. */
  rationale: string;
  /** Le patron moteur était-il imposé par le créneau ? */
  coversRequiredPattern: boolean;
}

export interface SelectionInput {
  pool: ExerciseDefinition[];
  targets: Record<MuscleCode, MuscleVolumeTarget>;
  /** Muscles prioritaires du créneau. */
  focusMuscles: Set<MuscleCode>;
  requiredPatterns: MovementPattern[];
  /** Muscles interdits en moteur principal. */
  blockedMuscles: Set<MuscleCode>;
  snapshot: FatigueSnapshot;
  muscleConfigs: MuscleConfigMap;
  timeBudgetSeconds: number;
  /**
   * Plafond absolu, tolérance comprise. Un exercice couvrant un patron imposé
   * peut dépasser le budget nominal, jamais ce plafond.
   */
  hardCapSeconds: number;
  previousSessionExerciseIds: Set<number>;
  favoriteExerciseIds: Set<number>;
}

export interface SelectionResult {
  selected: SelectedExercise[];
  remainingDebt: Partial<Record<MuscleCode, number>>;
  coveredPatterns: MovementPattern[];
  uncoveredPatterns: MovementPattern[];
  estimatedSeconds: number;
  stoppedBy: 'targets_met' | 'time_budget' | 'no_candidate' | 'max_exercises';
}

/** Temps nécessaire pour réaliser un exercice, repos inter-séries compris. */
export function estimateExerciseSeconds(exercise: ExerciseDefinition, sets: number): number {
  // Un mouvement unilatéral se fait des deux côtés : temps d'exécution doublé,
  // mais le repos n'est pris qu'une fois par série (le côté opposé sert de repos).
  const executionPerSet = SECONDS_PER_SET_EXECUTION * (exercise.isUnilateral ? 2 : 1);
  const restTotal = exercise.defaultRestSeconds * Math.max(0, sets - 1);
  return sets * executionPerSet + restTotal + SECONDS_PER_EXERCISE_TRANSITION;
}

/**
 * Disponibilité relative d'un muscle : un muscle frais mérite plus de volume
 * qu'un muscle qui vient tout juste de repasser sous le seuil de blocage.
 */
function readiness(snapshot: FatigueSnapshot, muscle: MuscleCode): number {
  const state = snapshot.byMuscle[muscle];
  if (!state) return 1;
  return clamp(1 - state.fatiguePct * 0.5, 0.5, 1);
}

export function selectExercises(input: SelectionInput): SelectionResult {
  const {
    pool,
    targets,
    focusMuscles,
    requiredPatterns,
    blockedMuscles,
    snapshot,
    muscleConfigs,
    timeBudgetSeconds,
    previousSessionExerciseIds,
    favoriteExerciseIds,
  } = input;

  /* ---------------------------------------------------------------------- */
  /*  État de la recherche                                                   */
  /* ---------------------------------------------------------------------- */

  // Dette restante à couvrir, décrémentée à chaque sélection.
  const remaining: Partial<Record<MuscleCode, number>> = {};
  for (const muscle of MUSCLE_CODES) {
    remaining[muscle] = targets[muscle]?.setsThisSession ?? 0;
  }

  const selected: SelectedExercise[] = [];
  const usedIds = new Set<number>();
  const patternCount = new Map<MovementPattern, number>();
  const primaryMuscleCount = new Map<MuscleCode, number>();
  const pendingPatterns = new Set(requiredPatterns);

  let elapsedSeconds = 0;

  // Contrainte dure : jamais un muscle bloqué en travail direct.
  const eligible = pool.filter((e) => respectsBlockedMuscles(e, blockedMuscles));

  // Contrainte de cohérence : un exercice n'est retenu que si l'un de ses
  // moteurs principaux appartient au créneau du jour.
  //
  // Sans cette règle, un mouvement très « rentable » pour la dette globale —
  // un swing, qui charge fessiers et ischios — pouvait s'inviter dans une
  // séance haut du corps, et bloquer par ricochet la séance jambes du
  // lendemain. Le créneau perd alors tout son sens et l'espacement des groupes
  // musculaires, soigneusement construit par le split, s'effondre.
  const onFocus = eligible.filter((e) =>
    e.muscles.some((m) => m.role === 'primary' && focusMuscles.has(m.muscle)),
  );

  // Repli : si le créneau ne laisse aucun candidat (matériel très limité,
  // muscles tous bloqués), mieux vaut une séance imparfaite que rien.
  const candidates = onFocus.length > 0 ? onFocus : eligible;

  /* ---------------------------------------------------------------------- */
  /*  Fonction de score                                                      */
  /* ---------------------------------------------------------------------- */

  const scoreExercise = (exercise: ExerciseDefinition): number => {
    let value = 0;

    for (const involvement of exercise.muscles) {
      const debt = remaining[involvement.muscle] ?? 0;
      if (debt <= 0) continue;

      const config = muscleConfigs[involvement.muscle];
      if (!config || config.isExcluded) continue;

      const focusWeight = focusMuscles.has(involvement.muscle) ? 1 : OFF_FOCUS_WEIGHT;

      value +=
        involvement.contribution *
        debt *
        config.priority *
        readiness(snapshot, involvement.muscle) *
        focusWeight;
    }

    if (value <= 0) return 0;

    // Un patron encore à couvrir prime : c'est ce qui garantit qu'une séance
    // « Pull » contient bien un tirage vertical ET un tirage horizontal.
    if (pendingPatterns.has(exercise.pattern)) value *= 2.5;

    // Les polyarticulaires en premier : plus de volume utile par minute.
    if (exercise.mechanic === 'compound') value *= 1.2;

    // Variété : on évite de répéter la séance précédente à l'identique.
    if (previousSessionExerciseIds.has(exercise.id)) value *= 0.7;

    if (favoriteExerciseIds.has(exercise.id)) value *= 1.15;

    // Ratio stimulus / fatigue : à couverture musculaire égale, on retient le
    // mouvement qui coûte le moins cher à l'organisme. C'est ce qui fait
    // préférer un goblet squat à un squat sauté — même travail sur les
    // quadriceps, mais sans la facture nerveuse du pliométrique.
    value /= 0.7 + 0.3 * exercise.systemicLoad;

    // Rendement temporel : à contribution égale, l'exercice le plus court gagne.
    const seconds = estimateExerciseSeconds(exercise, 3);
    return value / (seconds / 300);
  };

  /* ---------------------------------------------------------------------- */
  /*  Nombre de séries à programmer                                          */
  /* ---------------------------------------------------------------------- */

  const setsFor = (exercise: ExerciseDefinition): number => {
    const primaryDebts = exercise.muscles
      .filter((m) => m.role === 'primary')
      .map((m) => remaining[m.muscle] ?? 0);

    const desired = primaryDebts.length > 0 ? Math.max(...primaryDebts) : 0;
    return clamp(Math.round(desired), MIN_SETS_PER_EXERCISE, MAX_SETS_PER_EXERCISE);
  };

  /* ---------------------------------------------------------------------- */
  /*  Boucle gloutonne                                                       */
  /* ---------------------------------------------------------------------- */

  let stoppedBy: SelectionResult['stoppedBy'] = 'targets_met';

  while (selected.length < MAX_EXERCISES_PER_SESSION) {
    let best: ExerciseDefinition | null = null;
    let bestScore = 0;

    for (const exercise of candidates) {
      if (usedIds.has(exercise.id)) continue;

      if ((patternCount.get(exercise.pattern) ?? 0) >= MAX_EXERCISES_PER_PATTERN) continue;

      const primaries = exercise.muscles.filter((m) => m.role === 'primary');
      const saturated = primaries.some(
        (m) => (primaryMuscleCount.get(m.muscle) ?? 0) >= MAX_EXERCISES_PER_PRIMARY_MUSCLE,
      );
      if (saturated) continue;

      const score = scoreExercise(exercise);
      if (score <= 0) continue;

      // Départage déterministe : à score égal, l'ordre du catalogue tranche.
      if (score > bestScore) {
        bestScore = score;
        best = exercise;
      }
    }

    if (!best) {
      stoppedBy = 'no_candidate';
      break;
    }

    const coversRequired = pendingPatterns.has(best.pattern);
    let sets = setsFor(best);
    let seconds = estimateExerciseSeconds(best, sets);

    if (elapsedSeconds + seconds > timeBudgetSeconds) {
      // Une séance « Pull » sans aucun tirage vertical n'aurait pas de sens :
      // un patron imposé peut donc déborder du budget nominal. Mais jamais
      // au-delà du plafond, et seulement après avoir tenté de le raccourcir.
      if (!coversRequired) {
        stoppedBy = 'time_budget';
        break;
      }

      const trimmed = estimateExerciseSeconds(best, MIN_SETS_PER_EXERCISE);
      if (elapsedSeconds + trimmed > input.hardCapSeconds) {
        // Impossible même réduit au minimum : le patron restera découvert et
        // le compte rendu le signalera.
        candidates.splice(candidates.indexOf(best), 1);
        continue;
      }

      sets = MIN_SETS_PER_EXERCISE;
      seconds = trimmed;
    }

    selected.push({
      exercise: best,
      sets,
      coversRequiredPattern: coversRequired,
      rationale: buildRationale(best, sets, remaining, focusMuscles, coversRequired),
    });

    usedIds.add(best.id);
    patternCount.set(best.pattern, (patternCount.get(best.pattern) ?? 0) + 1);
    pendingPatterns.delete(best.pattern);
    elapsedSeconds += seconds;

    for (const involvement of best.muscles) {
      if (involvement.role === 'primary') {
        primaryMuscleCount.set(
          involvement.muscle,
          (primaryMuscleCount.get(involvement.muscle) ?? 0) + 1,
        );
      }
      const current = remaining[involvement.muscle] ?? 0;
      remaining[involvement.muscle] = Math.max(0, current - sets * involvement.contribution);
    }

    // Reste-t-il une dette qui justifie un exercice de plus ?
    const maxRemaining = Math.max(
      0,
      ...MUSCLE_CODES.filter((m) => focusMuscles.has(m)).map((m) => remaining[m] ?? 0),
    );
    if (maxRemaining < MIN_USEFUL_DEBT) {
      stoppedBy = 'targets_met';
      break;
    }
  }

  if (selected.length >= MAX_EXERCISES_PER_SESSION) stoppedBy = 'max_exercises';

  const roundedRemaining: Partial<Record<MuscleCode, number>> = {};
  for (const muscle of MUSCLE_CODES) {
    const value = remaining[muscle] ?? 0;
    if (value > 0.05) roundedRemaining[muscle] = round(value, 2);
  }

  return {
    selected,
    remainingDebt: roundedRemaining,
    coveredPatterns: [...patternCount.keys()],
    uncoveredPatterns: [...pendingPatterns],
    estimatedSeconds: Math.round(elapsedSeconds),
    stoppedBy,
  };
}

/** Phrase expliquant pourquoi cet exercice a été retenu. */
function buildRationale(
  exercise: ExerciseDefinition,
  sets: number,
  remaining: Partial<Record<MuscleCode, number>>,
  focusMuscles: Set<MuscleCode>,
  coversRequiredPattern: boolean,
): string {
  const drivers = exercise.muscles
    .filter((m) => m.role === 'primary' && focusMuscles.has(m.muscle))
    .map((m) => m.muscle);

  const parts: string[] = [];

  if (drivers.length > 0) {
    const debts = drivers
      .map((m) => remaining[m] ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    parts.push(`${sets} séries pour couvrir ${round(debts, 1)} séries manquantes cette semaine`);
  } else {
    parts.push(`${sets} séries de volume complémentaire`);
  }

  if (coversRequiredPattern) {
    parts.push('couvre un patron moteur imposé par le créneau');
  }

  return parts.join(' — ');
}
