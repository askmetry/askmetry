// Abmeldung von Erinnerungs-Mails (Nachmessung). Link HMAC-signiert mit BETTER_AUTH_SECRET.
// Die Adresse steht nicht im Klartext in der URL, sondern base64url-kodiert (Parameter `e`), Signatur in `sig`.
import { db, mailOptOut } from '@askmetry/db';
import { eq } from 'drizzle-orm';
import { publicUrl } from './config.ts';
import { hmac, normalizeEmail, safeEqual } from './util.ts';

const norm = (email: string) => normalizeEmail(email) ?? email.trim().toLowerCase();

export const optOutSig = (email: string) => hmac(`optout:${norm(email)}`);

/** Abmeldelink für Mails: `<public>/abmelden?e=<base64url(email)>&sig=<hmac>` */
export function optOutUrl(email: string): string {
  const e = Buffer.from(norm(email)).toString('base64url');
  return `${publicUrl()}/abmelden?e=${e}&sig=${optOutSig(email)}`;
}

/** Parameter `e` aus dem Link zurück in die Adresse (null bei Unsinn). */
export function decodeOptOutParam(e: string | null | undefined): string | null {
  if (!e || e.length > 400) return null;
  try { return normalizeEmail(Buffer.from(e, 'base64url').toString('utf8')); } catch { return null; }
}

export function verifyOptOut(email: string, sig: string): boolean {
  if (!email || !sig) return false;
  return safeEqual(optOutSig(email), sig);
}

export async function optOut(email: string): Promise<void> {
  await db.insert(mailOptOut).values({ email: norm(email) }).onConflictDoNothing();
}

export async function isOptedOut(email: string): Promise<boolean> {
  const rows = await db.select({ email: mailOptOut.email }).from(mailOptOut).where(eq(mailOptOut.email, norm(email))).limit(1);
  return rows.length > 0;
}
