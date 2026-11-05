// Nachgebaute Ausschnitte eines Berichts mit erfundener Beispielmarke (keine echten Kundendaten). Reines SVG/HTML, kein JS.
import type { Messages } from '@/lib/i18n/messages';

type M = Messages['marketing'];

// Beispielwerte (passen zusammen: 36 von 300 Antworten = 12; Ø der fünf KI-Suchen = 12)
const SCORE = 12;
const ENGINES = [
  { key: 'chatgpt', v: 0.08 },
  { key: 'claude', v: 0.04 },
  { key: 'gemini', v: 0.15 },
  { key: 'google_aio', v: 0.18 },
  { key: 'google_ai_mode', v: 0.15 },
] as const;
const RANKING = [
  { who: 'A', v: 62 },
  { who: 'B', v: 41 },
  { who: 'C', v: 23 },
  { who: 'you', v: SCORE },
] as const;

function Ring({ value, label }: { value: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`${label}: ${value} / 100`} className="shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--subtle)" strokeWidth="8" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--warn)" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="50" textAnchor="middle" fontSize="22" fontWeight="650" fill="var(--fg)">{value}</text>
    </svg>
  );
}

/** Füllpunkt wie in der App: ○ nie, ◐ teils, ● oft */
function Dot({ v }: { v: number }) {
  const fill = v === 0 ? 'none' : v < 0.25 ? 'half' : 'full';
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      <circle cx="6" cy="6" r="5" fill="none" stroke="var(--own)" strokeWidth="1.5" />
      {fill === 'half' && <path d="M6 1 A5 5 0 0 0 6 11 Z" fill="var(--own)" />}
      {fill === 'full' && <circle cx="6" cy="6" r="5" fill="var(--own)" />}
    </svg>
  );
}

export function ExampleBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-comp-soft px-2.5 py-0.5 text-xs font-medium text-warn">
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" strokeLinecap="round" /></svg>
      {children}
    </span>
  );
}

/** Übersicht eines Beispielberichts: Score, Einordnung, KI-Suchen, Rangliste. */
export function OverviewPreview({ t, pct }: { t: M; pct: (x: number) => string }) {
  const p = t.preview;
  return (
    <figure aria-label={p.badge} className="relative rounded-3xl bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap-reverse items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-[22%] bg-own-soft text-sm font-semibold text-own">N</span>
          <div>
            <p className="text-sm font-semibold leading-tight">{p.brand}</p>
            <p className="text-xs text-muted">{p.measured}</p>
          </div>
        </div>
        <ExampleBadge>{p.badge}</ExampleBadge>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <Ring value={SCORE} label={p.score} />
        <div>
          <p className="text-xs text-muted">{p.score}</p>
          <p className="text-lg font-semibold text-warn">{p.verdict}</p>
          <p className="mt-0.5 text-sm text-muted">{p.sentence}</p>
        </div>
      </div>

      <p className="mt-5 text-xs font-medium text-muted">{p.engines}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {ENGINES.map((e) => (
          <li key={e.key} className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-xs">
            <Dot v={e.v} />
            <span>{p.engineNames[e.key]}</span>
            <span className="font-medium text-muted">{pct(e.v)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-xs font-medium text-muted">{p.ranking}</p>
      <ol className="mt-2 space-y-1.5">
        {RANKING.map((r) => {
          const own = r.who === 'you';
          return (
            <li key={r.who} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-sm">
              <span className={own ? 'font-semibold text-own' : 'text-fg'}>{own ? `${p.brand} (${p.you})` : p.competitor(r.who)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${r.v}%`, background: own ? 'var(--own)' : 'var(--faint)' }} />
              </span>
              <span className="num text-xs text-muted">{r.v}</span>
            </li>
          );
        })}
      </ol>

      <p className="mt-5 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm text-fg">
        <span className="font-semibold">→ </span>{p.insight}
      </p>
    </figure>
  );
}

const CAT_STYLE: Record<string, { color: string; soft: string; icon: React.ReactNode }> = {
  content: { color: 'var(--cat-content)', soft: 'var(--cat-content-soft)', icon: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" /> },
  external: { color: 'var(--cat-external)', soft: 'var(--cat-external-soft)', icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></> },
  community: { color: 'var(--cat-community)', soft: 'var(--cat-community-soft)', icon: <path d="M4 5h16v11H9l-5 4z" /> },
  tech: { color: 'var(--cat-tech)', soft: 'var(--cat-tech-soft)', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></> },
};

/** Drei Maßnahmen-Karten eines Beispielberichts. */
export function MeasuresPreview({ t }: { t: M }) {
  const g = t.get;
  return (
    <figure aria-label={t.preview.badge} className="rounded-3xl bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-semibold">{g.measures}</p>
        <ExampleBadge>{t.preview.badge}</ExampleBadge>
      </div>
      <ul className="mt-4 space-y-2.5">
        {g.recs.map((r) => {
          const cat = r.cat as keyof typeof g.cats;
          const s = CAT_STYLE[cat]!;
          return (
            <li key={r.title} className="relative overflow-hidden rounded-2xl bg-bg py-3 pl-4 pr-3">
              <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: s.color }} />
              <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: s.color }}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">{s.icon}</svg>
                {g.cats[cat]}
              </p>
              <div className="mt-1 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <p className="font-medium leading-snug">{r.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{r.meta}</p>
                </div>
                <span aria-hidden className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
                  {g.copyPrompt}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
