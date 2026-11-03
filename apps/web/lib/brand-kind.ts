// Markentyp (brand.kind) – rein, auch im Browser nutzbar.
export const BRAND_KINDS = [
  { value: 'provider', label: 'Anbieter' },
  { value: 'portal', label: 'Vergleichsportal' },
  { value: 'retailer', label: 'Händler' },
  { value: 'other', label: 'Sonstiges' },
] as const;
export type BrandKind = (typeof BRAND_KINDS)[number]['value'];
export const isBrandKind = (v: unknown): v is BrandKind => BRAND_KINDS.some((k) => k.value === v);

/** Leere Eingabe → null (unbekannt); ungültig → undefined. */
export function parseBrandKind(v: string): BrandKind | null | undefined {
  if (!v) return null;
  return isBrandKind(v) ? v : undefined;
}

export const DESCRIPTION_MAX = 600;
/** Beschreibung säubern: Leerzeichen zusammenfassen, kürzen. Leer → null. */
export function cleanDescription(v: string): string | null {
  const t = v.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
  return t || null;
}
