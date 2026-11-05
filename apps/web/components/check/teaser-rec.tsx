import type { TeaserRecommendation } from '@askmetry/core/hosted/types';
import { CategoryTag, ImpactBadge } from '@/components/viz';
import { CAT_STYLE } from '@/components/viz-style';
import { getI18n } from '@/lib/i18n/server';
import { AREA_CATEGORY } from '@/lib/hosted/teaser';
import { plainTerms } from '@/lib/text';

/** Frei gezeigte Maßnahme im Teaser: wie die Maßnahmen-Karte, aber vollständig (Warum + Schritte), ohne Link in den Workspace. Zeigt nur die Wirkung, keinen Aufwand. */
export async function TeaserRecCard({ rec }: { rec: TeaserRecommendation }) {
  const { t, locale } = await getI18n();
  const cat = AREA_CATEGORY[rec.area] ?? 'content';
  return (
    <article data-rec={rec.id} className="shadow-card relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card py-5 pl-6 pr-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: CAT_STYLE[cat].fg }} />
      <CategoryTag cat={cat} owner />
      <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{plainTerms(rec.title, locale)}</h3>
      <ImpactBadge impact={rec.impact} className="mt-1.5" />
      <p className="mt-3 text-[15px] [overflow-wrap:anywhere]">{plainTerms(rec.why, locale)}</p>
      {rec.steps.length > 0 && (
        <>
          <h4 className="mt-4 text-sm font-medium text-muted">{t.check.teaser.steps}</h4>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-[15px] marker:text-muted">
            {rec.steps.map((s, i) => <li key={i} className="[overflow-wrap:anywhere]">{plainTerms(s, locale)}</li>)}
          </ol>
        </>
      )}
    </article>
  );
}
