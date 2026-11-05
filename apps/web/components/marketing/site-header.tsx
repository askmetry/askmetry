import Link from 'next/link';
import { Logo } from '@/components/auth/auth-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { getT } from '@/lib/i18n/server';

/** Kopfzeile der öffentlichen Seiten. `anchors`: Sprunglinks auf der Startseite (sonst Links auf „/#…“). */
export async function SiteHeader({ signedIn, onHome = false }: { signedIn: boolean; onHome?: boolean }) {
  const t = (await getT()).marketing.nav;
  const base = onHome ? '' : '/';
  const links = [
    { href: `${base}#so-gehts`, label: t.how },
    { href: `${base}#preise`, label: t.pricing },
    { href: `${base}#faq`, label: t.faq },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <a href="#inhalt" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:shadow-card">{t.skip}</a>
      <div className="mx-auto flex h-15 max-w-[1120px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label={t.home} className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-accent"><Logo small /></Link>
        <nav aria-label={t.label} className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">{l.label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher />
          {signedIn
            ? <Link href="/w" className="btn btn-primary">{t.myReports}</Link>
            : <Link href="/login" className="btn">{t.signIn}</Link>}
        </div>
      </div>
    </header>
  );
}
