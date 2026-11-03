'use client';
import { useActionState } from 'react';
import { setRecommendationStatus } from '@/lib/actions/recommendations';
import type { RecStatus } from '@/lib/recommendations';
import { useT } from '@/lib/i18n/client';

const OPTIONS: RecStatus[] = ['open', 'in_progress', 'done', 'dismissed'];

/** Status-Menü als Segment-Schalter (nur für Editoren gerendert). */
export function RecStatusMenu({ slug, id, status }: { slug: string; id: string; status: RecStatus }) {
  const [state, run, pending] = useActionState(setRecommendationStatus, null);
  const t = useT().recs;
  return (
    <div className="flex flex-col items-start gap-1.5" data-rec-actions={id}>
      <div role="group" aria-label={t.statusMenuLabel} className="inline-flex flex-wrap rounded-xl bg-subtle p-1">
        {OPTIONS.map((to) => {
          const o = { to, label: t.statusMenu[to] };
          const on = o.to === status;
          return (
            <form key={o.to} action={run}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value={o.to} />
              <button type="submit" data-to={o.to} aria-pressed={on} disabled={pending || on}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-default ${on ? 'bg-card font-medium text-fg shadow-card' : 'text-muted hover:text-fg'}`}>
                {o.label}
              </button>
            </form>
          );
        })}
      </div>
      {pending && <span className="text-xs text-muted">{t.saving}</span>}
      {state?.error && <span role="alert" className="text-xs text-bad">{state.error}</span>}
    </div>
  );
}
