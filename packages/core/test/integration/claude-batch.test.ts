// Claude-Batch im Runner: Einreichen, kein doppeltes Einreichen, Abholen über mehrere Durchgänge (= Worker-Neustarts),
// Fehlerzustände, pause_turn-Nachgang, Budget mit Batch-Preisen. Batches API als In-Memory-Attrappe.
import { brand, citation, closeDb, collection, db, mention, prompt, response, run, topic, workspace } from '@opengeo/db';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BatchRequest, BatchResultLine, BatchTransport } from '../../src/claude-batch.ts';
import { EngineError } from '../../src/errors.ts';
import { batchReservedUsd, createCollection, processCollection, useClaudeBatch } from '../../src/runner.ts';
import type { Engine, EngineResult, RunContext } from '../../src/types.ts';

const PREFIX = 'it-batch-';

async function seedWorkspace(slug: string, opts: { budget?: string; engines?: string[] } = {}) {
  const [ws] = await db.insert(workspace).values({
    name: slug, slug, engines: opts.engines ?? ['claude'], repetitions: 1, monthlyBudgetUsd: opts.budget ?? '50', scheduleEnabled: false,
  }).returning();
  await db.insert(brand).values([
    { workspaceId: ws.id, name: 'Paylindo', domains: ['paylindo.de'], isOwn: true },
    { workspaceId: ws.id, name: 'SumUp', domains: ['sumup.de'] },
  ]);
  const [t] = await db.insert(topic).values({ workspaceId: ws.id, name: 'Kartenzahlung' }).returning();
  await db.insert(prompt).values([
    { workspaceId: ws.id, topicId: t.id, text: 'Frage A: günstigstes EC-Kartengerät?' },
    { workspaceId: ws.id, topicId: t.id, text: 'Frage B: SumUp oder Paylindo?' },
    { workspaceId: ws.id, topicId: t.id, text: 'Frage C: Kartenzahlung ohne Grundgebühr?' },
  ]);
  return ws;
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_details: null,
  usage: { input_tokens: 20000, output_tokens: 1000, server_tool_use: { web_search_requests: 2 } },
  content: [
    { type: 'web_search_tool_result', tool_use_id: 's', content: [{ type: 'web_search_result', url: 'https://sumup.de/preise', title: 'SumUp Preise' }] },
    { type: 'text', text, citations: [{ type: 'web_search_result_location', url: 'https://www.paylindo.de/', title: 'Paylindo' }] },
  ],
  ...extra,
});
// Sonnet 5.5 im Batch: (20000 × 2 + 1000 × 10) / 1e6 / 2 + 2 × 0,01 = 0,045 $
const BATCH_COST = 0.045;

/** Attrappe der Batches API („Server“-Zustand überlebt Worker-Neustarts, weil er nicht am Runner hängt). */
function fakeApi() {
  const batches = new Map<string, { status: string; endedAt: string | null; requests: BatchRequest[]; results: Map<string, BatchResultLine['result']> }>();
  let n = 0;
  let failNext: Error | null = null;
  const t: BatchTransport & {
    batches: typeof batches; submits: number; failNextSubmit(e: Error): void;
    end(id: string, fn: (req: BatchRequest) => BatchResultLine['result'] | null, endedAt?: string): void;
  } = {
    batches, submits: 0,
    failNextSubmit(e) { failNext = e; },
    async submit(requests) {
      if (failNext) { const e = failNext; failNext = null; throw e; }
      t.submits++;
      const id = `msgbatch_${++n}_${Math.random().toString(36).slice(2, 8)}`;
      batches.set(id, { status: 'in_progress', endedAt: null, requests, results: new Map() });
      return { id, processing_status: 'in_progress' };
    },
    async retrieve(id) {
      const b = batches.get(id);
      if (!b) throw new EngineError('404 not_found_error', { status: 404, retryable: false });
      return { id, processing_status: b.status, ended_at: b.endedAt };
    },
    async *results(id) {
      for (const r of batches.get(id)!.requests) {
        const res = batches.get(id)!.results.get(r.custom_id);
        if (res) yield { custom_id: r.custom_id, result: res };
      }
    },
    end(id, fn, endedAt = new Date().toISOString()) {
      const b = batches.get(id)!;
      for (const r of b.requests) { const res = fn(r); if (res) b.results.set(r.custom_id, res); }
      b.status = 'ended';
      b.endedAt = endedAt;
    },
  };
  return t;
}

