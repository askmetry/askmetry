// Claude über die Message Batches API – Transport mit gestubbtem fetch, Einordnung der Ergebnisse, Kosten mit Batch-Rabatt
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { anthropicBatchTransport, classifyBatchResult, type BatchResultLine } from '../../src/claude-batch.ts';
import { engineDefaults } from '../../src/engine-config.ts';
import { claude, claudeParams } from '../../src/engines/claude.ts';
import { EngineError } from '../../src/errors.ts';
import { costFromUsage } from '../../src/pricing.ts';

// Das SDK merkt sich fetch beim Anlegen des Clients → ein fester Stub, der je Test eine Antwortliste abarbeitet
type Call = { url: string; method: string; headers: Headers; body: any };
let queue: (() => Response)[] = [];
const calls: Call[] = [];
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jsonl = (lines: unknown[]) => () => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200, headers: { 'content-type': 'application/binary' } });

beforeAll(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn(async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null });
    const next = queue.shift();
    if (!next) throw new Error(`unerwarteter fetch ${url}`);
    return next();
  }));
});
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => { queue = []; calls.length = 0; });

const ctx = { country: 'DE', language: 'de', options: engineDefaults.claude as unknown as Record<string, unknown> };
const batch = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'msgbatch_1', type: 'message_batch', processing_status: status,
  request_counts: { processing: status === 'ended' ? 0 : 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
  created_at: '2026-11-03T10:00:00Z', expires_at: '2026-11-04T10:00:00Z', ended_at: null, results_url: null, ...extra,
});
const message = (extra: Record<string, unknown> = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_details: null,
  usage: { input_tokens: 20000, output_tokens: 1000, server_tool_use: { web_search_requests: 2 } },
  content: [
    { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'EC-Kartengerät Café' } },
    { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [
      { type: 'web_search_result', url: 'https://www.paylindo.de/preise', title: 'Preise' },
      { type: 'web_search_result', url: 'https://sumup.de/', title: 'SumUp' },
    ] },
    { type: 'text', text: 'Für ein Café eignet sich **Paylindo**.', citations: [
      { type: 'web_search_result_location', url: 'https://www.paylindo.de/preise', title: 'Preise', cited_text: '…' },
    ] },
  ],
  ...extra,
});

describe('Anfrage-Parameter', () => {
  it('Batch-Parameter = synchrone Parameter (Modell, effort, Suchen, Such-Anweisung), aber ohne fallbacks/betas', () => {
    const p = claudeParams('Welches Kartengerät?', ctx) as any;
    expect(p).toMatchObject({
      model: 'claude-sonnet-5-5', max_tokens: 16000, output_config: { effort: 'medium' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'DE' } }],
      system: engineDefaults.claude.system,
      messages: [{ role: 'user', content: 'Welches Kartengerät?' }],
    });
    expect(p).not.toHaveProperty('fallbacks');
    expect(p).not.toHaveProperty('betas');
    expect(p).not.toHaveProperty('batch'); // Engine-Option, kein API-Parameter
  });
});

