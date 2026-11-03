import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm, Logo } from '@/components/auth/auth-form';
import { signupAllowed } from '@/lib/limits';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Registrieren' };
export default async function SignupPage() {
  if (await getSession()) redirect('/w');
  if (!signupAllowed()) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <Logo />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Registrierung geschlossen</h1>
          <p className="mt-2 text-sm text-muted">Neue Konten können auf dieser Instanz nicht selbst angelegt werden. Bitte wende dich an die Person, die OpenGEO hier betreibt.</p>
          <p className="mt-6 text-sm"><Link className="text-accent hover:underline" href="/login">Zur Anmeldung</Link></p>
        </div>
      </main>
    );
  }
  return <AuthForm mode="signup" />;
}
