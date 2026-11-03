import { describe, expect, it } from 'vitest';
import { exceedsBudget } from '../../src/budget.ts';
import { isScheduleDue, lastCronTick } from '../../src/schedule.ts';

describe('exceedsBudget', () => {
  it('stoppt, wenn Ausgaben + Reservierung + Schätzung das Budget überschreiten', () => {
    expect(exceedsBudget({ monthSpendUsd: 49.9, estimateUsd: 0.11, budgetUsd: 50 })).toBe(true);
    expect(exceedsBudget({ monthSpendUsd: 49.89, estimateUsd: 0.11, budgetUsd: 50 })).toBe(false); // genau am Budget ist erlaubt
    expect(exceedsBudget({ monthSpendUsd: 49, reservedUsd: 0.9, estimateUsd: 0.11, budgetUsd: 50 })).toBe(true);
    expect(exceedsBudget({ monthSpendUsd: 0, estimateUsd: 0, budgetUsd: 0 })).toBe(false); // Mock kostet nichts
  });
});

describe('Zeitplan (Europe/Berlin)', () => {
  const cron = '17 3 * * 1'; // Montag 03:17
  it('letzter Tick in Berliner Zeit (Winterzeit = UTC+1)', () => {
    // Sa 31.10.2026 12:00 UTC → letzter Montag 26.10.2026 03:17 Berlin = 02:17 UTC
    expect(lastCronTick(cron, new Date('2026-10-31T12:00:00Z')).toISOString()).toBe('2026-10-26T02:17:00.000Z');
  });
  it('Sommerzeit = UTC+2', () => {
    expect(lastCronTick(cron, new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-06-29T01:17:00.000Z');
  });
  it('fällig, wenn letzter Tick nach der letzten geplanten Collection liegt', () => {
    const now = new Date('2026-11-02T03:00:00Z'); // Mo 04:00 Berlin, Tick 02:17 UTC
    const wsCreated = new Date('2026-10-01T00:00:00Z');
    expect(isScheduleDue(cron, new Date('2026-10-26T02:18:00Z'), wsCreated, now)).toBe(true);
    expect(isScheduleDue(cron, new Date('2026-11-02T02:18:00Z'), wsCreated, now)).toBe(false);
  });
  it('genau zum Tick fällig', () => {
    expect(isScheduleDue(cron, new Date('2026-10-26T02:20:00Z'), new Date(0), new Date('2026-11-02T02:17:00Z'))).toBe(true);
  });
  it('neuer Workspace ohne geplante Collection misst erst beim nächsten Tick', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    expect(isScheduleDue(cron, null, new Date('2026-10-31T11:00:00Z'), now)).toBe(false);
    expect(isScheduleDue(cron, null, new Date('2026-10-20T11:00:00Z'), now)).toBe(true);
  });
  it('Wochentagwechsel misst nicht sofort, sondern erst zum nächsten neuen Tick', () => {
    // Plan lief montags, letzte Messung Mo 26.10.; am Sa 31.10. 12:00 UTC wird auf Freitag 03:17 umgestellt.
    const fri = '17 3 * * 5';
    const lastRun = new Date('2026-10-26T02:17:30Z');
    const changed = new Date('2026-10-31T12:00:00Z');
    // Ohne Änderungszeitpunkt wäre der Fr-30.10.-Tick (nach der letzten Messung) sofort fällig:
    expect(isScheduleDue(fri, lastRun, new Date(0), new Date('2026-10-31T12:01:00Z'))).toBe(true);
    // Mit Änderungszeitpunkt nicht:
    expect(isScheduleDue(fri, lastRun, new Date(0), new Date('2026-10-31T12:01:00Z'), changed)).toBe(false);
    // Fr 06.11. 03:17 Berlin = 02:17 UTC → fällig
    expect(isScheduleDue(fri, lastRun, new Date(0), new Date('2026-11-06T02:17:00Z'), changed)).toBe(true);
  });
  it('erstmaliges Einschalten misst erst beim nächsten Tick', () => {
    const wsCreated = new Date('2026-09-01T00:00:00Z'); // lange angelegt, nie geplant gemessen
    const enabledAt = new Date('2026-11-01T10:00:00Z'); // So
    expect(isScheduleDue(cron, null, wsCreated, new Date('2026-11-01T10:00:05Z'))).toBe(true); // alter Fehler
    expect(isScheduleDue(cron, null, wsCreated, new Date('2026-11-01T10:00:05Z'), enabledAt)).toBe(false);
    expect(isScheduleDue(cron, null, wsCreated, new Date('2026-11-02T02:17:00Z'), enabledAt)).toBe(true); // Mo 03:17
  });
  it('spätere geplante Messung hat Vorrang vor älterer Planänderung', () => {
    const changed = new Date('2026-10-20T00:00:00Z');
    expect(isScheduleDue(cron, new Date('2026-11-02T02:18:00Z'), new Date(0), new Date('2026-11-02T03:00:00Z'), changed)).toBe(false);
  });
});
