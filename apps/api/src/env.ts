import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Configuration unique à la racine du monorepo, partagée avec les scripts de
// base de données et le frontend.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

/**
 * Mode d'authentification.
 *
 * - `local` : mono-utilisateur sans authentification, pour le développement.
 * - `forward-auth` : derrière le SSO (nginx + Authelia). Chaque requête porte
 *   l'en-tête `Remote-User` posé par nginx après vérification de la session ;
 *   chaque compte a son propre profil.
 */
export type AuthMode = 'local' | 'forward-auth';

export interface AuthOptions {
  mode: AuthMode;
  /** Page de déconnexion du portail SSO, proposée par l'interface. */
  logoutUrl: string | null;
}

function parseAuthMode(value: string | undefined): AuthMode {
  if (!value || value === 'local') return 'local';
  if (value === 'forward-auth') return 'forward-auth';
  // Une faute de frappe ne doit pas faire retomber silencieusement en mode
  // local : tous les comptes SSO partageraient alors le même profil.
  throw new Error(`AUTH_MODE invalide : « ${value} ». Valeurs possibles : local, forward-auth.`);
}

export const env = {
  port: Number(process.env.API_PORT ?? 3000),
  host: process.env.API_HOST ?? '127.0.0.1',
  /** Origines autorisées par CORS, séparées par des virgules. */
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === 'production',
  auth: {
    mode: parseAuthMode(process.env.AUTH_MODE),
    logoutUrl: process.env.AUTH_LOGOUT_URL || null,
  } satisfies AuthOptions,
  /**
   * Migrations et référentiel appliqués au démarrage. Activé dans l'image
   * Docker : le conteneur se suffit à lui-même, sans étape manuelle.
   */
  autoMigrate: process.env.DB_AUTO_MIGRATE === 'true',
  migrationsDir:
    process.env.MIGRATIONS_DIR ??
    fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url)),
};
