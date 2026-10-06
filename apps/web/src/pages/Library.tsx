import {
  EQUIPMENT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_LABELS,
  type EquipmentCode,
  type MovementPattern,
  type MuscleCode,
} from '@sport/shared';
import { useState } from 'react';
import { useExercises } from '../api/queries';
import type { ExerciseListItemDto } from '../api/client';
import { Card, ErrorMessage, Loading } from '../components/ui';

/**
 * Bibliothèque d'exercices.
 *
 * Chaque fiche indique explicitement le matériel requis et la répartition
 * musculaire pondérée — c'est cette pondération qui alimente le suivi de
 * fatigue, autant la rendre visible plutôt que d'en faire une boîte noire.
 */
export function Library() {
  const [muscle, setMuscle] = useState<MuscleCode | ''>('');
  const [pattern, setPattern] = useState<MovementPattern | ''>('');
  const [equipment, setEquipment] = useState<EquipmentCode | ''>('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading, error } = useExercises({
    muscle: muscle || undefined,
    pattern: pattern || undefined,
    equipment: equipment || undefined,
    onlyAvailable: onlyAvailable ? 'true' : undefined,
    search: search.trim() || undefined,
  });

  return (
    <>
      <Card title="Filtres">
        <div className="space-y-3">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un exercice…"
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm placeholder:text-ink-600"
          />

          <div className="grid grid-cols-2 gap-2">
            <Select
              value={muscle}
              onChange={(value) => setMuscle(value as MuscleCode | '')}
              placeholder="Tous les muscles"
              options={Object.entries(MUSCLE_LABELS)}
            />
            <Select
              value={pattern}
              onChange={(value) => setPattern(value as MovementPattern | '')}
              placeholder="Tous les patrons"
              options={Object.entries(MOVEMENT_PATTERN_LABELS)}
            />
            <Select
              value={equipment}
              onChange={(value) => setEquipment(value as EquipmentCode | '')}
              placeholder="Tout le matériel"
              options={Object.entries(EQUIPMENT_LABELS)}
            />
            <label className="flex items-center gap-2 rounded-xl border border-ink-700 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(event) => setOnlyAvailable(event.target.checked)}
                className="accent-brand-500"
              />
              Réalisables
            </label>
          </div>
        </div>
      </Card>

      {isLoading && <Loading />}
      {error && <ErrorMessage error={error} />}

      {data && (
        <Card title={`${data.total} exercice${data.total > 1 ? 's' : ''}`}>
          <ul className="divide-y divide-ink-800">
            {data.items.map((exercise) => (
              <li key={exercise.id}>
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 py-3 text-left"
                  onClick={() =>
                    setExpanded((current) => (current === exercise.id ? null : exercise.id))
                  }
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {exercise.name}
                      {!exercise.isAvailable && (
                        <span className="ml-2 text-xs text-ink-500">(matériel manquant)</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {exercise.patternLabel} · {exercise.mechanicLabel} · difficulté{' '}
                      {exercise.difficulty}/5
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-400">
                    {exercise.defaultRepMin}–{exercise.defaultRepMax}
                  </span>
                </button>

                {expanded === exercise.id && <ExerciseDetail exercise={exercise} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ExerciseDetail({ exercise }: { exercise: ExerciseListItemDto }) {
  return (
    <div className="mb-3 rounded-xl border border-ink-800 bg-ink-950 p-3">
      {exercise.setupNotes && (
        <p className="mb-3 text-xs text-ink-400">
          <span className="text-ink-300">Installation : </span>
          {exercise.setupNotes}
        </p>
      )}

      {exercise.executionCues.length > 0 && (
        <ul className="mb-3 space-y-1 text-xs text-ink-300">
          {exercise.executionCues.map((cue) => (
            <li key={cue}>• {cue}</li>
          ))}
        </ul>
      )}

      <p className="mb-1 text-xs text-ink-400">Matériel</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {exercise.equipment.map((item) => (
          <span
            key={item.code}
            className="rounded-lg border border-ink-700 px-2 py-0.5 text-xs text-ink-300"
          >
            {item.label}
          </span>
        ))}
      </div>

      <p className="mb-1 text-xs text-ink-400">
        Répartition musculaire — la contribution pondère le comptage du volume et de la fatigue
      </p>
      <ul className="space-y-1">
        {exercise.muscles
          .slice()
          .sort((a, b) => b.contribution - a.contribution)
          .map((involvement) => (
            <li key={involvement.muscle} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0 truncate text-ink-300">{involvement.label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
                <span
                  className="block h-full rounded-full bg-brand-500"
                  style={{ width: `${involvement.contribution * 100}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-ink-400">
                {involvement.contribution.toFixed(2)}
              </span>
            </li>
          ))}
      </ul>

      <p className="mt-3 text-xs text-ink-400">
        Charge systémique {exercise.systemicLoad} · repos conseillé {exercise.defaultRestSeconds} s
        {exercise.isUnilateral && ' · unilatéral'}
      </p>
    </div>
  );
}

function Select({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
    >
      <option value="">{placeholder}</option>
      {options.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}
