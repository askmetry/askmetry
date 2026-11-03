import { describe, expect, it } from 'vitest';
import { scheduleText, timeText, weekdays } from './schedule';

describe('scheduleText je Sprache', () => {
  it('Deutsch (Standard)', () => {
    expect(scheduleText('0 3 * * 0', 'de')).toBe('Jeden Sonntag, 3:00 Uhr');
  });
  it('Englisch', () => {
    expect(scheduleText('17 3 * * 1', 'en')).toBe('Every Monday at 3:17 AM');
    expect(scheduleText('5 18 * * *', 'en')).toBe('Daily at 6:05 PM');
    expect(scheduleText('0 0 * * 7', 'en')).toBe('Every Sunday at 12:00 AM');
    expect(scheduleText('0 12 * * 3', 'en')).toBe('Every Wednesday at 12:00 PM');
    expect(scheduleText('0 3 * * 1-5', 'en')).toBe('Custom schedule (0 3 * * 1-5)');
  });
  it('Wochentage und Uhrzeit', () => {
    expect(weekdays('en')[1]).toBe('Monday');
    expect(timeText(15, 7, 'de')).toBe('15:07 Uhr');
  });
});
