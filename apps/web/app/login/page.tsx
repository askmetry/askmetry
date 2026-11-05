import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { signupAllowed } from '@/lib/limits';
import { getSession } from '@/lib/session';
import { getT } from '@/lib/i18n/server';
import { isHosted } from '@/lib/hosted/server';
import { safeNext } from '@/lib/hosted/safe-next';

export async function generateMetadata() {
  return { title: (await getT()).auth.loginTitle };
}
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null);
  if (await getSession()) redirect(next ?? '/w');
  return <AuthForm mode="login" allowSignup={signupAllowed()} next={next} hosted={isHosted()} />;
}
