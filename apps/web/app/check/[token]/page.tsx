import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { domainsWithLogo } from '@askmetry/core';
import { CHECK_SCOPE, REPORT_SCOPE } from '@askmetry/core/hosted/config';
import { scoreVerdict } from '@askmetry/core/present';
import type { CheckView } from '@askmetry/core/hosted/types';
import { AutoRefresh } from '@/components/auto-refresh';
import { BrandMark } from '@/components/brand-mark';
import { BuyOptions } from '@/components/check/buy-options';
import { CheckNotifyForm } from '@/components/check/email-form';
import { TeaserRecCard } from '@/components/check/teaser-rec';
import { PublicShell } from '@/components/public-shell';
import { Hint } from '@/components/ui';
import { ScoreRing } from '@/components/viz';
import { toneColor } from '@/components/viz-style';
import { getCheckView } from '@/lib/hosted/data';
import { contactEmail, isHosted } from '@/lib/hosted/server';
import { agentSteps, cleanDomain, elapsedText, lockedCount, refreshSeconds, visibilityEstimate, type AgentStep } from '@/lib/hosted/teaser';
import { getI18n, getT } from '@/lib/i18n/server';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = (await getT()).check;
  const { token } = await params;
  const view = isHosted() && TOKEN_RE.test(token) ? await getCheckView(token) : null;
  // Token = Zugang: nie indexieren, nie als Referrer an verlinkte Seiten weitergeben
  return { title: view ? t.metaTitleFor(view.domain) : t.metaTitle, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function CheckPage({ params, searchParams }: Props) {
  if (!isHosted()) notFound();
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();
  const view = await getCheckView(token);
  if (!view) notFound();
  const sp = await searchParams;
  const refresh = refreshSeconds(view.status);
  const verified = one(sp.bestaetigt) === '1';
  const verifyError = one(sp.fehler) || null;
  return (
    <PublicShell width={view.status === 'ready' ? 'max-w-[880px]' : 'max-w-[640px]'}>
      {refresh && <AutoRefresh seconds={refresh} />}
      {view.status === 'ready' && view.summary ? <Teaser view={view} canceled={one(sp.checkout) === 'canceled'} verified={verified} />
        : ['failed', 'blocked'].includes(view.status) ? <Problem view={view} />
        : <Waiting view={view} verified={verified} verifyError={verifyError} />}
    </PublicShell>
  );
}

/** Symbol eines Schritts: Haken (erledigt), drehender Ring (läuft), leerer Kreis (kommt noch). */
function StepIcon({ state }: { state: AgentStep['state'] }) {
  if (state === 'done') {
    return (
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span aria-hidden className="relative flex size-6 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-accent/25" />
        <span className="agent-spin absolute inset-0 rounded-full border-2 border-transparent border-t-accent" />
        <span className="size-2 rounded-full bg-accent" />
      </span>
    );
  }
  return <span aria-hidden className="size-6 shrink-0 rounded-full border-2 border-border" />;
}

/** Checkliste des Agenten: jeder Schritt spiegelt einen echten Zustand (siehe agentSteps). */
async function AgentChecklist({ view }: { view: CheckView }) {
  const { t } = await getI18n();
  const a = t.check.agent;
  const steps = agentSteps(view);
  const detail = (s: AgentStep): string | null => {
    const d = s.detail;
    if (!d) return null;
    if (d.kind === 'brand') return d.name;
    if (d.kind === 'competitors') return a.competitorsFound(d.n);
    if (d.kind === 'questions') return a.questionsCount(d.n);
    return a.answered(d.done, d.total);
  };
  return (
    <ol className="divide-y divide-border/70" aria-label={a.listLabel} data-testid="agent-checklist">
      {steps.map((s) => {
        const d = detail(s);
        return (
          <li key={s.key} data-step={s.key} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}
            className="flex items-center gap-3.5 py-3">
            <StepIcon state={s.state} />
            <span className={`min-w-0 flex-1 text-[15px] ${s.state === 'todo' ? 'text-muted' : s.state === 'current' ? 'font-semibold' : ''}`}>
              {a.steps[s.key]}
              <span className="sr-only"> – {s.state === 'done' ? a.stateDone : s.state === 'current' ? a.stateCurrent : a.stateTodo}</span>
            </span>
            {d && (
              <span className={`max-w-[45%] truncate text-right text-sm tabular-nums ${s.state === 'current' ? 'text-fg' : 'text-muted'}`} title={d}>{d}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

async function Waiting({ view, verified, verifyError }: { view: CheckView; verified: boolean; verifyError: string | null }) {
  const { t } = await getI18n();
  const c = t.check;
  const verifyMsg = verifyError === 'code_expired' ? c.verify.expired : verifyError ? c.verify.invalid : null;
  const finishing = view.progress.analyzing || view.progress.recommending;
  const canNotify = ['discovering', 'queued', 'measuring', 'awaiting_email'].includes(view.status);
  return (
    <div className="space-y-6" data-testid={`check-${view.status}`}>
      {verified && <p role="status" className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{c.verify.ok}</p>}
      {verifyMsg && <p role="alert" className="rounded-xl bg-subtle px-4 py-3 text-sm">{verifyMsg}</p>}
      <section aria-labelledby="agent-title" className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-muted">{c.freeCheck} · {view.domain}</p>
          <p className="text-[13px] tabular-nums text-muted">{c.agent.elapsed(elapsedText(view.createdAt))}</p>
        </div>
        <h1 id="agent-title" className="mt-2 text-[1.5rem] font-semibold leading-tight tracking-tight">{finishing ? c.agent.titleDone : c.agent.title}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{view.status === 'queued' && !view.progress.engines.length ? c.agent.queued : c.agent.text}</p>
        <div className="mt-5" aria-live="polite"><AgentChecklist view={view} /></div>
        <p className="mt-4 text-[13px] text-muted">{c.agent.refresh}</p>
      </section>

      {canNotify && (
        <section aria-labelledby="notify-title" className="rounded-2xl bg-card p-5 shadow-card">
          <h2 id="notify-title" className="text-[15px] font-semibold">{c.notify.title}</h2>
          {!view.emailVerified && <p className="mb-3 mt-0.5 text-[13px] text-muted">{c.notify.text}</p>}
          <div className={view.emailVerified ? 'mt-2' : ''}>
            <CheckNotifyForm token={view.token} siteKey={view.turnstileSiteKey} sentTo={verifyMsg ? null : view.emailMasked} confirmed={view.emailVerified} />
          </div>
        </section>
      )}
    </div>
  );
}

async function Problem({ view }: { view: CheckView }) {
  const c = (await getT()).check.states;
  const err = view.error ?? '';
  const title = view.status === 'blocked' ? c.blockedTitle : err === 'disabled' ? c.disabledTitle : err === 'rate_limited' ? c.rateLimitedTitle : c.failedTitle;
  const text = view.status === 'blocked' ? c.blockedText : c.errors[err] ?? c.errors.generic;
  return (
    <section className="rounded-3xl bg-card p-6 text-center shadow-card sm:p-10" data-testid={`check-${view.status}`}>
      <p className="text-sm text-muted">{view.domain}</p>
      <h1 className="mt-2 text-[1.5rem] font-semibold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-muted">{text}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {view.status !== 'blocked' && <Link href="/" className="btn btn-primary">{c.retry}</Link>}
        <a href={`mailto:${contactEmail()}`} className="btn">{c.contact}</a>
      </div>
    </section>
  );
}

async function Teaser({ view, canceled, verified }: { view: CheckView; canceled: boolean; verified: boolean }) {
  const { t, f, locale } = await getI18n();
  const c = t.check.teaser;
  const s = view.summary!;
  // gleiche Kennzahl wie der Bericht (Anteil der Antworten mit Nennung), mit Spanne; zu kleine Stichprobe → kein Wert
  const est = visibilityEstimate(s, CHECK_SCOPE.minResponsesForScore);
  const verdict = est.score !== null ? scoreVerdict(est.score, locale) : null;
  const free = view.freeRecommendations.slice(0, CHECK_SCOPE.freeRecommendations);
  const locked = lockedCount(s, free.length);
  const ownDomain = cleanDomain(s.brand.domain);
  const logoDomains = ownDomain ? await domainsWithLogo([ownDomain]) : new Set<string>();
  const logo = ownDomain && logoDomains.has(ownDomain) ? `/check/${view.token}/logo/${encodeURIComponent(ownDomain)}` : null;
  const chatgptPrompts = Math.min(s.prompts, CHECK_SCOPE.engineMaxPrompts.chatgpt ?? s.prompts);

  return (
    <div className="space-y-10" data-testid="check-ready">
      {canceled && <p role="status" className="rounded-xl bg-subtle px-4 py-3 text-sm">{t.buy.canceled}</p>}
      {verified && <p role="status" className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{t.check.verify.okReady}</p>}
      {/* Kopf + Sichtbarkeitswert */}
      <section aria-labelledby="teaser-title" className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-3">
          <BrandMark name={s.brand.name} src={logo} size={32} own />
          <div className="min-w-0">
            <h1 id="teaser-title" className="text-[1.375rem] font-semibold leading-tight tracking-tight sm:text-[1.75rem]">{c.title(s.brand.name)}</h1>
            <p className="text-[13px] text-muted">{view.domain} · {c.sampleFrom(f.date(view.readyAt ?? view.createdAt, false))}</p>
          </div>
        </div>
        {est.simulated && (
          <p role="note" className="mt-4 rounded-xl bg-subtle px-4 py-3 text-sm" data-testid="teaser-simulated">{c.simulatedNote}</p>
        )}
        <div className="mt-6 flex flex-col items-center gap-6 text-center sm:flex-row sm:gap-10 sm:text-left">
          {est.score !== null && verdict && (
            <div className="flex shrink-0 flex-col items-center gap-2">
              <ScoreRing score={est.score} tone={verdict.tone} />
              <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[13px] font-medium text-muted">{est.simulated ? c.simulated : c.sample}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm text-muted">
              {c.score}{est.score !== null && <> · {c.approx} {est.score} {c.of100}</>}<Hint>{c.scoreHint}</Hint>
            </p>
            {verdict && (
              <p className="mt-1 inline-flex items-center gap-2.5 text-[1.75rem] font-semibold leading-tight tracking-tight">
                <span aria-hidden className="inline-block size-3 rounded-full" style={{ background: toneColor(verdict.tone) }} />{verdict.label}
              </p>
            )}
            <p className="mt-2 text-[17px]" data-testid="teaser-named">{c.namedIn(est.mentioned, est.responses)}</p>
            {est.range && <p className="mt-1 text-[15px]" data-testid="teaser-range">{c.range(est.range.low, est.range.high)}</p>}
            {est.mentioned === 0 && <p className="mt-1 text-sm text-muted">{c.noneNamed}</p>}
            {est.score === null && <p className="mt-1 text-sm text-muted">{c.tooFew}</p>}
            <p className="mt-3 text-sm text-muted" data-testid="teaser-caveat">
              {c.caveat(s.prompts, REPORT_SCOPE.strategy.prompts, REPORT_SCOPE.strategy.repetitions, REPORT_SCOPE.strategy.engines.length)}
            </p>
          </div>
        </div>
      </section>

      {/* Maßnahmen: Zahl, genau eine vollständig, der Rest gesperrt – ohne Titel oder Text */}
      <section aria-labelledby="t-recs">
        <h2 id="t-recs" className="text-[1.375rem] font-semibold tracking-tight" data-testid="teaser-recs-total">
          {s.recommendationsTotal > 0 ? c.recsFound(s.recommendationsTotal) : c.recsNone}
        </h2>
        {free.length > 0 && (
          <>
            <h3 className="mb-3 mt-4 text-sm font-medium text-muted">{c.free}</h3>
            <div>{free.map((r) => <TeaserRecCard key={r.id} rec={r} />)}</div>
          </>
        )}
        {locked > 0 && (
          <div className="relative mt-4 overflow-hidden rounded-2xl bg-card p-6 shadow-card" data-testid="teaser-locked">
            <div aria-hidden className="space-y-3 opacity-60">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="h-8 w-1 rounded-full bg-subtle" />
                  <span className="h-3 rounded-full bg-subtle" style={{ width: `${[62, 48, 55][i]}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-[17px] font-semibold">
                  <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  {c.locked(locked)}
                </p>
                <p className="mt-0.5 text-sm text-muted">{c.lockedText}</p>
              </div>
              <a href="#kaufen" className="btn btn-primary shrink-0">{c.lockedCta}</a>
            </div>
          </div>
        )}
      </section>

      <BuyOptions checkToken={view.token} />

      <section aria-labelledby="t-method" className="rounded-2xl bg-subtle/60 p-5 text-sm">
        <h2 id="t-method" className="font-medium">{c.method}</h2>
        <p className="mt-1 text-muted">{c.methodText(s.prompts, chatgptPrompts, s.responses)}</p>
      </section>
    </div>
  );
}
