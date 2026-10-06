import { Hono } from 'hono';
import type { AppEnv } from '../context';
import type { AuthOptions } from '../env';

/**
 * Compte connecté.
 *
 * Renseigne l'interface sur le compte SSO de la session et l'adresse de
 * déconnexion du portail. En mode local, il n'y a ni compte ni déconnexion.
 */
export function accountRoutes(auth: AuthOptions) {
  return new Hono<AppEnv>().get('/me', (c) => {
    const identity = c.get('identity');

    return c.json({
      authMode: auth.mode,
      username: identity?.username ?? null,
      displayName: identity?.displayName ?? null,
      email: identity?.email ?? null,
      groups: identity?.groups ?? [],
      logoutUrl: identity ? auth.logoutUrl : null,
    });
  });
}
