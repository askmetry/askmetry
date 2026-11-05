import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n/client';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  // Standard: nicht indexieren (App, Check, Kauf); Startseite und Rechtsseiten überschreiben das mit index: true
  return { title: { default: 'Askmetry', template: '%s · Askmetry' }, description: t.common.appDescription, robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale}>
      <body className="min-h-screen font-sans text-[15px]">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
