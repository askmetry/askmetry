// Stripe-Webhook (POST /api/stripe/webhook). Einzige Quelle für den Bezahlstatus echter Zahlungen.
// Raw Body (request.text()) – die Signatur gilt für die unveränderten Bytes.
import { hostedConfig, isHosted } from '@askmetry/core/hosted/config';
import { markReportCanceled, markReportPaid, markReportRefunded } from '@askmetry/core/hosted/reports';
import { notifyOps } from '@askmetry/core/hosted/notify';
import { handleStripeWebhook, livemodeOfKey } from '../../../../lib/billing/webhook';

export async function POST(request: Request): Promise<Response> {
  if (!isHosted()) return new Response('not found', { status: 404 });
  const raw = await request.text();
  const { stripe } = hostedConfig();
  const r = await handleStripeWebhook(raw, request.headers.get('stripe-signature'), {
    webhookSecret: stripe.webhookSecret, expectLivemode: livemodeOfKey(stripe.secretKey),
    markReportPaid, markReportCanceled, markReportRefunded, notifyOps,
  });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
