import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db, recommendation } from '@opengeo/db';
import { buildClaudePrompt, promptDeliverable, CATEGORIES, categoryOf, effortText, impactText } from '@opengeo/core/present';
import { StatusDot } from '@/components/rec-card';
import { AiPromptBlock, StepChecklist } from '@/components/rec-detail-client';
import { Evidence, Progress } from '@/components/rec-evidence';
import { RecStatusMenu } from '@/components/rec-status';
import { Back } from '@/components/ui';
import { LinkedText } from '@/components/linked-text';
import { linkTargets } from '@/lib/linkify';
import { CAT_STYLE, CategoryIcon } from '@/components/viz';
import { loadBrands } from '@/lib/metrics';
import { fmtPct } from '@/lib/format';
import { isUuid, metricLine, parseEvidence, parseMetric, type RecStatus } from '@/lib/recommendations';
import { promptContext } from '@/lib/recs-data';
import { plainTerms } from '@/lib/text';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Maßnahme' };

const Section = ({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) => (
  <section id={id} className="rounded-2xl bg-card p-5 shadow-card sm:p-6">
    <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
    {children}
  </section>
);

export default async function MassnahmeDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, canEdit } = await requireWorkspace(slug);
  if (!isUuid(id)) notFound();
  const [rec] = await db.select().from(recommendation).where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id))).limit(1);
  if (!rec) notFound();
  const brands = await loadBrands(ws.id);
  const prompt = buildClaudePrompt(rec, promptContext(ws, brands));
  const ev = parseEvidence(rec.evidence);
  const cat = categoryOf(rec.type);
  const status = rec.status as RecStatus;
  const before = parseMetric(rec.baseline) ?? ev.baseline;
  const started = status === 'in_progress' || status === 'done';
  const steps = (rec.steps ?? []).filter((s) => s && s.trim()).map(plainTerms);
  // Link-Ziele nur aus den Belegen: genutzte Seiten, Beispiele, Ausgangsseite, eigene Domains, Domain der Maßnahme
  const rawEv = (rec.evidence ?? {}) as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const links = {
    urls: [...ev.urls.map((u) => ({ url: u.url, title: u.title })), ...ev.examples.flatMap((e) => (e.url ? [{ url: e.url, title: e.title }] : [])), ...[ev.basePage, ...strs(rawEv.ownPages)].filter((u): u is string => !!u)],
    hosts: [...(brands.find((b) => b.isOwn)?.domains ?? []), ...(typeof rawEv.domain === 'string' ? [rawEv.domain] : []), ...strs(rawEv.domains)],
  };
  const targets = linkTargets(links.urls, links.hosts);
  const pages = ev.urls.slice(0, 5);

  return (
    <div className="mx-auto max-w-3xl">
      <Back href={`/w/${slug}/massnahmen`} label="Alle Maßnahmen" />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${CAT_STYLE[cat].bg} ${CAT_STYLE[cat].text}`}>
            <CategoryIcon cat={cat} size={14} /> {CATEGORIES[cat].label}
          </span>
          <span className="text-sm text-muted">Wer macht’s: <b className="font-medium text-fg">{CATEGORIES[cat].owner}</b></span>
          {!rec.active && <span className="text-sm text-muted">· nicht mehr aktuell</span>}
        </div>
        <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]"><LinkedText text={plainTerms(rec.title)} targets={targets} /></h1>
        <p className="mt-1.5 text-sm text-muted">{impactText(rec.impact)} · {effortText(rec)}</p>
        <div className="mt-4">
          {canEdit ? <RecStatusMenu slug={slug} id={rec.id} status={status} /> : <StatusDot status={status} />}
        </div>
      </header>

      <div className="space-y-6">
        <Section title="Warum">
          <p className="text-sm"><LinkedText text={plainTerms(rec.why)} targets={targets} /></p>
          {ev.current && ev.current.value !== null && (
            <div className="mt-4 flex items-center gap-3 text-sm">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
                <div className="h-full rounded-full bg-fg/70" style={{ width: `${Math.max(1.5, ev.current.value * 100)}%` }} />
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{fmtPct(ev.current.value)}</span>
            </div>
          )}
          {ev.current && <p className="mt-1 text-xs text-muted">{plainTerms(metricLine(ev.current))}</p>}
        </Section>

        <Section title="Mit KI umsetzen">
          <AiPromptBlock prompt={prompt} deliverable={promptDeliverable(rec)} />
        </Section>

        {(steps.length > 0 || ev.titleSuggestion || ev.basePage) && (
          <Section title="Schritte">
            {steps.length > 0 && <StepChecklist slug={slug} id={rec.id} steps={steps} initial={rec.doneSteps ?? []} canEdit={canEdit} links={links} />}
            {pages.length > 0 && (
              <div className="mt-4 border-t border-border pt-4" data-testid="rec-pages">
                <p className="mb-1.5 text-xs font-medium text-muted">{rec.type === 'community' ? 'Threads dazu' : 'Seiten dazu'}</p>
                <ul className="space-y-1 text-sm">
                  {pages.map((u) => (
                    <li key={u.url} className="[overflow-wrap:anywhere]">
                      <a href={u.url} target="_blank" rel="noreferrer noopener nofollow" className="text-accent hover:underline">{u.title || u.url.replace(/^https?:\/\/(www\.)?/, '')}</a>
                      {u.title && <span className="ml-1.5 text-xs text-muted">{u.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(ev.titleSuggestion || ev.basePage) && (
              <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
                {ev.titleSuggestion && <p><span className="text-muted">Titelvorschlag:</span> „{ev.titleSuggestion}“</p>}
                {ev.basePage && <p className="[overflow-wrap:anywhere]"><span className="text-muted">Ausgangsseite:</span> <a href={ev.basePage} target="_blank" rel="noreferrer noopener nofollow" className="text-accent hover:underline">{ev.basePage.replace(/^https?:\/\/(www\.)?/, '')}</a></p>}
              </div>
            )}
          </Section>
        )}

        {started && before && ev.current && ev.current.value !== null && (
          <Section title="Fortschritt">
            <Progress before={before} now={ev.current} />
          </Section>
        )}

        <details className="group rounded-2xl bg-card shadow-card">
          <summary className="cursor-pointer select-none px-5 py-4 text-lg font-semibold tracking-tight sm:px-6">
            Belege <span className="text-sm font-normal text-muted group-open:hidden">– anzeigen</span>
          </summary>
          <div className="px-5 pb-6 sm:px-6"><Evidence ev={ev} type={rec.type} slug={slug} /></div>
        </details>
      </div>
    </div>
  );
}
