import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Seite nicht gefunden</h1>
      <p className="mt-2 text-sm text-muted">Diese Seite gibt es nicht oder du hast keinen Zugriff darauf.</p>
      <Link href="/w" className="btn btn-primary mt-6">Zu meinen Workspaces</Link>
    </main>
  );
}
