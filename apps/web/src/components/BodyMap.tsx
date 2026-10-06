import { FATIGUE_STATUS_COLORS, type MuscleCode } from '@sport/shared';
import type { MuscleRecoveryDto } from '../api/client';

/**
 * Silhouette musculaire.
 *
 * L'écran central de l'application : d'un coup d'œil, l'utilisateur voit ce
 * qui a récupéré et ce qui ne l'a pas. Chaque groupe est colorié selon son
 * statut, avec la même palette que le reste de l'interface.
 *
 * Le dessin est volontairement schématique — des ellipses positionnées sur une
 * silhouette stylisée. Une planche anatomique détaillée serait plus jolie mais
 * moins lisible sur un écran de téléphone posé au sol, et beaucoup plus lourde.
 */

interface MuscleShape {
  muscle: MuscleCode;
  view: 'front' | 'back';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate?: number;
}

const SHAPES: MuscleShape[] = [
  /* ------------------------------ Vue de face ----------------------------- */
  { muscle: 'front_delts', view: 'front', cx: 33, cy: 42, rx: 8, ry: 7 },
  { muscle: 'front_delts', view: 'front', cx: 87, cy: 42, rx: 8, ry: 7 },
  { muscle: 'side_delts', view: 'front', cx: 26, cy: 48, rx: 6, ry: 6 },
  { muscle: 'side_delts', view: 'front', cx: 94, cy: 48, rx: 6, ry: 6 },
  { muscle: 'chest', view: 'front', cx: 49, cy: 50, rx: 12, ry: 9 },
  { muscle: 'chest', view: 'front', cx: 71, cy: 50, rx: 12, ry: 9 },
  { muscle: 'biceps', view: 'front', cx: 25, cy: 66, rx: 6, ry: 12 },
  { muscle: 'biceps', view: 'front', cx: 95, cy: 66, rx: 6, ry: 12 },
  { muscle: 'forearms', view: 'front', cx: 21, cy: 90, rx: 5.5, ry: 13 },
  { muscle: 'forearms', view: 'front', cx: 99, cy: 90, rx: 5.5, ry: 13 },
  { muscle: 'abs', view: 'front', cx: 60, cy: 76, rx: 9, ry: 18 },
  { muscle: 'obliques', view: 'front', cx: 45, cy: 76, rx: 5, ry: 14 },
  { muscle: 'obliques', view: 'front', cx: 75, cy: 76, rx: 5, ry: 14 },
  { muscle: 'adductors', view: 'front', cx: 54, cy: 112, rx: 4.5, ry: 15 },
  { muscle: 'adductors', view: 'front', cx: 66, cy: 112, rx: 4.5, ry: 15 },
  { muscle: 'quads', view: 'front', cx: 47, cy: 124, rx: 10, ry: 26 },
  { muscle: 'quads', view: 'front', cx: 73, cy: 124, rx: 10, ry: 26 },
  { muscle: 'calves', view: 'front', cx: 49, cy: 174, rx: 7.5, ry: 18 },
  { muscle: 'calves', view: 'front', cx: 71, cy: 174, rx: 7.5, ry: 18 },

  /* ------------------------------ Vue de dos ------------------------------ */
  { muscle: 'rear_delts', view: 'back', cx: 33, cy: 42, rx: 8, ry: 7 },
  { muscle: 'rear_delts', view: 'back', cx: 87, cy: 42, rx: 8, ry: 7 },
  { muscle: 'upper_back', view: 'back', cx: 60, cy: 44, rx: 20, ry: 10 },
  { muscle: 'lats', view: 'back', cx: 46, cy: 66, rx: 12, ry: 17 },
  { muscle: 'lats', view: 'back', cx: 74, cy: 66, rx: 12, ry: 17 },
  { muscle: 'triceps', view: 'back', cx: 25, cy: 66, rx: 6, ry: 12 },
  { muscle: 'triceps', view: 'back', cx: 95, cy: 66, rx: 6, ry: 12 },
  { muscle: 'forearms', view: 'back', cx: 21, cy: 90, rx: 5.5, ry: 13 },
  { muscle: 'forearms', view: 'back', cx: 99, cy: 90, rx: 5.5, ry: 13 },
  { muscle: 'lower_back', view: 'back', cx: 60, cy: 86, rx: 10, ry: 11 },
  { muscle: 'glutes', view: 'back', cx: 50, cy: 106, rx: 11, ry: 11 },
  { muscle: 'glutes', view: 'back', cx: 70, cy: 106, rx: 11, ry: 11 },
  { muscle: 'hamstrings', view: 'back', cx: 48, cy: 137, rx: 10, ry: 23 },
  { muscle: 'hamstrings', view: 'back', cx: 72, cy: 137, rx: 10, ry: 23 },
  { muscle: 'calves', view: 'back', cx: 49, cy: 174, rx: 8, ry: 19 },
  { muscle: 'calves', view: 'back', cx: 71, cy: 174, rx: 8, ry: 19 },
];

