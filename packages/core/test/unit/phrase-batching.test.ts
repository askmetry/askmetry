import { describe, expect, it } from 'vitest';
import { hashOf, MAX_PHRASE_ATTEMPTS, MAX_PHRASE_CALLS, needsPhrasing, phraseInBatches } from '../../src/recommend/index.ts';
import { estimatePhraseCost, PHRASE_BATCH_SIZE, phraseMaxTokens, type PhraseResult, type Phraser } from '../../src/recommend/phrase.ts';
import { priorityOf, type Candidate } from '../../src/recommend/rules.ts';

const cand = (i: number): Candidate => ({
  key: `outreach:d${i}.de`, type: 'outreach', title: `T${i}`, why: 'W', steps: ['a', 'b'], impact: 2, effort: 2, reach: 0.5,
  texts: { de: { title: `T${i}`, why: 'W', steps: ['a', 'b'] }, en: { title: `T${i}`, why: 'W', steps: ['a', 'b'] } },
  priority: priorityOf(2, 0.5, 2), evidence: { metrics: { n: i }, examples: [] }, signature: { i },
});
const ctx = { brandName: 'X', domains: ['x.de'], year: 2026, lang: 'de' as const };

function fakePhraser(behave: (batch: Candidate[], call: number) => Partial<PhraseResult>) {
  const calls: string[][] = [];
  const phraser: Phraser = async (batch) => {
    calls.push(batch.map((c) => c.key));
    const r = behave(batch, calls.length);
    return { texts: new Map(), costUsd: 0.001, model: 'm', ...r };
  };
  return { phraser, calls };
}
const allTexts = (batch: Candidate[]) => ({ texts: new Map(batch.map((c) => [c.key, { title: 'KI', why: 'w', steps: ['s', 't'] }])) });

describe('KI-Formulierung in Batches', () => {
  it('höchstens 12 je Aufruf, wichtigste zuerst; höchstens MAX_PHRASE_CALLS Aufrufe, Rest verschoben', async () => {
    const items = Array.from({ length: 40 }, (_, i) => cand(i));
    const { phraser, calls } = fakePhraser(allTexts);
    const r = await phraseInBatches(items, ctx, { phraser, budgetLeft: 100 });
    expect(calls).toHaveLength(MAX_PHRASE_CALLS);
    expect(calls[0]).toHaveLength(PHRASE_BATCH_SIZE);
    expect(calls[0][0]).toBe(items[0].key);
    expect(r.texts.size).toBe(MAX_PHRASE_CALLS * PHRASE_BATCH_SIZE);
    expect(r.deferred).toBe(40 - MAX_PHRASE_CALLS * PHRASE_BATCH_SIZE);
    expect(r.costUsd).toBeCloseTo(0.001 * MAX_PHRASE_CALLS);
  });

  it('max_tokens → Batch halbieren statt alles erneut', async () => {
    const items = Array.from({ length: 12 }, (_, i) => cand(i));
    const { phraser, calls } = fakePhraser((b) => (b.length > 6 ? { truncated: true, error: 'abgeschnitten' } : allTexts(b)));
    const r = await phraseInBatches(items, ctx, { phraser, budgetLeft: 100 });
    expect(calls.map((c) => c.length)).toEqual([12, 6, 6]);
    expect(r.texts.size).toBe(12);
    expect(r.costUsd).toBeCloseTo(0.003); // auch der abgeschnittene Aufruf kostet
  });

  it('Budget: Aufruf nur, wenn die Kostenobergrenze passt', async () => {
    const items = Array.from({ length: 30 }, (_, i) => cand(i));
    const one = estimatePhraseCost(items.slice(0, 12));
    expect(one).toBeGreaterThan(phraseMaxTokens(12) * 0.5 / 1e6 - 1e-9); // mindestens volle Ausgabe zum Haiku-Preis
    // tatsächliche Kosten = Obergrenze → der zweite Aufruf passt nicht mehr ins Budget
    const { phraser, calls } = fakePhraser((b) => ({ ...allTexts(b), costUsd: one }));
    const r = await phraseInBatches(items, ctx, { phraser, budgetLeft: one * 1.5 });
    expect(calls).toHaveLength(1);
    expect(r.budgetHit).toBe(true);
    const none = await phraseInBatches(items, ctx, { phraser, budgetLeft: one / 2 });
    expect(none.calls).toBe(0);
  });

  it('Fehler ohne Ergebnis → Abbruch, kein Wiederholen; jeder Aufruf wird gemeldet (gebucht)', async () => {
    const items = Array.from({ length: 30 }, (_, i) => cand(i));
    const booked: number[] = [];
    const { phraser, calls } = fakePhraser(() => ({ error: 'HTTP 500' }));
    const r = await phraseInBatches(items, ctx, { phraser, budgetLeft: 100, onCall: (x) => { booked.push(x.costUsd); } });
    expect(calls).toHaveLength(1);
    expect(booked).toEqual([0.001]);
    expect(r.attempted.size).toBe(12);
    expect(r.texts.size).toBe(0);
  });

  it('parallel (Schnell-Check): kleinere Batches gleichzeitig, gleiche Obergrenzen', async () => {
    const items = Array.from({ length: 12 }, (_, i) => cand(i));
    let active = 0, peak = 0;
    const calls: number[] = [];
    const phraser: Phraser = async (batch) => {
      active++; peak = Math.max(peak, active); calls.push(batch.length);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ...allTexts(batch), costUsd: 0.001, model: 'm' };
    };
    const r = await phraseInBatches(items, ctx, { phraser, budgetLeft: 100, batchSize: 5, parallel: MAX_PHRASE_CALLS });
    expect(calls).toEqual([5, 5, 2]);
    expect(peak).toBe(3);
    expect(r.texts.size).toBe(12);
    expect(r.deferred).toBe(0);
    // abgeschnitten → dieselben Maßnahmen mit halber Größe in der nächsten Runde (nur solange Aufrufe übrig sind)
    const t = fakePhraser((b) => (b.length > 3 ? { truncated: true } : allTexts(b)));
    const r2 = await phraseInBatches(items.slice(0, 8), ctx, { phraser: t.phraser, budgetLeft: 100, batchSize: 4, parallel: 2 });
    expect(t.calls.map((c) => c.length)).toEqual([4, 4, 2]);
    expect(r2.texts.size).toBe(2);
    expect(r2.deferred).toBe(6);
  });

  it('nach MAX_PHRASE_ATTEMPTS gescheiterten Versuchen mit gleicher Evidenz keine neue Formulierung', () => {
    const c = cand(1);
    expect(needsPhrasing(c, undefined)).toBe(true);
    const ev = (n: number, hash?: string) => ({ status: 'open', evidence: { phrasedBy: 'rules', textHash: hash, phraseAttempts: hash ? { hash, n } : null } }) as any;
    const h = hashOf(c);
    expect(needsPhrasing(c, ev(MAX_PHRASE_ATTEMPTS - 1, h))).toBe(true);
    expect(needsPhrasing(c, ev(MAX_PHRASE_ATTEMPTS, h))).toBe(false);
    expect(needsPhrasing(c, ev(MAX_PHRASE_ATTEMPTS, 'anderer-stand'))).toBe(true); // Evidenz geändert → neuer Versuch
  });
});
