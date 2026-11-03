import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale, type Locale } from './config';
import { createFormat } from './format';
import { messages } from './messages';

/** UI-Sprache der aktuellen Anfrage (Cookie → Accept-Language → Deutsch). */
export const getLocale = cache(async (): Promise<Locale> => {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale({ cookie: c.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get('accept-language') });
});

/** Wörterbuch der aktuellen Sprache. */
export async function getT() {
  return messages[await getLocale()];
}

/** Sprache, Wörterbuch und Formatierer auf einmal (Server Components, Server Actions). */
export const getI18n = cache(async () => {
  const locale = await getLocale();
  return { locale, t: messages[locale], f: createFormat(locale) };
});
