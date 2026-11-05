'use client';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { submitEmail, type CheckEmailState } from '@/lib/actions/check';
import { useI18n } from '@/lib/i18n/client';
import { Turnstile } from './turnstile';

/**
 * E-Mail-Gate des Schnell-Checks. Nach dem Absenden zeigt es „Mail ist unterwegs“ mit „erneut senden“ / „andere Adresse“.
 * `sentTo` = maskierte Adresse, wenn schon eine Mail rausging (Seite neu geladen).
 */
export function CheckEmailForm({ token, siteKey, sentTo, error: initialError }: { token: string; siteKey: string | null; sentTo: string | null; error?: string | null }) {
  const { t, locale } = useI18n();
  const m = t.check.email;
  const [state, run, pending] = useActionState<CheckEmailState, FormData>(submitEmail, null);
  const [editing, setEditing] = useState(!sentTo);
  const [email, setEmail] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [sends, setSends] = useState(0);
  useEffect(() => {
    if (state?.ok) { setEditing(false); setSends((n) => n + 1); }
    // Turnstile-Token gilt nur einmal → nach jedem Versuch neu holen
    if (state) setResetKey((k) => k + 1);
  }, [state]);

  const error = state?.error ?? (state ? null : initialError);
  const waitCaptcha = !!siteKey && !captcha;

  if (!editing) {
    return (
      <div className="space-y-3" data-testid="check-email-sent" aria-live="polite">
        <p className="font-medium">{m.sent(state?.ok && email ? email : sentTo ?? email)}</p>
        <p className="text-sm text-muted">{m.sentText}</p>
        {sends > 1 && state?.ok && <p className="text-sm text-good">{m.resent}</p>}
        <form action={run} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="token" value={token} />
          {email && <input type="hidden" name="email" value={email} />}
          {siteKey && email && <div className="basis-full"><Turnstile siteKey={siteKey} locale={locale} resetKey={resetKey} onToken={setCaptcha} /></div>}
          {email && <button type="submit" className="btn btn-sm" disabled={pending || waitCaptcha}>{pending ? m.busy : m.resend}</button>}
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => setEditing(true)}>{email ? m.otherAddress : m.resend}</button>
        </form>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    );
  }

  return (
    <form action={run} className="space-y-4" data-testid="check-email-form" onSubmit={(e) => setEmail(String(new FormData(e.currentTarget).get('email') ?? '').trim())}>
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="check-email">{m.label}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input min-w-0 flex-1" id="check-email" name="email" type="email" required autoComplete="email" inputMode="email"
            placeholder={m.placeholder} defaultValue={email} aria-invalid={!!error || undefined} aria-describedby={error ? 'check-email-error' : 'check-email-privacy'} />
          <button type="submit" className="btn btn-primary justify-center" disabled={pending || waitCaptcha}>{pending ? m.busy : m.submit}</button>
        </div>
      </div>
      {siteKey && (
        <div>
          <p className="mb-1 text-xs text-muted">{m.botCheck}</p>
          <Turnstile siteKey={siteKey} locale={locale} resetKey={resetKey} onToken={setCaptcha} />
        </div>
      )}
      {error && <p id="check-email-error" role="alert" className="rounded-md bg-subtle px-3 py-2 text-sm text-bad">{error}</p>}
      <div id="check-email-privacy" className="space-y-1.5 text-[13px] text-muted">
        <p>{m.privacy} <Link href="/datenschutz" className="text-accent hover:underline">{m.privacyLink}</Link>.</p>
        <p>{m.cacheNote}</p>
      </div>
    </form>
  );
}
