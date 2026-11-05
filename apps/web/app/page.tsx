import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isHosted, publicUrl } from '@askmetry/core/hosted/config';
import { MarketingHome } from '@/components/marketing/home';
import { getI18n } from '@/lib/i18n/server';
import { getSession } from '@/lib/session';

// Gehostet: öffentliche Startseite (auch für Angemeldete, dann mit „Zu meinen Berichten“).
// Selbst gehostet: wie bisher Weiterleitung zu /w bzw. /login.

export async function generateMetadata(): Promise<Metadata> {
  if (!isHosted()) return {};
  const { t, locale } = await getI18n();
  const m = t.marketing.meta;
  const base = publicUrl();
  return {
    metadataBase: new URL(base),
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: '/' },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      url: '/',
      siteName: 'Askmetry',
      title: m.ogTitle,
      description: m.description,
      locale: locale === 'de' ? 'de_DE' : 'en_US',
      alternateLocale: locale === 'de' ? ['en_US'] : ['de_DE'],
    },
    twitter: { card: 'summary_large_image', title: m.ogTitle, description: m.description },
  };
}

export default async function Home() {
  const s = await getSession();
  if (!isHosted()) redirect(s ? '/w' : '/login');
  return <MarketingHome signedIn={!!s} />;
}
