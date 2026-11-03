// Adapter-Fehlerbehandlung mit gestubbtem fetch – keine Netzwerkaufrufe
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatgpt } from '../../src/engines/chatgpt.ts';
import { gemini } from '../../src/engines/gemini.ts';
import { googleAio } from '../../src/engines/google.ts';
import { EngineError, errorCost, isRetryable, withCost } from '../../src/errors.ts';

const ctx = { country: 'DE', language: 'de' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(...responses: Response[]) {
  const fn = vi.fn(async () => {
    const r = responses.shift();
    if (!r) throw new Error('unerwarteter fetch');
    return r;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Fehlerklassen', () => {
  it('nur vorübergehende Fehler werden wiederholt', () => {
    expect(isRetryable(new EngineError('x', { retryable: false }))).toBe(false);
    expect(isRetryable(Object.assign(new Error('rate'), { status: 429 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('auth'), { status: 401 }))).toBe(false);
    expect(isRetryable(Object.assign(new Error('srv'), { status: 503 }))).toBe(true);
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true);
  });
  it('Kosten hängen am Fehler', () => {
    expect(errorCost(new EngineError('x', { costUsd: 0.05 }))).toBe(0.05);
    expect(errorCost(new Error('x'))).toBe(0);
    const e = withCost(Object.assign(new Error('overloaded'), { status: 529 }), 0.02);
    expect(e).toBeInstanceOf(EngineError);
    expect(e.costUsd).toBe(0.02);
    expect(e.retryable).toBe(true);
  });
});

describe('HTTP-Fehler der Adapter', () => {
  it('ChatGPT: 401 ist dauerhaft, 500 vorübergehend', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test');
    stubFetch(reply(401, { error: { message: 'bad key' } }), reply(500, { error: { message: 'oops' } }));
    const e1 = await chatgpt.run('frage', ctx).catch((e) => e);
    expect(e1).toBeInstanceOf(EngineError);
    expect(isRetryable(e1)).toBe(false);
    const e2 = await chatgpt.run('frage', ctx).catch((e) => e);
    expect(isRetryable(e2)).toBe(true);
  });

  it('ChatGPT: ohne url_citation werden die durchsuchten Quellen genutzt (kind searched)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test');
    stubFetch(reply(200, {
      model: 'gpt-5.5',
      usage: { input_tokens: 100, output_tokens: 50 },
      output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://www.sumup.de/preise/', title: 'SumUp' }, { url: 'https://zettle.com/' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'SumUp ist günstig.', annotations: [] }] },
      ],
    }));
    const r = await chatgpt.run('frage', ctx);
    expect(r.citations).toEqual([
      { url: 'https://www.sumup.de/preise/', title: 'SumUp', kind: 'searched' },
      { url: 'https://zettle.com/', title: undefined, kind: 'searched' },
    ]);
  });

  it('Gemini: Sicherheitsfilter wird als Ablehnung gemeldet, nicht als Fehler', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test');
    stubFetch(reply(200, { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 10 } }));
    const r = await gemini.run('frage', ctx);
    expect(r.refusal).toMatch(/SAFETY/);
    expect(r.answer).toBe('');
  });

  it('DataForSEO: Kosten auch bei Fehlern, nur 40101 ist vorübergehend', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'x');
    vi.stubEnv('DATAFORSEO_PASSWORD', 'y');
    const fetch = stubFetch(
      reply(200, { tasks: [{ status_code: 40101, status_message: 'Internal SE Server Error', cost: 0.002 }] }),
      reply(200, { tasks: [{ status_code: 40501, status_message: 'Invalid Field', cost: 0.001 }] }),
    );
    const e1 = await googleAio.run('frage', ctx).catch((e) => e);
    expect(e1).toBeInstanceOf(EngineError);
    expect(e1.costUsd).toBe(0.002);
    expect(e1.retryable).toBe(true);
    const e2 = await googleAio.run('frage', ctx).catch((e) => e);
    expect(e2.costUsd).toBe(0.001);
    expect(e2.retryable).toBe(false);
    // keine Wiederholung im Adapter (der Runner ist die einzige Wiederholungsebene)
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
