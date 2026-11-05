// Kleine Helfer der gehosteten Version (Hashes, Tokens, E-Mail, Tagesgrenze Europe/Berlin).
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

export const sha256hex = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Zufälliger Schlüssel (Standard 32 Byte) als base64url. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Zeitkonstanter Vergleich zweier Hex-/Text-Werte gleicher Länge. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

let warned = false;
/** Server-Geheimnis (BETTER_AUTH_SECRET) für IP-Hashes und Abmeldelinks; in Entwicklung/Tests fester Ersatzwert. */
export function serverSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('BETTER_AUTH_SECRET fehlt');
  if (!warned) { warned = true; console.warn('[hosted] BETTER_AUTH_SECRET fehlt – Entwicklungs-Ersatzwert wird genutzt'); }
  return 'askmetry-dev-secret';
}

export const hmac = (data: string) => crypto.createHmac('sha256', serverSecret()).update(data).digest('base64url');

/** E-Mail kleingeschrieben und getrimmt; null, wenn offensichtlich ungültig. */
export function normalizeEmail(input: string | null | undefined): string | null {
  const e = (input ?? '').trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  // bewusst schlicht: ein @, Domain mit Punkt, keine Leer-/Steuerzeichen
  if (!/^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(e)) return null;
  if (e.split('@')[0].length > 64) return null;
  return e;
}

/** „max@firma.de“ → „m***@firma.de“ (für Anzeige und Logs). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Alle E-Mail-Adressen in einem Text vollständig entfernen (Telegram: gar keine Adressen, auch nicht maskiert). */
export const stripEmails = (t: string) => t.replace(/[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[E-Mail entfernt]');

/** Beginn des heutigen Kalendertags in Europe/Berlin (SQL-Ausdruck). */
export const berlinDayStart = sql`(date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')`;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const errText = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 500);
