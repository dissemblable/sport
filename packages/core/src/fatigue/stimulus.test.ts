import { describe, expect, it } from 'vitest';
import { catalogById, makeConfigs, makeSets, MONDAY_18H } from '../testing/fixtures';
import { buildSorenessEvents, buildStimulusEvents, intensityFactor, volumeFactor } from './stimulus';
import { halfLifeMultiplier } from './modifiers';

const configs = makeConfigs();

describe('facteur d’intensité', () => {
  it('atteint son maximum à l’échec musculaire', () => {
    expect(intensityFactor(0)).toBe(1);
    expect(intensityFactor(5, true)).toBe(1);
  });

  it('décroît avec les répétitions en réserve', () => {
    expect(intensityFactor(1)).toBeCloseTo(0.87, 5);
    expect(intensityFactor(3)).toBeCloseTo(0.61, 5);
    expect(intensityFactor(2)).toBeGreaterThan(intensityFactor(4));
  });

  it('ne descend jamais sous un plancher, même très loin de l’échec', () => {
    expect(intensityFactor(20)).toBe(0.35);
  });

  it('suppose une intensité prudente quand le RIR n’est pas renseigné', () => {
    expect(intensityFactor(null)).toBe(intensityFactor(2));
  });
});

describe('facteur de volume', () => {
  it('forme un plateau sur la zone d’hypertrophie', () => {
    expect(volumeFactor(6, null)).toBe(1);
    expect(volumeFactor(15, null)).toBe(1);
  });

  it('pénalise les séries très courtes et majore les séries très longues', () => {
    expect(volumeFactor(3, null)).toBe(0.85);
    expect(volumeFactor(25, null)).toBe(1.1);
  });

  it('convertit une isométrie en équivalent répétitions', () => {
    // 60 secondes de gainage ≈ 20 répétitions.
    expect(volumeFactor(null, 60)).toBe(volumeFactor(20, null));
  });
});

describe('construction des événements de fatigue', () => {
  it('répartit le stimulus selon la contribution de chaque muscle', () => {
    const events = buildStimulusEvents(makeSets('tractions-supination', 4, MONDAY_18H, { rir: 1 }), {
      exercisesById: catalogById,
      muscleConfigs: configs,
    });

    const lats = events.find((e) => e.muscle === 'lats');
    const biceps = events.find((e) => e.muscle === 'biceps');
    const forearms = events.find((e) => e.muscle === 'forearms');

    expect(lats).toBeDefined();
    expect(biceps).toBeDefined();
    expect(forearms).toBeDefined();

    // Dorsaux moteur principal (1,0), biceps secondaire lourd (0,7),
    // avant-bras stabilisateur (0,2).
    expect(lats!.effectiveSets).toBeCloseTo(4, 2);
    expect(biceps!.effectiveSets).toBeCloseTo(2.8, 2);
    expect(forearms!.effectiveSets).toBeCloseTo(0.8, 2);
    expect(lats!.stimulus).toBeGreaterThan(biceps!.stimulus);
  });

  it('ignore les séries d’échauffement', () => {
    const events = buildStimulusEvents(
      makeSets('pompes', 3, MONDAY_18H, { isWarmup: true }),
      { exercisesById: catalogById, muscleConfigs: configs },
    );
    expect(events).toHaveLength(0);
  });

  it('agrège les séries d’un muscle sur l’instant de la dernière série', () => {
    const sets = makeSets('pompes', 4, MONDAY_18H, { spacingMinutes: 5 });
    const events = buildStimulusEvents(sets, {
      exercisesById: catalogById,
      muscleConfigs: configs,
    });

    const chest = events.find((e) => e.muscle === 'chest')!;
    expect(chest.occurredAt.getTime()).toBe(sets.at(-1)!.performedAt.getTime());
    expect(chest.metadata?.setCount).toBe(4);
  });

  it('applique la charge systémique de l’exercice', () => {
    const light = buildStimulusEvents(
      makeSets('developpe-elastique-debout', 1, MONDAY_18H, { rir: 1 }),
      { exercisesById: catalogById, muscleConfigs: configs },
    ).find((e) => e.muscle === 'chest')!;

    const heavy = buildStimulusEvents(makeSets('pompes-declinees', 1, MONDAY_18H, { rir: 1 }), {
      exercisesById: catalogById,
      muscleConfigs: configs,
    }).find((e) => e.muscle === 'chest')!;

    // Charge systémique 0,7 contre 1,1 : le rapport doit se retrouver
    // exactement dans le stimulus produit.
    expect(heavy.stimulus / light.stimulus).toBeCloseTo(1.1 / 0.7, 2);
  });

  it('fige la demi-vie au moment de l’enregistrement, modulée par l’état de forme', () => {
    const rested = buildStimulusEvents(makeSets('pompes', 2, MONDAY_18H), {
      exercisesById: catalogById,
      muscleConfigs: configs,
      recoveryContext: { sleepHours: 8, sleepQuality: 5 },
    }).find((e) => e.muscle === 'chest')!;

    const exhausted = buildStimulusEvents(makeSets('pompes', 2, MONDAY_18H), {
      exercisesById: catalogById,
      muscleConfigs: configs,
      recoveryContext: { sleepHours: 4, stress: 5 },
    }).find((e) => e.muscle === 'chest')!;

    expect(exhausted.halfLifeHours).toBeGreaterThan(rested.halfLifeHours);
  });

  it('ignore un exercice absent du catalogue plutôt que de planter', () => {
    const events = buildStimulusEvents(
      [
        {
          exerciseId: 999_999,
          isWarmup: false,
          reps: 10,
          loadKg: null,
          bandLevel: null,
          rir: 1,
          toFailure: false,
          durationSeconds: null,
          performedAt: MONDAY_18H,
        },
      ],
      { exercisesById: catalogById, muscleConfigs: configs },
    );
    expect(events).toHaveLength(0);
  });
});

