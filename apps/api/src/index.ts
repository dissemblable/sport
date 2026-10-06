import { serve } from '@hono/node-server';
import { assertReferenceSeeded, getDatabase } from '@sport/db';
import { createApp } from './app';
import { env } from './env';

/**
 * Point d'entrée du serveur.
 *
 * Le référentiel est vérifié au démarrage : mieux vaut un message clair
 * indiquant de lancer `pnpm db:seed` qu'une cascade d'erreurs incompréhensibles
 * à la première requête.
 */
async function main() {
  const db = getDatabase();

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
  });
}

main().catch((error) => {
  console.error('Impossible de démarrer l’API :', error);
  process.exit(1);
});
