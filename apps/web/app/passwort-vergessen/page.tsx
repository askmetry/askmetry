import { notFound } from 'next/navigation';
import { ForgotPasswordForm } from '@/components/auth/password-forms';
import { getT } from '@/lib/i18n/server';
import { isHosted } from '@/lib/hosted/server';

export async function generateMetadata() {
  return { title: (await getT()).account.forgot.metaTitle };
}
export default function ForgotPasswordPage() {
  if (!isHosted()) notFound();
  return <ForgotPasswordForm />;
}
