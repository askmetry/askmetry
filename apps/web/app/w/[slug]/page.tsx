import Link from 'next/link';
import { eq, sql } from 'drizzle-orm';
import { db, prompt } from '@opengeo/db';
import { buildStatusBrief, keyInsight, loadRecData, pickTopRecommendations, rankingFrom } from '@opengeo/core';
import { buildClaudePrompt, CATEGORIES, categoryOf, scoreVerdict, type RecCategory } from '@opengeo/core/present';
import { ActionForm } from '@/components/action-form';
import { BrandProfileBanner } from '@/components/brand-profile';
import { BrandMark } from '@/components/brand-mark';
import { CopyButton } from '@/components/copy-button';
import { RecCard, RecHero } from '@/components/rec-card';
import { EmptyState, Hint } from '@/components/ui';
import { CAT_STYLE, CategoryIcon, Dot, ScoreRing, toneColor } from '@/components/viz';
import { startCollection } from '@/lib/actions/settings';
import { workspaceContext } from '@/lib/context';
import { logoMap } from '@/lib/logos';
import { fmtDate, fmtPct } from '@/lib/format';
import { brandMetrics, engineLabel, groupBy, loadBase, sortEngines } from '@/lib/metrics';
import { loadRecs, promptContext } from '@/lib/recs-data';
import { fillLevel, toScore, topWithOwn } from '@/lib/view';

export const metadata = { title: 'Übersicht' };

const CAT_ORDER = (Object.keys(CATEGORIES) as RecCategory[]).sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order);

const Section = ({ title, hint, children, aside }: { title: string; hint?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) => (
  <section>
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}{hint}</h2>
      {aside}
    </div>
    {children}
  </section>
);

