import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { signupAllowed } from '@/lib/limits';
import { getSession } from '@/lib/session';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: (await getT()).auth.loginTitle };
}
export default async function LoginPage() {
  if (await getSession()) redirect('/w');
  return <AuthForm mode="login" allowSignup={signupAllowed()} />;
}
