import { serve } from '@hono/node-server';
import { assertReferenceSeeded, getDatabase, seedReference } from '@sport/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApp } from './app';
import { env } from './env';

/**
 * Point d'entrée du serveur.
 *
 * Le référentiel est vérifié au démarrage : mieux vaut un message clair
 * indiquant de lancer `pnpm db:seed` qu'une cascade d'erreurs incompréhensibles
 * à la première requête.
 *
 * Dans l'image Docker (`DB_AUTO_MIGRATE=true`), migrations et référentiel sont
 * appliqués ici : les deux opérations sont idempotentes, et une mise à jour du
 * catalogue est ainsi prise en compte au simple redémarrage du conteneur.
 */
async function main() {
  const db = getDatabase();

  if (env.autoMigrate) {
    await migrate(db, { migrationsFolder: env.migrationsDir });
    await seedReference(db);
  }

  try {
    await assertReferenceSeeded(db);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
  }

  const app = createApp(db);

  serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
    console.log(`API démarrée sur http://${env.host}:${info.port}`);
    console.log(`Santé : http://${env.host}:${info.port}/api/health`);
    console.log(
      env.auth.mode === 'forward-auth'
        ? 'Authentification : SSO (en-tête Remote-User posé par nginx)'
        : 'Authentification : aucune (profil local unique)',
    );
  });
}

main().catch((error) => {
  console.error('Impossible de démarrer l’API :', error);
  process.exit(1);
});
