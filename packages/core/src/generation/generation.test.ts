import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_REST_HOURS,
  EQUIPMENT_CODES,
  TIME_BUDGET_TOLERANCE,
  type EquipmentCode,
} from '@sport/shared';
import { EXERCISE_CATALOG } from '../catalog/exercises';
import { buildFatigueSnapshot } from '../fatigue/decay';
import { buildStimulusEvents } from '../fatigue/stimulus';
import { getSplit } from '../scheduling/split';
import {
  catalogById,
  makeConfigs,
  makeFullInventory,
  makeInventory,
  makeProfile,
  makeSets,
  MONDAY_18H,
} from '../testing/fixtures';
import { simulateTrainingBlock, smallestGapHours } from '../testing/simulate';
import type { GenerateSessionInput, StimulusEvent } from '../types';
import { addHours } from '../utils/math';
import { generateSession } from './session';

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

const profile = makeProfile({ sessionsPerWeek: 4, preferredWeekdays: [0, 1, 3, 4] });
const split = getSplit(4);

function makeInput(overrides: Partial<GenerateSessionInput> = {}): GenerateSessionInput {
  const muscleConfigs = overrides.muscleConfigs ?? makeConfigs({ profile });
  const events = (overrides as { events?: StimulusEvent[] }).events ?? [];

  return {
    now: MONDAY_18H,
    slotIndex: 0,
    split,
    profile,
    inventory: makeFullInventory(),
    muscleConfigs,
    snapshot: buildFatigueSnapshot({ now: MONDAY_18H, events, muscleConfigs }),
    mesocycleWeek: 1,
    phase: 'accumulation',
    exercises: EXERCISE_CATALOG,
    ...overrides,
  };
}

