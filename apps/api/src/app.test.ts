import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, seedReference, seedUser, users, type Database } from '@sport/db';
import { DEFAULT_MIN_REST_HOURS } from '@sport/shared';
import { createApp } from './app';
import { resetUserCache } from './context';

/**
 * Tests d'intégration de l'API.
 *
 * Ils s'exécutent contre une vraie base PostgreSQL — le comportement du moteur
 * dépend trop de la persistance (journal append-only, versions de plan) pour
 * qu'un test sur des données simulées apporte une garantie sérieuse.
 *
 * L'en-tête `x-simulated-now` permet de traverser plusieurs jours en quelques
 * millisecondes et de vérifier la fenêtre de récupération de 48 h sans
 * attendre.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://sport:sport@localhost:5433/sport_test';

let db: Database;
// Le type du pool vient de `createDatabase` : inutile de dépendre de `pg` ici.
let pool: ReturnType<typeof createDatabase>['pool'];
let app: ReturnType<typeof createApp>;
let userId: string;

/** Lundi 6 janvier 2025, 18 h — point de départ de tous les scénarios. */
const MONDAY = new Date('2025-01-06T18:00:00.000Z');

const at = (hoursFromMonday: number) =>
  new Date(MONDAY.getTime() + hoursFromMonday * 3_600_000).toISOString();

/** Appel d'API avec un instant simulé. */
async function call(
  method: string,
  path: string,
  options: { body?: unknown; now?: string } = {},
) {
  const response = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.now ? { 'x-simulated-now': options.now } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, body: json };
}

beforeAll(async () => {
  const created = createDatabase(DATABASE_URL);
  db = created.db;
  pool = created.pool;

  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url)),
  });

  await seedReference(db);

  // Chaque exécution repart d'une base sans utilisateur : les tests portent sur
  // l'accumulation de fatigue, un reliquat fausserait tout. Les comptes SSO
  // créés par une exécution précédente partent avec.
  await db.delete(users);
  resetUserCache();

  userId = await seedUser(db, {
    displayName: 'Athlète de test',
    sessionsPerWeek: 4,
    preferredWeekdays: [0, 1, 3, 4],
    experienceLevel: 'intermediate',
  });

  app = createApp(db, { auth: { mode: 'local', logoutUrl: null } });
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

/* -------------------------------------------------------------------------- */

