import {
  DEFAULT_MIN_REST_HOURS,
  EQUIPMENT_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  MAX_SESSION_DURATION_MINUTES,
  MIN_SESSION_DURATION_MINUTES,
  TRAINING_GOAL_LABELS,
  type EquipmentCode,
  type MuscleCode,
} from '@sport/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useProfile,
  useUpdateEquipment,
  useUpdateMuscleSettings,
  useUpdateProfile,
} from '../api/queries';
import { Card, ErrorMessage, Loading, Notice, weekdayLabel } from '../components/ui';

/**
 * Réglages.
 *
 * Trois blocs qui pilotent directement le moteur : le matériel déclaré
 * détermine les exercices prescriptibles, les priorités musculaires la
 * répartition du volume, et les exclusions écartent un groupe blessé.
 */
export function Settings() {
  const profile = useProfile();

  if (profile.isLoading) return <Loading />;
  if (profile.error) return <ErrorMessage error={profile.error} />;
  if (!profile.data) return null;

  return (
    <>
      <ProfileSection profile={profile.data} />
      <EquipmentSection profile={profile.data} />
      <MuscleSection profile={profile.data} />

      <Card title="Bibliothèque">
        <Link to="/exercices" className="btn-ghost w-full">
          Parcourir les {80} exercices du catalogue
        </Link>
      </Card>
    </>
  );
}

type Profile = NonNullable<ReturnType<typeof useProfile>['data']>;

/* -------------------------------------------------------------------------- */

