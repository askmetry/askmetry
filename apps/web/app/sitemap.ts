import type { MetadataRoute } from 'next';
import { isHosted, publicUrl } from '@askmetry/core/hosted/config';
import { LEGAL_DOCS } from '@/components/marketing/legal-markdown';
import { isLegalDraft } from '@/components/marketing/legal-page';

export const dynamic = 'force-dynamic';

/** Öffentliche Seiten der gehosteten Version (Sprache per Cookie/Accept-Language, keine Sprach-URLs). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isHosted()) return [];
  const base = publicUrl();
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    // Entwürfe erst nach Freigabe (Kommentar entfernt) in die Sitemap
    ...(await Promise.all(LEGAL_DOCS.map(async (d) => (await isLegalDraft(d)) ? null : d)))
      .filter((d) => d !== null)
      .map((d) => ({ url: `${base}/${d}`, changeFrequency: 'monthly' as const, priority: 0.3 })),
  ];
}
