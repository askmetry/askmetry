// Legt die Stripe-Preise der gehosteten Askmetry-Version an (nur Testmodus). Aufruf aus dem Repo-Root:
//   pnpm tsx scripts/stripe-setup.ts [--dry-run] [--tax-rate]
// Liest STRIPE_SECRET_KEY (und ASKMETRY_PUBLIC_URL) aus der Umgebung bzw. der Root-.env. Der Schlüssel wird nie ausgegeben.
//
// Sicherheitsregeln (im Stripe-Konto der lindotech GmbH gibt es andere Produkte mit zahlenden Kunden):
// - Live-Schlüssel (sk_live_/rk_live_) werden verweigert.
// - Es werden nur NEUE Objekte angelegt (Preise mit eigenem Produkt per product_data, optional ein Steuersatz).
//   Bestehende Produkte/Preise/Steuersätze werden nie geändert, archiviert oder per transfer_lookup_key übernommen.
// - Idempotent über lookup_key: ist der Preis schon da, wird er nur angezeigt (bei abweichendem Betrag: Warnung, Abbruch).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

/** gleiche Version wie apps/web/lib/billing/provider.ts (STRIPE_API_VERSION) */
export const STRIPE_API_VERSION = '2026-10-28.endive' as const;

export interface PriceSpec { key: 'compact' | 'strategy' | 'remeasure_compact' | 'remeasure_strategy'; env: string; lookupKey: string; name: string; unitAmount: number }

export const PRICE_SPECS: PriceSpec[] = [
  { key: 'compact', env: 'STRIPE_PRICE_COMPACT', lookupKey: 'askmetry_compact_v1', name: 'Askmetry Standortbestimmung', unitAmount: 7900 },
  { key: 'strategy', env: 'STRIPE_PRICE_STRATEGY', lookupKey: 'askmetry_strategy_v1', name: 'Askmetry Strategiebericht', unitAmount: 24900 },
  { key: 'remeasure_compact', env: 'STRIPE_PRICE_REMEASURE_COMPACT', lookupKey: 'askmetry_remeasure_compact_v1', name: 'Askmetry Nachmessung Standortbestimmung', unitAmount: 3900 },
  { key: 'remeasure_strategy', env: 'STRIPE_PRICE_REMEASURE_STRATEGY', lookupKey: 'askmetry_remeasure_strategy_v1', name: 'Askmetry Nachmessung Strategiebericht', unitAmount: 11900 },
];
export const TAX_RATE_KEY = 'askmetry_de_vat_19';
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'charge.refunded',
];

/** Nur Testschlüssel. Gibt eine Fehlermeldung zurück oder null. */
export function keyProblem(key: string | undefined): string | null {
  if (!key) return 'STRIPE_SECRET_KEY fehlt';
  if (/^(sk|rk)_live_/.test(key)) return 'Live-Schlüssel verweigert – dieses Skript läuft nur mit Testschlüsseln (sk_test_/rk_test_).';
  if (!/^(sk|rk)_test_/.test(key)) return 'Unbekanntes Schlüsselformat – erwartet sk_test_… oder rk_test_….';
  return null;
}

type Api = Pick<Stripe, 'prices' | 'taxRates'>;
type Log = (m: string) => void;

