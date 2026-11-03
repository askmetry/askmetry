// Zahlen und Datum je Sprache über Intl: de „38 %“, „2,5“, „1,23 $“, „03.11.2026, 15:17“ · en „38%“, „2.5“, „$1.23“, „Nov 3, 2026, 3:17 PM“.
import type { Locale } from './config';

const INTL: Record<Locale, string> = { de: 'de-DE', en: 'en-US' };
const NBSP = '\u202f'; // schmales geschütztes Leerzeichen (de: vor „%“ und „$“)
const TZ = 'Europe/Berlin';

export type Fmt = ReturnType<typeof createFormat>;

export function createFormat(locale: Locale) {
  const intl = INTL[locale];
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (min: number, max: number) => {
    const k = `${min}-${max}`;
    let f = cache.get(k);
    if (!f) { f = new Intl.NumberFormat(intl, { minimumFractionDigits: min, maximumFractionDigits: max }); cache.set(k, f); }
    return f;
  };
  const empty = (x: unknown) => x === null || x === undefined || (typeof x === 'number' && Number.isNaN(x));
  const de = locale === 'de';
  return {
    locale,
    intl,
    /** Anteil 0..1 als Prozent */
    pct(x: number | null | undefined, digits = 0): string {
      if (empty(x)) return '–';
      return `${nf(digits, digits).format(x! * 100)}${de ? NBSP : ''}%`;
    },
    num(x: number | null | undefined, digits = 1): string {
      return empty(x) ? '–' : nf(digits, digits).format(x!);
    },
    int(x: number | null | undefined): string {
      return empty(x) ? '–' : nf(0, 0).format(x!);
    },
    usd(x: number | string | null | undefined, digits = 2): string {
      if (x === null || x === undefined || x === '') return '–';
      const v = nf(digits, digits).format(Number(x));
      return de ? `${v}${NBSP}$` : `$${v}`;
    },
    /** Datum (+ Uhrzeit) in Europe/Berlin */
    date(d: Date | string | null | undefined, withTime = true): string {
      if (!d) return '–';
      return new Intl.DateTimeFormat(intl, de
        ? { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }
        : { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) },
      ).format(new Date(d));
    },
    /** Kurzes Datum ohne Jahr: de „31.10.“, en „Oct 31“ */
    dayMonth(d: Date | string): string {
      const x = new Date(d);
      return de
        ? new Intl.DateTimeFormat(intl, { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(x).replace(/\.?$/, '.')
        : new Intl.DateTimeFormat(intl, { timeZone: TZ, day: 'numeric', month: 'short' }).format(x);
    },
    /** Beliebige Intl-Optionen (Zeitzone Europe/Berlin) */
    dateWith(d: Date | string, opts: Intl.DateTimeFormatOptions): string {
      return new Intl.DateTimeFormat(intl, { timeZone: TZ, ...opts }).format(new Date(d));
    },
    /** „A, B und C“ / „A, B, and C“ */
    list(xs: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
      return new Intl.ListFormat(intl, { style: 'long', type }).format(xs);
    },
  };
}
