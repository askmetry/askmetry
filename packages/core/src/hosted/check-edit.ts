// Vor dem Kauf auf der Check-Seite: die 20 Fragen der Standortbestimmung und die Themen des Strategieberichts bearbeiten.
// Berechtigung = Check-Token (wer den Link hat). Gespeichert wird am Check (check_request.prompts / .topics), nie im
// Check-Arbeitsbereich: der ist ein geteilter Schnappschuss (30-Tage-Cache für dieselbe Domain). Beim Kauf übernimmt
// prepareReport die Fragen in die Kopie des Arbeitsbereichs, processReports die Themen in generateMorePrompts.
import { brand, checkRequest, db, funnelEvent, prompt, report } from '@askmetry/db';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { CHECK_QUESTION_RULES, REPORT_MIN_PROMPTS, REPORT_SCOPE, TOPICS } from './config.ts';
import { trackEvent } from './funnel.ts';
import type { CheckError } from './types.ts';

type Check = typeof checkRequest.$inferSelect;

export type ListOp =
  | { action: 'add'; text: string }
  | { action: 'edit'; index: number; expected: string; text: string }
  | { action: 'delete'; index: number; expected: string };

/** Bezahlte (oder laufende/fertige) Berichte aus diesem Check sperren die Bearbeitung: die Kopie ist dann angelegt und gemessen. */
export async function checkPurchased(checkId: string): Promise<boolean> {
  return (await db.$count(report, and(eq(report.checkId, checkId), inArray(report.status, ['paid', 'measuring', 'ready'])))) > 0;
}

/** Aktuelle Fragen eines Checks: bearbeitete Liste oder die aktiven Fragen des Check-Arbeitsbereichs (Reihenfolge = Rang). */
export async function checkQuestionList(c: Pick<Check, 'prompts' | 'workspaceId'>): Promise<{ list: string[]; edited: boolean }> {
  if (c.prompts) return { list: c.prompts.slice(0, CHECK_QUESTION_RULES.max), edited: true };
  if (!c.workspaceId) return { list: [], edited: false };
  const rows = await db.select({ text: prompt.text }).from(prompt).where(and(eq(prompt.workspaceId, c.workspaceId), eq(prompt.active, true)))
    .orderBy(asc(prompt.createdAt)).limit(Math.max(CHECK_QUESTION_RULES.max, REPORT_SCOPE.compact.prompts));
  return { list: rows.map((r) => r.text).slice(0, CHECK_QUESTION_RULES.max), edited: false };
}

/** Text wie sanitizePrompts säubern: HTML, URLs, Klammerzeichen und Aufzählungszeichen raus, Leerraum zusammenfassen. */
export function cleanEntry(raw: string): string {
  return String(raw ?? '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '').replace(/[`<>{}[\]]/g, '')
    .replace(/\s+/g, ' ').trim().replace(/^\s*(\d+[.)]|[-*•])\s*/, '');
}

const withBrand = (t: string, b: string) => b.length >= 3 && t.toLowerCase().includes(b);

/**
 * Eine Änderung auf eine Liste anwenden (rein, testbar). `expected` schützt vor veralteten Ansichten (zweiter Tab):
 * steht an der Stelle inzwischen ein anderer Text, wird nichts geändert.
 */
export function applyListOp(list: readonly string[], op: ListOp, rules: { max: number; min: number; minLength: number; maxLength: number; brand?: string; maxWithBrand?: number }):
  { list: string[] } | { error: CheckError } {
  const out = [...list];
  if (op.action === 'delete' || op.action === 'edit') {
    if (!Number.isInteger(op.index) || op.index < 0 || op.index >= out.length || out[op.index] !== op.expected) return { error: 'wrong_state' };
  }
  if (op.action === 'delete') {
    if (out.length <= rules.min) return { error: 'too_few' };
    out.splice(op.index, 1);
    return { list: out };
  }
  const raw = String(op.text ?? '');
  if (raw.trim().length > rules.maxLength) return { error: 'too_long' };
  const t = cleanEntry(raw);
  if (t.length < rules.minLength) return { error: 'too_short' };
  if (t.length > rules.maxLength) return { error: 'too_long' };
  const others = op.action === 'edit' ? out.filter((_, i) => i !== op.index) : out;
  if (others.some((x) => x.toLowerCase() === t.toLowerCase())) return { error: 'duplicate' };
  const b = rules.brand?.trim().toLowerCase() ?? '';
  if (rules.maxWithBrand !== undefined && withBrand(t, b) && others.filter((x) => withBrand(x, b)).length >= rules.maxWithBrand) return { error: 'brand_limit' };
  if (op.action === 'add') {
    if (out.length >= rules.max) return { error: 'too_many' };
    out.push(t);
  } else {
    if (out[op.index] === t) return { list: out };
    out[op.index] = t;
  }
  return { list: out };
}

