// Sprachauswahl der Oberfläche (rein, ohne Next-Imports – testbar und im Client nutzbar).
// Reihenfolge: Cookie (vom Umschalter gesetzt) → Accept-Language → Deutsch. Keine Sprach-Präfixe in URLs.
import type { Lang } from '@askmetry/core/present';

export const LOCALES = ['de', 'en'] as const satisfies readonly Lang[];
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';
export const LOCALE_COOKIE = 'askmetry_locale';
/** Cookie hält ein Jahr */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Namen der Sprachen in der eigenen Sprache (für den Umschalter) */
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/**
 * Accept-Language auswerten („en-US,en;q=0.9,de;q=0.8“): Einträge nach q absteigend (bei Gleichstand in Reihenfolge),
 * erste unterstützte Hauptsprache gewinnt. q=0 heißt „nicht gewünscht“. Nichts Passendes → null.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const entries = header.split(',').map((part, i) => {
    const [tag, ...params] = part.trim().split(';');
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qp ? Number(qp.slice(2)) : 1;
    return { lang: (tag ?? '').trim().toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0, i };
  }).filter((e) => e.lang && e.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const e of entries) if (isLocale(e.lang)) return e.lang;
  return null;
}

export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}
