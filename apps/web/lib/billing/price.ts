// Preise für die Oberfläche (rein, ohne DB/Stripe – auch in Client-Komponenten nutzbar, solange der Server die Config liefert).
// Quelle der Beträge ist `hostedConfig().priceCents` (netto); die Stripe-Preise müssen dieselben Beträge haben (scripts/stripe-setup.ts).
import { hostedConfig, priceKey, type HostedConfig, type ReportKind, type ReportTier } from '@askmetry/core/hosted/config';

/** Deutsche Umsatzsteuer (Regelsatz), auf den Nettopreis aufgeschlagen. */
export const VAT_RATE = 0.19;
export const CURRENCY = 'eur';

export interface PriceInfo {
  tier: ReportTier;
  kind: ReportKind;
  /** Beta-Preis netto in Cent */
  netCents: number;
  /** durchgestrichener Listenpreis netto (nur Erstbericht), sonst null */
  listCents: number | null;
  currency: typeof CURRENCY;
  vatRate: number;
  /** 19 % USt auf netCents (kaufmännisch gerundet) */
  vatCents: number;
  grossCents: number;
}

export const vatOf = (netCents: number) => Math.round(netCents * VAT_RATE);

export function priceInfo(tier: ReportTier, kind: ReportKind, cfg: Pick<HostedConfig, 'priceCents' | 'listPriceCents'> = hostedConfig()): PriceInfo {
  const netCents = cfg.priceCents[priceKey(tier, kind)];
  const list = kind === 'initial' ? cfg.listPriceCents[tier] : null;
  const vatCents = vatOf(netCents);
  return {
    tier, kind, netCents,
    listCents: list && list > netCents ? list : null,
    currency: CURRENCY, vatRate: VAT_RATE, vatCents, grossCents: netCents + vatCents,
  };
}
