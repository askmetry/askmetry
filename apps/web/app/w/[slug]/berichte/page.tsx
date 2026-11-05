import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { reportsForWorkspace } from '@/lib/hosted/data';
import { remeasureHref, rightsFor } from '@/lib/hosted/server';
import { getI18n, getT } from '@/lib/i18n/server';
import { requireWorkspace } from '@/lib/session';

export async function generateMetadata() {
  return { title: (await getT()).reports.metaTitle };
}

const statusTone = (s: string) => (s === 'ready' ? 'good' : s === 'failed' ? 'bad' : s === 'measuring' || s === 'paid' ? 'accent' : 'neutral') as 'good' | 'bad' | 'accent' | 'neutral';

export default async function BerichtePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, canEdit } = await requireWorkspace(slug);
  if (!(await rightsFor(ws)).reports) notFound();
  const { t: tt, f } = await getI18n();
  const t = tt.reports;
  // abgebrochene/offene Checkouts ohne Zahlung nicht als Bericht auflisten
  const list = (await reportsForWorkspace(ws.id)).filter((r) => r.status !== 'canceled');
  const rebuy = canEdit ? await remeasureHref(ws) : null;
  const busy = list.some((r) => r.status === 'measuring' || r.status === 'pending_payment');
  // Link aus der Erinnerungsmail: ?nachmessung=<reportId> → Nachmessung dieses Berichts direkt anbieten
  const remeasureFor = canEdit && typeof sp.nachmessung === 'string' ? list.find((r) => r.id === sp.nachmessung && r.status === 'ready') : undefined;
  const hasStrategy = list.some((r) => r.tier === 'strategy' && ['paid', 'measuring', 'ready'].includes(r.status));

  return (
    <>
      {busy && <AutoRefresh seconds={10} />}
      <PageHeader title={t.title} description={t.intro}>
        {rebuy && !remeasureFor && <Link href={rebuy} className="btn btn-primary">{t.buyRemeasure}</Link>}
        {canEdit && !hasStrategy && list.some((r) => r.status === 'ready') && (
          <Link href={`/kaufen?tier=strategy&workspace=${encodeURIComponent(slug)}`} className="btn">{t.buyStrategy}</Link>
        )}
      </PageHeader>
      {remeasureFor && (
        <section className="mb-6 flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-card sm:flex-row sm:items-center sm:justify-between" data-testid="remeasure-offer">
          <div>
            <h2 className="text-[17px] font-semibold">{t.remeasureOffer.title}</h2>
            <p className="mt-1 text-[15px] text-muted">{t.remeasureOffer.text(t.label(t.tier[remeasureFor.tier] ?? remeasureFor.tier, false))}</p>
          </div>
          <Link href={`/kaufen?tier=${remeasureFor.tier}&workspace=${encodeURIComponent(slug)}&kind=remeasure`} className="btn btn-primary shrink-0">{t.remeasureLink}</Link>
        </section>
      )}
      {list.length === 0 ? <EmptyState title={t.empty} action={{ href: '/', label: t.startCheck }} /> : (
        <div className="rounded-2xl bg-card shadow-card">
          <ul className="divide-y divide-border sm:hidden" data-testid="report-list-mobile">
            {list.map((r) => (
              <li key={r.id}>
                <Link href={`/w/${slug}/bericht/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-subtle/60">
                  <span className="min-w-0">
                    <span className="block font-medium">{t.label(t.tier[r.tier] ?? r.tier, r.kind === 'remeasure')}</span>
                    <span className="block text-sm text-muted">{f.date(r.readyAt ?? r.paidAt ?? r.createdAt, false)}</span>
                  </span>
                  <Badge tone={statusTone(r.status)}>{t.status[r.status] ?? r.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto pb-2 sm:block">
            <table className="data" data-testid="report-list">
              <thead><tr><th>{t.colKind}</th><th>{t.colStatus}</th><th>{t.colDate}</th><th>{t.colPdf}</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/w/${slug}/bericht/${r.id}`} className="font-medium hover:text-accent hover:underline">{t.label(t.tier[r.tier] ?? r.tier, r.kind === 'remeasure')}</Link></td>
                    <td><Badge tone={statusTone(r.status)}>{t.status[r.status] ?? r.status}</Badge></td>
                    <td className="whitespace-nowrap">{f.date(r.readyAt ?? r.paidAt ?? r.createdAt, false)}</td>
                    <td>{r.hasPdf ? <a href={`/w/${slug}/bericht/${r.id}/pdf`} className="text-accent hover:underline">{t.pdf}</a> : <span className="text-muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
