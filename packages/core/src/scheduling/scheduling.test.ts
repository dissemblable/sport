import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_REST_HOURS,
  MAX_SESSIONS_PER_WEEK,
  MIN_SESSIONS_PER_WEEK,
  MUSCLE_CODES,
} from '@sport/shared';
import { makeProfile, MONDAY_18H } from '../testing/fixtures';
import { buildMesocycleSchedule, phaseForWeek, startOfWeek } from './mesocycle';
import { placeSessions } from './placement';
import { planFrequencyChange } from './redistribute';
import { defaultWeekdays, getSplit, minGapBetweenSharedMuscles } from './split';

const FREQUENCIES = [2, 3, 4, 5, 6];

describe('choix du split', () => {
  it('refuse une fréquence hors de la plage supportée', () => {
    expect(() => getSplit(1)).toThrow(RangeError);
    expect(() => getSplit(7)).toThrow(RangeError);
  });

  it('fournit autant de créneaux que de séances, pour chaque fréquence', () => {
    for (const frequency of FREQUENCIES) {
      const split = getSplit(frequency);
      expect(split.slots).toHaveLength(frequency);
      expect(split.sessionsPerWeek).toBe(frequency);
    }
  });

  it('donne un libellé et au moins un patron moteur imposé à chaque créneau', () => {
    for (const frequency of FREQUENCIES) {
      for (const slot of getSplit(frequency).slots) {
        expect(slot.label.length).toBeGreaterThan(0);
        expect(slot.targetMuscles.length).toBeGreaterThan(0);
        expect(slot.requiredPatterns.length).toBeGreaterThan(0);
      }
    }
  });

  it('ne cible que des muscles du référentiel', () => {
    for (const frequency of FREQUENCIES) {
      for (const slot of getSplit(frequency).slots) {
        for (const muscle of slot.targetMuscles) {
          expect(MUSCLE_CODES).toContain(muscle);
        }
      }
    }
  });

  it('couvre tous les grands groupes musculaires sur la semaine', () => {
    const essential = ['chest', 'lats', 'quads', 'hamstrings', 'glutes'] as const;

    for (const frequency of FREQUENCIES) {
      const covered = new Set(getSplit(frequency).slots.flatMap((s) => s.targetMuscles));
      for (const muscle of essential) {
        expect(covered.has(muscle), `${muscle} absent à ${frequency} séances`).toBe(true);
      }
    }
  });

  /**
   * Le test structurant : à chaque fréquence, le découpage retenu doit laisser
   * au moins 48 h entre deux créneaux qui partagent un muscle.
   */
  it('respecte le plancher de 48 h à toutes les fréquences', () => {
    for (const frequency of FREQUENCIES) {
      const split = getSplit(frequency);
      const gap = minGapBetweenSharedMuscles(split.slots, defaultWeekdays(frequency));

      expect(gap, `${frequency} séances/semaine`).toBeGreaterThanOrEqual(DEFAULT_MIN_REST_HOURS);
    }
  });
});

describe('placement des séances dans la semaine', () => {
  it('place exactement une séance par créneau', () => {
    for (const frequency of FREQUENCIES) {
      const split = getSplit(frequency);
      const result = placeSessions({
        slots: split.slots,
        preferredWeekdays: [0, 1, 2, 3, 4, 5, 6],
      });

      expect(result.placements).toHaveLength(frequency);
      expect(new Set(result.weekdays).size).toBe(frequency);
      expect(new Set(result.placements.map((p) => p.slotIndex)).size).toBe(frequency);
    }
  });

  it('trouve un placement respectant le repos minimum quand la semaine est libre', () => {
    for (const frequency of FREQUENCIES) {
      const split = getSplit(frequency);
      const result = placeSessions({
        slots: split.slots,
        preferredWeekdays: [0, 1, 2, 3, 4, 5, 6],
      });

      expect(result.respectsMinRest, `${frequency} séances/semaine`).toBe(true);
      expect(result.minGapHours).toBeGreaterThanOrEqual(DEFAULT_MIN_REST_HOURS);
    }
  });

  it('privilégie les jours souhaités quand c’est compatible avec le repos', () => {
    const split = getSplit(3);
    const result = placeSessions({ slots: split.slots, preferredWeekdays: [0, 2, 4] });

    expect(result.daysOutsidePreference).toHaveLength(0);
    expect(result.weekdays).toEqual([0, 2, 4]);
  });

  it('déborde des jours souhaités plutôt que de violer le repos minimum', () => {
    // Quatre séances demandées sur trois jours consécutifs : impossible sans
    // compromettre la récupération. Le moteur doit choisir le repos.
    const split = getSplit(4);
    const result = placeSessions({ slots: split.slots, preferredWeekdays: [0, 1, 2] });

    expect(result.respectsMinRest).toBe(true);
    expect(result.daysOutsidePreference.length).toBeGreaterThan(0);
  });

  it('est déterministe', () => {
    const split = getSplit(5);
    const first = placeSessions({ slots: split.slots, preferredWeekdays: [0, 1, 3, 4, 5] });
    const second = placeSessions({ slots: split.slots, preferredWeekdays: [0, 1, 3, 4, 5] });

    expect(second.weekdays).toEqual(first.weekdays);
    expect(second.placements).toEqual(first.placements);
  });
});

