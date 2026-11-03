'use client';
// Sprache im Client: der Root-Layout setzt den Provider; Wörterbücher werden direkt importiert (klein, beide Sprachen).
import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, type Locale } from './config';
import { createFormat } from './format';
import { messages } from './messages';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
export const useT = () => messages[useLocale()];
export function useFmt() {
  const locale = useLocale();
  return useMemo(() => createFormat(locale), [locale]);
}
export function useI18n() {
  const locale = useLocale();
  const f = useMemo(() => createFormat(locale), [locale]);
  return { locale, t: messages[locale], f };
}
