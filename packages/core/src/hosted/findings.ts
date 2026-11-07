// Antworten der Check-Messung für die Check-Seite: live während der Messung (welche KI, welche Frage, welche Marken)
// und konkrete Befunde fürs Ergebnis („Auf ‚<Frage>‘ nennt ChatGPT A und B – dich nicht.“).
// Reine Auswahl-/Textlogik ist ohne DB testbar (pickFindings, answerExcerpt, toLiveAnswers).
import { brand, db, mention, prompt, response, run } from '@askmetry/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CHECK_LIVE_ANSWERS } from './config.ts';
import type { CheckFindings, FindingCase, LiveAnswer } from './types.ts';

/** Eine Antwort samt Nennungen (aus der DB oder in Tests von Hand gebaut). */
export interface AnswerRow {
  id: string;
  engine: string;
  question: string;
  answer: string;
  analyzed: boolean;
  noAiAnswer: boolean;
  createdAt: Date;
  /** Nennungen in Reihenfolge (position) – own: eigene Marke; competitor: getrackter Wettbewerber oder erkannter (is_competitor) */
  mentions: { name: string; own: boolean; competitor: boolean; position: number; snippet: string | null }[];
}

/** Antworten (mit Nennungen) einer Messung laden, neueste zuerst. */
export async function loadAnswers(collectionId: string): Promise<AnswerRow[]> {
  const rows = await db.select({
    id: response.id, answer: response.answer, analyzed: response.analyzed, noAiAnswer: response.noAiAnswer, createdAt: response.createdAt,
    engine: run.engine, question: prompt.text,
  }).from(response).innerJoin(run, eq(run.id, response.runId)).innerJoin(prompt, eq(prompt.id, run.promptId))
    .where(eq(run.collectionId, collectionId)).orderBy(desc(response.createdAt), desc(response.id));
  if (!rows.length) return [];
  const ms = await db.select({
    responseId: mention.responseId, name: mention.name, position: mention.position, snippet: mention.snippet, isCompetitor: mention.isCompetitor,
    brandId: mention.brandId, brandName: brand.name, isOwn: brand.isOwn,
  }).from(mention).leftJoin(brand, eq(brand.id, mention.brandId)).where(inArray(mention.responseId, rows.map((r) => r.id)));
  const by = new Map<string, AnswerRow['mentions']>();
  for (const m of ms) {
    const own = !!m.brandId && m.isOwn === true;
    // getrackte Marke (eigene oder Wettbewerber) oder vom Analyse-Modell als Wettbewerber erkannte; sonstige Nennungen (z. B. Portale) nicht
    const competitor = !own && (!!m.brandId || m.isCompetitor === true);
    if (!own && !competitor) continue;
    if (!by.has(m.responseId)) by.set(m.responseId, []);
    by.get(m.responseId)!.push({ name: m.brandName ?? m.name, own, competitor, position: m.position, snippet: m.snippet });
  }
  return rows.map((r) => ({ ...r, mentions: (by.get(r.id) ?? []).sort((a, b) => a.position - b.position) }));
}