/** Contour du corps, dessiné en arrière-plan pour donner du contexte. */
function Silhouette() {
  return (
    <g fill="var(--color-ink-800)" stroke="var(--color-ink-700)" strokeWidth="0.8">
      <circle cx="60" cy="18" r="11" />
      <rect x="55" y="28" width="10" height="6" rx="2" />
      {/* Buste */}
      <path d="M38 36 Q60 30 82 36 L86 76 Q60 84 34 76 Z" />
      {/* Bassin */}
      <path d="M40 76 L80 76 L76 100 Q60 106 44 100 Z" />
      {/* Bras */}
      <path d="M34 38 L22 44 L16 104 L26 106 L32 62 Z" />
      <path d="M86 38 L98 44 L104 104 L94 106 L88 62 Z" />
      {/* Jambes */}
      <path d="M44 98 L56 98 L58 152 L54 196 L42 196 L40 152 Z" />
      <path d="M64 98 L76 98 L80 152 L78 196 L66 196 L62 152 Z" />
    </g>
  );
}

export interface BodyMapProps {
  muscles: MuscleRecoveryDto[];
  selected?: MuscleCode | null;
  onSelect?: (muscle: MuscleCode) => void;
}

export function BodyMap({ muscles, selected, onSelect }: BodyMapProps) {
  const byCode = new Map(muscles.map((m) => [m.muscle, m]));

  const renderView = (view: 'front' | 'back') => (
    <svg viewBox="0 0 120 205" className="h-auto w-full" role="img" aria-label={`Vue ${view === 'front' ? 'de face' : 'de dos'}`}>
      <Silhouette />
      {SHAPES.filter((shape) => shape.view === view).map((shape, index) => {
        const state = byCode.get(shape.muscle);
        const color = state ? FATIGUE_STATUS_COLORS[state.status] : 'var(--color-ink-700)';
        const isSelected = selected === shape.muscle;

        return (
          <ellipse
            key={`${shape.muscle}-${view}-${index}`}
            cx={shape.cx}
            cy={shape.cy}
            rx={shape.rx}
            ry={shape.ry}
            fill={color}
            // Un muscle disponible reste discret ; un muscle bloqué ressort.
            fillOpacity={state?.isAvailable ? 0.55 : 0.9}
            stroke={isSelected ? '#ffffff' : 'var(--color-ink-950)'}
            strokeWidth={isSelected ? 2 : 0.8}
            className="cursor-pointer transition-opacity hover:fill-opacity-100"
            onClick={() => onSelect?.(shape.muscle)}
          >
            <title>
              {state ? `${state.label} — ${state.statusLabel}` : shape.muscle}
            </title>
          </ellipse>
        );
      })}
    </svg>
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      <figure className="m-0">
        {renderView('front')}
        <figcaption className="mt-1 text-center text-xs text-ink-400">Face</figcaption>
      </figure>
      <figure className="m-0">
        {renderView('back')}
        <figcaption className="mt-1 text-center text-xs text-ink-400">Dos</figcaption>
      </figure>
    </div>
  );
}

/** Légende des statuts, affichée sous la silhouette. */
export function BodyMapLegend() {
  const entries: { status: keyof typeof FATIGUE_STATUS_COLORS; label: string }[] = [
    { status: 'fresh', label: 'Frais' },
    { status: 'ready', label: 'Prêt' },
    { status: 'recovering', label: 'Récupération' },
    { status: 'fatigued', label: 'Fatigué' },
    { status: 'overreached', label: 'Surmené' },
  ];

  return (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-ink-400">
      {entries.map((entry) => (
        <li key={entry.status} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: FATIGUE_STATUS_COLORS[entry.status] }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
