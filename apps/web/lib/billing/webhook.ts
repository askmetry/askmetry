// Stripe-Webhook: Signatur prüfen, Event auf eine Aktion abbilden, Aktion über die Kern-Funktionen ausführen.
// Rein bis auf die übergebenen Abhängigkeiten (testbar ohne Netz/DB). Keine personenbezogenen Daten loggen –
// nur Event-Typ, Event-ID und Session-/PaymentIntent-IDs.
import Stripe from 'stripe';
import { METADATA_APP } from './provider';

export type WebhookAction =
  | { type: 'paid'; sessionId: string; paymentIntentId: string | null; invoiceId: string | null; amountCents: number | null }
  | { type: 'canceled'; sessionId: string }
  | { type: 'refunded'; paymentIntentId: string }
  | { type: 'ignore'; reason: string };

const idOf = (v: string | { id: string } | null | undefined) => (v == null ? null : typeof v === 'string' ? v : v.id);

/** Nur Sessions, die Askmetry angelegt hat (metadata.app). Andere Produkte im selben Stripe-Konto bleiben unberührt. */
const ours = (s: Stripe.Checkout.Session) => s.metadata?.app === METADATA_APP;

/** Bezahlte Session → Daten für markReportPaid. amountCents = tatsächlich gezahlter Nettobetrag (nach Rabatt, ohne USt). */
function paidAction(s: Stripe.Checkout.Session): WebhookAction {
  const tax = s.total_details?.amount_tax ?? 0;
  return {
    type: 'paid', sessionId: s.id,
    paymentIntentId: idOf(s.payment_intent), invoiceId: idOf(s.invoice),
    amountCents: s.amount_total == null ? null : s.amount_total - tax,
  };
}

export function eventAction(event: Stripe.Event): WebhookAction {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      if (!ours(s)) return { type: 'ignore', reason: 'foreign session' };
      // 'unpaid' = asynchrone Zahlart (z. B. SEPA) läuft noch → async_payment_succeeded abwarten.
      // 'no_payment_required' = 100-%-Gutschein (Pilotkunden) → gilt als bezahlt.
      if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') return paidAction(s);
      return { type: 'ignore', reason: `payment_status ${s.payment_status}` };
    }
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object;
      return ours(s) ? paidAction(s) : { type: 'ignore', reason: 'foreign session' };
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const s = event.data.object;
      return ours(s) ? { type: 'canceled', sessionId: s.id } : { type: 'ignore', reason: 'foreign session' };
    }
    case 'charge.refunded': {
      const c = event.data.object;
      const pi = idOf(c.payment_intent);
      if (!pi) return { type: 'ignore', reason: 'no payment_intent' };
      // Teilerstattung: Bericht bleibt gültig (nur volle Erstattung setzt `refunded`)
      if (!c.refunded) return { type: 'ignore', reason: 'partial refund' };
      return { type: 'refunded', paymentIntentId: pi };
    }
    default:
      return { type: 'ignore', reason: 'unhandled event' };
  }
}

export interface WebhookDeps {
  webhookSecret: string | undefined;
  markReportPaid: (i: { sessionId: string; paymentIntentId?: string | null; invoiceId?: string | null; amountCents?: number | null }) => Promise<unknown>;
  markReportCanceled: (sessionId: string) => Promise<void>;
  markReportRefunded: (paymentIntentId: string) => Promise<void>;
  /** Benachrichtigung an den Betrieb (Telegram); nie werfen */
  notifyOps?: (text: string) => Promise<void>;
  /** erwarteter Modus aus dem Schlüssel (sk_live_ → true, sk_test_ → false); undefined = nicht prüfen */
  expectLivemode?: boolean;
  log?: (msg: string) => void;
}

/** Modus des Secret-Keys: live/test, unbekannt → undefined */
export const livemodeOfKey = (key: string | undefined) => (!key ? undefined : /^(sk|rk)_live_/.test(key) ? true : /^(sk|rk)_test_/.test(key) ? false : undefined);

export interface WebhookResult { status: number; body: string }

/**
 * Verarbeitet einen Webhook-Aufruf. 400 bei fehlender/ungültiger Signatur, 200 bei Erfolg und bei unbekannten Events,
 * 500 bei Fehlern der Kern-Funktionen (Stripe wiederholt dann; die Kern-Funktionen sind idempotent).
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResult> {
  const log = deps.log ?? ((m: string) => console.info(m));
  if (!deps.webhookSecret) {
    log('[stripe-webhook] STRIPE_WEBHOOK_SECRET fehlt');
    return { status: 500, body: 'webhook not configured' };
  }
  if (!signature) return { status: 400, body: 'missing signature' };
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, deps.webhookSecret);
  } catch {
    log('[stripe-webhook] ungültige Signatur');
    return { status: 400, body: 'invalid signature' };
  }
  // Test-Events dürfen keinen Live-Bericht freischalten (und umgekehrt)
  const action: WebhookAction = deps.expectLivemode !== undefined && event.livemode !== deps.expectLivemode
    ? { type: 'ignore', reason: 'livemode mismatch' }
    : eventAction(event);
  try {
    switch (action.type) {
      case 'paid': {
        const r = await deps.markReportPaid({ sessionId: action.sessionId, paymentIntentId: action.paymentIntentId, invoiceId: action.invoiceId, amountCents: action.amountCents });
        if (r == null) {
          // Geld eingegangen, aber kein passender Bericht → laut melden (nur IDs, keine Personendaten); 200, damit Stripe nicht endlos wiederholt
          const reportId = (event.data.object as { metadata?: Record<string, string> | null }).metadata?.reportId ?? '?';
          const msg = `[stripe-webhook] Zahlung ohne Bericht: Session ${action.sessionId}, reportId ${reportId}, Event ${event.id}`;
          log(msg);
          await deps.notifyOps?.(`⚠️ Askmetry: ${msg.replace('[stripe-webhook] ', '')} – bitte prüfen`).catch(() => {});
        }
        break;
      }
      case 'canceled':
        await deps.markReportCanceled(action.sessionId);
        break;
      case 'refunded':
        await deps.markReportRefunded(action.paymentIntentId);
        break;
      case 'ignore':
        break;
    }
  } catch (e) {
    log(`[stripe-webhook] ${event.type} ${event.id} fehlgeschlagen: ${e instanceof Error ? e.name : 'Fehler'}`);
    return { status: 500, body: 'processing failed' };
  }
  log(`[stripe-webhook] ${event.type} ${event.id} → ${action.type}${action.type === 'ignore' ? ` (${action.reason})` : ''}`);
  return { status: 200, body: 'ok' };
}
