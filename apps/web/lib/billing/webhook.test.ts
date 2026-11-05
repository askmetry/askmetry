import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { eventAction, handleStripeWebhook, livemodeOfKey, type WebhookDeps } from './webhook';

const SECRET = 'whsec_test_secret';
const session = (o: Record<string, unknown> = {}) => ({
  id: 'cs_test_1', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_1', invoice: 'in_1',
  amount_total: 9401, total_details: { amount_tax: 1501, amount_discount: 0, amount_shipping: 0 },
  metadata: { app: 'askmetry', reportId: 'r1' }, ...o,
});
const event = (type: string, object: unknown) => ({ id: 'evt_1', object: 'event', type, data: { object } }) as unknown as Stripe.Event;
const signed = (payload: string, secret = SECRET) => Stripe.webhooks.generateTestHeaderString({ payload, secret });

function deps(): WebhookDeps & { [k: string]: any } {
  return {
    webhookSecret: SECRET,
    markReportPaid: vi.fn(async () => ({ reportId: 'r1', already: false })),
    markReportCanceled: vi.fn(async () => {}),
    markReportRefunded: vi.fn(async () => {}),
    log: vi.fn(),
  };
}

describe('eventAction', () => {
  it('checkout.session.completed + paid → paid mit Nettobetrag', () => {
    expect(eventAction(event('checkout.session.completed', session()))).toEqual({
      type: 'paid', sessionId: 'cs_test_1', paymentIntentId: 'pi_1', invoiceId: 'in_1', amountCents: 7900,
    });
  });
  it('erweiterte Objekte (payment_intent als Objekt) werden auf IDs reduziert', () => {
    const a = eventAction(event('checkout.session.completed', session({ payment_intent: { id: 'pi_x' }, invoice: null })));
    expect(a).toMatchObject({ paymentIntentId: 'pi_x', invoiceId: null });
  });
  it('unpaid (asynchrone Zahlart) wird ignoriert', () => {
    expect(eventAction(event('checkout.session.completed', session({ payment_status: 'unpaid' }))).type).toBe('ignore');
  });
  it('no_payment_required (100-%-Gutschein) gilt als bezahlt', () => {
    expect(eventAction(event('checkout.session.completed', session({ payment_status: 'no_payment_required', amount_total: 0, total_details: { amount_tax: 0 } })))).toMatchObject({ type: 'paid', amountCents: 0 });
  });
  it('async_payment_succeeded → paid', () => {
    expect(eventAction(event('checkout.session.async_payment_succeeded', session())).type).toBe('paid');
  });
  it('expired und async_payment_failed → canceled', () => {
    expect(eventAction(event('checkout.session.expired', session({ payment_status: 'unpaid' })))).toEqual({ type: 'canceled', sessionId: 'cs_test_1' });
    expect(eventAction(event('checkout.session.async_payment_failed', session())).type).toBe('canceled');
  });
  it('fremde Sessions (andere Produkte im Konto) werden ignoriert', () => {
    for (const t of ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired']) {
      expect(eventAction(event(t, session({ metadata: { app: 'paylindo' } }))).type).toBe('ignore');
      expect(eventAction(event(t, session({ metadata: {} }))).type).toBe('ignore');
    }
  });
  it('charge.refunded: volle Erstattung → refunded, Teilerstattung → ignore', () => {
    expect(eventAction(event('charge.refunded', { id: 'ch_1', refunded: true, payment_intent: 'pi_1' }))).toEqual({ type: 'refunded', paymentIntentId: 'pi_1' });
    expect(eventAction(event('charge.refunded', { id: 'ch_1', refunded: false, payment_intent: 'pi_1' })).type).toBe('ignore');
    expect(eventAction(event('charge.refunded', { id: 'ch_1', refunded: true, payment_intent: null })).type).toBe('ignore');
  });
  it('unbekannte Events → ignore', () => {
    expect(eventAction(event('customer.created', { id: 'cus_1' })).type).toBe('ignore');
  });
});

