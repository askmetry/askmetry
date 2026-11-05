import { notFound } from 'next/navigation';
import { ResetPasswordForm } from '@/components/auth/password-forms';
import { getT } from '@/lib/i18n/server';
import { isHosted } from '@/lib/hosted/server';

export async function generateMetadata() {
  return { title: (await getT()).account.reset.metaTitle, robots: { index: false }, referrer: 'no-referrer' };
}
/** Ziel des Links aus der Mail (better-auth leitet mit ?token=… bzw. ?error=INVALID_TOKEN hierher). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isHosted()) notFound();
  const sp = await searchParams;
  const token = typeof sp.token === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(sp.token) ? sp.token : null;
  return <ResetPasswordForm token={token} invalid={!!sp.error} />;
}
