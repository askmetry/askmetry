import type { ReactNode } from 'react';

export const box = 'rounded-2xl bg-card p-5 shadow-card sm:p-6';
export const MENU_DANGER = 'w-full rounded-lg px-3 py-2 text-left text-sm text-bad hover:bg-subtle';

/** Kopf einer Einstellungs-Seite: Titel, eine Zeile Erklärung, Hauptaktion rechts. */
export function SettingsHeader({ title, intro, action, ro }: { title: string; intro?: ReactNode; action?: ReactNode; ro?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {(intro || ro) && <p className="mt-1 text-sm text-muted">{ro ? 'Nur Leserechte – Änderungen sind nicht möglich.' : intro}</p>}
      </div>
      {action}
    </div>
  );
}

/** Gruppe in einer Einstellungs-Seite: kleine Überschrift über einer Karte. */
export function Group({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      {(title || aside) && (
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          {title && <h3 className="text-sm font-medium text-muted">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
