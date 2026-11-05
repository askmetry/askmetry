'use server';
// Konto (gehostete Version): Konto löschen, Abmeldung von Erinnerungs-Mails.
import { cookies, headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { deleteUserData } from '@askmetry/core/hosted/account';
import { decodeOptOutParam, optOut, verifyOptOut } from '@askmetry/core/hosted/optout';
import { getI18n } from '@/lib/i18n/server';
import { isHosted } from '@/lib/hosted/server';
import { requireUser } from '@/lib/session';
import type { FormState } from './workspaces';

export async function deleteAccount(_p: FormState, f: FormData): Promise<FormState> {
  const { t } = await getI18n();
  if (!isHosted()) return { error: t.account.delete.failed };
  const u = await requireUser();
  if (f.get('confirm') !== 'on') return { error: t.account.delete.needConfirm };
  // erneut mit Passwort bestätigen – eine offen gelassene Sitzung allein reicht nicht zum endgültigen Löschen
  const password = String(f.get('password') ?? '');
  if (!password) return { error: t.account.delete.wrongPassword };
  try {
    const ok = await auth.api.verifyPassword({ body: { password }, headers: await headers() });
    if (!ok?.status) return { error: t.account.delete.wrongPassword };
  } catch {
    return { error: t.account.delete.wrongPassword };
  }
  try {
    await deleteUserData(u.id);
  } catch (e) {
    console.error('[konto] Löschen fehlgeschlagen:', e instanceof Error ? e.message : e);
    return { error: t.account.delete.failed };
  }
  // Sitzungen sind in der DB gelöscht; Sitzungs-Cookies zusätzlich entfernen
  const jar = await cookies();
  for (const c of jar.getAll()) {
    if (!/^(__Secure-|__Host-)?better-auth\./.test(c.name)) continue;
    // __Secure-/__Host-Cookies lassen sich nur mit Secure überschreiben
    jar.set(c.name, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure: c.name.startsWith('__') });
  }
  redirect('/konto/geloescht');
}

export type OptOutState = { ok?: boolean; error?: string } | null;

/** Abmeldung per Button (nicht beim bloßen Öffnen des Links – Mail-Scanner öffnen Links automatisch). */
export async function confirmOptOut(_p: OptOutState, f: FormData): Promise<OptOutState> {
  const { t } = await getI18n();
  const email = decodeOptOutParam(String(f.get('e') ?? ''));
  const sig = String(f.get('sig') ?? '');
  if (!isHosted() || !email || !verifyOptOut(email, sig)) return { error: t.account.optout.invalid };
  await optOut(email);
  return { ok: true };
}
