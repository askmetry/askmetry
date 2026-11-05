// Collection-Runner: Runs anlegen und abarbeiten (Parallelität, Wiederholungen, Budget, Wiederaufnahme)
import { collection, db, prompt, recommendationGeneration, response, run, workspace } from '@askmetry/db';
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { analyzeLocally, analyzeWithLlm, type AnalysisResult } from './analyze.ts';
import { anthropicBatchTransport, batchRequestTotal, classifyBatchResult, type BatchRequest, type BatchTransport } from './claude-batch.ts';
import { exceedsBudget, maxBudgetUsd } from './budget.ts';
import { engineDefaults, estimatedCostPerRun } from './engine-config.ts';
import { CLAUDE_DEFAULT_MODEL, claudeParams, parseClaudeContent, type ClaudeResume } from './engines/claude.ts';
import { claude as claudeEngine, getEngine, isMockMode } from './engines/index.ts';
import { EngineError, errorCost, isForeignKeyViolation, isRetryable, isUniqueViolation } from './errors.ts';
import { runLimited } from './limiter.ts';
import { addCost, loadWorkspaceBrands, storeAnalysis, storeResponse } from './store.ts';
import type { BrandRef, Engine, EngineResult } from './types.ts';
import crypto from 'node:crypto';
import { sleep } from './util.ts';

export const STALE_RUN_MS = 15 * 60 * 1000;
/** Batch nach so langer Zeit weiter nicht abrufbar (Netz-/API-Fehler) → Runs neu einreichen bzw. als Fehler buchen */
export const BATCH_GIVE_UP_MS = 48 * 60 * 60 * 1000;
/** Platzhalter-batch_id während des Einreichens (siehe submitClaudeBatch) */
export const SUBMITTING = 'submitting:';
/** so lange nach dem Einreichen keine Zuordnung versuchen (Anfrage evtl. noch unterwegs; SDK-Timeout 2 min) */
export const SUBMIT_GRACE_MS = 5 * 60 * 1000;
/** ohne jeden passenden Batch in der Liste nach dieser Zeit als Fehler buchen (nie neu einreichen) */
export const SUBMIT_NOT_FOUND_MS = 30 * 60 * 1000;

/** Eindeutig abgelehnt (Batch sicher nicht angelegt): 4xx außer 408 (Zeitüberschreitung). */
export function isDefiniteRejection(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408;
}

type Trigger = 'scheduled' | 'manual' | 'import';

/** Runs für alle aktiven Prompts × Engines × Wiederholungen anlegen (idempotent über den Unique-Index). */
export async function ensureRuns(collectionId: string): Promise<number> {
  const [c] = await db.select().from(collection).where(eq(collection.id, collectionId));
  if (!c) throw new Error(`Collection ${collectionId} nicht gefunden`);
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, c.workspaceId));
  const plan = parseCollectionPlan(c.plan);
  let prompts = await db.select({ id: prompt.id }).from(prompt)
    .where(and(eq(prompt.workspaceId, ws.id), eq(prompt.active, true))).orderBy(asc(prompt.createdAt));
  if (plan.promptIds) {
    const order = new Map(plan.promptIds.map((id, i) => [id, i]));
    prompts = prompts.filter((p) => order.has(p.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  const engineList = plan.engines ?? ws.engines;
  const rows: (typeof run.$inferInsert)[] = [];
  for (let rep = 1; rep <= Math.max(1, plan.repetitions ?? ws.repetitions); rep++) {
    prompts.forEach((p, i) => {
      for (const engine of engineList) {
        const max = plan.engineMaxPrompts?.[engine];
        if (max !== undefined && i >= max) continue;
        rows.push({ collectionId, workspaceId: ws.id, promptId: p.id, engine, repetition: rep });
      }
    });
  }
  if (rows.length) await db.insert(run).values(rows).onConflictDoNothing();
  return rows.length;
}

/** Es gibt schon eine wartende oder laufende Messung für den Workspace (Unique-Index collection_one_active_idx). */
export class CollectionActiveError extends Error {
  constructor() {
    super('Für diesen Workspace läuft bereits eine Messung oder sie wartet auf den Start.');
    this.name = 'CollectionActiveError';
  }
}

export async function hasActiveCollection(workspaceId: string): Promise<boolean> {
  const rows = await db.select({ id: collection.id }).from(collection)
    .where(and(eq(collection.workspaceId, workspaceId), inArray(collection.status, ['queued', 'running']))).limit(1);
  return rows.length > 0;
}

/**
 * Optionaler Messumfang einer Collection (gehostete Checks und Berichte, siehe HOSTED.md). Ohne Plan gilt:
 * alle aktiven Prompts × workspace.engines × workspace.repetitions.
 */
export interface CollectionPlan {
  /** nur diese Prompts (Reihenfolge = Rang für engineMaxPrompts); inaktive werden trotzdem übersprungen */
  promptIds?: string[];
  engines?: string[];
  repetitions?: number;
  /** je Engine höchstens die ersten n Prompts, z. B. { chatgpt: 5 } */
  engineMaxPrompts?: Record<string, number>;
  /** Claude über die Batches API (wie geplante Messungen), auch wenn trigger = manual */
  batch?: boolean;
  /** parallele Abfragen dieser Collection (z. B. Schnell-Check: schneller fertig); sonst ProcessOptions bzw. 4 / 2 je Anbieter */
  concurrency?: { total: number; perProvider: number };
}

export function parseCollectionPlan(raw: unknown): CollectionPlan {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : undefined;
  const plan: CollectionPlan = {};
  const ids = strings(r.promptIds); if (ids) plan.promptIds = ids;
  const eng = strings(r.engines); if (eng) plan.engines = eng;
  if (typeof r.repetitions === 'number' && Number.isInteger(r.repetitions) && r.repetitions >= 1 && r.repetitions <= 10) plan.repetitions = r.repetitions;
  if (r.engineMaxPrompts && typeof r.engineMaxPrompts === 'object') {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.engineMaxPrompts as Record<string, unknown>)) if (typeof v === 'number' && v >= 0) m[k] = Math.floor(v);
    plan.engineMaxPrompts = m;
  }
  if (typeof r.batch === 'boolean') plan.batch = r.batch;
  const cc = r.concurrency as Record<string, unknown> | undefined;
  const lim = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? Math.min(v, 32) : null);
  if (cc && typeof cc === 'object' && lim(cc.total) && lim(cc.perProvider)) plan.concurrency = { total: lim(cc.total)!, perProvider: lim(cc.perProvider)! };
  return plan;
}

export async function createCollection(workspaceId: string, trigger: Trigger = 'manual', plan?: CollectionPlan) {
  let c: typeof collection.$inferSelect;
  try {
    [c] = await db.insert(collection).values({ workspaceId, trigger, status: 'queued', ...(plan && { plan }) }).returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw new CollectionActiveError();
    throw e;
  }
  await ensureRuns(c.id);
  return c;
}

const monthStart = sql`(date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')`;

/**
 * Ausgaben des laufenden Kalendermonats (Europe/Berlin) in USD: Summe der Run-Kosten nach Abschlusszeitpunkt
 * (eine Messung über den Monatswechsel wird so korrekt auf beide Monate verteilt) plus Kosten der KI-Formulierung
 * von Maßnahmen (recommendation_generation).
 */
