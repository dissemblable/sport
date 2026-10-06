import type { Database } from '@sport/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createContextMiddleware, type AppEnv } from './context';
import { env } from './env';
import { handleError } from './errors';
import { exerciseRoutes } from './routes/exercises';
import { planRoutes } from './routes/plan';
import { profileRoutes } from './routes/profile';
import { recoveryRoutes } from './routes/recovery';
import { sessionRoutes } from './routes/sessions';
import { statsRoutes } from './routes/stats';
import { workoutRoutes } from './routes/workouts';

/**
 * Application Hono.
 *
 * Construite en fonction de la base plutôt qu'en important une instance
 * globale : les tests d'intégration peuvent ainsi lancer l'application sur une
 * base dédiée, et `app.request()` de Hono permet de tester les routes sans
 * jamais ouvrir de port.
 */
export function createApp(db: Database) {
  const app = new Hono<AppEnv>();

  app.onError(handleError);

  if (!env.isProduction) app.use('*', logger());

  app.use(
    '/api/*',
    cors({
      origin: env.corsOrigins,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'x-simulated-now'],
    }),
  );

  app.use('/api/*', createContextMiddleware(db));

  app.get('/api/health', (c) =>
    c.json({ status: 'ok', service: '@sport/api', time: new Date().toISOString() }),
  );

  const api = app.basePath('/api');
  api.route('/', profileRoutes);
  api.route('/', exerciseRoutes);
  api.route('/', recoveryRoutes);
  api.route('/', planRoutes);
  api.route('/', sessionRoutes);
  api.route('/', workoutRoutes);
  api.route('/', statsRoutes);

  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: `Route inconnue : ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;
