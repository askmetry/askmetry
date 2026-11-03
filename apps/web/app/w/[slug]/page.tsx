import Link from 'next/link';
import { eq, sql } from 'drizzle-orm';
import { db, prompt } from '@opengeo/db';
import { buildStatusBrief, keyInsight, loadRecData, pickTopRecommendations, rankingFrom } from '@opengeo/core';
import { CATEGORIES, categoryOf, categoryText, localizeRec, scoreVerdict, type RecCategory } from '@opengeo/core/present';
import { ActionForm } from '@/components/action-form';
import { BrandProfileBanner } from '@/components/brand-profile';
import { BrandMark } from '@/components/brand-mark';
import { CopyButton } from '@/components/copy-button';
import { RecCard, RecHero } from '@/components/rec-card';
import { EmptyState, Hint } from '@/components/ui';
import { CategoryIcon, Dot, ScoreRing } from '@/components/viz';
import { CAT_STYLE, toneColor } from '@/components/viz-style';
import { startCollection } from '@/lib/actions/settings';
import { workspaceContext } from '@/lib/context';
import { logoMap } from '@/lib/logos';
import { getI18n, getT } from '@/lib/i18n/server';
import { brandMetrics, engineLabel, groupBy, loadBase, sortEngines } from '@/lib/metrics';
import { loadRecs, promptContext, recPrompt } from '@/lib/recs-data';
import { fillLevel, toScore, topWithOwn } from '@/lib/view';

export async function generateMetadata() {
  return { title: (await getT()).overview.title };
}

const CAT_ORDER = (Object.keys(CATEGORIES) as RecCategory[]).sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order);

const Section = ({ title, hint, children, aside }: { title: string; hint?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) => (
  <section>
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}{hint}</h2>
      {aside}
    </div>
    {children}
  </section>
);

