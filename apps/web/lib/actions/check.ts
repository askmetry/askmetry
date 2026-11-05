'use server';
// Schnell-Check: optionale Benachrichtigung per Mail. Alles Weitere (Mail, Ratenbegrenzung, Turnstile-Prüfung) macht submitCheckEmail im Kern.
import { revalidatePath } from 'next/cache';
import { getI18n } from '@/lib/i18n/server';
import { submitCheckEmail } from '@/lib/hosted/data';
import { clientIp, isHosted } from '@/lib/hosted/server';

export type CheckEmailState = { error?: string; ok?: boolean; sentTo?: string } | null;

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export async function submitEmail(_prev: CheckEmailState, f: FormData): Promise<CheckEmailState> {
  const { t } = await getI18n();
  const e = t.check.states.errors;
  if (!isHosted()) return { error: e.not_found };
  const token = String(f.get('token') ?? '');
  const email = String(f.get('email') ?? '').trim().slice(0, 254);
  if (!TOKEN_RE.test(token)) return { error: e.not_found };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: e.invalid_email };
  const turnstileToken = String(f.get('cf-turnstile-response') ?? '') || null;
  let r: Awaited<ReturnType<typeof submitCheckEmail>>;
  try {
    r = await submitCheckEmail(token, email, { turnstileToken, ip: await clientIp() });
  } catch {
    return { error: e.generic }; // z. B. Mailversand fehlgeschlagen – der Kern meldet es dem Betrieb
  }
  if ('error' in r) return { error: r.error === 'rate_limited' ? t.check.notify.rateLimited : e[r.error] ?? e.generic };
  revalidatePath(`/check/${token}`);
  return { ok: true };
}
