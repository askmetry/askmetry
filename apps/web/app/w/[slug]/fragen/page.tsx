import Link from 'next/link';
import { EmptyState, Hint } from '@/components/ui';
import { Dot } from '@/components/viz';
import { one, workspaceContext, type SP } from '@/lib/context';
import { fmtDate } from '@/lib/format';
import { engineLabel, findGaps, loadBase, promptEngineMatrix, sortEngines } from '@/lib/metrics';
import { loadPromptsAndTopics } from '@/lib/prompts';
import { fillLevel } from '@/lib/view';

export const metadata = { title: 'Fragen' };

// Spaltenköpfe über den Punkten (Desktop) bzw. darunter (mobil, gekürzt)
const SHORT: Record<string, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity', google_aio: 'G-Übersicht', google_ai_mode: 'G-KI-Modus' };
const TINY: Record<string, string> = { chatgpt: 'GPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perpl.', google_aio: 'G-Übers.', google_ai_mode: 'G-KI' };

export default async function FragenPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await workspaceContext(slug, sp);
  const { ws, own, brands, selected, canEdit } = ctx;
  const { prompts, topics } = await loadPromptsAndTopics(ws.id);
  const onlyGaps = one(sp.ohne) === '1';

  const header = (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fragen</h1>
        <p className="mt-1 text-sm text-muted">Die Punkte zeigen, ob die KI-Suchen {own?.name ?? 'deine Marke'} nennen.</p>
      </div>
      {canEdit && <Link href={`/w/${slug}/settings/fragen`} className="btn btn-sm">Fragen bearbeiten</Link>}
    </div>
  );
  if (!prompts.length) return <>{header}<EmptyState title="Noch keine Fragen" action={{ href: `/w/${slug}/settings/fragen`, label: 'Fragen anlegen' }}>Lege die Fragen an, die deine Kundinnen und Kunden einer KI stellen würden.</EmptyState></>;
  if (!selected) return <>{header}<EmptyState title="Noch keine Messung" action={{ href: `/w/${slug}/settings/messung`, label: 'Jetzt messen' }}>Nach der ersten Messung siehst du hier, bei welchen Fragen du genannt wirst.</EmptyState></>;

  const base = await loadBase(ws.id, [selected.id]);
  const matrix = promptEngineMatrix(base.resps, base.ments, own?.id);
  const engines = sortEngines(base.resps.map((r) => r.engine));
  const gaps = new Map(findGaps(base.resps, base.ments, brands).map((g) => [g.promptId, g]));
  const all = prompts.filter((p) => matrix.has(p.id));
  // „Fragen ohne dich“: in keiner KI-Suche genannt
  const absent = all.filter((p) => gaps.get(p.id)?.absent);
  const rows = onlyGaps ? absent : all;
  const topicName = new Map(topics.map((t) => [t.id, t.name]));
  const groups = new Map<string, typeof rows>();
  for (const p of rows) {
    const k = p.topicId ? topicName.get(p.topicId) ?? '' : '';
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const qs = ctx.finished[0]?.id === selected.id ? '' : `?c=${selected.id}`;

  return (
    <>
      {header}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter" className="flex flex-wrap gap-2">
          {[{ on: !onlyGaps, href: `/w/${slug}/fragen`, label: 'Alle Fragen', n: all.length },
            { on: onlyGaps, href: `/w/${slug}/fragen?ohne=1`, label: 'Fragen ohne dich', n: absent.length }].map((f) => (
            <Link key={f.label} href={f.href} aria-current={f.on ? 'true' : undefined} scroll={false}
              className={`rounded-full px-3.5 py-1.5 text-sm ${f.on ? 'bg-fg font-medium text-bg' : 'bg-card text-muted shadow-card hover:text-fg'}`}>
              {f.label} <span className="tabular-nums opacity-70">{f.n}</span>
            </Link>
          ))}
          {onlyGaps && <Hint>Fragen, bei denen dich keine einzige KI-Suche nennt.</Hint>}
        </nav>
        <p className="flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><Dot fill="none" size={12} /> nie</span>
          <span className="inline-flex items-center gap-1"><Dot fill="some" size={12} /> teils</span>
          <span className="inline-flex items-center gap-1"><Dot fill="often" size={12} /> oft genannt</span>
          <span className="hidden sm:inline">· Messung vom {fmtDate(selected.finishedAt ?? selected.createdAt, false)}</span>
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-card px-5 py-10 text-center text-sm text-muted shadow-card">{onlyGaps ? `Keine Frage ohne ${own?.name ?? 'dich'} – sehr gut.` : 'Keine Antworten in dieser Messung.'}</p>
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([g, ps]) => (
            <section key={g || 'ohne'}>
              {groups.size > 1 && <h2 className="mb-3 text-sm font-medium text-muted">{g || 'Ohne Thema'}</h2>}
              <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-card">
                {/* eine Legende oben statt Kürzel unter jedem Punkt (auch mobil) */}
                <li aria-hidden className="flex items-end justify-end gap-6 px-5 pb-2 pt-3">
                  <span className="flex shrink-0">
                    {engines.map((e) => (
                      <span key={e} className="w-[3.75rem] text-center text-xs leading-tight text-muted sm:w-[5.5rem]">
                        <span className="sm:hidden">{TINY[e] ?? e}</span><span className="hidden sm:inline">{SHORT[e] ?? engineLabel(e)}</span>
                      </span>
                    ))}
                  </span>
                </li>
                {ps.map((p) => {
                  const row = matrix.get(p.id)!;
                  const gap = gaps.get(p.id);
                  const asked = engines.filter((e) => row.get(e)?.n);
                  const missing = asked.filter((e) => row.get(e)!.mentioned === 0).length;
                  return (
                    <li key={p.id} data-question={p.id}>
                      <Link href={`/w/${slug}/fragen/${p.id}${qs}`} className="flex flex-col gap-2.5 px-5 py-4 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                        <span className="min-w-0">
                          <span className="block [overflow-wrap:anywhere]">{p.text}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {missing === 0 ? 'Überall genannt' : `Fehlt in ${missing} von ${asked.length} KI-Suchen`}
                            {gap && gap.named.length > 0 && ` · stattdessen: ${gap.named.slice(0, 3).map((n) => n.name).join(', ')}`}
                          </span>
                        </span>
                        <span className="flex shrink-0 self-end sm:self-auto" aria-label="Genannt je KI-Suche">
                          {engines.map((e) => {
                            const c = row.get(e);
                            const f = c && c.n ? fillLevel(c.mentioned / c.n) : null;
                            return (
                              <span key={e} className="flex w-[3.75rem] justify-center sm:w-[5.5rem]">
                                <Dot fill={f} size={16} title={`${engineLabel(e)}: ${c ? `in ${c.mentioned} von ${c.n} Antworten genannt` : 'keine Antwort'}`} />
                              </span>
                            );
                          })}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