describe('Transport (SDK, gestubbtes fetch)', () => {
  it('reicht einen Batch mit custom_id + params ein (ohne Beta-Header für fallbacks)', async () => {
    queue.push(json(200, batch('in_progress')));
    const t = anthropicBatchTransport();
    const info = await t.submit([{ custom_id: '6f1c2a9e-0000-4000-8000-000000000001', params: claudeParams('Frage', ctx) }]);
    expect(info).toMatchObject({ id: 'msgbatch_1', processing_status: 'in_progress' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v1\/messages\/batches$/);
    expect(calls[0].body.requests[0].custom_id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(calls[0].body.requests[0].params).not.toHaveProperty('fallbacks');
    expect(calls[0].headers.get('anthropic-beta') ?? '').not.toMatch(/server-side-fallback/);
  });

  it('fragt den Status ab und streamt die Ergebnisse (.jsonl)', async () => {
    const t = anthropicBatchTransport();
    queue.push(json(200, batch('in_progress')));
    expect((await t.retrieve('msgbatch_1')).processing_status).toBe('in_progress');
    expect(calls[0].url).toMatch(/\/v1\/messages\/batches\/msgbatch_1$/);

    queue.push(json(200, batch('ended', { ended_at: '2026-11-03T10:20:00Z', results_url: 'https://api.anthropic.com/v1/messages/batches/msgbatch_1/results' })));
    queue.push(jsonl([
      { custom_id: 'b', result: { type: 'expired' } },
      { custom_id: 'a', result: { type: 'succeeded', message: message() } },
    ]));
    const lines: BatchResultLine[] = [];
    for await (const l of t.results('msgbatch_1')) lines.push(l);
    expect(lines.map((l) => l.custom_id)).toEqual(['b', 'a']); // beliebige Reihenfolge → über custom_id zuordnen
    expect(calls.at(-1)!.url).toMatch(/\/results$/);
  });

  it('HTTP-Fehler: 429/5xx wiederholbar, 400 nicht', async () => {
    const t = anthropicBatchTransport();
    queue.push(json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }));
    await expect(t.submit([])).rejects.toMatchObject({ retryable: true, status: 429 });
    queue.push(json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: not supported in batches' } }));
    const e = await t.submit([]).catch((x) => x);
    expect(e).toBeInstanceOf(EngineError);
    expect(e.retryable).toBe(false);
    queue.push(json(404, { type: 'error', error: { type: 'not_found_error', message: 'nope' } }));
    await expect(t.retrieve('x')).rejects.toMatchObject({ status: 404, retryable: false });
  });
});

describe('Ergebnisse einordnen', () => {
  it('succeeded → gleiche Auswertung wie synchron: Antwort, cited + searched, Kosten mit Batch-Rabatt', () => {
    const out = classifyBatchResult({ custom_id: 'a', result: { type: 'succeeded', message: message() } }, 'claude-sonnet-5-5');
    expect(out.kind).toBe('result');
    if (out.kind !== 'result') return;
    const r = out.result;
    expect(r.answer).toBe('Für ein Café eignet sich **Paylindo**.');
    expect(r.citations).toEqual([
      { url: 'https://www.paylindo.de/preise', title: 'Preise', kind: 'cited' },
      { url: 'https://sumup.de/', title: 'SumUp', kind: 'searched' },
    ]);
    expect(r.refusal).toBeNull();
    expect(r.usage).toMatchObject({ batch: true, input_tokens: 20000, output_tokens: 1000 });
    // Sonnet 5.5: 2 $/10 $ je Mio. → Tokens 0,04 + 0,01 = 0,05 $, im Batch die Hälfte; Suchen 2 × 0,01 $ unverändert
    expect(r.costUsd).toBeCloseTo(0.025 + 0.02, 6);
    expect(r.model).toBe('claude-sonnet-5-5');
  });

  it('errored/expired/canceled → kein Ergebnis; nur invalid_request ist endgültig', () => {
    const err = (type: string) => classifyBatchResult({ custom_id: 'x', result: { type: 'errored', error: { type: 'error', error: { type, message: 'm' } } } }, 'm');
    expect(err('invalid_request_error')).toMatchObject({ kind: 'error', retryable: false });
    expect(err('api_error')).toMatchObject({ kind: 'error', retryable: true });
    expect(err('overloaded_error')).toMatchObject({ kind: 'error', retryable: true });
    expect(classifyBatchResult({ custom_id: 'x', result: { type: 'expired' } }, 'm')).toMatchObject({ kind: 'error', retryable: true });
    expect(classifyBatchResult({ custom_id: 'x', result: { type: 'canceled' } }, 'm')).toMatchObject({ kind: 'error', retryable: true });
  });

  it('pause_turn und refusal → synchroner Nachgang mit bezahltem Batch-Anteil', () => {
    const p = classifyBatchResult({ custom_id: 'a', result: { type: 'succeeded', message: message({ stop_reason: 'pause_turn' }) } }, 'm');
    expect(p).toMatchObject({ kind: 'resume', resume: { kind: 'pause_turn' } });
    if (p.kind === 'resume') expect(p.batchCostUsd).toBeCloseTo(0.045, 6);
    const rf = classifyBatchResult({ custom_id: 'a', result: { type: 'succeeded', message: message({ stop_reason: 'refusal', content: [] }) } }, 'm');
    expect(rf).toMatchObject({ kind: 'resume', resume: { kind: 'refusal' } });
  });
});

describe('synchroner Nachgang (engines/claude.ts)', () => {
  it('setzt pause_turn mit den Batch-Inhalten fort; Kosten = Batch-Anteil (−50 %) + synchroner Rest (Normalpreis)', async () => {
    const first = message({ stop_reason: 'pause_turn', content: message().content.slice(0, 2) });
    const out = classifyBatchResult({ custom_id: 'a', result: { type: 'succeeded', message: first } }, 'm');
    if (out.kind !== 'resume') throw new Error('erwartet resume');
    queue.push(json(200, {
      id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
      usage: { input_tokens: 10000, output_tokens: 500, server_tool_use: { web_search_requests: 0 } },
      content: [{ type: 'text', text: 'Paylindo.', citations: [{ type: 'web_search_result_location', url: 'https://sumup.de/', title: 'SumUp' }] }],
    }));
    const r = await claude.run('Frage', { ...ctx, claudeResume: out.resume });
    const sent = calls.at(-1)!.body;
    // Fortsetzung: gleiche Parameter, bisherige Inhalte als Assistant-Turn, synchron mit Server-Fallback
    expect(sent.messages).toEqual([{ role: 'user', content: 'Frage' }, { role: 'assistant', content: first.content }]);
    expect(sent).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' }, fallbacks: 'default' });
    expect(r.answer).toBe('Paylindo.');
    expect(r.citations.map((c) => [c.url, c.kind])).toEqual([['https://sumup.de/', 'cited'], ['https://www.paylindo.de/preise', 'searched']]);
    // Batch: 0,045 $; synchron: 0,02 + 0,005 = 0,025 $
    expect(r.costUsd).toBeCloseTo(0.045 + 0.025, 6);
  });
});

describe('Kosten', () => {
  it('usage.batch halbiert nur die Tokens der Claude-Engine', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, server_tool_use: { web_search_requests: 3 } };
    expect(costFromUsage({ engine: 'claude', model: 'claude-sonnet-5-5', usage })).toBeCloseTo(2 + 1 + 0.03, 6);
    expect(costFromUsage({ engine: 'claude', model: 'claude-sonnet-5-5', usage: { ...usage, batch: true } })).toBeCloseTo(1.5 + 0.03, 6);
    // andere Engines ignorieren das Feld
    expect(costFromUsage({ engine: 'analyzer', model: 'claude-haiku-5-5', usage: { input_tokens: 1e6, batch: true } })).toBeCloseTo(0.1, 6);
  });
});
