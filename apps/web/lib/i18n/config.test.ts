import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, localeFromAcceptLanguage, resolveLocale } from './config';

describe('Sprachauswahl', () => {
  it('Cookie hat Vorrang vor Accept-Language', () => {
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'de-DE,de;q=0.9' })).toBe('en');
    expect(resolveLocale({ cookie: 'de', acceptLanguage: 'en-US,en;q=0.9' })).toBe('de');
  });
  it('ungültiges Cookie wird ignoriert → Accept-Language', () => {
    expect(resolveLocale({ cookie: 'fr', acceptLanguage: 'en-GB' })).toBe('en');
    expect(resolveLocale({ cookie: '', acceptLanguage: 'en' })).toBe('en');
    expect(resolveLocale({ cookie: 'EN', acceptLanguage: null })).toBe('de');
  });
  it('Accept-Language: q-Werte, Reihenfolge, Hauptsprache', () => {
    expect(localeFromAcceptLanguage('en-US,en;q=0.9,de;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8,de;q=0.7')).toBe('en');
    expect(localeFromAcceptLanguage('de;q=0.5, en;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('en;q=0.8, de;q=0.8')).toBe('en'); // Gleichstand: Reihenfolge
    expect(localeFromAcceptLanguage('de-AT')).toBe('de');
    expect(localeFromAcceptLanguage('EN-us')).toBe('en');
    expect(localeFromAcceptLanguage('en;q=0, de')).toBe('de'); // q=0 = nicht gewünscht
    expect(localeFromAcceptLanguage('*')).toBeNull();
    expect(localeFromAcceptLanguage('fr, es;q=0.5')).toBeNull();
    expect(localeFromAcceptLanguage('')).toBeNull();
    expect(localeFromAcceptLanguage(undefined)).toBeNull();
    expect(localeFromAcceptLanguage('en;q=abc, de;q=0.1')).toBe('de');
  });
  it('Fallback ist Deutsch', () => {
    expect(DEFAULT_LOCALE).toBe('de');
    expect(resolveLocale({})).toBe('de');
    expect(resolveLocale({ cookie: null, acceptLanguage: 'fr, es' })).toBe('de');
  });
  it('isLocale', () => {
    expect(isLocale('de')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('en-US')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
