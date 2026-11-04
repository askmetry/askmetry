import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db, recommendationGeneration, run } from '@askmetry/db';
import { sortEngines } from './metrics';

type Ws = { id: string; engines: string[]; repetitions: number };

export function monthStartBerlin() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  // Anzeige des Monats sprachabhängig in der Seite (f.dateWith)
  return { iso: `${y}-${m}-01` };
}

/** Status der Abfragen je Messung (für Fortschritt und Verlauf). */
export async function runStatsByCollection(wsId: string) {
  const rows = await db.select({ collectionId: run.collectionId, status: run.status, n: sql<number>`count(*)::int` }).from(run)
    .where(eq(run.workspaceId, wsId)).groupBy(run.collectionId, run.status);
  const stats = new Map<string, Record<string, number>>();
  for (const r of rows) stats.set(r.collectionId, { ...(stats.get(r.collectionId) ?? {}), [r.status]: r.n });
  return stats;
}

/** Kosten: Monatsausgaben (Messungen + Maßnahmen formulieren), Ø je Abfrage und Schätzung je Messung. */
export async function loadCosts(ws: Ws, activePrompts: number) {
  const month = monthStartBerlin();
  const monthStart = sql`(${month.iso}::date)::timestamp at time zone 'Europe/Berlin'`;
  const [monthCost, genCost, engineCost] = await Promise.all([
    db.select({ sum: sql<string>`coalesce(sum(${run.costUsd}), 0)` }).from(run).where(and(eq(run.workspaceId, ws.id), gte(run.finishedAt, monthStart))),
    db.select({ sum: sql<string>`coalesce(sum(${recommendationGeneration.costUsd}), 0)` }).from(recommendationGeneration)
      .where(and(eq(recommendationGeneration.workspaceId, ws.id), gte(recommendationGeneration.createdAt, monthStart))),
    db.select({
      engine: run.engine,
      avg: sql<string | null>`avg(${run.costUsd}) filter (where ${run.status} = 'done')`,
      month: sql<string>`coalesce(sum(${run.costUsd}) filter (where ${run.finishedAt} >= ${monthStart}), 0)`,
    }).from(run).where(eq(run.workspaceId, ws.id)).groupBy(run.engine),
  ]);
  const recCost = Number(genCost[0]?.sum ?? 0);
  const spent = Number(monthCost[0]?.sum ?? 0) + recCost;
  const costBy = new Map(engineCost.map((r) => [r.engine, r]));
  const perRun = (e: string) => { const v = costBy.get(e)?.avg; return v === null || v === undefined ? null : Number(v); };
  const engines = sortEngines([...new Set([...ws.engines, ...engineCost.filter((r) => Number(r.month) > 0).map((r) => r.engine)])])
    .map((e) => ({ engine: e, on: ws.engines.includes(e), avg: perRun(e), month: Number(costBy.get(e)?.month ?? 0) }));
  const estimate = ws.engines.every((e) => perRun(e) !== null) ? ws.engines.reduce((s, e) => s + perRun(e)! * activePrompts * ws.repetitions, 0) : null;
  return { month, spent, recCost, engines, estimate };
}
