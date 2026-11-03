'use client';
import { useMemo, useState, useTransition } from 'react';
import { setStepDone } from '@/lib/actions/rec-steps';
import { toggleStep } from '@/lib/steps';
import { CopyButton } from '@/components/copy-button';
import { LinkedText } from '@/components/linked-text';
import { linkTargets } from '@/lib/linkify';
import { useT } from '@/lib/i18n/client';

/** „Mit KI umsetzen“: ein Satz, was die KI liefert; großer Kopier-Button; Rohtext optional ausklappbar. */
export function AiPromptBlock({ prompt, deliverable }: { prompt: string; deliverable: string }) {
  const [open, setOpen] = useState(false);
  const t = useT().recs;
  return (
    <div>
      <p className="text-sm" data-testid="prompt-preview">{deliverable}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <CopyButton text={prompt} label={t.card.copyPrompt} className="btn btn-primary !px-5 !py-2.5 !text-[0.9375rem]" testId="copy-prompt-main" />
        <button type="button" className="text-sm text-accent hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? t.ai.hidePrompt : t.ai.showPrompt}
        </button>
      </div>
      {open && (
        <div className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-xl bg-subtle px-4 py-3 font-mono text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{prompt}</div>
      )}
      <p className="mt-3 text-xs text-muted">{t.ai.pasteHint}</p>
    </div>
  );
}

/** Schritte als Checkliste; der Haken-Stand liegt in der Datenbank (done_steps). Leser sehen ihn nur. */
export function StepChecklist({ slug, id, steps, initial, canEdit, links }: {
  slug: string; id: string; steps: string[]; initial: number[]; canEdit: boolean; links?: { urls: (string | { url: string; title: string | null })[]; hosts: string[] };
}) {
  const targets = useMemo(() => linkTargets(links?.urls ?? [], links?.hosts ?? []), [links]);
  const [done, setDone] = useState<Set<number>>(() => new Set(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = useT().recs;
  const toggle = (i: number) => {
    const on = !done.has(i);
    const prev = done;
    setDone(new Set(toggleStep([...done], i, on)));
    setError(null);
    start(async () => {
      const r = await setStepDone(slug, id, i, on);
      if ('error' in r) { setDone(prev); setError(r.error); } else setDone(new Set(r.done));
    });
  };
  const n = steps.filter((_, i) => done.has(i)).length;
  return (
    <div>
      <ul className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i}>
            <label className={`flex gap-3 text-sm ${canEdit ? 'cursor-pointer' : ''}`}>
              <input type="checkbox" checked={done.has(i)} disabled={!canEdit} onChange={() => toggle(i)} data-step={i}
                className="mt-0.5 size-4 shrink-0 accent-[var(--fg)]" />
              <span className={`min-w-0 [overflow-wrap:anywhere] ${done.has(i) ? 'text-muted line-through' : ''}`}><LinkedText text={s} targets={targets} /></span>
            </label>
          </li>
        ))}
      </ul>
      {steps.length > 1 && <p className="mt-3 text-xs text-muted" aria-live="polite">{t.stepsDone(n, steps.length)}{pending ? t.stepsSaving : ''}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
