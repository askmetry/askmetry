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
import { domainMatches, groupBy, loadBase, normName, sortEngines, type Term } from '@/lib/metrics';
import { recTouchesPrompt, sortRecs } from '@/lib/recommendations';
import { loadRecs, promptContext, recPrompt } from '@/lib/recs-data';
import { engineName, isLikelyCompetitor } from '@opengeo/core/present';
import { getI18n } from '@/lib/i18n/server';
import { RecCard } from '@/components/rec-card';
import { loadPrompt } from '@/lib/prompts';
import { communityKind, comparableUrl } from '@/lib/sources';
import { safeUrl } from '@/lib/url';
import { fillLevel, recForDomain, recTargets, shapingSources } from '@/lib/view';

export async function generateMetadata() {
  return { title: (await getI18n()).t.questions.detailTitle };
}


export default async function FrageDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: SP }) {
  const { slug, id } = await params;
  const ctx = await workspaceContext(slug, await searchParams);
  const { ws, brands, own, selected } = ctx;
  const p = await loadPrompt(ws.id, id);
  if (!p) notFound();
  const { locale, t: msg, f } = await getI18n();
  const t = msg.questions.detail;
  const SENTIMENT = t.sentiment;

  const header = (
    <>
      <Back href={`/w/${slug}/fragen`} label={t.back} />
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{msg.recs.quote(p.p.text)}</h1>
          <p className="mt-1 text-sm text-muted">{p.topicName ? t.topic(p.topicName) : t.noTopic}{!p.p.active && t.inactive}</p>
        </div>
        {selected && ctx.collectionOptions.length > 1 && <ParamSelect param="c" label={t.measurement} value={selected.id} options={ctx.collectionOptions} />}
      </div>
    </>
  );
  if (!selected) return <>{header}<EmptyState title={msg.questions.empty.noMeasurementTitle}>{t.noMeasurementText}</EmptyState></>;

  const [runs, base] = await Promise.all([
    db.select({
      runId: run.id, engine: run.engine, repetition: run.repetition, status: run.status, error: run.error, model: run.model,
      responseId: response.id, answer: response.answer, answerType: response.answerType, noAiAnswer: response.noAiAnswer,
    }).from(run).leftJoin(response, eq(response.runId, run.id))
      .where(and(eq(run.workspaceId, ws.id), eq(run.collectionId, selected.id), eq(run.promptId, p.p.id)))
      .orderBy(asc(run.engine), asc(run.repetition)),
    loadBase(ws.id, [selected.id], { promptId: p.p.id }),
  ]);
  if (!runs.length) return <>{header}<EmptyState title={t.notIncludedTitle}>{t.notIncludedText}</EmptyState></>;

  const mentionsBy = groupBy(base.ments, (m) => m.responseId);
  const citesBy = groupBy(base.cits, (c) => c.responseId);
  const readBy = groupBy(base.read, (c) => c.responseId);
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const baseTerms: Term[] = brands.flatMap((b) => [b.name, ...b.aliases].map((t) => ({ term: t, kind: b.isOwn ? 'own' as const : 'competitor' as const })));
  const byEngine = groupBy(runs, (r) => r.engine);
  const engines = sortEngines(byEngine.keys());
  const ownName = own?.name ?? t.yourBrand;
  const engineStats = engines.map((e) => {
    const rs = byEngine.get(e)!.filter((r) => r.answer);
    return { e, n: rs.length, hit: rs.filter((r) => (mentionsBy.get(r.responseId!) ?? []).some((m) => own && m.brandId === own.id)).length };
  });
  const answered = engineStats.filter((x) => x.n > 0);
  const missing = answered.filter((x) => x.hit === 0).length;
  const verdict = !answered.length ? t.verdictNone
    : missing === 0 ? t.verdictAll(ownName, answered.length)
    : missing === answered.length ? t.verdictMissingAll(ownName, missing)
    : t.verdictMissingSome(ownName, missing, answered.length);
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
  const pctx = promptContext(ws, brands, locale);

  return (
    <>
      {header}
      <section className="mb-10 rounded-3xl bg-card p-6 shadow-card sm:p-7" data-testid="fazit">
        <h2 className="mb-3 text-sm font-medium text-muted">{t.summary}</h2>
        <p className="text-lg font-semibold leading-snug">{verdict}</p>
        {named.length > 0 && <p className="mt-2 text-sm">{t.namedWere(f.list(named))}</p>}
        {shaping.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            {t.shapedBy}{' '}
            {shaping.map((x, i) => {
              const rid = recForDomain(targets, x.label);
              return (
                <span key={x.label}>
                  {i > 0 && ', '}{x.label}
                  {rid && <> <Link href={`/w/${slug}/massnahmen/${rid}`} data-rec-link className="whitespace-nowrap font-medium text-accent hover:underline">{t.toRec}</Link></>}
                </span>
              );
            })}
          </p>
        )}
      </section>

      {related.length > 0 && (
        <section className="mb-12" aria-labelledby="h-tun">
          <h2 id="h-tun" className="mb-4 text-lg font-semibold tracking-tight">{t.whatToDo}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {related.map((r) => <RecCard key={r.id} rec={r} slug={slug} prompt={recPrompt(r, pctx, locale)} />)}
          </div>
        </section>
      )}

      <h2 className="mb-1 text-lg font-semibold tracking-tight">{t.answers}</h2>
      <p className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted">
        {t.highlighted} <mark className="hl-own">{t.hlOwn}</mark><mark className="hl-competitor">{t.hlCompetitor}</mark><mark className="hl-untracked">{t.hlOther}</mark>
      </p>
      <OpenOnHash />
      <div className="space-y-6">
        {engines.map((e) => (
          <details key={e} id={e} className="group scroll-mt-6 rounded-2xl bg-card shadow-card">
            <summary className="flex cursor-pointer select-none items-center gap-3 px-5 py-4">
              <Dot fill={(() => { const x = engineStats.find((s) => s.e === e)!; return x.n ? fillLevel(x.hit / x.n) : null; })()} />
              <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
              <span className="font-semibold">{engineName(e, locale)}</span>
              <span className="text-sm text-muted">{(() => { const x = engineStats.find((s) => s.e === e)!; return !x.n ? t.engineNoAnswer : x.hit ? t.engineNamed(ownName, x.hit, x.n) : t.engineNotNamed(ownName); })()}</span>
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
                  <Card key={r.runId} className="!shadow-none ring-1 ring-border" title={<span className="flex flex-wrap items-center gap-2">{t.answerN(r.repetition)} {ownHit ? <Badge tone="own">{t.placeBadge(own!.name, ownHit.position)}</Badge> : r.answer ? <span className="text-sm font-normal text-muted">{t.engineNotNamed(own?.name ?? t.you)}</span> : null}</span>}
                    subtitle={r.model ? t.model(r.model) : undefined} pad>
                    {!r.answer ? (
                      <p className="text-sm text-muted">{r.noAiAnswer ? t.noAiAnswer : r.status === 'failed' ? t.failed(r.error) : r.status === 'skipped' ? t.skipped : t.noAnswer}</p>
                    ) : (
                      <>
                        <div className="max-h-[28rem] overflow-y-auto text-sm leading-relaxed">
                          <AnswerMarkdown text={r.answer} terms={terms} imageLabel={msg.questions.image} />
                        </div>
                        {ms.length > 0 && (
                          <div className="mt-4 border-t border-border pt-3">
                            <h3 className="mb-2 text-xs font-medium text-muted">{t.brandsNamed}</h3>
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
                            <p className="mt-1.5 text-xs text-muted">{t.recommendedLegend}</p>
                          </div>
                        )}
                        <div className="mt-4 border-t border-border pt-3">
                          <h3 className="mb-2 text-xs font-medium text-muted">{t.sources(cs.length)}</h3>
                          {cs.length === 0 ? <p className="text-xs text-muted">{t.noSources}</p> : (
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
                                    {isOwn && <Badge tone="own">{t.own}</Badge>}
                                    {comp && <Badge tone="competitor">{comp.name}</Badge>}
                                    {c.kind === 'searched' && <Badge tone="warn" title={t.readHint}>{t.read}</Badge>}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {rd.length > 0 && (
                            <details className="group mt-3">
                              <summary className="cursor-pointer select-none text-xs text-muted hover:text-fg">
                                {t.readNotCited(rd.length)} <span className="text-muted group-open:hidden">{t.show}</span>
                              </summary>
                              <p className="mt-1.5 text-xs text-muted">{t.readExplain}</p>
                              <ul className="mt-1.5 space-y-1 text-xs">
                                {rd.map((c, i) => {
                                  const isOwn = own ? domainMatches(c.domain || c.url, own.domains) : false;
                                  const ck = communityKind(c.domain || c.url);
                                  return (
                                    <li key={i} className="flex items-baseline gap-2">
                                      <a href={safeUrl(c.url) ?? undefined} target="_blank" rel="noreferrer noopener" className={`min-w-0 truncate text-muted hover:underline ${isOwn ? 'font-medium text-own' : ''}`} title={c.url}>
                                        {c.domain}<span className="text-muted">{safePath(c.url)}</span>
                                      </a>
                                      {isOwn && <Badge tone="own">{t.own}</Badge>}
                                      {ck && <Badge tone="warn">{t.community[ck] ?? ck}</Badge>}
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