function ProfileSection({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const [duration, setDuration] = useState(profile.sessionDurationMinutes);
  const [level, setLevel] = useState(profile.experienceLevel);
  const [goal, setGoal] = useState(profile.primaryGoal);
  const [weekdays, setWeekdays] = useState<number[]>(profile.preferredWeekdays);
  const [bodyWeight, setBodyWeight] = useState(profile.bodyWeightKg ?? 75);

  const toggleDay = (day: number) =>
    setWeekdays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );

  return (
    <Card title="Profil">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 flex justify-between text-sm">
            <span className="text-ink-300">Durée de séance</span>
            <span>{duration} min</span>
          </span>
          <input
            type="range"
            min={MIN_SESSION_DURATION_MINUTES}
            max={MAX_SESSION_DURATION_MINUTES}
            step={5}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className="w-full accent-brand-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 flex justify-between text-sm">
            <span className="text-ink-300">Poids de corps</span>
            <span>{bodyWeight} kg</span>
          </span>
          <input
            type="range"
            min={40}
            max={140}
            step={0.5}
            value={bodyWeight}
            onChange={(event) => setBodyWeight(Number(event.target.value))}
            className="w-full accent-brand-500"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-ink-300">Niveau</span>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as typeof level)}
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5"
          >
            {Object.entries(EXPERIENCE_LEVEL_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-400">
            Détermine le volume hebdomadaire cible et la difficulté maximale des exercices
            proposés.
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-ink-300">Objectif</span>
          <select
            value={goal}
            onChange={(event) => setGoal(event.target.value as typeof goal)}
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5"
          >
            {Object.entries(TRAINING_GOAL_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <p className="mb-2 text-sm text-ink-300">Jours souhaités</p>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`flex-1 rounded-lg border py-2 text-xs ${
                  weekdays.includes(day)
                    ? 'border-brand-500 bg-brand-500/15 text-brand-400'
                    : 'border-ink-700 text-ink-400'
                }`}
              >
                {weekdayLabel(day, true)}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-400">
            Le planificateur s’y tient dans la mesure du possible, mais privilégie toujours le
            respect des {DEFAULT_MIN_REST_HOURS} h de repos par muscle.
          </p>
        </div>

        <div>
          <p className="mb-1 text-sm text-ink-300">Fréquence hebdomadaire</p>
          <p className="text-sm">
            {profile.sessionsPerWeek} séances —{' '}
            <Link to="/planning" className="text-brand-400 underline">
              modifier depuis le planning
            </Link>
          </p>
          <p className="mt-1 text-xs text-ink-400">
            Le changement de fréquence recalcule le découpage et redistribue le volume : il passe
            par le planning pour que vous puissiez en voir l’impact avant de valider.
          </p>
        </div>

        {update.error && <ErrorMessage error={update.error} />}
        {update.isSuccess && <Notice tone="info">Profil enregistré.</Notice>}

        <button
          type="button"
          className="btn-primary w-full"
          disabled={update.isPending || weekdays.length === 0}
          onClick={() =>
            update.mutate({
              sessionDurationMinutes: duration,
              experienceLevel: level,
              primaryGoal: goal,
              preferredWeekdays: weekdays,
              bodyWeightKg: bodyWeight,
            })
          }
        >
          {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Matériel possédé.
 *
 * Les charges disponibles sont saisies explicitement : le moteur ne prescrit
 * jamais un poids que l'utilisateur ne possède pas, et la progression avance
 * par paliers réels.
 */
function EquipmentSection({ profile }: { profile: Profile }) {
  const update = useUpdateEquipment();
  const [owned, setOwned] = useState<EquipmentCode[]>(profile.equipment.owned);
  const [weights, setWeights] = useState(
    (profile.equipment.dumbbells?.availableWeightsKg ?? [5, 10, 15]).join(', '),
  );
  const [bands, setBands] = useState(
    (profile.equipment.bands?.levels ?? []).map((level) => level.name).join(', '),
  );
  const [canAddWeight, setCanAddWeight] = useState(profile.equipment.pullUpBarCanAddWeight);

  const toggle = (code: EquipmentCode) => {
    if (code === 'bodyweight') return; // toujours disponible
    setOwned((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );
  };

  const save = () => {
    const parsedWeights = weights
      .split(',')
      .map((value) => Number(value.trim().replace(',', '.')))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);

    const parsedBands = bands
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name, index) => ({ name, approxKg: (index + 1) * 8 }));

    const items = owned.map((code) => {
      if (code === 'dumbbells') {
        return {
          equipment: code,
          details: {
            availableWeightsKg: parsedWeights.length > 0 ? parsedWeights : [5, 10],
            pairCount: 2,
            incrementKg: 2.5,
          },
        };
      }
      if (code === 'resistance_bands') {
        return {
          equipment: code,
          details: {
            levels: parsedBands.length > 0 ? parsedBands : [{ name: 'Standard', approxKg: 10 }],
          },
        };
      }
      if (code === 'pull_up_bar') return { equipment: code, details: { canAddWeight } };
      return { equipment: code, details: {} };
    });

    update.mutate(items);
  };

  return (
    <Card title="Matériel">
      <p className="mb-3 text-xs text-ink-400">
        Le générateur ne propose que des exercices réalisables avec ce que vous déclarez ici.
      </p>

      <div className="space-y-2">
        {(Object.keys(EQUIPMENT_LABELS) as EquipmentCode[]).map((code) => (
          <label
            key={code}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
              owned.includes(code) ? 'border-brand-500/60 bg-brand-500/10' : 'border-ink-700'
            } ${code === 'bodyweight' ? 'opacity-70' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={owned.includes(code)}
              disabled={code === 'bodyweight'}
              onChange={() => toggle(code)}
              className="accent-brand-500"
            />
            {EQUIPMENT_LABELS[code]}
            {code === 'bodyweight' && (
              <span className="ml-auto text-xs text-ink-400">toujours disponible</span>
            )}
          </label>
        ))}
      </div>

      {owned.includes('dumbbells') && (
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-ink-300">Charges disponibles (kg, par haltère)</span>
          <input
            value={weights}
            onChange={(event) => setWeights(event.target.value)}
            placeholder="5, 7.5, 10, 12.5, 15"
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm"
          />
          <span className="mt-1 block text-xs text-ink-400">
            Séparez par des virgules. La progression avancera d’un palier à l’autre.
          </span>
        </label>
      )}

      {owned.includes('resistance_bands') && (
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-ink-300">
            Élastiques, du plus léger au plus résistant
          </span>
          <input
            value={bands}
            onChange={(event) => setBands(event.target.value)}
            placeholder="Jaune, Rouge, Noir"
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm"
          />
        </label>
      )}

      {owned.includes('pull_up_bar') && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={canAddWeight}
            onChange={(event) => setCanAddWeight(event.target.checked)}
            className="accent-brand-500"
          />
          Je peux me lester (tractions lestées)
        </label>
      )}

      {update.error && <ErrorMessage error={update.error} />}
      {update.isSuccess && <Notice tone="info">Matériel enregistré.</Notice>}

      <button
        type="button"
        className="btn-primary mt-4 w-full"
        disabled={update.isPending}
        onClick={save}
      >
        {update.isPending ? 'Enregistrement…' : 'Enregistrer le matériel'}
      </button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Priorités et contre-indications par muscle.
 *
 * Exclure un muscle blessé écarte tous les exercices qui le sollicitent
 * directement — pas seulement ceux qui le ciblent en premier.
 */
function MuscleSection({ profile }: { profile: Profile }) {
  const update = useUpdateMuscleSettings();
  const [settings, setSettings] = useState(profile.muscleSettings);

  useEffect(() => setSettings(profile.muscleSettings), [profile.muscleSettings]);

  const patch = (muscle: MuscleCode, changes: Partial<(typeof settings)[number]>) =>
    setSettings((current) =>
      current.map((entry) => (entry.muscle === muscle ? { ...entry, ...changes } : entry)),
    );

  return (
    <Card title="Priorités musculaires">
      <p className="mb-3 text-xs text-ink-400">
        Une priorité supérieure à 1 augmente le volume alloué à ce groupe. Exclure un muscle le
        retire complètement de la programmation — utile en cas de douleur ou de blessure.
      </p>

      <ul className="divide-y divide-ink-800">
        {settings.map((setting) => (
          <li key={setting.muscle} className="flex items-center gap-3 py-2.5">
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                setting.isExcluded ? 'text-ink-600 line-through' : 'text-ink-300'
              }`}
            >
              {setting.label}
            </span>

            <select
              value={setting.priority}
              disabled={setting.isExcluded}
              onChange={(event) =>
                patch(setting.muscle, { priority: Number(event.target.value) })
              }
              className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-xs disabled:opacity-40"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                <option key={value} value={value}>
                  ×{value}
                </option>
              ))}
            </select>

            <label className="flex shrink-0 items-center gap-1 text-xs text-ink-400">
              <input
                type="checkbox"
                checked={setting.isExcluded}
                onChange={(event) =>
                  patch(setting.muscle, { isExcluded: event.target.checked })
                }
                className="accent-overreached"
              />
              Exclure
            </label>
          </li>
        ))}
      </ul>

      {update.error && <ErrorMessage error={update.error} />}
      {update.isSuccess && <Notice tone="info">Priorités enregistrées.</Notice>}

      <button
        type="button"
        className="btn-primary mt-4 w-full"
        disabled={update.isPending}
        onClick={() =>
          update.mutate(
            settings.map((setting) => ({
              muscle: setting.muscle,
              priority: setting.priority,
              minRestHoursOverride: setting.minRestHoursOverride,
              weeklySetsOverride: setting.weeklySetsOverride,
              isExcluded: setting.isExcluded,
            })),
          )
        }
      >
        {update.isPending ? 'Enregistrement…' : 'Enregistrer les priorités'}
      </button>
    </Card>
  );
}
