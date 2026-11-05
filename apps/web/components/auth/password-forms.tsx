'use client';
import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/lib/i18n/client';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Logo } from '@/components/auth/auth-form';

function Frame({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <LocaleSwitcher className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
          {text && <p className="mt-1 text-sm text-muted">{text}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

/** „Passwort vergessen?“: Link per Mail anfordern. Antwort immer gleich (verrät nicht, ob es das Konto gibt). */
export function ForgotPasswordForm() {
  const { t: all } = useI18n();
  const t = all.account.forgot;
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState('busy');
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    const res = await authClient.requestPasswordReset({ email, redirectTo: '/passwort-neu' });
    if (res.error && res.error.status !== 404) { setError(all.auth.errors.generic); setState('idle'); return; }
    setState('sent');
  }
  return (
    <Frame title={t.title} text={state === 'sent' ? undefined : t.text}>
      {state === 'sent' ? (
        <p role="status" className="rounded-xl bg-card p-5 text-center text-sm shadow-card" data-testid="forgot-sent">{t.sent}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div><label className="label" htmlFor="email">{all.auth.email}</label><input className="input" id="email" name="email" type="email" required autoComplete="email" /></div>
          {error && <p role="alert" className="rounded-md bg-subtle px-3 py-2 text-sm text-bad">{error}</p>}
          <button className="btn btn-primary w-full justify-center" disabled={state === 'busy'} type="submit">{state === 'busy' ? all.auth.busy : t.submit}</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link className="text-accent hover:underline" href="/login">{all.auth.loginLink}</Link></p>
    </Frame>
  );
}

/** Neues Passwort setzen (Token aus dem Link; ungültig/abgelaufen → neuen Link anfordern). */
export function ResetPasswordForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const { t: all } = useI18n();
  const t = all.account.reset;
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid'>(invalid || !token ? 'invalid' : 'idle');
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState('busy');
    const newPassword = String(new FormData(e.currentTarget).get('password') ?? '');
    const res = await authClient.resetPassword({ newPassword, token: token! });
    if (res.error) {
      const code = res.error.code ?? '';
      if (code === 'INVALID_TOKEN') { setState('invalid'); return; }
      setError(code === 'PASSWORD_TOO_SHORT' ? all.auth.errors.passwordTooShort : all.auth.errors.generic);
      setState('idle');
      return;
    }
    setState('done');
  }
  return (
    <Frame title={t.title}>
      {state === 'invalid' ? (
        <div className="rounded-xl bg-card p-5 text-center text-sm shadow-card" data-testid="reset-invalid">
          <p role="alert">{t.invalid}</p>
          <Link href="/passwort-vergessen" className="btn btn-primary mt-4">{t.again}</Link>
        </div>
      ) : state === 'done' ? (
        <div className="rounded-xl bg-card p-5 text-center text-sm shadow-card" data-testid="reset-done">
          <p role="status">{t.ok}</p>
          <Link href="/login" className="btn btn-primary mt-4">{all.auth.loginTitle}</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div>
            <label className="label" htmlFor="password">{all.account.password.next}</label>
            <input className="input" id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
            <p className="mt-1 text-xs text-muted">{all.auth.passwordHint}</p>
          </div>
          {error && <p role="alert" className="rounded-md bg-subtle px-3 py-2 text-sm text-bad">{error}</p>}
          <button className="btn btn-primary w-full justify-center" disabled={state === 'busy'} type="submit">{state === 'busy' ? all.auth.busy : t.submit}</button>
        </form>
      )}
    </Frame>
  );
}