describe('calendrier du mésocycle', () => {
  it('ramène toute date au lundi de sa semaine', () => {
    // 2025-01-06 est un lundi ; 2025-01-09 un jeudi.
    expect(startOfWeek(new Date('2025-01-09T12:00:00Z')).toISOString()).toBe(
      '2025-01-06T00:00:00.000Z',
    );
    expect(startOfWeek(new Date('2025-01-06T23:00:00Z')).toISOString()).toBe(
      '2025-01-06T00:00:00.000Z',
    );
  });

  it('termine le bloc par une semaine de décharge', () => {
    expect(phaseForWeek(1, 5)).toBe('accumulation');
    expect(phaseForWeek(3, 5)).toBe('intensification');
    expect(phaseForWeek(5, 5)).toBe('deload');
  });

  it('génère le bon nombre de séances sur le bloc complet', () => {
    const profile = makeProfile({ sessionsPerWeek: 4, preferredWeekdays: [0, 1, 3, 4] });
    const schedule = buildMesocycleSchedule({
      startDate: new Date('2025-01-06T00:00:00Z'),
      weeks: 5,
      profile,
    });

    expect(schedule.sessions).toHaveLength(20);
    expect(schedule.respectsMinRest).toBe(true);
  });

  it('n’inscrit aucune séance avant la date de démarrage', () => {
    const profile = makeProfile({ sessionsPerWeek: 3, preferredWeekdays: [0, 2, 4] });
    const start = new Date('2025-01-08T00:00:00Z'); // mercredi

    const schedule = buildMesocycleSchedule({ startDate: start, weeks: 2, profile });

    for (const session of schedule.sessions) {
      expect(session.date.getTime()).toBeGreaterThanOrEqual(start.getTime());
    }
    // La séance du lundi de la première semaine est passée : 5 au lieu de 6.
    expect(schedule.sessions).toHaveLength(5);
  });

  it('livre les séances triées chronologiquement', () => {
    const schedule = buildMesocycleSchedule({
      startDate: MONDAY_18H,
      weeks: 3,
      profile: makeProfile({ sessionsPerWeek: 5 }),
    });

    for (let i = 1; i < schedule.sessions.length; i += 1) {
      expect(schedule.sessions[i]!.date.getTime()).toBeGreaterThanOrEqual(
        schedule.sessions[i - 1]!.date.getTime(),
      );
    }
  });
});

describe('changement de fréquence', () => {
  const profile = makeProfile({ sessionsPerWeek: 3, preferredWeekdays: [0, 2, 4] });

  const change = (from: number, to: number) =>
    planFrequencyChange({
      currentSessionsPerWeek: from,
      newSessionsPerWeek: to,
      profile,
      mesocycleWeek: 2,
      totalWeeks: 5,
      phase: 'accumulation',
    });

  it('conserve le volume hebdomadaire total en passant de 3 à 4 séances', () => {
    const result = change(3, 4);

    // Le volume hebdomadaire est la variable qui produit l'hypertrophie : il
    // ne doit pas bouger parce que l'utilisateur change de rythme de vie.
    const delta =
      Math.abs(result.totalWeeklySetsAfter - result.totalWeeklySetsBefore) /
      result.totalWeeklySetsBefore;
    expect(delta).toBeLessThan(0.1);
  });

  it('conserve la cible hebdomadaire muscle par muscle', () => {
    const result = change(3, 4);

    for (const muscle of MUSCLE_CODES) {
      const before = result.muscleConfigsBefore[muscle].weeklyTargetSets;
      const after = result.muscleConfigsAfter[muscle].weeklyTargetSets;
      expect(after, muscle).toBeCloseTo(before, 5);
    }
  });

  it('réduit les séries par séance quand la fréquence augmente', () => {
    const result = change(3, 6);
    const chest = result.comparison.find((c) => c.muscle === 'chest')!;

    expect(chest.frequencyAfter).toBeGreaterThanOrEqual(chest.frequencyBefore);
    expect(chest.setsPerSessionAfter).toBeLessThanOrEqual(chest.setsPerSessionBefore);
  });

  it('produit un planning respectant le repos minimum, à toutes les transitions', () => {
    for (const from of FREQUENCIES) {
      for (const to of FREQUENCIES) {
        if (from === to) continue;
        const result = change(from, to);
        expect(result.respectsMinRest, `${from} → ${to}`).toBe(true);
      }
    }
  });

  it('avertit quand la fréquence dépasse ce que le niveau permet de soutenir', () => {
    const result = planFrequencyChange({
      currentSessionsPerWeek: 3,
      newSessionsPerWeek: 6,
      profile: makeProfile({ experienceLevel: 'beginner', sessionsPerWeek: 3 }),
      mesocycleWeek: 1,
      totalWeeks: 5,
      phase: 'accumulation',
    });

    expect(result.warnings.some((w) => w.includes('soutenable'))).toBe(true);
    // L'avertissement n'empêche pas le changement : c'est la décision de
    // l'utilisateur, l'application l'informe puis s'adapte.
    expect(result.newSplit.sessionsPerWeek).toBe(6);
  });

  it('résume le changement en une phrase exploitable', () => {
    const result = change(3, 4);
    expect(result.summary).toContain('3 à 4 séances');
    expect(result.summary).toContain('Volume hebdomadaire conservé');
  });

  it('couvre toutes les transitions possibles sans erreur', () => {
    for (let from = MIN_SESSIONS_PER_WEEK; from <= MAX_SESSIONS_PER_WEEK; from += 1) {
      for (let to = MIN_SESSIONS_PER_WEEK; to <= MAX_SESSIONS_PER_WEEK; to += 1) {
        expect(() => change(from, to)).not.toThrow();
      }
    }
  });
});
