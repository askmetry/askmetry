import { geoGuide } from '@askmetry/core/guide';
import { GeoGuide } from '@/components/geo-guide';
import { PageHeader } from '@/components/ui';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: (await getI18n()).t.guide.metaTitle };
}

/** Kurzleitfaden GEO im Workspace (Zugriff prüft das Layout). Gleicher Inhalt wie der PDF-Anhang und /leitfaden. */
export default async function LeitfadenPage() {
  const { locale, t } = await getI18n();
  const guide = geoGuide(locale);
  return (
    <>
      <PageHeader title={guide.title} description={<>{guide.intro} <span className="whitespace-nowrap">{t.guide.updated(guide.updated)}</span></>} />
      <GeoGuide guide={guide} t={t.guide} />
    </>
  );
}
