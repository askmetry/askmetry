import { CronExpressionParser } from 'cron-parser';

export const SCHEDULE_TZ = 'Europe/Berlin';

/** Letzter Cron-Zeitpunkt (Europe/Berlin) vor oder gleich `now`. */
export function lastCronTick(cron: string, now: Date = new Date()): Date {
  const it = CronExpressionParser.parse(cron, { currentDate: new Date(now.getTime() + 1000), tz: SCHEDULE_TZ });
  return it.prev().toDate();
}

/**
 * Ist eine geplante Collection fällig? Ja, wenn der letzte Cron-Zeitpunkt nach dem Bezugszeitpunkt liegt.
 * Bezug = max(letzte geplante Collection, letzte Messplan-Änderung bzw. Anlage des Workspace).
 * So misst weder ein neuer Workspace noch ein gerade geänderter/eingeschalteter Messplan sofort
 * (kostenpflichtig) – erst der nächste echte Cron-Zeitpunkt nach der Änderung löst aus.
 */
export function isScheduleDue(
  cron: string, lastScheduledAt: Date | null, workspaceCreatedAt: Date, now: Date = new Date(),
  scheduleUpdatedAt: Date | null = null,
): boolean {
  const tick = lastCronTick(cron, now);
  const ref = Math.max(lastScheduledAt?.getTime() ?? -Infinity, (scheduleUpdatedAt ?? workspaceCreatedAt).getTime());
  return tick.getTime() > ref;
}

export function isValidCron(cron: string): boolean {
  try { CronExpressionParser.parse(cron, { tz: SCHEDULE_TZ }); return true; } catch { return false; }
}

/** Nächster Cron-Zeitpunkt (Europe/Berlin) nach `now`. */
export function nextCronTick(cron: string, now: Date = new Date()): Date {
  return CronExpressionParser.parse(cron, { currentDate: now, tz: SCHEDULE_TZ }).next().toDate();
}
