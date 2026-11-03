// Ergebnis eines Runs speichern: response, citations, mentions + Kosten (eine Transaktion)
import { brand, citation, collection, db, mention, response, run, type DB } from '@opengeo/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Analysis } from './analyze.ts';
import { canonicalizeMentions, type WorkspaceBrand } from './canonicalize.ts';
import { normalizeDomain, safeHttpUrl } from './domains.ts';
import type { EngineResult } from './types.ts';

export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/** JSON für jsonb: Postgres lehnt \u0000 in jsonb ab */
const jsonSafe = (v: unknown) => (v == null ? null : JSON.parse(JSON.stringify(v).replace(/\\u0000/g, '')));
const textSafe = (s: string) => s.replace(/\u0000/g, '');

export async function loadWorkspaceBrands(workspaceId: string, conn: DB | Tx = db) {
  return conn.select({
    id: brand.id, name: brand.name, aliases: brand.aliases, domains: brand.domains, isOwn: brand.isOwn, description: brand.description,
  }).from(brand).where(eq(brand.workspaceId, workspaceId));
}

export interface StoreResponseInput {
  runId: string;
  collectionId: string;
  workspaceId: string;
  result: EngineResult;
  /** Kosten, die jetzt auf Run und Collection gebucht werden (Engine + ggf. bezahlte Fehlversuche) */
  costUsd: number;
  attempts?: number;
  /** für den Import: Zeitpunkt der Abfrage */
  at?: Date;
  /** answer_type, falls die Auswertung schon vorliegt */
  answerType?: string | null;
  /** false = Auswertung steht noch aus (wird nachgeholt) */
  analyzed: boolean;
}

/** Braucht die Antwort eine Auswertung? (nicht bei leeren Antworten und Ablehnungen) */
export const needsAnalysis = (result: Pick<EngineResult, 'answer' | 'refusal'>) => !!result.answer?.trim() && !result.refusal;

/** Engine-Antwort + Quellen speichern und Run als erledigt markieren – unabhängig von der Auswertung. */
export async function storeResponse(tx: Tx, input: StoreResponseInput) {
  const { result, workspaceId } = input;
  const at = input.at ?? new Date();
  const pending = !input.analyzed && needsAnalysis(result);
  const answerType = result.refusal ? 'refusal' : !result.answer?.trim() ? 'empty' : (input.answerType ?? null);
  const [resp] = await tx.insert(response).values({
    runId: input.runId,
    workspaceId,
    answer: textSafe(result.answer ?? ''),
    answerType,
    noAiAnswer: !!result.noAiAnswer,
    analyzed: !pending,
    usage: jsonSafe(result.usage),
    raw: jsonSafe(result.refusal ? { refusal: result.refusal, response: result.raw } : result.raw),
    createdAt: at,
  }).returning({ id: response.id });

  const cites: (typeof citation.$inferInsert)[] = [];
  for (const c of result.citations) {
    // nur http(s): „javascript://evil.com/%0aalert(1)“ o. ä. nie als Quelle speichern
    const domain = safeHttpUrl(c.url) ? normalizeDomain(c.url) : null;
    if (!domain) continue;
    cites.push({
      responseId: resp.id, workspaceId, url: textSafe(c.url), domain, title: c.title ? textSafe(c.title) : null,
      position: cites.length + 1, kind: c.kind,
    });
  }
  if (cites.length) await tx.insert(citation).values(cites);

  const cost = input.costUsd.toFixed(4);
  await tx.update(run).set({
    status: 'done', model: result.model, error: pending ? 'Auswertung ausstehend' : null, costUsd: cost, finishedAt: at,
    ...(input.attempts != null && { attempts: input.attempts }),
  }).where(eq(run.id, input.runId));
  await tx.update(collection).set({ costUsd: sql`${collection.costUsd} + ${cost}::numeric` })
    .where(eq(collection.id, input.collectionId));
  return { responseId: resp.id, citations: cites.length, pending };
}

async function insertMentions(tx: Tx, responseId: string, workspaceId: string, analysis: Analysis, brands: WorkspaceBrand[]) {
  const mentions = canonicalizeMentions(analysis.brands ?? [], brands);
  if (mentions.length) {
    await tx.insert(mention).values(mentions.map((m) => ({
      responseId, workspaceId, brandId: m.brandId, name: textSafe(m.name), position: m.position,
      sentiment: m.sentiment, recommended: m.recommended, snippet: m.snippet ? textSafe(m.snippet) : null,
      isCompetitor: m.isCompetitor,
    })));
  }
  return mentions.length;
}

export interface StoreAnalysisInput {
  responseId: string;
  runId: string;
  collectionId: string;
  workspaceId: string;
  analysis: Analysis;
  brands: WorkspaceBrand[];
  /** Kosten der Auswertung (inkl. bezahlter Fehlversuche), zusätzlich auf Run und Collection gebucht */
  costUsd: number;
}

/** Auswertung einer gespeicherten Antwort nachtragen (idempotent: nur wenn noch ausstehend). */
export async function storeAnalysis(tx: Tx, input: StoreAnalysisInput) {
  const [r] = await tx.update(response).set({ analyzed: true, answerType: input.analysis.answer_type })
    .where(and(eq(response.id, input.responseId), eq(response.analyzed, false))).returning({ id: response.id });
  if (!r) return { mentions: 0, stored: false };
  const n = await insertMentions(tx, input.responseId, input.workspaceId, input.analysis, input.brands);
  const cost = input.costUsd.toFixed(4);
  await tx.update(run).set({ error: null, costUsd: sql`${run.costUsd} + ${cost}::numeric` }).where(eq(run.id, input.runId));
  await tx.update(collection).set({ costUsd: sql`${collection.costUsd} + ${cost}::numeric` })
    .where(eq(collection.id, input.collectionId));
  return { mentions: n, stored: true };
}

/** Bezahlte Kosten eines Fehlschlags auf Run und Collection buchen. */
export async function addCost(tx: Tx, runId: string, collectionId: string, costUsd: number) {
  if (!costUsd) return;
  const cost = costUsd.toFixed(4);
  await tx.update(run).set({ costUsd: sql`${run.costUsd} + ${cost}::numeric` }).where(eq(run.id, runId));
  await tx.update(collection).set({ costUsd: sql`${collection.costUsd} + ${cost}::numeric` }).where(eq(collection.id, collectionId));
}

export interface StoreInput {
  runId: string;
  collectionId: string;
  workspaceId: string;
  result: EngineResult;
  analysis: Analysis;
  brands: WorkspaceBrand[];
  /** Gesamtkosten des Runs (Engine + Auswertung) */
  costUsd: number;
  attempts?: number;
  /** für den Import: Zeitpunkt der Abfrage */
  at?: Date;
}

/** Antwort und Auswertung in einem Schritt speichern (Import). */
export async function storeRunResult(tx: Tx, input: StoreInput) {
  const stored = await storeResponse(tx, { ...input, answerType: input.analysis.answer_type, analyzed: true });
  const mentions = needsAnalysis(input.result)
    ? await insertMentions(tx, stored.responseId, input.workspaceId, input.analysis, input.brands) : 0;
  return { responseId: stored.responseId, citations: stored.citations, mentions };
}
