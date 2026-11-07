// Datenaufbereitung für den PDF-Bericht: Laden (DB) und reine Berechnung (ohne DB, testbar).
// Kennzahlen exakt nach CONTRACT.md: Basis N = Antworten mit Text der Messung; Sichtbarkeit = Anteil Antworten mit Nennung;
// Ø Position = Mittel von mention.position über Antworten mit Nennung; Share of Voice = Nennungen der Marke / alle Nennungen;
// Quellen einer Antwort = cited-Zeilen, sonst searched-Zeilen (metricCitations).
import {
  buildClaudePrompt, categoryOf, categoryText, effortText, groupBy, hostOf, impactText, indexData, keyInsightFrom, loadRecData,
  localizeRec, overviewFrom, pickTopRecommendations, promptDeliverable, rankingFrom, scoreVerdict, titleFromUrl, cleanUrl,
  domainMatches, buildCandidates, type BrandLike, type PromptContext, type RecCategory, type RecData, type SiteCheckResult,
} from '@askmetry/core';
import { toLang, type Lang } from '@askmetry/core/present';
import { collection, db, recommendation, report, response, run, siteCheck, workspace } from '@askmetry/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { loadBrandLogos, type PdfLogo } from './logos.ts';
import { loadGuide, type ReportGuide } from './guide.ts';

export type ReportTier = 'compact' | 'strategy';
export type ReportKind = 'initial' | 'remeasure';

/** Reihenfolge der KI-Suchen in Tabellen. */
export const ENGINE_ORDER = ['chatgpt', 'claude', 'gemini', 'perplexity', 'google_aio', 'google_ai_mode', 'mock'];
const engineRank = (e: string) => (ENGINE_ORDER.indexOf(e) + 1 || 99);
export const sortEngines = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => engineRank(a) - engineRank(b) || a.localeCompare(b));

/** Unterschiede unterhalb dieser Schwelle (Anteil 0..1) können im Rauschen liegen. */
export const NOISE_PP = 0.1;
/** Ø Position erst ab so vielen Nennungen zeigen (DESIGN.md). */
export const MIN_POSITION_MENTIONS = 5;

// ---------------------------------------------------------------------------
// Eingabe (aus der DB geladen) und Ergebnis
// ---------------------------------------------------------------------------

export interface RunRow { engine: string; model: string | null; promptId: string; repetition: number; status: string; startedAt: Date | null; finishedAt: Date | null }
export interface RecInput {
  key: string; type: string; title: string; why: string; steps: string[]; impact: number; effort: number;
  priority: string | number; evidence: unknown; status: string; active: boolean;
}
export interface MeasurementInput {
  data: RecData;
  runs: RunRow[];
  /** Antworten ohne KI-Antwort (z. B. Google zeigt keine Übersicht) je Engine */
  noAiAnswer: Record<string, number>;
  collection: { id: string; createdAt: Date; startedAt: Date | null; finishedAt: Date | null };
}
export interface ReportInput {
  reportId: string | null;
  lang: Lang;
  tier: ReportTier;
  kind: ReportKind;
  workspaceName: string;
  /** Datum des Berichts (fertig am …) */
  date: Date;
  current: MeasurementInput;
  previous?: (MeasurementInput & { date: Date }) | null;
  recs: RecInput[];
  /** Markenlogos je brand.id (aus der DB, siehe logos.ts); fehlt → Initiale */
  logos?: Record<string, PdfLogo>;
  /** GEO-Leitfaden/FAQ in der Berichtssprache (guide.ts); fehlt → Kapitel entfällt */
  guide?: ReportGuide | null;
}