export async function monthToDateSpend(workspaceId: string): Promise<number> {
  const [[r], [g]] = await Promise.all([
    db.select({ total: sql<string>`coalesce(sum(${run.costUsd}), 0)` }).from(run).where(and(
      eq(run.workspaceId, workspaceId),
      isNotNull(run.finishedAt),
      sql`${run.finishedAt} >= ${monthStart}`,
    )),
    db.select({ total: sql<string>`coalesce(sum(${recommendationGeneration.costUsd}), 0)` }).from(recommendationGeneration).where(and(
      eq(recommendationGeneration.workspaceId, workspaceId),
      sql`${recommendationGeneration.createdAt} >= ${monthStart}`,
    )),
  ]);
  return Number(r?.total ?? 0) + Number(g?.total ?? 0);
}

export interface ProcessOptions {
  concurrency?: number;
  perProvider?: number;
  maxAttempts?: number;
  /** Wartezeit vor Versuch n: retryDelayMs * 2^(n-2) */
  retryDelayMs?: number;
  /** Schätzwerte je Engine überschreiben (z. B. für Tests) */
  estimates?: Record<string, number>;
  /** Abbruchsignal (SIGTERM): keine neuen Runs mehr starten */
  shouldStop?: () => boolean;
  log?: (msg: string) => void;
  /** Engine-Adapter ersetzen (Tests: werfende, ablehnende oder kostenpflichtige Mock-Engines) */
  engineFor?: (key: string) => Engine;
  /** Auswertung ersetzen (Tests) */
  analyzer?: (answer: string, brands: BrandRef[]) => Promise<AnalysisResult>;
  /** Maßnahmen nach Abschluss berechnen (Standard: an); false = aus, Objekt = Optionen für generateRecommendations */
  recommend?: false | import('./recommend/index.ts').GenerateOptions;
  /**
   * Claude-Runs über die Message Batches API (Standard: nur geplante Messungen, wenn engineDefaults.claude.batch;
   * nie im Mock-Modus). true/false erzwingt bzw. verbietet den Batch-Weg für diese Collection.
   */
  batch?: boolean;
  /** Batches-Transport ersetzen (Tests) */
  batchTransport?: BatchTransport;
}

export interface ProcessSummary {
  status: string;
  done: number;
  failed: number;
  skipped: number;
  pending: number;
  costUsd: number;
  /** gespeicherte Antworten, deren Auswertung noch aussteht */
  analysisPending?: number;
  /** Runs, die in einem Claude-Batch auf ihr Ergebnis warten (zählen zu pending) */
  batchPending?: number;
}

function estimateFor(engine: string, opts: ProcessOptions) {
  const key = isMockMode() ? 'mock' : engine;
  return opts.estimates?.[key] ?? estimatedCostPerRun[key] ?? 0;
}

const errMsg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 1000);

/**
 * Vorabprüfung: Ohne ANTHROPIC_API_KEY können echte Antworten nicht ausgewertet werden –
 * dann gar nicht erst (kostenpflichtig) abfragen. Im Mock-Modus wird lokal ausgewertet.
 */
export function analysisPreflightError(opts: Pick<ProcessOptions, 'analyzer'> = {}): string | null {
  if (opts.analyzer || isMockMode()) return null;
  if (!process.env.ANTHROPIC_API_KEY) return 'Kein ANTHROPIC_API_KEY gesetzt – Antworten können nicht ausgewertet werden. Messung ohne Abfragen abgebrochen.';
  return null;
}

type AnalyzeOutcome = { analysis: AnalysisResult; failedCost: number } | { error: string; failedCost: number };

async function analyzeWithRetry(answer: string, brands: BrandRef[], opts: ProcessOptions): Promise<AnalyzeOutcome> {
  const fn = opts.analyzer ?? (isMockMode() ? async (a: string, b: BrandRef[]) => analyzeLocally(a, b) : analyzeWithLlm);
  const maxAttempts = opts.maxAttempts ?? 3;
  const delay = opts.retryDelayMs ?? 5000;
  let failedCost = 0;
  let last: unknown;
  for (let a = 1; a <= maxAttempts; a++) {
    if (a > 1) await sleep(delay * 2 ** (a - 2));
    try {
      return { analysis: await fn(answer, brands), failedCost };
    } catch (e) {
      last = e;
      failedCost += errorCost(e);
      if (!isRetryable(e)) break;
    }
  }
  return { error: `Analyse: ${errMsg(last)}`, failedCost };
}

/**
 * Gespeicherte Antwort auswerten und Marken speichern. Schlägt die Auswertung fehl, bleibt die Antwort erhalten
 * (response.analyzed = false) und wird in einem späteren Worker-Durchgang nachgeholt – ohne erneuten Engine-Aufruf.
 */
async function analyzeStored(input: {
  responseId: string; runId: string; collectionId: string; workspaceId: string; answer: string; brands: BrandRef[];
}, opts: ProcessOptions): Promise<boolean> {
  const log = opts.log ?? (() => {});
  const out = await analyzeWithRetry(input.answer, input.brands, opts);
  if ('error' in out) {
    await db.transaction(async (tx) => {
      await addCost(tx, input.runId, input.collectionId, out.failedCost);
      await tx.update(run).set({ error: `Auswertung ausstehend – ${out.error}`.slice(0, 1000) }).where(eq(run.id, input.runId));
    });
    log(`⚠ Auswertung fehlgeschlagen (wird nachgeholt): ${out.error}`);
    return false;
  }
  const save = (brands: BrandRef[]) => db.transaction((tx) => storeAnalysis(tx, {
    responseId: input.responseId, runId: input.runId, collectionId: input.collectionId, workspaceId: input.workspaceId,
    analysis: out.analysis, brands: brands as { id: string; name: string }[], costUsd: out.analysis.costUsd + out.failedCost,
  }));
  try {
    await save(input.brands);
  } catch (e) {
    if (!isForeignKeyViolation(e)) throw e;
    // Marke wurde während des Laufs gelöscht → mit aktuellen Marken erneut zuordnen
    await save(await loadWorkspaceBrands(input.workspaceId));
  }
  return true;
}

/** Ausstehende Auswertungen nachholen (Worker: `once`/`start`). Ruft keine Engine erneut auf. */
export async function analyzePendingResponses(opts: ProcessOptions & { limit?: number; collectionId?: string } = {}) {
  const log = opts.log ?? (() => {});
  const conds = [eq(response.analyzed, false)];
  if (opts.collectionId) conds.push(eq(run.collectionId, opts.collectionId));
  const rows = await db.select({
    responseId: response.id, answer: response.answer, workspaceId: response.workspaceId, runId: run.id, collectionId: run.collectionId,
  }).from(response).innerJoin(run, eq(run.id, response.runId)).where(and(...conds))
    .orderBy(asc(response.createdAt)).limit(opts.limit ?? 200);
  if (!rows.length) return { analyzed: 0, failed: 0 };
  const pre = analysisPreflightError(opts);
  if (pre) {
    log(`${rows.length} Antworten warten auf Auswertung: ${pre}`);
    return { analyzed: 0, failed: rows.length };
  }
  const brandCache = new Map<string, BrandRef[]>();
  const touched = new Set<string>();
  let analyzed = 0, failed = 0;
  for (const r of rows) {
    if (opts.shouldStop?.()) break;
    try {
      let brands = brandCache.get(r.workspaceId);
      if (!brands) brandCache.set(r.workspaceId, brands = await loadWorkspaceBrands(r.workspaceId));
      if (await analyzeStored({ ...r, brands }, opts)) { analyzed++; touched.add(r.collectionId); } else failed++;
    } catch (e) {
      failed++;
      log(`✗ Nachträgliche Auswertung ${r.responseId}: ${errMsg(e)}`);
    }
  }
  for (const id of touched) await finalizeCollection(id, { refresh: true, recommend: opts.recommend, log });
  if (analyzed || failed) log(`Nachträgliche Auswertung: ${analyzed} ausgewertet, ${failed} weiterhin ausstehend`);
  return { analyzed, failed };
}

