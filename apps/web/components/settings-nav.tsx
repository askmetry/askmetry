'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const SETTINGS_PAGES = [
  { id: 'marke', label: 'Marke' },
  { id: 'wettbewerber', label: 'Wettbewerber' },
  { id: 'fragen', label: 'Fragen' },
  { id: 'messung', label: 'Messung' },
  { id: 'kosten', label: 'Kosten' },
  { id: 'workspace', label: 'Workspace' },
] as const;

/** Seitenleiste der Einstellungen (mobil: Reiter-Zeile). Jede Seite ist eine eigene Adresse – kein Springen und Scrollen. */
export function SettingsNav({ slug }: { slug: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Einstellungen" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 border-b border-border lg:flex-col lg:border-0">
        {SETTINGS_PAGES.map((p) => {
          const href = `/w/${slug}/settings/${p.id}`;
          const active = path === href;
          return (
            <li key={p.id}>
              <Link href={href} aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap px-3 py-2 text-sm lg:rounded-lg ${active
                  ? 'border-b-2 border-accent font-medium text-fg lg:border-0 lg:bg-card lg:shadow-card'
                  : 'border-b-2 border-transparent text-muted hover:text-fg lg:border-0 lg:hover:bg-card/60'}`}>
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
