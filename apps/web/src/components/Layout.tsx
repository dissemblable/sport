import { NavLink, Outlet } from 'react-router-dom';
import { useActiveWorkout } from '../api/queries';

/**
 * Coquille de l'application.
 *
 * Navigation par onglets en bas d'écran : l'usage réel est un téléphone tenu à
 * une main entre deux séries, où le haut de l'écran est hors de portée du
 * pouce. Un badge signale une séance en cours pour qu'on puisse la reprendre
 * sans la chercher.
 */

const TABS = [
  { to: '/', label: 'Accueil', icon: HomeIcon, end: true },
  { to: '/recuperation', label: 'Récup', icon: BodyIcon },
  { to: '/seance', label: 'Séance', icon: PlayIcon },
  { to: '/planning', label: 'Planning', icon: CalendarIcon },
  { to: '/statistiques', label: 'Stats', icon: ChartIcon },
] as const;

export function Layout() {
  const { data: workout } = useActiveWorkout();
  const hasActiveWorkout = Boolean(workout?.active);

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="flex items-center justify-between px-4 pt-5 pb-2">
        <div>
          <p className="text-xs tracking-widest text-ink-400 uppercase">Entraînement à domicile</p>
          <h1 className="text-xl font-semibold">Coach</h1>
        </div>
        <NavLink
          to="/reglages"
          className="rounded-xl border border-ink-800 p-2.5 text-ink-300 hover:bg-ink-800"
          aria-label="Réglages"
        >
          <GearIcon />
        </NavLink>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-28">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-ink-800 bg-ink-900/95 backdrop-blur">
        <ul className="mx-auto flex max-w-2xl">
          {TABS.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={'end' in tab ? tab.end : false}
                className={({ isActive }) =>
                  `relative flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                    isActive ? 'text-brand-400' : 'text-ink-400'
                  }`
                }
              >
                <tab.icon />
                {tab.label}
                {tab.to === '/seance' && hasActiveWorkout && (
                  <span className="absolute top-1.5 right-[calc(50%-18px)] h-2 w-2 rounded-full bg-brand-400" />
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*        Icônes en SVG inline : aucune dépendance, aucun chargement           */
/* -------------------------------------------------------------------------- */

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function BodyIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="4.5" r="2.2" />
      <path d="M12 6.7v8M6 9h12M9 22l3-7 3 7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5 16 12l-6 3.5z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </svg>
  );
}
