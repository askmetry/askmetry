// Zustand einer Check-/Bericht-Messung: läuft noch, fehlgeschlagen oder fertig inkl. berechneter Maßnahmen.
// Dazu der Fortschritt für die Berichtsseite: je KI-Suche, Folgeschritte (auswerten, Maßnahmen, PDF) und eine ehrliche Restzeit.
import { collection, db, recommendation, response, run } from '@askmetry/db';
import { and, eq, sql } from 'drizzle-orm';
import { isMockMode } from '../engines/index.ts';
import { parseCollectionPlan } from '../runner.ts';

/** So lange nach Abschluss auf ausstehende Auswertungen warten, dann trotzdem fertigstellen. */
export const ANALYSIS_WAIT_MS = 30 * 60 * 1000;
/** Ohne Maßnahme aus dieser Messung so lange warten (Berechnung läuft direkt nach dem Abschluss). */
export const RECS_GRACE_MS = 60 * 1000;

export type MeasurementState =
  | { state: 'running' }
  | { state: 'failed'; error: string }
  | { state: 'done'; collection: typeof collection.$inferSelect };

/**
 * Phase einer Messung (rein, testbar) – gemeinsame Regel für `measurementState` (Worker) und `collectionProgress` (Seite):
 * queued → collecting (Abfragen laufen) → analyzing (Antworten auswerten) → recommending (Maßnahmen schreiben) → done.
 * `recsLocked` = die Maßnahmen-Berechnung hält gerade ihren Lock.
 */
export type MeasurementPhase = 'queued' | 'collecting' | 'analyzing' | 'recommending' | 'done' | 'failed';
export function measurementPhase(i: {
  status: string; openRuns: number; closedRuns: number; pendingAnalysis: number; recs: number; recsLocked?: boolean; finishedAgoMs: number;
}): MeasurementPhase {
  if (i.status === 'failed') return 'failed';
  if (i.status === 'queued' || i.status === 'running') {
    if (i.openRuns > 0) return i.status === 'queued' && i.closedRuns === 0 ? 'queued' : 'collecting';
    if (i.closedRuns === 0) return 'queued'; // Runs werden gerade erst angelegt
    return 'analyzing'; // alle Abfragen beendet, der Worker schließt die Messung gleich ab
  }
  if (i.pendingAnalysis > 0 && i.finishedAgoMs < ANALYSIS_WAIT_MS) return 'analyzing';
  if (i.recsLocked) return 'recommending';
  if (!i.recs && i.finishedAgoMs < RECS_GRACE_MS) return 'recommending';
  return 'done';
}

async function pendingAnalysisOf(collectionId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(response)
    .innerJoin(run, eq(run.id, response.runId)).where(and(eq(run.collectionId, collectionId), eq(response.analyzed, false)));
  return n;
}
async function recsOf(c: { id: string; workspaceId: string }): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(recommendation)
    .where(and(eq(recommendation.workspaceId, c.workspaceId), eq(recommendation.lastCollectionId, c.id)));
  return n;
}
const recommendLockKey = (workspaceId: string) => `askmetry:recommend:${workspaceId}`;

export async function measurementState(collectionId: string | null): Promise<MeasurementState> {
  if (!collectionId) return { state: 'failed', error: 'Messung nicht gefunden' };
  const [c] = await db.select().from(collection).where(eq(collection.id, collectionId));
  if (!c) return { state: 'failed', error: 'Messung nicht gefunden' };
  if (c.status === 'queued' || c.status === 'running') return { state: 'running' };
  if (c.status === 'failed') return { state: 'failed', error: c.error ?? 'Messung fehlgeschlagen' };
  const finishedAgoMs = Date.now() - (c.finishedAt ?? c.createdAt).getTime();
  // ausstehende Auswertungen abwarten (Worker holt sie nach), höchstens ANALYSIS_WAIT_MS
  const pendingAnalysis = await pendingAnalysisOf(c.id);
  if (measurementPhase({ status: c.status, openRuns: 0, closedRuns: 0, pendingAnalysis, recs: 1, finishedAgoMs }) === 'analyzing') return { state: 'running' };
  // laufende Maßnahmen-Berechnung abwarten (gleicher Lock wie generateRecommendations)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${recommendLockKey(c.workspaceId)}))`);
  });
  const recs = await recsOf(c);
  return measurementPhase({ status: c.status, openRuns: 0, closedRuns: 0, pendingAnalysis: 0, recs, finishedAgoMs }) === 'done'
    ? { state: 'done', collection: c } : { state: 'running' };
}

/** Fortschritt einer KI-Suche in einer Messung. */
export interface EngineProgress {
  engine: string;
  total: number;
  /** mit Antwort beendet */
  answered: number;
  /** ohne Antwort beendet (Fehler nach Wiederholungen, Budget) – ruhig anzeigen, kein Alarm */
  failed: number;
  /** davon wartend im Claude-Sammelauftrag (Message Batches API) */
  inBatch: number;
  /** läuft über einen Sammelauftrag (Claude): Dauer bestimmt Anthropic, keine Schätzung möglich */
  batch: boolean;
}

export interface CollectionProgress {
  /** beendete / alle Abfragen (wie bisher) */
  done: number;
  total: number;
  phase: MeasurementPhase;
  engines: EngineProgress[];
  /** Restminuten bis zum fertigen Bericht; null = keine ehrliche Schätzung möglich (zu früh oder nur Claude offen) */
  etaMinutes: number | null;
  /** offene Abfragen gibt es nur noch im Claude-Sammelauftrag */
  onlyBatchLeft: boolean;
  /** Claude-Sammelauftrag noch offen (die Schätzung gilt dann nur für die übrigen KIs) */
  batchOpen: boolean;
}

