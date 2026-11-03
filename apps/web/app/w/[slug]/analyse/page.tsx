import Link from 'next/link';
import { AddCompetitorsButton } from '@/components/add-competitor';
import { ParamSelect } from '@/components/selects';
import { TrendChart } from '@/components/trend-chart';
import { Back, Badge, Bar, Card, Delta, EmptyState, Hint, PageHeader } from '@/components/ui';
import { workspaceContext, type SP } from '@/lib/context';
import { BrandMark } from '@/components/brand-mark';
import { logoMap } from '@/lib/logos';
import { fmtDate, fmtNum, fmtPct } from '@/lib/format';
import { brandMetrics, engineLabel, groupBy, loadBase, loadTrend, normName, sortEngines, untrackedBrands } from '@/lib/metrics';
import { loadRecData, rankingFrom } from '@opengeo/core';

/** „Platz in der Antwort“ erst ab 5 Nennungen zeigen – darunter ist der Mittelwert nicht aussagekräftig. */
const MIN_POS = 5;
const place = (avg: number | null, mentioned: number) => (mentioned < MIN_POS ? null : avg);
const placeText = (avg: number | null, mentioned: number) => (mentioned < MIN_POS ? '–' : fmtNum(avg));
const placeHint = (mentioned: number) => (mentioned === 0 ? 'nicht genannt' : mentioned < MIN_POS ? `zu wenig Daten (${mentioned} ${mentioned === 1 ? 'Nennung' : 'Nennungen'})` : '1 = zuerst genannt');

export const metadata = { title: 'Analyse' };

