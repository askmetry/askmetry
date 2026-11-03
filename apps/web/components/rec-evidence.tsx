'use client';
import Link from 'next/link';
import { engineName } from '@opengeo/core/present';
import { useI18n } from '@/lib/i18n/client';
import { plainTerms } from '@/lib/text';
import { metricText, trend, type MetricSnap, type RecEvidence } from '@/lib/recommendations';

const shortUrl = (u: string) => {
  try {
    const x = new URL(u);
    return decodeURIComponent(`${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`).replace(/\/$/, '');
  } catch {
    return u;
  }
};
const goodTitle = (t: string | null, url: string) => !!t && !url.includes(t.replace(/^www\./, '')) && !/^Thread in r\//.test(t);

const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 text-xs font-medium text-muted">{children}</h3>;

/** Fortschritt „vorher → jetzt“ als zwei Balken. */
export function Progress({ before, now }: { before: MetricSnap; now: MetricSnap }) {
  const { locale, t: msg, f } = useI18n();
  const tx = msg.recs.progress;
  const t = trend(before, now);
  const bar = (m: MetricSnap, strong: boolean) => (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
      <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (m.value ?? 0) * 100)}%`, background: strong ? 'var(--fg)' : 'var(--faint)' }} />
    </div>
  );
  return (
    <div>
      <p className="mb-3 text-sm text-muted">{plainTerms(now.label, locale)}</p>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-3"><span className="w-24 shrink-0 text-muted">{tx.before}</span>{bar(before, false)}<span className="w-14 text-right tabular-nums">{f.pct(before.value)}</span></div>
        {metricText(before, locale) && <p className="-mt-1 pl-[6.75rem] text-xs text-muted">{plainTerms(metricText(before, locale)!, locale)}</p>}
        <div className="flex items-center gap-3"><span className="w-24 shrink-0 text-muted">{tx.now}</span>{bar(now, true)}<span className="w-14 text-right font-semibold tabular-nums">{f.pct(now.value)}</span></div>
        {metricText(now, locale) && <p className="-mt-1 pl-[6.75rem] text-xs text-muted">{plainTerms(metricText(now, locale)!, locale)}</p>}
      </div>
      <p className="mt-3 text-sm">
        {t === 'better' && <span className="text-good">{tx.better}</span>}
        {t === 'worse' && <span className="text-bad">{tx.worse}</span>}
        {(t === 'same' || t === null) && <span className="text-muted">{tx.same}</span>}
      </p>
    </div>
  );
}

/** Belege einer Maßnahme (für die Detailansicht, eingeklappt). */
export function Evidence({ ev, type, slug }: { ev: RecEvidence; type: string; slug: string }) {
  const { locale, t: msg } = useI18n();
  const t = msg.recs.evidence;
  const q = msg.recs.quote;
  const linked = new Set(ev.examples.map((e) => e.promptId).filter(Boolean));
  const otherPrompts = ev.prompts.filter((p) => !linked.has(p.id));
  const href = (id: string, engine?: string | null) => `/w/${slug}/fragen/${id}${engine ? `#${engine}` : ''}`;
  return (
    <div className="space-y-6">
      {ev.urls.length > 0 && (
        <div>
          <H>{t.urlHeading[type] ?? t.pages}{ev.source ? t.inSource(ev.source) : ''}</H>
          <ul className="space-y-1.5 text-sm">
            {ev.urls.slice(0, 8).map((u) => (
              <li key={u.url} className="flex min-w-0 items-baseline gap-2">
                <a href={u.url} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate text-accent hover:underline" title={u.url}>{goodTitle(u.title, u.url) ? u.title : shortUrl(u.url)}</a>
                {u.count !== null && u.count > 1 && <span className="shrink-0 text-xs text-muted">{u.count}×</span>}
                {u.kind === 'searched' && <span className="shrink-0 text-xs text-muted" title={t.readOnlyHint}>{t.readOnly}</span>}
              </li>
            ))}
            {ev.urls.length > 8 && <li className="text-xs text-muted">{t.more(ev.urls.length - 8)}</li>}
          </ul>
        </div>
      )}
      {ev.competitors.length > 0 && (
        <div>
          <H>{t.namedInstead}</H>
          <p className="text-sm">{ev.competitors.slice(0, 6).map((c) => `${c.name}${c.count ? ` (${c.count}×)` : ''}`).join(' · ')}</p>
        </div>
      )}
      {ev.examples.length > 0 && (
        <div>
          <H>{t.fromAnswers}</H>
          <ul className="space-y-2">
            {ev.examples.slice(0, 5).map((e, i) => (
              <li key={i} className="rounded-xl bg-subtle px-3.5 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  {e.prompt ? (e.promptId
                    ? <Link href={href(e.promptId, e.engine)} className="font-medium hover:text-accent hover:underline">{q(e.prompt)}</Link>
                    : <span className="font-medium">{q(e.prompt)}</span>) : <span />}
                  {e.engine && <span className="shrink-0 text-xs text-muted">{engineName(e.engine, locale)}</span>}
                </div>
                {e.url && <a href={e.url} target="_blank" rel="noreferrer noopener" className="mt-0.5 block truncate text-xs text-accent hover:underline" title={e.url}>{goodTitle(e.title, e.url) ? `${e.title} · ` : ''}{shortUrl(e.url)}</a>}
                {e.snippet && <p className="mt-1 text-xs text-muted">… {e.snippet} …</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {otherPrompts.length > 0 && (
        <div>
          <H>{linked.size ? t.moreQuestions : t.questions}</H>
          <ul className="space-y-1 text-sm">
            {otherPrompts.slice(0, 8).map((p) => (
              <li key={p.id}>
                <Link href={href(p.id)} className="hover:text-accent hover:underline">{q(p.text)}</Link>
                {p.missing.length > 0 && <span className="ml-1.5 text-xs text-muted">{t.missingIn(p.missing.map((e) => engineName(e, locale)).join(', '))}</span>}
              </li>
            ))}
            {otherPrompts.length > 8 && <li className="text-xs text-muted">{t.more(otherPrompts.length - 8)}</li>}
          </ul>
        </div>
      )}
      {!ev.urls.length && !ev.competitors.length && !ev.examples.length && !otherPrompts.length && <p className="text-sm text-muted">{t.none}</p>}
    </div>
  );
}
