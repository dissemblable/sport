import { describe, expect, it } from 'vitest';
import { EXERCISE_BY_SLUG } from '../catalog/exercises';
import { makeFullInventory, makeInventory, makeSets, MONDAY_18H } from '../testing/fixtures';
import type { ProgressionState } from '../types';
import {
  evaluateProgression,
  findEasierVariant,
  findHarderVariant,
  initialProgressionState,
} from './doubleProgression';
import { nearestAvailableWeight, nextAvailableWeight, prescribeLoad } from './prescription';

const inventory = makeFullInventory();
const curl = EXERCISE_BY_SLUG['curl-biceps-halteres']!;
const pushups = EXERCISE_BY_SLUG['pompes']!;
const bandCurl = EXERCISE_BY_SLUG['curl-biceps-elastique']!;

function stateFor(overrides: Partial<ProgressionState> = {}): ProgressionState {
  return { ...initialProgressionState(curl), ...overrides };
}

describe('choix de charge', () => {
  it('ne propose que des charges réellement possédées', () => {
    const available = [4, 6, 8, 10];
    expect(nearestAvailableWeight(7.4, available)).toBe(8);
    expect(nearestAvailableWeight(100, available)).toBe(10);
    expect(nearestAvailableWeight(5, [])).toBeNull();
  });

  it('trouve le palier immédiatement supérieur', () => {
    expect(nextAvailableWeight(6, [4, 6, 8, 10])).toBe(8);
    expect(nextAvailableWeight(10, [4, 6, 8, 10])).toBeNull();
  });

  it('démarre prudemment en l’absence d’historique et l’explique', () => {
    const prescription = prescribeLoad(curl, inventory, undefined);

    expect(prescription.loadKg).not.toBeNull();
    expect(prescription.loadKg!).toBeLessThan(12);
    expect(prescription.note).toContain('prudente');
  });

  it('charge plus lourd un polyarticulaire qu’une isolation', () => {
    const press = EXERCISE_BY_SLUG['developpe-halteres-sol']!;
    const compound = prescribeLoad(press, inventory, undefined).loadKg!;
    const isolation = prescribeLoad(curl, inventory, undefined).loadKg!;

    expect(compound).toBeGreaterThanOrEqual(isolation);
  });

  it('reprend la charge de la dernière séance quand elle est connue', () => {
    const prescription = prescribeLoad(curl, inventory, stateFor({ currentLoadKg: 12 }));
    expect(prescription.loadKg).toBe(12);
    expect(prescription.note).toBeNull();
  });

  it('choisit l’élastique le plus léger au premier passage', () => {
    const prescription = prescribeLoad(bandCurl, inventory, undefined);
    expect(prescription.bandLevel).toBe('Jaune');
    expect(prescription.loadKg).toBeNull();
  });

  it('ne prescrit ni charge ni élastique pour un mouvement au poids du corps', () => {
    const prescription = prescribeLoad(pushups, inventory, undefined);
    expect(prescription.loadKg).toBeNull();
    expect(prescription.bandLevel).toBeNull();
  });

  it('ne prescrit aucune charge si l’utilisateur n’a pas d’haltères', () => {
    const prescription = prescribeLoad(curl, makeInventory(['bodyweight']), undefined);
    expect(prescription.loadKg).toBeNull();
  });
});

