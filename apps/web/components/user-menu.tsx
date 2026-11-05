'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { LocaleSwitcher } from '@/components/locale-switcher';

/** Konto-Menü: runder Avatar statt E-Mail + Button in der Kopfzeile. */
/** `account` = Link „Konto“ (gehostete Version). */
export function UserMenu({ email, name, account = false }: { email: string; name?: string | null; account?: boolean }) {
  const router = useRouter();
  const all = useT();
  const t = all.common;
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
  }, []);
  const initial = ((name || email).match(/\p{L}/u)?.[0] ?? '?').toUpperCase();
  return (
    <details ref={ref} className="relative" data-testid="user-menu">
      <summary aria-label={t.account.menu} title={email}
        className="flex size-7 cursor-pointer list-none items-center justify-center rounded-full bg-subtle text-xs font-semibold text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        {initial}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl bg-card p-1.5 text-sm shadow-card">
        <p className="truncate px-3 py-2 text-muted">{email}</p>
        <div className="my-1 border-t border-border" />
        <Link href="/w" className="block rounded-lg px-3 py-2 hover:bg-subtle">{t.account.workspaces}</Link>
        {account && <Link href="/konto" className="block rounded-lg px-3 py-2 hover:bg-subtle">{all.account.menu}</Link>}
        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-subtle"
          onClick={async () => { await authClient.signOut(); router.push(account ? '/' : '/login'); router.refresh(); }}>{t.account.signOut}</button>
        <div className="my-1 border-t border-border" />
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-muted">{t.language.label}</span>
          <LocaleSwitcher />
        </div>
      </div>
    </details>
  );
}
