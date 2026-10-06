import { MESOCYCLE_PHASE_LABELS } from '@sport/shared';
import { Link } from 'react-router-dom';
import { useCurrentPlan, useGeneratePlan, useRecoveryState, useSummary } from '../api/queries';
import { BodyMap } from '../components/BodyMap';
import {
  Card,
  EmptyState,
  ErrorMessage,
  Gauge,
  Loading,
  Notice,
  formatDate,
  formatHours,
  todayIso,
} from '../components/ui';

/**
 * Tableau de bord.
 *
 * Répond à trois questions, dans cet ordre : qu'est-ce que je fais
 * aujourd'hui ? où en est ma récupération ? qu'est-ce qui m'attend ensuite ?
 */
export function Dashboard() {
  const plan = useCurrentPlan();
  const recovery = useRecoveryState();
  const summary = useSummary();
  const generate = useGeneratePlan();

  if (plan.isLoading || recovery.isLoading) return <Loading />;
  if (plan.error) return <ErrorMessage error={plan.error} />;
  if (recovery.error) return <ErrorMessage error={recovery.error} />;

  if (!plan.data?.plan) {
    return (
      <EmptyState
        title="Aucun programme en cours"
        description="Générez un mésocycle : l’application construit un découpage adapté à votre fréquence, place les séances en respectant 48 h de repos par muscle, et ajuste le volume semaine après semaine."
        action={
          <button
            type="button"
            className="btn-primary"
            disabled={generate.isPending}
            onClick={() => generate.mutate({ restart: true })}
          >
            {generate.isPending ? 'Génération…' : 'Générer mon programme'}
          </button>
        }
      />
    );
  }

  const today = todayIso();
  const sessions = plan.data.upcomingSessions ?? [];
  const todaySession = sessions.find((session) => session.scheduledDate === today);
  const nextSession = sessions.find((session) => session.scheduledDate > today);
  const systemic = recovery.data?.systemic;

  // Les muscles bloqués les plus proches de leur disponibilité : c'est ce que
  // l'utilisateur veut savoir, pas la liste exhaustive.
  const soonAvailable = (recovery.data?.muscles ?? [])
    .filter((muscle) => !muscle.isAvailable && muscle.hoursUntilAvailable !== null)
    .sort((a, b) => (a.hoursUntilAvailable ?? 0) - (b.hoursUntilAvailable ?? 0))
    .slice(0, 4);

  return (
    <>
      {systemic?.deloadRecommended && (
        <Notice tone="warning">
          <strong>Décharge recommandée.</strong>{' '}
          {systemic.reasons[0] ?? 'La fatigue accumulée devient trop élevée.'}{' '}
          <Link to="/planning" className="underline">
            Alléger la semaine
          </Link>
        </Notice>
      )}

      {/* ------------------------- Séance du jour ------------------------- */}
      <Card title="Aujourd’hui">
        {todaySession ? (
          <div className="space-y-3">
            <div>
              <p className="text-lg font-semibold">{todaySession.slotLabel}</p>
              <p className="text-sm text-ink-400">
                Semaine {todaySession.mesocycleWeek} ·{' '}
                {MESOCYCLE_PHASE_LABELS[todaySession.phase]} ·{' '}
                {todaySession.estimatedDurationMinutes} min
              </p>
            </div>
            <Link to={`/seance/${todaySession.id}`} className="btn-primary w-full">
              Démarrer la séance
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-300">
              Aucune séance planifiée aujourd’hui — c’est un jour de récupération.
            </p>
            <Link to="/seance" className="btn-ghost w-full">
              M’entraîner quand même
            </Link>
            <p className="text-xs text-ink-400">
              L’application composera une séance avec les groupes musculaires réellement
              récupérés.
            </p>
          </div>
        )}
      </Card>

      {/* --------------------------- Récupération -------------------------- */}
      <Card
        title="Récupération"
        action={
          <Link to="/recuperation" className="text-xs text-brand-400 hover:underline">
            Détail
          </Link>
        }
      >
        <BodyMap muscles={recovery.data?.muscles ?? []} />

        <div className="mt-4 space-y-3">
          <Gauge
            value={systemic?.score ?? 0}
            label="Fatigue générale"
            hint={`${Math.round((systemic?.score ?? 0) * 100)} %`}
            danger
          />

          <div className="flex justify-between text-sm">
            <span className="text-ink-300">
              <strong className="text-ink-100">{recovery.data?.available.length ?? 0}</strong>{' '}
              muscles disponibles
            </span>
            <span className="text-ink-300">
              <strong className="text-ink-100">{recovery.data?.blocked.length ?? 0}</strong> en
              récupération
            </span>
          </div>

          {soonAvailable.length > 0 && (
            <ul className="space-y-1 border-t border-ink-800 pt-3 text-sm">
              {soonAvailable.map((muscle) => (
                <li key={muscle.muscle} className="flex justify-between">
                  <span className="text-ink-300">{muscle.label}</span>
                  <span className="text-ink-400">
                    dans {formatHours(muscle.hoursUntilAvailable)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ------------------------- Volume de la semaine -------------------- */}
      {summary.data && (
        <Card title="Volume de la semaine">
          <Gauge
            value={summary.data.totalWeeklySets}
            max={Math.max(summary.data.totalWeeklyTarget, 1)}
            label="Séries effectives réalisées"
            hint={`${summary.data.totalWeeklySets} / ${summary.data.totalWeeklyTarget}`}
          />

          {summary.data.underTrained.length > 0 && (
            <p className="mt-3 text-xs text-ink-400">
              Sous leur volume minimum :{' '}
              {summary.data.underTrained
                .slice(0, 5)
                .map((entry) => entry.label)
                .join(', ')}
              .
            </p>
          )}
          {summary.data.overReached.length > 0 && (
            <p className="mt-2 text-xs text-amber-300">
              Au-delà du volume récupérable :{' '}
              {summary.data.overReached.map((entry) => entry.label).join(', ')}.
            </p>
          )}
        </Card>
      )}

      {/* ---------------------------- À venir ------------------------------ */}
      <Card
        title="À venir"
        action={
          <Link to="/planning" className="text-xs text-brand-400 hover:underline">
            Planning
          </Link>
        }
      >
        {nextSession ? (
          <ul className="divide-y divide-ink-800">
            {sessions
              .filter((session) => session.scheduledDate > today)
              .slice(0, 4)
              .map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{session.slotLabel}</p>
                    <p className="text-xs text-ink-400">{formatDate(session.scheduledDate)}</p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-400">
                    {session.estimatedDurationMinutes} min
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-400">
            Fin du mésocycle. Générez un nouveau bloc depuis le planning.
          </p>
        )}
      </Card>
    </>
  );
}
