import Link from 'next/link';
import { buildClaudePrompt, CATEGORIES, categoryOf, type RecCategory } from '@opengeo/core/present';
import { RecCard } from '@/components/rec-card';
import { EmptyState } from '@/components/ui';
import { CAT_STYLE, CategoryIcon } from '@/components/viz';
import { one, workspaceContext, type SP } from '@/lib/context';
import { sortRecs } from '@/lib/recommendations';
import { loadRecs, promptContext, type RecRow } from '@/lib/recs-data';

export const metadata = { title: 'Maßnahmen' };

const FILTERS = [
  { key: '', label: 'Offen', match: (r: RecRow) => r.status === 'open' },
  { key: 'arbeit', label: 'In Arbeit', match: (r: RecRow) => r.status === 'in_progress' },
  { key: 'erledigt', label: 'Erledigt', match: (r: RecRow) => r.status === 'done' },
] as const;

const CAT_ORDER = (Object.keys(CATEGORIES) as RecCategory[]).sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order);

export default async function MassnahmenPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await workspaceContext(slug, {});
  const { ws, own, brands, selected, all } = ctx;
  const running = all.find((c) => c.status === 'queued' || c.status === 'running');

  const header = (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">Maßnahmen</h1>
      <p className="mt-1 text-sm text-muted">Nach Wirkung sortiert. Jede Maßnahme lässt sich als Prompt an deine KI übergeben.</p>
    </div>
  );
  if (!own) return <>{header}<EmptyState title="Noch keine eigene Marke" action={{ href: `/w/${slug}/settings/marke`, label: 'Zu den Einstellungen' }}>Lege deine Marke mit Website an – danach messen wir und leiten Maßnahmen ab.</EmptyState></>;
  if (!selected) {
    return <>{header}<EmptyState title="Noch keine Messung" action={{ href: `/w/${slug}/settings/messung`, label: running ? 'Status ansehen' : 'Jetzt messen' }}>
      {running ? `Eine Messung ist ${running.status === 'running' ? 'gerade unterwegs' : 'eingeplant'}. Danach erscheinen hier deine Maßnahmen.` : 'Maßnahmen entstehen aus den Antworten der KI-Suchen. Starte die erste Messung – danach siehst du hier, was du tun kannst.'}
    </EmptyState></>;
  }

  const recs = sortRecs(await loadRecs(ws.id));
  const pctx = promptContext(ws, brands);
  const active = recs.filter((r) => r.active);
  const filter = FILTERS.find((f) => f.key === (one(sp.status) === 'offen' ? '' : one(sp.status))) ?? FILTERS[0];
  const shown = active.filter(filter.match);
  const byCat = new Map<RecCategory, RecRow[]>();
  for (const r of shown) {
    const c = categoryOf(r.type);
    byCat.set(c, [...(byCat.get(c) ?? []), r]);
  }
  const dismissed = active.filter((r) => r.status === 'dismissed');
  // „Nicht mehr aktuell“ ergibt erst ab der zweiten Messung Sinn
  const measured = all.filter((c) => c.status === 'done').length;
  const inactive = measured > 1 ? recs.filter((r) => !r.active) : [];
  const grid = (rs: RecRow[], inSection = false) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rs.map((r) => <RecCard key={r.id} rec={r} slug={slug} prompt={buildClaudePrompt(r, pctx)} hideCategory={inSection} />)}
    </div>
  );

  if (!active.length) {
    return <>{header}<EmptyState title="Noch keine Maßnahmen" action={{ href: `/w/${slug}`, label: 'Zur Übersicht' }}>
      {inactive.length
        ? 'Die bisherigen Maßnahmen sind durch die letzte Messung nicht mehr nötig. Neue entstehen automatisch nach der nächsten Messung.'
        : 'Maßnahmen werden nach jeder Messung automatisch aus den KI-Antworten abgeleitet. Sie erscheinen hier, sobald die Auswertung durch ist.'}
    </EmptyState></>;
  }

  return (
    <>
      {header}
      <nav aria-label="Nach Status filtern" className="mb-10 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = active.filter(f.match).length;
          const on = f.key === filter.key;
          return (
            <Link key={f.key || 'aktuell'} href={`/w/${slug}/massnahmen${f.key ? `?status=${f.key}` : ''}`} scroll={false} aria-current={on ? 'true' : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm ${on ? 'bg-fg font-medium text-bg' : 'bg-card text-muted shadow-card hover:text-fg'}`}>
              {f.label} <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-card px-5 py-10 text-center text-sm text-muted shadow-card">Keine Maßnahmen mit diesem Status.</p>
      ) : (
        <div className="space-y-12">
          {CAT_ORDER.filter((c) => byCat.has(c)).map((c) => (
            <section key={c} id={c} aria-labelledby={`h-${c}`} className="scroll-mt-6">
              <h2 id={`h-${c}`} className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <span className={`inline-flex size-7 items-center justify-center rounded-lg ${CAT_STYLE[c].bg} ${CAT_STYLE[c].text}`}><CategoryIcon cat={c} size={16} /></span>
                {CATEGORIES[c].label}
                <span className="text-sm font-normal text-muted">· {CATEGORIES[c].owner} · {byCat.get(c)!.length}</span>
              </h2>
              {grid(byCat.get(c)!, true)}
            </section>
          ))}
        </div>
      )}

      {filter.key === '' && (dismissed.length > 0 || inactive.length > 0) && (
        <div className="mt-12 space-y-3">
          {[
            { label: 'Ausgeblendet', rs: dismissed, hint: '' },
            { label: 'Nicht mehr aktuell', rs: inactive, hint: 'Die letzte Messung zeigt das Problem nicht mehr.' },
          ].filter((x) => x.rs.length).map((x) => (
            <details key={x.label} className="rounded-2xl bg-card shadow-card">
              <summary className="cursor-pointer select-none px-5 py-4 text-sm font-medium">
                {x.label} <span className="font-normal text-muted">({x.rs.length}){x.hint ? ` – ${x.hint}` : ''}</span>
              </summary>
              <div className="px-4 pb-4">{grid(x.rs)}</div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
