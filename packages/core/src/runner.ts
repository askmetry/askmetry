// Collection-Runner: Runs anlegen und abarbeiten (Parallelität, Wiederholungen, Budget, Wiederaufnahme)
import { collection, db, prompt, recommendationGeneration, response, run, workspace } from '@opengeo/db';
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { analyzeLocally, analyzeWithLlm, type AnalysisResult } from './analyze.ts';
import { exceedsBudget, maxBudgetUsd } from './budget.ts';
import { engineDefaults, estimatedCostPerRun } from './engine-config.ts';
import { getEngine, isMockMode } from './engines/index.ts';
import { EngineError, errorCost, isForeignKeyViolation, isRetryable, isUniqueViolation } from './errors.ts';
import { runLimited } from './limiter.ts';
import { addCost, loadWorkspaceBrands, storeAnalysis, storeResponse } from './store.ts';
import type { BrandRef, Engine, EngineResult } from './types.ts';
import { sleep } from './util.ts';

export const STALE_RUN_MS = 15 * 60 * 1000;

type Trigger = 'scheduled' | 'manual' | 'import';

/** Runs für alle aktiven Prompts × Engines × Wiederholungen anlegen (idempotent über den Unique-Index). */
export async function ensureRuns(collectionId: string): Promise<number> {
  const [c] = await db.select().from(collection).where(eq(collection.id, collectionId));
  if (!c) throw new Error(`Collection ${collectionId} nicht gefunden`);
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, c.workspaceId));
  const prompts = await db.select({ id: prompt.id }).from(prompt)
    .where(and(eq(prompt.workspaceId, ws.id), eq(prompt.active, true))).orderBy(asc(prompt.createdAt));
  const rows: (typeof run.$inferInsert)[] = [];
  for (let rep = 1; rep <= Math.max(1, ws.repetitions); rep++) {
    for (const p of prompts) {
      for (const engine of ws.engines) rows.push({ collectionId, workspaceId: ws.id, promptId: p.id, engine, repetition: rep });
    }
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

export async function createCollection(workspaceId: string, trigger: Trigger = 'manual') {
  let c: typeof collection.$inferSelect;
  try {
    [c] = await db.insert(collection).values({ workspaceId, trigger, status: 'queued' }).returning();
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
    or(eq(run.status, 'pending'), and(eq(run.status, 'running'), lt(run.startedAt, staleBefore))),
  )).returning();
  return r;
}

/** Run als fehlgeschlagen markieren und bezahlte Kosten verbuchen. */
async function markRunFailed(runId: string, collectionId: string, error: string, attempts: number, costUsd: number) {
  await db.transaction(async (tx) => {
    const updated = await tx.update(run).set({
      status: 'failed', error: error.slice(0, 1000), finishedAt: new Date(), attempts, costUsd: costUsd.toFixed(4),
    }).where(eq(run.id, runId)).returning({ id: run.id });
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
    const staleBefore = new Date(Date.now() - STALE_RUN_MS);
    const todo = await db.select({ run, promptText: prompt.text, country: prompt.country, language: prompt.language })
      .from(run).innerJoin(prompt, eq(prompt.id, run.promptId))
      .where(and(eq(run.collectionId, c.id), or(
        eq(run.status, 'pending'),
        and(eq(run.status, 'running'), lt(run.startedAt, staleBefore)),
      )))
      .orderBy(asc(run.repetition), asc(prompt.createdAt), asc(run.engine));

    // Budget serverseitig gedeckelt (OPENGEO_MAX_BUDGET_USD)
    const budget = Math.min(Number(ws.monthlyBudgetUsd), maxBudgetUsd());
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
        const spent = await monthToDateSpend(ws.id);
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

    const tasks = todo.map(({ run: r, promptText, country, language }) => {
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

    await runLimited(tasks, { total: opts.concurrency ?? 4, perProvider: opts.perProvider ?? 2 });

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
  return { status, done, failed, skipped, pending: open, costUsd: Number(fresh.costUsd), analysisPending };
}

/** Nächste abzuarbeitende Collections: queued sowie unterbrochene (running) – älteste zuerst. */
export async function listProcessableCollections() {
  return db.select({ id: collection.id, workspaceId: collection.workspaceId, status: collection.status })
    .from(collection).where(inArray(collection.status, ['queued', 'running'])).orderBy(asc(collection.createdAt));
}
