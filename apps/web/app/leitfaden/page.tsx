import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { geoGuide } from '@askmetry/core/guide';
import { isHosted, publicUrl } from '@askmetry/core/hosted/config';
import { GeoGuide, guideJsonLd } from '@/components/geo-guide';
import { PublicShell } from '@/components/public-shell';
import { getI18n } from '@/lib/i18n/server';

// Öffentlicher Kurzleitfaden GEO (nur gehostete Version, indexierbar). Gleicher Inhalt wie im Workspace und im PDF.

export async function generateMetadata(): Promise<Metadata> {
  if (!isHosted()) return {};
  const { t, locale } = await getI18n();
  return {
    metadataBase: new URL(publicUrl()),
    title: { absolute: t.guide.publicMetaTitle },
    description: t.guide.publicDescription,
    alternates: { canonical: '/leitfaden' },
    robots: { index: true, follow: true },
    openGraph: { type: 'article', url: '/leitfaden', siteName: 'Askmetry', title: t.guide.publicMetaTitle, description: t.guide.publicDescription, locale: locale === 'de' ? 'de_DE' : 'en_US' },
  };
}

export default async function PublicGuidePage() {
  if (!isHosted()) notFound();
  const { locale, t } = await getI18n();
  const guide = geoGuide(locale);
  // JSON-LD: nur eigene, statische Texte; „<“ escapen, damit kein </script> entstehen kann
  const ld = JSON.stringify(guideJsonLd(guide)).replace(/</g, '\\u003c');
  return (
    <PublicShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="mb-8 max-w-3xl">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2.125rem]">{guide.title}</h1>
        <p className="mt-3 text-lg text-muted">{guide.intro}</p>
        <p className="mt-2 text-[13px] text-muted">{t.guide.updated(guide.updated)}</p>
      </header>
      <GeoGuide guide={guide} t={t.guide} />
      <aside className="mt-14 max-w-3xl rounded-3xl bg-card p-6 text-center shadow-card sm:p-8">
        <h2 className="text-[17px] font-semibold">{t.guide.cta.title}</h2>
        <p className="mt-1 text-[15px] text-muted">{t.guide.cta.text}</p>
        <Link href="/#start" className="btn btn-primary mt-5">{t.guide.cta.button}</Link>
      </aside>
    </PublicShell>
  );
}
