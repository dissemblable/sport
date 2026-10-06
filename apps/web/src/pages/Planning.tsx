import {
  MAX_SESSIONS_PER_WEEK,
  MESOCYCLE_PHASE_LABELS,
  MIN_SESSIONS_PER_WEEK,
  SESSION_STATUS_LABELS,
} from '@sport/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useApplyFrequency,
  useCurrentPlan,
  useGeneratePlan,
  usePreviewFrequency,
  useRegenerateSession,
  useSkipSession,
} from '../api/queries';
import type { FrequencyImpactDto } from '../api/client';
import {
  Card,
  EmptyState,
  ErrorMessage,
  Loading,
  Notice,
  formatDate,
  todayIso,
  weekdayLabel,
} from '../components/ui';

/**
 * Planning et modulation du rythme.
 *
 * L'écran porte la fonctionnalité de planification dynamique : changer de
 * fréquence n'y est pas un simple réglage, mais une décision dont l'impact est
 * affiché avant validation — nouveau découpage, jours retenus, volume par
 * séance muscle par muscle.
 */
export function Planning() {
  const plan = useCurrentPlan();
  const generate = useGeneratePlan();
  const skip = useSkipSession();
  const regenerate = useRegenerateSession();

  if (plan.isLoading) return <Loading />;
  if (plan.error) return <ErrorMessage error={plan.error} />;

  if (!plan.data?.plan) {
    return (
      <EmptyState
        title="Aucun programme"
        description="Générez un mésocycle pour commencer."
        action={
          <button
            type="button"
            className="btn-primary"
            disabled={generate.isPending}
            onClick={() => generate.mutate({ restart: true })}
          >
            Générer mon programme
          </button>
        }
      />
    );
  }

  const current = plan.data.plan;
  const sessions = plan.data.upcomingSessions ?? [];
  const today = todayIso();

  return (
    <>
      <Card title="Programme actuel">
        <div className="space-y-2 text-sm">
          <Row label="Découpage" value={current.splitLabel} />
          <Row label="Fréquence" value={`${current.sessionsPerWeek} séances par semaine`} />
          <Row
            label="Jours"
            value={current.weekdays.map((day) => weekdayLabel(day, true)).join(' · ')}
          />
          <Row
            label="Repos minimal garanti"
            value={`${current.minGapHours} h entre deux sollicitations d’un même muscle`}
          />
          <Row
            label="Mésocycle"
            value={`Semaine ${plan.data.currentWeek} / ${current.durationWeeks} · ${
              plan.data.phase ? MESOCYCLE_PHASE_LABELS[plan.data.phase] : ''
            }`}
          />
          <Row label="Version du plan" value={`v${current.version}`} />
        </div>
      </Card>

      <FrequencyChanger currentFrequency={current.sessionsPerWeek} />

      <Card title="Créneaux du découpage">
        <ul className="space-y-2">
          {current.slots.map((slot) => (
            <li key={slot.index} className="rounded-xl border border-ink-800 p-3">
              <p className="text-sm font-medium">{slot.label}</p>
              <p className="mt-1 text-xs text-ink-400">
                {slot.targetMuscles.length} groupes ciblés · {slot.requiredPatterns.length} patrons
                moteurs imposés
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Séances à venir">
        {sessions.length === 0 ? (
          <p className="text-sm text-ink-400">
            Plus de séance planifiée. Générez un nouveau mésocycle.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800">
            {sessions.map((session) => (
              <li key={session.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{session.slotLabel}</p>
                    <p className="text-xs text-ink-400">
                      {formatDate(session.scheduledDate)}
                      {session.scheduledDate === today && ' · aujourd’hui'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      Semaine {session.mesocycleWeek} · {MESOCYCLE_PHASE_LABELS[session.phase]} ·{' '}
                      {session.estimatedDurationMinutes} min ·{' '}
                      {SESSION_STATUS_LABELS[session.status]}
                    </p>
                  </div>
                  <Link
                    to={`/seance/${session.id}`}
                    className="shrink-0 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs hover:bg-ink-800"
                  >
                    Ouvrir
                  </Link>
                </div>

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-ink-400 underline hover:text-ink-300"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate(session.id)}
                  >
                    Régénérer avec ma fatigue actuelle
                  </button>
                  <button
                    type="button"
                    className="text-xs text-ink-400 underline hover:text-ink-300"
                    disabled={skip.isPending}
                    onClick={() => skip.mutate(session.id)}
                  >
                    Passer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {skip.data && (
          <div className="mt-3">
            <Notice tone="info">{skip.data.message}</Notice>
          </div>
        )}
      </Card>

      <Card title="Nouveau bloc">
        <p className="mb-3 text-sm text-ink-400">
          Un mésocycle dure cinq semaines : le volume monte progressivement, puis une semaine de
          décharge laisse la fatigue accumulée retomber.
        </p>
        <button
          type="button"
          className="btn-ghost w-full"
          disabled={generate.isPending}
          onClick={() => generate.mutate({ restart: true })}
        >
          {generate.isPending ? 'Génération…' : 'Démarrer un nouveau mésocycle'}
        </button>
        {generate.data && (
          <div className="mt-3">
            <Notice tone="info">{generate.data.message}</Notice>
          </div>
        )}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-400">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Changement de fréquence                           */
/* -------------------------------------------------------------------------- */

/**
 * Sélecteur de fréquence avec aperçu.
 *
 * Le point important est qu'aucun changement n'est appliqué sans que
 * l'utilisateur ait vu l'impact : nouveau découpage, jours retenus, écart de
 * repos obtenu, et volume par séance pour chaque muscle. Le volume
 * hebdomadaire, lui, ne bouge pas — c'est ce que l'aperçu doit rendre évident.
 */
function FrequencyChanger({ currentFrequency }: { currentFrequency: number }) {
  const [selected, setSelected] = useState(currentFrequency);
  const previewFrequency = usePreviewFrequency();
  const applyFrequency = useApplyFrequency();

  const impact: FrequencyImpactDto | undefined = previewFrequency.data;
  const options = Array.from(
    { length: MAX_SESSIONS_PER_WEEK - MIN_SESSIONS_PER_WEEK + 1 },
    (_, index) => MIN_SESSIONS_PER_WEEK + index,
  );

  const changed = selected !== currentFrequency;

  return (
    <Card title="Changer de fréquence">
      <p className="mb-3 text-sm text-ink-400">
        Le volume hebdomadaire est conservé et redistribué sur le nouveau nombre de séances. Les
        séances déjà réalisées ne sont jamais modifiées.
      </p>

      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setSelected(option);
              previewFrequency.reset();
              applyFrequency.reset();
              if (option !== currentFrequency) previewFrequency.mutate(option);
            }}
            className={`flex-1 rounded-xl border py-3 text-lg font-semibold transition-colors ${
              selected === option
                ? 'border-brand-500 bg-brand-500/15 text-brand-400'
                : 'border-ink-700 text-ink-300 hover:bg-ink-800'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <p className="mt-1 text-center text-xs text-ink-400">séances par semaine</p>

      {previewFrequency.isPending && <Loading label="Calcul de l’impact…" />}
      {previewFrequency.error && (
        <div className="mt-3">
          <ErrorMessage error={previewFrequency.error} />
        </div>
      )}

      {changed && impact && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-ink-800 bg-ink-950 p-3">
            <p className="text-sm">{impact.summary}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Metric
              label="Volume hebdomadaire"
              value={`${impact.totalWeeklySetsAfter} séries`}
              hint={`avant : ${impact.totalWeeklySetsBefore}`}
            />
            <Metric
              label="Repos minimal"
              value={`${impact.minGapHours} h`}
              hint={impact.respectsMinRest ? 'conforme' : 'insuffisant'}
              danger={!impact.respectsMinRest}
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-ink-400">Jours retenus</p>
            <p className="text-sm">
              {impact.weekdays.map((day) => weekdayLabel(day, true)).join(' · ')}
            </p>
          </div>

          {impact.warnings.map((warning) => (
            <Notice key={warning} tone="warning">
              {warning}
            </Notice>
          ))}

          <details className="rounded-xl border border-ink-800 p-3">
            <summary className="cursor-pointer text-sm text-ink-300">
              Détail par groupe musculaire
            </summary>
            <table className="mt-3 w-full text-xs">
              <thead className="text-ink-400">
                <tr className="text-left">
                  <th className="pb-1 font-normal">Muscle</th>
                  <th className="pb-1 text-right font-normal">Fréq.</th>
                  <th className="pb-1 text-right font-normal">Séries/séance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {impact.comparison.map((row) => (
                  <tr key={row.muscle}>
                    <td className="py-1.5">{row.label}</td>
                    <td className="py-1.5 text-right text-ink-400">
                      {row.frequencyBefore} → {row.frequencyAfter}
                    </td>
                    <td className="py-1.5 text-right">
                      {row.setsPerSessionBefore} → {row.setsPerSessionAfter}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {applyFrequency.error && <ErrorMessage error={applyFrequency.error} />}
          {applyFrequency.data ? (
            <Notice tone="info">
              Plan mis à jour (v{applyFrequency.data.version}). Les séances futures ont été
              régénérées.
            </Notice>
          ) : (
            <button
              type="button"
              className="btn-primary w-full"
              disabled={applyFrequency.isPending}
              onClick={() => applyFrequency.mutate({ sessionsPerWeek: selected })}
            >
              {applyFrequency.isPending
                ? 'Application…'
                : `Passer à ${selected} séances par semaine`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-ink-800 p-3">
      <p className="text-xs text-ink-400">{label}</p>
      <p className={`text-lg font-semibold ${danger ? 'text-fatigued' : ''}`}>
        {value}
      </p>
      <p className="text-xs text-ink-400">{hint}</p>
    </div>
  );
}
