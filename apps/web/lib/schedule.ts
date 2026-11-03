// Messplan: Klartext ↔ Cron (Minute Stunde * * Wochentag) – rein, auch im Browser nutzbar.


export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const;

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

/** „Jeden Montag, 3:17 Uhr“ – für unbekannte Ausdrücke der Rohwert. */
export function scheduleText(cron: string): string {
  const s = parseSimpleCron(cron);
  if (!s) return `Eigener Zeitplan (${cron})`;
  const t = `${s.hour}:${String(s.minute).padStart(2, '0')} Uhr`;
  return s.day === 'daily' ? `Täglich, ${t}` : `Jeden ${WEEKDAYS[s.day]}, ${t}`;
}
