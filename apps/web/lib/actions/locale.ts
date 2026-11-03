'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/i18n/config';

/** Sprache der Oberfläche setzen (Cookie, ein Jahr). Unbekannte Werte werden ignoriert. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
