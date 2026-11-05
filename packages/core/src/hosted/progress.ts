// Zustand einer Check-/Bericht-Messung: läuft noch, fehlgeschlagen oder fertig inkl. berechneter Maßnahmen.
import { collection, db, recommendation, response, run } from '@askmetry/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** So lange nach Abschluss auf ausstehende Auswertungen warten, dann trotzdem fertigstellen. */
export const ANALYSIS_WAIT_MS = 30 * 60 * 1000;
/** Ohne Maßnahme aus dieser Messung so lange warten (Berechnung läuft direkt nach dem Abschluss). */
const RECS_GRACE_MS = 60 * 1000;

export type MeasurementState =
  | { state: 'running' }
  | { state: 'failed'; error: string }
  | { state: 'done'; collection: typeof collection.$inferSelect };

export async function measurementState(collectionId: string | null): Promise<MeasurementState> {
  if (!collectionId) return { state: 'failed', error: 'Messung nicht gefunden' };
  const [c] = await db.select().from(collection).where(eq(collection.id, collectionId));
  if (!c) return { state: 'failed', error: 'Messung nicht gefunden' };
  if (c.status === 'queued' || c.status === 'running') return { state: 'running' };
  if (c.status === 'failed') return { state: 'failed', error: c.error ?? 'Messung fehlgeschlagen' };
  const finishedAgo = Date.now() - (c.finishedAt ?? c.createdAt).getTime();
  // ausstehende Auswertungen abwarten (Worker holt sie nach), höchstens ANALYSIS_WAIT_MS
  const [{ n: pending }] = await db.select({ n: sql<number>`count(*)::int` }).from(response)
    .innerJoin(run, eq(run.id, response.runId)).where(and(eq(run.collectionId, c.id), eq(response.analyzed, false)));
  if (pending > 0 && finishedAgo < ANALYSIS_WAIT_MS) return { state: 'running' };
  // laufende Maßnahmen-Berechnung abwarten (gleicher Lock wie generateRecommendations)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`askmetry:recommend:${c.workspaceId}`}))`);
  });
  const [{ n: recs }] = await db.select({ n: sql<number>`count(*)::int` }).from(recommendation)
    .where(and(eq(recommendation.workspaceId, c.workspaceId), eq(recommendation.lastCollectionId, c.id)));
  if (!recs && finishedAgo < RECS_GRACE_MS) return { state: 'running' };
  return { state: 'done', collection: c };
}

/** Fortschritt einer Messung: abgeschlossene Runs / alle Runs. */
export async function collectionProgress(collectionId: string): Promise<{ done: number; total: number }> {
  const [r] = await db.select({
    total: sql<number>`count(*)::int`,
    done: sql<number>`(count(*) filter (where ${inArray(run.status, ['done', 'failed', 'skipped'])}))::int`,
  }).from(run).where(eq(run.collectionId, collectionId));
  return { done: r?.done ?? 0, total: r?.total ?? 0 };
}
