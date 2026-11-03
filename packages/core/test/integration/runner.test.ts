import { brand, citation, closeDb, collection, db, mention, prompt, response, run, topic, workspace } from '@opengeo/db';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeLocally } from '../../src/analyze.ts';
import { EngineError } from '../../src/errors.ts';
import { analyzePendingResponses, CollectionActiveError, createCollection, monthToDateSpend, processCollection } from '../../src/runner.ts';
import { createDueScheduledCollections } from '../../src/scheduler.ts';
import type { Engine, EngineResult, RunContext } from '../../src/types.ts';
import { sleep } from '../../src/util.ts';

/** Test-Engine (ersetzt den Adapter über ProcessOptions.engineFor) */
const testEngine = (fn: (prompt: string, ctx: RunContext) => Promise<EngineResult>, provider = 'test'): Engine =>
  ({ key: 'mock', provider, enabled: () => true, run: fn });
const answer = (costUsd = 0, text = '1. **Paylindo** ist günstig.\n2. **SumUp** ist bekannt. Ich empfehle Paylindo.'): EngineResult => ({
  engine: 'test', model: 'test-model', answer: text, citations: [{ url: 'https://www.paylindo.de/preise', kind: 'cited' }],
  noAiAnswer: false, usage: null, costUsd, raw: { test: true },
});
const fast = { retryDelayMs: 1 };

const PREFIX = 'it-runner-';

async function seedWorkspace(slug: string, opts: { budget?: string; engines?: string[]; repetitions?: number } = {}) {
  const [ws] = await db.insert(workspace).values({
    name: slug, slug, engines: opts.engines ?? ['chatgpt', 'claude', 'google_aio'],
    repetitions: opts.repetitions ?? 2, monthlyBudgetUsd: opts.budget ?? '50', scheduleEnabled: false,
  }).returning();
  await db.insert(brand).values([
    { workspaceId: ws.id, name: 'Paylindo', aliases: ['paylindo.de'], domains: ['paylindo.de'], isOwn: true },
    { workspaceId: ws.id, name: 'SumUp', domains: ['sumup.de', 'sumup.com'] },
    { workspaceId: ws.id, name: 'Zettle', aliases: ['iZettle'], domains: ['zettle.com'] },
    { workspaceId: ws.id, name: 'Payone', domains: ['payone.com'] },
  ]);
  const [t] = await db.insert(topic).values({ workspaceId: ws.id, name: 'Kartenzahlung' }).returning();
  await db.insert(prompt).values([
    { workspaceId: ws.id, topicId: t.id, text: 'Welches EC-Kartengerät ist für ein kleines Café am günstigsten?' },
    { workspaceId: ws.id, topicId: t.id, text: 'SumUp oder Zettle – welches Kartenlesegerät ist besser?' },
    { workspaceId: ws.id, topicId: t.id, text: 'Bester Anbieter für Kartenzahlung ohne monatliche Grundgebühr' },
    { workspaceId: ws.id, topicId: t.id, text: 'Inaktiver Prompt', active: false },
  ]);
  return ws;
}

