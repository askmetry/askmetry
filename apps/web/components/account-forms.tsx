'use client';
import { startTransition, useActionState, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { confirmOptOut, deleteAccount, type OptOutState } from '@/lib/actions/account';
import type { FormState } from '@/lib/actions/workspaces';
import { useI18n } from '@/lib/i18n/client';

export function ChangePasswordForm() {
  const { t: all } = useI18n();
  const t = all.account.password;
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; error?: string }>({});
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setState({ busy: true });
    const res = await authClient.changePassword({
      currentPassword: String(fd.get('current') ?? ''), newPassword: String(fd.get('next') ?? ''), revokeOtherSessions: true,
    });
    if (res.error) {
      const code = res.error.code ?? '';
      setState({ error: code === 'INVALID_PASSWORD' ? t.wrong : code === 'PASSWORD_TOO_SHORT' ? all.auth.errors.passwordTooShort : all.auth.errors.generic });
      return;
    }
    form.reset();
    setState({ ok: true });
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="change-password">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="pw-current">{t.current}</label><input className="input" id="pw-current" name="current" type="password" required autoComplete="current-password" /></div>
        <div>
          <label className="label" htmlFor="pw-next">{t.next}</label>
          <input className="input" id="pw-next" name="next" type="password" required minLength={8} autoComplete="new-password" aria-describedby="pw-hint" />
          <p id="pw-hint" className="mt-1 text-xs text-muted">{t.hint}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={state.busy}>{state.busy ? '…' : t.submit}</button>
        {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
        {state.ok && <span role="status" className="text-sm text-good">{t.ok}</span>}
      </div>
    </form>
  );
}

export function DeleteAccountForm() {
  const t = useI18n().t.account.delete;
  const [state, run, pending] = useActionState<FormState, FormData>(deleteAccount, null);
  const [checked, setChecked] = useState(false);
  return (
    // manuell absenden statt <form action>: React würde das Formular sonst nach einem Fehler zurücksetzen (Häkchen weg)
    <form className="space-y-4" data-testid="delete-account" onSubmit={(e) => {
      e.preventDefault();
      if (!window.confirm(t.confirm)) return;
      const fd = new FormData(e.currentTarget);
      startTransition(() => run(fd));
    }}>
      <label className="flex items-start gap-3 text-[15px]">
        <input type="checkbox" name="confirm" className="mt-1 size-4 shrink-0" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{t.confirmLabel}</span>
      </label>
      <div className="max-w-sm">
        <label className="label" htmlFor="delete-password">{t.passwordLabel}</label>
        <input className="input" id="delete-password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-sm border-bad text-bad hover:bg-subtle disabled:opacity-50" disabled={!checked || pending}>{pending ? '…' : t.submit}</button>
        {state?.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
      </div>
    </form>
  );
}

export function OptOutForm({ e, sig }: { e: string; sig: string }) {
  const t = useI18n().t.account.optout;
  const [state, run, pending] = useActionState<OptOutState, FormData>(confirmOptOut, null);
  if (state?.ok) return <p role="status" className="text-[15px] text-good" data-testid="optout-done">{t.done}</p>;
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="e" value={e} />
      <input type="hidden" name="sig" value={sig} />
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? '…' : t.submit}</button>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}