/** Änderungen je Check und Stunde begrenzen (Fragen + Themen zusammen) – über die Funnel-Ereignisse. */
async function overEditLimit(checkId: string): Promise<boolean> {
  const n = await db.$count(funnelEvent, and(eq(funnelEvent.checkId, checkId), inArray(funnelEvent.name, ['check_questions_edited', 'check_topics_edited']),
    gte(funnelEvent.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
  return n >= CHECK_QUESTION_RULES.editsPerHour;
}

async function editable(token: string): Promise<{ c: Check } | { error: CheckError }> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { error: 'not_found' };
  const [c] = await db.select().from(checkRequest).where(eq(checkRequest.token, token));
  if (!c) return { error: 'not_found' };
  if (c.status !== 'ready' || !c.workspaceId) return { error: 'wrong_state' };
  if (await checkPurchased(c.id)) return { error: 'locked' };
  if (await overEditLimit(c.id)) return { error: 'rate_limited' };
  return { c };
}

/** Frage der Standortbestimmung hinzufügen, ändern oder löschen. */
export async function editCheckQuestions(token: string, op: ListOp): Promise<{ ok: true; list: string[] } | { error: CheckError }> {
  const e = await editable(token);
  if ('error' in e) return e;
  const { c } = e;
  const cur = await checkQuestionList(c);
  const [own] = await db.select({ name: brand.name }).from(brand).where(and(eq(brand.workspaceId, c.workspaceId!), eq(brand.isOwn, true))).limit(1);
  const r = applyListOp(cur.list, op, { max: CHECK_QUESTION_RULES.max, min: REPORT_MIN_PROMPTS, minLength: CHECK_QUESTION_RULES.minLength, maxLength: CHECK_QUESTION_RULES.maxLength, brand: own?.name, maxWithBrand: CHECK_QUESTION_RULES.maxWithBrand });
  if ('error' in r) return r;
  // nur speichern, wenn sich seit dem Lesen nichts geändert hat (zwei Tabs gleichzeitig)
  const saved = await db.update(checkRequest).set({ prompts: r.list })
    .where(and(eq(checkRequest.id, c.id), c.prompts ? sql`${checkRequest.prompts} = ${toPgArray(c.prompts)}::text[]` : sql`${checkRequest.prompts} is null`))
    .returning({ id: checkRequest.id });
  if (!saved.length) return { error: 'wrong_state' };
  await trackEvent('check_questions_edited', { checkId: c.id, props: { action: op.action, count: r.list.length } });
  return { ok: true, list: r.list };
}

/** Thema des Strategieberichts hinzufügen, umbenennen oder entfernen (höchstens TOPICS.max). */
export async function editCheckTopics(token: string, op: ListOp): Promise<{ ok: true; list: string[] } | { error: CheckError }> {
  const e = await editable(token);
  if ('error' in e) return e;
  const { c } = e;
  const cur = c.topics ?? [];
  // Entfernen bis auf null erlaubt: ohne Themen wählt die KI sie beim Kauf selbst
  const r = applyListOp(cur, op, { max: TOPICS.max, min: 0, minLength: TOPICS.minLength, maxLength: TOPICS.maxLength });
  if ('error' in r) return r;
  const saved = await db.update(checkRequest).set({ topics: r.list })
    .where(and(eq(checkRequest.id, c.id), c.topics ? sql`${checkRequest.topics} = ${toPgArray(c.topics)}::text[]` : sql`${checkRequest.topics} is null`))
    .returning({ id: checkRequest.id });
  if (!saved.length) return { error: 'wrong_state' };
  await trackEvent('check_topics_edited', { checkId: c.id, props: { action: op.action, count: r.list.length } });
  return { ok: true, list: r.list };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Beim Kauf: die am Check bearbeiteten Fragen in den (frisch kopierten) Kunden-Arbeitsbereich übernehmen.
 * Unveränderte Fragen behalten ihr Thema, neue bekommen das erste Thema; Reihenfolge = Liste (aufsteigendes createdAt).
 * Nur aufrufen, solange im Arbeitsbereich noch nichts gemessen wurde.
 */
export async function applyCheckQuestions(tx: Tx, workspaceId: string, texts: readonly string[]): Promise<void> {
  const list = texts.slice(0, CHECK_QUESTION_RULES.max);
  if (!list.length) return;
  const cur = await tx.select().from(prompt).where(eq(prompt.workspaceId, workspaceId)).orderBy(asc(prompt.createdAt));
  const same = cur.filter((p) => p.active).map((p) => p.text);
  if (same.length === list.length && same.every((t, i) => t === list[i])) return;
  const topicOf = new Map(cur.map((p) => [p.text.toLowerCase(), p.topicId]));
  const fallbackTopic = cur.find((p) => p.topicId)?.topicId ?? null;
  const lang = cur[0]?.language ?? 'de', country = cur[0]?.country ?? 'DE';
  await tx.delete(prompt).where(eq(prompt.workspaceId, workspaceId));
  const base = Date.now();
  await tx.insert(prompt).values(list.map((text, i) => ({
    workspaceId, text, topicId: topicOf.get(text.toLowerCase()) ?? fallbackTopic, language: lang, country, createdAt: new Date(base + i),
  })));
}

/** text[] als Postgres-Array-Literal (für den Vergleich „unverändert seit dem Lesen“). */
function toPgArray(list: readonly string[]): string {
  return `{${list.map((x) => `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}
