import { zValidator } from '@hono/zod-validator';
import { EXERCISE_BY_SLUG, EXERCISE_CATALOG, canPerform } from '@sport/core';
import {
  EQUIPMENT_LABELS,
  MECHANIC_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_LABELS,
  MUSCLE_ROLE_LABELS,
  listExercisesQuerySchema,
  type EquipmentCode,
  type ExerciseDefinition,
} from '@sport/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { notFound } from '../errors';
import { loadInventory } from '../services/loaders';

/**
 * Bibliothèque d'exercices.
 *
 * Le catalogue est servi depuis `@sport/core` : c'est une donnée de domaine
 * immuable, chargée en mémoire une fois pour toutes. Aller la relire en base à
 * chaque requête n'apporterait rien — les tables `exercises` existent pour
 * l'intégrité référentielle et les agrégats SQL, pas pour ce cas d'usage.
 */

function present(exercise: ExerciseDefinition, owned: Set<EquipmentCode>) {
  return {
    id: exercise.id,
    slug: exercise.slug,
    name: exercise.name,
    pattern: exercise.pattern,
    patternLabel: MOVEMENT_PATTERN_LABELS[exercise.pattern],
    mechanic: exercise.mechanic,
    mechanicLabel: MECHANIC_LABELS[exercise.mechanic],
    difficulty: exercise.difficulty,
    isUnilateral: exercise.isUnilateral,
    systemicLoad: exercise.systemicLoad,
    equipment: exercise.equipment.map((code) => ({ code, label: EQUIPMENT_LABELS[code] })),
    /** L'utilisateur peut-il réaliser cet exercice avec son matériel actuel ? */
    isAvailable: canPerform(exercise, owned),
    muscles: exercise.muscles.map((involvement) => ({
      muscle: involvement.muscle,
      label: MUSCLE_LABELS[involvement.muscle],
      role: involvement.role,
      roleLabel: MUSCLE_ROLE_LABELS[involvement.role],
      contribution: involvement.contribution,
    })),
    defaultRepMin: exercise.defaultRepMin,
    defaultRepMax: exercise.defaultRepMax,
    defaultRestSeconds: exercise.defaultRestSeconds,
    progressionFamily: exercise.progressionFamily,
    progressionRank: exercise.progressionRank,
    setupNotes: exercise.setupNotes,
    executionCues: exercise.executionCues,
  };
}

/** Normalise une chaîne pour une recherche insensible aux accents et à la casse. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export const exerciseRoutes = new Hono<AppEnv>()

  .get('/exercises', zValidator('query', listExercisesQuerySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const filters = c.req.valid('query');

    const inventory = await loadInventory(db, userId);
    const owned = new Set<EquipmentCode>([...inventory.owned, 'bodyweight']);

    let results = EXERCISE_CATALOG;

    if (filters.muscle) {
      results = results.filter((e) => e.muscles.some((m) => m.muscle === filters.muscle));
    }
    if (filters.pattern) {
      results = results.filter((e) => e.pattern === filters.pattern);
    }
    if (filters.equipment) {
      results = results.filter((e) => e.equipment.includes(filters.equipment!));
    }
    if (filters.maxDifficulty !== undefined) {
      results = results.filter((e) => e.difficulty <= filters.maxDifficulty!);
    }
    if (filters.onlyAvailable) {
      results = results.filter((e) => canPerform(e, owned));
    }
    if (filters.search) {
      const needle = normalize(filters.search);
      results = results.filter((e) => normalize(e.name).includes(needle));
    }

    // Tri : d'abord ce que l'utilisateur peut réellement faire, puis par
    // difficulté croissante — l'inverse mettrait en tête des mouvements
    // inaccessibles, ce qui est décourageant.
    const presented = results
      .map((exercise) => present(exercise, owned))
      .sort((a, b) => {
        if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
        if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;
        return a.name.localeCompare(b.name, 'fr');
      });

    return c.json({ total: presented.length, items: presented });
  })

  .get('/exercises/:slug', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const slug = c.req.param('slug');

    const exercise = EXERCISE_BY_SLUG[slug];
    if (!exercise) throw notFound(`Exercice inconnu : ${slug}.`);

    const inventory = await loadInventory(db, userId);
    const owned = new Set<EquipmentCode>([...inventory.owned, 'bodyweight']);

    // Variantes de la même famille, pour proposer une régression ou une
    // progression directement depuis la fiche.
    const family = exercise.progressionFamily
      ? EXERCISE_CATALOG.filter((e) => e.progressionFamily === exercise.progressionFamily)
          .sort((a, b) => a.progressionRank - b.progressionRank)
          .map((e) => ({
            slug: e.slug,
            name: e.name,
            rank: e.progressionRank,
            difficulty: e.difficulty,
            isAvailable: canPerform(e, owned),
            isCurrent: e.id === exercise.id,
          }))
      : [];

    return c.json({ ...present(exercise, owned), progressionFamilyMembers: family });
  });
