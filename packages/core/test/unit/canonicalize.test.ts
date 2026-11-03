import { describe, expect, it } from 'vitest';
import type { ExtractedBrand } from '../../src/analyze.ts';
import { analyzeLocally } from '../../src/analyze.ts';
import { canonicalizeMentions } from '../../src/canonicalize.ts';

const brands = [
  { id: 'b-pay', name: 'Paylindo', aliases: ['paylindo.de'] },
  { id: 'b-sumup', name: 'SumUp', aliases: [] },
  { id: 'b-zettle', name: 'Zettle', aliases: ['PayPal Zettle', 'iZettle'] },
];
const e = (x: Partial<ExtractedBrand>): ExtractedBrand => ({
  name: 'X', tracked: null, position: 1, sentiment: 'neutral', recommended: false, snippet: '', ...x,
});

describe('canonicalizeMentions', () => {
  it('ordnet über tracked, Name und Aliase zu (Groß-/Kleinschreibung egal)', () => {
    const out = canonicalizeMentions([
      e({ name: 'SUMUP', position: 1 }),
      e({ name: 'iZettle', position: 2 }),
      e({ name: 'Irgendwas', tracked: 'paylindo', position: 3 }),
    ], brands);
    expect(out.map((m) => [m.brandId, m.name, m.position])).toEqual([
      ['b-sumup', 'SumUp', 1], ['b-zettle', 'Zettle', 2], ['b-pay', 'Paylindo', 3],
    ]);
  });

  it('fasst Duplikate pro Antwort zusammen: min. Position, empfohlen wenn irgendwo empfohlen', () => {
    const out = canonicalizeMentions([
      e({ name: 'SumUp Solo', tracked: 'SumUp', position: 4, recommended: true, snippet: 'Solo' }),
      e({ name: 'SumUp', tracked: 'SumUp', position: 1, recommended: false, sentiment: 'positive', snippet: 'erste' }),
      e({ name: 'PayPal', position: 3 }),
      e({ name: 'paypal', position: 5 }),
    ], brands);
    expect(out).toHaveLength(2);
    const sumup = out.find((m) => m.brandId === 'b-sumup')!;
    expect(sumup.position).toBe(1);
    expect(sumup.recommended).toBe(true);
    expect(sumup.snippet).toBe('erste');
    const paypal = out.find((m) => m.name === 'PayPal')!;
    expect(paypal.brandId).toBeNull();
    expect(paypal.position).toBe(3);
  });
});

describe('analyzeLocally', () => {
  it('findet getrackte Marken per String-Abgleich in Reihenfolge', () => {
    const a = analyzeLocally('Ich empfehle iZettle. Alternativ SumUp oder paylindo.de zum Vergleichen. Nicht: notSumUp.', brands);
    expect(a.brands.map((b) => [b.tracked, b.position])).toEqual([['Zettle', 1], ['SumUp', 2], ['Paylindo', 3]]);
    expect(a.brands[0].recommended).toBe(true);
    expect(a.costUsd).toBe(0);
  });
  it('leere Antwort', () => {
    expect(analyzeLocally('  ', brands)).toEqual({ answer_type: 'empty', brands: [], costUsd: 0 });
  });
});
