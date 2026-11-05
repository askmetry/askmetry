import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { getSession } from '@/lib/session';

/** Rahmen der öffentlichen Seiten der gehosteten Version (Check, Kauf, Abmelden): Kopfzeile, Inhalt, Fußzeile. */
export async function PublicShell({ children, width = 'max-w-[880px]' }: { children: ReactNode; width?: string }) {
  const s = await getSession();
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader signedIn={!!s} />
      <main id="inhalt" className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12 ${width}`}>{children}</main>
      <SiteFooter />
    </div>
  );
}