/** Eindeutige Namen in Reihenfolge (ohne Groß-/Kleinschreibung). */
function uniqNames(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((n) => { const k = n.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** Für die Live-Liste: neueste zuerst, höchstens `max`, nur Markennamen (kein Antworttext). */
export function toLiveAnswers(rows: readonly AnswerRow[], max = CHECK_LIVE_ANSWERS): LiveAnswer[] {
  return rows.slice(0, max).map((r) => {
    const own = r.mentions.some((m) => m.own);
    const names: { name: string; own: boolean }[] = [];
    for (const m of r.mentions) if (!names.some((x) => x.name.toLowerCase() === m.name.toLowerCase())) names.push({ name: m.name, own: m.own });
    const empty = r.noAiAnswer || !r.answer.trim();
    return { id: r.id, engine: r.engine, question: r.question, brands: empty ? [] : names, ownNamed: !empty && own, state: empty ? 'empty' : r.analyzed ? 'analyzed' : 'pending' };
  });
}

/** Markdown/HTML grob zu Fließtext: Links → Linktext, URLs, Hervorhebungen, Überschriften, Listenzeichen und Tabellenstriche weg. */
export function plainAnswerText(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[*_`~]+/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(\d+[.)]|[-+•])\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kurzer Ausschnitt um die erste Nennung von `name`: reiner Text, an Wortgrenzen gekürzt, mit „…“ an Schnittkanten.
 * Kein HTML – die Seite rendert ihn als Text (React escapt), Markdown ist entfernt.
 */
export function answerExcerpt(text: string, name: string, opts: { before?: number; after?: number } = {}): string | null {
  const plain = plainAnswerText(text);
  if (!plain) return null;
  const before = opts.before ?? 70, after = opts.after ?? 130;
  const idx = name.trim() ? plain.toLowerCase().indexOf(name.trim().toLowerCase()) : -1;
  if (idx < 0) return null;
  let start = Math.max(0, idx - before);
  let end = Math.min(plain.length, idx + name.length + after);
  // an Satzanfang bzw. Wortgrenze ausrichten
  if (start > 0) {
    const sentence = plain.lastIndexOf('. ', idx);
    if (sentence >= start) start = sentence + 2;
    else { const sp = plain.indexOf(' ', start); start = sp >= 0 && sp < idx ? sp + 1 : start; }
  }
  // am Satzende nach der Nennung aufhören (falls im Fenster), sonst an einer Wortgrenze
  const stop = plain.slice(idx + name.length, end).search(/[.!?](\s|$)/);
  if (stop >= 0) end = idx + name.length + stop + 1;
  else if (end < plain.length) { const sp = plain.lastIndexOf(' ', end); end = sp > idx + name.length ? sp : end; }
  const core = plain.slice(start, end).trim();
  return `${start > 0 ? '… ' : ''}${core}${end < plain.length && !/[.!?]$/.test(core) ? ' …' : ''}`;
}

/** Ausschnitt eines Falls: Satz der Nennung (mention.snippet), sonst Fenster im Antworttext. */
function excerptFor(r: AnswerRow, name: string): string | null {
  const fromText = answerExcerpt(r.answer, name);
  if (fromText) return fromText;
  const m = r.mentions.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const snip = m?.snippet ? plainAnswerText(m.snippet).slice(0, 220) : '';
  return snip || null;
}

/** Greedy-Auswahl: zuerst neue KI und neue Frage, dann neue Frage, dann neue KI, dann der Rest. */
function spread<T extends { engine: string; question: string }>(cands: readonly T[], max: number): T[] {
  const out: T[] = [];
  const engines = new Set<string>(), questions = new Set<string>();
  const passes: ((c: T) => boolean)[] = [
    (c) => !engines.has(c.engine) && !questions.has(c.question),
    (c) => !questions.has(c.question),
    (c) => !engines.has(c.engine),
    () => true,
  ];
  for (const ok of passes) {
    for (const c of cands) {
      if (out.length >= max) return out;
      if (out.includes(c) || !ok(c)) continue;
      out.push(c); engines.add(c.engine); questions.add(c.question);
    }
  }
  return out;
}

/**
 * Konkrete Befunde fürs Ergebnis. Lücken = ausgewertete Antworten mit mindestens einem Wettbewerber, ohne die eigene Marke;
 * mehr genannte Wettbewerber zuerst, verteilt auf verschiedene KIs und Fragen. Ohne Lücken: Antworten, die dich nennen.
 */
export function pickFindings(rows: readonly AnswerRow[], opts: { max?: number; simulated?: boolean } = {}): CheckFindings {
  const max = opts.max ?? 3;
  const usable = rows.filter((r) => r.analyzed && !r.noAiAnswer && r.answer.trim());
  const gapRows = usable.filter((r) => !r.mentions.some((m) => m.own) && r.mentions.some((m) => m.competitor));
  const toCase = (r: AnswerRow, names: string[], excerptName: string): FindingCase => ({
    engine: r.engine, question: r.question, competitors: names.slice(0, 3), excerpt: excerptFor(r, excerptName),
  });
  const gapCands = gapRows
    .map((r) => ({ r, names: uniqNames(r.mentions.filter((m) => m.competitor).map((m) => m.name)) }))
    .sort((a, b) => b.names.length - a.names.length || a.r.createdAt.getTime() - b.r.createdAt.getTime() || a.r.id.localeCompare(b.r.id))
    .map(({ r, names }) => ({ engine: r.engine, question: r.question, r, names }));
  const gaps = spread(gapCands, max).map((c) => toCase(c.r, c.names, c.names[0]));
  let wins: FindingCase[] = [];
  if (!gaps.length) {
    const winCands = usable.filter((r) => r.mentions.some((m) => m.own))
      .sort((a, b) => a.mentions.findIndex((m) => m.own) - b.mentions.findIndex((m) => m.own) || a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({ engine: r.engine, question: r.question, r }));
    wins = spread(winCands, Math.min(2, max)).map((c) => {
      const own = c.r.mentions.find((m) => m.own)!;
      return toCase(c.r, uniqNames(c.r.mentions.filter((m) => m.competitor).map((m) => m.name)), own.name);
    });
  }
  return { gaps, wins, gapAnswers: gapRows.length, answers: usable.length, simulated: !!opts.simulated };
}

/** Die gemessenen Fragen (für die Warteansicht) – Reihenfolge wie gemessen. */
export async function measuredQuestions(workspaceId: string, promptIds: readonly string[]): Promise<string[]> {
  if (!promptIds.length) return [];
  const rows = await db.select({ id: prompt.id, text: prompt.text }).from(prompt).where(and(eq(prompt.workspaceId, workspaceId), inArray(prompt.id, [...promptIds])));
  return promptIds.map((id) => rows.find((r) => r.id === id)?.text).filter((t): t is string => !!t);
}