describe('double progression', () => {
  const evaluate = (
    sets: ReturnType<typeof makeSets>,
    state: ProgressionState,
    exercise = curl,
  ) =>
    evaluateProgression({
      exercise,
      sets,
      state,
      inventory,
      targetRepMin: exercise.defaultRepMin,
      targetRepMax: exercise.defaultRepMax,
    });

  it('monte les répétitions tant que le haut de fourchette n’est pas atteint', () => {
    const sets = makeSets('curl-biceps-halteres', 3, MONDAY_18H, { reps: 11, rir: 2 });
    const decision = evaluate(sets, stateFor({ currentLoadKg: 10 }));

    expect(decision.action).toBe('increase_reps');
    expect(decision.nextState.currentLoadKg).toBe(10);
    expect(decision.nextState.currentRepTarget).toBeGreaterThan(11);
  });

  it('ajoute le palier de charge suivant une fois le haut de fourchette validé', () => {
    // curl-biceps-halteres : fourchette 8–15 répétitions.
    const sets = makeSets('curl-biceps-halteres', 3, MONDAY_18H, { reps: 15, rir: 1 });
    const decision = evaluate(sets, stateFor({ currentLoadKg: 10 }));

    expect(decision.action).toBe('increase_load');
    expect(decision.nextState.currentLoadKg).toBe(12);
    // On repart en bas de fourchette avec la nouvelle charge.
    expect(decision.nextState.currentRepTarget).toBe(curl.defaultRepMin);
  });

  it('exige que toutes les séries valident le palier, pas seulement la première', () => {
    const sets = [
      ...makeSets('curl-biceps-halteres', 1, MONDAY_18H, { reps: 15, rir: 1 }),
      ...makeSets('curl-biceps-halteres', 1, MONDAY_18H, { reps: 11, rir: 1 }),
    ];
    const decision = evaluate(sets, stateFor({ currentLoadKg: 10 }));

    expect(decision.action).toBe('increase_reps');
    expect(decision.nextState.currentLoadKg).toBe(10);
  });

  it('ne valide pas un palier atteint trop loin de l’échec', () => {
    const sets = makeSets('curl-biceps-halteres', 3, MONDAY_18H, { reps: 15, rir: 4 });
    const decision = evaluate(sets, stateFor({ currentLoadKg: 10 }));
    expect(decision.action).not.toBe('increase_load');
  });

  it('passe à l’élastique supérieur quand c’est l’axe disponible', () => {
    const sets = makeSets('curl-biceps-elastique', 3, MONDAY_18H, { reps: 25, rir: 1 });
    const decision = evaluate(
      sets,
      { ...initialProgressionState(bandCurl), currentBandLevel: 'Jaune' },
      bandCurl,
    );

    expect(decision.action).toBe('increase_band');
    expect(decision.nextState.currentBandLevel).toBe('Rouge');
  });

  it('propose la variante supérieure quand aucune charge ne peut être ajoutée', () => {
    const sets = makeSets('pompes', 3, MONDAY_18H, { reps: 20, rir: 0 });
    const decision = evaluate(sets, initialProgressionState(pushups), pushups);

    expect(decision.action).toBe('advance_variant');
    expect(decision.suggestedExerciseId).toBe(EXERCISE_BY_SLUG['pompes-declinees']!.id);
  });

  it('tolère un premier échec sans rien changer', () => {
    const sets = makeSets('curl-biceps-halteres', 3, MONDAY_18H, { reps: 6, rir: 0 });
    const decision = evaluate(sets, stateFor({ currentLoadKg: 12 }));

    expect(decision.action).toBe('hold');
    expect(decision.nextState.currentLoadKg).toBe(12);
    expect(decision.nextState.consecutiveFailures).toBe(1);
  });

  it('régresse après deux échecs consécutifs', () => {
    const sets = makeSets('curl-biceps-halteres', 3, MONDAY_18H, { reps: 6, rir: 0 });
    const decision = evaluate(sets, stateFor({ currentLoadKg: 12, consecutiveFailures: 1 }));

    expect(decision.action).toBe('regress');
    expect(decision.nextState.currentLoadKg).toBe(10);
    expect(decision.nextState.consecutiveFailures).toBe(0);
    expect(decision.note).toContain('10 kg');
  });

  it('bascule sur une variante plus facile quand il n’y a plus de charge à retirer', () => {
    const declined = EXERCISE_BY_SLUG['pompes-declinees']!;
    const sets = makeSets('pompes-declinees', 3, MONDAY_18H, { reps: 3, rir: 0 });
    const decision = evaluate(
      sets,
      { ...initialProgressionState(declined), consecutiveFailures: 1 },
      declined,
    );

    expect(decision.action).toBe('regress');
    expect(decision.suggestedExerciseId).toBe(EXERCISE_BY_SLUG['pompes']!.id);
  });

  it('ralentit le tempo quand tous les axes sont épuisés', () => {
    const oneArm = EXERCISE_BY_SLUG['pompes-une-main']!;
    const sets = makeSets('pompes-une-main', 3, MONDAY_18H, { reps: 8, rir: 0 });
    const decision = evaluate(sets, initialProgressionState(oneArm), oneArm);

    expect(decision.action).toBe('add_tempo');
    expect(decision.note).toContain('descente');
  });

  it('ne décide rien sans série de travail', () => {
    const decision = evaluate([], stateFor({ currentLoadKg: 10 }));
    expect(decision.action).toBe('increase_reps');
    expect(decision.nextState.currentLoadKg).toBe(10);
  });
});

describe('chaînes de progression du catalogue', () => {
  it('ordonne les variantes de la plus accessible à la plus difficile', () => {
    const knees = EXERCISE_BY_SLUG['pompes-genoux']!;
    const oneArm = EXERCISE_BY_SLUG['pompes-une-main']!;

    expect(findEasierVariant(knees)).toBeNull();
    expect(findHarderVariant(oneArm)).toBeNull();
    expect(findHarderVariant(knees)).toBe(EXERCISE_BY_SLUG['pompes-inclinees']!.id);
  });

  it('renvoie null pour un exercice sans famille de progression', () => {
    const shrug = EXERCISE_BY_SLUG['shrug-halteres']!;
    expect(findHarderVariant(shrug)).toBeNull();
    expect(findEasierVariant(shrug)).toBeNull();
  });

  it('chaîne la progression des tractions du plus facile au lesté', () => {
    const negatives = EXERCISE_BY_SLUG['tractions-negatives']!;
    const weighted = EXERCISE_BY_SLUG['tractions-lestees']!;

    expect(negatives.progressionRank).toBeLessThan(weighted.progressionRank);
    expect(findHarderVariant(negatives)).toBe(
      EXERCISE_BY_SLUG['tractions-assistees-elastique']!.id,
    );
  });
});