/** Preis per lookup_key finden oder neu anlegen. Bestehende Preise werden nie verändert. */
export async function ensurePrice(api: Api, spec: PriceSpec, opts: { dryRun: boolean; log: Log }): Promise<string | null> {
  const found = await api.prices.list({ lookup_keys: [spec.lookupKey], limit: 1 });
  const p = found.data[0];
  if (p) {
    const ok = p.unit_amount === spec.unitAmount && p.currency === 'eur' && p.type === 'one_time' && p.tax_behavior === 'exclusive';
    if (!p.active) { opts.log(`✗ ${spec.lookupKey}: Preis ${p.id} ist archiviert – wird NICHT reaktiviert. Bitte neuen lookup_key (…_v2) verwenden.`); return null; }
    if (!ok) { opts.log(`✗ ${spec.lookupKey}: Preis ${p.id} weicht ab (${p.unit_amount} ${p.currency}, ${p.type}, ${p.tax_behavior}) – wird NICHT geändert.`); return null; }
    opts.log(`✓ ${spec.lookupKey}: vorhanden (${p.id})`);
    return p.id;
  }
  if (opts.dryRun) { opts.log(`… ${spec.lookupKey}: würde angelegt (${spec.unitAmount} Cent netto)`); return null; }
  const created = await api.prices.create({
    currency: 'eur', unit_amount: spec.unitAmount, tax_behavior: 'exclusive', lookup_key: spec.lookupKey,
    product_data: { name: spec.name, metadata: { app: 'askmetry', price_key: spec.key } },
    metadata: { app: 'askmetry', price_key: spec.key },
  }, { idempotencyKey: `askmetry-setup-${spec.lookupKey}` });
  opts.log(`+ ${spec.lookupKey}: angelegt (${created.id}, Produkt ${typeof created.product === 'string' ? created.product : created.product.id})`);
  return created.id;
}

/** Steuersatz 19 % DE exklusiv (per metadata erkannt) finden oder anlegen. */
export async function ensureTaxRate(api: Api, opts: { dryRun: boolean; log: Log }): Promise<string | null> {
  for await (const r of api.taxRates.list({ active: true, limit: 100 })) {
    if (r.metadata?.askmetry_key === TAX_RATE_KEY) {
      if (r.percentage !== 19 || r.inclusive || r.country !== 'DE') { opts.log(`✗ Steuersatz ${r.id} weicht ab – wird NICHT geändert.`); return null; }
      opts.log(`✓ Steuersatz vorhanden (${r.id})`);
      return r.id;
    }
  }
  if (opts.dryRun) { opts.log('… Steuersatz 19 % DE (exklusiv) würde angelegt'); return null; }
  const r = await api.taxRates.create({
    display_name: 'USt', description: 'Umsatzsteuer Deutschland 19 % (Askmetry)', percentage: 19, inclusive: false,
    country: 'DE', jurisdiction: 'DE', tax_type: 'vat', metadata: { askmetry_key: TAX_RATE_KEY, app: 'askmetry' },
  }, { idempotencyKey: `askmetry-setup-${TAX_RATE_KEY}` });
  opts.log(`+ Steuersatz angelegt (${r.id})`);
  return r.id;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const withTax = args.has('--tax-rate');
  const envFile = resolve(process.cwd(), '.env');
  if (!process.env.STRIPE_SECRET_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const problem = keyProblem(key);
  if (problem) { console.error(problem); process.exit(1); }
  const stripe = new Stripe(key!, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 });
  const log: Log = (m) => console.log(m);

  const ids: Record<string, string | null> = {};
  for (const s of PRICE_SPECS) ids[s.env] = await ensurePrice(stripe, s, { dryRun, log });
  const taxRateId = withTax ? await ensureTaxRate(stripe, { dryRun, log }) : null;

  const base = (process.env.ASKMETRY_PUBLIC_URL ?? 'https://askmetry.ai').replace(/\/+$/, '');
  console.log('\n# In die .env übernehmen:');
  for (const s of PRICE_SPECS) console.log(`${s.env}=${ids[s.env] ?? '<fehlt>'}`);
  if (withTax) console.log(`STRIPE_TAX_RATE_ID=${taxRateId ?? '<fehlt>'}`);
  else console.log('# Steuer: STRIPE_AUTOMATIC_TAX=1 (Stripe Tax) oder mit --tax-rate einen festen Satz anlegen → STRIPE_TAX_RATE_ID');
  console.log(`\n# Webhook-Endpunkt (Dashboard → Entwickler → Webhooks): ${base}/api/stripe/webhook`);
  console.log(`# Events: ${WEBHOOK_EVENTS.join(', ')}`);
  console.log('# Signing-Secret (whsec_…) → STRIPE_WEBHOOK_SECRET');
  if (Object.values(ids).some((v) => !v) || (withTax && !taxRateId)) process.exitCode = dryRun ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Fehler: ${e instanceof Error ? `${e.name}${(e as { code?: string }).code ? ` (${(e as { code?: string }).code})` : ''}: ${e.message}` : e}`);
    process.exit(1);
  });
}
