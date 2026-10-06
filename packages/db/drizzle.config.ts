import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Le fichier .env vit à la racine du monorepo : une seule configuration pour
// l'API, les scripts de migration et Drizzle Studio.
config({ path: '../../.env' });

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://sport:sport@localhost:5433/sport',
  },
  verbose: true,
  strict: true,
});
