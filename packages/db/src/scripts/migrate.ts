import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, getDatabaseUrl } from '../client';

/**
 * Applique les migrations SQL versionnées de `drizzle/`.
 *
 * Ce script est idempotent : Drizzle tient une table de suivi et n'applique que
 * ce qui manque. Il peut donc être lancé sans risque à chaque démarrage.
 */
async function main() {
  const url = getDatabaseUrl();
  const { db, pool } = createDatabase(url);

  const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

  console.log(`Migration de la base : ${url.replace(/:[^:@]+@/, ':***@')}`);
  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations appliquées.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Échec de la migration :', error);
  process.exit(1);
});
