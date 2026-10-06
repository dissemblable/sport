import { getSingleUserId, type Database } from '@sport/db';
import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors';

/**
 * Contexte de requête.
 *
 * L'application est mono-utilisateur : plutôt que de disséminer cette
 * hypothèse dans chaque route, un middleware résout l'utilisateur une fois et
 * le dépose dans le contexte. Le jour où une authentification est ajoutée,
 * seul ce fichier change — les routes lisent déjà `c.get('userId')`.
 */

export interface AppVariables {
  db: Database;
  userId: string;
  /**
   * Instant de référence de la requête.
   *
   * Fixé une fois par requête plutôt que relu à chaque appel : deux
   * `new Date()` séparés de quelques millisecondes produiraient des états de
   * fatigue incohérents entre le cliché et la séance générée à partir de lui.
   */
  now: Date;
}

export type AppEnv = { Variables: AppVariables };

let cachedUserId: string | null = null;

export function createContextMiddleware(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('db', db);
    c.set('now', resolveNow(c.req.header('x-simulated-now')));

    if (!cachedUserId) {
      cachedUserId = await getSingleUserId(db);
    }
    if (!cachedUserId) {
      throw new ApiError(
        503,
        'not_seeded',
        'Aucun profil en base. Lancez `pnpm db:migrate` puis `pnpm db:seed`.',
      );
    }

    c.set('userId', cachedUserId);
    await next();
  };
}

/**
 * En développement et dans les tests, l'en-tête `x-simulated-now` permet de se
 * placer à n'importe quel instant pour vérifier le comportement du moteur de
 * récupération sans attendre 48 heures.
 */
function resolveNow(header: string | undefined): Date {
  if (!header) return new Date();
  const parsed = new Date(header);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Réinitialise le cache d'utilisateur — utilisé par les tests. */
export function resetUserCache() {
  cachedUserId = null;
}
