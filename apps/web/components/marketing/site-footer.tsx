import Link from 'next/link';
import { Logo } from '@/components/auth/auth-form';
import { getT } from '@/lib/i18n/server';

export const GITHUB_URL = 'https://github.com/askmetry/askmetry';

/** Fußzeile der öffentlichen Seiten (Startseite, Rechtsseiten, Check- und Kaufseiten). Server-Komponente. */
export async function SiteFooter() {
  const all = await getT();
  const t = all.marketing.footer;
  const links = [
    { href: '/leitfaden', label: all.guide.footerLink },
    { href: '/impressum', label: t.imprint },
    { href: '/datenschutz', label: t.privacy },
    { href: '/agb', label: t.terms },
    { href: '/avv', label: t.dpa },
    { href: '/unterauftragnehmer', label: t.subprocessors },
  ];
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Link href="/" className="inline-block rounded-md focus-visible:outline-2 focus-visible:outline-accent"><Logo small /></Link>
          <p className="mt-2 text-sm text-muted">{t.claim}</p>
        </div>
        <nav aria-label={t.legalLabel}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {links.map((l) => <li key={l.href}><Link href={l.href} className="text-muted hover:text-fg hover:underline">{l.label}</Link></li>)}
            <li>
              <a href={GITHUB_URL} rel="noopener" target="_blank" className="inline-flex items-center gap-1.5 text-muted hover:text-fg hover:underline">
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>
                {t.github}
              </a>
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted md:text-right">{t.copyright(new Date().getFullYear())}</p>
        </nav>
      </div>
    </footer>
  );
}
