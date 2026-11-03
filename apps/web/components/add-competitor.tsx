'use client';
import { useActionState } from 'react';
import { addCompetitor, addCompetitors } from '@/lib/actions/settings';
import { useT } from '@/lib/i18n/client';

export function AddCompetitorButton({ slug, name, label }: { slug: string; name: string; label?: string }) {
  const t = useT().settings.competitors;
  const [state, run, pending] = useActionState(addCompetitor, null);
  return (
    <form action={run} className="inline">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="name" value={name} />
      <button className="btn btn-sm" disabled={pending} title={t.addTitle}>{pending ? '…' : label ?? t.addButton}</button>
      {state?.error && <span className="ml-2 text-xs text-bad">{state.error}</span>}
    </form>
  );
}

/** Mehrere oft genannte Marken auf einmal als Wettbewerber übernehmen. */
export function AddCompetitorsButton({ slug, names }: { slug: string; names: string[] }) {
  const t = useT().settings.competitors;
  const [state, run, pending] = useActionState(addCompetitors, null);
  return (
    <form action={run} className="flex items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      {names.map((n) => <input key={n} type="hidden" name="name" value={n} />)}
      <button className="btn btn-sm" disabled={pending}>{pending ? '…' : names.length === 1 ? t.addOne : t.addAll(names.length)}</button>
      {state?.error && <span className="text-xs text-bad">{state.error}</span>}
      {state?.ok && <span className="text-xs text-good">{state.ok}</span>}
    </form>
  );
}
