import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { signupAllowed } from '@/lib/limits';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Anmelden' };
export default async function LoginPage() {
  if (await getSession()) redirect('/w');
  return <AuthForm mode="login" allowSignup={signupAllowed()} />;
}
