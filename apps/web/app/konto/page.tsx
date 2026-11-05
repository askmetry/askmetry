import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/auth/auth-form';
import { ChangePasswordForm, DeleteAccountForm } from '@/components/account-forms';
import { UserMenu } from '@/components/user-menu';
import { Group, box } from '@/components/settings-ui';
import { isHosted } from '@/lib/hosted/server';
import { getT } from '@/lib/i18n/server';
import { requireUser } from '@/lib/session';

export async function generateMetadata() {
  return { title: (await getT()).account.metaTitle };
}

export default async function KontoPage() {
  if (!isHosted()) notFound();
  const u = await requireUser();
  const t = (await getT()).account;
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/w"><Logo small /></Link>
          <UserMenu email={u.email} name={u.name} account />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link href="/w" className="mb-3 inline-block text-sm text-muted hover:text-fg">← {t.back}</Link>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Group title={t.email}>
          <p className={`${box} flex flex-wrap items-center gap-2`}>
            <span className="font-medium [overflow-wrap:anywhere]">{u.email}</span>
            {u.emailVerified && <span className="rounded-md bg-subtle px-1.5 py-0.5 text-xs text-good">{t.verified}</span>}
          </p>
        </Group>
        <Group title={t.password.title}><div className={box}><ChangePasswordForm /></div></Group>
        <Group title={t.delete.title}>
          <div className={box}>
            <p className="mb-4 text-sm text-muted">{t.delete.text}</p>
            <DeleteAccountForm />
          </div>
        </Group>
      </main>
    </div>
  );
}