export default async function Uebersicht({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await workspaceContext(slug, {});
  const { ws, own, brands, selected, previous, all, canEdit } = ctx;
  const running = all.find((c) => c.status === 'queued' || c.status === 'running');

  if (!own) {
    return <EmptyState title="Noch keine eigene Marke" action={{ href: `/w/${slug}/settings/marke`, label: 'Marke anlegen' }}>Lege deine Marke mit Website an – dann messen wir, wie oft KI-Suchen dich nennen.</EmptyState>;
  }
  if (!selected) {
    if (running) {
      return (
        <EmptyState title="Die erste Messung läuft" action={{ href: `/w/${slug}/settings/messung`, label: 'Status ansehen' }}>
          Sobald sie fertig ist, siehst du hier, wie sichtbar du in KI-Suchen bist und was du tun kannst.
        </EmptyState>
      );
    }
    // Neuer Workspace: drei Schritte bis zur ersten Messung, abgehakt nach echtem Stand
    const [pr] = await db.select({ n: sql<number>`count(*) filter (where ${prompt.active})::int` }).from(prompt).where(eq(prompt.workspaceId, ws.id));
    const steps = [
      { done: brands.some((b) => !b.isOwn), label: 'Wettbewerber ergänzen', text: 'Mit wem willst du dich vergleichen?', href: `/w/${slug}/settings/wettbewerber` },
      { done: (pr?.n ?? 0) > 0, label: 'Fragen anlegen', text: 'Was fragt deine Zielgruppe eine KI?', href: `/w/${slug}/settings/fragen` },
      { done: false, label: 'Erste Messung starten', text: 'Wir fragen ChatGPT, Gemini, Claude und Google.', href: `/w/${slug}/settings/messung` },
    ];
    return (
      <div className="mx-auto max-w-xl space-y-6" data-testid="onboarding">
        <div className="flex items-center gap-4">
          <BrandMark name={own.name} src={(await logoMap(slug, [own])).get(own.name.toLowerCase())} size={40} own />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{own.name}</h1>
            <p className="text-sm text-muted">{canEdit ? `Noch ${steps.filter((x) => !x.done).length === 1 ? 'ein Schritt' : `${steps.filter((x) => !x.done).length} Schritte`} bis zur ersten Messung.` : 'Noch keine Messung. Einrichten kann das jemand mit Bearbeitungsrechten.'}</p>
          </div>
        </div>
        <BrandProfileBanner slug={slug} own={own} canEdit={canEdit} />
        {canEdit && <ol className="divide-y divide-border rounded-2xl bg-card shadow-card">
          {steps.map((st, i) => (
            <li key={st.label}>
              <Link href={st.href} className="flex items-center gap-4 px-5 py-4 hover:bg-subtle/60">
                <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${st.done ? 'bg-good text-white' : 'bg-subtle text-muted'}`}>{st.done ? '✓' : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium ${st.done ? 'text-muted line-through decoration-1' : ''}`}>{st.label}</span>
                  <span className="block text-sm text-muted">{st.text}</span>
                </span>
                <span aria-hidden className="text-accent">→</span>
              </Link>
            </li>
          ))}
        </ol>}
      </div>
    );
  }

  const [base, prevBase, recs, insight, brief, recData, logos] = await Promise.all([
    loadBase(ws.id, [selected.id]),
    previous ? loadBase(ws.id, [previous.id]) : null,
    loadRecs(ws.id),
    keyInsight(ws.id).catch(() => null),
    buildStatusBrief(ws.id).catch(() => ''),
    loadRecData(ws.id, selected.id),
    logoMap(slug, brands),
  ]);
  const m = brandMetrics(base.resps, base.ments, base.cits, own);
  const pm = prevBase ? brandMetrics(prevBase.resps, prevBase.ments, prevBase.cits, own) : null;
  const score = toScore(m.visibility);
  const verdict = scoreVerdict(score);
  const delta = pm && pm.visibility !== null ? score - toScore(pm.visibility) : null;

  // Rangliste aus Core (gleiche Logik wie Analyse und Lagebericht): getrackte Marken + wahrscheinliche Wettbewerber
  const ranking = topWithOwn(rankingFrom(recData).rows, 5);
  const leader = ranking.rows.find((r) => !r.own && r.responses > 0);
  const maxResp = Math.max(1, ...ranking.rows.map((r) => r.responses));
  const placement = leader && leader.responses > m.mentioned
    ? `In ${m.mentioned} von ${m.n} Antworten genannt – ${leader.name} in ${leader.responses}.`
    : `In ${m.mentioned} von ${m.n} Antworten genannt${leader ? ` – öfter als ${leader.name} (${leader.responses})` : ''}.`;

  const byEngine = groupBy(base.resps, (r) => r.engine);
  const engines = sortEngines(byEngine.keys()).map((e) => ({ e, rate: brandMetrics(byEngine.get(e)!, base.ments, base.cits, own).visibility }));

  const current = recs.filter((r) => r.active && (r.status === 'open' || r.status === 'in_progress'));
  const top = pickTopRecommendations(current, 3);
  const pctx = promptContext(ws, brands);
  const catCount = new Map<RecCategory, number>();
  for (const r of current) catCount.set(categoryOf(r.type), (catCount.get(categoryOf(r.type)) ?? 0) + 1);

  return (
    <div className="space-y-12">
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-4">
          <BrandMark name={own.name} src={logos.get(own.name.toLowerCase())} size={40} own />
          <div>
          <h1 className="text-2xl font-semibold tracking-tight">{own.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>Gemessen am {fmtDate(selected.finishedAt ?? selected.createdAt, false)}</span>
            {running ? <span>· Neue Messung läuft …</span> : canEdit && (
              <>
                <span aria-hidden>·</span>
                <ActionForm action={startCollection} slug={slug} submit="Neu messen" inline className="contents"
                  submitClass="text-sm text-accent hover:underline disabled:opacity-50" />
              </>
            )}
          </div>
          </div>
        </div>
        {brief && <CopyButton text={brief} label="Lagebericht kopieren" className="btn" testId="copy-brief" />}
      </div>

      <BrandProfileBanner slug={slug} own={own} canEdit={canEdit} />

      {/* Hero */}
      <section aria-label="KI-Sichtbarkeit" className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:gap-10 sm:text-left">
          <ScoreRing score={score} tone={verdict.tone} />
          <div className="min-w-0">
            <p className="text-sm text-muted">KI-Sichtbarkeit<Hint>Wie oft KI-Suchen dich nennen, wenn deine Fragen gestellt werden – 0 bis 100. Ein Wert von 4 heißt: in 4 % der Antworten.</Hint></p>
            <p className="mt-1 inline-flex items-center gap-2.5 text-[2rem] font-semibold leading-tight tracking-tight">
              <span aria-hidden className="inline-block size-3 rounded-full" style={{ background: toneColor(verdict.tone) }} />{verdict.label}
            </p>
            <p className="mt-2 text-lg">{placement}</p>
            <p className="mt-2 text-sm text-muted">
              {delta === null ? 'Erste Messung – ab der nächsten siehst du hier die Veränderung.'
                : delta === 0 ? `Unverändert seit der Messung am ${fmtDate(previous!.finishedAt ?? previous!.createdAt, false)}.`
                : <span className={delta > 0 ? 'text-good' : 'text-bad'}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)} {Math.abs(delta) === 1 ? 'Punkt' : 'Punkte'} seit der Messung am {fmtDate(previous!.finishedAt ?? previous!.createdAt, false)}</span>}
            </p>
          </div>
        </div>
        {insight && insight.kind !== 'none' && (
          <p className="mt-6 rounded-2xl bg-accent-soft px-4 py-3 text-sm sm:px-5" data-testid="insight">
            <b className="font-semibold">Wichtigste Erkenntnis:</b> {insight.text}
          </p>
        )}
      </section>

      {/* KI-Suchen */}
      <Section title="In den KI-Suchen" hint={<Hint>○ nie genannt · ◐ teils · ● oft. Die Zahl ist der Anteil der Antworten mit deiner Marke.</Hint>}>
        <ul className="flex flex-wrap gap-2.5">
          {engines.map(({ e, rate }) => (
            <li key={e} className="flex items-center gap-2 rounded-full bg-card px-3.5 py-2 text-sm shadow-card">
              <Dot fill={fillLevel(rate)} />
              <span>{engineLabel(e)}</span>
              <span className="tabular-nums text-muted">{fmtPct(rate)}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Ranking */}
      <Section title="Wer in der KI-Suche vorne liegt" aside={<Link href={`/w/${slug}/analyse`} className="text-sm text-accent hover:underline">Alle Marken →</Link>}>
        <ol className="space-y-2.5 rounded-2xl bg-card p-5 shadow-card sm:p-6">
          {ranking.rows.map((r, i) => (
            <li key={r.name} className={`grid grid-cols-[1.5rem_minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[2rem_14rem_1fr_4rem] ${ranking.ownExtra && i === ranking.rows.length - 1 ? 'mt-3 border-t border-border pt-3' : ''}`}>
              <span className="tabular-nums text-muted">{r.place}.</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <BrandMark name={r.name} src={logos.get(r.name.toLowerCase())} own={r.own} />
                <span className={`truncate ${r.own ? 'font-semibold' : ''}`}>{r.own ? `${r.name} (du)` : r.name}</span>
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${Math.max(r.responses ? 2 : 0, (r.responses / maxResp) * 100)}%`, background: r.own ? 'var(--accent)' : 'var(--faint)' }} />
              </span>
              <span className="text-right tabular-nums text-muted" title={`in ${r.responses} von ${m.n} Antworten genannt`}>{r.responses}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">Anzahl der Antworten, in denen die Marke genannt wird (von {m.n}).</p>
      </Section>

      {/* Maßnahmen */}
      <Section title="Das bringt dich nach vorn" aside={current.length > 0 ? <Link href={`/w/${slug}/massnahmen`} className="text-sm text-accent hover:underline">Alle {current.length} Maßnahmen →</Link> : undefined}>
        {top.length === 0 ? (
          <p className="rounded-2xl bg-card px-5 py-8 text-center text-sm text-muted shadow-card">Gerade gibt es keine offenen Maßnahmen. Neue entstehen nach jeder Messung.</p>
        ) : (
          <>
            <RecHero rec={top[0]!} slug={slug} prompt={buildClaudePrompt(top[0]!, pctx)} />
            {top.length > 1 && (
              <>
                <h3 className="mb-3 mt-6 text-sm font-medium text-muted">Danach</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {top.slice(1).map((r) => <RecCard key={r.id} rec={r} slug={slug} prompt={buildClaudePrompt(r, pctx)} />)}
                </div>
              </>
            )}
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>Nach Art:</span>
              {CAT_ORDER.filter((c) => catCount.get(c)).map((c) => (
                <Link key={c} href={`/w/${slug}/massnahmen#${c}`} className={`inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5 shadow-card hover:underline ${CAT_STYLE[c].text}`}>
                  <CategoryIcon cat={c} size={14} />{CATEGORIES[c].label} <span className="tabular-nums">{catCount.get(c)}</span>
                </Link>
              ))}
            </p>
          </>
        )}
      </Section>

      {/* Tiefer einsteigen */}
      <Section title="Tiefer einsteigen">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { href: `/w/${slug}/analyse`, title: 'Ergebnisse je KI-Suche', text: 'Alle Kennzahlen, Verlauf und Marken im Vergleich' },
            { href: `/w/${slug}/quellen`, title: 'Quellen', text: 'Welche Websites die KIs lesen und zitieren' },
            { href: `/w/${slug}/fragen?ohne=1`, title: 'Fragen ohne dich', text: 'Fragen, bei denen dich keine KI-Suche nennt' },
          ].map((t) => (
            <Link key={t.href} href={t.href} className="shadow-card shadow-card-hover rounded-2xl bg-card px-5 py-4 transition-shadow">
              <span className="block font-medium">{t.title} <span className="text-accent">→</span></span>
              <span className="mt-0.5 block text-sm text-muted">{t.text}</span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
