'use client';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { giveConsent, submitEmail, type CheckEmailState } from '@/lib/actions/check';
import { useI18n } from '@/lib/i18n/client';
import { Turnstile } from './turnstile';

/** Freiwillige Einwilligung in Erinnerung + Tipps – nie vorangekreuzt (UWG § 7). Text-Version: CHECK_CONSENT_VERSION im Kern. */
function ConsentBox({ id }: { id: string }) {
  const m = useI18n().t.check.notify;
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input id={id} name="consent" type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" data-testid="check-consent" />
      <span>{m.consent}</span>
    </label>
  );
}

/** Adresse angegeben, Häkchen damals nicht gesetzt: Einwilligung nachträglich (eigener, kleiner Schritt). */
function LaterConsent({ token }: { token: string }) {
  const m = useI18n().t.check.notify;
  const [state, run, pending] = useActionState<CheckEmailState, FormData>(giveConsent, null);
  if (state?.ok) return <p className="text-[13px] text-muted" data-testid="check-consent-given">{m.consentGiven}</p>;
  return (
    <form action={run} className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="check-consent-later">
      <input type="hidden" name="token" value={token} />
      <ConsentBox id="check-consent-later" />
      <button type="submit" className="btn btn-sm" disabled={pending}>{pending ? '…' : m.consentSave}</button>
      {state?.error && <p role="alert" className="basis-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}

/**
 * Optional während der Check läuft: „Ergebnis auch per Mail?“. Sperrt nichts.
 * Absenden schickt die Bestätigungsmail; nach dem Klick auf den Link geht die Fertig-Mail raus. Mit Häkchen zusätzlich
 * einmalig eine Erinnerung 24 h nach dem Ergebnis (nur ohne Kauf) – ebenfalls nur an die bestätigte Adresse.
 * `sentTo` = maskierte Adresse, wenn schon eine Mail rausging (Seite neu geladen); `confirmed` = Adresse bestätigt.
 */
export function CheckNotifyForm({ token, siteKey, sentTo, confirmed, consent }: { token: string; siteKey: string | null; sentTo: string | null; confirmed: boolean; consent: boolean }) {
  const { t, locale } = useI18n();
  const m = t.check.notify;
  const [state, run, pending] = useActionState<CheckEmailState, FormData>(submitEmail, null);
  const [editing, setEditing] = useState(!sentTo);
  const [email, setEmail] = useState('');
  const [withConsent, setWithConsent] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [sends, setSends] = useState(0);
  useEffect(() => {
    if (state?.ok) { setEditing(false); setSends((n) => n + 1); }
    // Turnstile-Token gilt nur einmal → nach jedem Versuch neu holen
    if (state) setResetKey((k) => k + 1);
  }, [state]);

  const error = state?.error ?? null;
  const waitCaptcha = !!siteKey && !captcha;
  const hasConsent = consent || (state?.ok && withConsent);
  const consentLine = hasConsent
    ? <p className="text-[13px] text-muted" data-testid="check-consent-given">{m.consentGiven}</p>
    : sentTo || state?.ok ? <LaterConsent token={token} /> : null;

  if (confirmed && sentTo) {
    return (
      <div className="space-y-2">
        <p className="text-sm" data-testid="check-notify-confirmed"><span aria-hidden className="mr-1.5 text-good">✓</span>{m.confirmed(sentTo)}</p>
        {consentLine}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-2" data-testid="check-email-sent" aria-live="polite">
        <p className="text-sm">{m.sent(state?.ok && email ? email : sentTo ?? email)}</p>
        {sends > 1 && state?.ok && <p className="text-sm text-good">{m.resent}</p>}
        {consentLine}
        <form action={run} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="token" value={token} />
          {email && <input type="hidden" name="email" value={email} />}
          {/* erneut senden behält die Entscheidung zur Einwilligung bei */}
          {email && withConsent && <input type="hidden" name="consent" value="on" />}
          {siteKey && email && <div className="basis-full"><Turnstile siteKey={siteKey} locale={locale} resetKey={resetKey} onToken={setCaptcha} appearance="interaction-only" /></div>}
          {email && <button type="submit" className="btn btn-sm" disabled={pending || waitCaptcha}>{pending ? m.busy : m.resend}</button>}
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => setEditing(true)}>{email ? m.otherAddress : m.resend}</button>
        </form>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    );
  }

  return (
    <form action={run} className="space-y-3" data-testid="check-email-form" onSubmit={(e) => {
      const fd = new FormData(e.currentTarget);
      setEmail(String(fd.get('email') ?? '').trim());
      setWithConsent(fd.get('consent') === 'on');
    }}>
      <input type="hidden" name="token" value={token} />
      <label className="sr-only" htmlFor="check-email">{m.label}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input min-w-0 flex-1" id="check-email" name="email" type="email" required autoComplete="email" inputMode="email"
          placeholder={m.placeholder} defaultValue={email} aria-invalid={!!error || undefined} aria-describedby={error ? 'check-email-error' : 'check-email-privacy'} />
        <button type="submit" className="btn justify-center" disabled={pending || waitCaptcha}>{pending ? m.busy : m.submit}</button>
      </div>
      <ConsentBox id="check-consent" />
      {siteKey && <Turnstile siteKey={siteKey} locale={locale} resetKey={resetKey} onToken={setCaptcha} appearance="interaction-only" />}
      {error && <p id="check-email-error" role="alert" className="rounded-md bg-subtle px-3 py-2 text-sm text-bad">{error}</p>}
      <p id="check-email-privacy" className="text-[13px] text-muted">{m.privacy} <Link href="/datenschutz" className="text-accent hover:underline">{m.privacyLink}</Link>.</p>
    </form>
  );
}
