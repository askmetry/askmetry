import { and, asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, response, run } from '@opengeo/db';
import { AnswerMarkdown } from '@/components/answer-markdown';
import { ParamSelect } from '@/components/selects';
import { OpenOnHash } from '@/components/open-on-hash';
import { Badge, Back, Card, EmptyState } from '@/components/ui';
import { Dot } from '@/components/viz';
import { workspaceContext, type SP } from '@/lib/context';
import { domainMatches, engineLabel, groupBy, loadBase, normName, sortEngines, type Term } from '@/lib/metrics';
import { recTouchesPrompt, sortRecs } from '@/lib/recommendations';
import { loadRecs, promptContext } from '@/lib/recs-data';
import { buildClaudePrompt, isLikelyCompetitor } from '@opengeo/core/present';
import { RecCard } from '@/components/rec-card';
import { loadPrompt } from '@/lib/prompts';
import { COMMUNITY_LABELS, communityKind, comparableUrl } from '@/lib/sources';
import { safeUrl } from '@/lib/url';
import { fillLevel, joinDe, recForDomain, recTargets, shapingSources } from '@/lib/view';

export const metadata = { title: 'Frage' };

const SENTIMENT: Record<string, string> = { positive: 'positiv', neutral: 'neutral', negative: 'negativ' };