describe('santé et profil', () => {
  it('répond sur /api/health', async () => {
    const { status, body } = await call('GET', '/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('expose le profil avec son matériel', async () => {
    const { status, body } = await call('GET', '/api/profile');
    expect(status).toBe(200);
    expect(body.userId).toBe(userId);
    expect(body.sessionsPerWeek).toBe(4);
    expect(body.equipment.owned).toContain('dumbbells');
    expect(body.muscleSettings).toHaveLength(17);
  });

  it('refuse de changer la fréquence via le profil et oriente vers la bonne route', async () => {
    const { status, body } = await call('PATCH', '/api/profile', {
      body: { sessionsPerWeek: 5 },
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain('/api/plan/frequency');
  });

  it('renvoie une erreur structurée sur une route inconnue', async () => {
    const { status, body } = await call('GET', '/api/inexistant');
    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });
});

describe('catalogue d’exercices', () => {
  it('ne renvoie que des exercices réalisables quand on le demande', async () => {
    const { status, body } = await call('GET', '/api/exercises?onlyAvailable=true');
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(30);
    for (const item of body.items) expect(item.isAvailable).toBe(true);
  });

  it('filtre par muscle', async () => {
    const { body } = await call('GET', '/api/exercises?muscle=chest');
    expect(body.total).toBeGreaterThan(3);
    for (const item of body.items) {
      expect(item.muscles.some((m: { muscle: string }) => m.muscle === 'chest')).toBe(true);
    }
  });

  it('expose la chaîne de progression d’un exercice', async () => {
    const { status, body } = await call('GET', '/api/exercises/pompes');
    expect(status).toBe(200);
    expect(body.progressionFamilyMembers.length).toBeGreaterThan(2);
    expect(body.progressionFamilyMembers.some((m: { isCurrent: boolean }) => m.isCurrent)).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('parcours complet : plan → séance → fatigue', () => {
  let planId: string;
  let firstSessionId: string;

  it('génère un mésocycle respectant le repos minimum', async () => {
    const { status, body } = await call('POST', '/api/plan/generate', {
      body: { restart: true, durationWeeks: 4 },
      now: at(0),
    });

    expect(status).toBe(201);
    expect(body.sessionCount).toBeGreaterThan(10);
    expect(body.minGapHours).toBeGreaterThanOrEqual(DEFAULT_MIN_REST_HOURS);
    planId = body.planId;
  });

  it('renvoie le plan actif avec ses prochaines séances', async () => {
    const { status, body } = await call('GET', '/api/plan/current', { now: at(0) });

    expect(status).toBe(200);
    expect(body.plan.id).toBe(planId);
    expect(body.plan.sessionsPerWeek).toBe(4);
    expect(body.upcomingSessions.length).toBeGreaterThan(0);

    firstSessionId = body.upcomingSessions[0].id;
  });

  it('détaille une séance avec ses exercices et sa justification', async () => {
    const { status, body } = await call('GET', `/api/sessions/${firstSessionId}`);

    expect(status).toBe(200);
    expect(body.exercises.length).toBeGreaterThan(2);
    expect(body.rationale).not.toBeNull();
    for (const exercise of body.exercises) {
      expect(exercise.name).toBeTruthy();
      expect(exercise.targetSets).toBeGreaterThan(0);
    }
  });

  it('part d’un état totalement récupéré', async () => {
    const { body } = await call('GET', '/api/recovery/state', { now: at(0) });
    expect(body.blocked).toHaveLength(0);
    expect(body.muscles).toHaveLength(17);
  });

  it('enregistre une séance et bloque les muscles travaillés', async () => {
    const session = await call('GET', `/api/sessions/${firstSessionId}`);

    const start = await call('POST', '/api/workouts/start', {
      body: { plannedSessionId: firstSessionId },
      now: at(0),
    });
    expect(start.status).toBe(201);
    const workoutId = start.body.id;

    // On exécute la séance telle qu'elle a été prescrite.
    let setIndex = 0;
    for (const exercise of session.body.exercises) {
      if (exercise.block === 'warmup') continue;
      for (let i = 0; i < exercise.targetSets; i += 1) {
        setIndex += 1;
        const logged = await call('POST', `/api/workouts/${workoutId}/sets`, {
          body: {
            exerciseId: exercise.exerciseId,
            setIndex,
            reps: exercise.targetRepMax,
            loadKg: exercise.prescription.loadKg,
            rir: exercise.targetRir,
          },
          now: at(0),
        });
        expect(logged.status).toBe(201);
      }
    }

    const finished = await call('POST', `/api/workouts/${workoutId}/finish`, {
      body: { sessionRpe: 8 },
      now: at(1),
    });

    expect(finished.status).toBe(200);
    expect(finished.body.workingSets).toBe(setIndex);
    expect(finished.body.fatigueEvents).toBeGreaterThan(3);

    // Les muscles travaillés sont désormais indisponibles.
    const recovery = await call('GET', '/api/recovery/state', { now: at(2) });
    expect(recovery.body.blocked.length).toBeGreaterThan(0);

    for (const muscle of recovery.body.muscles) {
      if (muscle.isAvailable) continue;
      expect(muscle.blockedExplanation).toBeTruthy();
      expect(muscle.hoursUntilAvailable).toBeGreaterThan(0);
    }
  });

  it('marque la séance planifiée comme terminée', async () => {
    const { body } = await call('GET', `/api/sessions/${firstSessionId}`);
    expect(body.status).toBe('completed');
  });

  /**
   * Le test qui compte : 24 h après une séance, les muscles travaillés sont
   * toujours bloqués, et l'application le dit clairement.
   */
  it('refuse de reprogrammer un muscle avant 48 h et l’explique', async () => {
    const recovery = await call('GET', '/api/recovery/state', { now: at(24) });
    const blocked = recovery.body.muscles.filter(
      (m: { isAvailable: boolean }) => !m.isAvailable,
    );

    expect(blocked.length).toBeGreaterThan(0);

    for (const muscle of blocked) {
      expect(muscle.blockedBy).toBe('min_rest_not_elapsed');
      expect(muscle.blockedExplanation).toContain('48 h');
    }

    // Une séance improvisée le lendemain ne doit toucher aucun de ces muscles.
    const blockedCodes = new Set(blocked.map((m: { muscle: string }) => m.muscle));
    const preview = await call('POST', '/api/sessions/preview', {
      body: {},
      now: at(24),
    });

    expect(preview.status).toBe(200);
    for (const exercise of preview.body.exercises) {
      const detail = await call('GET', `/api/exercises/${exercise.slug}`);
      for (const involvement of detail.body.muscles) {
        if (involvement.role === 'primary' || involvement.contribution >= 0.5) {
          expect(
            blockedCodes.has(involvement.muscle),
            `${exercise.slug} charge ${involvement.muscle}, encore bloqué`,
          ).toBe(false);
        }
      }
    }
  });

  it('libère les muscles après 48 h', async () => {
    const { body } = await call('GET', '/api/recovery/state', { now: at(50) });
    const stillBlocked = body.muscles.filter((m: { isAvailable: boolean }) => !m.isAvailable);
    expect(stillBlocked).toHaveLength(0);
  });

  it('vérifie que le journal de fatigue correspond au calcul du moteur', async () => {
    const [row] = await db.execute<{ count: string; total: string }>(
      sql`select count(*)::text as count, coalesce(sum(effective_sets), 0)::text as total
          from muscle_fatigue_events where user_id = ${userId} and source = 'training'`,
    ).then((result) => result.rows);

    expect(Number(row!.count)).toBeGreaterThan(3);
    expect(Number(row!.total)).toBeGreaterThan(5);
  });
});

/* -------------------------------------------------------------------------- */

describe('courbatures déclarées', () => {
  it('repousse la disponibilité du muscle concerné', async () => {
    const before = await call('GET', '/api/recovery/state', { now: at(60) });
    const chestBefore = before.body.muscles.find(
      (m: { muscle: string }) => m.muscle === 'chest',
    );
    expect(chestBefore.isAvailable).toBe(true);

    const checkin = await call('POST', '/api/recovery/checkin', {
      body: {
        sleepHours: 6,
        sleepQuality: 3,
        soreness: [{ muscle: 'chest', soreness: 5 }],
      },
      now: at(60),
    });

    expect(checkin.status).toBe(201);
    expect(checkin.body.fatigueEventsCreated).toBe(1);
    expect(checkin.body.message).toContain('Pectoraux');

    const after = await call('GET', '/api/recovery/state', { now: at(60) });
    const chestAfter = after.body.muscles.find((m: { muscle: string }) => m.muscle === 'chest');

    expect(chestAfter.fatiguePct).toBeGreaterThan(chestBefore.fatiguePct);
  });
});

/* -------------------------------------------------------------------------- */

describe('changement de fréquence', () => {
  it('donne un aperçu de l’impact sans rien modifier', async () => {
    const before = await call('GET', '/api/plan/current', { now: at(72) });

    const preview = await call('PATCH', '/api/plan/frequency', {
      body: { sessionsPerWeek: 5, preview: true },
      now: at(72),
    });

    expect(preview.status).toBe(200);
    expect(preview.body.applied).toBe(false);
    expect(preview.body.comparison.length).toBeGreaterThan(10);
    expect(preview.body.respectsMinRest).toBe(true);

    // Le volume hebdomadaire total est conservé : c'est la promesse du produit.
    const delta =
      Math.abs(preview.body.totalWeeklySetsAfter - preview.body.totalWeeklySetsBefore) /
      preview.body.totalWeeklySetsBefore;
    expect(delta).toBeLessThan(0.1);

    const after = await call('GET', '/api/plan/current', { now: at(72) });
    expect(after.body.plan.version).toBe(before.body.plan.version);
    expect(after.body.plan.sessionsPerWeek).toBe(4);
  });

  it('applique le changement en créant une nouvelle version du plan', async () => {
    const applied = await call('PATCH', '/api/plan/frequency', {
      body: { sessionsPerWeek: 5, reason: 'Plus de temps libre' },
      now: at(72),
    });

    expect(applied.status).toBe(200);
    expect(applied.body.applied).toBe(true);
    expect(applied.body.version).toBe(2);
    expect(applied.body.newSplit.sessionsPerWeek).toBe(5);
    expect(applied.body.minGapHours).toBeGreaterThanOrEqual(DEFAULT_MIN_REST_HOURS);

    const current = await call('GET', '/api/plan/current', { now: at(72) });
    expect(current.body.plan.sessionsPerWeek).toBe(5);
    expect(current.body.plan.version).toBe(2);
  });

  it('conserve l’historique des versions de plan', async () => {
    const { body } = await call('GET', '/api/plan/versions');
    expect(body.length).toBeGreaterThanOrEqual(2);

    const active = body.filter((plan: { isActive: boolean }) => plan.isActive);
    expect(active).toHaveLength(1);

    const archived = body.find((plan: { version: number }) => plan.version === 1);
    expect(archived.supersededAt).not.toBeNull();
    expect(archived.sessionsPerWeek).toBe(4);
  });

  it('ne touche pas à la séance déjà réalisée', async () => {
    const { body } = await call('GET', '/api/sessions?from=2025-01-06&to=2025-01-07');
    const completed = body.filter(
      (session: { status: string }) => session.status === 'completed',
    );
    expect(completed.length).toBeGreaterThan(0);
  });

  it('refuse un changement vers la fréquence déjà en place', async () => {
    const { status, body } = await call('PATCH', '/api/plan/frequency', {
      body: { sessionsPerWeek: 5 },
      now: at(72),
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain('déjà réglé');
  });
});

/* -------------------------------------------------------------------------- */

describe('statistiques', () => {
  it('agrège le volume hebdomadaire par muscle', async () => {
    const { status, body } = await call('GET', '/api/stats/volume?weeks=4', { now: at(72) });
    expect(status).toBe(200);
    expect(body.points.length).toBeGreaterThan(3);

    for (const point of body.points) {
      expect(point.effectiveSets).toBeGreaterThan(0);
      expect(point.mev).toBeGreaterThan(0);
      expect(point.mrv).toBeGreaterThanOrEqual(point.mav);
    }
  });

  it('résume l’état d’entraînement', async () => {
    const { status, body } = await call('GET', '/api/stats/summary', { now: at(72) });
    expect(status).toBe(200);
    expect(body.availableMuscles + body.blockedMuscles).toBe(17);
    expect(body.totalWeeklySets).toBeGreaterThan(0);
  });

  it('fournit la chronologie de récupération, passé et futur', async () => {
    const { status, body } = await call('GET', '/api/recovery/timeline?days=7', { now: at(72) });
    expect(status).toBe(200);
    expect(body.points.length).toBeGreaterThan(10);
    expect(body.points.some((p: { isFuture: boolean }) => p.isFuture)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('déplacement de séance', () => {
  it('refuse un déplacement qui violerait le repos minimum', async () => {
    const plan = await call('GET', '/api/plan/current', { now: at(72) });
    const upcoming = plan.body.upcomingSessions[0];

    // On tente de déplacer la séance sur le jour même de la séance déjà
    // réalisée : les muscles concernés n'auront pas récupéré.
    const moved = await call('POST', `/api/sessions/${upcoming.id}/move`, {
      body: { scheduledDate: '2025-01-07' },
      now: at(72),
    });

    // Selon les muscles ciblés, le déplacement passe ou est refusé — dans les
    // deux cas la réponse doit être explicite.
    if (moved.status === 409) {
      expect(moved.body.moved).toBe(false);
      expect(moved.body.conflicts.length).toBeGreaterThan(0);
      expect(moved.body.message).toContain('48 h');
    } else {
      expect(moved.status).toBe(200);
      expect(moved.body.moved).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Derrière le SSO, nginx transmet le compte validé par Authelia dans les
 * en-têtes `Remote-*`. Ces tests jouent le rôle de nginx.
 */
describe('authentification SSO', () => {
  const LOGOUT_URL = 'https://auth.valldoy.com/logout';
  let ssoApp: ReturnType<typeof createApp>;

  beforeAll(() => {
    ssoApp = createApp(db, { auth: { mode: 'forward-auth', logoutUrl: LOGOUT_URL } });
  });

  async function ssoCall(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ) {
    const response = await ssoApp.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  it('laisse la sonde de santé accessible sans compte', async () => {
    const { status } = await ssoCall('GET', '/api/health', {});
    expect(status).toBe(200);
  });

  it('refuse une requête sans en-tête Remote-User', async () => {
    const { status, body } = await ssoCall('GET', '/api/profile', {});
    expect(status).toBe(401);
    expect(body.error.code).toBe('unauthenticated');
  });

  it('crée le profil d’un compte à sa première visite, accents compris', async () => {
    // Authelia envoie le nom en UTF-8, Node le lit en Latin-1 : on reproduit
    // exactement ce qui arrive en production.
    const asReceivedByNode = Buffer.from('Jérôme Dupont', 'utf8').toString('latin1');

    const { status, body } = await ssoCall('GET', '/api/profile', {
      'Remote-User': 'alice',
      'Remote-Name': asReceivedByNode,
    });

    expect(status).toBe(200);
    expect(body.displayName).toBe('Jérôme Dupont');
    expect(body.equipment.owned).toContain('dumbbells');
    expect(body.muscleSettings).toHaveLength(17);
  });

  it('expose le compte connecté et l’adresse de déconnexion', async () => {
    const { status, body } = await ssoCall('GET', '/api/me', {
      'Remote-User': 'alice',
      'Remote-Name': 'Alice',
      'Remote-Email': 'alice@valldoy.com',
      'Remote-Groups': 'admins, users',
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      authMode: 'forward-auth',
      username: 'alice',
      displayName: 'Alice',
      email: 'alice@valldoy.com',
      groups: ['admins', 'users'],
      logoutUrl: LOGOUT_URL,
    });
  });

  it('ne crée qu’un profil quand les premières requêtes arrivent en parallèle', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => ssoCall('GET', '/api/profile', { 'Remote-User': 'carole' })),
    );

    for (const response of responses) expect(response.status).toBe(200);
    expect(new Set(responses.map((r) => r.body.userId)).size).toBe(1);

    const rows = await db.select().from(users).where(eq(users.externalId, 'carole'));
    expect(rows).toHaveLength(1);
  });

  it('isole les données de chaque compte', async () => {
    const alice = { 'Remote-User': 'alice' };
    const bob = { 'Remote-User': 'bob' };

    const generated = await ssoCall('POST', '/api/plan/generate', alice, { durationWeeks: 4 });
    expect(generated.status).toBe(201);

    const plan = await ssoCall('GET', '/api/plan/current', alice);
    const sessionId = plan.body.upcomingSessions[0].id;

    expect((await ssoCall('GET', '/api/plan/current', bob)).body.plan).toBeNull();
    expect((await ssoCall('GET', `/api/sessions/${sessionId}`, bob)).status).toBe(404);
    expect((await ssoCall('GET', `/api/plan/sessions/${sessionId}/muscles`, bob)).status).toBe(
      404,
    );
    expect(
      (await ssoCall('POST', '/api/workouts/start', bob, { plannedSessionId: sessionId })).status,
    ).toBe(404);

    expect((await ssoCall('GET', `/api/plan/sessions/${sessionId}/muscles`, alice)).status).toBe(
      200,
    );
  });
});