/** Minuten für Auswerten, Maßnahmen und PDF nach der letzten Abfrage (Erfahrungswert, eher großzügig). */
export const FINISH_TAIL_MIN = 4;
/** Schätzung erst ab so vielen beendeten Abfragen je KI und so viel Laufzeit – vorher wäre sie geraten. */
const ETA_MIN_CLOSED = 3;
const ETA_MIN_ELAPSED_MS = 60 * 1000;

/**
 * Ehrliche Restzeit in Minuten (rein, testbar): je KI-Suche ohne Sammelauftrag aus ihrer bisherigen Geschwindigkeit
 * (beendete Abfragen seit Messbeginn), die langsamste zählt (die KIs laufen parallel), plus FINISH_TAIL_MIN.
 * null, wenn noch keine Messung läuft, zu wenig Daten da sind oder nur noch der Claude-Sammelauftrag fehlt.
 */
export function estimateRemainingMinutes(i: { phase: MeasurementPhase; engines: EngineProgress[]; elapsedMs: number }): number | null {
  // Folgeschritte: grob nach Erfahrung (die Seite sagt dazu nur „in wenigen Minuten“)
  if (i.phase === 'done') return 1;
  if (i.phase === 'recommending') return 2;
  if (i.phase === 'analyzing') return 3;
  if (i.phase !== 'collecting' || i.elapsedMs < ETA_MIN_ELAPSED_MS) return null;
  const minutes = i.elapsedMs / 60_000;
  let worst = 0;
  let open = 0;
  for (const e of i.engines) {
    const closed = e.answered + e.failed;
    const left = e.total - closed;
    if (left <= 0 || e.batch) continue;
    open++;
    if (closed < ETA_MIN_CLOSED) return null;
    worst = Math.max(worst, left / (closed / minutes));
  }
  if (!open) return null;
  return Math.ceil(worst + FINISH_TAIL_MIN);
}

/** Fortschritt einer Messung je KI-Suche (Reihenfolge wie im Messplan) samt Phase und Restzeit. Ohne Locks (Seitenaufruf). */
export async function collectionProgress(collectionId: string, now = new Date()): Promise<CollectionProgress> {
  const empty: CollectionProgress = { done: 0, total: 0, phase: 'queued', engines: [], etaMinutes: null, onlyBatchLeft: false, batchOpen: false };
  const [c] = await db.select().from(collection).where(eq(collection.id, collectionId));
  if (!c) return empty;
  const rows = await db.select({
    engine: run.engine, status: run.status, inBatch: sql<boolean>`${run.batchId} is not null`, n: sql<number>`count(*)::int`,
  }).from(run).where(eq(run.collectionId, collectionId)).groupBy(run.engine, run.status, sql`${run.batchId} is not null`);
  const plan = parseCollectionPlan(c.plan);
  const order = [...(plan.engines ?? []), ...rows.map((r) => r.engine)].filter((e, i, a) => a.indexOf(e) === i);
  const batchPlanned = !!plan.batch && !isMockMode();
  const engines: EngineProgress[] = order.map((engine) => {
    const rs = rows.filter((r) => r.engine === engine);
    const sum = (f: (r: (typeof rs)[number]) => boolean) => rs.filter(f).reduce((s, r) => s + r.n, 0);
    const inBatch = sum((r) => r.inBatch && (r.status === 'running' || r.status === 'pending'));
    return {
      engine, total: sum(() => true), answered: sum((r) => r.status === 'done'),
      failed: sum((r) => r.status === 'failed' || r.status === 'skipped'), inBatch,
      batch: inBatch > 0 || (engine === 'claude' && batchPlanned),
    };
  }).filter((e) => e.total > 0);
  const total = engines.reduce((s, e) => s + e.total, 0);
  const closed = engines.reduce((s, e) => s + e.answered + e.failed, 0);
  const openRuns = total - closed;
  const finishedAgoMs = now.getTime() - (c.finishedAt ?? c.createdAt).getTime();
  const active = c.status === 'queued' || c.status === 'running';
  let pendingAnalysis = 0, recs = 0, recsLocked = false;
  if (!active && c.status !== 'failed') {
    pendingAnalysis = await pendingAnalysisOf(c.id);
    recs = await recsOf(c);
    // Maßnahmen-Berechnung läuft? Nur probieren, nie warten (Seitenaufruf)
    recsLocked = await db.transaction(async (tx) => {
      const r = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${recommendLockKey(c.workspaceId)})) as ok`);
      const row = (r as unknown as { rows: { ok: boolean }[] }).rows?.[0] ?? (r as unknown as { ok: boolean }[])[0];
      return row ? !row.ok : false;
    });
  }
  const phase = measurementPhase({ status: c.status, openRuns, closedRuns: closed, pendingAnalysis, recs, recsLocked, finishedAgoMs });
  const openEngines = engines.filter((e) => e.answered + e.failed < e.total);
  const batchOpen = openEngines.some((e) => e.batch);
  const onlyBatchLeft = phase === 'collecting' && openEngines.length > 0 && openEngines.every((e) => e.batch);
  const elapsedMs = c.startedAt ? now.getTime() - c.startedAt.getTime() : 0;
  return { done: closed, total, phase, engines, etaMinutes: estimateRemainingMinutes({ phase, engines, elapsedMs }), onlyBatchLeft, batchOpen };
}
