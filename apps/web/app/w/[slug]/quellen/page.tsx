import Link from 'next/link';
import { ParamSelect } from '@/components/selects';
import { Back, Badge, Bar, Card, EmptyState, Hint, PageHeader } from '@/components/ui';
import { one, workspaceContext, type SP } from '@/lib/context';
import { fmtPct } from '@/lib/format';
import { competitorOnlyDomains, domainStats, engineLabel, loadBase, loadCollectionEngines, usedNotNamed } from '@/lib/metrics';
import { loadPromptsAndTopics } from '@/lib/prompts';
import { loadRecs } from '@/lib/recs-data';
import { outreachExclusions } from '@opengeo/core';
import { safeUrl } from '@/lib/url';
import { COMMUNITY_LABELS, readNotCitedStats, type ReadDomain } from '@/lib/sources';
import { recForDomain, recTargets } from '@/lib/view';

export const metadata = { title: 'Quellen' };

const TOP = 10;
const FIRST = 5; // Lücken-Listen: erst 5, Rest aufklappbar

export default async function SourcesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await workspaceContext(slug, sp);
  const { ws, brands, own, selected } = ctx;
  // KI-Suchen mit Daten in der gewählten Messung (nicht nur die aktuell eingestellten)
  const engineOpts = (await loadCollectionEngines(ws.id, selected ? [selected.id] : [])).map((e) => ({ value: e, label: engineLabel(e) }));
  const engine = engineOpts.some((o) => o.value === one(sp.engine)) ? one(sp.engine) : '';

  const header = (
    <>
      <Back href={`/w/${slug}`} label="Übersicht" />
      <PageHeader title="Quellen" description="Wo die KIs Wettbewerber finden – und dich nicht.">
        {selected && <ParamSelect param="engine" label="KI-Suche" value={engine} allLabel="Alle KI-Suchen" options={engineOpts} />}
        {selected && <ParamSelect param="c" label="Messung" value={selected.id} options={ctx.collectionOptions} />}
      </PageHeader>
    </>
  );
  if (!selected) return <>{header}<EmptyState title="Noch keine Messung" action={{ href: `/w/${slug}/settings/messung`, label: 'Zu den Einstellungen' }}>Starte die erste Messung in den Einstellungen.</EmptyState></>;

  const isLatest = ctx.finished[0]?.id === selected.id;
  const [base, { prompts }, recs, exclusions] = await Promise.all([loadBase(ws.id, [selected.id], { engine: engine || null }), loadPromptsAndTopics(ws.id), loadRecs(ws.id),
    isLatest ? outreachExclusions(ws.id).catch(() => []) : []]);
  const whyNot = new Map(exclusions.map((x) => [x.domain.replace(/^www\./, ''), x.text]));
  const promptText = new Map(prompts.map((p) => [p.id, p.text]));
  const targets = recTargets(recs);
  const top = domainStats(base.resps, base.cits, brands);
  const comp = competitorOnlyDomains(base.resps, base.ments, base.cits, brands);
  const unnamed = usedNotNamed(base.resps, base.ments, base.cits, own);
  const readStats = readNotCitedStats(base.resps, base.read, base.cits, brands);
  const recLink = (target: string) => {
    const id = recForDomain(targets, target);
    if (id) return <Link href={`/w/${slug}/massnahmen/${id}`} data-rec-link className="ml-2 whitespace-nowrap text-xs font-medium text-accent hover:underline">→ Maßnahme</Link>;
    return null;
  };
  // Ohne Maßnahme: Grund als Tooltip an der Domain statt eines „?“ in jeder Zeile
  const domainName = (d: string, extra = '') => {
    const why = whyNot.get(d.toLowerCase().replace(/^www\./, ''));
    return <span className={`font-medium [overflow-wrap:anywhere] ${why ? 'cursor-help underline decoration-border decoration-dotted underline-offset-4' : ''} ${extra}`}
      title={why ? `Keine Maßnahme: ${why}` : undefined} data-why-not={why ? '' : undefined}>{d}{why && <span className="sr-only"> – keine Maßnahme: {why}</span>}</span>;
  };
  const typeBadge = (t: string, name: string | null) =>
    t === 'own' ? <Badge tone="own">du</Badge> : t === 'competitor' ? <Badge tone="competitor">{name ?? 'Wettbewerber'}</Badge> : null;

  const unnamedItem = ({ response: r, citations }: (typeof unnamed)[number]) => (

                <li key={r.id} className="px-5 py-3 text-sm">
                  <Link className="hover:text-accent hover:underline" href={`/w/${slug}/fragen/${r.promptId}?c=${selected.id}#${r.engine}`}>„{promptText.get(r.promptId)}“</Link>
                  <span className="mt-0.5 flex min-w-0 gap-2 text-xs text-muted">
                    <span className="shrink-0">{engineLabel(r.engine)}</span>
                    <ExtLink url={citations[0]!.url} className="min-w-0 truncate hover:underline">{citations[0]!.url.replace(/^https?:\/\/(www\.)?/, '')}</ExtLink>
                    {citations.length > 1 && <span className="shrink-0">+{citations.length - 1}</span>}
                  </span>
                </li>
              
  );

  if (!top.rows.length) return <>{header}<EmptyState title="Keine Quellen in dieser Auswahl">Die Antworten dieser Messung enthalten keine Quellenangaben.</EmptyState></>;

  const domainRow = (r: (typeof top.rows)[number], i: number) => (
    <tr key={r.domain} className={r.type === 'own' ? 'bg-accent-soft/40' : ''}>
      <td className="num text-muted">{i + 1}</td>
      <td className="max-w-[16rem]">
        {domainName(r.domain)} {typeBadge(r.type, r.brandName)}{recLink(r.domain)}
      </td>
      <td className="num">
        {r.responses}
        {r.searchedOnly > 0 && <span className="text-muted" title={`${r.searchedOnly} davon nur gelesen, nicht zitiert`}> ({r.searchedOnly} gelesen)</span>}
      </td>
      <td className="hidden w-40 align-middle sm:table-cell"><Bar value={r.share} tone={r.type === 'own' ? 'accent' : 'muted'} /></td>
      <td className="num">{fmtPct(r.share)}</td>
    </tr>
  );
  const head = <thead><tr><th className="num w-8">#</th><th>Website<Hint>„→ Maßnahme“ führt zur passenden Aufgabe. Fehlt sie, steht der Grund im Tooltip der Domain (gepunktet unterstrichen).</Hint></th><th className="num">Antworten</th><th className="hidden sm:table-cell"></th><th className="num">Anteil</th></tr></thead>;

  const compItem = (r: (typeof comp.rows)[number]) => (
                <li key={r.domain} className="flex items-baseline justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    {domainName(r.domain)}{recLink(r.domain)}
                    <span className="block truncate text-xs text-muted">{r.competitors.slice(0, 3).join(', ')}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">{r.responses}× · {fmtPct(r.share)}</span>
                </li>
  );

  // answer first: erst die Lücken (Wettbewerber da, du nicht), dann deine Seite ohne Marke, dann die Gesamtliste
  return (
    <div className="space-y-12">
      <div>
        {header}
        <Card pad={false} title="Hier stehen Wettbewerber, du nicht"
          subtitle={comp.answers ? `Quellen aus ${comp.answers} Antworten, die Wettbewerber nennen, ${own?.name ?? 'dich'} aber nicht` : undefined}>
          {comp.rows.length === 0 ? <p className="p-5 text-sm text-muted">Keine solchen Antworten – sehr gut.</p> : (
            <ul className="divide-y divide-border">
              {comp.rows.slice(0, FIRST).map(compItem)}
              {comp.rows.length > FIRST && (
                <li>
                  <details>
                    <summary className="cursor-pointer select-none px-5 py-3 text-sm text-muted hover:text-fg">{Math.min(comp.rows.length, 15) - FIRST} weitere anzeigen</summary>
                    <ul className="divide-y divide-border border-t border-border">{comp.rows.slice(FIRST, 15).map(compItem)}</ul>
                  </details>
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>

        <Card pad={false} title={<span id="nicht-genannt" className="scroll-mt-6">Deine Seite ist Quelle, deine Marke fehlt</span>}
          subtitle={own ? `${unnamed.length}× nutzt eine KI-Suche ${own.domains.join(', ') || 'deine Seite'}, nennt ${own.name} aber nicht` : undefined}>
          {!own?.domains.length ? <p className="p-5 text-sm text-muted">Hinterlege in den Einstellungen die Website deiner Marke.</p>
          : unnamed.length === 0 ? <p className="p-5 text-sm text-muted">Keine Fälle in dieser Auswahl.</p> : (
            <ul className="divide-y divide-border">
              {unnamed.slice(0, FIRST).map(unnamedItem)}
              {unnamed.length > FIRST && (
                <li>
                  <details>
                    <summary className="cursor-pointer select-none px-5 py-3 text-sm text-muted hover:text-fg">{Math.min(unnamed.length, 40) - FIRST} weitere anzeigen</summary>
                    <ul className="divide-y divide-border border-t border-border">{unnamed.slice(FIRST, 40).map(unnamedItem)}</ul>
                  </details>
                </li>
              )}
            </ul>
          )}
        </Card>

        <Card pad={false} title="Meistgenutzte Quellen"
          subtitle={<>Anteil an allen {top.base} Antworten ({top.withSources} davon mit Quellen) <Hint>Zählt, in wie vielen Antworten eine Website als Quelle vorkommt. Nennt eine KI-Suche keine Quellen im Text (z. B. Claude), zählen die Seiten, die sie gelesen hat.</Hint></>}>
          <div className="overflow-x-auto">
            <table className="data">{head}<tbody>{top.rows.slice(0, TOP).map(domainRow)}</tbody></table>
          </div>
          {top.rows.length > TOP && (
            <details className="border-t border-border">
              <summary className="cursor-pointer select-none px-5 py-3 text-sm text-muted hover:text-fg">{Math.min(top.rows.length, 50) - TOP} weitere anzeigen</summary>
              <div className="overflow-x-auto">
                <table className="data"><tbody>{top.rows.slice(TOP, 50).map((r, i) => domainRow(r, i + TOP))}</tbody></table>
              </div>
            </details>
          )}
        </Card>

      <ReadSection id="gelesen" stats={readStats} recLink={recLink} />
    </div>
  );
}

/** Externer Link nur für http/https – sonst reiner Text. */
function ExtLink({ url, className, children }: { url: string; className?: string; children: React.ReactNode }) {
  const href = safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noreferrer noopener" className={className} title={url}>{children}</a> : <span className={className} title={url}>{children}</span>;
}

const pagePath = (u: string) => { try { const x = new URL(u); return (x.pathname === '/' ? '' : x.pathname) || x.hostname; } catch { return u; } };

function PageLinks({ pages, max = 3 }: { pages: ReadDomain['pages']; max?: number }) {
  return (
    <ul className="space-y-0.5">
      {pages.slice(0, max).map((p) => (
        <li key={p.url} className="flex min-w-0 items-baseline gap-2 text-xs">
          <ExtLink url={p.url} className="min-w-0 truncate text-muted hover:text-fg hover:underline">{p.title || pagePath(p.url)}</ExtLink>
          {p.responses > 1 && <span className="shrink-0 text-muted">{p.responses}×</span>}
        </li>
      ))}
      {pages.length > max && <li className="text-xs text-muted">+ {pages.length - max} weitere Seiten</li>}
    </ul>
  );
}

function ReadSection({ id, stats, recLink }: { id: string; stats: ReturnType<typeof readNotCitedStats>; recLink: (t: string) => React.ReactNode }) {
  const others = stats.rows.filter((r) => !r.community);
  const otherItem = (r: (typeof others)[number]) => (

                <li key={r.domain} className={`flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6 ${r.type === 'own' ? 'bg-accent-soft/40' : ''}`}>
                  <span className="min-w-0 text-sm">
                    <span className="font-medium [overflow-wrap:anywhere]">{r.domain}</span>
                    {r.type === 'own' && <> <Badge tone="own">du</Badge></>}
                    {r.type === 'competitor' && <> <Badge tone="competitor">{r.brandName ?? 'Wettbewerber'}</Badge></>}
                    {recLink(r.domain)}
                    <span className="mt-0.5 block"><PageLinks pages={r.pages} max={1} /></span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted">{r.responses}× · {fmtPct(r.share)}</span>
                </li>
              
  );
  return (
    <details id={id} className="group scroll-mt-6 rounded-2xl bg-card shadow-card">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-lg font-semibold tracking-tight">Von KI gelesen, aber nicht zitiert</span>
          <span className="mt-0.5 block text-xs text-muted">Die KI hat die Seite geöffnet, nennt sie aber nicht als Quelle. Nur ChatGPT liefert diese Daten.</span>
        </span>
        <span aria-hidden className="mt-1 text-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-border">
      {stats.rows.length === 0 ? (
        <p className="p-5 text-sm text-muted">In dieser Auswahl gibt es keine gelesenen, aber nicht zitierten Seiten.</p>
      ) : (
        <>
          {stats.community.length > 0 && (
            <div className="border-b border-border p-5">
              <h3 className="mb-3 text-sm font-semibold">Community-Plattformen <span className="font-normal text-muted">– hier mitzudiskutieren wirkt</span></h3>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                {stats.community.map((r) => (
                  <div key={r.domain} className="rounded-xl bg-subtle p-3.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{COMMUNITY_LABELS[r.community!]}</span>
                      <span className="shrink-0 text-xs text-muted">{r.responses} {r.responses === 1 ? 'Antwort' : 'Antworten'}</span>
                    </div>
                    {r.subreddits.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {r.subreddits.slice(0, 5).map((s) => (
                          <li key={s.name}>
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                              <span>
                                <a href={`https://www.reddit.com/${s.name}/`} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">{s.name}</a>
                                {recLink(s.name)}
                              </span>
                              <span className="text-xs text-muted">{s.responses}×</span>
                            </div>
                            <PageLinks pages={s.pages} max={2} />
                          </li>
                        ))}
                        {r.subreddits.length > 5 && <li className="text-xs text-muted">+ {r.subreddits.length - 5} weitere Subreddits</li>}
                      </ul>
                    ) : <div className="mt-2">{recLink(r.domain)}<PageLinks pages={r.pages} /></div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {others.length > 0 && (
            <ul className="divide-y divide-border">
              {others.slice(0, 10).map(otherItem)}
              {others.length > 10 && (
                <li>
                  <details>
                    <summary className="cursor-pointer select-none px-5 py-3 text-sm text-muted hover:text-fg">{Math.min(others.length, 60) - 10} weitere Websites anzeigen</summary>
                    <ul className="divide-y divide-border border-t border-border">{others.slice(10, 60).map(otherItem)}</ul>
                  </details>
                </li>
              )}
            </ul>
          )}
          <p className="border-t border-border px-5 py-2.5 text-xs text-muted">Basis: {stats.answers} Antworten mit gelesenen, nicht zitierten Seiten.</p>
        </>
      )}
      </div>
    </details>
  );
}
