import { describe, expect, it, vi } from 'vitest';
import { PRICE_SPECS, ensurePrice, ensureTaxRate, keyProblem } from '../../../../scripts/stripe-setup';

const spec = PRICE_SPECS[0];
const okPrice = { id: 'price_1', active: true, unit_amount: spec.unitAmount, currency: 'eur', type: 'one_time', tax_behavior: 'exclusive' };
function api(found: unknown[] = [], rates: unknown[] = []) {
  return {
    prices: { list: vi.fn(async () => ({ data: found })), create: vi.fn(async () => ({ id: 'price_new', product: 'prod_new' })), update: vi.fn() },
    taxRates: {
      list: vi.fn(() => ({ async *[Symbol.asyncIterator]() { yield* rates as any[]; } })),
      create: vi.fn(async () => ({ id: 'txr_new' })), update: vi.fn(),
    },
  } as any;
}
const opts = { dryRun: false, log: () => {} };

describe('scripts/stripe-setup', () => {
  it('verweigert Live-Schlüssel', () => {
    expect(keyProblem('sk_live_abc')).toMatch(/Live/);
    expect(keyProblem('rk_live_abc')).toMatch(/Live/);
    expect(keyProblem(undefined)).toMatch(/fehlt/);
    expect(keyProblem('pk_test_abc')).toMatch(/format/i);
    expect(keyProblem('sk_test_abc')).toBeNull();
    expect(keyProblem('rk_test_abc')).toBeNull();
  });
  it('Preise: Beträge und lookup_keys wie im Vertrag', () => {
    expect(Object.fromEntries(PRICE_SPECS.map((s) => [s.key, s.unitAmount]))).toEqual({ compact: 7900, strategy: 24900, remeasure_compact: 3900, remeasure_strategy: 11900 });
    expect(new Set(PRICE_SPECS.map((s) => s.lookupKey)).size).toBe(4);
  });
  it('legt fehlenden Preis neu an (eigenes Produkt, exklusiv, EUR, einmalig)', async () => {
    const a = api();
    expect(await ensurePrice(a, spec, opts)).toBe('price_new');
    expect(a.prices.list).toHaveBeenCalledWith({ lookup_keys: [spec.lookupKey], limit: 1 });
    expect(a.prices.create.mock.calls[0][0]).toMatchObject({ currency: 'eur', unit_amount: 7900, tax_behavior: 'exclusive', lookup_key: spec.lookupKey, product_data: { name: spec.name } });
    expect(a.prices.create.mock.calls[0][0]).not.toHaveProperty('transfer_lookup_key');
    expect(a.prices.create.mock.calls[0][0]).not.toHaveProperty('recurring');
  });
  it('vorhandener Preis wird nur genutzt; abweichende/archivierte nie geändert', async () => {
    let a = api([okPrice]);
    expect(await ensurePrice(a, spec, opts)).toBe('price_1');
    expect(a.prices.create).not.toHaveBeenCalled();
    a = api([{ ...okPrice, unit_amount: 100 }]);
    expect(await ensurePrice(a, spec, opts)).toBeNull();
    a = api([{ ...okPrice, active: false }]);
    expect(await ensurePrice(a, spec, opts)).toBeNull();
    expect(a.prices.create).not.toHaveBeenCalled();
    expect(a.prices.update).not.toHaveBeenCalled();
  });
  it('dry-run legt nichts an', async () => {
    const a = api();
    expect(await ensurePrice(a, spec, { ...opts, dryRun: true })).toBeNull();
    expect(await ensureTaxRate(a, { ...opts, dryRun: true })).toBeNull();
    expect(a.prices.create).not.toHaveBeenCalled();
    expect(a.taxRates.create).not.toHaveBeenCalled();
  });
  it('Steuersatz 19 % DE exklusiv: vorhandenen nutzen, sonst anlegen', async () => {
    let a = api([], [{ id: 'txr_other', percentage: 19, inclusive: false, country: 'DE', metadata: {} }, { id: 'txr_1', percentage: 19, inclusive: false, country: 'DE', metadata: { askmetry_key: 'askmetry_de_vat_19' } }]);
    expect(await ensureTaxRate(a, opts)).toBe('txr_1');
    expect(a.taxRates.create).not.toHaveBeenCalled();
    a = api();
    expect(await ensureTaxRate(a, opts)).toBe('txr_new');
    expect(a.taxRates.create.mock.calls[0][0]).toMatchObject({ percentage: 19, inclusive: false, country: 'DE' });
  });
});
