'use client';
import { useActionState, useId } from 'react';
import { useT } from '@/lib/i18n/client';
import { startCheckAction, type CheckFormState } from './actions';

const initial: CheckFormState = { error: null, url: '' };

/** URL-Feld mit „Gratis prüfen“ (Hero und Abschluss). Funktioniert auch ohne JavaScript (Server Action). */
export function CheckForm({ id, size = 'lg', tone = 'default' }: { id?: string; size?: 'lg' | 'md'; tone?: 'default' | 'onCard' }) {
  const t = useT().marketing.form;
  const [state, action, pending] = useActionState(startCheckAction, initial);
  const auto = useId();
  const inputId = id ?? `url-${auto}`;
  const errId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const big = size === 'lg';
  return (
    <form action={action} noValidate className="w-full">
      <label htmlFor={inputId} className="sr-only">{t.label}</label>
      <div className={`flex flex-col gap-2 rounded-2xl sm:flex-row sm:items-stretch sm:gap-0 sm:p-1.5 sm:shadow-card ${tone === 'onCard' ? 'sm:bg-bg' : 'sm:bg-card'} ${state.error ? 'sm:ring-2 sm:ring-bad/40' : ''}`}>
        <input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.url}
          placeholder={t.placeholder}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? `${errId} ${hintId}` : hintId}
          className={`w-full min-w-0 rounded-xl sm:flex-1 border border-border bg-card px-4 text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent-soft sm:border-0 sm:bg-transparent sm:focus:ring-0 ${big ? 'h-13 text-[17px]' : 'h-11 text-[15px]'}`}
        />
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-fg transition hover:bg-[color-mix(in_oklab,var(--accent)_88%,black)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70 ${big ? 'h-13 text-[17px]' : 'h-11 text-[15px]'}`}
        >
          {pending ? t.submitting : t.submit}
          {!pending && <span aria-hidden>→</span>}
        </button>
      </div>
      <p id={errId} aria-live="polite" className={state.error ? 'mt-2.5 text-sm font-medium text-bad' : 'sr-only'}>
        {state.error ? t.errors[state.error] : ''}
      </p>
      <p id={hintId} className="mt-2.5 text-xs text-muted">{t.hint}</p>
    </form>
  );
}
