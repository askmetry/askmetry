import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm, Logo } from '@/components/auth/auth-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { signupAllowed } from '@/lib/limits';
import { getSession } from '@/lib/session';
import { getT } from '@/lib/i18n/server';
import { isHosted, verifiedCheckEmail } from '@/lib/hosted/server';
import { checkTokenFromNext, safeNext } from '@/lib/hosted/safe-next';

export async function generateMetadata() {
  return { title: (await getT()).auth.signupPageTitle };
}
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null);
  if (await getSession()) redirect(next ?? '/w');
  if (!signupAllowed()) {
    const t = (await getT()).auth.closed;
    return (
      <main className="relative flex min-h-screen items-center justify-center px-4">
        <LocaleSwitcher className="absolute right-4 top-4" />
        <div className="w-full max-w-sm text-center">
          <Logo />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-2 text-sm text-muted">{t.text}</p>
          <p className="mt-6 text-sm"><Link className="text-accent hover:underline" href="/login">{t.toLogin}</Link></p>
        </div>
      </main>
    );
  }
  // Kauf aus einem Schnell-Check: E-Mail aus dem (bestätigten) Check vorbelegen; Token steht im Rücksprung-Ziel
  const hosted = isHosted();
  const token = hosted ? checkTokenFromNext(next) : null;
  const t = (await getT()).auth;
  return <AuthForm mode="signup" next={next} hosted={hosted} defaultEmail={token ? await verifiedCheckEmail(token) : null}
    intro={token || next?.startsWith('/kaufen') ? t.signupForReport : undefined} />;
}
