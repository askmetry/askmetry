'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isHosted } from '@askmetry/core/hosted/config';
import { hashIp, startCheck } from '@askmetry/core/hosted/checks';
import { getLocale } from '@/lib/i18n/server';
import { checkFormError, clientIp, precheckUrl, type CheckFormError } from './format';

export type CheckFormState = { error: CheckFormError | null; url: string };

/** URL-Feld der Startseite: Schnell-Check starten und zum Teaser weiterleiten. Fehler kommen als Schlüssel zurück (Text im Formular). */
export async function startCheckAction(_prev: CheckFormState, formData: FormData): Promise<CheckFormState> {
  const url = String(formData.get('url') ?? '').trim().slice(0, 500);
  if (!isHosted()) return { error: 'disabled', url };
  const pre = precheckUrl(url);
  if (pre) return { error: pre, url };

  let token: string;
  try {
    const [h, locale] = await Promise.all([headers(), getLocale()]);
    const ip = clientIp(h);
    const res = await startCheck({ url, locale, ipHash: ip ? hashIp(ip) : null });
    if ('error' in res) return { error: checkFormError(res.error), url };
    token = res.token;
  } catch (e) {
    console.error('startCheck fehlgeschlagen:', e instanceof Error ? e.message : e);
    return { error: 'generic', url };
  }
  redirect(`/check/${encodeURIComponent(token)}`); // außerhalb von try: redirect() wirft absichtlich
}