async function cleanup() {
  await db.delete(workspace).where(like(workspace.slug, `${PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await closeDb(); });

describe('Collection-Runner (Mock-Engines)', () => {
  it('legt Runs an, verarbeitet sie und speichert Antworten, Nennungen, Quellen', async () => {
    expect(process.env.DATABASE_URL).toMatch(/opengeo_test$/);
    const ws = await seedWorkspace(`${PREFIX}main`);
    const c = await createCollection(ws.id, 'manual');
    const runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs).toHaveLength(3 * 3 * 2); // 3 aktive Prompts × 3 Engines × 2 Wiederholungen

    const summary = await processCollection(c.id, { retryDelayMs: 1 });
    expect(summary).toMatchObject({ status: 'done', done: 18, failed: 0, skipped: 0, pending: 0, costUsd: 0 });

    const [col] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(col.status).toBe('done');
    expect(col.startedAt).not.toBeNull();
    expect(col.finishedAt).not.toBeNull();

    const after = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(after.every((r) => r.status === 'done' && r.model === 'mock' && r.attempts === 1)).toBe(true);

    const responses = await db.select().from(response).where(eq(response.workspaceId, ws.id));
    expect(responses).toHaveLength(18);
    const answered = responses.filter((r) => r.answer !== '');
    expect(answered.length).toBeGreaterThan(10);
    // Google AI Overviews ohne KI-Antwort sind erlaubt und als noAiAnswer markiert
    for (const r of responses.filter((x) => x.answer === '')) expect(r.noAiAnswer).toBe(true);

    const ms = await db.select().from(mention).where(eq(mention.workspaceId, ws.id));
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((m) => m.brandId !== null)).toBe(true); // lokaler Analyzer findet nur getrackte Marken
    // höchstens eine Nennung je Marke und Antwort
    const keys = ms.map((m) => `${m.responseId}:${m.brandId}`);
    expect(new Set(keys).size).toBe(keys.length);
    // jede genannte Marke steht tatsächlich im Antworttext
    const brands = await db.select().from(brand).where(eq(brand.workspaceId, ws.id));
    for (const m of ms) {
      const resp = responses.find((r) => r.id === m.responseId)!;
      const b = brands.find((x) => x.id === m.brandId)!;
      expect(resp.answer.toLowerCase()).toContain(b.name.toLowerCase());
    }

    const cs = await db.select().from(citation).where(eq(citation.workspaceId, ws.id));
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((x) => !x.domain.startsWith('www.') && x.position >= 1)).toBe(true);
    expect(cs.some((x) => x.domain === 'sumup.de' || x.domain === 'zettle.com' || x.domain === 'payone.com' || x.domain === 'paylindo.de')).toBe(true);

    // erneutes Verarbeiten ändert nichts (idempotent)
    const again = await processCollection(c.id);
    expect(again.done).toBe(18);
    expect(await db.$count(response, eq(response.workspaceId, ws.id))).toBe(18);
  });

  it('übernimmt eine vom Web angelegte Collection (queued, ohne Runs) und nimmt hängende Runs wieder auf', async () => {
    const ws = await seedWorkspace(`${PREFIX}resume`, { engines: ['gemini'], repetitions: 1 });
    const [c] = await db.insert(collection).values({ workspaceId: ws.id, status: 'queued', trigger: 'manual' }).returning();
    // Absturz simulieren: Runs anlegen, einen davon seit 20 Minuten "running"
    const { ensureRuns } = await import('../../src/runner.ts');
    await ensureRuns(c.id);
    await ensureRuns(c.id); // idempotent
    const runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs).toHaveLength(3);
    await db.update(run).set({ status: 'running', startedAt: new Date(Date.now() - 20 * 60 * 1000) }).where(eq(run.id, runs[0].id));
    await db.update(collection).set({ status: 'running' }).where(eq(collection.id, c.id));
    const s = await processCollection(c.id, { retryDelayMs: 1 });
    expect(s).toMatchObject({ status: 'done', done: 3 });
  });

  it('stoppt bei erreichtem Monatsbudget und überspringt restliche Runs', async () => {
    const ws = await seedWorkspace(`${PREFIX}budget`, { budget: '1.00', engines: ['chatgpt', 'claude'], repetitions: 2 });
    const c = await createCollection(ws.id, 'manual');
    // Schätzung 0,30 $ je Run, tatsächliche Kosten 0,25 $ je Run → nach 3 Runs (0,75 $) passt kein weiterer (0,75 + 0,30 > 1)
    const prevCost = process.env.OPENGEO_MOCK_COST_USD;
    process.env.OPENGEO_MOCK_COST_USD = '0.25';
    try {
      const s = await processCollection(c.id, { estimates: { mock: 0.3 }, concurrency: 1, retryDelayMs: 1 });
      expect(s.status).toBe('budget_exceeded');
      expect(s.done).toBe(3);
      expect(s.skipped).toBe(12 - 3);
      expect(s.costUsd).toBeCloseTo(0.75, 4);
    } finally {
      if (prevCost === undefined) delete process.env.OPENGEO_MOCK_COST_USD; else process.env.OPENGEO_MOCK_COST_USD = prevCost;
    }
    const runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs.filter((r) => r.status === 'skipped').every((r) => r.error === 'Monatsbudget erreicht')).toBe(true);
    expect(runs.filter((r) => r.status === 'done').every((r) => Number(r.costUsd) === 0.25)).toBe(true);
    const [col] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(col.status).toBe('budget_exceeded');
    expect(Number(col.costUsd)).toBeCloseTo(0.75, 4);

    // nächste Collection im selben Monat: sofort gestoppt
    const c2 = await createCollection(ws.id, 'manual');
    const s2 = await processCollection(c2.id, { estimates: { mock: 0.3 } });
    expect(s2).toMatchObject({ status: 'budget_exceeded', done: 0, skipped: 12 });
  });

  it('legt fällige geplante Collections an (einmal je Cron-Tick)', async () => {
    const ws = await seedWorkspace(`${PREFIX}sched`, { engines: ['gemini'], repetitions: 1 });
    await db.update(workspace).set({ scheduleEnabled: true, scheduleCron: '17 3 * * 1', createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(workspace.id, ws.id));
    const now = new Date(); // letzter Montag 03:17 liegt nach der Workspace-Anlage
    const created = await createDueScheduledCollections(now);
    const mine = await db.select().from(collection).where(and(eq(collection.workspaceId, ws.id), eq(collection.trigger, 'scheduled')));
    expect(mine).toHaveLength(1);
    expect(created).toContain(mine[0].id);
    // Collection created_at = jetzt (nach dem Tick) → kein zweites Mal fällig
    await createDueScheduledCollections(now);
    expect(await db.$count(collection, and(eq(collection.workspaceId, ws.id), eq(collection.trigger, 'scheduled')))).toBe(1);
    // aufräumen: andere Test-Workspaces nicht beeinflussen
    await db.delete(collection).where(inArray(collection.id, created));
  });

  it('frisch geänderter/eingeschalteter Messplan misst nicht sofort (schedule_updated_at)', async () => {
    const ws = await seedWorkspace(`${PREFIX}sched-upd`, { engines: ['gemini'], repetitions: 1 });
    const now = new Date();
    await db.update(workspace).set({
      scheduleEnabled: true, scheduleCron: '17 3 * * 1', createdAt: new Date('2026-01-01T00:00:00Z'), scheduleUpdatedAt: now,
    }).where(eq(workspace.id, ws.id));
    const created = await createDueScheduledCollections(new Date(now.getTime() + 1000));
    expect(await db.$count(collection, and(eq(collection.workspaceId, ws.id), eq(collection.trigger, 'scheduled')))).toBe(0);
    await db.delete(collection).where(inArray(collection.id, created.length ? created : ['00000000-0000-0000-0000-000000000000']));
  });
});

describe('Fehlerbehandlung, Kosten und Auswertung (injizierte Engines)', () => {
  it('ein werfender Run bricht die Collection nicht ab; gelöschter Prompt/Marke mitten im Lauf wird abgefangen', async () => {
    const ws = await seedWorkspace(`${PREFIX}throw`, { engines: ['chatgpt'], repetitions: 1 });
    const prompts = await db.select().from(prompt).where(and(eq(prompt.workspaceId, ws.id), eq(prompt.active, true)));
    const [boom, vanish, normal] = prompts;
    const c = await createCollection(ws.id, 'manual');
    const engine = testEngine(async (text) => {
      if (text === boom.text) throw new TypeError('Netzwerk kaputt');
      if (text === vanish.text) {
        // Prompt wird gelöscht, während die Engine antwortet (Run verschwindet per Cascade)
        await db.delete(prompt).where(eq(prompt.id, vanish.id));
        return answer(0.1);
      }
      return answer(0.02);
    });
    // Auswertung, während der eine Marke gelöscht wird → FK-Fehler beim Speichern der Nennung → neu zuordnen
    const analyzer = async (a: string, b: any[]) => {
      const res = analyzeLocally(a, b);
      await db.delete(brand).where(and(eq(brand.workspaceId, ws.id), eq(brand.name, 'SumUp')));
      return res;
    };
    const s = await processCollection(c.id, { ...fast, engineFor: () => engine, analyzer });
    expect(s).toMatchObject({ status: 'done', done: 1, failed: 1, pending: 0 });
    const runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs).toHaveLength(2); // der Run des gelöschten Prompts ist weg
    const failed = runs.find((r) => r.promptId === boom.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Netzwerk kaputt/);
    expect(failed.attempts).toBe(3); // Netzwerkfehler sind vorübergehend
    const ok = runs.find((r) => r.promptId === normal.id)!;
    expect(ok.status).toBe('done');
    const ms = await db.select().from(mention).innerJoin(response, eq(response.id, mention.responseId)).where(eq(response.runId, ok.id));
    expect(ms.map((m) => m.mention.name).sort()).toEqual(['Paylindo', 'SumUp']);
    expect(ms.find((m) => m.mention.name === 'SumUp')!.mention.brandId).toBeNull();
    // bezahlte Antwort des gelöschten Runs ist trotzdem auf der Collection verbucht
    const [col] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(Number(col.costUsd)).toBeCloseTo(0.12, 4);
  });

  it('verbucht Kosten bezahlter Fehlversuche und wiederholt nur vorübergehende Fehler', async () => {
    const ws = await seedWorkspace(`${PREFIX}paid`, { engines: ['chatgpt'], repetitions: 1 });
    const [p1, p2, p3] = await db.select().from(prompt).where(and(eq(prompt.workspaceId, ws.id), eq(prompt.active, true)));
    const calls = new Map<string, number>();
    const engine = testEngine(async (text) => {
      const n = (calls.get(text) ?? 0) + 1;
      calls.set(text, n);
      // vorübergehend (z. B. 529 nach bezahltem Teil-Aufruf): wiederholen, Kosten verbuchen
      if (text === p1.text && n < 3) throw new EngineError('overloaded', { costUsd: 0.1, retryable: true, status: 529 });
      // leere Antwort: bezahlt, deterministisch → kein erneuter Versuch
      if (text === p2.text) return { ...answer(0.07), answer: '' };
      // Auth-Fehler: nicht wiederholen
      if (text === p3.text) throw new EngineError('401: invalid key', { status: 401, retryable: false });
      return answer(0.05);
    });
    const s = await processCollection((await createCollection(ws.id)).id, { ...fast, engineFor: () => engine });
    expect(s).toMatchObject({ status: 'done', done: 1, failed: 2 });
    const runs = await db.select().from(run).where(eq(run.workspaceId, ws.id));
    const by = (id: string) => runs.find((r) => r.promptId === id)!;
    expect(by(p1.id)).toMatchObject({ status: 'done', attempts: 3 });
    expect(Number(by(p1.id).costUsd)).toBeCloseTo(0.25, 4);
    expect(by(p2.id)).toMatchObject({ status: 'failed', attempts: 1, error: 'leere Antwort' });
    expect(Number(by(p2.id).costUsd)).toBeCloseTo(0.07, 4);
    expect(by(p3.id)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(calls.get(p3.text)).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.32, 4);
    // Monatsausgaben = Run-Kosten nach Abschlusszeitpunkt
    expect(await monthToDateSpend(ws.id)).toBeCloseTo(0.32, 4);
  });

  it('speichert Ablehnungen als Antwort (answer_type refusal) ohne Wiederholung', async () => {
    const ws = await seedWorkspace(`${PREFIX}refusal`, { engines: ['claude'], repetitions: 1 });
    let calls = 0, analyzed = 0;
    const engine = testEngine(async () => {
      calls++;
      return { ...answer(0.03), answer: '', citations: [], refusal: 'Claude refusal: cyber' };
    });
    const s = await processCollection((await createCollection(ws.id)).id, {
      ...fast, engineFor: () => engine, analyzer: async (a, b) => { analyzed++; return analyzeLocally(a, b); },
    });
    expect(s).toMatchObject({ status: 'done', done: 3, failed: 0 });
    expect(calls).toBe(3);
    expect(analyzed).toBe(0);
    const rs = await db.select().from(response).where(eq(response.workspaceId, ws.id));
    expect(rs).toHaveLength(3);
    expect(rs.every((r) => r.answerType === 'refusal' && r.analyzed)).toBe(true);
    expect(s.costUsd).toBeCloseTo(0.09, 4);
  });

  it('behält die Antwort, wenn die Auswertung scheitert, und holt sie ohne neuen Engine-Aufruf nach', async () => {
    const ws = await seedWorkspace(`${PREFIX}pending`, { engines: ['chatgpt'], repetitions: 1 });
    let engineCalls = 0;
    const engine = testEngine(async () => { engineCalls++; return answer(0.05); });
    const c = await createCollection(ws.id);
    const s = await processCollection(c.id, {
      ...fast, engineFor: () => engine,
      analyzer: async () => { throw new EngineError('Analyse abgelehnt', { costUsd: 0.001, retryable: false }); },
    });
    expect(s).toMatchObject({ status: 'done', done: 3, failed: 0, analysisPending: 3 });
    expect(s.costUsd).toBeCloseTo(0.153, 4); // Engine + bezahlte Fehlversuche der Auswertung
    const [col] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(col.error).toMatch(/3 Antworten noch nicht ausgewertet/);
    let rs = await db.select().from(response).where(eq(response.workspaceId, ws.id));
    expect(rs.every((r) => !r.analyzed && r.answer.length > 0)).toBe(true);

    const res = await analyzePendingResponses({ ...fast, collectionId: c.id });
    expect(res).toEqual({ analyzed: 3, failed: 0 });
    expect(engineCalls).toBe(3);
    rs = await db.select().from(response).where(eq(response.workspaceId, ws.id));
    expect(rs.every((r) => r.analyzed && r.answerType === 'list')).toBe(true);
    expect(await db.$count(mention, eq(mention.workspaceId, ws.id))).toBe(6);
    const [col2] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(col2.error).toBeNull();
    const runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs.every((r) => r.status === 'done' && r.error === null)).toBe(true);
  });

  it('bricht ohne ANTHROPIC_API_KEY vor jedem Engine-Aufruf ab (Vorabprüfung)', async () => {
    const ws = await seedWorkspace(`${PREFIX}preflight`, { engines: ['chatgpt'], repetitions: 1 });
    let calls = 0;
    const engine = testEngine(async () => { calls++; return answer(0.1); });
    const c = await createCollection(ws.id);
    const prev = process.env.OPENGEO_MOCK_ENGINES;
    process.env.OPENGEO_MOCK_ENGINES = '0';
    try {
      expect(process.env.ANTHROPIC_API_KEY ?? '').toBe('');
      const s = await processCollection(c.id, { ...fast, engineFor: () => engine });
      expect(s.status).toBe('failed');
    } finally {
      process.env.OPENGEO_MOCK_ENGINES = prev;
    }
    expect(calls).toBe(0);
    const [col] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(col.error).toMatch(/ANTHROPIC_API_KEY/);
    const runs = await db.select().from(run).where(eq(run.collectionId, c.id));
    expect(runs.every((r) => r.status === 'failed')).toBe(true);
  });

  it('reserviert Budget synchron – parallele Runs überschreiten das Budget nicht', async () => {
    const ws = await seedWorkspace(`${PREFIX}race`, { budget: '1.00', engines: ['chatgpt', 'claude'], repetitions: 2 });
    const engine = testEngine(async () => { await sleep(30); return answer(0.25); });
    const s = await processCollection((await createCollection(ws.id)).id, {
      ...fast, engineFor: () => engine, estimates: { mock: 0.3 }, concurrency: 8, perProvider: 8,
    });
    expect(s.status).toBe('budget_exceeded');
    expect(s.done).toBe(3); // 3 × 0,30 $ reserviert, der 4. passt nicht mehr
    expect(s.costUsd).toBeLessThanOrEqual(1);
  });

  it('erlaubt höchstens eine aktive Collection je Workspace (auch für den Scheduler)', async () => {
    const ws = await seedWorkspace(`${PREFIX}dup`, { engines: ['gemini'], repetitions: 1 });
    const c1 = await createCollection(ws.id, 'manual');
    await expect(createCollection(ws.id, 'manual')).rejects.toBeInstanceOf(CollectionActiveError);
    await expect(db.insert(collection).values({ workspaceId: ws.id, status: 'queued' })).rejects.toThrow();
    await db.update(workspace).set({ scheduleEnabled: true, scheduleCron: '17 3 * * 1', createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(workspace.id, ws.id));
    const logs: string[] = [];
    const created = await createDueScheduledCollections(new Date(), (m) => logs.push(m));
    expect(await db.$count(collection, eq(collection.workspaceId, ws.id))).toBe(1);
    expect(logs.some((l) => l.includes(`${ws.slug} übersprungen`))).toBe(true);
    await db.update(workspace).set({ scheduleEnabled: false }).where(eq(workspace.id, ws.id));
    await processCollection(c1.id, fast);
    // nach Abschluss ist eine neue Messung wieder möglich
    const c2 = await createCollection(ws.id, 'manual');
    expect(c2.id).not.toBe(c1.id);
    await db.delete(collection).where(inArray(collection.id, [...created, c2.id]));
  });
});
