// Fake-Checkout (nur ASKMETRY_PAYMENTS=fake; sonst 404). Zeigt Bericht und Betrag; die Buttons laufen über
// dieselben Kern-Funktionen wie der Stripe-Webhook. Nur der Käufer selbst sieht seine Session.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '../../../lib/session';
import { getI18n } from '../../../lib/i18n/server';
import { fakeCheckoutEnabled, loadFakeSession } from '../../../lib/billing/fake';
import { cancelFakeCheckout, completeFakeCheckout } from '../../../lib/billing/fake-actions';
import { VAT_RATE, vatOf } from '../../../lib/billing/price';

export const metadata = { robots: { index: false, follow: false } };

export default async function FakeCheckoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!fakeCheckoutEnabled()) notFound();
  const { sessionId } = await params;
  const session = await getSession();
  if (!session) redirect('/login');
  const s = await loadFakeSession(sessionId, session.user.id);
  if (!s) notFound();

  const { t, locale } = await getI18n();
  const b = t.billing;
  const money = (cents: number) =>
    new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: s.currency.toUpperCase() }).format(cents / 100);
  const vat = vatOf(s.amountCents);
  const pct = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US', { style: 'percent' }).format(VAT_RATE);
  const pending = s.status === 'pending_payment';

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div role="alert" className="rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 px-4 py-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-semibold">{b.fake.banner}</p>
        <p className="mt-1 text-sm">{b.fake.bannerText}</p>
      </div>

      <h1 className="mt-8 text-xl font-semibold tracking-tight">{b.fake.pageTitle}</h1>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{b.fake.product}</dt>
          <dd className="text-right font-medium">{b.tier[s.tier]}{s.kind === 'remeasure' ? ` · ${b.kind.remeasure}` : ''}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{b.fake.net}</dt>
          <dd className="num">{money(s.amountCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{b.fake.vat(pct)}</dt>
          <dd className="num">{money(vat)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
          <dt>{b.fake.gross}</dt>
          <dd className="num">{money(s.amountCents + vat)}</dd>
        </div>
      </dl>

      {pending ? (
        <div className="mt-8 flex flex-wrap gap-3">
          <form action={completeFakeCheckout}>
            <input type="hidden" name="sessionId" value={s.sessionId} />
            <button type="submit" className="btn btn-primary">{b.fake.pay}</button>
          </form>
          <form action={cancelFakeCheckout}>
            <input type="hidden" name="sessionId" value={s.sessionId} />
            <button type="submit" className="btn">{b.fake.cancel}</button>
          </form>
        </div>
      ) : (
        <div className="mt-8">
          <p className="text-sm text-muted">{b.fake.notPending}</p>
          <Link href={s.success} className="btn btn-primary mt-4">{b.fake.toReport}</Link>
        </div>
      )}
    </main>
  );
}
