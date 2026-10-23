import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { LogSetInput } from '@sport/shared';
import {
  useActiveWorkout,
  useCurrentPlan,
  useFinishWorkout,
  useLogSet,
  usePreviewSession,
  useSession,
  useStartWorkout,
  type FinishWorkoutResponse,
} from '../api/queries';
import type { PrescribedExerciseDto } from '../api/client';
import {
  Card,
  EmptyState,
  ErrorMessage,
  ExerciseImages,
  Loading,
  Notice,
  formatHours,
  todayIso,
} from '../components/ui';

/**
 * Séance en cours.
 *
 * Conçue pour être utilisée pendant l'effort : un exercice à la fois, de gros
 * boutons, aucune saisie superflue. Les valeurs prescrites sont pré-remplies —
 * la plupart du temps, l'utilisateur n'a qu'à valider.
 */
export function Workout() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const plan = useCurrentPlan();
  const active = useActiveWorkout();
  const session = useSession(sessionId);
  const startWorkout = useStartWorkout();
  const preview = usePreviewSession();

  const workoutId = active.data?.active?.id;

  // Sans séance planifiée précisée, on compose une séance à la volée à partir
  // de l'état de récupération de l'instant.
  useEffect(() => {
    if (!sessionId && !preview.data && !preview.isPending) {
      preview.mutate({});
    }
  }, [sessionId, preview]);

  if (plan.isLoading || active.isLoading) return <Loading />;

  const todaySession = plan.data?.upcomingSessions?.find((s) => s.scheduledDate === todayIso());

  // Séance planifiée si un identifiant est fourni, sinon la proposition à la volée.
  const exercises: PrescribedExerciseDto[] =
    (sessionId ? session.data?.exercises : preview.data?.exercises) ?? [];

  const excludedExplanations =
    (sessionId
      ? session.data?.rationale?.excludedMuscles.map((entry) =>
          entry.hoursUntilAvailable == null
            ? `${entry.label} — ${entry.reasonLabel}`
            : `${entry.label} — ${entry.reasonLabel}, disponible dans ${formatHours(entry.hoursUntilAvailable)}`,
        )
      : preview.data?.excludedExplanations) ?? [];

  const warnings = (sessionId ? session.data?.rationale?.warnings : preview.data?.report.warnings) ?? [];
  const label = sessionId ? session.data?.slotLabel : preview.data?.slotLabel;
  const duration = sessionId
    ? session.data?.estimatedDurationMinutes
    : preview.data?.estimatedDurationMinutes;

  if (sessionId && session.isLoading) return <Loading />;
  if (sessionId && session.error) return <ErrorMessage error={session.error} />;
  if (!sessionId && preview.isPending) return <Loading label="Composition de la séance…" />;
  if (!sessionId && preview.error) return <ErrorMessage error={preview.error} />;

  if (exercises.length === 0) {
    return (
      <EmptyState
        title="Repos recommandé"
        description="Aucun groupe musculaire n’a suffisamment récupéré pour un travail productif. Une journée de mobilité ou de marche fera davantage progresser qu’une séance forcée."
        action={
          todaySession ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => navigate(`/seance/${todaySession.id}`)}
            >
              Voir la séance planifiée
            </button>
          ) : undefined
        }
      />
    );
  }

  if (!workoutId) {
    return (
      <>
        <Card title={label ?? 'Séance'}>
          <p className="mb-1 text-sm text-ink-400">
            {exercises.filter((e) => e.block !== 'warmup').length} exercices · environ {duration}{' '}
            minutes
          </p>

          {warnings.map((warning) => (
            <div key={warning} className="mt-3">
              <Notice tone="warning">{warning}</Notice>
            </div>
          ))}

          <ul className="mt-3 divide-y divide-ink-800">
            {exercises.map((exercise) => (
              <li key={`${exercise.exerciseId}-${exercise.block}`} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{exercise.name}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {exercise.targetSets} × {exercise.targetRepMin}–{exercise.targetRepMax}
                  </span>
                </div>
                {exercise.rationale && (
                  <p className="mt-0.5 text-xs text-ink-400">{exercise.rationale}</p>
                )}
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="btn-primary mt-4 w-full"
            disabled={startWorkout.isPending}
            onClick={() => startWorkout.mutate(sessionId ?? null)}
          >
            {startWorkout.isPending ? 'Démarrage…' : 'Commencer'}
          </button>
        </Card>

        {excludedExplanations.length > 0 && (
          <Card title="Muscles écartés">
            <p className="mb-2 text-xs text-ink-400">
              Ces groupes n’ont pas terminé leur récupération. Les entraîner maintenant
              n’apporterait aucun gain et augmenterait le risque de blessure.
            </p>
            <ul className="space-y-1 text-sm text-ink-300">
              {excludedExplanations.map((explanation) => (
                <li key={explanation}>• {explanation}</li>
              ))}
            </ul>
          </Card>
        )}
      </>
    );
  }

  return <ActiveWorkout workoutId={workoutId} exercises={exercises} label={label ?? 'Séance'} />;
}

/* -------------------------------------------------------------------------- */
/*                             Séance démarrée                                */
/* -------------------------------------------------------------------------- */

function ActiveWorkout({
  workoutId,
  exercises,
  label,
}: {
  workoutId: string;
  exercises: PrescribedExerciseDto[];
  label: string;
}) {
  const active = useActiveWorkout();
  const logSet = useLogSet(workoutId);
  const finish = useFinishWorkout(workoutId);
  const navigate = useNavigate();

  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<FinishWorkoutResponse | null>(null);

  const loggedSets = active.data?.active?.sets ?? [];
  const current = exercises[index];

  const setsDoneFor = (exerciseId: number) =>
    loggedSets.filter((set) => set.exerciseId === exerciseId && !set.isWarmup).length;

  const totalTarget = exercises
    .filter((e) => e.block !== 'warmup')
    .reduce((sum, e) => sum + e.targetSets, 0);
  const totalDone = loggedSets.filter((set) => !set.isWarmup).length;

  if (summary) {
    return <WorkoutSummary summary={summary} onClose={() => navigate('/')} />;
  }

  if (!current) return <Loading />;

  return (
    <>
      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-ink-300 uppercase">{label}</h2>
          <span className="text-xs text-ink-400">
            {totalDone} / {totalTarget} séries
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${totalTarget === 0 ? 0 : (totalDone / totalTarget) * 100}%` }}
          />
        </div>
      </Card>

      <ExercisePanel
        exercise={current}
        setsDone={setsDoneFor(current.exerciseId)}
        isPending={logSet.isPending}
        onLog={(input) => logSet.mutate(input)}
      />

      {logSet.error && <ErrorMessage error={logSet.error} />}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ghost flex-1"
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
        >
          Précédent
        </button>
        <button
          type="button"
          className="btn-ghost flex-1"
          disabled={index >= exercises.length - 1}
          onClick={() => setIndex((value) => value + 1)}
        >
          Suivant
        </button>
      </div>

      <Card title="Exercices">
        <ul className="divide-y divide-ink-800">
          {exercises.map((exercise, exerciseIndex) => {
            const done = setsDoneFor(exercise.exerciseId);
            const isComplete = done >= exercise.targetSets;
            return (
              <li key={`${exercise.exerciseId}-${exerciseIndex}`}>
                <button
                  type="button"
                  onClick={() => setIndex(exerciseIndex)}
                  className={`flex w-full items-center justify-between gap-3 py-2.5 text-left ${
                    exerciseIndex === index ? 'text-brand-400' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{exercise.name}</span>
                  <span
                    className={`shrink-0 text-xs ${isComplete ? 'text-fresh' : 'text-ink-400'}`}
                  >
                    {done}/{exercise.targetSets}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <FinishPanel
        isPending={finish.isPending}
        error={finish.error}
        onFinish={(sessionRpe) =>
          finish.mutate({ sessionRpe }, { onSuccess: (data) => setSummary(data) })
        }
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Saisie d'un exercice                              */
/* -------------------------------------------------------------------------- */

function ExercisePanel({
  exercise,
  setsDone,
  isPending,
  onLog,
}: {
  exercise: PrescribedExerciseDto;
  setsDone: number;
  isPending: boolean;
  onLog: (input: LogSetInput) => void;
}) {
  const prescribedLoad = exercise.prescription?.loadKg ?? exercise.loadKg ?? null;
  const bandLevel = exercise.prescription?.bandLevel ?? exercise.bandLevel ?? null;
  const perSide = exercise.prescription?.perSide ?? exercise.perSide ?? false;
  const progressionNote =
    exercise.prescription?.progressionNote ?? exercise.progressionNote ?? null;

  const [reps, setReps] = useState(exercise.targetRepMax);
  const [loadKg, setLoadKg] = useState<number | null>(prescribedLoad);
  const [rir, setRir] = useState(exercise.targetRir);
  const [restLeft, setRestLeft] = useState<number | null>(null);

  // Réinitialise la saisie quand on change d'exercice.
  useEffect(() => {
    setReps(exercise.targetRepMax);
    setLoadKg(prescribedLoad);
    setRir(exercise.targetRir);
    setRestLeft(null);
  }, [exercise.exerciseId, exercise.targetRepMax, exercise.targetRir, prescribedLoad]);

  // Chronomètre de repos, déclenché à la validation d'une série.
  useEffect(() => {
    if (restLeft === null || restLeft <= 0) return;
    const timer = setTimeout(() => setRestLeft((value) => (value ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [restLeft]);

  const remaining = Math.max(0, exercise.targetSets - setsDone);

  const submit = () => {
    onLog({
      exerciseId: exercise.exerciseId,
      setIndex: setsDone + 1,
      isWarmup: exercise.block === 'warmup',
      reps,
      loadKg,
      bandLevel,
      rir,
      toFailure: rir === 0,
      tempo: null,
      durationSeconds: null,
    });
    setRestLeft(exercise.restSeconds);
  };

  return (
    <Card>
      <div className="mb-3">
        <p className="text-xs tracking-wide text-ink-400 uppercase">{exercise.blockLabel}</p>
        <h2 className="text-lg font-semibold">{exercise.name}</h2>
        <p className="mt-1 text-sm text-ink-400">
          {exercise.targetSets} séries × {exercise.targetRepMin}–{exercise.targetRepMax} reps · RIR{' '}
          {exercise.targetRir}
          {perSide && ' · de chaque côté'}
          {bandLevel && ` · élastique ${bandLevel}`}
        </p>
      </div>

      {progressionNote && (
        <div className="mb-3">
          <Notice tone="info">{progressionNote}</Notice>
        </div>
      )}

      <ExerciseImages slug={exercise.slug} name={exercise.name} />

      {exercise.setupNotes && (
        <p className="mb-2 text-xs text-ink-400">
          <span className="text-ink-300">Installation : </span>
          {exercise.setupNotes}
        </p>
      )}

      {exercise.executionCues.length > 0 && (
        <ul className="mb-4 space-y-1 text-xs text-ink-400">
          {exercise.executionCues.map((cue) => (
            <li key={cue}>• {cue}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stepper label="Répétitions" value={reps} step={1} min={1} onChange={setReps} />
        <Stepper
          label="Charge (kg)"
          value={loadKg ?? 0}
          step={2.5}
          min={0}
          onChange={(value) => setLoadKg(value)}
          disabled={prescribedLoad === null && bandLevel !== null}
        />
        <Stepper label="RIR" value={rir} step={1} min={0} max={5} onChange={setRir} />
      </div>

      <button
        type="button"
        className="btn-primary mt-4 w-full text-base"
        disabled={isPending}
        onClick={submit}
      >
        {isPending ? 'Enregistrement…' : `Valider la série ${setsDone + 1}`}
      </button>

      <p className="mt-2 text-center text-xs text-ink-400">
        {remaining === 0
          ? 'Toutes les séries sont faites — passez à l’exercice suivant.'
          : `${remaining} série${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`}
      </p>

      {restLeft !== null && restLeft > 0 && (
        <div className="mt-3 rounded-xl border border-brand-600/40 bg-brand-600/10 py-3 text-center">
          <p className="text-2xl font-semibold tabular-nums text-brand-400">
            {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, '0')}
          </p>
          <p className="text-xs text-ink-400">Repos conseillé</p>
          <button
            type="button"
            className="mt-1 text-xs text-ink-400 underline"
            onClick={() => setRestLeft(null)}
          >
            Passer
          </button>
        </div>
      )}
    </Card>
  );
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min, next));

  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <p className="mb-1 text-center text-xs text-ink-400">{label}</p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          className="h-11 flex-1 rounded-lg border border-ink-700 text-lg"
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </button>
        <span className="w-12 text-center text-lg font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          disabled={disabled}
          className="h-11 flex-1 rounded-lg border border-ink-700 text-lg"
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Fin de séance                                 */
/* -------------------------------------------------------------------------- */

function FinishPanel({
  isPending,
  error,
  onFinish,
}: {
  isPending: boolean;
  error: unknown;
  onFinish: (sessionRpe: number) => void;
}) {
  const [rpe, setRpe] = useState(7);

  return (
    <Card title="Terminer la séance">
      <label className="block">
        <span className="mb-1 flex justify-between text-sm">
          <span className="text-ink-300">Difficulté ressentie (RPE)</span>
          <span className="text-ink-100">{rpe}/10</span>
        </span>
        <input
          type="range"
          min={1}
          max={10}
          value={rpe}
          onChange={(event) => setRpe(Number(event.target.value))}
          className="w-full accent-brand-500"
        />
      </label>

      <p className="mt-1 mb-3 text-xs text-ink-400">
        Ce ressenti alimente le calcul de fatigue générale et la détection du besoin de décharge.
      </p>

      {error ? <ErrorMessage error={error} /> : null}

      <button
        type="button"
        className="btn-primary w-full"
        disabled={isPending}
        onClick={() => onFinish(rpe)}
      >
        {isPending ? 'Enregistrement…' : 'Terminer et enregistrer'}
      </button>
    </Card>
  );
}

function WorkoutSummary({
  summary,
  onClose,
}: {
  summary: FinishWorkoutResponse;
  onClose: () => void;
}) {
  return (
    <Card title="Séance enregistrée">
      <p className="text-sm text-ink-300">{summary.message}</p>

      {summary.newRecords.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-fresh">
            Nouveaux records
          </h3>
          <ul className="space-y-1 text-sm text-ink-300">
            {summary.newRecords.map((record, index) => (
              <li key={`${record.exerciseId}-${record.type}-${index}`}>
                • {record.exerciseName} — {record.value}
                {record.type === 'max_load' ? ' kg' : record.type === 'max_reps' ? ' reps' : ' s'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.progressionUpdates.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-300">Prochaine fois</h3>
          <ul className="space-y-1 text-sm text-ink-400">
            {summary.progressionUpdates.map((update) => (
              <li key={update.exerciseId}>
                • <span className="text-ink-300">{update.exerciseName}</span> : {update.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <Notice tone="info">
          Les groupes musculaires travaillés sont maintenant en récupération. Consultez l’écran
          Récup pour savoir quand ils redeviendront disponibles.
        </Notice>
      </div>

      <button type="button" className="btn-primary mt-4 w-full" onClick={onClose}>
        Retour à l’accueil
      </button>
    </Card>
  );
}
