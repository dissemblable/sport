import { MUSCLE_CATALOG } from '@sport/core';
import { EQUIPMENT_LABELS, type BandDetails, type DumbbellDetails } from '@sport/shared';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database, DatabaseExecutor } from '../client';
import { equipment, muscles, userEquipment, userMuscleSettings, userProfiles, users } from '../schema/index';

/**
 * Création des profils utilisateur.
 *
 * Deux portes d'entrée, mêmes réglages de départ :
 *
 * - `seedUser` amorce le profil local, utilisé sans authentification
 *   (`pnpm db:seed`, tests, démo) ;
 * - `provisionUser` crée le profil d'un compte SSO à sa première visite.
 */

/** Matériel par défaut : un équipement de départ réaliste pour le domicile. */
const DEFAULT_DUMBBELLS: DumbbellDetails = {
  availableWeightsKg: [5, 7.5, 10, 12.5, 15, 20],
  pairCount: 2,
  incrementKg: 2.5,
};

const DEFAULT_BANDS: BandDetails = {
  levels: [
    { name: 'Jaune (légère)', approxKg: 7 },
    { name: 'Rouge (moyenne)', approxKg: 15 },
    { name: 'Noire (forte)', approxKg: 25 },
  ],
};

export interface SeedUserOptions {
  displayName?: string;
  sessionsPerWeek?: number;
  sessionDurationMinutes?: number;
  preferredWeekdays?: number[];
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced';
  birthYear?: number;
  bodyWeightKg?: number;
}

export async function seedUser(db: Database, options: SeedUserOptions = {}): Promise<string> {
  const userId =
    (await getSingleUserId(db)) ??
    (
      await db
        .insert(users)
        .values({ displayName: options.displayName ?? 'Athlète' })
        .returning({ id: users.id })
    )[0]!.id;

  const equipmentCodes = await seedUserDefaults(db, userId, options);

  console.log(
    `Profil amorcé : ${options.displayName ?? 'Athlète'} — ` +
      `${options.sessionsPerWeek ?? 4} séances/semaine, ` +
      `matériel : ${equipmentCodes.map((code) => EQUIPMENT_LABELS[code]).join(', ')}, ` +
      `${MUSCLE_CATALOG.length} réglages musculaires.`,
  );

  return userId;
}

/**
 * Profil d'un compte SSO, créé à sa première visite.
 *
 * Au premier chargement, le navigateur lance plusieurs requêtes en parallèle :
 * toutes arrivent ici pour un compte encore inconnu. La création se fait donc
 * dans une transaction, avec une insertion en `ON CONFLICT DO NOTHING` sur
 * `external_id` : PostgreSQL fait attendre les requêtes concurrentes jusqu'à la
 * validation de la première, et elles ne trouvent ensuite qu'un profil complet.
 */
export async function provisionUser(
  db: Database,
  identity: { externalId: string; displayName: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values(identity)
      .onConflictDoNothing({ target: users.externalId })
      .returning({ id: users.id });

    if (created) {
      await seedUserDefaults(tx, created.id);
      return created.id;
    }

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, identity.externalId));

    if (!existing) throw new Error(`Compte SSO introuvable après conflit : ${identity.externalId}.`);
    return existing.id;
  });
}

/** Profil, matériel et réglages musculaires de départ. Renvoie le matériel attribué. */
async function seedUserDefaults(db: DatabaseExecutor, userId: string, options: SeedUserOptions = {}) {
  await db
    .insert(userProfiles)
    .values({
      userId,
      birthYear: options.birthYear ?? 1995,
      sex: 'unspecified',
      bodyWeightKg: (options.bodyWeightKg ?? 75).toString(),
      experienceLevel: options.experienceLevel ?? 'intermediate',
      primaryGoal: 'hypertrophy',
      sessionsPerWeek: options.sessionsPerWeek ?? 4,
      sessionDurationMinutes: options.sessionDurationMinutes ?? 60,
      preferredWeekdays: options.preferredWeekdays ?? [0, 1, 3, 4],
      deloadEveryNWeeks: 5,
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        sessionsPerWeek: sql`excluded.sessions_per_week`,
        sessionDurationMinutes: sql`excluded.session_duration_minutes`,
        preferredWeekdays: sql`excluded.preferred_weekdays`,
        experienceLevel: sql`excluded.experience_level`,
        updatedAt: sql`now()`,
      },
    });

  /* ---------------------------------------------------------------------- */
  /*  Matériel possédé                                                       */
  /* ---------------------------------------------------------------------- */

  const equipmentRows = await db.select().from(equipment);
  const detailsByCode: Record<string, unknown> = {
    bodyweight: {},
    pull_up_bar: { canAddWeight: true },
    dumbbells: DEFAULT_DUMBBELLS,
    resistance_bands: DEFAULT_BANDS,
  };

  for (const row of equipmentRows) {
    await db
      .insert(userEquipment)
      .values({
        userId,
        equipmentId: row.id,
        code: row.code,
        details: (detailsByCode[row.code] ?? {}) as never,
      })
      .onConflictDoUpdate({
        target: [userEquipment.userId, userEquipment.equipmentId],
        set: { details: sql`excluded.details` },
      });
  }

  /* ---------------------------------------------------------------------- */
  /*  Réglages par muscle                                                    */
  /* ---------------------------------------------------------------------- */

  const muscleRows = await db.select({ id: muscles.id, code: muscles.code }).from(muscles);
  const settings = muscleRows.map((row) => ({
    userId,
    muscleId: row.id,
    priority: '1',
    minRestHoursOverride: null,
    weeklySetsOverride: null,
    isExcluded: false,
  }));

  if (settings.length > 0) {
    await db.insert(userMuscleSettings).values(settings).onConflictDoNothing();
  }

  return equipmentRows.map((row) => row.code);
}

/**
 * Identifiant du profil local — celui qui n'est rattaché à aucun compte SSO ;
 * `null` si la base n'est pas amorcée.
 */
export async function getSingleUserId(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.externalId))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Supprime toutes les données d'un utilisateur en conservant le référentiel. */
export async function clearUserData(db: Database, userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
