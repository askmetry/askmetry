import Link from 'next/link';
import { getT } from '@/lib/i18n/server';

export default async function NotFound() {
  const t = (await getT()).common.notFound;
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.text}</p>
      <Link href="/w" className="btn btn-primary mt-6">{t.back}</Link>
    </main>
  );
}
