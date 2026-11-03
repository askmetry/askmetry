'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

const MAP: Record<string, string> = { marke: 'marke', wettbewerber: 'wettbewerber', fragen: 'fragen', messen: 'messung', messung: 'messung', kosten: 'kosten', workspace: 'workspace' };

/** Alte Links /settings#messen usw. – der Anker kommt nie beim Server an, daher im Browser auflösen. */
export function SettingsHashRedirect({ slug }: { slug: string }) {
  const router = useRouter();
  const t = useT().settings;
  useEffect(() => {
    const target = MAP[window.location.hash.slice(1)] ?? 'marke';
    router.replace(`/w/${slug}/settings/${target}`);
  }, [router, slug]);
  return <p className="text-sm text-muted">{t.opening}</p>;
}
