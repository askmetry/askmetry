import { geoGuide } from '@askmetry/core/guide';
import { isHosted } from '@askmetry/core/hosted/config';
import { GeoGuide } from '@/components/geo-guide';
import { PageHeader } from '@/components/ui';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: (await getI18n()).t.guide.metaTitle };
}

/** Kurzleitfaden GEO im Workspace (Zugriff prüft das Layout). Gleicher Inhalt wie der PDF-Anhang (und /leitfaden in der gehosteten Version). */
export default async function LeitfadenPage() {
  const { locale, t } = await getI18n();
  // Selbsthosting: neutrale Fassung ohne Aussagen über Schnell-Check, Berichte, Sperren und Erinnerung
  const guide = geoGuide(locale, { hosted: isHosted() });
  return (
    <>
      <PageHeader title={guide.title} description={<>{guide.intro} <span className="whitespace-nowrap">{t.guide.updated(guide.updated)}</span></>} />
      <GeoGuide guide={guide} t={t.guide} />
    </>
  );
}
