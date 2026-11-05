'use client';
import { useActionState, useEffect, useId, useState } from 'react';
import { Turnstile } from '@/components/check/turnstile';
import { useI18n } from '@/lib/i18n/client';
import { startCheckAction, type CheckFormState } from './actions';

const initial: CheckFormState = { error: null, url: '' };

/**
 * URL-Feld mit „Gratis prüfen“ (Hero und Abschluss). Funktioniert ohne Turnstile-Schlüssel auch ohne JavaScript (Server Action).
 * Mit `siteKey` (Cloudflare Turnstile, unsichtbar bis eine Interaktion nötig ist) geht das Absenden erst mit Token.
 * Eingebunden über die Server-Komponente `CheckForm` in check-form.tsx (liest den Site-Key).
 */
export function CheckFormClient({ id, size = 'lg', tone = 'default', siteKey }: { id?: string; size?: 'lg' | 'md'; tone?: 'default' | 'onCard'; siteKey: string | null }) {
  const { t: all, locale } = useI18n();
  const t = all.marketing.form;
  const [state, action, pending] = useActionState(startCheckAction, initial);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  // Turnstile-Token gilt nur einmal → nach jedem Fehlversuch neu holen
  useEffect(() => { if (state.error) setResetKey((k) => k + 1); }, [state]);
  const waitCaptcha = !!siteKey && !captcha;
  const errorText = state.error ? ((t.errors as Record<string, string>)[state.error] ?? all.check.start.errors[state.error] ?? t.errors.generic) : '';
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
          disabled={pending || waitCaptcha}
          aria-busy={pending || waitCaptcha || undefined}
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-fg transition hover:bg-[color-mix(in_oklab,var(--accent)_88%,black)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70 ${big ? 'h-13 text-[17px]' : 'h-11 text-[15px]'}`}
        >
          {pending ? t.submitting : waitCaptcha ? all.check.start.botCheck : t.submit}
          {!pending && !waitCaptcha && <span aria-hidden>→</span>}
        </button>
      </div>
      <p id={errId} aria-live="polite" className={state.error ? 'mt-2.5 text-sm font-medium text-bad' : 'sr-only'}>
        {errorText}
      </p>
      {siteKey && <Turnstile siteKey={siteKey} locale={locale} resetKey={resetKey} onToken={setCaptcha} appearance="interaction-only" />}
      <p id={hintId} className="mt-2.5 text-xs text-muted">{t.hint}</p>
    </form>
  );
}
