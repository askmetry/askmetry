import { describe, expect, it } from 'vitest';
import { costFromUsage, priceFor } from '../../src/pricing.ts';

describe('pricing', () => {
  it('ordnet gemeldete Modellnamen zu', () => {
    expect(priceFor('gpt-5.5-2026-10-01')?.input).toBe(5);
    expect(priceFor('gpt-5.4-mini')?.input).toBe(0.75);
    expect(priceFor('claude-sonnet-5-5')?.output).toBe(10);
    expect(priceFor('unbekannt', 'claude')?.output).toBe(10); // Fallback auf Standardmodell der Engine
  });
  it('ChatGPT: Tokens + web_search_calls', () => {
    const c = costFromUsage({ engine: 'chatgpt', model: 'gpt-5.5', usage: { input_tokens: 10_000, output_tokens: 1_000, web_search_calls: 2 } });
    expect(c).toBeCloseTo(0.05 + 0.03 + 0.02, 6);
  });
  it('ChatGPT flex: Tokens zum halben Preis, Suchgebühr voll', () => {
    const c = costFromUsage({ engine: 'chatgpt', model: 'gpt-5.5', usage: { input_tokens: 10_000, output_tokens: 1_000, web_search_calls: 2, service_tier: 'flex' } });
    expect(c).toBeCloseTo((0.05 + 0.03) / 2 + 0.02, 6);
  });
  it('ChatGPT: cached_tokens zum Cache-Preis (0,50 $ bzw. flex 0,25 $), nicht zum vollen Eingabepreis', () => {
    // typische Antwort aus dem Strategiebericht: 4.224 der 10.684 Eingabe-Tokens kamen aus dem Cache
    const usage = { input_tokens: 10_684, output_tokens: 1_598, web_search_calls: 1, input_tokens_details: { cached_tokens: 4_224 } };
    expect(costFromUsage({ engine: 'chatgpt', model: 'gpt-5.5-2026-04-23', usage }))
      .toBeCloseTo((6_460 * 5 + 4_224 * 0.5 + 1_598 * 30) / 1e6 + 0.01, 6);
    expect(costFromUsage({ engine: 'chatgpt', model: 'gpt-5.5-2026-04-23', usage: { ...usage, service_tier: 'flex' } }))
      .toBeCloseTo((6_460 * 2.5 + 4_224 * 0.25 + 1_598 * 15) / 1e6 + 0.01, 6);
    // ohne Cache-Preis in der Zeile: voller Eingabepreis (vorsichtig)
    expect(costFromUsage({ engine: 'chatgpt', model: 'chat-latest', usage: { input_tokens: 1e6, input_tokens_details: { cached_tokens: 1e6 } } })).toBeCloseTo(5, 6);
  });
  it('Gemini 3.6 Flash: angekündigte Preisverdopplung ab 01.01.2027', () => {
    const usage = { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 };
    expect(costFromUsage({ engine: 'gemini', model: 'gemini-3.6-flash', usage, at: new Date('2026-12-31T12:00:00Z') })).toBeCloseTo(0.75 + 3.75, 6);
    expect(costFromUsage({ engine: 'gemini', model: 'gemini-3.6-flash', usage, at: new Date('2027-01-01T00:00:00Z') })).toBeCloseTo(1.5 + 7.5, 6);
    expect(priceFor('gemini-3.6-flash', 'gemini', new Date('2027-02-01'))?.perSearch).toBe(0);
  });
  it('chat-latest: eigene Preiszeile', () => {
    expect(priceFor('chat-latest')?.perSearch).toBe(0.025);
  });
  it('Claude: Tokens + Suchen', () => {
    const c = costFromUsage({ engine: 'claude', model: 'claude-sonnet-5-5', usage: { input_tokens: 20_000, output_tokens: 2_000, server_tool_use: { web_search_requests: 3 } } });
    expect(c).toBeCloseTo(0.04 + 0.02 + 0.03, 6);
  });
  it('Gemini: Grounding kostenlos', () => {
    const c = costFromUsage({ engine: 'gemini', model: 'gemini-3.5-flash', usage: { promptTokenCount: 1_000_000, candidatesTokenCount: 0, thoughtsTokenCount: 1_000_000 }, searches: 5 });
    expect(c).toBeCloseTo(0.75 + 3.75, 6);
  });
  it('Perplexity: gemeldete Kosten bevorzugt', () => {
    expect(costFromUsage({ engine: 'perplexity', model: 'sonar', usage: { cost: { total_cost: 0.0071 }, prompt_tokens: 999 } })).toBe(0.0071);
    expect(costFromUsage({ engine: 'perplexity', model: 'sonar', usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } })).toBeCloseTo(0.255, 6);
  });
  it('DataForSEO: Task-Kosten', () => {
    expect(costFromUsage({ engine: 'google_aio', taskCost: 0.004 })).toBe(0.004);
    expect(costFromUsage({ engine: 'google_ai_mode', taskCost: null })).toBe(0);
  });
});
