import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { domainsWithLogo } from '@askmetry/core';
import { engineName, scoreVerdict } from '@askmetry/core/present';
import type { CheckView } from '@askmetry/core/hosted/types';
import { AutoRefresh } from '@/components/auto-refresh';
import { BrandMark } from '@/components/brand-mark';
import { BuyOptions } from '@/components/check/buy-options';
import { CheckEmailForm } from '@/components/check/email-form';
import { TeaserRecCard } from '@/components/check/teaser-rec';
import { PublicShell } from '@/components/public-shell';
import { Hint } from '@/components/ui';
import { CategoryIcon, Dot, ScoreRing } from '@/components/viz';
import { CAT_STYLE, toneColor } from '@/components/viz-style';
import { categoryText } from '@askmetry/core/present';
import { getCheckView } from '@/lib/hosted/data';
import { contactEmail, isHosted } from '@/lib/hosted/server';
import { areaCounts, checkStep, cleanDomain, lockedCount, refreshSeconds, roughScore, strongestCompetitor, teaserRanking } from '@/lib/hosted/teaser';
import { getI18n, getT } from '@/lib/i18n/server';
import { fillLevel } from '@/lib/view';

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
  return (
    <PublicShell width={view.status === 'ready' ? 'max-w-[1080px]' : 'max-w-[720px]'}>
      {refresh && <AutoRefresh seconds={refresh} />}
      {view.status === 'ready' && view.summary ? <Teaser view={view} canceled={one(sp.checkout) === 'canceled'} />
        : ['failed', 'blocked'].includes(view.status) ? <Problem view={view} />
        : <Waiting view={view} verified={one(sp.bestaetigt) === '1'} verifyError={one(sp.fehler) || null} />}
    </PublicShell>
  );
}

