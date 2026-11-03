'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

export function WorkspaceNav({ slug }: { slug: string }) {
  const path = usePathname();
  const t = useT().common.nav;
  const base = `/w/${slug}`;
  const items = [
    { href: base, label: t.overview, exact: true },
    { href: `${base}/massnahmen`, label: t.recs },
    { href: `${base}/fragen`, label: t.questions },
  ];
  const settingsActive = path.startsWith(`${base}/settings`);
  return (
    <nav className="-mb-px flex items-center gap-1">
      {items.map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${active ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
            {it.label}
          </Link>
        );
      })}
      <Link href={`${base}/settings/marke`} aria-label={t.settings} title={t.settings} aria-current={settingsActive ? 'page' : undefined}
        className={`ml-auto border-b-2 px-2 py-2.5 ${settingsActive ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </Link>
    </nav>
  );
}
