import { describe, expect, it } from 'vitest';
import { DEFAULT_MIN_REST_HOURS, FATIGUE_BLOCKING_THRESHOLD } from '@sport/shared';
import { catalogById, makeConfigs, makeSets, MONDAY_18H } from '../testing/fixtures';
import { addHours, hoursBetween } from '../utils/math';
import { buildFatigueSnapshot, decayFactor, fatigueScoreAt, predictTimeBelow } from './decay';
import { buildStimulusEvents } from './stimulus';
import type { StimulusEvent } from '../types';

/**
 * Ces tests valident l'exigence centrale du produit : la fenêtre de
 * récupération de 48 à 72 heures par groupe musculaire.
 */

const configs = makeConfigs();

/**
 * Simule une séance pectoraux et renvoie les événements produits.
 * 8 séries correspond au volume d'une séance pleine pour les pectoraux dans un
 * découpage haut/bas à 4 séances — c'est le cas de référence du calibrage.
 */
function chestSession(at: Date, sets = 8): StimulusEvent[] {
  return buildStimulusEvents(makeSets('developpe-halteres-sol', sets, at, { rir: 1 }), {
    exercisesById: catalogById,
    muscleConfigs: configs,
  });
}

describe('décroissance exponentielle', () => {
  it('retire exactement la moitié du stimulus après une demi-vie', () => {
    expect(decayFactor(0, 30)).toBe(1);
    expect(decayFactor(30, 30)).toBeCloseTo(0.5, 6);
    expect(decayFactor(60, 30)).toBeCloseTo(0.25, 6);
  });

  it('est strictement décroissante dans le temps', () => {
    const events = chestSession(MONDAY_18H);
    let previous = Number.POSITIVE_INFINITY;

    for (let hours = 0; hours <= 168; hours += 6) {
      const value = fatigueScoreAt(events, addHours(MONDAY_18H, hours));
      expect(value).toBeLessThan(previous);
      previous = value;
    }
  });

  it('accumule la fatigue de deux séances rapprochées', () => {
    const single = chestSession(MONDAY_18H);
    const doubled = [...single, ...chestSession(addHours(MONDAY_18H, 24))];

    const at = addHours(MONDAY_18H, 48);
    expect(fatigueScoreAt(doubled, at)).toBeGreaterThan(fatigueScoreAt(single, at) * 1.5);
  });

  it('ignore les événements datés dans le futur', () => {
    const events = chestSession(addHours(MONDAY_18H, 24));
    expect(fatigueScoreAt(events, MONDAY_18H)).toBe(0);
  });
});

describe('fenêtre de récupération 48–72 h', () => {
  const events = chestSession(MONDAY_18H);

  const snapshotAt = (hours: number) =>
    buildFatigueSnapshot({
      now: addHours(MONDAY_18H, hours),
      events,
      muscleConfigs: configs,
    }).byMuscle.chest;

  it('classe le muscle en « fatigué » juste après la séance', () => {
    const state = snapshotAt(0);
    expect(state.status).toBe('fatigued');
    expect(state.isAvailable).toBe(false);
    expect(state.fatiguePct).toBeGreaterThan(FATIGUE_BLOCKING_THRESHOLD);
  });

  it('maintient le blocage à 24 h alors que la fatigue est déjà retombée', () => {
    const state = snapshotAt(24);

    // Le score seul autoriserait déjà le travail ; le plancher horaire, lui,
    // ne le permet pas. C'est précisément la garantie recherchée.
    expect(state.fatiguePct).toBeLessThan(FATIGUE_BLOCKING_THRESHOLD);
    expect(state.isAvailable).toBe(false);
    expect(state.blockedBy).toBe('min_rest_not_elapsed');
  });

  it('reste bloqué jusqu’à la dernière minute avant 48 h', () => {
    expect(snapshotAt(47.9).isAvailable).toBe(false);
  });

  it('libère le muscle exactement à 48 h', () => {
    const state = snapshotAt(DEFAULT_MIN_REST_HOURS);
    expect(state.isAvailable).toBe(true);
    expect(state.blockedBy).toBeNull();
    expect(state.status).toBe('ready');
  });

  it('déclare la récupération complète à l’intérieur de la fenêtre de 72 h', () => {
    const state = snapshotAt(0);
    expect(state.fullyRecoveredAt).not.toBeNull();

    const hours = hoursBetween(MONDAY_18H, state.fullyRecoveredAt!);
    expect(hours).toBeGreaterThanOrEqual(DEFAULT_MIN_REST_HOURS);
    expect(hours).toBeLessThanOrEqual(72);
  });

  it('annonce une disponibilité qui ne devance jamais le plancher de 48 h', () => {
    // Même après une séance très légère, dont la fatigue retombe en quelques
    // heures, l'échéance annoncée reste le plancher horaire.
    const light = chestSession(MONDAY_18H, 2);
    const state = buildFatigueSnapshot({
      now: addHours(MONDAY_18H, 2),
      events: light,
      muscleConfigs: configs,
    }).byMuscle.chest;

    expect(state.isAvailable).toBe(false);
    expect(hoursBetween(MONDAY_18H, state.availableAt!)).toBeCloseTo(DEFAULT_MIN_REST_HOURS, 3);
  });

  it('retarde la récupération complète quand deux séances se cumulent', () => {
    const single = chestSession(MONDAY_18H);
    const doubled = [...single, ...chestSession(addHours(MONDAY_18H, 24))];
    const at = addHours(MONDAY_18H, 24);

    const recoveredSingle = buildFatigueSnapshot({ now: at, events: single, muscleConfigs: configs })
      .byMuscle.chest.fullyRecoveredAt!;
    const recoveredDoubled = buildFatigueSnapshot({
      now: at,
      events: doubled,
      muscleConfigs: configs,
    }).byMuscle.chest.fullyRecoveredAt!;

    expect(recoveredDoubled.getTime()).toBeGreaterThan(recoveredSingle.getTime());
  });
});

