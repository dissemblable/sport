/**
 * @sport/db — schéma PostgreSQL, connexion et amorçage.
 *
 * Le namespace `schema` (réexporté depuis `client.js`) donne accès à toutes les
 * tables d'un bloc ; les tables sont également exportées individuellement pour
 * pouvoir écrire `db.select().from(exercises)` sans préfixe.
 */

export * from './client';
export * from './schema/index';
export {
  seedReference,
  assertReferenceSeeded,
  muscleIdMap,
  equipmentIdByCode,
} from './seed/reference';
export { seedUser, provisionUser, getSingleUserId, clearUserData } from './seed/user';
export type { SeedUserOptions } from './seed/user';
