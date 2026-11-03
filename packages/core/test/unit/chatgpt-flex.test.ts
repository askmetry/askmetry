import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatgpt } from '../../src/engines/chatgpt.ts';
import { EngineError } from '../../src/errors.ts';

const ok = (tier: string) => new Response(JSON.stringify({
  model: 'gpt-5.5', service_tier: tier, usage: { input_tokens: 1000, output_tokens: 100 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Antwort', annotations: [] }] }],
}), { status: 200 });
const err = (status: number, message: string, code?: string) => new Response(JSON.stringify({ error: { message, type: 'x', code } }), { status });

const ctx = { country: 'DE', language: 'de', options: { model: 'gpt-5.5', serviceTier: 'flex' } };
const sentTiers = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => JSON.parse(c[1].body).service_tier ?? null);

describe('ChatGPT flex', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  process.env.OPENAI_API_KEY ??= 'test';

  it('sendet service_tier flex und rechnet Tokens zum halben Preis', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok('flex'));
    vi.stubGlobal('fetch', f);
    const r = await chatgpt.run('Frage', ctx);
    expect(sentTiers(f)).toEqual(['flex']);
    expect(r.costUsd).toBeCloseTo((0.005 + 0.003) / 2, 6);
  });
  it('fällt bei fehlender flex-Kapazität einmal auf den Normalpreis zurück', async () => {
    const f = vi.fn().mockResolvedValueOnce(err(429, 'Resource Unavailable')).mockResolvedValueOnce(ok('default'));
    vi.stubGlobal('fetch', f);
    const r = await chatgpt.run('Frage', ctx);
    expect(sentTiers(f)).toEqual(['flex', null]);
    expect(r.costUsd).toBeCloseTo(0.005 + 0.003, 6);
  });
  it('kein Rückfall bei Rate-Limit; leeres Guthaben ist nicht wiederholbar', async () => {
    const f = vi.fn().mockResolvedValueOnce(err(429, 'Rate limit reached for gpt-5.5'));
    vi.stubGlobal('fetch', f);
    await expect(chatgpt.run('Frage', ctx)).rejects.toMatchObject({ retryable: true });
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockResolvedValueOnce(err(429, 'You exceeded your current quota', 'insufficient_quota'));
    vi.stubGlobal('fetch', g);
    const e = await chatgpt.run('Frage', ctx).catch((x) => x);
    expect(e).toBeInstanceOf(EngineError);
    expect(e.retryable).toBe(false);
    expect(g).toHaveBeenCalledTimes(1);
  });
});
