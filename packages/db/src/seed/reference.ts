import { EXERCISE_CATALOG, MUSCLE_CATALOG, getProgressionFamily } from '@sport/core';
import { EQUIPMENT_CODES, EQUIPMENT_LABELS } from '@sport/shared';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../client';
import {
  equipment,
  exerciseEquipment,
  exerciseMuscles,
  exerciseProgressions,
  exercises,
  muscles,
} from '../schema/index';

/**
 * Amorçage du référentiel depuis le catalogue de `@sport/core`.
 *
 * Le catalogue vit dans le paquet du moteur, pas ici : c'est de la donnée de
 * domaine, utilisée aussi bien par les tests unitaires (sans base) que par
 * l'API. La base n'en est qu'une projection interrogeable.
 *
 * L'opération est idempotente — relançable sans créer de doublon ni casser les
 * références des séances déjà enregistrées.
 */

const EQUIPMENT_DESCRIPTIONS: Record<(typeof EQUIPMENT_CODES)[number], string> = {
  bodyweight: 'Aucun matériel : le socle de l’entraînement à domicile.',
  pull_up_bar: 'Barre fixe ou barre de porte permettant de se suspendre.',
  dumbbells: 'Haltères courts, fixes ou réglables.',
  resistance_bands: 'Élastiques de résistance, avec ou sans poignées.',
};

