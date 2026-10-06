import { sql } from 'drizzle-orm';
import { createDatabase, getDatabaseUrl } from '../client';

/**
 * Réinitialise complètement la base : schéma public supprimé puis recréé.
 *
 * Destructif par nature — réservé au développement. La confirmation explicite
 * évite de l'exécuter par réflexe sur une base contenant un historique réel.
 */
async function main() {
  const url = getDatabaseUrl();

  if (!process.argv.includes('--yes')) {
    console.error(
      'Cette commande efface TOUTES les données.\n' +
        `Base visée : ${url.replace(/:[^:@]+@/, ':***@')}\n` +
        'Relancez avec --yes pour confirmer.',
    );
    process.exit(1);
  }

  const { db, pool } = createDatabase(url);
  try {
    await db.execute(sql`DROP SCHEMA public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    console.log('Base réinitialisée. Lancez `pnpm db:migrate` puis `pnpm db:seed`.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Échec de la réinitialisation :', error);
  process.exit(1);
});
