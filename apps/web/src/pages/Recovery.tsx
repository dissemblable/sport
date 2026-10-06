import { MUSCLE_LABELS, type MuscleCode } from '@sport/shared';
import { useState } from 'react';
import { useCheckin, useRecoveryState } from '../api/queries';
import { BodyMap, BodyMapLegend } from '../components/BodyMap';
import {
  Card,
  ErrorMessage,
  Gauge,
  Loading,
  Notice,
  StatusPill,
  formatHours,
} from '../components/ui';

/**
 * Écran de récupération.
 *
 * L'application doit toujours pouvoir répondre à « pourquoi ce muscle n'est-il
 * pas disponible ? ». Chaque groupe affiche donc son statut, la raison précise
 * de son blocage et l'heure de son retour — jamais un simple verrou opaque.
 */
export function Recovery() {
  const { data, isLoading, error } = useRecoveryState();
  const [selected, setSelected] = useState<MuscleCode | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);

  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const detail = selected ? data.muscles.find((m) => m.muscle === selected) : null;
  const blocked = data.muscles.filter((m) => !m.isAvailable);
  const available = data.muscles.filter((m) => m.isAvailable);

  return (
    <>
      <Card
        title="État musculaire"
        action={
          <button
            type="button"
            className="text-xs text-brand-400 hover:underline"
            onClick={() => setShowCheckin((value) => !value)}
          >
            {showCheckin ? 'Fermer' : 'Point de forme'}
          </button>
        }
      >
        <BodyMap muscles={data.muscles} selected={selected} onSelect={setSelected} />
        <BodyMapLegend />

        {detail ? (
          <div className="mt-4 rounded-xl border border-ink-800 bg-ink-950 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold">{detail.label}</h3>
              <StatusPill status={detail.status} label={detail.statusLabel} />
            </div>

            <p className="mb-3 text-sm text-ink-400">{detail.statusDescription}</p>

            <Gauge value={detail.fatiguePct} label="Fatigue résiduelle" danger />

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-ink-400">Dernière sollicitation</dt>
                <dd>
                  {detail.hoursSinceLastStimulus === null
                    ? 'Jamais'
                    : `il y a ${formatHours(detail.hoursSinceLastStimulus)}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Disponible</dt>
                <dd className={detail.isAvailable ? 'text-fresh' : ''}>
                  {detail.isAvailable
                    ? 'Maintenant'
                    : `dans ${formatHours(detail.hoursUntilAvailable)}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Volume 7 jours</dt>
                <dd>
                  {detail.weeklySets} / {detail.weeklySetsTarget} séries
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Score de fatigue</dt>
                <dd>{Math.round(detail.fatiguePct * 100)} %</dd>
              </div>
            </dl>

            {detail.blockedExplanation && (
              <div className="mt-3">
                <Notice tone="warning">{detail.blockedExplanation}</Notice>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-center text-xs text-ink-400">
            Touchez un muscle pour voir le détail de sa récupération.
          </p>
        )}
      </Card>

      {showCheckin && <CheckinForm onDone={() => setShowCheckin(false)} />}

      <Card title="Fatigue générale">
        <Gauge value={data.systemic.score} label="Charge accumulée" danger />

        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-400">RPE moyen (7 j)</dt>
            <dd>{data.systemic.averageSessionRpe ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Sommeil moyen</dt>
            <dd>
              {data.systemic.averageSleepHours === null
                ? '—'
                : `${data.systemic.averageSleepHours} h`}
            </dd>
          </div>
        </dl>

        {data.systemic.reasons.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-ink-800 pt-3 text-sm text-ink-300">
            {data.systemic.reasons.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
        )}
      </Card>

      {blocked.length > 0 && (
        <Card title={`En récupération (${blocked.length})`}>
          <ul className="divide-y divide-ink-800">
            {blocked
              .sort((a, b) => (a.hoursUntilAvailable ?? 0) - (b.hoursUntilAvailable ?? 0))
              .map((muscle) => (
                <li key={muscle.muscle} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{muscle.label}</p>
                    <p className="truncate text-xs text-ink-400">{muscle.blockedExplanation}</p>
                  </div>
                  <StatusPill status={muscle.status} label={muscle.statusLabel} />
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card title={`Disponibles (${available.length})`}>
        <div className="flex flex-wrap gap-2">
          {available.map((muscle) => (
            <button
              key={muscle.muscle}
              type="button"
              onClick={() => setSelected(muscle.muscle)}
              className="rounded-lg border border-ink-800 px-2.5 py-1.5 text-xs hover:bg-ink-800"
            >
              {muscle.label}
              <span className="ml-1.5 text-ink-400">
                {muscle.weeklySets}/{muscle.weeklySetsTarget}
              </span>
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Point de forme                                  */
/* -------------------------------------------------------------------------- */

/**
 * Déclaration de l'état de forme du jour.
 *
 * Les courbatures déclarées au-delà de 3/5 injectent de la fatigue
 * supplémentaire : le muscle concerné voit sa disponibilité repoussée, sans
 * que l'historique passé ne soit réécrit.
 */
function CheckinForm({ onDone }: { onDone: () => void }) {
  const checkin = useCheckin();
  const [sleepHours, setSleepHours] = useState(7.5);
  const [sleepQuality, setSleepQuality] = useState(3);
  const [stress, setStress] = useState(2);
  const [energy, setEnergy] = useState(3);
  const [soreness, setSoreness] = useState<Partial<Record<MuscleCode, number>>>({});

  const sorenessList = Object.entries(soreness)
    .filter(([, value]) => value > 0)
    .map(([muscle, value]) => ({ muscle: muscle as MuscleCode, soreness: value }));

  return (
    <Card title="Point de forme">
      <div className="space-y-4">
        <Slider
          label="Heures de sommeil"
          value={sleepHours}
          min={3}
          max={11}
          step={0.5}
          onChange={setSleepHours}
          format={(v) => `${v} h`}
        />
        <Slider
          label="Qualité du sommeil"
          value={sleepQuality}
          min={1}
          max={5}
          step={1}
          onChange={setSleepQuality}
          format={(v) => `${v}/5`}
        />
        <Slider
          label="Niveau de stress"
          value={stress}
          min={1}
          max={5}
          step={1}
          onChange={setStress}
          format={(v) => `${v}/5`}
        />
        <Slider
          label="Énergie"
          value={energy}
          min={1}
          max={5}
          step={1}
          onChange={setEnergy}
          format={(v) => `${v}/5`}
        />

        <div>
          <p className="mb-2 text-sm text-ink-300">Courbatures ressenties</p>
          <p className="mb-2 text-xs text-ink-400">
            À partir de 3/5, la disponibilité du muscle est automatiquement repoussée.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(MUSCLE_LABELS) as MuscleCode[]).map((muscle) => (
              <label key={muscle} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-ink-300">{MUSCLE_LABELS[muscle]}</span>
                <select
                  className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-xs"
                  value={soreness[muscle] ?? 0}
                  onChange={(event) =>
                    setSoreness((current) => ({
                      ...current,
                      [muscle]: Number(event.target.value),
                    }))
                  }
                >
                  {[0, 1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        {checkin.data && <Notice tone="info">{checkin.data.message}</Notice>}
        {checkin.error && <ErrorMessage error={checkin.error} />}

        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={checkin.isPending}
            onClick={() =>
              checkin.mutate(
                {
                  sleepHours,
                  sleepQuality,
                  stress,
                  energy,
                  soreness: sorenessList,
                },
                { onSuccess: () => setTimeout(onDone, 1200) },
              )
            }
          >
            {checkin.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" className="btn-ghost" onClick={onDone}>
            Annuler
          </button>
        </div>
      </div>
    </Card>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-sm">
        <span className="text-ink-300">{label}</span>
        <span className="text-ink-100">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-brand-500"
      />
    </label>
  );
}
