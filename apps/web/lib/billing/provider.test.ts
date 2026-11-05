import { describe, expect, it, vi } from 'vitest';
import type { HostedConfig } from '@askmetry/core/hosted/config';
import { hostedConfig } from '@askmetry/core/hosted/config';
import { CHECKOUT_TTL_SECONDS, STRIPE_API_VERSION, fakeProvider, getProvider, getStripe, isFakeSessionId, newFakeSessionId, stripeProvider, stripeSessionParams, type CheckoutInput } from './provider';
import { STRIPE_API_VERSION as SETUP_VERSION } from '../../../../scripts/stripe-setup';
import { priceInfo } from './price';

function cfg(over: Partial<HostedConfig['stripe']> = {}, rest: Partial<HostedConfig> = {}): HostedConfig {
  const base = hostedConfig();
  return {
    ...base, hosted: true, publicUrl: 'https://askmetry.test', payments: 'stripe', ...rest,
    stripe: {
      secretKey: 'sk_test_x', webhookSecret: 'whsec_x', automaticTax: false, taxRateId: 'txr_19',
      prices: { compact: 'price_c', strategy: 'price_s', remeasure_compact: 'price_rc', remeasure_strategy: 'price_rs' }, ...over,
    },
  };
}
const input: CheckoutInput = {
  reportId: 'rep_1', tier: 'strategy', kind: 'initial', customerEmail: 'a@firma.de', locale: 'de',
  successUrl: 'https://askmetry.test/w/x/bericht/rep_1?checkout=done', cancelUrl: 'https://askmetry.test/check/t?checkout=canceled',
};

describe('stripeSessionParams', () => {
  it('Einmalzahlung mit Rechnung, USt-ID, Rechnungsadresse, festem Steuersatz, Gutscheinen, 24 h', () => {
    const now = Date.UTC(2026, 10, 5, 12);
    const p = stripeSessionParams(input, cfg(), now);
    expect(p).toMatchObject({
      mode: 'payment',
      line_items: [{ price: 'price_s', quantity: 1, tax_rates: ['txr_19'] }],
      customer_email: 'a@firma.de', customer_creation: 'always', billing_address_collection: 'required',
      tax_id_collection: { enabled: true }, allow_promotion_codes: true,
      invoice_creation: { enabled: true, invoice_data: { metadata: { app: 'askmetry', reportId: 'rep_1' } } },
      client_reference_id: 'rep_1', metadata: { app: 'askmetry', reportId: 'rep_1', tier: 'strategy', kind: 'initial' },
      payment_intent_data: { metadata: { reportId: 'rep_1' } },
      locale: 'de', success_url: input.successUrl, cancel_url: input.cancelUrl,
    });
    expect(p.automatic_tax).toBeUndefined();
    expect(p.discounts).toBeUndefined();
    expect(p.expires_at).toBe(now / 1000 + CHECKOUT_TTL_SECONDS);
    expect(CHECKOUT_TTL_SECONDS).toBeLessThanOrEqual(24 * 3600);
    expect(CHECKOUT_TTL_SECONDS).toBeGreaterThanOrEqual(23 * 3600);
  });
  it('STRIPE_AUTOMATIC_TAX=1 → automatic_tax statt tax_rates (nie beides)', () => {
    const p = stripeSessionParams(input, cfg({ automaticTax: true, taxRateId: undefined }));
    expect(p.automatic_tax).toEqual({ enabled: true });
    expect(p.line_items![0]).not.toHaveProperty('tax_rates');
  });
  it('Preis je tier/kind', () => {
    const c = cfg();
    expect(stripeSessionParams({ ...input, tier: 'compact' }, c).line_items![0].price).toBe('price_c');
    expect(stripeSessionParams({ ...input, tier: 'compact', kind: 'remeasure' }, c).line_items![0].price).toBe('price_rc');
    expect(stripeSessionParams({ ...input, kind: 'remeasure', locale: 'en' }, c)).toMatchObject({ line_items: [{ price: 'price_rs' }], locale: 'en' });
  });
  it('fehlender Preis oder Steuersatz → BillingConfigError', () => {
    expect(() => stripeSessionParams(input, cfg({ prices: {} }))).toThrow(/Preis/);
    expect(() => stripeSessionParams(input, cfg({ taxRateId: undefined }))).toThrow(/STRIPE_TAX_RATE_ID/);
  });
});

describe('Provider', () => {
  it('stripe: ruft checkout.sessions.create mit den Parametern (Client gemockt, kein Netz)', async () => {
    const create = vi.fn(async () => ({ id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9' }));
    const p = stripeProvider(() => ({ checkout: { sessions: { create } } }) as any, () => cfg());
    expect(await p.createCheckout(input)).toEqual({ sessionId: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9' });
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0] as any)[0]).toMatchObject({ mode: 'payment', client_reference_id: 'rep_1' });
  });
  it('stripe: ohne URL → Fehler', async () => {
    const p = stripeProvider(() => ({ checkout: { sessions: { create: async () => ({ id: 'cs', url: null }) } } }) as any, () => cfg());
    await expect(p.createCheckout(input)).rejects.toThrow();
  });
  it('fake: Session-ID fake_cs_<zufall>, URL auf /kasse', async () => {
    const r = await fakeProvider(() => cfg({}, { payments: 'fake' })).createCheckout(input);
    expect(r.sessionId).toMatch(/^fake_cs_/);
    expect(isFakeSessionId(r.sessionId)).toBe(true);
    expect(r.url).toBe(`https://askmetry.test/kasse/${r.sessionId}`);
    expect(newFakeSessionId()).not.toBe(newFakeSessionId());
    expect(isFakeSessionId('cs_test_1')).toBe(false);
    expect(isFakeSessionId('fake_cs_../../x')).toBe(false);
  });
  it('getProvider folgt ASKMETRY_PAYMENTS', () => {
    expect(getProvider(cfg({}, { payments: 'fake' }), false).name).toBe('fake');
    expect(getProvider(cfg(), true).name).toBe('stripe');
    expect(() => getProvider(cfg({}, { payments: 'fake' }), true)).toThrow(/Produktion/);
  });
  it('Stripe-Client mit fest gepinnter API-Version; ohne Schlüssel Fehler', () => {
    expect(STRIPE_API_VERSION).toBe(SETUP_VERSION);
    expect(() => getStripe(cfg({ secretKey: undefined }))).toThrow(/STRIPE_SECRET_KEY/);
    const s = getStripe(cfg());
    expect((s as any)._api?.version ?? (s as any).getApiField?.('version')).toBe(STRIPE_API_VERSION);
  });
});

describe('priceInfo', () => {
  it('netto, Liste, USt, brutto', () => {
    const c = cfg();
    expect(priceInfo('compact', 'initial', c)).toEqual({ tier: 'compact', kind: 'initial', netCents: 7900, listCents: 9900, currency: 'eur', vatRate: 0.19, vatCents: 1501, grossCents: 9401 });
    expect(priceInfo('strategy', 'remeasure', c)).toMatchObject({ netCents: 11900, listCents: null, vatCents: 2261, grossCents: 14161 });
  });
});
