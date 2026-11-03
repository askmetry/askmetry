import { describe, expect, it } from 'vitest';
import { getEngine } from '../../src/engines/index.ts';
import { mock, mockAnswer } from '../../src/engines/mock.ts';
import { runLimited } from '../../src/limiter.ts';

const brands = [
  { name: 'Paylindo', domains: ['paylindo.de'], isOwn: true },
  { name: 'SumUp', domains: ['sumup.de'] },
  { name: 'Zettle', domains: ['zettle.com'] },
  { name: 'Payone', domains: ['payone.com'] },
  { name: 'myPOS', domains: ['mypos.com'] },
];

describe('Mock-Engine', () => {
  it('ist deterministisch', async () => {
    const ctx = { country: 'DE', language: 'de', brands, repetition: 1, engineKey: 'chatgpt' };
    const a = await mock.run('Welches EC-Terminal?', ctx);
    const b = await mock.run('Welches EC-Terminal?', ctx);
    expect(a).toEqual(b);
    expect(a.answer).toContain('Welches EC-Terminal?');
    expect(a.model).toBe('mock');
    expect(a.engine).toBe('chatgpt');
  });
  it('variiert mit Prompt und Wiederholung', () => {
    const answers = new Set<string>();
    for (const p of ['A?', 'B?', 'C?']) for (const repetition of [1, 2, 3]) {
      answers.add(mockAnswer(p, brands, { engine: 'claude', repetition }).answer);
    }
    expect(answers.size).toBeGreaterThan(5);
  });
  it('nennt Workspace-Marken und zitiert deren Domains', () => {
    const r = mockAnswer('Bester Anbieter?', brands, { engine: 'gemini', repetition: 1 });
    const named = brands.filter((b) => r.answer.includes(b.name));
    expect(named.length).toBeGreaterThanOrEqual(1);
    for (const b of named) expect(r.citations.some((c) => c.url.includes(b.domains[0]))).toBe(true);
  });
  it('ersetzt im Mock-Modus alle Engines', () => {
    expect(getEngine('chatgpt').key).toBe('mock');
    expect(getEngine('claude').key).toBe('mock');
  });
});

describe('runLimited', () => {
  it('hält Gesamt- und Anbietergrenze ein', async () => {
    let total = 0, maxTotal = 0;
    const per = new Map<string, number>(), maxPer = new Map<string, number>();
    const tasks = Array.from({ length: 20 }, (_, i) => {
      const provider = ['a', 'b', 'c'][i % 3];
      return {
        provider,
        fn: async () => {
          total++; maxTotal = Math.max(maxTotal, total);
          per.set(provider, (per.get(provider) ?? 0) + 1);
          maxPer.set(provider, Math.max(maxPer.get(provider) ?? 0, per.get(provider)!));
          await new Promise((r) => setTimeout(r, 5));
          total--; per.set(provider, per.get(provider)! - 1);
        },
      };
    });
    await runLimited(tasks, { total: 4, perProvider: 2 });
    expect(maxTotal).toBe(4);
    for (const v of maxPer.values()) expect(v).toBeLessThanOrEqual(2);
  });
});
