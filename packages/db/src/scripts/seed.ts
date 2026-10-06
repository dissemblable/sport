import { createDatabase, getDatabaseUrl } from '../client';
import { seedReference } from '../seed/reference';
import { seedUser } from '../seed/user';

/**
 * Amorçage complet : référentiel puis profil utilisateur.
 * Idempotent — relançable après chaque évolution du catalogue.
 */
async function main() {
  const { db, pool } = createDatabase(getDatabaseUrl());

  try {
    await seedReference(db);
    await seedUser(db);
    console.log('\nBase prête. Lancez `pnpm dev`.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Échec de l’amorçage :', error);
  process.exit(1);
});
