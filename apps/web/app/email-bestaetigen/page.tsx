import { notFound, redirect } from 'next/navigation';
import { VerifyNotice } from '@/components/auth/auth-form';
import { getSession } from '@/lib/session';
import { getT } from '@/lib/i18n/server';
import { isHosted } from '@/lib/hosted/server';
import { safeNext } from '@/lib/hosted/safe-next';

export async function generateMetadata() {
  return { title: (await getT()).account.verify.metaTitle, robots: { index: false } };
}

/**
 * Ziel des Bestätigungslinks (callbackURL): Nach erfolgreicher Bestätigung ist man angemeldet → weiter zu `next`.
 * Bei Fehlern (abgelaufen/ungültig) hängt better-auth `?error=…` an → Hinweis + „Mail erneut senden“.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isHosted()) notFound();
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null);
  const s = await getSession();
  if (s?.user.emailVerified && !sp.error) redirect(next ?? '/w');
  return <VerifyNotice email={s?.user.email ?? null} next={next} expired={!!sp.error} />;
}