/** Fortschritt in vier Schritten (Website · E-Mail · KI-Suchen · Ergebnis). */
async function Steps({ view }: { view: CheckView }) {
  const t = (await getT()).check.steps;
  const cur = checkStep(view.status);
  const labels = [t.read, t.email, t.measure, t.result];
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label={labels.join(' → ')}>
      {labels.map((l, i) => {
        const state = i < cur ? 'done' : i === cur ? 'current' : 'todo';
        return (
          <li key={l} className="min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
            <span aria-hidden className={`block h-1.5 rounded-full ${state === 'done' ? 'bg-accent' : state === 'current' ? 'animate-pulse bg-accent/60' : 'bg-subtle'}`} />
            <span className={`mt-2 block text-[13px] leading-tight ${state === 'todo' ? 'text-muted' : 'font-medium'}`}>
              {l}<span className="sr-only"> – {state === 'done' ? t.done : state === 'current' ? t.current : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

async function Waiting({ view, verified, verifyError }: { view: CheckView; verified: boolean; verifyError: string | null }) {
  const { t } = await getI18n();
  const c = t.check;
  const d = view.discovered;
  const verifyMsg = verifyError === 'code_expired' ? c.verify.expired : verifyError ? c.verify.invalid : null;
  return (
    <div className="space-y-8" data-testid={`check-${view.status}`}>
      <div>
        <p className="text-sm text-muted">{c.freeCheck} · {view.domain}</p>
        <div className="mt-4"><Steps view={view} /></div>
      </div>

      {view.status === 'discovering' && (
        <section aria-live="polite">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{c.discovering.title}</h1>
          <p className="mt-2 text-[15px] text-muted">{c.discovering.text}</p>
        </section>
      )}

      {view.status === 'discovering' && view.emailVerified && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{c.verify.okEarly}</p>}

      {/* E-Mail schon während der Discovery möglich – so geht keine Zeit verloren */}
      {(view.status === 'awaiting_email' || (view.status === 'discovering' && !view.emailVerified)) && (
        <section className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight">{c.email.title}</h1>
          <p className="mt-2 text-[15px] text-muted">{c.email.text}</p>
          {verifyMsg && <p role="alert" className="mt-4 rounded-xl bg-subtle px-4 py-3 text-sm">{verifyMsg}</p>}
          <div className="mt-5">
            <CheckEmailForm token={view.token} siteKey={view.turnstileSiteKey} sentTo={verifyMsg ? null : view.emailMasked} />
          </div>
        </section>
      )}

      {(view.status === 'queued' || view.status === 'measuring') && (
        <section aria-live="polite" className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
          {verified && <p className="mb-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">{c.verify.ok}</p>}
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight">{c.measuring.title}</h1>
          <p className="mt-2 text-[15px]">{view.status === 'queued' ? c.measuring.queued : ''} {c.measuring.text}</p>
          <p className="mt-3 text-sm text-muted">{c.measuring.mail}</p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
            <div className="h-full w-1/3 animate-[progress_1.6s_ease-in-out_infinite] rounded-full bg-accent" />
          </div>
          <p className="mt-2 text-[13px] text-muted">{c.measuring.refresh}</p>
        </section>
      )}

      {d && (
        <section aria-labelledby="found-title">
          <h2 id="found-title" className="mb-3 text-[17px] font-semibold tracking-tight">{c.discovering.found}</h2>
          <dl className="divide-y divide-border rounded-2xl bg-card shadow-card">
            <div className="px-5 py-4">
              <dt className="text-[13px] text-muted">{c.discovering.brand}</dt>
              <dd className="mt-0.5 font-medium">{d.brandName}</dd>
              {d.description && <dd className="mt-0.5 text-[15px] text-muted">{d.description}</dd>}
            </div>
            {d.competitors.length > 0 && (
              <div className="px-5 py-4">
                <dt className="text-[13px] text-muted">{c.discovering.competitors}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">{d.competitors.map((x) => <span key={x} className="rounded-full bg-subtle px-2.5 py-0.5 text-sm">{x}</span>)}</dd>
              </div>
            )}
            {d.prompts.length > 0 && (
              <div className="px-5 py-4">
                <dt className="text-[13px] text-muted">{c.discovering.questions}</dt>
                <dd>
                  <ul className="mt-1 space-y-1 text-[15px]">{d.prompts.slice(0, 4).map((p) => <li key={p}>{view.locale === 'de' ? `„${p}“` : `“${p}”`}</li>)}</ul>
                  {d.prompts.length > 4 && <p className="mt-1 text-[13px] text-muted">{c.discovering.moreQuestions(d.prompts.length - 4)}</p>}
                </dd>
              </div>
            )}
          </dl>
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

const Section = ({ title, id, hint, children }: { title: string; id: string; hint?: React.ReactNode; children: React.ReactNode }) => (
  <section aria-labelledby={id}>
    <h2 id={id} className="mb-4 text-[17px] font-semibold tracking-tight">{title}{hint}</h2>
    {children}
  </section>
);

async function Teaser({ view, canceled }: { view: CheckView; canceled: boolean }) {
  const { t, f, locale } = await getI18n();
  const c = t.check.teaser;
  const s = view.summary!;
  const score = roughScore(s.visibility);
  const verdict = scoreVerdict(score, locale);
  const top = strongestCompetitor(s);
  const ranking = teaserRanking(s);
  const maxN = Math.max(1, ...ranking.map((r) => r.promptsMentioned));
  const areas = areaCounts(s.recommendationCounts);
  const free = view.freeRecommendations.slice(0, 2);
  const locked = lockedCount(s, free.length);
  const domains = s.topDomains.slice(0, 3).map((d) => ({ ...d, clean: cleanDomain(d.domain) })).filter((d) => d.clean);
  const logoDomains = await domainsWithLogo([s.brand.domain, ...domains.map((d) => d.clean!)].map((d) => cleanDomain(d) ?? '').filter(Boolean));
  const logo = (d: string | null) => (d && logoDomains.has(d) ? `/check/${view.token}/logo/${encodeURIComponent(d)}` : null);
  const ownDomain = cleanDomain(s.brand.domain);

  return (
    <div className="space-y-12" data-testid="check-ready">
      {canceled && <p role="status" className="rounded-xl bg-subtle px-4 py-3 text-sm">{t.buy.canceled}</p>}
      {/* Kopf + Hauptzahl */}
      <section aria-labelledby="teaser-title" className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-3">
          <BrandMark name={s.brand.name} src={logo(ownDomain)} size={32} own />
          <div className="min-w-0">
            <h1 id="teaser-title" className="text-[1.375rem] font-semibold leading-tight tracking-tight sm:text-[1.75rem]">{c.title(s.brand.name)}</h1>
            <p className="text-[13px] text-muted">{view.domain} · {c.sampleFrom(f.date(view.readyAt ?? view.createdAt, false))}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-col items-center gap-6 text-center sm:flex-row sm:gap-10 sm:text-left">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <ScoreRing score={score} tone={verdict.tone} />
            <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[13px] font-medium text-muted">{c.sample}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted">{c.score} · {c.approx} {score} {c.of100}<Hint>{c.scoreHint}</Hint></p>
            <p className="mt-1 inline-flex items-center gap-2.5 text-[1.75rem] font-semibold leading-tight tracking-tight">
              <span aria-hidden className="inline-block size-3 rounded-full" style={{ background: toneColor(verdict.tone) }} />{verdict.label}
            </p>
            <p className="mt-2 text-[17px]" data-testid="teaser-named">
              {c.namedIn(s.promptsMentioned, s.prompts)}{top ? ` – ${c.competitorLine(top.name, top.promptsMentioned)}` : '.'}
            </p>
            {s.promptsMentioned === 0 && <p className="mt-1 text-sm text-muted">{c.noneNamed}</p>}
          </div>
        </div>
        {s.engines.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-[13px] text-muted">{c.engines}</p>
            <ul className="flex flex-wrap gap-2">
              {s.engines.map((e) => (
                <li key={e.engine} className="flex items-center gap-2 rounded-full bg-subtle px-3 py-1.5 text-sm">
                  <Dot fill={fillLevel(e.responses ? e.mentioned / e.responses : null)} />
                  <span>{engineName(e.engine, locale)}</span>
                  <span className="tabular-nums text-muted">{c.enginesValue(e.mentioned, e.responses)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid gap-12 md:grid-cols-2 md:gap-8">
        <Section title={c.ranking} id="t-ranking">
          <ol className="space-y-2.5 rounded-2xl bg-card p-5 shadow-card" data-testid="teaser-ranking">
            {ranking.map((r, i) => (
              <li key={r.name} className="grid grid-cols-[1.25rem_minmax(0,9rem)_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="tabular-nums text-muted">{i + 1}.</span>
                <span className={`truncate ${r.own ? 'font-semibold' : ''}`}>{r.own ? c.you(r.name) : r.name}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(r.promptsMentioned ? 3 : 0, (r.promptsMentioned / maxN) * 100)}%`, background: r.own ? 'var(--accent)' : 'var(--faint)' }} />
                </span>
                <span className="text-right tabular-nums text-muted">{r.promptsMentioned}/{s.prompts}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[13px] text-muted">{c.rankingNote(s.prompts)}</p>
        </Section>

        <Section title={c.domains} id="t-domains">
          {domains.length === 0 ? <p className="rounded-2xl bg-card p-5 text-sm text-muted shadow-card">{c.noDomains}</p> : (
            <ul className="divide-y divide-border rounded-2xl bg-card shadow-card" data-testid="teaser-domains">
              {domains.map((d) => (
                <li key={d.clean} className="flex items-center gap-3 px-5 py-3.5">
                  <BrandMark name={d.clean!} src={logo(d.clean)} size={24} own={d.clean === ownDomain} />
                  <a href={`https://${d.clean}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">{d.clean}</a>
                  <span className="text-sm tabular-nums text-muted">{c.domainsCount(d.count)}</span>
                </li>
              ))}
            </ul>
          )}
          {s.technical && (s.technical.robotsBlocksAi || s.technical.jsOnly) && (
            <div className="mt-4 rounded-2xl bg-card p-5 text-sm shadow-card">
              <p className="font-medium">{c.technical}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                {s.technical.robotsBlocksAi && <li>{c.robotsBlocks}</li>}
                {s.technical.jsOnly && <li>{c.jsOnly}</li>}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <Section title={c.recs} id="t-recs">
        <p className="-mt-2 mb-4 text-[15px] text-muted">{s.recommendationsTotal > 0 ? c.recsIntro(s.recommendationsTotal) : c.recsNone}</p>
        {areas.length > 0 && (
          <ul className="mb-6 flex flex-wrap gap-2" data-testid="teaser-areas">
            {areas.map((a) => (
              <li key={a.area} className={`inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-sm shadow-card ${CAT_STYLE[a.cat].text}`}>
                <CategoryIcon cat={a.cat} size={14} />{categoryText(a.cat, locale).label} <span className="tabular-nums font-semibold">{a.n}</span>
              </li>
            ))}
          </ul>
        )}
        {free.length > 0 && (
          <>
            <h3 className="mb-3 text-sm font-medium text-muted">{c.free}</h3>
            <div className="grid gap-4 md:grid-cols-2">{free.map((r) => <TeaserRecCard key={r.id} rec={r} />)}</div>
          </>
        )}
        {locked > 0 && (
          // gesperrter Block: bewusst ohne Titel oder Text einzelner Maßnahmen – nur die Zahl
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
      </Section>

      <BuyOptions checkToken={view.token} />

      <section aria-labelledby="t-method" className="rounded-2xl bg-subtle/60 p-5 text-sm">
        <h2 id="t-method" className="font-medium">{c.method}</h2>
        <p className="mt-1 text-muted">{c.methodText(s.prompts, s.responses)}</p>
      </section>
    </div>
  );
}
