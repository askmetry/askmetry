import Link from 'next/link';
import { PublicShell } from '@/components/public-shell';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: (await getT()).account.delete.doneTitle, robots: { index: false } };
}

export default async function DeletedPage() {
  const t = (await getT()).account;
  return (
    <PublicShell width="max-w-[640px]">
      <div className="rounded-3xl bg-card p-8 text-center shadow-card" data-testid="account-deleted">
        <h1 className="text-[1.5rem] font-semibold tracking-tight">{t.delete.doneTitle}</h1>
        <p className="mt-2 text-[15px] text-muted">{t.delete.doneText}</p>
        <Link href="/" className="btn btn-primary mt-6">{t.home}</Link>
      </div>
    </PublicShell>
  );
}
