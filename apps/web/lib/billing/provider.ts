// Zahlungsanbieter für den Berichtskauf: Stripe Checkout (Einmalzahlung) oder Fake-Checkout (nur Entwicklung/E2E).
// Auswahl über hostedConfig().payments (ASKMETRY_PAYMENTS). Bezahlstatus kommt nie von hier, sondern nur aus dem Webhook
// bzw. beim Fake-Checkout aus der Server Action auf /kasse/<id> (gleicher Pfad: markReportPaid).
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { hostedConfig, priceKey, type HostedConfig, type ReportKind, type ReportTier } from '@askmetry/core/hosted/config';

/** Fest gepinnte Stripe-API-Version (= Version des installierten SDK `stripe@23.1.0`). Bei SDK-Update bewusst anheben. */
export const STRIPE_API_VERSION = '2026-10-28.endive' as const;

/** Markierung in metadata, damit der Webhook nur eigene Checkout-Sessions verarbeitet (das Stripe-Konto hat andere Produkte). */
export const METADATA_APP = 'askmetry';

/** Gültigkeit einer Checkout-Session. Stripe erlaubt 30 Min. bis 24 h; knapp darunter, damit Uhrabweichungen nicht stören. */
export const CHECKOUT_TTL_SECONDS = 24 * 60 * 60 - 5 * 60;

export interface CheckoutInput {
  reportId: string;
  tier: ReportTier;
  kind: ReportKind;
  customerEmail: string;
  locale: 'de' | 'en';
  /** absolute URLs */
  successUrl: string;
  cancelUrl: string;
}
export interface CheckoutResult { url: string; sessionId: string }

export interface CheckoutProvider {
  readonly name: 'stripe' | 'fake';
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
}

export class BillingConfigError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BillingConfigError'; }
}

// ---------- Stripe ----------

let cached: { key: string; client: Stripe } | null = null;

/** Stripe-Client (einmal je Schlüssel). Wirft, wenn kein Schlüssel konfiguriert ist. */
export function getStripe(cfg: HostedConfig = hostedConfig()): Stripe {
  const key = cfg.stripe.secretKey;
  if (!key) throw new BillingConfigError('STRIPE_SECRET_KEY fehlt');
  if (cached?.key !== key) {
    cached = {
      key,
      client: new Stripe(key, {
        apiVersion: STRIPE_API_VERSION,
        maxNetworkRetries: 2,
        timeout: 20_000,
        appInfo: { name: 'Askmetry', url: 'https://askmetry.ai' },
      }),
    };
  }
  return cached.client;
}

/**
 * Parameter der Checkout-Session (rein, testbar). Geprüft gegen docs.stripe.com (11/2026):
 * - payment-Modus + invoice_creation → bezahlte Rechnung (PDF) nach der Zahlung, Kundendaten/USt-ID erscheinen darauf.
 * - customer_creation 'always' → Customer-Objekt; tax_id_collection speichert USt-ID + Firmenname am Customer.
 * - automatic_tax nutzt bei neuen Kunden die erfasste Rechnungsadresse (customer_update nur bei bestehendem `customer` nötig).
 * - tax_rates (fester Satz) und automatic_tax schließen sich aus → genau eins von beiden.
 * - allow_promotion_codes ist nicht mit `discounts` kombinierbar (wird nicht gesetzt).
 */
export function stripeSessionParams(input: CheckoutInput, cfg: HostedConfig, now = Date.now()): Stripe.Checkout.SessionCreateParams {
  const key = priceKey(input.tier, input.kind);
  const price = cfg.stripe.prices[key];
  if (!price) throw new BillingConfigError(`Stripe-Preis für ${key} fehlt`);
  const auto = cfg.stripe.automaticTax;
  if (!auto && !cfg.stripe.taxRateId) throw new BillingConfigError('STRIPE_TAX_RATE_ID fehlt (oder STRIPE_AUTOMATIC_TAX=1)');
  const metadata = { app: METADATA_APP, reportId: input.reportId, tier: input.tier, kind: input.kind };
  return {
    mode: 'payment',
    line_items: [{ price, quantity: 1, ...(auto ? {} : { tax_rates: [cfg.stripe.taxRateId!] }) }],
    ...(auto ? { automatic_tax: { enabled: true } } : {}),
    customer_email: input.customerEmail,
    customer_creation: 'always',
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: input.locale === 'en' ? 'Askmetry report' : 'Askmetry-Bericht',
        metadata,
      },
    },
    payment_intent_data: { metadata },
    allow_promotion_codes: true,
    client_reference_id: input.reportId,
    metadata,
    locale: input.locale,
    expires_at: Math.floor(now / 1000) + CHECKOUT_TTL_SECONDS,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}

export function stripeProvider(client: () => Pick<Stripe, 'checkout'> = () => getStripe(), cfg: () => HostedConfig = hostedConfig): CheckoutProvider {
  return {
    name: 'stripe',
    async createCheckout(input) {
      const c = cfg();
      const params = stripeSessionParams(input, c);
      // Wiederholungen bei Netzfehlern (maxNetworkRetries) bekommen vom SDK automatisch denselben Idempotency-Key.
      // Kein eigener Key je Bericht: expires_at ändert sich je Aufruf, gleicher Key mit anderen Parametern wäre ein Fehler.
      const s = await client().checkout.sessions.create(params);
      if (!s.url) throw new Error('Stripe lieferte keine Checkout-URL');
      return { url: s.url, sessionId: s.id };
    },
  };
}

// ---------- Fake ----------

export const FAKE_SESSION_PREFIX = 'fake_cs_';
export const isFakeSessionId = (id: string) => /^fake_cs_[A-Za-z0-9_-]{16,64}$/.test(id);
export const newFakeSessionId = () => FAKE_SESSION_PREFIX + randomBytes(18).toString('base64url');

/** Fake-Checkout: keine Außenwirkung, leitet auf /kasse/<sessionId>; dort wird „bezahlt“ (nur mit ASKMETRY_PAYMENTS=fake). */
export function fakeProvider(cfg: () => HostedConfig = hostedConfig): CheckoutProvider {
  return {
    name: 'fake',
    async createCheckout() {
      const sessionId = newFakeSessionId();
      return { sessionId, url: `${cfg().publicUrl}/kasse/${sessionId}` };
    },
  };
}

/** Anbieter laut Konfiguration. */
export function getProvider(cfg: HostedConfig = hostedConfig(), production = process.env.NODE_ENV === 'production'): CheckoutProvider {
  // Fake-Zahlung ist in Produktion verboten (HOSTED.md) – sonst könnte jeder Bericht gratis „bezahlt“ werden
  if (cfg.payments === 'fake' && production) throw new BillingConfigError('ASKMETRY_PAYMENTS=fake ist in Produktion nicht erlaubt');
  return cfg.payments === 'fake' ? fakeProvider(() => cfg) : stripeProvider(() => getStripe(cfg), () => cfg);
}

/** Sitzungs-Kurzwahl für Aufrufer. */
export const createCheckout = (input: CheckoutInput) => getProvider().createCheckout(input);
