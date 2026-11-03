import Link from 'next/link';
import type { ReactNode } from 'react';
import { getI18n } from '@/lib/i18n/server';

// Server-Komponenten (Texte über getI18n). Nicht aus Client-Komponenten importieren.

export function Card({ title, subtitle, actions, children, className = '', pad = true }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`rounded-2xl bg-card shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export async function Delta({ value, unit, invert = false, digits = 0 }: { value: number | null; unit?: string; invert?: boolean; digits?: number }) {
  if (value === null || Number.isNaN(value)) return null;
  const { t, f } = await getI18n();
  unit ??= t.overview.ui.pp;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return <span className="text-xs text-muted">± 0</span>;
  const good = invert ? rounded < 0 : rounded > 0;
  const txt = `${rounded > 0 ? '+' : '−'}${f.num(Math.abs(rounded), digits)}${unit ? ' ' + unit : ''}`;
  return <span className={`text-xs font-medium ${good ? 'text-good' : 'text-bad'}`} title={t.overview.ui.deltaTitle}>{rounded > 0 ? '▲' : '▼'} {txt}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-card">
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-xl text-sm text-muted">{children}</div>}
      {action && <Link href={action.href} className="btn btn-primary mt-5">{action.label}</Link>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'own' | 'competitor' | 'warn' | 'good' | 'bad' | 'accent'; title?: string }) {
  const cls = {
    neutral: 'bg-subtle text-muted',
    own: 'bg-own-soft text-own',
    competitor: 'bg-subtle text-fg',
    warn: 'bg-comp-soft text-warn',
    good: 'bg-subtle text-good',
    bad: 'bg-subtle text-bad',
    accent: 'bg-accent-soft text-accent',
  }[tone];
  return <span title={title} className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium leading-4 ${cls}`}>{children}</span>;
}

export function Bar({ value, tone = 'accent' }: { value: number | null; tone?: 'accent' | 'comp' | 'muted' }) {
  const color = tone === 'accent' ? 'var(--accent)' : tone === 'comp' ? 'var(--comp)' : 'var(--faint)';
  return (
    <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-subtle" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`, background: color }} />
    </div>
  );
}

/** Fachbegriff mit Ein-Satz-Erklärung („?“-Tooltip, per Hover und Tastatur). */
export async function Hint({ children, label }: { children: ReactNode; label?: string }) {
  label ??= (await getI18n()).t.overview.ui.hint;
  return (
    <span className="tip align-middle">
      <span tabIndex={0} role="button" aria-label={label}
        className="ml-1 inline-flex size-4 cursor-help items-center justify-center rounded-full bg-subtle text-[0.6875rem] font-semibold leading-none text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent">?</span>
      <span role="tooltip" className="tip-body">{children}</span>
    </span>
  );
}

/** Zurück-Link für Seiten unterhalb der Hauptnavigation. */
export function Back({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="mb-3 inline-block text-sm text-muted hover:text-fg">← {label}</Link>;
}

/** Zeilenmenü „⋯“ (z. B. für Löschen) – native <details>, ohne JS. */
export async function RowMenu({ label, children }: { label?: string; children: ReactNode }) {
  label ??= (await getI18n()).t.overview.ui.moreActions;
  return (
    <details className="relative" data-row-menu>
      <summary aria-label={label} title={label}
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg text-lg leading-none text-muted hover:bg-subtle hover:text-fg [&::-webkit-details-marker]:hidden">⋯</summary>
      <div className="absolute right-0 z-20 mt-1 min-w-40 rounded-xl bg-card p-1.5 shadow-card">{children}</div>
    </details>
  );
}
