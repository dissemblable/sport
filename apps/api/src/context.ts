import { getSingleUserId, provisionUser, type Database } from '@sport/db';
import type { Context, MiddlewareHandler } from 'hono';
import { env, type AuthOptions } from './env';
import { ApiError } from './errors';

/**
 * Contexte de requête.
 *
 * Un middleware résout l'utilisateur une fois et le dépose dans le contexte :
 * les routes lisent `c.get('userId')` sans savoir d'où il vient.
 *
 * - En mode `local`, c'est le profil unique amorcé par `pnpm db:seed`.
 * - En mode `forward-auth`, c'est le compte SSO désigné par l'en-tête
 *   `Remote-User`. nginx le pose après validation de la session par Authelia,
 *   en écrasant toute valeur envoyée par le client ; l'API n'étant joignable
 *   qu'à travers lui, l'en-tête fait foi. Le profil est créé à la première
 *   visite du compte.
 */

/** Compte SSO, tel que transmis par Authelia. */
export interface SsoIdentity {
  username: string;
  displayName: string | null;
  email: string | null;
  groups: string[];
}

export interface AppVariables {
  db: Database;
  userId: string;
  /** Compte SSO de la requête ; `null` en mode local. */
  identity: SsoIdentity | null;
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

let cachedLocalUserId: string | null = null;

/** Compte SSO → profil. Le rattachement ne change jamais : inutile de le relire à chaque requête. */
const userIdByUsername = new Map<string, string>();

export function createContextMiddleware(
  db: Database,
  auth: AuthOptions,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('db', db);
    c.set('now', resolveNow(c.req.header('x-simulated-now')));

    if (auth.mode === 'forward-auth') {
      const identity = readIdentity(c);
      c.set('identity', identity);
      c.set('userId', await resolveSsoUser(db, identity));
    } else {
      c.set('identity', null);
      c.set('userId', await resolveLocalUser(db));
    }

    await next();
  };
}

async function resolveLocalUser(db: Database): Promise<string> {
  if (!cachedLocalUserId) {
    cachedLocalUserId = await getSingleUserId(db);
  }
  if (!cachedLocalUserId) {
    throw new ApiError(
      503,
      'not_seeded',
      'Aucun profil en base. Lancez `pnpm db:migrate` puis `pnpm db:seed`.',
    );
  }
  return cachedLocalUserId;
}

async function resolveSsoUser(db: Database, identity: SsoIdentity): Promise<string> {
  const cached = userIdByUsername.get(identity.username);
  if (cached) return cached;

  const userId = await provisionUser(db, {
    externalId: identity.username,
    displayName: identity.displayName ?? identity.username,
  });
  userIdByUsername.set(identity.username, userId);
  return userId;
}

function readIdentity(c: Context): SsoIdentity {
  const username = readHeader(c, 'remote-user');
  if (!username) {
    throw new ApiError(
      401,
      'unauthenticated',
      'Requête non authentifiée : l’en-tête Remote-User du SSO est absent.',
    );
  }

  return {
    username,
    displayName: readHeader(c, 'remote-name'),
    email: readHeader(c, 'remote-email'),
    groups: (readHeader(c, 'remote-groups') ?? '')
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean),
  };
}

/**
 * Valeur d'en-tête, accents compris.
 *
 * Authelia transmet le nom affiché en UTF-8, mais Node décode les en-têtes en
 * Latin-1 : « Jérôme » arriverait en « JÃ©rÃ´me ». Les octets sont donc
 * réinterprétés en UTF-8 quand ils en forment une séquence valide.
 */
function readHeader(c: Context, name: string): string | null {
  const raw = c.req.header(name)?.trim();
  if (!raw) return null;
  if (!/[\u0080-ÿ]/.test(raw) || /[Ā-￿]/.test(raw)) return raw;

  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
}

/**
 * En développement et dans les tests, l'en-tête `x-simulated-now` permet de se
 * placer à n'importe quel instant pour vérifier le comportement du moteur de
 * récupération sans attendre 48 heures. Ignoré en production : il permettrait
 * d'enregistrer des séances dans le futur.
 */
function resolveNow(header: string | undefined): Date {
  if (!header || env.isProduction) return new Date();
  const parsed = new Date(header);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Réinitialise les caches d'utilisateur — utilisé par les tests. */
export function resetUserCache() {
  cachedLocalUserId = null;
  userIdByUsername.clear();
}
