import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema/index';

/**
 * Connexion PostgreSQL.
 *
 * Une seule instance par processus : le pool `pg` gère lui-même les connexions
 * concurrentes, en ouvrir plusieurs saturerait le serveur pour rien.
 */

// `fileURLToPath` et non `URL.pathname` : sous Windows, ce dernier renvoie
// « /C:/… », que `dotenv` ne sait pas ouvrir.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export type Database = NodePgDatabase<typeof schema>;

/** La base ou une transaction ouverte : pour les écritures qui doivent pouvoir s'exécuter dans l'une comme dans l'autre. */
export type DatabaseExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

let pool: pg.Pool | null = null;
let database: Database | null = null;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL est absent. Copiez .env.example vers .env, puis lancez `pnpm db:up`.',
    );
  }
  return url;
}

export function createDatabase(connectionString = getDatabaseUrl()): {
  db: Database;
  pool: pg.Pool;
} {
  const newPool = new pg.Pool({ connectionString, max: 10 });
  return { db: drizzle(newPool, { schema }), pool: newPool };
}

/** Instance partagée du processus, créée à la première utilisation. */
export function getDatabase(): Database {
  if (!database) {
    const created = createDatabase();
    database = created.db;
    pool = created.pool;
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}

export { schema };
