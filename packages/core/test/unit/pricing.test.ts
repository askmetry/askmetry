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