export default async function AnalysePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const ctx = await workspaceContext(slug, await searchParams);
  const { ws, own, brands, selected, previous, all, canEdit } = ctx;
  const active = all.filter((c) => c.status === 'queued' || c.status === 'running');

  if (!own) {
    return (<><PageHeader title="Analyse" /><EmptyState title="Noch keine eigene Marke angelegt" action={{ href: `/w/${slug}/settings/marke`, label: 'Zu den Einstellungen' }}>Lege in den Einstellungen deine Marke mit Domains an, damit wir sie in den KI-Antworten finden.</EmptyState></>);
  }
  if (!selected) {
    return (
      <>
        <PageHeader title="Analyse" />
        <EmptyState title="Noch keine Messung" action={{ href: `/w/${slug}/settings/messung`, label: 'Zu den Einstellungen' }}>
          {active.length ? `${active[0]!.status === 'running' ? 'Eine Messung läuft gerade' : 'Eine Messung wartet in der Warteschlange'} – die Ergebnisse erscheinen hier, sobald sie abgeschlossen ist.` : 'Starte die erste Messung in den Einstellungen („Jetzt messen“).'}
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
      <Back href={`/w/${slug}`} label="Übersicht" />
      <PageHeader title="Ergebnisse je KI-Suche" description={<>Alle Kennzahlen für <b className="font-medium text-fg">{own.name}</b>. Basis: {m.n} Antworten aus der Messung vom {fmtDate(selected.finishedAt ?? selected.createdAt)}.</>}>
        <ParamSelect param="c" label="Messung" value={selected.id} options={ctx.collectionOptions} />
      </PageHeader>

      {active.length > 0 && (
        <p className="mb-4 rounded-xl bg-accent-soft px-4 py-2.5 text-sm">
          Eine neue Messung {active[0]!.status === "running" ? "läuft gerade" : "ist eingeplant"}. <Link className="text-accent hover:underline" href={`/w/${slug}/settings/messung`}>Status ansehen</Link>
        </p>
      )}

      {/* eine Hauptzahl, der Rest als eine ruhige Zeile */}
      <section aria-label="Kennzahlen" className="rounded-2xl bg-card p-5 shadow-card sm:p-6" data-testid="analyse-kpis">
        <p className="text-sm text-muted">KI-Sichtbarkeit<Hint>Anteil der Antworten, in denen KI-Suchen dich nennen.</Hint></p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums">{fmtPct(m.visibility)}</span>
          <Delta value={d(m.visibility, pm?.visibility)} />
          <span className="text-sm text-muted">in {m.mentioned} von {m.n} Antworten genannt</span>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-4">
          {[
            { k: 'Platz in der Antwort', v: placeText(m.avgPosition, m.mentioned), sub: placeHint(m.mentioned), hint: 'An welcher Stelle du im Schnitt genannt wirst (1 = zuerst). Erst ab 5 Nennungen aussagekräftig.', delta: <Delta value={d(place(m.avgPosition, m.mentioned), pm ? place(pm.avgPosition, pm.mentioned) : null, 1)} unit="" invert digits={1} /> },
            { k: 'Empfohlen', v: fmtPct(m.recommendationRate), sub: `in ${m.recommended} von ${m.n}`, hint: 'Anteil der Antworten, in denen die KI dich ausdrücklich empfiehlt.', delta: <Delta value={d(m.recommendationRate, pm?.recommendationRate)} /> },
            { k: 'Anteil an allen Nennungen', v: fmtPct(m.shareOfVoice), sub: `${m.mentions} von ${m.allMentions}`, hint: 'Deine Nennungen geteilt durch die Nennungen aller Marken.', delta: <Delta value={d(m.shareOfVoice, pm?.shareOfVoice)} /> },
            { k: 'Eigene Seite als Quelle', v: fmtPct(m.ownSiteRate), sub: `in ${m.ownSite} von ${m.n}${searchedOnlyShare > 0 ? `, ${m.ownSiteSearchedOnly} nur gelesen` : ''}`, hint: 'Anteil der Antworten, die eine Seite deiner Website als Quelle nutzen.', delta: <Delta value={d(m.ownSiteRate, pm?.ownSiteRate)} /> },
          ].map((x) => (
            <div key={x.k} className="min-w-0">
              <dt className="text-muted">{x.k}<Hint>{x.hint}</Hint></dt>
              <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2"><span className="text-lg font-semibold tabular-nums">{x.v}</span>{x.delta}<span className="text-xs text-muted">{x.sub}</span></dd>
            </div>
          ))}
        </dl>
        {pm && <p className="mt-3 text-xs text-muted">Veränderungen in Prozentpunkten gegenüber der Messung vom {fmtDate(previous!.finishedAt ?? previous!.createdAt, false)}.</p>}
      </section>

      {m.ownSite > m.mentioned && m.ownSite > 0 && (
        <div className="mt-5 rounded-2xl bg-card px-5 py-4 text-sm shadow-card">
          <span className="font-medium">Erkenntnis:</span> Die KIs nutzen deine Seite in {fmtPct(m.ownSiteRate)} der Antworten als Quelle, nennen {own.name} aber nur in {fmtPct(m.visibility)}.{' '}
          <Link className="text-accent hover:underline" href={`/w/${slug}/quellen?c=${selected.id}#nicht-genannt`}>Antworten ansehen →</Link>
        </div>
      )}

      <Card className="mt-12" title="Nach KI-Suche" subtitle="Deine Kennzahlen je KI-Suche – „–“ heißt: zu wenig Daten" pad={false}>
        <div className="hidden md:block">
          <table className="data">
            <thead><tr>
              <th>KI-Suche</th><th className="num">Antworten</th><th className="num">KI-Sichtbarkeit</th><th className="num">Platz</th>
              <th className="num">Empfohlen</th><th className="num">Anteil Nennungen</th><th className="num">Eigene Website<Hint>Anteil der Antworten mit deiner Website als Quelle. Bei KI-Suchen ohne Quellenangaben im Text (z. B. Claude) zählen die gelesenen Seiten.</Hint></th>
            </tr></thead>
            <tbody>
              {engineRows.map(({ e, em }) => (
                <tr key={e}>
                  <td className="whitespace-nowrap font-medium">{engineLabel(e)}</td>
                  <td className="num">{em.n}</td>
                  <td className="num">{fmtPct(em.visibility)}</td>
                  <td className="num">{placeText(em.avgPosition, em.mentioned)}</td>
                  <td className="num">{fmtPct(em.recommendationRate)}</td>
                  <td className="num">{fmtPct(em.shareOfVoice)}</td>
                  <td className="num" title={em.ownSiteSearchedOnly > 0 && em.ownSiteSearchedOnly === em.ownSite ? 'nur gelesene Seiten – diese KI-Suche nennt keine Quellen im Text' : undefined}>{fmtPct(em.ownSiteRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-border md:hidden">
          {engineRows.map(({ e, em }) => (
            <li key={e} className="px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{engineLabel(e)}</span>
                <span className="text-sm tabular-nums"><b className="font-semibold">{fmtPct(em.visibility)}</b> <span className="text-muted">sichtbar · {em.n} Antworten</span></span>
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-muted">
                <div className="flex justify-between gap-2"><dt>Platz</dt><dd className="tabular-nums text-fg">{placeText(em.avgPosition, em.mentioned)}</dd></div>
                <div className="flex justify-between gap-2"><dt>Empfohlen</dt><dd className="tabular-nums text-fg">{fmtPct(em.recommendationRate)}</dd></div>
                <div className="flex justify-between gap-2"><dt>Nennungen</dt><dd className="tabular-nums text-fg">{fmtPct(em.shareOfVoice)}</dd></div>
                <div className="flex justify-between gap-2"><dt>Website</dt><dd className="tabular-nums text-fg">{fmtPct(em.ownSiteRate)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      {trend.length > 1 && (
        <Card className="mt-12" title="Verlauf" subtitle={`${trend.length} Messungen`}>
          <TrendChart data={trend.map((t) => ({ label: fmtDate(t.createdAt, false).slice(0, 6), visibility: t.visibility, shareOfVoice: t.shareOfVoice, ownSiteRate: t.ownSiteRate }))} />
        </Card>
      )}

      <Card className="mt-12" title="Alle Marken im Vergleich" subtitle="Du, deine Wettbewerber und weitere Marken, die die KIs häufig nennen" pad={false}>
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr>
              <th className="w-8 num">#</th><th>Marke</th><th className="w-48">KI-Sichtbarkeit</th><th className="num"></th><th className="num">Platz</th>
              <th className="num">Empfohlen</th><th className="num">Anteil Nennungen</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const b = r.tracked ? brandByName.get(r.name) : undefined;
                const u = r.tracked ? undefined : untrackedBy.get(normName(r.name));
                const bm = b ? brandMetrics(base.resps, base.ments, base.cits, b) : null;
                return (
                  <tr key={r.name} className={r.own ? 'bg-accent-soft/40' : ''}>
                    <td className="num text-muted">{r.place}</td>
                    <td className="font-medium"><span className="inline-flex items-center gap-2.5 align-middle"><BrandMark name={r.name} src={logos.get(r.name.toLowerCase())} own={r.own} />{r.name}</span> {r.own ? <Badge tone="own">du</Badge> : r.tracked ? null : <Badge title="Diese Marke wird genannt, du vergleichst dich aber noch nicht mit ihr">weitere Marke</Badge>}</td>
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
            <p className="min-w-0"><span className="font-medium">Oft genannt, aber nicht verglichen:</span> <span className="text-muted">{extraRows.map((r) => r.name).join(', ')}</span></p>
            {canEdit && <AddCompetitorsButton slug={slug} names={extraRows.map((r) => r.name)} />}
          </div>
        )}
      </Card>
    </>
  );
}
