'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function AuthForm({ mode, allowSignup = true }: { mode: 'login' | 'signup'; allowSignup?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    const res = mode === 'login'
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name: String(f.get('name') ?? '').trim() || email.split('@')[0]! });
    setBusy(false);
    if (res.error) {
      const code = res.error.code ?? '';
      setError(
        code === 'INVALID_EMAIL_OR_PASSWORD' ? 'E-Mail oder Passwort ist falsch.'
        : code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' ? 'Zu dieser E-Mail gibt es bereits ein Konto.'
        : code === 'PASSWORD_TOO_SHORT' ? 'Das Passwort muss mindestens 8 Zeichen haben.'
        : code === 'INVALID_EMAIL' ? 'Bitte gib eine gültige E-Mail-Adresse ein.'
        : 'Das hat nicht geklappt. Bitte versuche es erneut.',
      );
      return;
    }
    router.push('/w');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">{mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</h1>
          <p className="mt-1 text-sm text-muted">Wie sichtbar ist deine Marke in ChatGPT, Gemini, Claude & Google?</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          {mode === 'signup' && (
            <div><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" autoComplete="name" /></div>
          )}
          <div><label className="label" htmlFor="email">E-Mail</label><input className="input" id="email" name="email" type="email" required autoComplete="email" /></div>
          <div>
            <label className="label" htmlFor="password">Passwort</label>
            <input className="input" id="password" name="password" type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {mode === 'signup' && <p className="mt-1 text-xs text-muted">Mindestens 8 Zeichen.</p>}
          </div>
          {error && <p role="alert" className="rounded-md bg-subtle px-3 py-2 text-sm text-bad">{error}</p>}
          <button className="btn btn-primary w-full justify-center" disabled={busy} type="submit">
            {busy ? 'Einen Moment …' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {mode === 'login'
            ? (allowSignup ? <>Noch kein Konto? <Link className="text-accent hover:underline" href="/signup">Registrieren</Link></> : null)
            : <>Schon registriert? <Link className="text-accent hover:underline" href="/login">Anmelden</Link></>}
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
      OpenGEO
    </span>
  );
}