describe('handleStripeWebhook', () => {
  it('gültige Signatur → markReportPaid, 200', async () => {
    const d = deps();
    const payload = JSON.stringify(event('checkout.session.completed', session()));
    const r = await handleStripeWebhook(payload, signed(payload), d);
    expect(r.status).toBe(200);
    expect(d.markReportPaid).toHaveBeenCalledWith({ sessionId: 'cs_test_1', paymentIntentId: 'pi_1', invoiceId: 'in_1', amountCents: 7900 });
  });
  it('ungültige Signatur → 400, nichts passiert', async () => {
    const d = deps();
    const payload = JSON.stringify(event('checkout.session.completed', session()));
    expect((await handleStripeWebhook(payload, signed(payload, 'whsec_other'), d)).status).toBe(400);
    expect((await handleStripeWebhook(payload, null, d)).status).toBe(400);
    // manipulierter Body mit alter Signatur
    const sig = signed(payload);
    expect((await handleStripeWebhook(payload.replace('9401', '1'), sig, d)).status).toBe(400);
    expect((await handleStripeWebhook(payload.replace('"paid"', '"paid" '), sig, d)).status).toBe(400);
    expect(d.markReportPaid).not.toHaveBeenCalled();
  });
  it('ohne Webhook-Secret → 500 (Fehlkonfiguration), nichts passiert', async () => {
    const d = { ...deps(), webhookSecret: undefined };
    const payload = JSON.stringify(event('checkout.session.completed', session()));
    expect((await handleStripeWebhook(payload, signed(payload), d)).status).toBe(500);
    expect(d.markReportPaid).not.toHaveBeenCalled();
  });
  it('expired → markReportCanceled; refunded → markReportRefunded; unbekannt → 200 ohne Aufruf', async () => {
    const d = deps();
    let p = JSON.stringify(event('checkout.session.expired', session()));
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(200);
    expect(d.markReportCanceled).toHaveBeenCalledWith('cs_test_1');
    p = JSON.stringify(event('charge.refunded', { id: 'ch_1', refunded: true, payment_intent: 'pi_9' }));
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(200);
    expect(d.markReportRefunded).toHaveBeenCalledWith('pi_9');
    p = JSON.stringify(event('invoice.paid', { id: 'in_1' }));
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(200);
    expect(d.markReportPaid).not.toHaveBeenCalled();
  });
  it('Fehler im Kern → 500 (Stripe wiederholt), ohne Fehlertext im Log', async () => {
    const d = deps();
    d.markReportPaid = vi.fn(async () => { throw new Error('kunde@example.com kaputt'); });
    const p = JSON.stringify(event('checkout.session.completed', session()));
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(500);
    expect(JSON.stringify((d.log as any).mock.calls)).not.toContain('example.com');
  });
  it('Zahlung ohne passenden Bericht → 200, Meldung an den Betrieb (nur IDs)', async () => {
    const d = { ...deps(), notifyOps: vi.fn(async () => {}) };
    d.markReportPaid = vi.fn(async () => null);
    const p = JSON.stringify(event('checkout.session.completed', session({ customer_details: { email: 'kunde@example.com' } })));
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(200);
    expect(d.notifyOps).toHaveBeenCalledTimes(1);
    expect((d.notifyOps.mock.calls as any)[0][0]).toContain('cs_test_1');
    expect(JSON.stringify(d.notifyOps.mock.calls)).not.toContain('example.com');
  });
  it('livemode muss zum Schlüssel passen (Test-Event schaltet keinen Live-Bericht frei)', async () => {
    const d = { ...deps(), expectLivemode: true };
    const p = JSON.stringify({ ...event('checkout.session.completed', session()), livemode: false });
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(200);
    expect(d.markReportPaid).not.toHaveBeenCalled();
    const d2 = { ...deps(), expectLivemode: false };
    expect((await handleStripeWebhook(p, signed(p), d2)).status).toBe(200);
    expect(d2.markReportPaid).toHaveBeenCalledTimes(1);
    expect([livemodeOfKey('sk_live_x'), livemodeOfKey('rk_test_x'), livemodeOfKey(undefined)]).toEqual([true, false, undefined]);
  });
  it('wiederholte Zustellung ruft markReportPaid erneut (Kern ist idempotent) und antwortet 200', async () => {
    const d = deps();
    d.markReportPaid = vi.fn(async () => ({ reportId: 'r1', already: true }));
    const p = JSON.stringify(event('checkout.session.completed', session()));
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(200);
    expect((await handleStripeWebhook(p, signed(p), d)).status).toBe(200);
  });
});

// Route Handler mit gemockten Kern-Funktionen
const core = vi.hoisted(() => ({
  markReportPaid: vi.fn(async () => ({ reportId: 'r1', already: false })),
  markReportCanceled: vi.fn(async () => {}),
  markReportRefunded: vi.fn(async () => {}),
}));
vi.mock('@askmetry/core/hosted/reports', () => core);
vi.mock('@askmetry/core/hosted/notify', () => ({ notifyOps: vi.fn(async () => {}) }));

describe('POST /api/stripe/webhook', () => {
  const env = { ...process.env };
  beforeEach(() => { process.env.ASKMETRY_HOSTED = '1'; process.env.STRIPE_WEBHOOK_SECRET = SECRET; vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });

  it('liest den Raw Body und prüft die Signatur', async () => {
    const { POST } = await import('../../app/api/stripe/webhook/route');
    const payload = JSON.stringify(event('checkout.session.completed', session()));
    const ok = await POST(new Request('http://x/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signed(payload) } }));
    expect(ok.status).toBe(200);
    expect(core.markReportPaid).toHaveBeenCalledTimes(1);
    const bad = await POST(new Request('http://x/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': 't=1,v1=abc' } }));
    expect(bad.status).toBe(400);
  });
  it('404 ohne Hosted-Modus', async () => {
    delete process.env.ASKMETRY_HOSTED;
    const { POST } = await import('../../app/api/stripe/webhook/route');
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }))).status).toBe(404);
  });
});
