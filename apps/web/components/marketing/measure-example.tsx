// Abschnitt „Maßnahmen“ der Startseite: Arten von Maßnahmen + eine ausführliche Beispiel-Maßnahme (erfundene Marke). Reines HTML/SVG.
import type { Messages } from '@/lib/i18n/messages';
import { CAT_STYLE, ExampleBadge } from './report-preview';

type M = Messages['marketing'];

function CatIcon({ cat, size = 14 }: { cat: string; size?: number }) {
  const s = CAT_STYLE[cat] ?? CAT_STYLE.content!;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">{s.icon}</svg>
  );
}

/** Liste typischer Maßnahmen-Arten (links neben der Beispielkarte). */
export function MeasureKinds({ t }: { t: M }) {
  const m = t.measure;
  return (
    <div>
      <h3 className="text-sm font-medium text-muted">{m.kindsTitle}</h3>
      <ul className="mt-4 space-y-5">
        {m.kinds.map((k) => {
          const s = CAT_STYLE[k.cat] ?? CAT_STYLE.content!;
          return (
            <li key={k.title} className="flex gap-3.5">
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: s.soft, color: s.color }}>
                <CatIcon cat={k.cat} size={20} />
              </span>
              <div>
                <p className="text-lg font-semibold leading-snug">{k.title}</p>
                <p className="mt-1 text-muted">{k.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-8 border-l-2 border-accent pl-4 text-[15px] text-muted">{m.basis}</p>
      <p className="mt-3 border-l-2 border-accent pl-4 text-[15px] font-medium">{m.plan}</p>
    </div>
  );
}

/** Eine Maßnahme so, wie sie im Bericht steht: Begründung, Schritte, Aufwand, Prompt. */
export function MeasureCard({ t }: { t: M }) {
  const c = t.measure.card;
  const s = CAT_STYLE[c.cat] ?? CAT_STYLE.content!;
  const catName = t.get.cats[c.cat as keyof typeof t.get.cats];
  return (
    <figure aria-label={`${c.label} – ${t.preview.badge}`} className="relative overflow-hidden rounded-3xl bg-card p-5 shadow-card sm:p-7">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: s.color }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{c.label}</p>
        <ExampleBadge>{t.preview.badge}</ExampleBadge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: s.soft, color: s.color }}>
          <CatIcon cat={c.cat} />{catName}
        </span>
        <span className="rounded-full bg-subtle px-2.5 py-1 text-muted">{c.rank}</span>
      </div>
      <h3 className="mt-3 text-xl font-semibold leading-snug sm:text-[1.375rem]">{c.title}</h3>
      <dl className="mt-3 flex flex-wrap gap-2 text-sm">
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-good/10 px-2.5 py-1 font-medium text-good">
          <dt className="sr-only">{c.impactLabel}</dt>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></svg>
          <dd>{c.impact}</dd>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-subtle px-2.5 py-1 font-medium text-muted">
          <dt className="sr-only">{c.effortLabel}</dt>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          <dd>{c.effort}</dd>
        </div>
      </dl>

      <div className="mt-5">
        <p className="text-sm font-semibold">{c.whyTitle}</p>
        <p className="mt-1 text-[15px] text-muted">{c.why}</p>
      </div>

      <div className="mt-5">
        <p className="text-sm font-semibold">{c.stepsTitle}</p>
        <ol className="mt-2 space-y-2">
          {c.steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-[15px]">
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-5 rounded-2xl bg-bg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{c.promptTitle}</p>
          <span aria-hidden className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
            {t.get.copyPrompt}
          </span>
        </div>
        <p className="mt-2 font-mono text-[13px] leading-relaxed text-muted">{c.prompt}</p>
      </div>

      <p className="mt-5 flex gap-2 text-sm font-medium text-accent">
        <span aria-hidden>→</span>{c.goal}
      </p>
    </figure>
  );
}