describe('surcharge accumulée', () => {
  /**
   * Quatre séances lourdes à 24 h d'intervalle : un scénario que le plancher
   * horaire seul ne détecterait pas, puisque chaque séance respecterait
   * formellement son délai vis-à-vis de la précédente.
   */
  const overload = [0, 24, 48, 72].flatMap((offset) =>
    chestSession(addHours(MONDAY_18H, offset), 10),
  );
  const lastSession = addHours(MONDAY_18H, 72);

  it('repousse la disponibilité au-delà du plancher de 48 h', () => {
    const atFloor = addHours(lastSession, DEFAULT_MIN_REST_HOURS);
    const state = buildFatigueSnapshot({
      now: atFloor,
      events: overload,
      muscleConfigs: configs,
    }).byMuscle.chest;

    // Le repos minimum est écoulé, mais la fatigue résiduelle cumulée bloque
    // encore : c'est l'apport du score continu par rapport à une règle horaire.
    expect(state.blockedBy).toBe('fatigue_too_high');
    expect(state.isAvailable).toBe(false);
    expect(hoursBetween(lastSession, state.availableAt!)).toBeGreaterThan(DEFAULT_MIN_REST_HOURS);
  });

  it('classe le muscle en surmenage juste après la dernière séance', () => {
    const state = buildFatigueSnapshot({
      now: lastSession,
      events: overload,
      muscleConfigs: configs,
    }).byMuscle.chest;

    expect(state.status).toBe('overreached');
    expect(state.fatiguePct).toBeGreaterThan(0.9);
  });
});

describe('prédiction de disponibilité', () => {
  it('renvoie l’instant courant lorsque le seuil est déjà franchi', () => {
    const events = chestSession(MONDAY_18H, 1);
    const at = addHours(MONDAY_18H, 200);
    expect(predictTimeBelow(events, at, 1)?.getTime()).toBe(at.getTime());
  });

  it('encadre le franchissement de seuil à l’heure près', () => {
    const events = chestSession(MONDAY_18H);
    const threshold = FATIGUE_BLOCKING_THRESHOLD * configs.chest.capacity;

    const found = predictTimeBelow(events, MONDAY_18H, threshold);
    expect(found).not.toBeNull();
    expect(fatigueScoreAt(events, found!)).toBeLessThan(threshold);
    expect(fatigueScoreAt(events, addHours(found!, -1))).toBeGreaterThanOrEqual(threshold);
  });
});

describe('cliché de récupération', () => {
  it('n’a aucune fatigue et aucun blocage sans historique', () => {
    const snapshot = buildFatigueSnapshot({
      now: MONDAY_18H,
      events: [],
      muscleConfigs: configs,
    });

    for (const state of Object.values(snapshot.byMuscle)) {
      expect(state.fatigueScore).toBe(0);
      expect(state.status).toBe('fresh');
      expect(state.isAvailable).toBe(true);
      expect(state.lastStimulusAt).toBeNull();
    }
  });

  it('bloque un muscle exclu par l’utilisateur sans lui inventer d’échéance', () => {
    const withExclusion = makeConfigs({
      overrides: [{ muscle: 'chest', isExcluded: true }],
    });

    const state = buildFatigueSnapshot({
      now: MONDAY_18H,
      events: [],
      muscleConfigs: withExclusion,
    }).byMuscle.chest;

    expect(state.isAvailable).toBe(false);
    expect(state.blockedBy).toBe('user_excluded');
    expect(state.availableAt).toBeNull();
  });

  it('compte le volume hebdomadaire sur les 7 derniers jours glissants', () => {
    const events = [
      ...chestSession(addHours(MONDAY_18H, -24 * 3), 6),
      ...chestSession(addHours(MONDAY_18H, -24 * 9), 6), // hors fenêtre
    ];

    const state = buildFatigueSnapshot({
      now: MONDAY_18H,
      events,
      muscleConfigs: configs,
    }).byMuscle.chest;

    // 6 séries à contribution 1,0 sur les pectoraux ; la séance d'il y a 9 jours
    // est sortie de la fenêtre hebdomadaire.
    expect(state.weeklySets).toBeCloseTo(6, 1);
  });
});