/** Atomar einen Run übernehmen (pending oder hängengeblieben). */
async function claimRun(runId: string) {
  const staleBefore = new Date(Date.now() - STALE_RUN_MS);
  const [r] = await db.update(run).set({
    status: 'running', startedAt: new Date(), error: null,
  }).where(and(
    eq(run.id, runId),
    // Runs in einem Claude-Batch (batch_id gesetzt) gelten nie als hängend – sonst doppelte Einreichung
    isNull(run.batchId),
    or(eq(run.status, 'pending'), and(eq(run.status, 'running'), lt(run.startedAt, staleBefore))),
  )).returning();
  return r;
}

/** Run als fehlgeschlagen markieren und bezahlte Kosten verbuchen. */
async function markRunFailed(runId: string, collectionId: string, error: string, attempts: number, costUsd: number, batchId?: string) {
  await db.transaction(async (tx) => {
    const updated = await tx.update(run).set({
      status: 'failed', error: error.slice(0, 1000), finishedAt: new Date(), attempts, costUsd: costUsd.toFixed(4),
    }).where(batchId ? and(eq(run.id, runId), eq(run.status, 'running'), eq(run.batchId, batchId)) : eq(run.id, runId))
      .returning({ id: run.id });
    if (updated.length && costUsd) {
      await tx.update(collection).set({ costUsd: sql`${collection.costUsd} + ${costUsd.toFixed(4)}::numeric` })
        .where(eq(collection.id, collectionId));
    }
  });
}

async function runExists(runId: string) {
  return (await db.select({ id: run.id }).from(run).where(eq(run.id, runId))).length > 0;
}

