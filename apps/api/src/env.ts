import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Configuration unique à la racine du monorepo, partagée avec les scripts de
// base de données et le frontend.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export const env = {
  port: Number(process.env.API_PORT ?? 3000),
  host: process.env.API_HOST ?? '127.0.0.1',
  /** Origines autorisées par CORS, séparées par des virgules. */
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === 'production',
};
