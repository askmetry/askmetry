'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/lib/i18n/client';
import { LocaleSwitcher } from '@/components/locale-switcher';

/** Ziel der Bestätigungsmail: Hinweisseite, die nach der automatischen Anmeldung zum Rücksprung-Ziel weiterleitet. */
const verifyTarget = (next: string | null) => `/email-bestaetigen${next ? `?next=${encodeURIComponent(next)}` : ''}`;

/**
 * Anmelden/Registrieren. `next` = geprüfter relativer Rücksprung (safeNext). Gehostet (`hosted`): Registrierung schickt eine
 * Bestätigungsmail (Konto erst danach nutzbar), „Passwort vergessen?“ ist sichtbar, `defaultEmail` kommt z. B. aus dem Schnell-Check.
 */
export function AuthForm({ mode, allowSignup = true, next = null, hosted = false, defaultEmail, intro }: {
  mode: 'login' | 'signup'; allowSignup?: boolean; next?: string | null; hosted?: boolean; defaultEmail?: string | null; intro?: string;
}) {
  const router = useRouter();
  const { t: all } = useI18n();
  const t = all.auth;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const q = next ? `?next=${encodeURIComponent(next)}` : '';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    const callbackURL = hosted ? verifyTarget(next) : undefined;
    const res = mode === 'login'
      ? await authClient.signIn.email({ email, password, ...(callbackURL ? { callbackURL } : {}) })
      : await authClient.signUp.email({ email, password, name: String(f.get('name') ?? '').trim() || email.split('@')[0]!, ...(callbackURL ? { callbackURL } : {}) });
    setBusy(false);
    if (res.error) {
      const code = res.error.code ?? '';
      setError(
        code === 'EMAIL_NOT_VERIFIED' ? t.errors.notVerified
        : code === 'INVALID_EMAIL_OR_PASSWORD' ? t.errors.invalidCredentials
        : code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' ? t.errors.userExists
        : code === 'PASSWORD_TOO_SHORT' ? t.errors.passwordTooShort
        : code === 'INVALID_EMAIL' ? t.errors.invalidEmail
        : t.errors.generic,
      );
      return;
    }
    // gehostet: Konto erst nach Bestätigung nutzbar → Hinweis „Bitte E-Mail bestätigen“ statt Weiterleitung
    if (hosted && mode === 'signup') { setSentTo(email); return; }
    router.push(next ?? '/w');
    router.refresh();
  }

  if (sentTo) return <VerifyNotice email={sentTo} next={next} />;

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <LocaleSwitcher className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">{mode === 'login' ? t.loginTitle : t.signupTitle}</h1>
          <p className="mt-1 text-sm text-muted">{intro ?? t.tagline}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          {mode === 'signup' && (
            <div><label className="label" htmlFor="name">{t.name}</label><input className="input" id="name" name="name" autoComplete="name" /></div>
          )}
          <div><label className="label" htmlFor="email">{t.email}</label><input className="input" id="email" name="email" type="email" required autoComplete="email" defaultValue={defaultEmail ?? undefined} /></div>
          <div>
            <label className="label" htmlFor="password">{t.password}</label>
            <input className="input" id="password" name="password" type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {mode === 'signup' && <p className="mt-1 text-xs text-muted">{t.passwordHint}{hosted ? ` ${t.verifyHint}` : ''}</p>}
            {mode === 'login' && hosted && <p className="mt-1.5 text-right text-sm"><Link className="text-accent hover:underline" href="/passwort-vergessen">{all.account.forgot.link}</Link></p>}
          </div>
          {error && <p role="alert" className="rounded-md bg-subtle px-3 py-2 text-sm text-bad">{error}</p>}
          <button className="btn btn-primary w-full justify-center" disabled={busy} type="submit">
            {busy ? t.busy : mode === 'login' ? t.loginTitle : t.signupTitle}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {mode === 'login'
            ? (allowSignup ? <>{t.noAccount} <Link className="text-accent hover:underline" href={`/signup${q}`}>{t.signupLink}</Link></> : null)
            : <>{t.haveAccount} <Link className="text-accent hover:underline" href={`/login${q}`}>{t.loginLink}</Link></>}
        </p>
      </div>
    </main>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${small ? 'text-[15px]' : 'text-lg'}`}>
      <svg width={small ? 20 : 26} height={small ? 20 : 26} viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="4" fill="var(--accent)" />
      </svg>
      Askmetry
    </span>
  );
}

/** „Bitte bestätige deine E-Mail-Adresse“ mit „Mail erneut senden“ (auch als eigene Seite /email-bestaetigen). */
export function VerifyNotice({ email, next, expired = false }: { email?: string | null; next?: string | null; expired?: boolean }) {
  const { t: all } = useI18n();
  const t = all.account.verify;
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  async function resend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const to = email ?? String(new FormData(e.currentTarget).get('email') ?? '').trim();
    if (!to) return;
    setState('busy');
    await authClient.sendVerificationEmail({ email: to, callbackURL: verifyTarget(next ?? null) });
    setState('sent');
  }
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <LocaleSwitcher className="absolute right-4 top-4" />
      <div className="w-full max-w-sm text-center" data-testid="verify-notice">
        <Logo />
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{t.title}</h1>
        {expired && <p role="alert" className="mt-3 rounded-md bg-subtle px-3 py-2 text-sm">{t.expired}</p>}
        <p className="mt-2 text-sm text-muted">{email ? t.text(email) : t.textNoEmail}</p>
        <p className="mt-2 text-sm text-muted">{t.spam}</p>
        <form onSubmit={resend} className="mt-5 space-y-3">
          {!email && <input className="input" name="email" type="email" required autoComplete="email" aria-label={all.auth.email} />}
          <button type="submit" className="btn w-full justify-center" disabled={state === 'busy'}>{t.resend}</button>
          {state === 'sent' && <p role="status" className="text-sm text-good">{t.resent}</p>}
        </form>
      </div>
    </main>
  );
}