export async function seedReference(db: Database): Promise<void> {
  /* ---------------------------------------------------------------------- */
  /*  Matériel                                                               */
  /* ---------------------------------------------------------------------- */

  await db
    .insert(equipment)
    .values(
      EQUIPMENT_CODES.map((code) => ({
        code,
        nameFr: EQUIPMENT_LABELS[code],
        description: EQUIPMENT_DESCRIPTIONS[code],
      })),
    )
    .onConflictDoUpdate({
      target: equipment.code,
      set: { nameFr: sql`excluded.name_fr`, description: sql`excluded.description` },
    });

  /* ---------------------------------------------------------------------- */
  /*  Muscles                                                                */
  /* ---------------------------------------------------------------------- */

  await db
    .insert(muscles)
    .values(
      MUSCLE_CATALOG.map((muscle) => ({
        code: muscle.code,
        nameFr: muscle.name,
        region: muscle.region,
        sizeClass: muscle.sizeClass,
        recoveryHalfLifeHours: muscle.recoveryHalfLifeHours.toString(),
        minRestHours: muscle.minRestHours,
        fullRecoveryHours: muscle.fullRecoveryHours,
        weeklyMev: muscle.weeklyMev,
        weeklyMav: muscle.weeklyMav,
        weeklyMrv: muscle.weeklyMrv,
        maxSetsPerSession: muscle.maxSetsPerSession,
        displayOrder: muscle.displayOrder,
      })),
    )
    .onConflictDoUpdate({
      target: muscles.code,
      set: {
        nameFr: sql`excluded.name_fr`,
        region: sql`excluded.region`,
        sizeClass: sql`excluded.size_class`,
        recoveryHalfLifeHours: sql`excluded.recovery_half_life_hours`,
        minRestHours: sql`excluded.min_rest_hours`,
        fullRecoveryHours: sql`excluded.full_recovery_hours`,
        weeklyMev: sql`excluded.weekly_mev`,
        weeklyMav: sql`excluded.weekly_mav`,
        weeklyMrv: sql`excluded.weekly_mrv`,
        maxSetsPerSession: sql`excluded.max_sets_per_session`,
        displayOrder: sql`excluded.display_order`,
      },
    });

  /* ---------------------------------------------------------------------- */
  /*  Exercices                                                              */
  /* ---------------------------------------------------------------------- */

  await db
    .insert(exercises)
    .values(
      EXERCISE_CATALOG.map((exercise) => ({
        id: exercise.id,
        slug: exercise.slug,
        nameFr: exercise.name,
        pattern: exercise.pattern,
        mechanic: exercise.mechanic,
        difficulty: exercise.difficulty,
        isUnilateral: exercise.isUnilateral,
        systemicLoad: exercise.systemicLoad.toString(),
        defaultRepMin: exercise.defaultRepMin,
        defaultRepMax: exercise.defaultRepMax,
        defaultRestSeconds: exercise.defaultRestSeconds,
        progressionAxes: exercise.progressionAxes,
        progressionFamily: exercise.progressionFamily,
        progressionRank: exercise.progressionRank,
        setupNotes: exercise.setupNotes,
        executionCues: exercise.executionCues,
      })),
    )
    .onConflictDoUpdate({
      target: exercises.id,
      set: {
        slug: sql`excluded.slug`,
        nameFr: sql`excluded.name_fr`,
        pattern: sql`excluded.pattern`,
        mechanic: sql`excluded.mechanic`,
        difficulty: sql`excluded.difficulty`,
        isUnilateral: sql`excluded.is_unilateral`,
        systemicLoad: sql`excluded.systemic_load`,
        defaultRepMin: sql`excluded.default_rep_min`,
        defaultRepMax: sql`excluded.default_rep_max`,
        defaultRestSeconds: sql`excluded.default_rest_seconds`,
        progressionAxes: sql`excluded.progression_axes`,
        progressionFamily: sql`excluded.progression_family`,
        progressionRank: sql`excluded.progression_rank`,
        setupNotes: sql`excluded.setup_notes`,
        executionCues: sql`excluded.execution_cues`,
      },
    });

  /* ---------------------------------------------------------------------- */
  /*  Tables de liaison                                                      */
  /* ---------------------------------------------------------------------- */

  const equipmentRows = await db.select().from(equipment);
  const equipmentIdByCode = new Map(equipmentRows.map((row) => [row.code, row.id]));

  const muscleRows = await db.select().from(muscles);
  const muscleIdByCode = new Map(muscleRows.map((row) => [row.code, row.id]));

  // Les liaisons sont entièrement reconstruites : la cartographie musculaire
  // évolue au fil de l'affinage du catalogue, et une mise à jour partielle
  // laisserait des associations obsolètes qui fausseraient le calcul de fatigue.
  await db.delete(exerciseEquipment);
  await db.delete(exerciseMuscles);
  await db.delete(exerciseProgressions);

  const equipmentLinks = EXERCISE_CATALOG.flatMap((exercise) =>
    exercise.equipment.flatMap((code) => {
      const equipmentId = equipmentIdByCode.get(code);
      if (equipmentId === undefined) return [];
      return [{ exerciseId: exercise.id, equipmentId, isRequired: true }];
    }),
  );
  if (equipmentLinks.length > 0) await db.insert(exerciseEquipment).values(equipmentLinks);

  const muscleLinks = EXERCISE_CATALOG.flatMap((exercise) =>
    exercise.muscles.flatMap((involvement) => {
      const muscleId = muscleIdByCode.get(involvement.muscle);
      if (muscleId === undefined) return [];
      return [
        {
          exerciseId: exercise.id,
          muscleId,
          role: involvement.role,
          contribution: involvement.contribution.toString(),
        },
      ];
    }),
  );
  if (muscleLinks.length > 0) await db.insert(exerciseMuscles).values(muscleLinks);

  /* ---------------------------------------------------------------------- */
  /*  Chaînes de progression                                                 */
  /* ---------------------------------------------------------------------- */

  const families = new Set(
    EXERCISE_CATALOG.map((e) => e.progressionFamily).filter((f): f is string => f !== null),
  );

  const progressionLinks = [...families].flatMap((family) => {
    const ordered = getProgressionFamily(family);
    return ordered.slice(0, -1).map((current, index) => ({
      fromExerciseId: current.id,
      toExerciseId: ordered[index + 1]!.id,
      criteria: {
        sets: 3,
        reps: current.defaultRepMax,
        rir: 1,
      } as Record<string, unknown>,
    }));
  });
  if (progressionLinks.length > 0) await db.insert(exerciseProgressions).values(progressionLinks);

  console.log(
    `Référentiel amorcé : ${MUSCLE_CATALOG.length} muscles, ` +
      `${EQUIPMENT_CODES.length} équipements, ${EXERCISE_CATALOG.length} exercices, ` +
      `${muscleLinks.length} liaisons musculaires, ${progressionLinks.length} progressions.`,
  );
}

/** Identifiant d'un muscle par son code — utilitaire partagé par l'API. */
export async function muscleIdMap(db: Database): Promise<Map<string, number>> {
  const rows = await db.select({ id: muscles.id, code: muscles.code }).from(muscles);
  return new Map(rows.map((row) => [row.code, row.id]));
}

/** Vérifie que le référentiel est bien présent avant tout usage. */
export async function assertReferenceSeeded(db: Database): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(exercises);
  if (!row || row.count === 0) {
    throw new Error('Référentiel absent. Lancez `pnpm db:seed`.');
  }
}

/** Identifiant interne d'un équipement à partir de son code. */
export async function equipmentIdByCode(db: Database, code: string): Promise<number | null> {
  const [row] = await db
    .select({ id: equipment.id })
    .from(equipment)
    .where(eq(equipment.code, code as (typeof EQUIPMENT_CODES)[number]));
  return row?.id ?? null;
}