export interface Interval { lo: number; hi: number }
export interface BrandStat {
  id: string | null; name: string; own: boolean;
  named: number; rate: number | null; ci: Interval | null;
  avgPosition: number | null; recommended: number; recommendationRate: number | null; sov: number | null;
}
export interface EngineStat {
  engine: string; responses: number; noAiAnswer: number; named: number; rate: number | null; avgPosition: number | null;
  ownSite: number; top: { name: string; named: number; rate: number } | null; models: string[];
}
export interface QuestionRow {
  id: string; text: string; topic: string | null; responses: number; named: number;
  cells: Record<string, { named: number; total: number }>;
  /** häufigste andere getrackte Marken in den Antworten zu dieser Frage */
  others: { name: string; named: number }[];
}
export interface DomainRow {
  domain: string; responses: number; share: number;
  type: 'own' | 'competitor' | 'other'; brandName: string | null;
  /** davon Antworten mit Nennung der eigenen Marke */
  ownNamed: number;
  /** davon Antworten mit Wettbewerber, ohne eigene Marke */
  competitorOnly: number;
}
export interface ReportRec {
  key: string; type: string; category: RecCategory; categoryLabel: string; owner: string;
  title: string; why: string; steps: string[]; impact: number; effort: number; priority: number;
  impactText: string; effortText: string; deliverable: string; prompt: string; status: string;
}
export interface TopicRow {
  name: string; prompts: number; responses: number; named: number; rate: number | null;
  top: { name: string; named: number; rate: number } | null; domains: { domain: string; responses: number }[];
}
export interface Comparison {
  date: Date; responses: number;
  before: { named: number; rate: number | null; ci: Interval | null };
  after: { named: number; rate: number | null; ci: Interval | null };
  /** Änderung in Anteil (0..1), null ohne Basis */
  delta: number | null;
  withinNoise: boolean;
  engines: { engine: string; before: number | null; after: number | null }[];
  competitors: { name: string; before: number | null; after: number | null }[];
  ownSite: { before: number | null; after: number | null };
  /** Fragen, bei denen die Marke jetzt (nicht mehr) genannt wird – Anzahl */
  questionsGained: number; questionsLost: number;
}
export interface ReportModel {
  reportId: string | null;
  lang: Lang; tier: ReportTier; kind: ReportKind;
  date: Date;
  brand: { name: string; domains: string[]; description: string | null; kind: string | null };
  workspaceName: string;
  scope: { prompts: number; repetitions: number; engines: string[]; planned: number; responses: number; noAiAnswer: number };
  period: { from: Date | null; to: Date | null };
  models: { engine: string; models: string[] }[];
  own: BrandStat;
  score: number;
  verdict: { label: string; tone: 'red' | 'amber' | 'green' };
  keyInsight: { kind: string; text: string } | null;
  brands: BrandStat[];
  ranking: { place: number | null; total: number; leader: { name: string; responses: number; rate: number } | null };
  engines: EngineStat[];
  strongest: EngineStat | null;
  weakest: EngineStat | null;
  questions: QuestionRow[];
  sources: {
    responsesWithSources: number;
    top: DomainRow[];
    ownSite: { responses: number; named: number; pages: { url: string; title: string; responses: number }[] };
    competitorOnly: DomainRow[];
    competitorSites: { name: string; domain: string; responses: number }[];
  };
  recs: ReportRec[];
  topRecs: ReportRec[];
  topics: TopicRow[];
  /** 30-Tage-Plan (Strategiebericht): die wichtigsten Maßnahmen auf vier Wochen verteilt, der Rest danach */
  plan: Plan30 | null;
  comparison: Comparison | null;
  /** Markenlogos je brand.id */
  logos: Record<string, PdfLogo>;
  guide: ReportGuide | null;
}

export interface Plan30 {
  weeks: { week: 1 | 2 | 3 | 4; items: ReportRec[] }[];
  /** nicht eingeplante (weniger wichtige) offene Maßnahmen */
  later: ReportRec[];
}

// ---------------------------------------------------------------------------
// Reine Helfer
// ---------------------------------------------------------------------------