export async function processCollection(collectionId: string, opts: ProcessOptions = {}): Promise<ProcessSummary> {
  const log = opts.log ?? (() => {});
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryDelay = opts.retryDelayMs ?? 5000;
  const [c] = await db.select().from(collection).where(eq(collection.id, collectionId));
  if (!c) throw new Error(`Collection ${collectionId} nicht gefunden`);
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, c.workspaceId));

  if (['queued', 'running'].includes(c.status)) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(run).where(eq(run.collectionId, c.id));
    if (n === 0) await ensureRuns(c.id);

    // Vorabprüfung vor jedem kostenpflichtigen Aufruf
    const pre = analysisPreflightError(opts);
    if (pre) {
      log(pre);
      const now = new Date();
      await db.update(run).set({ status: 'failed', error: pre, finishedAt: now })
        .where(and(eq(run.collectionId, c.id), inArray(run.status, ['pending', 'running'])));
      await db.update(collection).set({ status: 'failed', error: pre, startedAt: c.startedAt ?? now, finishedAt: now })
        .where(eq(collection.id, c.id));
      return finalizeCollection(c.id, { recommend: false });
    }

    await db.update(collection).set({ status: 'running', startedAt: c.startedAt ?? new Date(), error: null })
      .where(eq(collection.id, c.id));

    const brands = await loadWorkspaceBrands(ws.id);
    const plan = parseCollectionPlan(c.plan);
    const planBatch = plan.batch;
    const batchMode = useClaudeBatch(c.trigger, planBatch !== undefined && opts.batch === undefined ? { batch: planBatch && !isMockMode() } : opts);
    const transport = opts.batchTransport ?? anthropicBatchTransport();
    // Budget serverseitig gedeckelt (ASKMETRY_MAX_BUDGET_USD)
    const budget = Math.min(Number(ws.monthlyBudgetUsd), maxBudgetUsd());
    // 1. Ergebnisse bereits eingereichter Claude-Batches abholen (auch nach einem Worker-Neustart)
    await collectClaudeBatches(c.id, ws.id, brands, transport, opts, budget);
    const staleBefore = new Date(Date.now() - STALE_RUN_MS);
    const todo = await db.select({ run, promptText: prompt.text, country: prompt.country, language: prompt.language })
      .from(run).innerJoin(prompt, eq(prompt.id, run.promptId))
      .where(and(eq(run.collectionId, c.id), isNull(run.batchId), or(
        eq(run.status, 'pending'),
        and(eq(run.status, 'running'), lt(run.startedAt, staleBefore)),
      )))
      .orderBy(asc(run.repetition), asc(prompt.createdAt), asc(run.engine));

    let budgetHit = false;
    let reserved = 0;
    const mock = isMockMode();
    if (mock) log('Mock-Modus: alle Engines durch den Mock ersetzt');
    const engineFor = opts.engineFor ?? getEngine;

    // Budget-Tor: Prüfung und Reservierung laufen nacheinander, damit gleichzeitige Runs nicht alle
    // reserved = 0 sehen. Die Reservierung wird freigegeben, sobald die Kosten des Runs gebucht sind.
    let gate: Promise<unknown> = Promise.resolve();
    const admit = (estimate: number): Promise<boolean> => {
      const p = gate.then(async () => {
        if (budgetHit) return false;
        // eingereichte, noch nicht abgerechnete Batch-Runs zählen mit ihrer Schätzung (auch aus früheren Durchgängen)
        const spent = await monthToDateSpend(ws.id) + await batchReservedUsd(ws.id, opts);
        if (exceedsBudget({ monthSpendUsd: spent, reservedUsd: reserved, estimateUsd: estimate, budgetUsd: budget })) {
          budgetHit = true;
          log(`Budget erreicht (${spent.toFixed(2)} $ + ${reserved.toFixed(2)} $ reserviert + ${estimate} $ > ${budget} $) – restliche Runs übersprungen`);
          return false;
        }
        reserved += estimate; // synchron nach der Prüfung, vor dem nächsten await
        return true;
      });
      gate = p.catch(() => {});
      return p;
    };

    const skip = (runId: string) => db.update(run).set({ status: 'skipped', error: 'Monatsbudget erreicht', finishedAt: new Date() })
      .where(and(eq(run.id, runId), inArray(run.status, ['pending', 'running'])));

    // 2. fällige Claude-Runs als ein Batch einreichen (geplante Messungen); alle übrigen Runs synchron wie bisher
    // im Mock-Modus nur mit Test-Transport (nie echte, bezahlte Batches)
    const batchable = batchMode && (opts.batchTransport || (!mock && claudeEngine.enabled()))
      ? todo.filter((t) => t.run.engine === 'claude') : [];
    if (batchable.length && !opts.shouldStop?.()) {
      await submitClaudeBatch(c.id, batchable, transport, {
        admit, skip, isBudgetHit: () => budgetHit, release: (n) => { reserved -= n; },
        estimate: batchEstimate(opts), mock, maxAttempts, log,
      }, opts);
    }
    const syncTodo = batchable.length ? todo.filter((t) => !batchable.includes(t)) : todo;

    const tasks = syncTodo.map(({ run: r, promptText, country, language }) => {
      let engine: Engine | null = null;
      let engineErr = '';
      try { engine = engineFor(r.engine); } catch (e) { engineErr = errMsg(e); }
      // Zustand des Runs, damit der Fehler-Handler bezahlte Kosten korrekt verbucht
      const st = { attempts: r.attempts, paid: 0, stored: false };

      const execute = async () => {
        if (opts.shouldStop?.()) return;
        if (!engine) {
          if (await claimRun(r.id)) await markRunFailed(r.id, c.id, engineErr, r.attempts, 0);
          return;
        }
        if (budgetHit) { await skip(r.id); return; }
        const estimate = estimateFor(r.engine, opts);
        let reservedMine = false;
        const release = () => { if (reservedMine) { reservedMine = false; reserved -= estimate; } };
        try {
          // Prüfen + Reservieren atomar (serialisiert): parallele Runs sehen die Reservierungen der anderen
          reservedMine = await admit(estimate);
          if (!reservedMine) { await skip(r.id); return; }

          const claimed = await claimRun(r.id);
          if (!claimed) return; // ein anderer Worker hat ihn übernommen
          st.attempts = claimed.attempts;
          let lastErr = '';
          let result: EngineResult | undefined;
          for (let a = 1; a <= maxAttempts; a++) {
            if (a > 1) await sleep(retryDelay * 2 ** (a - 2));
            st.attempts++;
            // startedAt je Versuch erneuern: lange Versuche (z. B. OpenAI flex) gelten sonst nach STALE_RUN_MS als hängend
            await db.update(run).set({ attempts: st.attempts, startedAt: new Date() }).where(eq(run.id, r.id));
            try {
              if (!engine.enabled()) throw new EngineError(`Kein API-Schlüssel für ${r.engine}`, { retryable: false });
              const res = await engine.run(promptText, {
                country, language, engineKey: r.engine, repetition: r.repetition, brands,
                options: mock ? {} : ((engineDefaults as Record<string, Record<string, unknown>>)[r.engine] ?? {}),
              });
              // leere Antwort nur akzeptieren, wenn die Engine bewusst keine KI-Antwort gezeigt oder abgelehnt hat;
              // sonst bezahlter, nicht wiederholbarer Fehlschlag
              if (!res.answer?.trim() && !res.noAiAnswer && !res.refusal) {
                throw new EngineError('leere Antwort', { costUsd: res.costUsd, retryable: false });
              }
              result = res;
              break;
            } catch (e) {
              st.paid += errorCost(e);
              lastErr = errMsg(e);
              log(`✗ ${r.engine} #${r.repetition} Versuch ${a}: ${lastErr}`);
              if (!isRetryable(e)) break;
            }
          }
          if (!result) {
            await markRunFailed(r.id, c.id, lastErr, st.attempts, st.paid);
            st.stored = true;
            return;
          }
          // 1. Antwort sichern (bezahlt) – erst danach auswerten
          st.paid += result.costUsd;
          const saved = await db.transaction((tx) => storeResponse(tx, {
            runId: r.id, collectionId: c.id, workspaceId: ws.id, result: result!, costUsd: st.paid, attempts: st.attempts, analyzed: false,
          }));
          st.stored = true;
          release();
          log(`✓ ${r.engine} #${r.repetition} (${result.model}, ${result.costUsd.toFixed(4)} $${result.refusal ? ', abgelehnt' : ''})`);
          // 2. Auswertung; bei Fehlschlag bleibt die Antwort erhalten und wird später nachgeholt
          if (saved.pending) {
            await analyzeStored({
              responseId: saved.responseId, runId: r.id, collectionId: c.id, workspaceId: ws.id, answer: result.answer, brands,
            }, opts);
          }
        } finally {
          release();
        }
      };

      return {
        provider: engine?.provider ?? 'unknown',
        // Ein fehlerhafter Run darf weder die Collection noch die Warteschlange abbrechen
        fn: async () => {
          try {
            await execute();
          } catch (e) {
            const msg = errMsg(e);
            try {
              if (isForeignKeyViolation(e) && !(await runExists(r.id))) {
                // Prompt (und damit der Run) wurde während des Laufs gelöscht – bezahlte Kosten auf der Collection verbuchen
                if (!st.stored && st.paid) {
                  await db.update(collection).set({ costUsd: sql`${collection.costUsd} + ${st.paid.toFixed(4)}::numeric` })
                    .where(eq(collection.id, c.id));
                }
                log(`– ${r.engine} #${r.repetition}: Prompt wurde während der Messung gelöscht, Ergebnis verworfen`);
              } else if (st.stored) {
                // Antwort ist gespeichert, nur die Auswertung ist gescheitert → später nachholen
                await db.update(run).set({ error: `Auswertung ausstehend – ${msg}`.slice(0, 1000) }).where(eq(run.id, r.id));
                log(`⚠ ${r.engine} #${r.repetition}: ${msg}`);
              } else {
                await markRunFailed(r.id, c.id, msg, st.attempts, st.paid);
                log(`✗ ${r.engine} #${r.repetition}: ${msg}`);
              }
            } catch (e2) {
              log(`✗ ${r.engine} #${r.repetition}: ${msg} (Status nicht speicherbar: ${errMsg(e2)})`);
            }
          }
        },
      };
    });

    await runLimited(tasks, { total: opts.concurrency ?? plan.concurrency?.total ?? 4, perProvider: opts.perProvider ?? plan.concurrency?.perProvider ?? 2 });

    if (budgetHit) {
      await db.update(run).set({ status: 'skipped', error: 'Monatsbudget erreicht', finishedAt: new Date() })
        .where(and(eq(run.collectionId, c.id), eq(run.status, 'pending')));
    }
  }
  return finalizeCollection(c.id, { recommend: opts.recommend, log });
}

/**
 * Status der Collection aus den Runs ableiten, sobald nichts mehr offen ist.
 * refresh: Hinweistext einer bereits abgeschlossenen Collection neu berechnen (nach nachgeholten Auswertungen).
 */