describe('modulateurs de récupération', () => {
  it('vaut 1 en l’absence d’information', () => {
    expect(halfLifeMultiplier()).toBe(1);
  });

  it('allonge la récupération en cas de dette de sommeil', () => {
    expect(halfLifeMultiplier({ sleepHours: 5 })).toBeGreaterThan(1);
  });

  it('l’accélère après une nuit longue et réparatrice', () => {
    expect(halfLifeMultiplier({ sleepHours: 8, sleepQuality: 5 })).toBeLessThan(1);
  });

  it('reste borné même en cumulant tous les facteurs défavorables', () => {
    const worst = halfLifeMultiplier({
      sleepHours: 3,
      sleepQuality: 1,
      stress: 5,
      age: 60,
      experienceLevel: 'beginner',
    });
    expect(worst).toBeLessThanOrEqual(1.6);
    expect(worst).toBeGreaterThan(1.3);
  });
});

describe('courbatures déclarées', () => {
  it('n’ajoute rien en dessous du seuil de 3/5', () => {
    const events = buildSorenessEvents(
      [{ muscle: 'chest', soreness: 2 }],
      configs,
      MONDAY_18H,
    );
    expect(events).toHaveLength(0);
  });

  it('réinjecte de la fatigue proportionnelle à la courbature ressentie', () => {
    const moderate = buildSorenessEvents([{ muscle: 'chest', soreness: 3 }], configs, MONDAY_18H);
    const severe = buildSorenessEvents([{ muscle: 'chest', soreness: 5 }], configs, MONDAY_18H);

    expect(moderate[0]!.stimulus).toBeGreaterThan(0);
    expect(severe[0]!.stimulus).toBeGreaterThan(moderate[0]!.stimulus);
    expect(severe[0]!.source).toBe('soreness_report');
    // Une courbature n'est pas du volume d'entraînement.
    expect(severe[0]!.effectiveSets).toBe(0);
  });

  it('utilise une demi-vie plus courte que la récupération musculaire', () => {
    const events = buildSorenessEvents([{ muscle: 'quads', soreness: 4 }], configs, MONDAY_18H);
    expect(events[0]!.halfLifeHours).toBeLessThan(configs.quads.definition.recoveryHalfLifeHours);
  });
});
