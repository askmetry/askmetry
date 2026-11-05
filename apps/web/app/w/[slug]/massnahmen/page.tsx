import Link from 'next/link';
import { CATEGORIES, categoryOf, categoryText, type RecCategory } from '@askmetry/core/present';
import { RecCard } from '@/components/rec-card';
import { EmptyState } from '@/components/ui';
import { CategoryIcon } from '@/components/viz';
import { CAT_STYLE } from '@/components/viz-style';
import { one, workspaceContext, type SP } from '@/lib/context';
import { sortRecs } from '@/lib/recommendations';
import { loadRecs, promptContext, recPrompt, type RecRow } from '@/lib/recs-data';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: (await getI18n()).t.recs.title };
}

const FILTERS = [
  { key: '', label: 'open', match: (r: RecRow) => r.status === 'open' },
  { key: 'arbeit', label: 'in_progress', match: (r: RecRow) => r.status === 'in_progress' },
  { key: 'erledigt', label: 'done', match: (r: RecRow) => r.status === 'done' },
] as const;

const CAT_ORDER = (Object.keys(CATEGORIES) as RecCategory[]).sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order);

export default async function MassnahmenPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await workspaceContext(slug, {});
  const { locale, t: msg } = await getI18n();
  const t = msg.recs;
  const { ws, own, brands, selected, all } = ctx;
  const running = all.find((c) => c.status === 'queued' || c.status === 'running');

  const header = (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-1 text-sm text-muted">{t.intro}</p>
    </div>
  );
  if (!own) return <>{header}<EmptyState title={t.empty.noBrandTitle} action={{ href: `/w/${slug}/settings/marke`, label: t.empty.noBrandAction }}>{t.empty.noBrandText}</EmptyState></>;
  if (!selected) {
    return <>{header}<EmptyState title={t.empty.noMeasurementTitle} action={{ href: ctx.measureHref, label: ctx.measureLabel ?? (running ? t.empty.viewStatus : t.empty.measureNow) }}>
      {running ? t.empty.measurementRunning(running.status === 'running') : t.empty.noMeasurementText}
    </EmptyState></>;
  }

  const recs = sortRecs(await loadRecs(ws.id));
  const pctx = promptContext(ws, brands, locale);
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
      {rs.map((r) => <RecCard key={r.id} rec={r} slug={slug} prompt={recPrompt(r, pctx, locale)} hideCategory={inSection} />)}
    </div>
  );

  if (!active.length) {
    return <>{header}<EmptyState title={t.empty.noRecsTitle} action={{ href: `/w/${slug}`, label: t.empty.toOverview }}>
      {inactive.length ? t.empty.allResolved : t.empty.pending}
    </EmptyState></>;
  }

  return (
    <>
      {header}
      <nav aria-label={t.filterLabel} className="mb-10 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = active.filter(f.match).length;
          const on = f.key === filter.key;
          return (
            <Link key={f.key || 'aktuell'} href={`/w/${slug}/massnahmen${f.key ? `?status=${f.key}` : ''}`} scroll={false} aria-current={on ? 'true' : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm ${on ? 'bg-fg font-medium text-bg' : 'bg-card text-muted shadow-card hover:text-fg'}`}>
              {t.filters[f.label]} <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-card px-5 py-10 text-center text-sm text-muted shadow-card">{t.noneWithStatus}</p>
      ) : (
        <div className="space-y-12">
          {CAT_ORDER.filter((c) => byCat.has(c)).map((c) => (
            <section key={c} id={c} aria-labelledby={`h-${c}`} className="scroll-mt-6">
              <h2 id={`h-${c}`} className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <span className={`inline-flex size-7 items-center justify-center rounded-lg ${CAT_STYLE[c].bg} ${CAT_STYLE[c].text}`}><CategoryIcon cat={c} size={16} /></span>
                {categoryText(c, locale).label}
                <span className="text-sm font-normal text-muted">· {categoryText(c, locale).owner} · {byCat.get(c)!.length}</span>
              </h2>
              {grid(byCat.get(c)!, true)}
            </section>
          ))}
        </div>
      )}

      {filter.key === '' && (dismissed.length > 0 || inactive.length > 0) && (
        <div className="mt-12 space-y-3">
          {[
            { label: t.hiddenGroup, rs: dismissed, hint: '' },
            { label: t.inactiveGroup, rs: inactive, hint: t.inactiveHint },
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