export async function finalizeCollection(collectionId: string, opts: {
  refresh?: boolean; recommend?: ProcessOptions['recommend']; log?: (msg: string) => void;
} = {}): Promise<ProcessSummary> {
  const counts = await db.select({ status: run.status, n: sql<number>`count(*)::int` }).from(run)
    .where(eq(run.collectionId, collectionId)).groupBy(run.status);
  const by = Object.fromEntries(counts.map((x) => [x.status, x.n])) as Record<string, number>;
  const done = by.done ?? 0, failed = by.failed ?? 0, skipped = by.skipped ?? 0;
  const open = (by.pending ?? 0) + (by.running ?? 0);
  const [{ n: analysisPending }] = await db.select({ n: sql<number>`count(*)::int` }).from(response)
    .innerJoin(run, eq(run.id, response.runId))
    .where(and(eq(run.collectionId, collectionId), eq(response.analyzed, false)));
  const [c] = await db.select().from(collection).where(eq(collection.id, collectionId));
  let status: string = c.status;
  const active = ['queued', 'running'].includes(c.status);
  if (open === 0 && (active || (opts.refresh && ['done', 'budget_exceeded'].includes(c.status)))) {
    const total = done + failed + skipped;
    const notes: string[] = [];
    if (skipped > 0) { status = 'budget_exceeded'; notes.push(`Monatsbudget erreicht – ${skipped} Abfragen übersprungen`); }
    else if (total === 0) { status = 'failed'; notes.push('Keine aktiven Prompts oder Engines'); }
    else if (done === 0) { status = 'failed'; notes.push('Alle Abfragen sind fehlgeschlagen'); }
    else { status = 'done'; if (failed) notes.push(`${failed} von ${total} Abfragen fehlgeschlagen`); }
    if (analysisPending) notes.push(`${analysisPending} Antworten noch nicht ausgewertet (wird nachgeholt)`);
    await db.update(collection).set({
      status: status as any, error: notes.join(' · ') || null, ...(active && { finishedAt: new Date() }),
    }).where(eq(collection.id, collectionId));
    // Maßnahmen neu berechnen – Fehler dürfen die Messung nicht als fehlgeschlagen markieren
    if (opts.recommend !== false && ['done', 'budget_exceeded'].includes(status) && done > 0) {
      try {
        const { generateRecommendationsSafe } = await import('./recommend/index.ts');
        await generateRecommendationsSafe(c.workspaceId, { log: opts.log, ...(opts.recommend || {}), collectionId, onlyIfLatest: true });
      } catch (e) {
        (opts.log ?? console.error)(`Maßnahmen konnten nicht berechnet werden: ${(e as Error)?.message ?? e}`);
      }
    }
  }
  const [fresh] = await db.select({ costUsd: collection.costUsd }).from(collection).where(eq(collection.id, collectionId));
  const batchPending = open ? await db.$count(run, and(eq(run.collectionId, collectionId), eq(run.status, 'running'), isNotNull(run.batchId))) : 0;
  return { status, done, failed, skipped, pending: open, costUsd: Number(fresh.costUsd), analysisPending, batchPending };
}

/** Nächste abzuarbeitende Collections: queued sowie unterbrochene (running) – älteste zuerst. */
export async function listProcessableCollections() {
  return db.select({ id: collection.id, workspaceId: collection.workspaceId, status: collection.status })
    .from(collection).where(inArray(collection.status, ['queued', 'running'])).orderBy(asc(collection.createdAt));
}

// ---------------------------------------------------------------------------
// Claude über die Message Batches API (geplante Messungen)
// ---------------------------------------------------------------------------
// Ablauf: fällige Claude-Runs claimen (status 'running') → ein Batch je Collection einreichen → batch_id am Run
// speichern. Solche Runs sind von der Hängend-Regel (STALE_RUN_MS) und vom erneuten Einreichen ausgenommen. Jeder
// spätere Worker-Durchgang (processCollection einer laufenden Collection) fragt den Status ab und verarbeitet fertige
// Ergebnisse wie synchrone: gleiche Auswertung (parseClaudeContent), Quellen, Analyse, Kosten (Tokens −50 %).
// Fehlgeschlagene Einzelanfragen (errored/expired/canceled) laufen über die Versuchslogik (attempts/maxAttempts).

/** Claude-Runs dieser Collection über die Batches API? */
export function useClaudeBatch(trigger: string, opts: Pick<ProcessOptions, 'batch'> = {}): boolean {
  if (opts.batch !== undefined) return opts.batch;
  if (isMockMode()) return false;
  return trigger === 'scheduled' && (engineDefaults.claude as { batch?: boolean }).batch !== false;
}

function batchEstimate(opts: ProcessOptions): number {
  return opts.estimates?.claude_batch ?? (isMockMode() ? (opts.estimates?.mock ?? 0) : estimatedCostPerRun.claude_batch ?? 0);
}

/** Geschätzte Kosten aller eingereichten, noch nicht abgerechneten Batch-Runs des Workspaces (Budget-Reservierung). */
export async function batchReservedUsd(workspaceId: string, opts: ProcessOptions = {}): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(run)
    .where(and(eq(run.workspaceId, workspaceId), eq(run.status, 'running'), isNotNull(run.batchId)));
  return n * batchEstimate(opts);
}

type TodoRow = { run: typeof run.$inferSelect; promptText: string; country: string; language: string };

/**
 * Einzelanfrage ohne Ergebnis: erneut einreichen (zurück auf pending), solange Versuche übrig sind, sonst Fehler.
 * batchId: nur ändern, wenn der Run noch in genau diesem Batch wartet (nie einen inzwischen fertigen Run zurücksetzen).
 */
async function retryOrFail(r: { id: string; attempts: number }, collectionId: string, message: string, retryable: boolean, maxAttempts: number, costUsd = 0, batchId?: string) {
  if (retryable && r.attempts < maxAttempts && !costUsd) {
    await db.update(run).set({ status: 'pending', batchId: null, batchSubmittedAt: null, startedAt: null, error: message.slice(0, 1000) })
      .where(batchId ? and(eq(run.id, r.id), eq(run.status, 'running'), eq(run.batchId, batchId)) : eq(run.id, r.id));
    return 'retry' as const;
  }
  await markRunFailed(r.id, collectionId, message, r.attempts, costUsd, batchId);
  return 'failed' as const;
}

async function submitClaudeBatch(collectionId: string, rows: TodoRow[], transport: BatchTransport, ctx: {
  admit: (estimate: number) => Promise<boolean>;
  skip: (runId: string) => Promise<unknown>;
  isBudgetHit: () => boolean;
  release: (usd: number) => void;
  estimate: number;
  mock: boolean;
  maxAttempts: number;
  log: (m: string) => void;
}, opts: ProcessOptions) {
  const claimed: TodoRow[] = [];
  let reservedHere = 0;
  try {
    // Budget mit Batch-Preisen prüfen und je Run reservieren (gleiches Budget-Tor wie synchron)
    for (const t of rows) {
      if (opts.shouldStop?.()) break;
      if (ctx.isBudgetHit() || !(await ctx.admit(ctx.estimate))) { await ctx.skip(t.run.id); continue; }
      reservedHere += ctx.estimate;
      const r = await claimRun(t.run.id);
      if (r) claimed.push({ ...t, run: r });
      else { ctx.release(ctx.estimate); reservedHere -= ctx.estimate; } // ein anderer Worker hat ihn
    }
    if (!claimed.length) return;
    const options = ctx.mock ? {} : ((engineDefaults as Record<string, Record<string, unknown>>).claude ?? {});
    // custom_id = Run-ID (UUID, erfüllt ^[a-zA-Z0-9_-]{1,64}$); Parameter identisch zur synchronen Abfrage, ohne fallbacks
    const requests: BatchRequest[] = claimed.map((t) => ({
      custom_id: t.run.id, params: claudeParams(t.promptText, { country: t.country, options }) as Record<string, unknown>,
    }));
    // Markierung VOR dem Einreichen: Platzhalter-batch_id „submitting:<uuid>“ + Zeitpunkt. So markierte Runs gelten nie
    // als hängend und werden nie still neu eingereicht – stirbt der Worker nach dem Einreichen oder scheitert das
    // Speichern der echten ID, ordnet reconcileSubmission den Batch später über die Batch-Liste zu.
    // startedAt = batchSubmittedAt markiert zugleich „Ergebnis noch nicht übernommen“ (siehe claimBatchResult).
    const marker = `${SUBMITTING}${crypto.randomUUID()}`;
    const now = new Date();
    await db.update(run).set({
      batchId: marker, batchSubmittedAt: now, startedAt: now, attempts: sql`${run.attempts} + 1`, error: null,
    }).where(inArray(run.id, claimed.map((t) => t.run.id)));
    let info;
    try {
      info = await transport.submit(requests);
    } catch (e) {
      const msg = errMsg(e);
      if (isDefiniteRejection(e)) {
        // eindeutige Ablehnung (4xx außer 408): Batch wurde nicht angelegt → Versuchslogik (pending bzw. failed)
        ctx.log(`✗ Claude-Batch (${claimed.length} Anfragen) abgelehnt: ${msg}`);
        for (const t of claimed) {
          await retryOrFail({ id: t.run.id, attempts: t.run.attempts + 1 }, collectionId, msg, isRetryable(e), ctx.maxAttempts, 0, marker);
        }
      } else {
        // mehrdeutig (Zeitüberschreitung, Netzfehler, 5xx): Batch existiert vielleicht → nicht neu einreichen, zuordnen
        await db.update(run).set({ error: `Einreichen unklar – wird über die Batch-Liste zugeordnet: ${msg}`.slice(0, 1000) })
          .where(eq(run.batchId, marker));
        ctx.log(`⚠ Claude-Batch (${claimed.length} Anfragen): Einreichen unklar (${msg}) – Zuordnung über die Batch-Liste, kein erneutes Einreichen`);
      }
      return;
    }
    try {
      await db.update(run).set({ batchId: info.id }).where(eq(run.batchId, marker));
    } catch (e) {
      // Markierung bleibt → reconcileSubmission findet den Batch über die Liste
      ctx.log(`⚠ Claude-Batch ${info.id} eingereicht, ID nicht gespeichert (${errMsg(e)}) – wird über die Batch-Liste zugeordnet`);
      return;
    }
    ctx.log(`→ Claude-Batch ${info.id} eingereicht: ${claimed.length} Anfragen (Status ${info.processing_status})`);
  } finally {
    // ab jetzt reserviert batchReservedUsd (Datenbank) die Kosten – auch über Worker-Neustarts hinweg
    ctx.release(reservedHere);
  }
}

