'use client';
import Link from 'next/link';
import { categoryOf, localizeRec } from '@askmetry/core/present';
import { useI18n } from '@/lib/i18n/client';
import { CopyButton } from '@/components/copy-button';
import { CategoryTag, ImpactBadge } from '@/components/viz';
import { catStyle } from '@/components/viz-style';
import { firstSentence, plainTerms } from '@/lib/text';
import { statusLabel, type RecStatus } from '@/lib/recommendations';
import type { RecRow } from '@/lib/recs-data';

export type { RecRow };

const STATUS_DOT: Record<RecStatus, string> = { open: '', in_progress: 'var(--accent)', done: 'var(--good)', dismissed: 'var(--faint)' };

export function StatusDot({ status }: { status: RecStatus }) {
  const { locale, t } = useI18n();
  if (status === 'open') return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: STATUS_DOT[status] }} />
      {status === 'dismissed' ? t.recs.dismissed : statusLabel(status, locale)}
    </span>
  );
}

/**
 * Maßnahmen-Karte: höchstens 5 Zeilen. Ganze Karte öffnet die Detailansicht, der Button kopiert den KI-Prompt.
 * Texte werden hier in die UI-Sprache gebracht (localizeRec); `prompt` baut der Aufrufer (recPrompt in lib/recs-data).
 */
export function RecCard({ rec: raw, slug, prompt, hideCategory = false }: { rec: RecRow; slug: string; prompt: string; hideCategory?: boolean }) {
  const { locale, t } = useI18n();
  const rec = localizeRec(raw, locale);
  const cat = categoryOf(rec.type);
  return (
    <article data-rec={rec.id} data-status={rec.status}
      className="shadow-card shadow-card-hover relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card py-4 pl-5 pr-4 transition-shadow">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: catStyle(cat).fg }} />
      {(!hideCategory || rec.status !== 'open') && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {hideCategory ? <span /> : <CategoryTag cat={cat} />}
          <StatusDot status={rec.status} />
        </div>
      )}
      <h3 className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">
        <Link href={`/w/${slug}/massnahmen/${rec.id}`} className="after:absolute after:inset-0 after:content-[''] hover:text-accent">{plainTerms(rec.title, locale)}</Link>
      </h3>
      <p className="mt-1.5"><ImpactBadge impact={rec.impact} /></p>
      <div className="relative z-10 mt-auto pt-3">
        <CopyButton text={prompt} label={t.recs.card.copyPrompt} className="btn btn-sm" testId="copy-prompt" />
      </div>
    </article>
  );
}

/** Erste Maßnahme groß: „Fang hier an“ – Titel, Warum-Satz, Prompt kopieren, Details. */
export function RecHero({ rec: raw, slug, prompt }: { rec: RecRow; slug: string; prompt: string }) {
  const { locale, t } = useI18n();
  const rec = localizeRec(raw, locale);
  const cat = categoryOf(rec.type);
  return (
    <article data-rec={rec.id} data-status={rec.status} data-hero
      className="shadow-card relative flex min-w-0 flex-col overflow-hidden rounded-3xl bg-card py-6 pl-7 pr-6 sm:py-7 sm:pl-9 sm:pr-8">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: catStyle(cat).fg }} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{t.recs.card.startHere}</span>
        <CategoryTag cat={cat} />
      </div>
      <h3 className="mt-2 text-xl font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{plainTerms(rec.title, locale)}</h3>
      <p className="mt-2 max-w-2xl text-sm [overflow-wrap:anywhere]">{plainTerms(firstSentence(rec.why), locale)}</p>
      <p className="mt-2"><ImpactBadge impact={rec.impact} /></p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <CopyButton text={prompt} label={t.recs.card.copyPrompt} className="btn btn-primary !px-5 !py-2.5" testId="copy-prompt" />
        <Link href={`/w/${slug}/massnahmen/${rec.id}`} className="text-sm text-accent hover:underline">{t.recs.card.details}</Link>
      </div>
    </article>
  );
}