const promptOf = (req: BatchRequest) => ((req.params as any).messages[0].content as string);
const fast = { retryDelayMs: 1, batch: true, recommend: false as const };

async function cleanup() { await db.delete(workspace).where(like(workspace.slug, `${PREFIX}%`)); }
beforeAll(cleanup);
afterAll(async () => { await cleanup(); await closeDb(); });

describe('Claude über die Message Batches API (Runner)', () => {
  it('nur geplante Messungen nutzen standardmäßig den Batch-Weg; nie im Mock-Modus ohne ausdrückliche Option', () => {
    expect(process.env.OPENGEO_MOCK_ENGINES).toBe('1');
    expect(useClaudeBatch('scheduled')).toBe(false); // Mock-Modus
    expect(useClaudeBatch('manual', { batch: true })).toBe(true);
    expect(useClaudeBatch('scheduled', { batch: false })).toBe(false);
  });

  it('reicht ein, reicht nicht doppelt ein, verarbeitet Ergebnisse wie synchron und Fehlerzustände über die Versuchslogik', async () => {
    const ws = await seedWorkspace(`${PREFIX}main`, { engines: ['claude', 'gemini'] });
    const api = fakeApi();
    const c = await createCollection(ws.id, 'scheduled');

    // Durchgang 1: Gemini synchron (Mock), Claude als ein Batch
    const s1 = await processCollection(c.id, { ...fast, batchTransport: api });
    expect(api.submits).toBe(1);
    const [batchId] = [...api.batches.keys()];
    expect(api.batches.get(batchId)!.requests).toHaveLength(3);
    expect(s1).toMatchObject({ status: 'running', done: 3, pending: 3, batchPending: 3 });
    const waiting = await db.select().from(run).where(and(eq(run.collectionId, c.id), eq(run.engine, 'claude')));
    expect(waiting.every((r) => r.status === 'running' && r.batchId === batchId && r.attempts === 1 && r.batchSubmittedAt)).toBe(true);
    // Budget-Reservierung für die eingereichten Runs (Mock-Schätzung 0 → mit Override prüfen)
    expect(await batchReservedUsd(ws.id, { estimates: { claude_batch: 0.06 } })).toBeCloseTo(0.18, 6);

    // Durchgang 2 (Batch läuft noch; Runs „hängen“ scheinbar seit 20 min): nichts erneut einreichen
    await db.update(run).set({ startedAt: new Date(Date.now() - 20 * 60 * 1000) }).where(eq(run.batchId, batchId));
    const s2 = await processCollection(c.id, { ...fast, batchTransport: api });
    expect(api.submits).toBe(1);
    expect(s2).toMatchObject({ status: 'running', batchPending: 3 });

    // Batch endet: A erfolgreich, B abgelaufen, C ungültige Anfrage
    const endedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    api.end(batchId, (req) => {
      const p = promptOf(req);
      if (p.startsWith('Frage A')) return { type: 'succeeded', message: message('1. **Paylindo** ist günstig. 2. **SumUp** ist bekannt.') };
      if (p.startsWith('Frage B')) return { type: 'expired' };
      return { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } };
    }, endedAt);
    // Durchgang 3 (neuer Runner = Worker-Neustart): Ergebnisse übernehmen, B sofort neu einreichen
    const s3 = await processCollection(c.id, { ...fast, batchTransport: api });
    expect(api.submits).toBe(2);
    expect(s3).toMatchObject({ status: 'running', batchPending: 1 });
    const runs = await db.select({ run, text: prompt.text }).from(run).innerJoin(prompt, eq(prompt.id, run.promptId))
      .where(and(eq(run.collectionId, c.id), eq(run.engine, 'claude')));
    const by = (pfx: string) => runs.find((x) => x.text.startsWith(pfx))!.run;
    expect(by('Frage A')).toMatchObject({ status: 'done', model: 'claude-sonnet-5-5', error: null, attempts: 1 });
    expect(Number(by('Frage A').costUsd)).toBeCloseTo(BATCH_COST, 4);
    expect(by('Frage A').finishedAt!.toISOString()).toBe(endedAt); // Zeitpunkt der Antwort = Ende des Batches
    expect(by('Frage B')).toMatchObject({ status: 'running', attempts: 2 });
    expect(by('Frage B').batchId).not.toBe(batchId);
    expect(by('Frage C')).toMatchObject({ status: 'failed', attempts: 1 });
    expect(by('Frage C').error).toMatch(/invalid_request_error/);

    // Antwort, Quellen, Nennungen wie bei einer synchronen Messung
    const [resp] = await db.select().from(response).where(eq(response.runId, by('Frage A').id));
    expect(resp).toMatchObject({ analyzed: true, answer: '1. **Paylindo** ist günstig. 2. **SumUp** ist bekannt.' });
    expect(resp.createdAt.toISOString()).toBe(endedAt);
    expect((resp.usage as any).batch).toBe(true);
    const cs = await db.select().from(citation).where(eq(citation.responseId, resp.id));
    expect(cs.map((x) => [x.domain, x.kind]).sort()).toEqual([['paylindo.de', 'cited'], ['sumup.de', 'searched']]);
    const ms = await db.select().from(mention).where(eq(mention.responseId, resp.id));
    expect(ms.map((m) => m.name).sort()).toEqual(['Paylindo', 'SumUp']);

    // zweiter Batch endet erfolgreich → Collection fertig, Kosten = Summe
    const second = by('Frage B').batchId!;
    api.end(second, () => ({ type: 'succeeded', message: message('**SumUp** oder **Paylindo** – beide gut.') }));
    const s4 = await processCollection(c.id, { ...fast, batchTransport: api });
    expect(s4).toMatchObject({ status: 'done', done: 3 + 2, failed: 1, pending: 0, batchPending: 0 });
    expect(s4.costUsd).toBeCloseTo(2 * BATCH_COST, 4);
    expect(api.submits).toBe(2);
    expect(await batchReservedUsd(ws.id, { estimates: { claude_batch: 0.06 } })).toBe(0);
  });

  it('abgelaufene Anfragen werden höchstens maxAttempts-mal eingereicht, danach Fehler', async () => {
    const ws = await seedWorkspace(`${PREFIX}expire`);
    const api = fakeApi();
    const c = await createCollection(ws.id, 'manual');
    const opts = { ...fast, batchTransport: api, maxAttempts: 2 };
    await processCollection(c.id, opts);
    for (let i = 0; i < 2; i++) {
      for (const [id, b] of api.batches) if (b.status !== 'ended') api.end(id, () => ({ type: 'expired' }));
      await processCollection(c.id, opts);
    }
    const s = await processCollection(c.id, opts);
    expect(api.submits).toBe(2);
    expect(s).toMatchObject({ status: 'failed', failed: 3, pending: 0 });
    const runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs.every((r) => r.attempts === 2 && /expired/.test(r.error ?? ''))).toBe(true);
  });

  it('fehlgeschlagenes Einreichen: vorübergehend → später erneut, verlorener Batch (404) → neu einreichen', async () => {
    const ws = await seedWorkspace(`${PREFIX}submitfail`);
    const api = fakeApi();
    const c = await createCollection(ws.id, 'manual');
    api.failNextSubmit(new EngineError('Claude-Batch Einreichen: 529 overloaded', { status: 529, retryable: true }));
    const s1 = await processCollection(c.id, { ...fast, batchTransport: api });
    expect(s1).toMatchObject({ status: 'running', pending: 3, batchPending: 0 });
    let runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs.every((r) => r.status === 'pending' && r.attempts === 1 && r.batchId === null)).toBe(true);

    await processCollection(c.id, { ...fast, batchTransport: api });
    expect(api.submits).toBe(1);
    // Batch geht beim Anbieter verloren → 404 → Runs neu einreichen (ein Versuch übrig)
    api.batches.clear();
    const s3 = await processCollection(c.id, { ...fast, batchTransport: api });
    expect(api.submits).toBe(2);
    expect(s3.batchPending).toBe(3);
    runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs.every((r) => r.attempts === 3)).toBe(true);
  });

  it('pause_turn: synchroner Nachgang mit Batch-Inhalten; Kosten = Batch-Anteil + Nachgang', async () => {
    const ws = await seedWorkspace(`${PREFIX}pause`);
    const api = fakeApi();
    const c = await createCollection(ws.id, 'manual');
    const seen: unknown[] = [];
    const engine: Engine = {
      key: 'claude', provider: 'anthropic', enabled: () => true,
      async run(_p: string, ctx: RunContext): Promise<EngineResult> {
        seen.push(ctx.claudeResume);
        return {
          engine: 'claude', model: 'claude-sonnet-5-5', answer: '**Paylindo** empfohlen.', citations: [], noAiAnswer: false,
          usage: null, refusal: null, costUsd: BATCH_COST + 0.01, raw: {},
        };
      },
    };
    await processCollection(c.id, { ...fast, batchTransport: api });
    const [id] = [...api.batches.keys()];
    api.end(id, () => ({ type: 'succeeded', message: message('Zwischenstand', { stop_reason: 'pause_turn' }) }));
    const s = await processCollection(c.id, { ...fast, batchTransport: api, engineFor: () => engine });
    expect(s).toMatchObject({ status: 'done', done: 3 });
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({ kind: 'pause_turn' });
    expect(s.costUsd).toBeCloseTo(3 * (BATCH_COST + 0.01), 4);
  });

  it('Fehler nach Übernahme eines Ergebnisses: Run wird mit bezahltem Batch-Anteil als Fehler gebucht, nicht „running“', async () => {
    const ws = await seedWorkspace(`${PREFIX}crash`);
    const api = fakeApi();
    const c = await createCollection(ws.id, 'manual');
    await processCollection(c.id, { ...fast, batchTransport: api });
    const [id] = [...api.batches.keys()];
    api.end(id, () => ({ type: 'succeeded', message: message('Zwischenstand', { stop_reason: 'pause_turn' }) }));
    const s = await processCollection(c.id, { ...fast, batchTransport: api, engineFor: () => { throw new Error('Adapter kaputt'); } });
    expect(s).toMatchObject({ status: 'failed', failed: 3, pending: 0, batchPending: 0 });
    expect(s.costUsd).toBeCloseTo(3 * BATCH_COST, 4);
  });

  it('Mock-Modus ohne Test-Transport: nie echte Batches, Claude läuft über den Mock', async () => {
    const ws = await seedWorkspace(`${PREFIX}mockguard`);
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'nicht-benutzen';
    try {
      const s = await processCollection((await createCollection(ws.id, 'scheduled')).id, { retryDelayMs: 1, batch: true, recommend: false });
      expect(s).toMatchObject({ status: 'done', done: 3, batchPending: 0 });
    } finally {
      process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('Budget mit Batch-Preisen: Reservierung eingereichter Batches gilt auch in späteren Durchgängen', async () => {
    const ws = await seedWorkspace(`${PREFIX}budget`, { budget: '0.15' });
    const api = fakeApi();
    const c = await createCollection(ws.id, 'manual');
    // 0,06 $ je Batch-Run → 2 passen (0,12), der dritte nicht (0,18 > 0,15)
    const s = await processCollection(c.id, { ...fast, batchTransport: api, estimates: { claude_batch: 0.06, mock: 0.06 } });
    expect(api.batches.values().next().value!.requests).toHaveLength(2);
    expect(s).toMatchObject({ skipped: 1, batchPending: 2 });
    // weitere Messung desselben Workspaces im selben Monat sieht die Reservierung
    expect(await batchReservedUsd(ws.id, { estimates: { claude_batch: 0.06 } })).toBeCloseTo(0.12, 6);
    const [id] = [...api.batches.keys()];
    api.end(id, () => ({ type: 'succeeded', message: message('**Paylindo**') }));
    const s2 = await processCollection(c.id, { ...fast, batchTransport: api, estimates: { claude_batch: 0.06, mock: 0.06 } });
    expect(s2).toMatchObject({ status: 'budget_exceeded', done: 2, skipped: 1 });
    expect(s2.costUsd).toBeCloseTo(2 * BATCH_COST, 4);
    const [col] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(col.finishedAt).not.toBeNull();
  });
});
