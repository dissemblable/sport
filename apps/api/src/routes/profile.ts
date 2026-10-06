import { zValidator } from '@hono/zod-validator';
import {
  EQUIPMENT_LABELS,
  MUSCLE_LABELS,
  updateEquipmentSchema,
  updateExercisePreferenceSchema,
  updateMuscleSettingsSchema,
  updateProfileSchema,
} from '@sport/shared';
import {
  equipment,
  muscles,
  userEquipment,
  userExercisePreferences,
  userMuscleSettings,
  userProfiles,
  users,
} from '@sport/db';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { badRequest, notFound } from '../errors';
import { loadInventory, loadMuscleOverrides, loadProfile } from '../services/loaders';

/**
 * Profil, matériel et réglages.
 *
 * Ces routes pilotent les entrées du moteur : le matériel déclaré détermine
 * les exercices possibles, les réglages musculaires la répartition du volume et
 * les exclusions pour blessure.
 */
export const profileRoutes = new Hono<AppEnv>()

  .get('/profile', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const loaded = await loadProfile(db, userId);
    const inventory = await loadInventory(db, userId);
    const muscleSettings = await loadMuscleOverrides(db, userId);

    return c.json({
      userId: loaded.userId,
      displayName: loaded.displayName,
      birthYear: loaded.birthYear,
      sex: loaded.sex,
      heightCm: loaded.heightCm,
      ...loaded.profile,
      equipment: inventory,
      muscleSettings: muscleSettings.map((setting) => ({
        ...setting,
        label: MUSCLE_LABELS[setting.muscle],
      })),
    });
  })

  .patch('/profile', zValidator('json', updateProfileSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const input = c.req.valid('json');

    if (input.displayName !== undefined) {
      await db.update(users).set({ displayName: input.displayName }).where(eq(users.id, userId));
    }

    const profileUpdate: Record<string, unknown> = { updatedAt: new Date() };
    if (input.birthYear !== undefined) profileUpdate.birthYear = input.birthYear;
    if (input.sex !== undefined) profileUpdate.sex = input.sex;
    if (input.heightCm !== undefined) {
      profileUpdate.heightCm = input.heightCm === null ? null : String(input.heightCm);
    }
    if (input.bodyWeightKg !== undefined) {
      profileUpdate.bodyWeightKg = input.bodyWeightKg === null ? null : String(input.bodyWeightKg);
    }
    if (input.experienceLevel !== undefined) profileUpdate.experienceLevel = input.experienceLevel;
    if (input.primaryGoal !== undefined) profileUpdate.primaryGoal = input.primaryGoal;
    if (input.sessionDurationMinutes !== undefined) {
      profileUpdate.sessionDurationMinutes = input.sessionDurationMinutes;
    }
    if (input.preferredWeekdays !== undefined) {
      profileUpdate.preferredWeekdays = input.preferredWeekdays;
    }
    if (input.deloadEveryNWeeks !== undefined) {
      profileUpdate.deloadEveryNWeeks = input.deloadEveryNWeeks;
    }

    // La fréquence n'est volontairement pas modifiable ici : la changer impose
    // de recalculer le split, de replacer les jours et de redistribuer le
    // volume. C'est le rôle de PATCH /api/plan/frequency, qui versionne le plan.
    if (input.sessionsPerWeek !== undefined) {
      throw badRequest(
        'La fréquence hebdomadaire se modifie via PATCH /api/plan/frequency, afin que le volume soit redistribué et les temps de repos revalidés.',
      );
    }

    await db.update(userProfiles).set(profileUpdate).where(eq(userProfiles.userId, userId));

    const loaded = await loadProfile(db, userId);
    return c.json({ userId, displayName: loaded.displayName, ...loaded.profile });
  })

  .get('/equipment', async (c) => {
    const db = c.get('db');
    const rows = await db.select().from(equipment).orderBy(equipment.id);
    return c.json(
      rows.map((row) => ({
        code: row.code,
        label: EQUIPMENT_LABELS[row.code],
        description: row.description,
      })),
    );
  })

  .put('/profile/equipment', zValidator('json', updateEquipmentSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { items } = c.req.valid('json');

    const catalogRows = await db.select().from(equipment);
    const idByCode = new Map(catalogRows.map((row) => [row.code, row.id]));

    // Remplacement complet : l'utilisateur décrit son matériel actuel, pas un
    // ajout incrémental. Retirer des haltères doit les faire disparaître.
    await db.delete(userEquipment).where(eq(userEquipment.userId, userId));

    const rows = items.flatMap((item) => {
      const equipmentId = idByCode.get(item.equipment);
      if (equipmentId === undefined) return [];
      return [
        {
          userId,
          equipmentId,
          code: item.equipment,
          details: item.details as never,
        },
      ];
    });

    if (rows.length > 0) await db.insert(userEquipment).values(rows);

    return c.json(await loadInventory(db, userId));
  })

  .put('/profile/muscles', zValidator('json', updateMuscleSettingsSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { settings } = c.req.valid('json');

    const muscleRows = await db.select({ id: muscles.id, code: muscles.code }).from(muscles);
    const idByCode = new Map(muscleRows.map((row) => [row.code, row.id]));

    for (const setting of settings) {
      const muscleId = idByCode.get(setting.muscle);
      if (muscleId === undefined) continue;

      await db
        .insert(userMuscleSettings)
        .values({
          userId,
          muscleId,
          priority: String(setting.priority),
          minRestHoursOverride: setting.minRestHoursOverride,
          weeklySetsOverride:
            setting.weeklySetsOverride === null ? null : String(setting.weeklySetsOverride),
          isExcluded: setting.isExcluded,
        })
        .onConflictDoUpdate({
          target: [userMuscleSettings.userId, userMuscleSettings.muscleId],
          set: {
            priority: sql`excluded.priority`,
            minRestHoursOverride: sql`excluded.min_rest_hours_override`,
            weeklySetsOverride: sql`excluded.weekly_sets_override`,
            isExcluded: sql`excluded.is_excluded`,
          },
        });
    }

    const updated = await loadMuscleOverrides(db, userId);
    return c.json(updated.map((s) => ({ ...s, label: MUSCLE_LABELS[s.muscle] })));
  })

  .put(
    '/profile/exercise-preference',
    zValidator('json', updateExercisePreferenceSchema),
    async (c) => {
      const db = c.get('db');
      const userId = c.get('userId');
      const input = c.req.valid('json');

      if (input.status === null) {
        const removed = await db
          .delete(userExercisePreferences)
          .where(
            and(
              eq(userExercisePreferences.userId, userId),
              eq(userExercisePreferences.exerciseId, input.exerciseId),
            ),
          )
          .returning({ exerciseId: userExercisePreferences.exerciseId });

        if (removed.length === 0) throw notFound('Aucune préférence enregistrée pour cet exercice.');
        return c.json({ exerciseId: input.exerciseId, status: null });
      }

      await db
        .insert(userExercisePreferences)
        .values({
          userId,
          exerciseId: input.exerciseId,
          status: input.status,
          reason: input.reason,
        })
        .onConflictDoUpdate({
          target: [userExercisePreferences.userId, userExercisePreferences.exerciseId],
          set: { status: sql`excluded.status`, reason: sql`excluded.reason` },
        });

      return c.json({ exerciseId: input.exerciseId, status: input.status, reason: input.reason });
    },
  );
