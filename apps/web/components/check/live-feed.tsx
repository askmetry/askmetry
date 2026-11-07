import { engineName } from '@askmetry/core/present';
import type { CheckView, LiveAnswer } from '@askmetry/core/hosted/types';
import { getI18n } from '@/lib/i18n/server';

/**
 * Warteansicht: was der Agent bisher herausgefunden hat – Marke und Kurzbeschreibung, Wettbewerber, die gemessenen
 * Fragen (einzeln eingeblendet) und live die ersten KI-Antworten mit den genannten Marken. Nur echte Zwischenstände aus
 * der Datenbank; die Seite pollt (AutoRefresh), neue Einträge blenden über `.reveal` ein (bestehende bleiben stehen).
 */
export async function LiveFeed({ view }: { view: CheckView }) {
  const { t, locale } = await getI18n();
  const l = t.check.live;
  const live = view.live;
  const brandName = view.progress.brandName;
  if (!live && !(view.status === 'discovering' && view.progress.stage === 'plan' && brandName)) return null;
  const totalAnswers = view.progress.engines.reduce((n, e) => n + e.total, 0);
  return (
    <section aria-labelledby="live-title" className="rounded-3xl bg-card p-6 shadow-card sm:p-8" data-testid="check-live">
      <h2 id="live-title" className="text-[17px] font-semibold tracking-tight">{l.title}</h2>
      <div className="mt-4 space-y-6" aria-live="polite">
        {brandName && (
          <div className="reveal" data-testid="live-brand">
            <p className="text-[13px] text-muted">{l.siteRead}</p>
            <p className="mt-0.5 text-[15px]"><span className="font-semibold">{brandName}</span>{live?.description && <span className="text-muted"> – {live.description}</span>}</p>
          </div>
        )}
        {!!live?.competitors.length && (
          <div className="reveal" data-testid="live-competitors">
            <p className="text-[13px] text-muted">{l.competitors}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {live.competitors.map((c, i) => (
                <li key={c} className="reveal rounded-full bg-subtle px-2.5 py-0.5 text-sm" style={{ animationDelay: `${i * 120}ms` }}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {!!live?.questions.length && (
          <div data-testid="live-questions">
            <p className="text-[13px] text-muted">{l.questions(live.questions.length)}</p>
            <ol className="mt-1.5 space-y-1">
              {live.questions.map((q, i) => (
                <li key={q} className="reveal flex gap-2.5 text-[15px]" style={{ animationDelay: `${i * 180}ms` }}>
                  <span aria-hidden className="w-4 shrink-0 text-right text-[13px] tabular-nums leading-6 text-muted">{i + 1}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{q}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {live && view.status === 'measuring' && (
          <div data-testid="live-answers">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[13px] text-muted">{l.answers}</p>
              {totalAnswers > 0 && live.answersTotal > 0 && <p className="text-[13px] tabular-nums text-muted">{l.answersCount(Math.min(live.answersTotal, totalAnswers), totalAnswers)}</p>}
            </div>
            {live.answers.length === 0
              ? <p className="mt-1.5 text-sm text-muted">{l.waitingAnswers}</p>
              : <ul className="mt-2 space-y-2.5">{live.answers.map((a) => <AnswerRow key={a.id} a={a} brand={brandName ?? ''} engine={engineName(a.engine, locale)} t={l} />)}</ul>}
          </div>
        )}
      </div>
    </section>
  );
}

function AnswerRow({ a, brand, engine, t }: { a: LiveAnswer; brand: string; engine: string; t: Awaited<ReturnType<typeof getI18n>>['t']['check']['live'] }) {
  return (
    <li className="reveal rounded-xl bg-subtle/60 px-3.5 py-2.5" data-answer={a.state} data-own={a.ownNamed || undefined}>
      <p className="text-[13px] text-muted"><span className="font-medium text-fg">{engine}</span> · <span className="[overflow-wrap:anywhere]">{a.question}</span></p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
        {a.state === 'pending' && <span className="text-muted">{t.pending}</span>}
        {a.state === 'empty' && <span className="text-muted">{t.empty}</span>}
        {a.state === 'analyzed' && (
          <>
            {a.brands.map((b) => (
              <span key={b.name} className={`rounded-full px-2 py-0.5 ${b.own ? 'bg-own-soft font-semibold text-own' : 'bg-card'}`}>{b.name}</span>
            ))}
            {!a.brands.length && <span className="text-muted">{t.noBrands}</span>}
            {!a.ownNamed && brand && (
              <span className="inline-flex items-center gap-1.5 text-muted" data-testid="live-not-named">
                <span aria-hidden className="inline-block size-3 rounded-full border-2 border-faint" />{t.notNamed(brand)}
              </span>
            )}
          </>
        )}
      </div>
    </li>
  );
}