/**
 * Ergebnis eines Batch-Runs atomar übernehmen: nur einmal (startedAt noch = batchSubmittedAt) oder nach einem
 * abgebrochenen Übernahmeversuch (startedAt älter als STALE_RUN_MS). Schützt vor doppelter Verarbeitung durch zwei Worker.
 */
async function claimBatchResult(runId: string, batchId: string) {
  const staleBefore = new Date(Date.now() - STALE_RUN_MS);
  const [r] = await db.update(run).set({ startedAt: new Date() }).where(and(
    eq(run.id, runId), eq(run.batchId, batchId), eq(run.status, 'running'),
    or(sql`${run.startedAt} = ${run.batchSubmittedAt}`, lt(run.startedAt, staleBefore)),
  )).returning();
  return r;
}

/** Fertige Claude-Batches einer Collection abholen und verarbeiten. Gibt die Zahl der verarbeiteten Runs zurück. */
async function collectClaudeBatches(collectionId: string, workspaceId: string, brands: BrandRef[], transport: BatchTransport, opts: ProcessOptions, budgetUsd: number): Promise<number> {
  const log = opts.log ?? (() => {});
  const maxAttempts = opts.maxAttempts ?? 3;
  const waiting = await db.select({ run, promptText: prompt.text, country: prompt.country, language: prompt.language })
    .from(run).innerJoin(prompt, eq(prompt.id, run.promptId))
    .where(and(eq(run.collectionId, collectionId), eq(run.status, 'running'), isNotNull(run.batchId)));
  if (!waiting.length) return 0;
  const byBatch = new Map<string, typeof waiting>();
  for (const w of waiting) byBatch.set(w.run.batchId!, [...(byBatch.get(w.run.batchId!) ?? []), w]);
  let handled = 0;
  for (const [batchId, rows] of byBatch) {
    if (opts.shouldStop?.()) break;
    if (batchId.startsWith(SUBMITTING)) {
      handled += await reconcileSubmission(batchId, rows, transport, collectionId, log);
      continue;
    }
    let info;
    try {
      info = await transport.retrieve(batchId);
    } catch (e) {
      const oldest = Math.min(...rows.map((w) => w.run.batchSubmittedAt?.getTime() ?? Date.now()));
      // 404: Batch existiert nicht (mehr) → sofort neu einreichen; sonst erst nach BATCH_GIVE_UP_MS aufgeben
      const gone = (e as { status?: number })?.status === 404;
      if (gone || Date.now() - oldest > BATCH_GIVE_UP_MS) {
        log(`✗ Claude-Batch ${batchId} nicht abrufbar (${errMsg(e)}) – ${rows.length} Runs werden neu eingereicht bzw. als Fehler gebucht`);
        for (const w of rows) {
          if (!(await claimBatchResult(w.run.id, batchId))) continue;
          await retryOrFail(w.run, collectionId, `Claude-Batch ${batchId} nicht abrufbar: ${errMsg(e)}`, true, maxAttempts, 0, batchId);
          handled++;
        }
      } else {
        log(`⚠ Claude-Batch ${batchId}: Status nicht abrufbar (${errMsg(e)}) – nächster Durchgang`);
      }
      continue;
    }
    if (info.processing_status !== 'ended') {
      log(`… Claude-Batch ${batchId}: ${info.processing_status} (${rows.length} Anfragen offen)`);
      continue;
    }
    // Zeitpunkt der Antwort: Ende des Batches (nicht der Zeitpunkt, zu dem der Worker abholt)
    const at = info.ended_at ? new Date(info.ended_at) : new Date();
    const pending = new Map(rows.map((w) => [w.run.id, w]));
    // Ergebniszeilen ohne wartenden Run: schon verarbeitet oder Run gelöscht (Frage gelöscht → cascade)
    const others: import('./claude-batch.ts').BatchResultLine[] = [];
    try {
      for await (const line of transport.results(batchId)) {
        const w = pending.get(line.custom_id);
        if (!w) { if (!rows.some((x) => x.run.id === line.custom_id)) others.push(line); continue; }
        pending.delete(line.custom_id);
        if (opts.shouldStop?.()) break;
        try {
          if (await handleBatchResult(w, batchId, line, at, brands, collectionId, workspaceId, opts, budgetUsd)) handled++;
        } catch (e) {
          log(`✗ claude #${w.run.repetition} (Batch ${batchId}): ${errMsg(e)}`);
        }
      }
    } catch (e) {
      // dauerhaft nicht lesbar (z. B. Ergebnisse nach 29 Tagen gelöscht) → nach BATCH_GIVE_UP_MS neu einreichen bzw. Fehler
      if (Date.now() - at.getTime() > BATCH_GIVE_UP_MS) {
        log(`✗ Claude-Batch ${batchId}: Ergebnisse nicht lesbar (${errMsg(e)}) – ${pending.size} Runs werden neu eingereicht bzw. als Fehler gebucht`);
        for (const w of pending.values()) {
          if (!(await claimBatchResult(w.run.id, batchId))) continue;
          await retryOrFail(w.run, collectionId, `Claude-Batch ${batchId}: Ergebnisse nicht lesbar: ${errMsg(e)}`, true, maxAttempts, 0, batchId);
          handled++;
        }
      } else {
        log(`⚠ Claude-Batch ${batchId}: Ergebnisse nicht lesbar (${errMsg(e)}) – nächster Durchgang`);
      }
      continue;
    }
    if (opts.shouldStop?.()) break;
    // Batch beendet, aber ohne Ergebnis für diesen Run (sollte nicht vorkommen) → neu einreichen
    for (const w of pending.values()) {
      if (!(await claimBatchResult(w.run.id, batchId))) continue;
      await retryOrFail(w.run, collectionId, `Claude-Batch ${batchId}: kein Ergebnis für diese Anfrage`, true, maxAttempts, 0, batchId);
      handled++;
    }
    await bookOrphanResults(batchId, others, collectionId, log);
  }
  return handled;
}