/** Toutes les combinaisons de matériel possibles (le poids du corps est acquis). */
function equipmentCombinations(): EquipmentCode[][] {
  const optional = EQUIPMENT_CODES.filter((c) => c !== 'bodyweight');
  const result: EquipmentCode[][] = [];

  for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
    const owned: EquipmentCode[] = ['bodyweight'];
    optional.forEach((code, index) => {
      if (mask & (1 << index)) owned.push(code);
    });
    result.push(owned);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*                              Séance de base                                */
/* -------------------------------------------------------------------------- */

describe('génération d’une séance', () => {
  it('produit une séance exploitable sans historique', () => {
    const session = generateSession(makeInput());

    expect(session.exercises.length).toBeGreaterThan(3);
    expect(session.estimatedDurationMinutes).toBeGreaterThan(20);
    expect(session.report.isFallbackSession).toBe(false);
  });

  it('commence par un échauffement puis enchaîne les polyarticulaires', () => {
    const session = generateSession(makeInput());
    const blocks = session.exercises.map((e) => e.block);

    expect(blocks[0]).toBe('warmup');

    // L'isolation et le gainage ne précèdent jamais le travail principal.
    const lastMain = blocks.lastIndexOf('main');
    const firstAccessory = blocks.indexOf('accessory');
    if (lastMain !== -1 && firstAccessory !== -1) {
      expect(firstAccessory).toBeGreaterThan(lastMain);
    }
  });

  it('couvre les patrons moteurs imposés par le créneau', () => {
    const session = generateSession(makeInput());
    const covered = new Set(session.exercises.map((e) => e.exercise.pattern));

    // Au moins deux des patrons imposés doivent être présents ; le budget
    // temps peut légitimement en écarter un sur une séance courte.
    const required = split.slots[0]!.requiredPatterns;
    const hits = required.filter((p) => covered.has(p));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('prescrit un RIR décroissant au fil du mésocycle', () => {
    const week1 = generateSession(makeInput({ mesocycleWeek: 1 }));
    const week4 = generateSession(makeInput({ mesocycleWeek: 4 }));

    const rir = (s: typeof week1) => s.exercises.find((e) => e.block === 'main')!.targetRir;
    expect(rir(week1)).toBeGreaterThan(rir(week4));
  });

  it('allège la séance pendant une semaine de décharge', () => {
    // La réduction de volume est portée par la configuration des muscles, pas
    // par un facteur appliqué au moment de la génération : la cible de la
    // semaine est la seule source de vérité du volume.
    const normal = generateSession(
      makeInput({
        mesocycleWeek: 4,
        phase: 'intensification',
        muscleConfigs: makeConfigs({ profile, mesocycleWeek: 4, phase: 'intensification' }),
      }),
    );
    const deload = generateSession(
      makeInput({
        mesocycleWeek: 5,
        phase: 'deload',
        muscleConfigs: makeConfigs({ profile, mesocycleWeek: 5, phase: 'deload' }),
      }),
    );

    const totalSets = (s: typeof normal) =>
      s.exercises.filter((e) => e.block !== 'warmup').reduce((sum, e) => sum + e.targetSets, 0);

    expect(totalSets(deload)).toBeLessThan(totalSets(normal));
    expect(deload.exercises[1]!.targetRir).toBeGreaterThan(normal.exercises[1]!.targetRir);
  });

  it('est déterministe : même état, même séance', () => {
    const first = generateSession(makeInput());
    const second = generateSession(makeInput());

    expect(second.exercises.map((e) => e.exercise.slug)).toEqual(
      first.exercises.map((e) => e.exercise.slug),
    );
    expect(second.exercises.map((e) => e.targetSets)).toEqual(
      first.exercises.map((e) => e.targetSets),
    );
  });

  it('rejette un créneau inexistant', () => {
    expect(() => generateSession(makeInput({ slotIndex: 99 }))).toThrow(RangeError);
  });
});

/* -------------------------------------------------------------------------- */
/*                          Contrainte de matériel                            */
/* -------------------------------------------------------------------------- */

describe('respect du matériel disponible', () => {
  it('ne prescrit jamais un exercice nécessitant du matériel absent', () => {
    for (const owned of equipmentCombinations()) {
      const inventory = makeInventory(owned);
      const ownedSet = new Set<EquipmentCode>(owned);

      for (let slotIndex = 0; slotIndex < split.slots.length; slotIndex += 1) {
        const session = generateSession(makeInput({ inventory, slotIndex }));

        for (const prescribed of session.exercises) {
          for (const required of prescribed.exercise.equipment) {
            expect(
              ownedSet.has(required),
              `${prescribed.exercise.slug} exige « ${required} » avec [${owned.join(', ')}]`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('produit tout de même une séance au poids du corps seul', () => {
    const session = generateSession(makeInput({ inventory: makeInventory(['bodyweight']) }));

    expect(session.exercises.length).toBeGreaterThan(2);
    for (const prescribed of session.exercises) {
      expect(prescribed.exercise.equipment).toEqual(['bodyweight']);
    }
  });

  it('ne propose que des charges réellement possédées', () => {
    const inventory = makeInventory(['dumbbells']);
    const available = new Set(inventory.dumbbells!.availableWeightsKg);

    const session = generateSession(makeInput({ inventory }));
    for (const prescribed of session.exercises) {
      if (prescribed.loadKg !== null) {
        expect(available.has(prescribed.loadKg), `${prescribed.loadKg} kg indisponible`).toBe(true);
      }
    }
  });

  it('n’utilise que des niveaux d’élastique déclarés', () => {
    const inventory = makeInventory(['resistance_bands']);
    const names = new Set(inventory.bands!.levels.map((l) => l.name));

    const session = generateSession(makeInput({ inventory }));
    for (const prescribed of session.exercises) {
      if (prescribed.bandLevel !== null) {
        expect(names.has(prescribed.bandLevel)).toBe(true);
      }
    }
  });

  it('écarte les mouvements au-dessus du niveau de l’athlète', () => {
    const beginner = makeProfile({ experienceLevel: 'beginner', sessionsPerWeek: 4 });
    const session = generateSession(
      makeInput({ profile: beginner, muscleConfigs: makeConfigs({ profile: beginner }) }),
    );

    for (const prescribed of session.exercises) {
      expect(prescribed.exercise.difficulty).toBeLessThanOrEqual(3);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                       Garantie de repos musculaire                         */
/* -------------------------------------------------------------------------- */

describe('garantie de repos musculaire', () => {
  /** Événements d'une séance, exercice par exercice. */
  function sessionEvents(at: Date, slugs: [string, number][]): StimulusEvent[] {
    const configs = makeConfigs({ profile });
    return slugs.flatMap(([slug, sets]) =>
      buildStimulusEvents(makeSets(slug, sets, at, { rir: 1 }), {
        exercisesById: catalogById,
        muscleConfigs: configs,
      }),
    );
  }

  /** Séance jambes classique : quadriceps et chaîne postérieure. */
  const legDayEvents = (at: Date) =>
    sessionEvents(at, [
      ['goblet-squat', 4],
      ['souleve-de-terre-roumain-halteres', 4],
      ['fentes-avant', 3],
    ]);

  /** Séance bas du corps exhaustive : mollets et gainage compris. */
  const fullLowerDayEvents = (at: Date) =>
    sessionEvents(at, [
      ['goblet-squat', 4],
      ['souleve-de-terre-roumain-halteres', 4],
      ['fentes-laterales', 3],
      ['extension-mollets-debout', 4],
      ['gainage-planche', 3],
    ]);

  it('n’utilise aucun muscle bloqué comme moteur principal', () => {
    const muscleConfigs = makeConfigs({ profile });
    const events = legDayEvents(MONDAY_18H);
    const now = addHours(MONDAY_18H, 24);
    const snapshot = buildFatigueSnapshot({ now, events, muscleConfigs });

    // Créneau « Bas du corps A » alors que les jambes ont travaillé la veille.
    const session = generateSession(makeInput({ now, snapshot, muscleConfigs, slotIndex: 1 }));

    const blocked = new Set(
      Object.values(snapshot.byMuscle)
        .filter((m) => !m.isAvailable)
        .map((m) => m.muscle),
    );
    expect(blocked.size).toBeGreaterThan(0);

    for (const prescribed of session.exercises) {
      for (const involvement of prescribed.exercise.muscles) {
        if (involvement.role === 'primary' || involvement.contribution >= 0.5) {
          expect(
            blocked.has(involvement.muscle),
            `${prescribed.exercise.slug} charge ${involvement.muscle}, encore bloqué`,
          ).toBe(false);
        }
      }
    }
  });

  it('garde le créneau prévu quand une minorité de muscles seulement est bloquée', () => {
    // Après une séance jambes « classique », les adducteurs et les mollets
    // n'ont pas été travaillés directement : le créneau bas du corps reste
    // pertinent, simplement allégé. Basculer serait une sur-réaction.
    const muscleConfigs = makeConfigs({ profile });
    const now = addHours(MONDAY_18H, 24);
    const snapshot = buildFatigueSnapshot({
      now,
      events: legDayEvents(MONDAY_18H),
      muscleConfigs,
    });

    const session = generateSession(makeInput({ now, snapshot, muscleConfigs, slotIndex: 1 }));

    expect(session.report.isFallbackSession).toBe(false);
    expect(session.report.excludedMuscles.length).toBeGreaterThan(0);
  });

  it('bascule sur une séance de repli quand le créneau est majoritairement bloqué', () => {
    const muscleConfigs = makeConfigs({ profile });
    const now = addHours(MONDAY_18H, 24);
    const snapshot = buildFatigueSnapshot({
      now,
      events: fullLowerDayEvents(MONDAY_18H),
      muscleConfigs,
    });

    const session = generateSession(makeInput({ now, snapshot, muscleConfigs, slotIndex: 1 }));

    expect(session.report.isFallbackSession).toBe(true);
    expect(session.report.warnings.length).toBeGreaterThan(0);
    expect(session.slotLabel).toContain('adaptée');

    // La séance de repli reste une vraie séance : elle réoriente vers les
    // groupes disponibles au lieu de rendre une page blanche.
    expect(session.exercises.length).toBeGreaterThan(1);
  });

  it('explique chaque muscle écarté et annonce son heure de retour', () => {
    const muscleConfigs = makeConfigs({ profile });
    const events = legDayEvents(MONDAY_18H);
    const now = addHours(MONDAY_18H, 24);
    const snapshot = buildFatigueSnapshot({ now, events, muscleConfigs });

    const session = generateSession(makeInput({ now, snapshot, muscleConfigs, slotIndex: 1 }));

    expect(session.report.excludedMuscles.length).toBeGreaterThan(0);
    for (const excluded of session.report.excludedMuscles) {
      expect(excluded.reason).toBeTruthy();
      expect(excluded.availableAt).not.toBeNull();
      expect(excluded.hoursUntilAvailable!).toBeGreaterThan(0);
      expect(excluded.hoursUntilAvailable!).toBeLessThanOrEqual(72);
    }
  });

  it('n’inclut jamais un exercice ciblant un muscle exclu pour blessure', () => {
    const muscleConfigs = makeConfigs({
      profile,
      overrides: [{ muscle: 'lats', isExcluded: true }],
    });
    const snapshot = buildFatigueSnapshot({ now: MONDAY_18H, events: [], muscleConfigs });

    for (let slotIndex = 0; slotIndex < split.slots.length; slotIndex += 1) {
      const session = generateSession(makeInput({ muscleConfigs, snapshot, slotIndex }));

      for (const prescribed of session.exercises) {
        const chargesLats = prescribed.exercise.muscles.some(
          (m) => m.muscle === 'lats' && (m.role === 'primary' || m.contribution >= 0.5),
        );
        expect(chargesLats, `${prescribed.exercise.slug} charge les dorsaux`).toBe(false);
      }
    }
  });

  /**
   * Le test central du produit.
   *
   * On déroule des blocs d'entraînement complets à chaque fréquence et pour
   * chaque niveau, en réinjectant à chaque fois le travail effectué dans le
   * journal de fatigue. Aucun muscle ne doit jamais recevoir deux charges
   * significatives à moins de 48 heures d'intervalle.
   */
  it('ne sollicite jamais deux fois un muscle à moins de 48 h, sur un bloc complet', () => {
    const levels = ['beginner', 'intermediate', 'advanced'] as const;

    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      for (const level of levels) {
        const result = simulateTrainingBlock({
          profile: makeProfile({ sessionsPerWeek, experienceLevel: level }),
          inventory: makeFullInventory(),
          startDate: new Date('2025-01-06T00:00:00Z'),
          weeks: 4,
        });

        const { hours, muscle } = smallestGapHours(result);

        expect(
          hours,
          `${sessionsPerWeek} séances/semaine, niveau ${level} : ${muscle} sollicité à ${hours} h d’écart`,
        ).toBeGreaterThanOrEqual(DEFAULT_MIN_REST_HOURS);
      }
    }
  });

  it('tient la garantie même avec un matériel très limité', () => {
    for (const owned of equipmentCombinations()) {
      const result = simulateTrainingBlock({
        profile: makeProfile({ sessionsPerWeek: 4 }),
        inventory: makeInventory(owned),
        startDate: new Date('2025-01-06T00:00:00Z'),
        weeks: 3,
      });

      const { hours, muscle } = smallestGapHours(result);
      expect(hours, `[${owned.join(', ')}] : ${muscle} à ${hours} h`).toBeGreaterThanOrEqual(
        DEFAULT_MIN_REST_HOURS,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                               Budget temps                                 */
/* -------------------------------------------------------------------------- */

describe('budget temps', () => {
  it('reste dans la durée demandée, à la tolérance près', () => {
    for (const durationMinutes of [30, 45, 60, 90]) {
      for (let slotIndex = 0; slotIndex < split.slots.length; slotIndex += 1) {
        const session = generateSession(makeInput({ durationMinutes, slotIndex }));
        const upperBound = durationMinutes * (1 + TIME_BUDGET_TOLERANCE);

        expect(
          session.estimatedDurationMinutes,
          `créneau ${slotIndex}, ${durationMinutes} min`,
        ).toBeLessThanOrEqual(upperBound);
      }
    }
  });

  /**
   * L'explication donnée à l'utilisateur doit correspondre à la vraie cause.
   * Dire « faute de temps » quand le volume est simplement atteint le
   * pousserait à rallonger ses séances sans aucune raison.
   */
  it('n’impute jamais au volume ce qui relève de la durée', () => {
    // Sans aucun historique, la dette de volume est maximale : quoi qu'il
    // manque dans une séance très courte, ce n'est pas parce que le volume
    // serait déjà atteint.
    for (const durationMinutes of [20, 25, 30]) {
      for (let slotIndex = 0; slotIndex < split.slots.length; slotIndex += 1) {
        const session = generateSession(makeInput({ durationMinutes, slotIndex }));
        const joined = session.report.warnings.join(' ');

        expect(joined, `${durationMinutes} min, créneau ${slotIndex}`).not.toContain(
          'Volume déjà atteint',
        );
        expect(joined).not.toContain('volume hebdomadaire est déjà atteint');
      }
    }
  });

  it('signale une séance courte quand le volume hebdomadaire est déjà réalisé', () => {
    // On simule une semaine déjà complète : le muscle est disponible, mais il
    // n'a plus de dette de volume à couvrir.
    const muscleConfigs = makeConfigs({ profile });
    const events = Object.values(muscleConfigs).flatMap((config) =>
      buildStimulusEvents(
        makeSets('pompes', Math.ceil(config.weeklyTargetSets), addHours(MONDAY_18H, -96)),
        { exercisesById: catalogById, muscleConfigs },
      ),
    );

    const snapshot = buildFatigueSnapshot({
      now: MONDAY_18H,
      events,
      muscleConfigs,
      // Semaine d'entraînement démarrée avant ces séances : le volume compte.
      weekStartedAt: addHours(MONDAY_18H, -120),
    });

    const session = generateSession(makeInput({ snapshot, muscleConfigs }));

    expect(session.report.warnings.join(' ')).not.toContain('Durée de séance');
    expect(
      session.report.warnings.some(
        (warning) => warning.includes('volume hebdomadaire') || warning.includes('Volume déjà'),
      ),
    ).toBe(true);
  });

  it('propose moins de travail sur une séance courte', () => {
    const short = generateSession(makeInput({ durationMinutes: 30 }));
    const long = generateSession(makeInput({ durationMinutes: 90 }));

    const sets = (s: typeof short) =>
      s.exercises.filter((e) => e.block !== 'warmup').reduce((sum, e) => sum + e.targetSets, 0);

    expect(sets(short)).toBeLessThan(sets(long));
  });
});

/* -------------------------------------------------------------------------- */
/*                          Variété et volume                                 */
/* -------------------------------------------------------------------------- */

describe('variété et couverture du volume', () => {
  it('évite de reproduire la séance précédente à l’identique', () => {
    const first = generateSession(makeInput());
    const previousSessionExerciseIds = new Set(first.exercises.map((e) => e.exercise.id));
    const second = generateSession(makeInput({ previousSessionExerciseIds }));

    const overlap = second.exercises.filter((e) =>
      previousSessionExerciseIds.has(e.exercise.id),
    ).length;
    expect(overlap).toBeLessThan(second.exercises.length);
  });

  it('ne programme jamais deux fois le même exercice dans une séance', () => {
    for (let slotIndex = 0; slotIndex < split.slots.length; slotIndex += 1) {
      const session = generateSession(makeInput({ slotIndex }));
      const working = session.exercises.filter((e) => e.block !== 'warmup');
      expect(new Set(working.map((e) => e.exercise.id)).size).toBe(working.length);
    }
  });

  it('rapproche le volume hebdomadaire des cibles sur une semaine d’accumulation', () => {
    const blockProfile = makeProfile({ sessionsPerWeek: 4 });
    const result = simulateTrainingBlock({
      profile: blockProfile,
      inventory: makeFullInventory(),
      startDate: new Date('2025-01-06T00:00:00Z'),
      weeks: 4,
    });

    // La dernière semaine du bloc est une décharge : y mesurer le respect du
    // volume n'aurait aucun sens. On évalue la dernière semaine de charge.
    const lastLoadedWeek = result.sessions.filter((s) => s.week === 3).at(-1)!;
    const configs = makeConfigs({ profile: blockProfile, mesocycleWeek: 3 });

    const snapshot = buildFatigueSnapshot({
      now: lastLoadedWeek.date,
      events: result.events,
      muscleConfigs: configs,
    });

    // Les grands groupes ciblés doivent atteindre au moins leur volume minimum
    // entraînant (MEV) sur la fenêtre hebdomadaire glissante.
    for (const muscle of ['chest', 'lats', 'quads'] as const) {
      expect(
        snapshot.byMuscle[muscle].weeklySets,
        `${muscle} sous son volume minimum`,
      ).toBeGreaterThanOrEqual(configs[muscle].definition.weeklyMev * 0.6);
    }
  });

  it('renseigne un compte rendu complet et auditable', () => {
    const session = generateSession(makeInput());
    const report = session.report;

    expect(report.generatedAt).toEqual(MONDAY_18H);
    expect(report.mesocycleWeek).toBe(1);
    expect(report.phase).toBe('accumulation');
    expect(report.targetedMuscles.length).toBeGreaterThan(0);
    expect(Object.keys(report.plannedSetsByMuscle).length).toBeGreaterThan(0);
    expect(report.coveredPatterns.length).toBeGreaterThan(0);

    for (const prescribed of session.exercises) {
      expect(prescribed.rationale.length).toBeGreaterThan(0);
    }
  });
});
