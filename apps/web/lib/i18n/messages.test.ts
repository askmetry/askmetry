import { describe, expect, it } from 'vitest';
import { messages } from './messages';

/** Alle Blätter eines Wörterbuchs mit Pfad: Strings und Funktionen (Interpolation). */
function leaves(o: unknown, path = ''): [string, unknown][] {
  if (typeof o === 'string' || typeof o === 'function') return [[path, o]];
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [[path, o]];
}
/** Beispielargumente für Funktionen: Zahlen 0, 1, 3 und Strings */
const sample = (fn: Function, n: number) => Array.from({ length: fn.length }, (_, i) => (i % 2 ? `X${i}` : n));

describe('Wörterbücher', () => {
  const de = new Map(leaves(messages.de));
  const en = new Map(leaves(messages.en));

  it('Belege-Überschrift für jeden Maßnahmen-Typ mit URL-Liste', () => {
    for (const type of ['community', 'name_on_own_page', 'outreach', 'technical', 'comparison', 'listicle', 'reviews', 'entity']) {
      for (const l of ['de', 'en'] as const) expect((messages[l].recs.evidence.urlHeading as Record<string, string>)[type], `${l}.${type}`).toBeTruthy();
    }
  });

  it('Englisch hat genau dieselben Schlüssel wie Deutsch', () => {
    expect([...en.keys()].sort()).toEqual([...de.keys()].sort());
  });

  it('jeder Eintrag ist ein nicht-leerer Text bzw. eine Funktion mit gleicher Stelligkeit', () => {
    for (const [k, v] of de) {
      const e = en.get(k);
      expect(typeof e, k).toBe(typeof v);
      if (typeof v === 'string') {
        expect(v.trim(), `de.${k}`).not.toBe('');
        expect(String(e).trim(), `en.${k}`).not.toBe('');
      } else if (typeof v === 'function') {
        expect((e as Function).length, `en.${k} Stelligkeit`).toBe(v.length);
      } else {
        throw new Error(`${k}: unerwarteter Typ ${typeof v}`);
      }
    }
  });

  it('Funktionen liefern in beiden Sprachen Text', () => {
    for (const [k, v] of de) {
      if (typeof v !== 'function') continue;
      for (const n of [0, 1, 3]) {
        for (const dict of [v, en.get(k)] as Function[]) {
          let out: unknown;
          try { out = dict(...sample(dict, n)); } catch { continue; } // Funktionen mit Objekt-Argumenten
          if (typeof out === 'string') expect(out.trim(), k).not.toBe('');
        }
      }
    }
  });

  it('keine deutschen Reste im Englischen', () => {
    const german = /[äöüÄÖÜß]|\b(und|oder|nicht|keine?|mit|für|der|die|das|deine?|wird|werden|Antworten|Fragen|Maßnahmen?|Quellen?|Einstellungen)\b/;
    const bad: string[] = [];
    for (const [k, v] of en) {
      const out = typeof v === 'function' ? (() => { try { return String((v as Function)(...sample(v as Function, 3))); } catch { return ''; } })() : String(v);
      if (german.test(out.replace(/X\d+/g, ''))) bad.push(`${k}: ${out}`);
    }
    expect(bad).toEqual([]);
  });
});