/** 95-%-Wilson-Intervall für einen Anteil k/n (null bei n = 0). */
export function wilson(k: number, n: number, z = 1.96): Interval | null {
  if (!n) return null;
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Kennzahlen einer Marke über eine Menge Antworten (ments enthalten je Marke höchstens eine Zeile pro Antwort). */
export function brandStat(b: Pick<BrandLike, 'id' | 'name' | 'isOwn'>, respIds: ReadonlySet<string>, ments: RecData['ments']): BrandStat {
  const named = new Set<string>();
  const positions: number[] = [];
  const rec = new Set<string>();
  let all = 0;
  for (const m of ments) {
    if (!respIds.has(m.responseId)) continue;
    all++;
    if (m.brandId !== b.id) continue;
    if (!named.has(m.responseId)) { named.add(m.responseId); positions.push(m.position); }
    if (m.recommended) rec.add(m.responseId);
  }
  const n = respIds.size;
  return {
    id: b.id, name: b.name, own: b.isOwn,
    named: named.size, rate: ratio(named.size, n), ci: wilson(named.size, n),
    avgPosition: named.size >= MIN_POSITION_MENTIONS ? mean(positions) : null,
    recommended: rec.size, recommendationRate: ratio(rec.size, n), sov: ratio(named.size, all),
  };
}

/** Kategorie-Texte; neue/unbekannte Kategorien (z. B. aus einer neueren Maßnahmen-Erzeugung) dürfen den Bericht nicht kippen. */
function safeCategoryText(cat: RecCategory, lang: Lang, type: string): { label: string; owner: string } {
  try {
    const t = categoryText(cat, lang);
    if (t?.label) return { label: t.label, owner: t.owner ?? '' };
  } catch { /* unten */ }
  const label = String(cat || type || '').replace(/[_-]+/g, ' ').trim();
  return { label: label ? label[0].toUpperCase() + label.slice(1) : (lang === 'en' ? 'Other' : 'Sonstiges'), owner: '' };
}

const UNKNOWN_MODEL = new Set(['google', 'mock', 'test']);

/** Maßnahmen für den Bericht: aktiv, nicht ausgeblendet, nach Priorität; Texte in der Berichtssprache, Prompt wie in der Web-App. */
export function reportRecs(recs: RecInput[], ctx: PromptContext, lang: Lang): ReportRec[] {
  return recs
    .filter((r) => r.active && r.status !== 'dismissed')
    .sort((a, b) => Number(b.priority) - Number(a.priority) || b.impact - a.impact || a.effort - b.effort || a.title.localeCompare(b.title))
    .map((r) => {
      const l = localizeRec(r, lang);
      const cat = categoryOf(r.type);
      const ct = safeCategoryText(cat, lang, r.type);
      return {
        key: r.key, type: r.type, category: cat, categoryLabel: ct.label, owner: ct.owner,
        title: l.title, why: l.why, steps: l.steps, impact: r.impact, effort: r.effort, priority: Number(r.priority),
        impactText: impactText(r.impact, lang), effortText: effortText(r, lang), deliverable: promptDeliverable(r, lang),
        prompt: buildClaudePrompt(l, ctx, lang), status: r.status,
      };
    });
}

/** So viele Maßnahmen kommen höchstens in den 30-Tage-Plan (zwei je Woche) – der Plan soll schlank bleiben. */
export const PLAN_MAX = 8;

const lexLess = (a: number[], b: number[]) => {
  const i = a.findIndex((v, j) => v !== b[j]);
  return i >= 0 && a[i] < b[i];
};

const MAX_PREREQ = 3;

/** Voraussetzung: Technik mit mindestens mittlerer Wirkung (z. B. gesperrte KI-Crawler) – kommt zuerst. */
const isPrereq = (r: ReportRec) => r.category === 'technical' && r.impact >= 2;

/**
 * 30-Tage-Plan: die wichtigsten offenen Maßnahmen (höchstens `max`) in Wochen 1–4.
 * Reihenfolge: Voraussetzungen zuerst, dann nach Priorität. Die Liste wird in dieser Reihenfolge in bis zu vier
 * zusammenhängende Wochen geteilt, sodass die stärkste Woche möglichst wenig Aufwand hat (Aufwand 1–3 bleibt intern) –
 * eine wichtigere Maßnahme landet so nie später als eine unwichtigere. Keine Woche bleibt leer, solange es genug gibt.
 */
export function planWeeks(recs: ReportRec[], max = PLAN_MAX): Plan30 {
  // höchstens drei Voraussetzungen vorziehen, damit Technik den Plan nicht allein füllt
  const prereqs = recs.filter(isPrereq).sort((a, b) => b.priority - a.priority).slice(0, MAX_PREREQ);
  const ordered = [
    ...prereqs,
    ...recs.filter((r) => !prereqs.includes(r)).sort((a, b) => b.priority - a.priority),
  ];
  const picked = ordered.slice(0, Math.max(0, max));
  const later = ordered.slice(picked.length);
  const load = picked.map((r) => Math.max(1, Math.min(3, Math.round(r.effort || 2))));
  const k = Math.min(4, picked.length);
  let best: number[] = []; // Startindizes der Wochen 2..k
  let bestScore: number[] | null = null;
  // alle Aufteilungen in k zusammenhängende, nicht leere Teile (n ≤ 8 → höchstens 35 Möglichkeiten)
  const walk = (from: number, left: number, cuts: number[]) => {
    if (left === 0) {
      const bounds = [0, ...cuts, picked.length];
      const sums = bounds.slice(0, -1).map((b, i) => load.slice(b, bounds[i + 1]).reduce((a, x) => a + x, 0));
      // kleinste Höchstlast, dann möglichst gleichmäßig; bei Gleichstand lieber früh mehr (die wichtigsten zuerst)
      const score = [Math.max(...sums), sums.reduce((a, x) => a + x * x, 0), ...sums.map((x) => -x)];
      if (!bestScore || lexLess(score, bestScore)) {
        bestScore = score;
        best = cuts;
      }
      return;
    }
    for (let i = from; i <= picked.length - left; i++) walk(i + 1, left - 1, [...cuts, i]);
  };
  if (k > 0) walk(1, k - 1, []);
  const bounds = k > 0 ? [0, ...best, picked.length] : [0];
  const weeks = ([1, 2, 3, 4] as const).map((week, i) => ({
    week, items: i < bounds.length - 1 ? picked.slice(bounds[i], bounds[i + 1]) : [],
  }));
  return { weeks, later };
}

function engineStats(m: MeasurementInput, own: BrandLike | undefined, comps: BrandLike[]): EngineStat[] {
  const ix = indexData(m.data);
  const byEngine = groupBy(m.data.resps, (r) => r.engine);
  const engines = sortEngines([...byEngine.keys(), ...m.runs.map((r) => r.engine)]);
  return engines.map((e) => {
    const ids = new Set((byEngine.get(e) ?? []).map((r) => r.id));
    const o = own ? brandStat(own, ids, ix.ments) : null;
    const tops = comps.map((c) => brandStat(c, ids, ix.ments)).filter((s) => s.named > 0).sort((a, b) => b.named - a.named || a.name.localeCompare(b.name));
    const models = [...new Set(m.runs.filter((r) => r.engine === e && r.model && !UNKNOWN_MODEL.has(r.model)).map((r) => r.model!))].sort();
    return {
      engine: e, responses: ids.size, noAiAnswer: m.noAiAnswer[e] ?? 0,
      named: o?.named ?? 0, rate: o?.rate ?? null, avgPosition: o?.avgPosition ?? null,
      ownSite: [...ix.ownSiteResps].filter((rid) => ids.has(rid)).length,
      top: tops[0] ? { name: tops[0].name, named: tops[0].named, rate: tops[0].rate ?? 0 } : null,
      models,
    };
  });
}

function domainRows(ix: ReturnType<typeof indexData>, brands: BrandLike[], respIds?: ReadonlySet<string>): DomainRow[] {
  const by = new Map<string, Set<string>>();
  for (const [rid, cs] of ix.metricCits) {
    if (respIds && !respIds.has(rid)) continue;
    for (const c of cs) {
      const h = hostOf(c);
      if (!h) continue;
      const s = by.get(h) ?? new Set<string>();
      s.add(rid);
      by.set(h, s);
    }
  }
  const N = respIds ? respIds.size : ix.N;
  return [...by.entries()].map(([domain, rs]) => {
    const own = brands.find((b) => b.isOwn && domainMatches(domain, b.domains));
    const comp = own ? undefined : brands.find((b) => !b.isOwn && domainMatches(domain, b.domains));
    const ids = [...rs];
    return {
      domain, responses: rs.size, share: N ? rs.size / N : 0,
      type: own ? 'own' as const : comp ? 'competitor' as const : 'other' as const, brandName: (own ?? comp)?.name ?? null,
      ownNamed: ids.filter((r) => ix.ownNamed.has(r)).length,
      competitorOnly: ids.filter((r) => !ix.ownNamed.has(r) && ix.compsByResp.has(r)).length,
    };
  }).sort((a, b) => b.responses - a.responses || a.domain.localeCompare(b.domain));
}

function measurementSummary(m: MeasurementInput) {
  const ix = indexData(m.data);
  const ids = new Set(m.data.resps.map((r) => r.id));
  const own = ix.own;
  const ownStat = own ? brandStat(own, ids, ix.ments) : null;
  return { ix, ids, own, ownStat };
}

// ---------------------------------------------------------------------------
// Bericht berechnen (rein)
// ---------------------------------------------------------------------------

export function buildReportModel(input: ReportInput): ReportModel {
  const { lang } = input;
  const d = input.current.data;
  const { ix, ids, own, ownStat } = measurementSummary(input.current);
  if (!own || !ownStat) throw new Error('Bericht: keine eigene Marke im Arbeitsbereich');
  if (ids.size === 0) throw new Error('Bericht: die Messung hat keine auswertbaren Antworten');
  const comps = d.brands.filter((b) => !b.isOwn);

  const brands = [ownStat, ...comps.map((c) => brandStat(c, ids, ix.ments))]
    .sort((a, b) => b.named - a.named || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
  const ranking = rankingFrom(d);
  const leader = ranking.rows[0] && ranking.rows[0].responses > 0 ? ranking.rows[0] : null;
  const overview = overviewFrom(d);

  const engines = engineStats(input.current, own, comps);
  const answered = engines.filter((e) => e.responses > 0 && e.rate !== null);
  const sortedByRate = [...answered].sort((a, b) => (b.rate! - a.rate!) || engineRank(a.engine) - engineRank(b.engine));
  const strongest = sortedByRate.length > 1 && sortedByRate[0].rate! > sortedByRate[sortedByRate.length - 1].rate! ? sortedByRate[0] : null;
  const weakest = strongest ? sortedByRate[sortedByRate.length - 1] : null;

  // Fragen-Matrix
  const engineKeys = engines.map((e) => e.engine);
  const questions: QuestionRow[] = [...ix.respsByPrompt.entries()].map(([pid, rs]) => {
    const p = d.prompts.get(pid);
    const cells: QuestionRow['cells'] = {};
    for (const e of engineKeys) {
      const er = rs.filter((r) => r.engine === e);
      cells[e] = { named: er.filter((r) => ix.ownNamed.has(r.id)).length, total: er.length };
    }
    const qIds = new Set(rs.map((r) => r.id));
    const others = comps.map((c) => brandStat(c, qIds, ix.ments)).filter((s) => s.named > 0)
      .sort((a, b) => b.named - a.named || a.name.localeCompare(b.name)).slice(0, 3).map((s) => ({ name: s.name, named: s.named }));
    return { id: pid, text: p?.text ?? '', topic: p?.topicName ?? null, responses: rs.length, named: rs.filter((r) => ix.ownNamed.has(r.id)).length, cells, others };
  }).sort((a, b) => (a.topic ?? '').localeCompare(b.topic ?? '', lang) || b.named / b.responses - a.named / a.responses || a.text.localeCompare(b.text, lang));

  // Quellen
  const top = domainRows(ix, d.brands);
  const pages = new Map<string, { url: string; title: string; responses: Set<string> }>();
  for (const [rid, cs] of ix.metricCits) {
    for (const c of cs) {
      if (!domainMatches(hostOf(c), own.domains)) continue;
      const u = cleanUrl(c.url);
      const e = pages.get(u) ?? { url: u, title: titleFromUrl(c.url, c.title), responses: new Set<string>() };
      e.responses.add(rid);
      pages.set(u, e);
    }
  }
  const competitorSites = comps.flatMap((c) => {
    const rows = top.filter((t) => t.type === 'competitor' && t.brandName === c.name);
    if (!rows.length) return [];
    const rs = new Set<string>();
    for (const [rid, cs] of ix.metricCits) if (cs.some((x) => domainMatches(hostOf(x), c.domains))) rs.add(rid);
    return [{ name: c.name, domain: rows[0].domain, responses: rs.size }];
  }).sort((a, b) => b.responses - a.responses);

  // Maßnahmen + Prompt-Kontext wie in der Web-App (promptContext in apps/web/lib/recs-data.ts)
  const ctx: PromptContext = {
    brand: { name: own.name, description: own.description ?? null, domains: own.domains, kind: own.kind ?? null },
    competitors: comps.map((c) => c.name),
    workspaceName: input.workspaceName,
    nextMeasurement: null,
    contentLanguage: d.lang ?? 'de',
  };
  const recs = reportRecs(input.recs, ctx, lang);

  // Themen (Strategiebericht)
  const topics: TopicRow[] = input.tier === 'strategy'
    ? [...groupBy(questions, (q) => q.topic ?? '').entries()].map(([name, qs]) => {
      const tIds = new Set(qs.flatMap((q) => ix.respsByPrompt.get(q.id) ?? []).map((r) => r.id));
      const o = brandStat(own, tIds, ix.ments);
      const t = comps.map((c) => brandStat(c, tIds, ix.ments)).filter((s) => s.named > 0).sort((a, b) => b.named - a.named || a.name.localeCompare(b.name))[0];
      return {
        name, prompts: qs.length, responses: tIds.size, named: o.named, rate: o.rate,
        top: t ? { name: t.name, named: t.named, rate: t.rate ?? 0 } : null,
        domains: domainRows(ix, d.brands, tIds).slice(0, 3).map((x) => ({ domain: x.domain, responses: x.responses })),
      };
    }).sort((a, b) => b.responses - a.responses || a.name.localeCompare(b.name, lang))
    : [];

  // Vergleich mit dem Vorbericht
  let comparison: Comparison | null = null;
  if (input.previous) {
    const p = measurementSummary(input.previous);
    const before = p.ownStat;
    const pe = engineStats(input.previous, p.own, p.ix.competitors);
    // „Frage neu/nicht mehr genannt“ heißt: in mindestens einer Antwort genannt. Hatte der Vorbericht mehr Durchläufe
    // (früher 3, heute 2), zählen dort nur die ersten – sonst hätte er allein durch mehr Antworten öfter „genannt“.
    const curReps = Math.max(1, ...input.current.runs.map((r) => r.repetition));
    const pq = new Map([...p.ix.respsByPrompt.entries()].map(([pid, rs]) => [pid, rs.some((r) => (r.repetition ?? 1) <= curReps && p.ix.ownNamed.has(r.id))]));
    let gained = 0, lost = 0;
    for (const q of questions) {
      const was = pq.get(q.id);
      if (was === undefined) continue;
      if (!was && q.named > 0) gained++;
      if (was && q.named === 0) lost++;
    }
    const delta = before?.rate != null && ownStat.rate != null ? ownStat.rate - before.rate : null;
    comparison = {
      date: input.previous.date, responses: p.ids.size,
      before: { named: before?.named ?? 0, rate: before?.rate ?? null, ci: before?.ci ?? null },
      after: { named: ownStat.named, rate: ownStat.rate, ci: ownStat.ci },
      delta, withinNoise: delta === null || Math.abs(delta) < NOISE_PP,
      engines: sortEngines([...engines.map((e) => e.engine), ...pe.map((e) => e.engine)]).map((e) => ({
        engine: e, before: pe.find((x) => x.engine === e)?.rate ?? null, after: engines.find((x) => x.engine === e)?.rate ?? null,
      })),
      competitors: comps.map((c) => {
        const pb = p.ix.competitors.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
        return { name: c.name, before: pb ? brandStat(pb, p.ids, p.ix.ments).rate : null, after: brandStat(c, ids, ix.ments).rate };
      }).sort((a, b) => (b.after ?? 0) - (a.after ?? 0)),
      ownSite: { before: ratio(p.ix.ownSiteResps.size, p.ids.size), after: ratio(ix.ownSiteResps.size, ids.size) },
      questionsGained: gained, questionsLost: lost,
    };
  }

  const runs = input.current.runs;
  const times = runs.flatMap((r) => [r.startedAt, r.finishedAt]).filter((x): x is Date => x instanceof Date);
  const modelsByEngine = engines.map((e) => ({ engine: e.engine, models: e.models }));
  const score = Math.round((ownStat.rate ?? 0) * 100);

  return {
    reportId: input.reportId, lang, tier: input.tier, kind: input.kind, date: input.date,
    brand: { name: own.name, domains: own.domains, description: own.description ?? null, kind: own.kind ?? null },
    workspaceName: input.workspaceName,
    scope: {
      prompts: new Set(runs.map((r) => r.promptId)).size || d.prompts.size,
      repetitions: Math.max(1, ...runs.map((r) => r.repetition)),
      engines: sortEngines(runs.map((r) => r.engine)),
      planned: runs.length, responses: ids.size,
      noAiAnswer: Object.values(input.current.noAiAnswer).reduce((a, b) => a + b, 0),
    },
    period: {
      from: times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : input.current.collection.startedAt ?? input.current.collection.createdAt,
      to: times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : input.current.collection.finishedAt,
    },
    models: modelsByEngine,
    own: ownStat, score, verdict: scoreVerdict(score, lang),
    keyInsight: overview ? (({ kind, text }) => ({ kind, text }))(keyInsightFrom(overview, lang)) : null,
    brands,
    ranking: { place: ranking.own?.place ?? null, total: ranking.total, leader: leader ? { name: leader.name, responses: leader.responses, rate: leader.rate } : null },
    engines, strongest, weakest,
    questions,
    sources: {
      responsesWithSources: [...ix.metricCits.entries()].filter(([, cs]) => cs.length > 0).length,
      top,
      ownSite: {
        responses: ix.ownSiteResps.size, named: [...ix.ownSiteResps].filter((r) => ix.ownNamed.has(r)).length,
        pages: [...pages.values()].map((p) => ({ url: p.url, title: p.title, responses: p.responses.size })).sort((a, b) => b.responses - a.responses || a.url.localeCompare(b.url)).slice(0, 6),
      },
      competitorOnly: top.filter((t) => t.type !== 'own' && t.competitorOnly > 0).sort((a, b) => b.competitorOnly - a.competitorOnly || a.domain.localeCompare(b.domain)).slice(0, 8),
      competitorSites,
    },
    recs,
    topRecs: pickTopRecommendations(recs.filter((r) => r.status !== 'done'), 3),
    topics,
    plan: input.tier === 'strategy' ? planWeeks(recs.filter((r) => r.status !== 'done')) : null,
    comparison,
    logos: input.logos ?? {},
    guide: input.guide ?? null,
  };
}

// ---------------------------------------------------------------------------
// Laden (DB)
// ---------------------------------------------------------------------------

async function loadMeasurement(workspaceId: string, collectionId: string): Promise<MeasurementInput> {
  const [c] = await db.select({ id: collection.id, createdAt: collection.createdAt, startedAt: collection.startedAt, finishedAt: collection.finishedAt })
    .from(collection).where(and(eq(collection.id, collectionId), eq(collection.workspaceId, workspaceId)));
  if (!c) throw new Error('Bericht: Messung nicht gefunden');
  const [data, runs, empty] = await Promise.all([
    loadRecData(workspaceId, collectionId),
    db.select({ engine: run.engine, model: run.model, promptId: run.promptId, repetition: run.repetition, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt })
      .from(run).where(and(eq(run.collectionId, collectionId), ne(run.status, 'skipped'))),
    db.select({ engine: run.engine }).from(response).innerJoin(run, eq(run.id, response.runId))
      .where(and(eq(run.collectionId, collectionId), eq(response.noAiAnswer, true))),
  ]);
  const noAiAnswer: Record<string, number> = {};
  for (const r of empty) noAiAnswer[r.engine] = (noAiAnswer[r.engine] ?? 0) + 1;
  return { data, runs, noAiAnswer, collection: c };
}

async function loadWorkspaceBase(workspaceId: string) {
  const [ws] = await db.select({ id: workspace.id, name: workspace.name, language: workspace.language }).from(workspace).where(eq(workspace.id, workspaceId));
  if (!ws) throw new Error('Bericht: Arbeitsbereich nicht gefunden');
  const recs = await db.select({
    key: recommendation.key, type: recommendation.type, title: recommendation.title, why: recommendation.why, steps: recommendation.steps,
    impact: recommendation.impact, effort: recommendation.effort, priority: recommendation.priority, evidence: recommendation.evidence,
    status: recommendation.status, active: recommendation.active, lastCollectionId: recommendation.lastCollectionId,
  }).from(recommendation).where(and(eq(recommendation.workspaceId, workspaceId), eq(recommendation.active, true))).orderBy(desc(recommendation.priority));
  return { ws, recs };
}

const FINISHED = ['done', 'budget_exceeded'] as const;

/** Eingabe für einen gekauften Bericht (report-Zeile). */
export async function loadReportInput(reportId: string): Promise<ReportInput> {
  const [r] = await db.select().from(report).where(eq(report.id, reportId));
  if (!r) throw new Error('Bericht nicht gefunden');
  if (!r.collectionId) throw new Error('Bericht: noch keine Messung');
  const { ws, recs } = await loadWorkspaceBase(r.workspaceId);
  const current = await loadMeasurement(r.workspaceId, r.collectionId);
  // Nur Maßnahmen aus der Generierung zu genau dieser Messung; sonst (Generierung fehlgeschlagen/abgelaufen,
  // älterer Bericht neu gerendert) im Speicher aus den Regeln berechnen – nie Maßnahmen einer anderen Messung.
  const fromThis = recs.filter((x) => x.lastCollectionId === r.collectionId);
  const ownRecs: RecInput[] = fromThis.length ? fromThis : await rulesRecs(r.workspaceId, current.data);
  let previous: ReportInput['previous'] = null;
  if (r.kind === 'remeasure' && r.previousReportId) {
    const [p] = await db.select().from(report).where(eq(report.id, r.previousReportId));
    if (p && p.workspaceId !== r.workspaceId) throw new Error('Bericht: Vorbericht gehört zu einem anderen Arbeitsbereich');
    if (p?.collectionId) {
      const m = await loadMeasurement(p.workspaceId, p.collectionId);
      previous = { ...m, date: p.readyAt ?? m.collection.finishedAt ?? m.collection.createdAt };
    }
  }
  const lang = toLang(ws.language);
  return {
    reportId: r.id, lang, tier: r.tier === 'strategy' ? 'strategy' : 'compact', kind: r.kind === 'remeasure' ? 'remeasure' : 'initial',
    workspaceName: ws.name, date: r.readyAt ?? current.collection.finishedAt ?? new Date(), current, previous, recs: ownRecs,
    logos: await loadBrandLogos(r.workspaceId), guide: loadGuide(lang),
  };
}

/** Eingabe ohne report-Zeile: neueste abgeschlossene Messung eines Arbeitsbereichs (Vorschau mit echten Daten, CLI). */
export async function loadWorkspaceInput(slug: string, opts: { tier: ReportTier; collectionId?: string; previousCollectionId?: string; lang?: Lang; recs?: 'db' | 'rules' }): Promise<ReportInput> {
  const [w] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.slug, slug));
  if (!w) throw new Error(`Arbeitsbereich ${slug} nicht gefunden`);
  const { ws, recs } = await loadWorkspaceBase(w.id);
  let cid = opts.collectionId;
  if (!cid) {
    // neueste abgeschlossene Messung; echte Messungen haben Vorrang vor Mock-Läufen (Entwicklung)
    const cs = await db.select({ id: collection.id, real: sql<boolean>`exists (select 1 from run r where r.collection_id = "collection"."id" and r.model is not null and r.model <> 'mock')` })
      .from(collection).where(and(eq(collection.workspaceId, w.id), inArray(collection.status, [...FINISHED]))).orderBy(desc(collection.createdAt)).limit(20);
    const c = cs.find((x) => x.real) ?? cs[0];
    if (!c) throw new Error(`Arbeitsbereich ${slug}: keine abgeschlossene Messung`);
    cid = c.id;
  }
  const current = await loadMeasurement(w.id, cid);
  // Maßnahmen gehören zur letzten Generierung. Stammen sie aus einer anderen Messung (z. B. ältere Messung gewählt),
  // werden sie für die Vorschau aus den Regeln neu berechnet – nur im Speicher, ohne KI und ohne DB-Schreibzugriff.
  const fromThis = recs.filter((r) => r.lastCollectionId === cid);
  const useRules = opts.recs === 'rules' || (opts.recs !== 'db' && fromThis.length === 0);
  const recInputs: RecInput[] = useRules ? await rulesRecs(w.id, current.data) : (fromThis.length ? fromThis : recs);
  let previous: ReportInput['previous'] = null;
  if (opts.previousCollectionId) {
    const m = await loadMeasurement(w.id, opts.previousCollectionId);
    previous = { ...m, date: m.collection.finishedAt ?? m.collection.createdAt };
  }
  const lang = opts.lang ?? toLang(ws.language);
  return {
    reportId: null, lang, tier: opts.tier, kind: previous ? 'remeasure' : 'initial',
    workspaceName: ws.name, date: current.collection.finishedAt ?? new Date(), current, previous, recs: recInputs,
    logos: await loadBrandLogos(w.id), guide: loadGuide(lang),
  };
}

/** Maßnahmen aus den Regeln (wie generateRecommendations ohne KI-Formulierung), mit dem letzten Website-Check je Domain. */
async function rulesRecs(workspaceId: string, data: RecData): Promise<RecInput[]> {
  const checks = await db.select({ domain: siteCheck.domain, result: siteCheck.result }).from(siteCheck)
    .where(eq(siteCheck.workspaceId, workspaceId)).orderBy(desc(siteCheck.checkedAt)).limit(20);
  const latest = new Map<string, SiteCheckResult>();
  for (const c of checks) if (!latest.has(c.domain)) latest.set(c.domain, c.result as SiteCheckResult);
  return buildCandidates({ ...data, siteChecks: [...latest.values()] }).map((c) => ({
    key: c.key, type: c.type, title: c.title, why: c.why, steps: c.steps, impact: c.impact, effort: c.effort, priority: c.priority,
    evidence: { ...c.evidence, texts: c.texts, phrasedBy: 'rules' }, status: 'open', active: true,
  }));
}