/**
 * Bezahlte Ergebnisse, deren Run inzwischen gelöscht ist (Frage während des Wartens gelöscht), auf der Collection
 * verbuchen – wie der synchrone FK-Zweig. Genau einmal: erst wenn kein Run des Batches mehr wartet (danach wird der
 * Batch nie wieder gelesen).
 */
async function bookOrphanResults(batchId: string, lines: import('./claude-batch.ts').BatchResultLine[], collectionId: string, log: (m: string) => void) {
  if (!lines.length) return;
  const ids = lines.map((l) => l.custom_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const existing = new Set(ids.length ? (await db.select({ id: run.id }).from(run).where(inArray(run.id, ids))).map((r) => r.id) : []);
  const model = (engineDefaults.claude as { model?: string }).model ?? CLAUDE_DEFAULT_MODEL;
  let cost = 0, n = 0;
  for (const l of lines) {
    if (existing.has(l.custom_id)) continue;
    const out = classifyBatchResult(l, model);
    const c = out.kind === 'result' ? out.result.costUsd : out.kind === 'resume' ? out.batchCostUsd : 0;
    if (c) { cost += c; n++; }
  }
  if (!cost) return;
  // genau einmal, auch bei parallelen Workern: batch_submitted_at der abgeschlossenen Runs dient als „noch nicht
  // verbucht“-Merker (wird nur für wartende Runs gebraucht). Das UPDATE sperrt die Zeilen; ein zweiter Worker sieht danach
  // keine Zeile mehr und bucht nicht.
  const booked = await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(run).where(and(eq(run.batchId, batchId), eq(run.status, 'running')));
    if (n) return false;
    const closed = await tx.update(run).set({ batchSubmittedAt: null })
      .where(and(eq(run.batchId, batchId), isNotNull(run.batchSubmittedAt))).returning({ id: run.id });
    if (!closed.length) return false;
    await tx.update(collection).set({ costUsd: sql`${collection.costUsd} + ${cost.toFixed(4)}::numeric` }).where(eq(collection.id, collectionId));
    return true;
  });
  if (!booked) return;
  log(`– Claude-Batch ${batchId}: ${n} Ergebnisse gelöschter Fragen verworfen, ${cost.toFixed(4)} $ auf der Messung verbucht`);
}

/**
 * Unklare Einreichung (Platzhalter-batch_id): den echten Batch über die Batch-Liste finden. Kandidaten: angelegt kurz
 * nach der Markierung, mindestens so viele Anfragen wie markierte Runs, noch keinem Run zugeordnet. Zugeordnet wird erst,
 * wenn ein Kandidat beendet ist und seine custom_ids alle markierten Runs enthalten (eindeutig, auch bei fremden Batches
 * im selben API-Workspace). Nie neu einreichen: ohne passenden Batch nach SUBMIT_NOT_FOUND_MS bzw. mit nur unpassenden
 * Kandidaten → failed (keine Kosten angefallen oder nicht zuordenbar).
 */
async function reconcileSubmission(marker: string, rows: TodoRow[], transport: BatchTransport, collectionId: string, log: (m: string) => void): Promise<number> {
  const at = rows[0].run.batchSubmittedAt?.getTime() ?? 0;
  const age = Date.now() - at;
  if (age < SUBMIT_GRACE_MS) return 0; // Einreichen evtl. noch unterwegs
  const ids = new Set(rows.map((w) => w.run.id));
  const fail = async (why: string) => {
    log(`✗ Claude-Batch-Einreichung ${marker}: ${why} – ${rows.length} Runs als Fehler gebucht (nicht erneut eingereicht)`);
    for (const w of rows) await markRunFailed(w.run.id, collectionId, `Claude-Batch: ${why} (nicht erneut eingereicht, um Doppelkosten zu vermeiden)`, w.run.attempts, 0, marker);
    return rows.length;
  };
  const candidates: import('./claude-batch.ts').BatchInfo[] = [];
  try {
    for await (const b of transport.list()) {
      const created = b.created_at ? Date.parse(b.created_at) : NaN;
      if (!Number.isFinite(created)) continue;
      if (created < at - 2 * 60_000) break; // neueste zuerst → ältere sind nicht mehr relevant
      if (created > at + SUBMIT_GRACE_MS) continue;
      // vor der Markierung beendet → älterer Batch (z. B. derselben Runs vor einer Neueinreichung), nie unserer
      if (b.ended_at && Date.parse(b.ended_at) < at) continue;
      if (batchRequestTotal(b) < ids.size) continue;
      candidates.push(b);
    }
  } catch (e) {
    if (age > BATCH_GIVE_UP_MS) return fail(`Batch-Liste nicht abrufbar (${errMsg(e)})`);
    log(`⚠ Claude-Batch-Einreichung ${marker}: Batch-Liste nicht abrufbar (${errMsg(e)}) – nächster Durchgang`);
    return 0;
  }
  const known = candidates.length
    ? new Set((await db.select({ b: run.batchId }).from(run).where(inArray(run.batchId, candidates.map((c) => c.id)))).map((x) => x.b))
    : new Set<string | null>();
  const open = candidates.filter((c) => !known.has(c.id));
  let unreadable = false;
  for (const b of open.filter((c) => c.processing_status === 'ended')) {
    const got = new Set<string>();
    try {
      for await (const l of transport.results(b.id)) got.add(l.custom_id);
    } catch { unreadable = true; continue; }
    if ([...ids].every((id) => got.has(id))) {
      const moved = await db.update(run).set({ batchId: b.id, error: null }).where(eq(run.batchId, marker)).returning({ id: run.id });
      log(`✓ Claude-Batch-Einreichung ${marker} zugeordnet: ${b.id} (${moved.length} Runs)`);
      return 0; // Ergebnisse holt der nächste Durchgang ab
    }
  }
  // ein Kandidat läuft noch oder seine Ergebnisse waren nicht lesbar → nicht vorschnell aufgeben (könnte unserer sein)
  if ((unreadable || open.some((c) => c.processing_status !== 'ended')) && age < BATCH_GIVE_UP_MS) {
    log(`… Claude-Batch-Einreichung ${marker}: ${open.length} möglicher Batch läuft noch – Zuordnung nach dessen Ende`);
    return 0;
  }
  if (age < SUBMIT_NOT_FOUND_MS) return 0;
  return fail(open.length ? 'kein passender Batch (custom_ids stimmen nicht)' : 'kein passender Batch gefunden');
}

