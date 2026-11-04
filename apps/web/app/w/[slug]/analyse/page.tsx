import Link from 'next/link';
import { AddCompetitorsButton } from '@/components/add-competitor';
import { ParamSelect } from '@/components/selects';
import { TrendChart } from '@/components/trend-chart';
import { Back, Badge, Bar, Card, Delta, EmptyState, Hint, PageHeader } from '@/components/ui';
import { workspaceContext, type SP } from '@/lib/context';
import { BrandMark } from '@/components/brand-mark';
import { logoMap } from '@/lib/logos';
import { getI18n, getT } from '@/lib/i18n/server';
import { brandMetrics, engineLabel, groupBy, loadBase, loadTrend, normName, sortEngines, untrackedBrands } from '@/lib/metrics';
import { claudeBatchWaiting, loadRecData, rankingFrom } from '@askmetry/core';

/** „Platz in der Antwort“ erst ab 5 Nennungen zeigen – darunter ist der Mittelwert nicht aussagekräftig. */
const MIN_POS = 5;
const place = (avg: number | null, mentioned: number) => (mentioned < MIN_POS ? null : avg);

export async function generateMetadata() {
  return { title: (await getT()).analysis.title };
}

export default async function AnalysePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const ctx = await workspaceContext(slug, await searchParams);
  const { ws, own, brands, selected, previous, all, canEdit } = ctx;
  const { locale, t: tt, f } = await getI18n();
  const t = tt.analysis;
  const fmtPct = f.pct;
  const fmtDate = f.date;
  const placeText = (avg: number | null, mentioned: number) => (mentioned < MIN_POS ? '–' : f.num(avg));
  const placeHint = (mentioned: number) => (mentioned === 0 ? t.notNamed : mentioned < MIN_POS ? t.tooFew(mentioned) : t.firstIsOne);
  const engineName = (e: string) => engineLabel(e, locale);
  const active = all.filter((c) => c.status === 'queued' || c.status === 'running');
  // geplante Messung wartet noch auf gebündelte Claude-Abfragen (Batch) → Wartezeit erklären
  const batchWaiting = active[0]?.status === 'running' ? await claudeBatchWaiting(ws.id) : 0;
  const batchNote = batchWaiting ? ` ${tt.common.batchWaiting(batchWaiting)}` : '';

  if (!own) {
    return (<><PageHeader title={t.title} /><EmptyState title={t.noBrand.title} action={{ href: `/w/${slug}/settings/marke`, label: t.noBrand.action }}>{t.noBrand.text}</EmptyState></>);
  }
  if (!selected) {
    return (
      <>
        <PageHeader title={t.title} />
        <EmptyState title={t.noMeasurement} action={{ href: `/w/${slug}/settings/messung`, label: t.toSettings }}>
          {active.length ? (active[0]!.status === 'running' ? t.runningNow + batchNote : t.queuedNow) : t.startFirst}
        </EmptyState>
      </>
    );
  }

  const [base, prevBase, trend, recData, logos] = await Promise.all([
    loadBase(ws.id, [selected.id]),
    previous ? loadBase(ws.id, [previous.id]) : null,
    loadTrend(ws.id, own),
    loadRecData(ws.id, selected.id),
    logoMap(slug, ctx.brands),
  ]);
  const m = brandMetrics(base.resps, base.ments, base.cits, own);
  const pm = prevBase ? brandMetrics(prevBase.resps, prevBase.ments, prevBase.cits, own) : null;
  const d = (a: number | null, b: number | null | undefined, scale = 100) => (a === null || b === null || b === undefined ? null : (a - b) * scale);

  const byEngine = groupBy(base.resps, (r) => r.engine);
  const engines = sortEngines(byEngine.keys());
  const engineRows = engines.map((e) => ({ e, em: brandMetrics(byEngine.get(e)!, base.ments, base.cits, own) }));
  // Rangliste aus Core (wie Übersicht/Lagebericht); Kennzahlen je Zeile lokal
  const ranking = rankingFrom(recData);
  const brandByName = new Map(brands.map((b) => [b.name, b]));
  const untrackedBy = new Map(untrackedBrands(base.resps, base.ments, brands.flatMap((b) => [b.name, ...b.aliases])).map((u) => [normName(u.name), u]));
  const trackedRows = ranking.rows.filter((r) => r.tracked);
  // weitere (ungetrackte) Wettbewerber: höchstens 6 – Plätze bleiben die der gemeinsamen Rangliste
  const extraRows = ranking.rows.filter((r) => !r.tracked).slice(0, 6);
  const shown = [...trackedRows, ...extraRows].sort((a, b) => a.place - b.place);
  const searchedOnlyShare = m.ownSite ? m.ownSiteSearchedOnly / m.ownSite : 0;

  return (
    <>
      <Back href={`/w/${slug}`} label={t.back} />
      <PageHeader title={t.heading} description={<>{t.allMetricsFor} <b className="font-medium text-fg">{own.name}</b>. {t.description(m.n, fmtDate(selected.finishedAt ?? selected.createdAt))}</>}>
        <ParamSelect param="c" label={t.measurement} value={selected.id} options={ctx.collectionOptions} />
      </PageHeader>

      {active.length > 0 && (
        <p className="mb-4 rounded-xl bg-accent-soft px-4 py-2.5 text-sm">
          {active[0]!.status === 'running' ? t.newRunning + batchNote : t.newQueued} <Link className="text-accent hover:underline" href={`/w/${slug}/settings/messung`}>{t.viewStatus}</Link>
        </p>
      )}

      {/* eine Hauptzahl, der Rest als eine ruhige Zeile */}
      <section aria-label={t.kpis} className="rounded-2xl bg-card p-5 shadow-card sm:p-6" data-testid="analyse-kpis">
        <p className="text-sm text-muted">{t.visibility}<Hint>{t.visibilityHint}</Hint></p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums">{fmtPct(m.visibility)}</span>
          <Delta value={d(m.visibility, pm?.visibility)} />
          <span className="text-sm text-muted">{t.namedIn(m.mentioned, m.n)}</span>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-4">
          {[
            { k: t.position, v: placeText(m.avgPosition, m.mentioned), sub: placeHint(m.mentioned), hint: t.positionHint, delta: <Delta value={d(place(m.avgPosition, m.mentioned), pm ? place(pm.avgPosition, pm.mentioned) : null, 1)} unit="" invert digits={1} /> },
            { k: t.recommended, v: fmtPct(m.recommendationRate), sub: t.inXofN(m.recommended, m.n), hint: t.recommendedHint, delta: <Delta value={d(m.recommendationRate, pm?.recommendationRate)} /> },
            { k: t.sov, v: fmtPct(m.shareOfVoice), sub: t.xOfN(m.mentions, m.allMentions), hint: t.sovHint, delta: <Delta value={d(m.shareOfVoice, pm?.shareOfVoice)} /> },
            { k: t.ownSite, v: fmtPct(m.ownSiteRate), sub: `${t.inXofN(m.ownSite, m.n)}${searchedOnlyShare > 0 ? t.readOnly(m.ownSiteSearchedOnly) : ''}`, hint: t.ownSiteHint, delta: <Delta value={d(m.ownSiteRate, pm?.ownSiteRate)} /> },
          ].map((x) => (
            <div key={x.k} className="min-w-0">
              <dt className="text-muted">{x.k}<Hint>{x.hint}</Hint></dt>
              <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2"><span className="text-lg font-semibold tabular-nums">{x.v}</span>{x.delta}<span className="text-xs text-muted">{x.sub}</span></dd>
            </div>
          ))}
        </dl>
        {pm && <p className="mt-3 text-xs text-muted">{t.deltaNote(fmtDate(previous!.finishedAt ?? previous!.createdAt, false))}</p>}
      </section>

      {m.ownSite > m.mentioned && m.ownSite > 0 && (
        <div className="mt-5 rounded-2xl bg-card px-5 py-4 text-sm shadow-card">
          <span className="font-medium">{t.insight}</span> {t.insightText(fmtPct(m.ownSiteRate), own.name, fmtPct(m.visibility))}{' '}
          <Link className="text-accent hover:underline" href={`/w/${slug}/quellen?c=${selected.id}#nicht-genannt`}>{t.viewAnswers}</Link>
        </div>
      )}

      <Card className="mt-12" title={t.byEngine} subtitle={t.byEngineSub} pad={false}>
        <div className="hidden md:block">
          <table className="data">
            <thead><tr>
              <th>{t.colEngine}</th><th className="num">{t.colAnswers}</th><th className="num">{t.visibility}</th><th className="num">{t.colPlace}</th>
              <th className="num">{t.recommended}</th><th className="num">{t.colSov}</th><th className="num">{t.colOwnSite}<Hint>{t.colOwnSiteHint}</Hint></th>
            </tr></thead>
            <tbody>
              {engineRows.map(({ e, em }) => (
                <tr key={e}>
                  <td className="whitespace-nowrap font-medium">{engineName(e)}</td>
                  <td className="num">{em.n}</td>
                  <td className="num">{fmtPct(em.visibility)}</td>
                  <td className="num">{placeText(em.avgPosition, em.mentioned)}</td>
                  <td className="num">{fmtPct(em.recommendationRate)}</td>
                  <td className="num">{fmtPct(em.shareOfVoice)}</td>
                  <td className="num" title={em.ownSiteSearchedOnly > 0 && em.ownSiteSearchedOnly === em.ownSite ? t.readOnlyTitle : undefined}>{fmtPct(em.ownSiteRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-border md:hidden">
          {engineRows.map(({ e, em }) => (
            <li key={e} className="px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{engineName(e)}</span>
                <span className="text-sm tabular-nums"><b className="font-semibold">{fmtPct(em.visibility)}</b> <span className="text-muted">{t.visible} · {t.answers(em.n)}</span></span>
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-muted">
                <div className="flex justify-between gap-2"><dt>{t.colPlace}</dt><dd className="tabular-nums text-fg">{placeText(em.avgPosition, em.mentioned)}</dd></div>
                <div className="flex justify-between gap-2"><dt>{t.recommended}</dt><dd className="tabular-nums text-fg">{fmtPct(em.recommendationRate)}</dd></div>
                <div className="flex justify-between gap-2"><dt>{t.mentions}</dt><dd className="tabular-nums text-fg">{fmtPct(em.shareOfVoice)}</dd></div>
                <div className="flex justify-between gap-2"><dt>{t.website}</dt><dd className="tabular-nums text-fg">{fmtPct(em.ownSiteRate)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      {trend.length > 1 && (
        <Card className="mt-12" title={t.trend} subtitle={t.trendSub(trend.length)}>
          <TrendChart data={trend.map((p) => ({ label: f.dayMonth(p.createdAt), visibility: p.visibility, shareOfVoice: p.shareOfVoice, ownSiteRate: p.ownSiteRate }))} />
        </Card>
      )}

      <Card className="mt-12" title={t.allBrands} subtitle={t.allBrandsSub} pad={false}>
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr>
              <th className="w-8 num">#</th><th>{t.colBrand}</th><th className="w-48">{t.visibility}</th><th className="num"></th><th className="num">{t.colPlace}</th>
              <th className="num">{t.recommended}</th><th className="num">{t.colSov}</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const b = r.tracked ? brandByName.get(r.name) : undefined;
                const u = r.tracked ? undefined : untrackedBy.get(normName(r.name));
                const bm = b ? brandMetrics(base.resps, base.ments, base.cits, b) : null;
                return (
                  <tr key={r.name} className={r.own ? 'bg-accent-soft/40' : ''}>
                    <td className="num text-muted">{r.place}</td>
                    <td className="font-medium"><span className="inline-flex items-center gap-2.5 align-middle"><BrandMark name={r.name} src={logos.get(r.name.toLowerCase())} own={r.own} />{r.name}</span> {r.own ? <Badge tone="own">{t.you}</Badge> : r.tracked ? null : <Badge title={t.otherBrandTitle}>{t.otherBrand}</Badge>}</td>
                    <td className="align-middle"><Bar value={r.rate} tone={r.own ? 'accent' : 'muted'} /></td>
                    <td className="num">{fmtPct(r.rate)}</td>
                    <td className="num">{bm ? placeText(bm.avgPosition, bm.mentioned) : u ? placeText(u.avgPosition, u.responses) : '–'}</td>
                    <td className="num">{bm ? fmtPct(bm.recommendationRate) : '–'}</td>
                    <td className="num">{bm ? fmtPct(bm.shareOfVoice) : u ? fmtPct(u.shareOfVoice) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {extraRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5 text-sm" data-testid="untracked-block">
            <p className="min-w-0"><span className="font-medium">{t.untracked}</span> <span className="text-muted">{extraRows.map((r) => r.name).join(', ')}</span></p>
            {canEdit && <AddCompetitorsButton slug={slug} names={extraRows.map((r) => r.name)} />}
          </div>
        )}
      </Card>
    </>
  );
}
