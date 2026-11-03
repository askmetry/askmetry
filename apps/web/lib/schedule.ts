// Messplan: Klartext ↔ Cron (Minute Stunde * * Wochentag) – rein, auch im Browser nutzbar.
import { messages } from './i18n/messages';
import type { Locale } from './i18n/config';

/** Wochentage (0 = Sonntag) auf Deutsch – für andere Sprachen `weekdays(locale)`. */
export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const;
export const weekdays = (locale: Locale = 'de'): readonly string[] => messages[locale].settings.schedule.weekdays;

export type Schedule = { day: number | 'daily'; hour: number; minute: number };

/** Einfachen Cron in Wochentag/Uhrzeit zerlegen; komplexe Ausdrücke → null. */
export function parseSimpleCron(cron: string): Schedule | null {
  const m = cron.trim().split(/\s+/);
  if (m.length !== 5) return null;
  const [mi, h, dom, mon, dow] = m as [string, string, string, string, string];
  if (!/^\d{1,2}$/.test(mi) || !/^\d{1,2}$/.test(h) || dom !== '*' || mon !== '*') return null;
  const minute = Number(mi), hour = Number(h);
  if (minute > 59 || hour > 23) return null;
  if (dow === '*') return { day: 'daily', hour, minute };
  if (!/^\d$/.test(dow) || Number(dow) > 7) return null;
  return { day: Number(dow) % 7, hour, minute };
}

export function toCron(s: Schedule): string {
  return `${s.minute} ${s.hour} * * ${s.day === 'daily' ? '*' : s.day}`;
}

/** Uhrzeit: de „3:17 Uhr“, en „3:17 AM“. */
export function timeText(hour: number, minute: number, locale: Locale = 'de'): string {
  const mm = String(minute).padStart(2, '0');
  if (locale === 'en') return `${hour % 12 || 12}:${mm} ${hour < 12 ? 'AM' : 'PM'}`;
  return `${hour}:${mm} Uhr`;
}

/** „Jeden Montag, 3:17 Uhr“ / „Every Monday at 3:17 AM“ – für unbekannte Ausdrücke der Rohwert. */
export function scheduleText(cron: string, locale: Locale = 'de'): string {
  const t = messages[locale].settings.schedule;
  const s = parseSimpleCron(cron);
  if (!s) return t.custom(cron);
  const when = s.day === 'daily' ? t.daily : t.every(t.weekdays[s.day]!);
  return t.at(when, timeText(s.hour, s.minute, locale));
}
