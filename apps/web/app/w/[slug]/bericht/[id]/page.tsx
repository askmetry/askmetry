import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { brand, db, prompt } from '@askmetry/db';
import { REPORT_SCOPE, type ReportTier } from '@askmetry/core/hosted/config';
import type { ReportView } from '@askmetry/core/hosted/types';
import { engineName, scoreVerdict } from '@askmetry/core/present';
import { ActionForm } from '@/components/action-form';
import { AutoRefresh } from '@/components/auto-refresh';
import { AddCompetitor, CompetitorList } from '@/components/competitor-editor';
import { PromptEditor } from '@/components/prompt-editor';
import { StepIcon } from '@/components/step-icon';
import { Back, Badge } from '@/components/ui';
import { ScoreRing } from '@/components/viz';
import { toneColor } from '@/components/viz-style';
import { startReportAction } from '@/lib/actions/reports';
import { getReport } from '@/lib/hosted/data';
import { progressSteps, reportEta, type ProgressStep } from '@/lib/hosted/report-progress';
import { startProblem, strategyPreparing } from '@/lib/hosted/rights';
import { contactEmail, remeasureHref, rightsFor } from '@/lib/hosted/server';
import { getI18n, getT } from '@/lib/i18n/server';
import { brandMetrics, loadBase, loadBrands } from '@/lib/metrics';
import { requireWorkspace } from '@/lib/session';
import { toScore } from '@/lib/view';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Props = { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata() {
  return { title: (await getT()).reports.metaTitle };
}

export default async function BerichtPage({ params, searchParams }: Props) {
  const { slug, id } = await params;
  const ctx = await requireWorkspace(slug);
  if (!UUID_RE.test(id) || !(await rightsFor(ctx.ws)).reports) notFound();
  const rep = await getReport(id);
  // Mandantenprüfung: Bericht muss zu genau diesem Workspace gehören
  if (!rep || rep.workspaceId !== ctx.ws.id) notFound();
  const sp = await searchParams;
  const t = (await getT()).reports;
  const returned = sp.checkout === 'done' || sp.bezahlt === '1';
  const title = t.label(t.tier[rep.tier] ?? rep.tier, rep.kind === 'remeasure');
  // bezahlt und der Start läuft von selbst (gleich bzw. sobald Budget/laufende Messung es erlauben) → keine Pflichtaufgabe
  const starting = rep.status === 'paid' && (rep.autoStarting || rep.promptsPreparing);
  const waits = rep.status === 'paid' && (rep.error === 'autostart_budget' || rep.error === 'autostart_queued');
  const badge = starting || waits ? t.status.starting : t.status[rep.status] ?? rep.status;

  return (
    <div className="mx-auto max-w-3xl">
      <Back href={`/w/${slug}/berichte`} label={t.back} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <Badge tone={rep.status === 'ready' ? 'good' : rep.status === 'failed' ? 'bad' : 'accent'}>{badge}</Badge>
      </div>
      {rep.status === 'pending_payment' ? <PaymentPending rep={rep} slug={slug} returned={returned} />
        : starting || rep.status === 'measuring' ? <Measuring rep={rep} />
        : waits ? <AutoStartWaiting rep={rep} />
        : rep.status === 'paid' ? <Prepare rep={rep} slug={slug} wsId={ctx.ws.id} canEdit={ctx.canEdit} />
        : rep.status === 'ready' ? <Ready rep={rep} slug={slug} ws={ctx.ws} canEdit={ctx.canEdit} />
        : rep.status === 'failed' ? (
          <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8" data-testid="report-failed">
            <h2 className="text-[17px] font-semibold">{t.failed.title}</h2>
            <p className="mt-2 text-[15px]">{t.failed.text}</p>
            <p className="mt-3 text-sm"><a className="text-accent hover:underline" href={`mailto:${contactEmail()}`}>{t.failed.contact(contactEmail())}</a></p>
          </section>
        ) : <p className="rounded-2xl bg-card p-6 text-[15px] text-muted shadow-card">{rep.status === 'refunded' ? t.refunded : t.canceled}</p>}
    </div>
  );
}

async function PaymentPending({ rep, slug, returned }: { rep: ReportView; slug: string; returned: boolean }) {
  const t = (await getT()).reports.paymentPending;
  // Zahlungsstatus kommt nur per Webhook – nach der Rückkehr von der Kasse warten wir hier (Auto-Refresh)
  const recent = Date.now() - new Date(rep.createdAt).getTime() < 60 * 60 * 1000;
  if (returned || recent) {
    return (
      <section aria-live="polite" className="rounded-3xl bg-card p-6 shadow-card sm:p-8" data-testid="payment-pending">
        <AutoRefresh seconds={3} />
        <h2 className="text-[17px] font-semibold">{t.title}</h2>
        <p className="mt-2 text-[15px] text-muted">{t.text}</p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
          <div className="h-full w-1/3 animate-[progress_1.6s_ease-in-out_infinite] rounded-full bg-accent" />
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
      <p className="text-[15px]">{t.stillOpen}</p>
      <Link href={`/kaufen?tier=${rep.tier}&workspace=${encodeURIComponent(slug)}${rep.kind === 'remeasure' ? '&kind=remeasure' : ''}`} className="btn btn-primary mt-4">{t.retry}</Link>
    </section>
  );
}

async function Prepare({ rep, slug, wsId, canEdit }: { rep: ReportView; slug: string; wsId: string; canEdit: boolean }) {
  const t = (await getT()).reports.prepare;
  const tier = rep.tier as ReportTier;
  const scope = REPORT_SCOPE[tier];
  const [[pc], brands] = await Promise.all([
    db.select({ n: sql<number>`count(*) filter (where ${prompt.active})::int` }).from(prompt).where(eq(prompt.workspaceId, wsId)),
    db.select({ id: brand.id, name: brand.name, aliases: brand.aliases, domains: brand.domains, logoType: brand.logoType, logoUpdatedAt: brand.logoUpdatedAt })
      .from(brand).where(and(eq(brand.workspaceId, wsId), eq(brand.isOwn, false))).orderBy(brand.name),
  ]);
  const active = pc?.n ?? 0;
  const preparing = strategyPreparing(rep);
  const problem = startProblem({ status: rep.status, tier, kind: rep.kind, activePrompts: active, competitors: brands.length, preparing });
  const ro = !canEdit;
  // Auto-Start nach der Zahlung hat nicht geklappt → Grund nennen, Startknopf ist der Rückfall
  const autoNote = rep.error === 'autostart_too_few' ? t.autostart.tooFew(active, scope.prompts) : rep.error === 'autostart_failed' ? t.autostart.failed : null;
  const warn = problem === 'tooManyPrompts' ? t.questionsTooMany(scope.prompts) : problem === 'tooFewPrompts' ? t.questionsTooFew(scope.prompts)
    : problem === 'tooManyCompetitors' ? t.competitorsTooMany(scope.competitors) : null;

  if (rep.kind === 'remeasure') {
    return (
      <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8" data-testid="report-prepare">
        {autoNote && <p role="status" className="mb-4 rounded-xl bg-subtle px-4 py-3 text-sm" data-testid="report-autostart-note">{autoNote}</p>}
        <p className="text-[15px]">{t.startHint}</p>
        {canEdit && <div className="mt-5"><ActionForm action={startReportAction} slug={slug} submit={t.start} submitClass="btn btn-primary"><input type="hidden" name="reportId" value={rep.id} /></ActionForm></div>}
      </section>
    );
  }

  return (
    <div className="space-y-6" data-testid="report-prepare">
      {preparing && <AutoRefresh seconds={5} />}
      <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
        <h2 className="text-[17px] font-semibold">{t.title}</h2>
        <p className="mt-1 text-[15px] text-muted">{t.intro}</p>
        {autoNote && <p role="status" className="mt-4 rounded-xl bg-subtle px-4 py-3 text-sm" data-testid="report-autostart-note">{autoNote}</p>}
        {preparing ? (
          <div className="mt-5" aria-live="polite" data-testid="report-preparing">
            <p className="font-medium">{t.preparing}</p>
            <p className="mt-1 text-sm text-muted">{t.preparingText}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden><div className="h-full w-1/3 animate-[progress_1.6s_ease-in-out_infinite] rounded-full bg-accent" /></div>
          </div>
        ) : (
          <>
            {rep.error === 'prompts_failed' && <p role="status" className="mt-4 rounded-xl bg-subtle px-4 py-3 text-sm">{t.promptsFailed}</p>}
            {warn && <p role="alert" className="mt-4 rounded-xl bg-subtle px-4 py-3 text-sm text-bad">{warn}</p>}
            {canEdit && (
              <div className="mt-5">
                <ActionForm action={startReportAction} slug={slug} submit={t.start} submitClass="btn btn-primary !px-5 !py-2.5" disabled={!!problem} confirm={t.confirm}>
                  <input type="hidden" name="reportId" value={rep.id} />
                </ActionForm>
                <p className="mt-2 text-[13px] text-muted">{t.startHint}</p>
              </div>
            )}
          </>
        )}
      </section>

      <details className="group rounded-2xl bg-card shadow-card" open={problem === 'tooManyPrompts' || problem === 'tooFewPrompts'}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block font-medium">{t.questions}</span>
            <span className="block text-sm text-muted">{t.questionsCount(active, scope.prompts)}</span>
          </span>
          <span className="text-sm text-accent group-open:hidden">{t.edit}</span>
          <span aria-hidden className="hidden text-muted group-open:inline">▴</span>
        </summary>
        <div className="border-t border-border p-3 sm:p-4"><PromptEditor slug={slug} workspaceId={wsId} ro={ro || preparing} showTopics={tier === 'strategy'} /></div>
      </details>

      <details className="group rounded-2xl bg-card shadow-card" open={problem === 'tooManyCompetitors'}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block font-medium">{t.competitors}</span>
            <span className="block text-sm text-muted">{t.competitorsCount(brands.length, scope.competitors)}</span>
          </span>
          <span className="text-sm text-accent group-open:hidden">{t.edit}</span>
          <span aria-hidden className="hidden text-muted group-open:inline">▴</span>
        </summary>
        <div className="space-y-3 border-t border-border p-3 sm:p-4">
          {!ro && brands.length < scope.competitors && <div className="flex justify-end"><AddCompetitor slug={slug} /></div>}
          <CompetitorList slug={slug} competitors={brands} ro={ro} />
        </div>
      </details>
    </div>
  );
}

/** Während der Messung (und kurz davor, solange sie automatisch startet): Ansage oben, darunter eine Zeile je KI und die Folgeschritte. */
async function Measuring({ rep }: { rep: ReportView }) {
  const { t: tt, locale } = await getI18n();
  const t = tt.reports.measuring;
  const steps = progressSteps(rep, REPORT_SCOPE[rep.tier as ReportTier]?.engines ?? []);
  const eta = reportEta(rep);
  const close = t.closeTab(rep.buyerEmailMasked);
  const lead = eta.kind === 'minutes' ? `${close}, ${t.etaMinutes(eta.n)}.` : eta.kind === 'hours' ? `${close}, ${t.etaHours(eta.n)}.`
    : eta.kind === 'soon' ? `${close}, ${t.etaSoon}.` : `${close}.`;
  const second = eta.kind === 'onlyClaude' ? t.onlyClaude : eta.kind === 'unknown' ? t.etaUnknown
    : (eta.kind === 'minutes' || eta.kind === 'hours') && eta.batch ? t.etaBatch : null;
  const label = (s: ProgressStep) => (s.key === 'engine' ? engineName(s.engine!, locale) : t.steps[s.key]);
  const detail = (s: ProgressStep): { text: string; quiet?: string } | null => {
    if (s.key !== 'engine') return null;
    if (s.batchWaiting) return { text: t.batchWaiting, quiet: s.failed ? t.noAnswer(s.failed) : undefined };
    if (!s.count) return s.state === 'todo' ? { text: t.waiting } : null;
    return { text: t.count(s.count.done, s.count.total), quiet: s.failed ? t.noAnswer(s.failed) : undefined };
  };
  return (
    <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8" data-testid="report-measuring" data-eta={eta.kind}>
      <AutoRefresh seconds={rep.status === 'paid' ? 3 : 10} />
      <h2 className="text-[1.375rem] font-semibold leading-tight tracking-tight">{rep.status === 'paid' ? t.titleStarting : t.title}</h2>
      <p className="mt-2 text-[15px]" data-testid="report-eta">{lead}</p>
      {second && <p className="mt-1 text-[15px] text-muted">{second}</p>}
      <ol className="mt-5 divide-y divide-border/70" aria-label={t.listLabel} aria-live="polite" data-testid="report-steps">
        {steps.map((s) => {
          const d = detail(s);
          return (
            <li key={s.engine ?? s.key} data-step={s.engine ?? s.key} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}
              className="flex items-center gap-3.5 py-3">
              <StepIcon state={s.state} />
              <span className={`min-w-0 flex-1 text-[15px] ${s.state === 'todo' ? 'text-muted' : s.state === 'current' ? 'font-semibold' : ''}`}>
                {label(s)}
                <span className="sr-only"> – {s.state === 'done' ? t.stateDone : s.state === 'current' ? t.stateCurrent : t.stateTodo}</span>
              </span>
              {d && (
                <span className="flex max-w-[55%] flex-col items-end text-right">
                  <span className={`text-sm tabular-nums ${s.state === 'current' ? 'text-fg' : 'text-muted'}`}>{d.text}</span>
                  {d.quiet && <span className="text-[13px] tabular-nums text-muted">{d.quiet}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-[13px] text-muted">{t.refresh}</p>
    </section>
  );
}

/** Auto-Start wartet auf Budget bzw. eine laufende Messung – der Worker startet von selbst, der Kunde muss nichts tun. */
async function AutoStartWaiting({ rep }: { rep: ReportView }) {
  const t = (await getT()).reports;
  return (
    <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8" data-testid="report-autostart-waiting">
      <AutoRefresh seconds={30} />
      <h2 className="text-[1.375rem] font-semibold leading-tight tracking-tight">{t.measuring.titleStarting}</h2>
      <p className="mt-2 text-[15px]">{rep.error === 'autostart_budget' ? t.prepare.autostart.budget : t.prepare.autostart.queued}</p>
      <p className="mt-1 text-[15px] text-muted">{t.measuring.closeTab(rep.buyerEmailMasked)}.</p>
    </section>
  );
}

async function Ready({ rep, slug, ws, canEdit }: { rep: ReportView; slug: string; ws: { id: string; slug: string; hostedKind: string | null }; canEdit: boolean }) {
  const { t: tt, f, locale } = await getI18n();
  const t = tt.reports.ready;
  const own = (await loadBrands(ws.id)).find((b) => b.isOwn);
  const base = rep.collectionId && own ? await loadBase(ws.id, [rep.collectionId]) : null;
  const m = base && own ? brandMetrics(base.resps, base.ments, base.cits, own) : null;
  const score = toScore(m?.visibility);
  const verdict = scoreVerdict(score, locale);
  const rebuy = canEdit ? await remeasureHref(ws) : null;
  return (
    <div className="space-y-6" data-testid="report-ready">
      <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
        <p className="text-sm text-muted">{t.readyOn(f.date(rep.readyAt ?? rep.createdAt, false))}{rep.emailedAt ? ` · ${t.emailed}` : ''}</p>
        {m && m.n > 0 && (
          <div className="mt-5 flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
            <ScoreRing score={score} tone={verdict.tone} size={120} />
            <div>
              <p className="text-sm text-muted">{t.score}</p>
              <p className="mt-1 inline-flex items-center gap-2 text-[1.5rem] font-semibold tracking-tight">
                <span aria-hidden className="inline-block size-3 rounded-full" style={{ background: toneColor(verdict.tone) }} />{verdict.label}
              </p>
              <p className="mt-1 text-[15px]">{t.namedIn(m.mentioned, m.n)}</p>
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {rep.hasPdf ? <a href={`/w/${slug}/bericht/${rep.id}/pdf`} className="btn btn-primary" data-testid="report-pdf">{tt.reports.pdf}</a>
            : <span className="text-sm text-muted">{t.pdfMissing}</span>}
          <Link href={`/w/${slug}`} className="btn">{t.overview}</Link>
          <Link href={`/w/${slug}/massnahmen`} className="btn">{t.recs}</Link>
        </div>
      </section>
      {rebuy && (
        <section className="rounded-2xl bg-card p-6 shadow-card">
          <h2 className="text-[17px] font-semibold">{t.remeasureTitle}</h2>
          <p className="mt-1 text-[15px] text-muted">{t.remeasureText}</p>
          <Link href={rebuy} className="btn mt-4">{tt.reports.buyRemeasure}</Link>
        </section>
      )}
    </div>
  );
}
