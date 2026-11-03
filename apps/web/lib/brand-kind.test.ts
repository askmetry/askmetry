import { describe, expect, it } from 'vitest';
import { cleanDescription, parseBrandKind } from './brand-kind';
import { toggleStep } from './steps';

describe('Markenprofil', () => {
  it('prüft den Markentyp', () => {
    expect(parseBrandKind('')).toBeNull();
    expect(parseBrandKind('portal')).toBe('portal');
    expect(parseBrandKind('bank')).toBeUndefined();
  });
  it('säubert die Beschreibung', () => {
    expect(cleanDescription('  ')).toBeNull();
    expect(cleanDescription(' EC-Terminals\n für  Cafés ')).toBe('EC-Terminals für Cafés');
    expect(cleanDescription('x'.repeat(700))).toHaveLength(600);
  });
});

describe('toggleStep', () => {
  it('setzt und entfernt Schritte, sortiert ohne Duplikate', () => {
    expect(toggleStep([], 2, true)).toEqual([2]);
    expect(toggleStep([3, 1], 2, true)).toEqual([1, 2, 3]);
    expect(toggleStep([1, 2], 2, true)).toEqual([1, 2]);
    expect(toggleStep([1, 2], 1, false)).toEqual([2]);
    expect(toggleStep([1, -1, 1.5], 0, true)).toEqual([0, 1]);
  });
});
