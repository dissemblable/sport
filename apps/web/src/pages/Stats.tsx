import { MUSCLE_LABELS, type MuscleCode } from '@sport/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSummary, useVolumeStats } from '../api/queries';
import { Card, ErrorMessage, Gauge, Loading, formatShortDate } from '../components/ui';

/**
 * Statistiques.
 *
 * Le graphique central compare le volume réalisé aux repères MEV / MAV / MRV.
 * C'est la lecture qui compte en hypertrophie : trop peu et l'on ne progresse
 * pas, trop et l'on ne récupère plus. Un simple total de séries ne dirait rien.
 */
export function Stats() {
  const [weeks, setWeeks] = useState(8);
  const volume = useVolumeStats(weeks);
  const summary = useSummary();
  const [selected, setSelected] = useState<MuscleCode | null>(null);

  const byMuscle = useMemo(() => {
    if (!volume.data) return [];

    const grouped = new Map<
      MuscleCode,
      { muscle: MuscleCode; label: string; mev: number; mav: number; mrv: number; total: number; weeks: number }
    >();

    for (const point of volume.data.points) {
      const entry = grouped.get(point.muscle) ?? {
        muscle: point.muscle,
        label: point.label,
        mev: point.mev,
        mav: point.mav,
        mrv: point.mrv,
        total: 0,
        weeks: 0,
      };
      entry.total += point.effectiveSets;
      entry.weeks += 1;
      grouped.set(point.muscle, entry);
    }

    return [...grouped.values()]
      .map((entry) => ({ ...entry, average: entry.total / Math.max(1, entry.weeks) }))
      .sort((a, b) => b.average - a.average);
  }, [volume.data]);

  const series = useMemo(() => {
    if (!volume.data || !selected) return [];
    return volume.data.points
      .filter((point) => point.muscle === selected)
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }, [volume.data, selected]);

  if (volume.isLoading) return <Loading />;
  if (volume.error) return <ErrorMessage error={volume.error} />;

  return (
    <>
      {summary.data && (
        <Card title="Cette semaine">
          <Gauge
            value={summary.data.totalWeeklySets}
            max={Math.max(summary.data.totalWeeklyTarget, 1)}
            label="Séries effectives"
            hint={`${summary.data.totalWeeklySets} / ${summary.data.totalWeeklyTarget}`}
          />
          <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
            <Stat label="Semaine" value={`${summary.data.mesocycleWeek}`} />
            <Stat label="Disponibles" value={`${summary.data.availableMuscles}`} />
            <Stat label="En récup" value={`${summary.data.blockedMuscles}`} />
          </div>
        </Card>
      )}

      <Card
        title="Volume par muscle"
        action={
          <div className="flex gap-1">
            {[4, 8, 12].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setWeeks(value)}
                className={`rounded-lg px-2 py-1 text-xs ${
                  weeks === value ? 'bg-brand-500/20 text-brand-400' : 'text-ink-400'
                }`}
              >
                {value} sem.
              </button>
            ))}
          </div>
        }
      >
        {byMuscle.length === 0 ? (
          <p className="text-sm text-ink-400">
            Aucune donnée pour l’instant. Enregistrez une séance pour voir vos volumes.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-400">
              Moyenne hebdomadaire, comparée au volume minimum entraînant (MEV) et au volume
              récupérable maximal (MRV).
            </p>
            <ul className="space-y-2.5">
              {byMuscle.map((entry) => (
                <li key={entry.muscle}>
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() =>
                      setSelected((current) => (current === entry.muscle ? null : entry.muscle))
                    }
                  >
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className={selected === entry.muscle ? 'text-brand-400' : 'text-ink-300'}>
                        {entry.label}
                      </span>
                      <span className="text-ink-400">
                        {entry.average.toFixed(1)} séries/sem.
                      </span>
                    </div>
                    <VolumeBar value={entry.average} mev={entry.mev} mav={entry.mav} mrv={entry.mrv} />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-800 pt-3 text-xs text-ink-400">
              <LegendItem color="var(--color-overreached)" label="Sous le MEV" />
              <LegendItem color="var(--color-fresh)" label="Zone productive" />
              <LegendItem color="var(--color-fatigued)" label="Au-delà du MRV" />
            </div>
          </>
        )}
      </Card>

      {selected && series.length > 0 && (
        <Card title={`${MUSCLE_LABELS[selected]} — évolution`}>
          <ul className="space-y-2">
            {series.map((point) => (
              <li key={point.weekStart}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-ink-400">
                    semaine du {formatShortDate(point.weekStart)}
                  </span>
                  <span>{point.effectiveSets} séries</span>
                </div>
                <VolumeBar
                  value={point.effectiveSets}
                  mev={point.mev}
                  mav={point.mav}
                  mrv={point.mrv}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary.data && summary.data.underTrained.length > 0 && (
        <Card title="À renforcer">
          <p className="mb-2 text-xs text-ink-400">
            Ces groupes reçoivent moins que leur volume minimum entraînant. Augmentez leur priorité
            dans les réglages pour que l’algorithme leur accorde plus de séries.
          </p>
          <ul className="space-y-1 text-sm">
            {summary.data.underTrained.map((entry) => (
              <li key={entry.muscle} className="flex justify-between">
                <span className="text-ink-300">{entry.label}</span>
                <span className="text-ink-400">
                  {entry.weeklySets} / {entry.mev} min.
                </span>
              </li>
            ))}
          </ul>
          <Link to="/reglages" className="btn-ghost mt-3 w-full text-sm">
            Ajuster les priorités
          </Link>
        </Card>
      )}
    </>
  );
}

/**
 * Barre de volume avec repères.
 *
 * La couleur code directement le diagnostic : rouge sous le MEV (on ne
 * progresse pas), vert dans la zone productive, orange au-delà du MRV (on ne
 * récupère plus).
 */
function VolumeBar({
  value,
  mev,
  mav,
  mrv,
}: {
  value: number;
  mev: number;
  mav: number;
  mrv: number;
}) {
  const scale = Math.max(mrv * 1.15, value * 1.05, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;

  const color =
    value < mev
      ? 'var(--color-overreached)'
      : value > mrv
        ? 'var(--color-fatigued)'
        : 'var(--color-fresh)';

  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-ink-800">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: pct(value), background: color }}
      />
      {/* Repères MEV / MAV / MRV */}
      {[mev, mav, mrv].map((marker, index) => (
        <span
          key={index}
          className="absolute top-0 h-full w-px bg-ink-400/60"
          style={{ left: pct(marker) }}
        />
      ))}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-800 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-ink-400">{label}</p>
    </div>
  );
}
