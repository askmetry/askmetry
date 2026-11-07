'use server';
// Schnell-Check: optionale Mail (mit freiwilliger Einwilligung in Erinnerung/Tipps), Fragen und Themen vor dem Kauf.
// Berechtigung ist das Check-Token (wer den Link hat). Validierung, Ratenbegrenzung und Speichern macht der Kern.
import { revalidatePath } from 'next/cache';
import { getI18n } from '@/lib/i18n/server';
import { editCheckQuestions, editCheckTopics, giveCheckConsent, submitCheckEmail, type ListOp } from '@/lib/hosted/data';
import { clientIp, isHosted } from '@/lib/hosted/server';

export type CheckEmailState = { error?: string; ok?: boolean; sentTo?: string } | null;
export type CheckListState = { error?: string; ok?: boolean; list?: string[]; seq?: number } | null;

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
  // Einwilligung nur bei ausdrücklich gesetztem Häkchen (nie vorangekreuzt)
  const consent = f.get('consent') === 'on';
  let r: Awaited<ReturnType<typeof submitCheckEmail>>;
  try {
    r = await submitCheckEmail(token, email, { turnstileToken, ip: await clientIp(), consent });
  } catch {
    return { error: e.generic }; // z. B. Mailversand fehlgeschlagen – der Kern meldet es dem Betrieb
  }
  if ('error' in r) return { error: r.error === 'rate_limited' ? t.check.notify.rateLimited : e[r.error] ?? e.generic };
  revalidatePath(`/check/${token}`);
  return { ok: true };
}

/** Einwilligung nachträglich (Adresse schon angegeben, Häkchen damals nicht gesetzt). */
export async function giveConsent(_prev: CheckEmailState, f: FormData): Promise<CheckEmailState> {
  const { t } = await getI18n();
  const e = t.check.states.errors;
  const token = String(f.get('token') ?? '');
  if (!isHosted() || !TOKEN_RE.test(token)) return { error: e.not_found };
  if (f.get('consent') !== 'on') return { error: t.check.notify.consentRequired };
  const r = await giveCheckConsent(token);
  if ('error' in r) return { error: e[r.error] ?? e.generic };
  revalidatePath(`/check/${token}`);
  return { ok: true };
}

/** Eine Änderung an den Fragen (kind=questions) oder Themen (kind=topics) eines fertigen Checks. */
export async function editCheckList(_prev: CheckListState, f: FormData): Promise<CheckListState> {
  const { t } = await getI18n();
  const e = t.check.edit.errors;
  const token = String(f.get('token') ?? '');
  if (!isHosted() || !TOKEN_RE.test(token)) return { error: e.not_found };
  const kind = String(f.get('kind') ?? '');
  const action = String(f.get('action') ?? '');
  const text = String(f.get('text') ?? '').slice(0, 1000);
  const expected = String(f.get('expected') ?? '').slice(0, 1000);
  const index = Number(f.get('index'));
  if (kind !== 'questions' && kind !== 'topics') return { error: e.generic };
  let op: ListOp;
  if (action === 'add') op = { action, text };
  else if (action === 'edit') op = { action, index, expected, text };
  else if (action === 'delete') op = { action, index, expected };
  else return { error: e.generic };
  const r = await (kind === 'questions' ? editCheckQuestions : editCheckTopics)(token, op);
  if ('error' in r) return { error: (kind === 'topics' ? t.check.edit.topicErrors[r.error] : undefined) ?? e[r.error] ?? e.generic };
  revalidatePath(`/check/${token}`);
  return { ok: true, list: r.list, seq: Date.now() };
}
