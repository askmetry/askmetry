// Sprachen für Texte aus packages/core (Maßnahmen, Lagebericht, Claude-Prompts). Rein, ohne Imports – auch im Client nutzbar.
// UI-Sprache = Cookie/Accept-Language des Nutzers (apps/web/lib/i18n); Workspace-Sprache = workspace.language (LLM-Texte).

export type Lang = 'de' | 'en';
export const LANGS: readonly Lang[] = ['de', 'en'];
export const DEFAULT_LANG: Lang = 'de';

/** Beliebigen Wert (z. B. workspace.language) auf eine unterstützte Sprache abbilden; unbekannt → Deutsch. */
export const toLang = (v: unknown): Lang => (v === 'en' ? 'en' : 'de');

/** Intl-Locale je Sprache (Zahlen, Datum). */
export const INTL_LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-US' };

/** „A, B und C“ bzw. „A, B and C“. */
export function listJoin(xs: readonly string[], lang: Lang = 'de'): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${lang === 'en' ? 'and' : 'und'} ${xs[xs.length - 1]}`;
}

/** Ganze Prozent mit Leerzeichen wie in der UI: „34 %“ (de) bzw. „34%“ (en). */
export const pctText = (x: number, lang: Lang = 'de') => `${Math.round(x * 100)}${lang === 'en' ? '' : ' '}%`;