export default async function Uebersicht({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await workspaceContext(slug, {});
  const { locale, t: tt, f } = await getI18n();
  const t = tt.overview;
  const { ws, own, brands, selected, previous, all, canEdit } = ctx;
  const running = all.find((c) => c.status === 'queued' || c.status === 'running');

  if (!own) {
    return <EmptyState title={t.noBrand.title} action={{ href: `/w/${slug}/settings/marke`, label: t.noBrand.action }}>{t.noBrand.text}</EmptyState>;
  }
  if (!selected) {
    if (running) {
      return (
        <EmptyState title={t.firstRunning.title} action={{ href: `/w/${slug}/settings/messung`, label: t.firstRunning.action }}>
          {t.firstRunning.text}
        </EmptyState>
      );
    }
    // Neuer Workspace: drei Schritte bis zur ersten Messung, abgehakt nach echtem Stand
    const [pr] = await db.select({ n: sql<number>`count(*) filter (where ${prompt.active})::int` }).from(prompt).where(eq(prompt.workspaceId, ws.id));
    const steps = [
      { done: brands.some((b) => !b.isOwn), label: t.onboarding.competitors, text: t.onboarding.competitorsText, href: `/w/${slug}/settings/wettbewerber` },
      { done: (pr?.n ?? 0) > 0, label: t.onboarding.questions, text: t.onboarding.questionsText, href: `/w/${slug}/settings/fragen` },
      { done: false, label: t.onboarding.measure, text: t.onboarding.measureText, href: `/w/${slug}/settings/messung` },
    ];
    return (
      <div className="mx-auto max-w-xl space-y-6" data-testid="onboarding">
        <div className="flex items-center gap-4">
          <BrandMark name={own.name} src={(await logoMap(slug, [own])).get(own.name.toLowerCase())} size={40} own />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{own.name}</h1>
            <p className="text-sm text-muted">{canEdit ? t.onboarding.stepsLeft(steps.filter((x) => !x.done).length) : t.onboarding.viewer}</p>
          </div>
        </div>
        <BrandProfileBanner slug={slug} own={own} canEdit={canEdit} />
        {canEdit && <ol className="divide-y divide-border rounded-2xl bg-card shadow-card">
          {steps.map((st, i) => (
            <li key={st.label}>
              <Link href={st.href} className="flex items-center gap-4 px-5 py-4 hover:bg-subtle/60">
                <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${st.done ? 'bg-good text-white' : 'bg-subtle text-muted'}`}>{st.done ? '✓' : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium ${st.done ? 'text-muted line-through decoration-1' : ''}`}>{st.label}</span>
                  <span className="block text-sm text-muted">{st.text}</span>
                </span>
                <span aria-hidden className="text-accent">→</span>
              </Link>
            </li>
          ))}
        </ol>}
      </div>
    );
  }

  const [base, prevBase, recs, insight, brief, recData, logos] = await Promise.all([
    loadBase(ws.id, [selected.id]),
    previous ? loadBase(ws.id, [previous.id]) : null,
    loadRecs(ws.id),
    keyInsight(ws.id, locale).catch(() => null),
    buildStatusBrief(ws.id, new Date(), locale).catch(() => ''),
    loadRecData(ws.id, selected.id),
    logoMap(slug, brands),
  ]);
  const m = brandMetrics(base.resps, base.ments, base.cits, own);
  const pm = prevBase ? brandMetrics(prevBase.resps, prevBase.ments, prevBase.cits, own) : null;
  const score = toScore(m.visibility);
  const verdict = scoreVerdict(score, locale);
  const delta = pm && pm.visibility !== null ? score - toScore(pm.visibility) : null;

  // Rangliste aus Core (gleiche Logik wie Analyse und Lagebericht): getrackte Marken + wahrscheinliche Wettbewerber
  const ranking = topWithOwn(rankingFrom(recData).rows, 5);
  const leader = ranking.rows.find((r) => !r.own && r.responses > 0);
  const maxResp = Math.max(1, ...ranking.rows.map((r) => r.responses));
  const placement = leader && leader.responses > m.mentioned
    ? t.placementBehind(m.mentioned, m.n, leader.name, leader.responses)
    : leader ? t.placementAhead(m.mentioned, m.n, leader.name, leader.responses) : t.placementAlone(m.mentioned, m.n);

  const byEngine = groupBy(base.resps, (r) => r.engine);
  const engines = sortEngines(byEngine.keys()).map((e) => ({ e, rate: brandMetrics(byEngine.get(e)!, base.ments, base.cits, own).visibility }));

  const current = recs.filter((r) => r.active && (r.status === 'open' || r.status === 'in_progress'));
  const top = pickTopRecommendations(current, 3).map((r) => localizeRec(r, locale));
  const pctx = promptContext(ws, brands, locale);
  const catCount = new Map<RecCategory, number>();
  for (const r of current) catCount.set(categoryOf(r.type), (catCount.get(categoryOf(r.type)) ?? 0) + 1);

  return (
    <div className="space-y-12">
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-4">
          <BrandMark name={own.name} src={logos.get(own.name.toLowerCase())} size={40} own />
          <div>
          <h1 className="text-2xl font-semibold tracking-tight">{own.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{t.measuredOn(f.date(selected.finishedAt ?? selected.createdAt, false))}</span>
            {running ? <span>{t.newRunning}</span> : canEdit && (
              <>
                <span aria-hidden>·</span>
                <ActionForm action={startCollection} slug={slug} submit={t.measureAgain} inline className="contents"
                  submitClass="text-sm text-accent hover:underline disabled:opacity-50" />
              </>
            )}
          </div>
          </div>
        </div>
        {brief && <CopyButton text={brief} label={t.copyBrief} className="btn" testId="copy-brief" />}
      </div>

      <BrandProfileBanner slug={slug} own={own} canEdit={canEdit} />

      {/* Hero */}
      <section aria-label={t.visibility} className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:gap-10 sm:text-left">
          <ScoreRing score={score} tone={verdict.tone} />
          <div className="min-w-0">
            <p className="text-sm text-muted">{t.visibility}<Hint>{t.visibilityHint}</Hint></p>
            <p className="mt-1 inline-flex items-center gap-2.5 text-[2rem] font-semibold leading-tight tracking-tight">
              <span aria-hidden className="inline-block size-3 rounded-full" style={{ background: toneColor(verdict.tone) }} />{verdict.label}
            </p>
            <p className="mt-2 text-lg">{placement}</p>
            <p className="mt-2 text-sm text-muted">
              {delta === null ? t.firstMeasurement
                : delta === 0 ? t.unchangedSince(f.date(previous!.finishedAt ?? previous!.createdAt, false))
                : <span className={delta > 0 ? 'text-good' : 'text-bad'}>{delta > 0 ? '▲' : '▼'} {t.deltaSince(Math.abs(delta), f.date(previous!.finishedAt ?? previous!.createdAt, false))}</span>}
            </p>
          </div>
        </div>
        {insight && insight.kind !== 'none' && (
          <p className="mt-6 rounded-2xl bg-accent-soft px-4 py-3 text-sm sm:px-5" data-testid="insight">
            <b className="font-semibold">{t.keyInsight}</b> {insight.text}
          </p>
        )}
      </section>

      {/* KI-Suchen */}
      <Section title={t.engines} hint={<Hint>{t.enginesHint}</Hint>}>
        <ul className="flex flex-wrap gap-2.5">
          {engines.map(({ e, rate }) => (
            <li key={e} className="flex items-center gap-2 rounded-full bg-card px-3.5 py-2 text-sm shadow-card">
              <Dot fill={fillLevel(rate)} />
              <span>{engineLabel(e, locale)}</span>
              <span className="tabular-nums text-muted">{f.pct(rate)}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Ranking */}
      <Section title={t.ranking} aside={<Link href={`/w/${slug}/analyse`} className="text-sm text-accent hover:underline">{t.allBrands}</Link>}>
        <ol className="space-y-2.5 rounded-2xl bg-card p-5 shadow-card sm:p-6">
          {ranking.rows.map((r, i) => (
            <li key={r.name} className={`grid grid-cols-[1.5rem_minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[2rem_14rem_1fr_4rem] ${ranking.ownExtra && i === ranking.rows.length - 1 ? 'mt-3 border-t border-border pt-3' : ''}`}>
              <span className="tabular-nums text-muted">{r.place}.</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <BrandMark name={r.name} src={logos.get(r.name.toLowerCase())} own={r.own} />
                <span className={`truncate ${r.own ? 'font-semibold' : ''}`}>{r.own ? t.you(r.name) : r.name}</span>
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${Math.max(r.responses ? 2 : 0, (r.responses / maxResp) * 100)}%`, background: r.own ? 'var(--accent)' : 'var(--faint)' }} />
              </span>
              <span className="text-right tabular-nums text-muted" title={t.namedInTitle(r.responses, m.n)}>{r.responses}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">{t.rankingNote(m.n)}</p>
      </Section>

      {/* Maßnahmen */}
      <Section title={t.recs} aside={current.length > 0 ? <Link href={`/w/${slug}/massnahmen`} className="text-sm text-accent hover:underline">{t.allRecs(current.length)}</Link> : undefined}>
        {top.length === 0 ? (
          <p className="rounded-2xl bg-card px-5 py-8 text-center text-sm text-muted shadow-card">{t.noRecs}</p>
        ) : (
          <>
            <RecHero rec={top[0]!} slug={slug} prompt={recPrompt(top[0]!, pctx, locale)} />
            {top.length > 1 && (
              <>
                <h3 className="mb-3 mt-6 text-sm font-medium text-muted">{t.then}</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {top.slice(1).map((r) => <RecCard key={r.id} rec={r} slug={slug} prompt={recPrompt(r, pctx, locale)} />)}
                </div>
              </>
            )}
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>{t.byKind}</span>
              {CAT_ORDER.filter((c) => catCount.get(c)).map((c) => (
                <Link key={c} href={`/w/${slug}/massnahmen#${c}`} className={`inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5 shadow-card hover:underline ${CAT_STYLE[c].text}`}>
                  <CategoryIcon cat={c} size={14} />{categoryText(c, locale).label} <span className="tabular-nums">{catCount.get(c)}</span>
                </Link>
              ))}
            </p>
          </>
        )}
      </Section>

      {/* Tiefer einsteigen */}
      <Section title={t.deeper}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { href: `/w/${slug}/analyse`, title: t.deeperAnalysis, text: t.deeperAnalysisText },
            { href: `/w/${slug}/quellen`, title: t.deeperSources, text: t.deeperSourcesText },
            { href: `/w/${slug}/fragen?ohne=1`, title: t.deeperGaps, text: t.deeperGapsText },
          ].map((x) => (
            <Link key={x.href} href={x.href} className="shadow-card shadow-card-hover rounded-2xl bg-card px-5 py-4 transition-shadow">
              <span className="block font-medium">{x.title} <span className="text-accent">→</span></span>
              <span className="mt-0.5 block text-sm text-muted">{x.text}</span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
