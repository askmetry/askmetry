// Reine Hilfsfunktionen der Startseite (ohne Next-Imports, getestet in format.test.ts).
import type { Locale } from '@/lib/i18n/config';

const INTL: Record<Locale, string> = { de: 'de-DE', en: 'en-US' };

/** Cent-Betrag als Euro: ganze Beträge ohne Nachkommastellen („79 €“ / „€79“), sonst zwei („39,50 €“ / „€39.50“). */
export function formatEuro(cents: number, locale: Locale): string {
  const whole = Number.isInteger(cents / 100);
  return new Intl.NumberFormat(INTL[locale], {
    style: 'currency', currency: 'EUR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** Fehlerschlüssel des Schnell-Checks auf einen Text der Startseite abbilden (unbekannt → generic). */
export const CHECK_FORM_ERRORS = ['empty', 'invalid_url', 'unreachable', 'rate_limited', 'disabled', 'bot_check_failed', 'generic'] as const;
export type CheckFormError = (typeof CHECK_FORM_ERRORS)[number];
export function checkFormError(code: string | null | undefined): CheckFormError {
  return (CHECK_FORM_ERRORS as readonly string[]).includes(code ?? '') ? (code as CheckFormError) : 'generic';
}

/**
 * Client-IP für das Check-Limit. Nur ein Header, den der eigene Proxy setzt bzw. überschreibt, ist vertrauenswürdig:
 * ASKMETRY_CLIENT_IP_HEADER (z. B. cf-connecting-ip hinter Cloudflare, x-real-ip, wenn der Proxy ihn überschreibt).
 * Ohne Einstellung: der LETZTE x-forwarded-for-Eintrag (vom eigenen Reverse-Proxy, z. B. Caddy, angehängt) – alle
 * anderen Header und frühere XFF-Einträge kommen vom Client und sind fälschbar.
 */
export function clientIp(h: { get(name: string): string | null }, header = process.env.ASKMETRY_CLIENT_IP_HEADER?.trim().toLowerCase()): string | null {
  if (header && header !== 'x-forwarded-for') return h.get(header)?.split(',')[0]?.trim() || null;
  return h.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).at(-1) ?? null;
}

/** Grobe Vorprüfung der Eingabe (die echte Prüfung macht startCheck): leer → 'empty', ohne Punkt/mit Leerzeichen → 'invalid_url'. */
export function precheckUrl(raw: string): CheckFormError | null {
  const v = raw.trim();
  if (!v) return 'empty';
  const host = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0] ?? '';
  if (/\s/.test(v) || !host.includes('.') || host.startsWith('.') || host.endsWith('.')) return 'invalid_url';
  return null;
}
