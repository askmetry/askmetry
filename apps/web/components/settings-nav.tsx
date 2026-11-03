'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

/** Unterseiten (Bezeichnungen: t.settings.pages[id]) */
export const SETTINGS_PAGES = ['marke', 'wettbewerber', 'fragen', 'messung', 'kosten', 'workspace'] as const;

/** Seitenleiste der Einstellungen (mobil: Reiter-Zeile). Jede Seite ist eine eigene Adresse – kein Springen und Scrollen. */
export function SettingsNav({ slug }: { slug: string }) {
  const path = usePathname();
  const t = useT().settings;
  return (
    <nav aria-label={t.title} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 border-b border-border lg:flex-col lg:border-0">
        {SETTINGS_PAGES.map((id) => {
          const href = `/w/${slug}/settings/${id}`;
          const active = path === href;
          return (
            <li key={id}>
              <Link href={href} aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap px-3 py-2 text-sm lg:rounded-lg ${active
                  ? 'border-b-2 border-accent font-medium text-fg lg:border-0 lg:bg-card lg:shadow-card'
                  : 'border-b-2 border-transparent text-muted hover:text-fg lg:border-0 lg:hover:bg-card/60'}`}>
                {t.pages[id]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
