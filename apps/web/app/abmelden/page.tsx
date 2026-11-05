import { notFound } from 'next/navigation';
import { decodeOptOutParam, verifyOptOut } from '@askmetry/core/hosted/optout';
import { OptOutForm } from '@/components/account-forms';
import { PublicShell } from '@/components/public-shell';
import { isHosted } from '@/lib/hosted/server';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: (await getT()).account.optout.metaTitle, robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
}

/** Abmeldelink aus der Erinnerungsmail: /abmelden?e=<base64url>&sig=<hmac>. Abgemeldet wird erst per Klick. */
export default async function OptOutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isHosted()) notFound();
  const sp = await searchParams;
  const e = typeof sp.e === 'string' ? sp.e : '';
  const sig = typeof sp.sig === 'string' ? sp.sig : typeof sp.s === 'string' ? sp.s : '';
  const email = decodeOptOutParam(e);
  const valid = !!email && verifyOptOut(email, sig);
  const t = (await getT()).account.optout;
  return (
    <PublicShell width="max-w-[640px]">
      <div className="rounded-3xl bg-card p-8 shadow-card" data-testid="optout">
        <h1 className="text-[1.5rem] font-semibold tracking-tight">{t.title}</h1>
        {valid ? (
          <>
            <p className="mt-2 text-[15px] text-muted">{t.text}</p>
            <div className="mt-6"><OptOutForm e={e} sig={sig} /></div>
          </>
        ) : <p role="alert" className="mt-2 text-[15px]">{t.invalid}</p>}
      </div>
    </PublicShell>
  );
}
