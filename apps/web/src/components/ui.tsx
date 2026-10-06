import { FATIGUE_STATUS_COLORS, type FatigueStatus } from '@sport/shared';
import type { ReactNode } from 'react';

/** Petits composants partagés — volontairement sans dépendance externe. */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold tracking-wide text-ink-300 uppercase">{title}</h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatusPill({ status, label }: { status: FatigueStatus; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${FATIGUE_STATUS_COLORS[status]} 20%, transparent)`,
        color: FATIGUE_STATUS_COLORS[status],
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: FATIGUE_STATUS_COLORS[status] }}
      />
      {label}
    </span>
  );
}

/**
 * Jauge horizontale.
 *
 * `danger` inverse la lecture : pour la fatigue, un remplissage élevé est
 * mauvais, alors que pour le volume atteint il est bon.
 */
export function Gauge({
  value,
  max = 1,
  label,
  hint,
  danger = false,
}: {
  value: number;
  max?: number;
  label?: string;
  hint?: string;
  danger?: boolean;
}) {
  const ratio = Math.min(1, Math.max(0, value / max));
  const percent = Math.round(ratio * 100);

  const color = danger
    ? ratio > 0.75
      ? 'var(--color-overreached)'
      : ratio > 0.5
        ? 'var(--color-fatigued)'
        : 'var(--color-fresh)'
    : ratio >= 0.9
      ? 'var(--color-fresh)'
      : ratio >= 0.5
        ? 'var(--color-ready)'
        : 'var(--color-recovering)';

  return (
    <div>
      {(label || hint) && (
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-ink-300">{label}</span>
          <span className="text-ink-400">{hint ?? `${percent} %`}</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-base font-medium text-ink-100">{title}</p>
      <p className="max-w-sm text-sm text-ink-400">{description}</p>
      {action}
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-ink-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-700 border-t-brand-400" />
      {label}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
  return (
    <div className="card border-red-900/60 bg-red-950/40 text-sm text-red-200">{message}</div>
  );
}

/** Encart d'avertissement — utilisé pour les alertes de récupération. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-brand-600/40 bg-brand-600/10 text-brand-400',
    warning: 'border-amber-600/40 bg-amber-600/10 text-amber-300',
    danger: 'border-red-600/40 bg-red-600/10 text-red-300',
  } as const;

  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>
  );
}

/** Format « dans 19 h » / « dans 2 j 3 h ». */
export function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return 'moins d’une heure';
  if (hours < 24) return `${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest === 0 ? `${days} j` : `${days} j ${rest} h`;
}

const WEEKDAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function weekdayLabel(index: number, short = false): string {
  return (short ? WEEKDAY_SHORT : WEEKDAY_LABELS)[index] ?? '';
}

/** Date ISO `AAAA-MM-JJ` → « lundi 6 janvier ». */
export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatShortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  });
}

/** Date du jour au format ISO, en UTC — cohérent avec l'API. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
