'use client';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import type { FormState } from '@/lib/actions/workspaces';

type Action = (prev: FormState, f: FormData) => Promise<FormState>;

/** Formular für Server Actions mit Rückmeldung. */
export function ActionForm({ action, slug, children, submit, className = '', confirm, resetOnSuccess = false, disabled = false, submitClass = 'btn btn-primary btn-sm', inline = false }: {
  action: Action; slug: string; children?: ReactNode; submit: string; className?: string; confirm?: string;
  resetOnSuccess?: boolean; disabled?: boolean; submitClass?: string; inline?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={run} className={className.replace(/(^|\s)space-y-(\d+)(?=\s|$)/g, '$1flex flex-col gap-$2')}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="slug" value={slug} />
      {/* fieldset ist display:contents – space-y würde die Felder nicht erreichen, daher oben als flex-col + gap (Tailwind: flex-col gap-2 gap-3 gap-4 gap-5 gap-6) */}
      <fieldset disabled={disabled || pending} className="contents">
        {children}
        <span className="flex items-center gap-3">
          <button type="submit" className={submitClass} disabled={disabled || pending}>{pending ? '…' : submit}</button>
          {state?.error && <span role="alert" className="text-xs text-bad">{state.error}</span>}
          {state?.ok && !pending && <span className="text-xs text-good">{state.ok}</span>}
        </span>
      </fieldset>
    </form>
  );
}