export default async function FrageDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: SP }) {
  const { slug, id } = await params;
  const ctx = await workspaceContext(slug, await searchParams);
  const { ws, brands, own, selected } = ctx;
  const p = await loadPrompt(ws.id, id);
  if (!p) notFound();

  const header = (
    <>
      <Back href={`/w/${slug}/fragen`} label="Alle Fragen" />
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">„{p.p.text}“</h1>
          <p className="mt-1 text-sm text-muted">{p.topicName ? `Thema: ${p.topicName}` : 'Ohne Thema'}{!p.p.active && ' · wird nicht mehr abgefragt'}</p>
        </div>
        {selected && ctx.collectionOptions.length > 1 && <ParamSelect param="c" label="Messung" value={selected.id} options={ctx.collectionOptions} />}
      </div>
    </>
  );
  if (!selected) return <>{header}<EmptyState title="Noch keine Messung">Starte die erste Messung in den Einstellungen.</EmptyState></>;

  const [runs, base] = await Promise.all([
    db.select({
      runId: run.id, engine: run.engine, repetition: run.repetition, status: run.status, error: run.error, model: run.model,
      responseId: response.id, answer: response.answer, answerType: response.answerType, noAiAnswer: response.noAiAnswer,
    }).from(run).leftJoin(response, eq(response.runId, run.id))
      .where(and(eq(run.workspaceId, ws.id), eq(run.collectionId, selected.id), eq(run.promptId, p.p.id)))
      .orderBy(asc(run.engine), asc(run.repetition)),
    loadBase(ws.id, [selected.id], { promptId: p.p.id }),
  ]);
  if (!runs.length) return <>{header}<EmptyState title="Diese Frage war in dieser Messung nicht enthalten">Wähle oben eine andere Messung.</EmptyState></>;

  const mentionsBy = groupBy(base.ments, (m) => m.responseId);
  const citesBy = groupBy(base.cits, (c) => c.responseId);
  const readBy = groupBy(base.read, (c) => c.responseId);
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const baseTerms: Term[] = brands.flatMap((b) => [b.name, ...b.aliases].map((t) => ({ term: t, kind: b.isOwn ? 'own' as const : 'competitor' as const })));
  const byEngine = groupBy(runs, (r) => r.engine);
  const engines = sortEngines(byEngine.keys());
  const ownName = own?.name ?? 'Deine Marke';
  const engineStats = engines.map((e) => {
    const rs = byEngine.get(e)!.filter((r) => r.answer);
    return { e, n: rs.length, hit: rs.filter((r) => (mentionsBy.get(r.responseId!) ?? []).some((m) => own && m.brandId === own.id)).length };
  });
  const answered = engineStats.filter((x) => x.n > 0);
  const missing = answered.filter((x) => x.hit === 0).length;
  const verdict = !answered.length ? 'Keine KI-Suche hat auf diese Frage geantwortet.'
    : missing === 0 ? `${ownName} wird in allen ${answered.length} KI-Suchen genannt.`
    : missing === answered.length ? `${ownName} fehlt in ${missing === 1 ? 'der einzigen KI-Suche' : `allen ${missing} KI-Suchen`}.`
    : `${ownName} fehlt in ${missing} von ${answered.length} KI-Suchen.`;
  // „Genannt wurden“: nur Wettbewerber (getrackt oder laut Analyse-Modell/Namensliste), gleiche Namen zusammengefasst
  const nameCount = new Map<string, { name: string; n: number }>();
  for (const m of base.ments) {
    const b = m.brandId ? brandById.get(m.brandId) : undefined;
    if (b?.isOwn) continue;
    const n = b?.name ?? m.name;
    if (!b && !isLikelyCompetitor(n, m.isCompetitor)) continue;
    const k = normName(n);
    const e = nameCount.get(k) ?? { name: n, n: 0 };
    if (/^\p{Lu}/u.test(n) && !/^\p{Lu}/u.test(e.name)) e.name = n;
    e.n++;
    nameCount.set(k, e);
  }
  const named = [...nameCount.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((x) => x.name);
  const shaping = shapingSources([...base.cits, ...base.read], 3, own?.domains ?? []);
  const recs = await loadRecs(ws.id);
  const targets = recTargets(recs);
  // „Was du tun kannst“: aktive Maßnahmen, deren Belege diese Frage betreffen
  const related = sortRecs(recs.filter((r) => r.active && (r.status === 'open' || r.status === 'in_progress') && recTouchesPrompt(r.key, r.evidence, p.p.id))).slice(0, 2);
  const pctx = promptContext(ws, brands);

  return (
    <>
      {header}
      <section className="mb-10 rounded-3xl bg-card p-6 shadow-card sm:p-7" data-testid="fazit">
        <h2 className="mb-3 text-sm font-medium text-muted">Fazit</h2>
        <p className="text-lg font-semibold leading-snug">{verdict}</p>
        {named.length > 0 && <p className="mt-2 text-sm">Genannt wurden {joinDe(named)}.</p>}
        {shaping.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            Geprägt von:{' '}
            {shaping.map((x, i) => {
              const rid = recForDomain(targets, x.label);
              return (
                <span key={x.label}>
                  {i > 0 && ', '}{x.label}
                  {rid && <> <Link href={`/w/${slug}/massnahmen/${rid}`} data-rec-link className="whitespace-nowrap font-medium text-accent hover:underline">→ Maßnahme</Link></>}
                </span>
              );
            })}
          </p>
        )}
      </section>

      {related.length > 0 && (
        <section className="mb-12" aria-labelledby="h-tun">
          <h2 id="h-tun" className="mb-4 text-lg font-semibold tracking-tight">Was du tun kannst</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {related.map((r) => <RecCard key={r.id} rec={r} slug={slug} prompt={buildClaudePrompt(r, pctx)} />)}
          </div>
        </section>
      )}

      <h2 className="mb-1 text-lg font-semibold tracking-tight">Die Antworten</h2>
      <p className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted">
        Markiert: <mark className="hl-own">du</mark><mark className="hl-competitor">Wettbewerber</mark><mark className="hl-untracked">weitere Marken</mark>
      </p>
      <OpenOnHash />
      <div className="space-y-6">
        {engines.map((e) => (
          <details key={e} id={e} className="group scroll-mt-6 rounded-2xl bg-card shadow-card">
            <summary className="flex cursor-pointer select-none items-center gap-3 px-5 py-4">
              <Dot fill={(() => { const x = engineStats.find((s) => s.e === e)!; return x.n ? fillLevel(x.hit / x.n) : null; })()} />
              <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
              <span className="font-semibold">{engineLabel(e)}</span>
              <span className="text-sm text-muted">{(() => { const x = engineStats.find((s) => s.e === e)!; return !x.n ? 'keine Antwort' : x.hit ? `${ownName} in ${x.hit} von ${x.n} Antworten genannt` : `${ownName} nicht genannt`; })()}</span>
              </span>
              <span aria-hidden className="ml-auto text-muted transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
              {byEngine.get(e)!.map((r) => {
                const ms = (r.responseId ? mentionsBy.get(r.responseId) : undefined) ?? [];
                const cs = (r.responseId ? citesBy.get(r.responseId) : undefined) ?? [];
                const citedUrls = new Set(cs.map((c) => comparableUrl(c.url)));
                const rd = ((r.responseId ? readBy.get(r.responseId) : undefined) ?? []).filter((c) => {
                  const k = comparableUrl(c.url);
                  if (citedUrls.has(k)) return false;
                  citedUrls.add(k); // doppelt gelesene Seiten nur einmal
                  return true;
                });
                const terms: Term[] = [...baseTerms, ...ms.map((m) => {
                  const b = m.brandId ? brandById.get(m.brandId) : undefined;
                  return { term: m.name, kind: b ? (b.isOwn ? 'own' as const : 'competitor' as const) : 'untracked' as const };
                })];
                const ownHit = own && ms.find((m) => m.brandId === own.id);
                return (
                  <Card key={r.runId} className="!shadow-none ring-1 ring-border" title={<span className="flex flex-wrap items-center gap-2">Antwort {r.repetition} {ownHit ? <Badge tone="own">{own!.name} auf Platz {ownHit.position}</Badge> : r.answer ? <span className="text-sm font-normal text-muted">{own?.name ?? 'Du'} nicht genannt</span> : null}</span>}
                    subtitle={r.model ? `Modell: ${r.model}` : undefined} pad>
                    {!r.answer ? (
                      <p className="text-sm text-muted">{r.noAiAnswer ? 'Keine KI-Antwort – die Suche hat für diese Anfrage keine KI-Antwort angezeigt.' : r.status === 'failed' ? `Abfrage fehlgeschlagen${r.error ? `: ${r.error}` : ''}.` : r.status === 'skipped' ? 'Übersprungen (Budget erreicht).' : 'Keine Antwort.'}</p>
                    ) : (
                      <>
                        <div className="max-h-[28rem] overflow-y-auto text-sm leading-relaxed">
                          <AnswerMarkdown text={r.answer} terms={terms} />
                        </div>
                        {ms.length > 0 && (
                          <div className="mt-4 border-t border-border pt-3">
                            <h3 className="mb-2 text-xs font-medium text-muted">Genannte Marken</h3>
                            <ol className="flex flex-wrap gap-1.5">
                              {[...ms].sort((a, b) => a.position - b.position).map((m) => {
                                const b = m.brandId ? brandById.get(m.brandId) : undefined;
                                return (
                                  <li key={m.name + m.position}>
                                    <Badge tone={b?.isOwn ? 'own' : b ? 'competitor' : 'neutral'} title={`${SENTIMENT[m.sentiment] ?? m.sentiment}${m.snippet ? ` – ${m.snippet}` : ''}`}>
                                      {m.position}. {b?.name ?? m.name}{m.recommended ? ' ★' : ''}
                                    </Badge>
                                  </li>
                                );
                              })}
                            </ol>
                            <p className="mt-1.5 text-xs text-muted">★ = empfohlen</p>
                          </div>
                        )}
                        <div className="mt-4 border-t border-border pt-3">
                          <h3 className="mb-2 text-xs font-medium text-muted">Quellen ({cs.length})</h3>
                          {cs.length === 0 ? <p className="text-xs text-muted">Keine Quellen angegeben.</p> : (
                            <ul className="space-y-1 text-xs">
                              {cs.map((c, i) => {
                                const isOwn = own ? domainMatches(c.domain || c.url, own.domains) : false;
                                const comp = !isOwn && brands.find((b) => !b.isOwn && domainMatches(c.domain || c.url, b.domains));
                                return (
                                  <li key={i} className="flex items-baseline gap-2">
                                    <span className="w-5 shrink-0 text-right text-muted tabular-nums">{c.position}</span>
                                    <a href={safeUrl(c.url) ?? undefined} target="_blank" rel="noreferrer noopener" className={`min-w-0 truncate hover:underline ${isOwn ? 'font-medium text-own' : ''}`} title={c.url}>
                                      {c.domain}<span className="text-muted">{safePath(c.url)}</span>
                                    </a>
                                    {isOwn && <Badge tone="own">eigene</Badge>}
                                    {comp && <Badge tone="competitor">{comp.name}</Badge>}
                                    {c.kind === 'searched' && <Badge tone="warn" title="Die KI hat die Seite geöffnet, nennt sie aber nicht als Quelle.">gelesen</Badge>}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {rd.length > 0 && (
                            <details className="group mt-3">
                              <summary className="cursor-pointer select-none text-xs text-muted hover:text-fg">
                                Gelesen, aber nicht als Quelle genannt ({rd.length}) <span className="text-muted group-open:hidden">– anzeigen</span>
                              </summary>
                              <p className="mt-1.5 text-xs text-muted">Diese Seiten hat die KI bei der Recherche gelesen; sie prägen die Antwort, erscheinen aber nicht als Quelle und zählen nicht in die Kennzahlen.</p>
                              <ul className="mt-1.5 space-y-1 text-xs">
                                {rd.map((c, i) => {
                                  const isOwn = own ? domainMatches(c.domain || c.url, own.domains) : false;
                                  const ck = communityKind(c.domain || c.url);
                                  return (
                                    <li key={i} className="flex items-baseline gap-2">
                                      <a href={safeUrl(c.url) ?? undefined} target="_blank" rel="noreferrer noopener" className={`min-w-0 truncate text-muted hover:underline ${isOwn ? 'font-medium text-own' : ''}`} title={c.url}>
                                        {c.domain}<span className="text-muted">{safePath(c.url)}</span>
                                      </a>
                                      {isOwn && <Badge tone="own">eigene</Badge>}
                                      {ck && <Badge tone="warn">{COMMUNITY_LABELS[ck]}</Badge>}
                                    </li>
                                  );
                                })}
                              </ul>
                            </details>
                          )}
                        </div>
                      </>
                    )}
                  </Card>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}

function safePath(u: string) {
  try {
    const x = new URL(u);
    return x.pathname === '/' ? '' : x.pathname;
  } catch {
    return '';
  }
}