async function handleBatchResult(
  w: TodoRow, batchId: string, line: import('./claude-batch.ts').BatchResultLine, at: Date, brands: BrandRef[],
  collectionId: string, workspaceId: string, opts: ProcessOptions, budgetUsd: number,
): Promise<boolean> {
  const r = await claimBatchResult(w.run.id, batchId);
  if (!r) return false; // ein anderer Worker übernimmt gerade
  // wie synchron: ein Fehler nach der Übernahme darf den Run nicht dauerhaft „running“ lassen (sonst alle 15 min neu
  // übernommen und ggf. erneut bezahlt) → bezahlte Kosten verbuchen und Run als Fehler abschließen
  const st = { paid: 0, attempts: r.attempts, stored: false };
  try {
    return await processBatchResult(w, r, batchId, line, at, brands, collectionId, workspaceId, opts, st, budgetUsd);
  } catch (e) {
    const msg = errMsg(e);
    if (st.stored) {
      await db.update(run).set({ error: `Auswertung ausstehend – ${msg}`.slice(0, 1000) }).where(eq(run.id, r.id));
    } else if (isForeignKeyViolation(e) && !(await runExists(r.id))) {
      // Prompt/Run während der Verarbeitung gelöscht – bezahlte Kosten auf der Collection verbuchen
      if (st.paid) await db.update(collection).set({ costUsd: sql`${collection.costUsd} + ${st.paid.toFixed(4)}::numeric` }).where(eq(collection.id, collectionId));
    } else {
      await markRunFailed(r.id, collectionId, msg, st.attempts, st.paid, batchId);
    }
    throw e;
  }
}

async function processBatchResult(
  w: TodoRow, r: typeof run.$inferSelect, batchId: string, line: import('./claude-batch.ts').BatchResultLine, at: Date,
  brands: BrandRef[], collectionId: string, workspaceId: string, opts: ProcessOptions,
  st: { paid: number; attempts: number; stored: boolean }, budgetUsd: number,
): Promise<boolean> {
  const log = opts.log ?? (() => {});
  const maxAttempts = opts.maxAttempts ?? 3;
  const model = (engineDefaults.claude as { model?: string }).model ?? CLAUDE_DEFAULT_MODEL;
  const out = classifyBatchResult(line, model);
  if (out.kind === 'error') {
    const res = await retryOrFail(r, collectionId, out.message, out.retryable, maxAttempts, 0, batchId);
    log(`${res === 'retry' ? '↻' : '✗'} claude #${r.repetition} (Batch): ${out.message}${res === 'retry' ? ' – wird neu eingereicht' : ''}`);
    return true;
  }
  let result = out.kind === 'result' ? out.result : undefined;
  if (out.kind === 'resume') {
    // Budget vor dem synchronen Nachgang (Normalpreis) prüfen; die Reservierung dieses Runs ist schon enthalten
    const estimate = opts.estimates?.claude ?? (isMockMode() ? (opts.estimates?.mock ?? 0) : estimatedCostPerRun.claude ?? 0);
    // dieser Run steckt mit der Schätzung in batchReservedUsd – durch seinen tatsächlichen Batch-Anteil ersetzen
    const spent = await monthToDateSpend(workspaceId) + await batchReservedUsd(workspaceId, opts) - batchEstimate(opts) + out.batchCostUsd;
    if (exceedsBudget({ monthSpendUsd: spent, estimateUsd: estimate, budgetUsd })) {
      if (out.resume.kind === 'refusal') {
        // wie synchron ohne Fallback: Ablehnung als Antwort speichern (answer_type 'refusal')
        result = parseClaudeContent({
          content: out.resume.content, stopReason: 'refusal', stopDetails: out.resume.raw?.stop_details,
          model: out.resume.raw?.model ?? model, usage: out.resume.usage, raw: { ...out.resume.raw, batch: { kind: 'batch' } },
        });
        log(`– claude #${r.repetition} (Batch): Ablehnung ohne Neustellung gespeichert – Monatsbudget erreicht`);
      } else {
        // pause_turn: Antwort unvollständig – wie synchron nach erschöpften Fortsetzungen ein bezahlter Fehlschlag
        await markRunFailed(r.id, collectionId, 'Claude: Antwort im Batch unvollständig (pause_turn), Fortsetzung wegen Monatsbudget nicht möglich', st.attempts, out.batchCostUsd, batchId);
        return true;
      }
    }
  }
  if (out.kind === 'resume' && !result) {
    // pause_turn bzw. Ablehnung: synchron nachholen (Ablehnung mit Server-Fallback wie bei synchronen Messungen)
    st.paid = out.batchCostUsd;
    const engine = (opts.engineFor ?? getEngine)('claude');
    const delay = opts.retryDelayMs ?? 5000;
    let lastErr = '';
    for (let a = 1; a <= maxAttempts; a++) {
      if (a > 1) await sleep(delay * 2 ** (a - 2));
      if (a > 1) st.attempts++;
      await db.update(run).set({ startedAt: new Date() }).where(eq(run.id, r.id)); // gilt sonst als abgebrochen
      try {
        const options = isMockMode() ? {} : ((engineDefaults as Record<string, Record<string, unknown>>).claude ?? {});
        const res = await engine.run(w.promptText, {
          country: w.country, language: w.language, engineKey: 'claude', repetition: r.repetition, brands, options,
          claudeResume: out.resume satisfies ClaudeResume,
        });
        result = res;
        st.paid -= out.batchCostUsd; // result.costUsd enthält den Batch-Anteil bereits
        break;
      } catch (e) {
        st.paid += errorCost(e);
        lastErr = errMsg(e);
        log(`✗ claude #${r.repetition} (Batch, ${out.resume.kind}) Versuch ${a}: ${lastErr}`);
        if (!isRetryable(e)) break;
      }
    }
    if (!result) {
      await markRunFailed(r.id, collectionId, lastErr, st.attempts, st.paid, batchId);
      return true;
    }
  }
  if (!result) throw new Error('kein Ergebnis'); // nicht erreichbar
  // gleiche Regel wie synchron: leere Antwort ohne Ablehnung = bezahlter, nicht wiederholbarer Fehlschlag
  if (!result.answer?.trim() && !result.noAiAnswer && !result.refusal) {
    await markRunFailed(r.id, collectionId, 'leere Antwort', st.attempts, st.paid + result.costUsd, batchId);
    return true;
  }
  st.paid += result.costUsd;
  let saved;
  try {
    saved = await db.transaction((tx) => storeResponse(tx, {
      runId: r.id, collectionId, workspaceId, result: result!, costUsd: st.paid, attempts: st.attempts, analyzed: false, at,
    }));
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Antwort existiert schon (paralleler Worker): Run abschließen statt ewig „running“; doppelt bezahlte Kosten buchen
    await db.transaction(async (tx) => {
      await tx.update(run).set({ status: 'done', finishedAt: at, error: null })
        .where(and(eq(run.id, r.id), eq(run.status, 'running'), eq(run.batchId, batchId)));
      await addCost(tx, r.id, collectionId, st.paid);
    });
    st.stored = true;
    return false;
  }
  st.stored = true;
  log(`✓ claude #${r.repetition} (Batch, ${result.model}, ${result.costUsd.toFixed(4)} $${result.refusal ? ', abgelehnt' : ''})`);
  if (saved.pending) {
    await analyzeStored({ responseId: saved.responseId, runId: r.id, collectionId, workspaceId, answer: result.answer, brands }, opts);
  }
  return true;
}

/** Claude-Abfragen, die im Workspace gerade in einem Batch auf ihr Ergebnis warten (für den Messungs-Status in der UI). */
export async function claudeBatchWaiting(workspaceId: string): Promise<number> {
  return db.$count(run, and(eq(run.workspaceId, workspaceId), eq(run.status, 'running'), isNotNull(run.batchId)));
}
