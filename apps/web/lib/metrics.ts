import { cache } from 'react';
// Kennzahlen gemäß CONTRACT.md – überall gleich verwenden.
//
// Aufbau: Reine Helfer (testbar, ohne DB) + Loader, die per Drizzle/SQL genau die Basis laden:
// Antworten mit nicht-leerem Text, gefiltert nach Workspace, Collection(s), Engine, Topic.

import { and, eq, inArray, ne, sql, type SQL, getTableColumns } from 'drizzle-orm';
import { brand, citation, collection, db, mention, prompt, response, run } from '@opengeo/db';
import { ENGINE_NAMES, engineName, isLikelyCompetitor } from '@opengeo/core/present';

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

// Anzeigenamen der KI-Suchen kommen aus @opengeo/core (DESIGN.md, „Begriffe“)
export const ENGINE_LABELS = ENGINE_NAMES;
export const SELECTABLE_ENGINES = ['chatgpt', 'gemini', 'claude', 'perplexity', 'google_aio', 'google_ai_mode'] as const;
export const engineLabel = engineName;
const ENGINE_ORDER = ['chatgpt', 'gemini', 'claude', 'perplexity', 'google_aio', 'google_ai_mode', 'mock'];
export const sortEngines = (keys: Iterable<string>) =>
  [...new Set(keys)].sort((a, b) => (ENGINE_ORDER.indexOf(a) + 1 || 99) - (ENGINE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

// ---------------------------------------------------------------------------
// Reine Helfer
// ---------------------------------------------------------------------------

/** Host zum Anzeigen/Speichern: klein, ohne Protokoll, Pfad, Port und führendes „www.“ (Umlaute bleiben erhalten). */
export function cleanHost(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  h = h.split(/[/?#]/)[0] ?? '';
  h = h.replace(/:\d+$/, '').replace(/\.$/, '');
  return h.replace(/^www\./, '');
}

/** IDN in ASCII (Punycode) umwandeln – wie der Worker (URL-Parser) die Citation-Domains speichert. */
function toAsciiHost(h: string): string {
  if (!h || /^[\x00-\x7f]*$/.test(h)) return h;
  try {
    return new URL(`http://${h}/`).hostname;
  } catch {
    return h;
  }
}

/** Host für den Abgleich: wie cleanHost, IDN zusätzlich als Punycode („müller.de“ → „xn--mller-kva.de“). */
export function normalizeHost(input: string): string {
  return toAsciiHost(cleanHost(input)).replace(/^www\./, '');
}

/** Domain-Abgleich laut Vertrag: host === d || host.endsWith('.' + d), „www.“ vorher entfernt. */
export function domainMatches(host: string, domains: readonly string[]): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  return domains.some((raw) => {
    const d = normalizeHost(raw);
    return d !== '' && (h === d || h.endsWith('.' + d));
  });
}

/** Anteil als Zahl 0..1, null bei leerer Basis. */
export function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Komma-getrennte Eingabe → bereinigte, eindeutige Liste. */
export function parseList(input: string | null | undefined, opts: { domains?: boolean } = {}): string[] {
  const parts = (input ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const out = opts.domains ? parts.map(cleanHost).filter(Boolean) : parts;
  return [...new Set(out)];
}

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Datentypen der Basis
export type Resp = { id: string; runId: string; promptId: string; engine: string; repetition: number; topicId: string | null; collectionId: string };
export type Ment = { responseId: string; brandId: string | null; name: string; position: number; recommended: boolean; sentiment: string; snippet: string | null; isCompetitor?: boolean | null };
export type Cit = { responseId: string; url: string; domain: string; title: string | null; position: number; kind: 'cited' | 'searched' };
export type BrandLike = { id: string; name: string; aliases?: string[]; domains: string[]; isOwn: boolean };

export type BrandMetrics = {
  n: number; // Basis: Antworten mit Text
  mentioned: number;
  visibility: number | null;
  avgPosition: number | null;
  recommended: number;
  recommendationRate: number | null;
  mentions: number;
  allMentions: number;
  shareOfVoice: number | null;
  ownSite: number; // Antworten mit Citation auf Marken-Domain
  ownSiteRate: number | null;
  ownSiteSearchedOnly: number; // davon nur über kind='searched'
};

/**
 * Quellenregel (CONTRACT): Quellen einer Antwort = ihre cited-Zeilen, falls vorhanden, sonst die searched-Zeilen.
 * ChatGPT liefert zusätzlich zu den Zitaten alle durchsuchten Seiten – die dürfen Kennzahlen nicht verfälschen.
 * Idempotent; Reihenfolge bleibt erhalten.
 */
export function effectiveSources<T extends Pick<Cit, 'responseId' | 'kind'>>(cits: readonly T[]): T[] {
  const hasCited = new Set<string>();
  for (const c of cits) if (c.kind === 'cited') hasCited.add(c.responseId);
  return cits.filter((c) => c.kind === 'cited' || !hasCited.has(c.responseId));
}

/** Gegenstück zur Quellenregel: durchsuchte Seiten in Antworten, die eigene Zitate haben („gelesen, nicht zitiert“). */
export function readNotCited<T extends Pick<Cit, 'responseId' | 'kind'>>(cits: readonly T[]): T[] {
  const hasCited = new Set<string>();
  for (const c of cits) if (c.kind === 'cited') hasCited.add(c.responseId);
  return cits.filter((c) => c.kind === 'searched' && hasCited.has(c.responseId));
}

/** Kennzahlen einer Marke über eine Menge Antworten (Mentions/Citations dürfen weitere Antworten enthalten). */
export function brandMetrics(resps: readonly Resp[], ments: readonly Ment[], allCits: readonly Cit[], b: Pick<BrandLike, 'id' | 'domains'>): BrandMetrics {
  const cits = effectiveSources(allCits);
  const ids = new Set(resps.map((r) => r.id));
  const n = ids.size;
  const positions: number[] = [];
  const mentionedIds = new Set<string>();
  const recommendedIds = new Set<string>();
  let all = 0;
  for (const m of ments) {
    if (!ids.has(m.responseId)) continue;
    all++;
    if (m.brandId !== b.id) continue;
    if (!mentionedIds.has(m.responseId)) {
      mentionedIds.add(m.responseId);
      positions.push(m.position);
    }
    if (m.recommended) recommendedIds.add(m.responseId);
  }
  const siteKinds = new Map<string, Set<string>>();
  if (b.domains.length) {
    for (const c of cits) {
      if (!ids.has(c.responseId) || !domainMatches(c.domain || c.url, b.domains)) continue;
      const s = siteKinds.get(c.responseId) ?? new Set<string>();
      s.add(c.kind);
      siteKinds.set(c.responseId, s);
    }
  }
  const searchedOnly = [...siteKinds.values()].filter((s) => !s.has('cited')).length;
  return {
    n,
    mentioned: mentionedIds.size,
    visibility: ratio(mentionedIds.size, n),
    avgPosition: mean(positions),
    recommended: recommendedIds.size,
    recommendationRate: ratio(recommendedIds.size, n),
    mentions: mentionedIds.size,
    allMentions: all,
    shareOfVoice: ratio(mentionedIds.size, all),
    ownSite: siteKinds.size,
    ownSiteRate: ratio(siteKinds.size, n),
    ownSiteSearchedOnly: searchedOnly,
  };
}

export function groupBy<T, K>(xs: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Ungetrackte Marken (brandId null), zusammengefasst nach Schreibweise, sortiert nach Anzahl Antworten. */
export function untrackedBrands(resps: readonly Resp[], ments: readonly Ment[], trackedNames: readonly string[] = []) {
  const ids = new Set(resps.map((r) => r.id));
  const tracked = new Set(trackedNames.map(normName));
  const by = new Map<string, { names: Map<string, number>; responses: Set<string>; positions: number[]; yes: number; no: number }>();
  for (const m of ments) {
    if (m.brandId !== null || !ids.has(m.responseId)) continue;
    const k = normName(m.name);
    if (!k || tracked.has(k)) continue;
    const e = by.get(k) ?? { names: new Map(), responses: new Set(), positions: [] as number[], yes: 0, no: 0 };
    e.names.set(m.name, (e.names.get(m.name) ?? 0) + 1);
    if (m.isCompetitor === true) e.yes++;
    else if (m.isCompetitor === false) e.no++;
    if (!e.responses.has(m.responseId)) {
      e.responses.add(m.responseId);
      e.positions.push(m.position);
    }
    by.set(k, e);
  }
  const allMentions = ments.filter((m) => ids.has(m.responseId)).length;
  return [...by.values()]
    .map((e) => {
      const name = [...e.names.entries()].sort((a, b) => b[1] - a[1] || Number(/^\p{Lu}/u.test(b[0])) - Number(/^\p{Lu}/u.test(a[0])))[0]![0];
      return {
      name,
      // Urteil des Analyse-Modells (Mehrheit), sonst Namensliste
      competitor: isLikelyCompetitor(name, e.yes + e.no ? e.yes > e.no : null),
      responses: e.responses.size,
      visibility: ratio(e.responses.size, ids.size),
      shareOfVoice: ratio(e.responses.size, allMentions),
      avgPosition: mean(e.positions),
    };
    })
    .sort((a, b) => b.responses - a.responses || a.name.localeCompare(b.name, 'de'));
}

export type DomainType = 'own' | 'competitor' | 'other';
export function classifyDomain(host: string, brands: readonly BrandLike[]): { type: DomainType; brand: BrandLike | null } {
  const own = brands.find((b) => b.isOwn && domainMatches(host, b.domains));
  if (own) return { type: 'own', brand: own };
  const comp = brands.find((b) => !b.isOwn && domainMatches(host, b.domains));
  if (comp) return { type: 'competitor', brand: comp };
  return { type: 'other', brand: null };
}

/** Top-Domains: Anteil der Antworten (mit Quellen), die die Domain nutzen. */
export function domainStats(resps: readonly Resp[], allCits: readonly Cit[], brands: readonly BrandLike[]) {
  const cits = effectiveSources(allCits);
  const ids = new Set(resps.map((r) => r.id));
  const withSources = new Set<string>();
  const by = new Map<string, { responses: Set<string>; cited: Set<string>; urls: Map<string, number> }>();
  for (const c of cits) {
    if (!ids.has(c.responseId)) continue;
    withSources.add(c.responseId);
    const host = normalizeHost(c.domain || c.url);
    if (!host) continue;
    const e = by.get(host) ?? { responses: new Set(), cited: new Set(), urls: new Map() };
    e.responses.add(c.responseId);
    if (c.kind === 'cited') e.cited.add(c.responseId);
    e.urls.set(c.url, (e.urls.get(c.url) ?? 0) + 1);
    by.set(host, e);
  }
  // Basis wie Übersicht/Core: alle Antworten mit Text (nicht nur die mit Quellen)
  const base = ids.size;
  const rows = [...by.entries()].map(([domain, e]) => {
    const cls = classifyDomain(domain, brands);
    return {
      domain,
      responses: e.responses.size,
      share: ratio(e.responses.size, base),
      searchedOnly: e.responses.size - e.cited.size,
      type: cls.type,
      brandName: cls.brand?.name ?? null,
      topUrls: [...e.urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u]) => u),
    };
  });
  rows.sort((a, b) => b.responses - a.responses || a.domain.localeCompare(b.domain));
  return { base, answers: ids.size, withSources: withSources.size, rows };
}

/** Domains, die in Antworten zitiert werden, in denen Wettbewerber genannt werden, die eigene Marke aber nicht. */
export function competitorOnlyDomains(resps: readonly Resp[], ments: readonly Ment[], allCits: readonly Cit[], brands: readonly BrandLike[]) {
  const cits = effectiveSources(allCits);
  const ids = new Set(resps.map((r) => r.id));
  const own = brands.find((b) => b.isOwn);
  const compIds = new Map(brands.filter((b) => !b.isOwn).map((b) => [b.id, b.name]));
  const byResp = groupBy(ments.filter((m) => ids.has(m.responseId)), (m) => m.responseId);
  const target = new Map<string, Set<string>>(); // responseId → Wettbewerbernamen
  for (const [rid, ms] of byResp) {
    if (own && ms.some((m) => m.brandId === own.id)) continue;
    const comps = new Set(ms.filter((m) => m.brandId && compIds.has(m.brandId)).map((m) => compIds.get(m.brandId!)!));
    if (comps.size) target.set(rid, comps);
  }
  const by = new Map<string, { responses: Set<string>; competitors: Map<string, number> }>();
  for (const c of cits) {
    const comps = target.get(c.responseId);
    if (!comps) continue;
    const host = normalizeHost(c.domain || c.url);
    if (!host || (own && domainMatches(host, own.domains))) continue;
    const e = by.get(host) ?? { responses: new Set(), competitors: new Map() };
    if (!e.responses.has(c.responseId)) {
      e.responses.add(c.responseId);
      for (const n of comps) e.competitors.set(n, (e.competitors.get(n) ?? 0) + 1);
    }
    by.set(host, e);
  }
  return {
    answers: target.size,
    rows: [...by.entries()]
      .map(([domain, e]) => ({
        domain,
        responses: e.responses.size,
        share: ratio(e.responses.size, target.size),
        type: classifyDomain(domain, brands).type,
        competitors: [...e.competitors.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
      }))
      .sort((a, b) => b.responses - a.responses || a.domain.localeCompare(b.domain)),
  };
}

/** Antworten, die eine eigene Domain als Quelle nutzen, die eigene Marke aber nicht nennen. */
export function usedNotNamed(resps: readonly Resp[], ments: readonly Ment[], allCits: readonly Cit[], own: BrandLike | undefined) {
  if (!own) return [];
  const cits = effectiveSources(allCits);
  const ids = new Set(resps.map((r) => r.id));
  const named = new Set(ments.filter((m) => m.brandId === own.id).map((m) => m.responseId));
  const out = new Map<string, Cit[]>();
  for (const c of cits) {
    if (!ids.has(c.responseId) || named.has(c.responseId) || !domainMatches(c.domain || c.url, own.domains)) continue;
    const arr = out.get(c.responseId) ?? [];
    if (!arr.some((x) => x.url === c.url)) arr.push(c);
    out.set(c.responseId, arr);
  }
  const byId = new Map(resps.map((r) => [r.id, r]));
  return [...out.entries()].map(([rid, cs]) => ({ response: byId.get(rid)!, citations: cs }));
}

export type Cell = { n: number; mentioned: number; avgPosition: number | null; othersNamed: boolean };

/** Prompt × Engine: wie oft (über Wiederholungen) die Marke genannt wurde. */
export function promptEngineMatrix(resps: readonly Resp[], ments: readonly Ment[], brandId: string | undefined) {
  const byResp = groupBy(ments, (m) => m.responseId);
  const cells = new Map<string, Map<string, Cell & { positions: number[] }>>();
  for (const r of resps) {
    const row = cells.get(r.promptId) ?? new Map();
    const c: Cell & { positions: number[] } = row.get(r.engine) ?? { n: 0, mentioned: 0, avgPosition: null, othersNamed: false, positions: [] };
    c.n++;
    const ms = byResp.get(r.id) ?? [];
    const own = brandId ? ms.find((m) => m.brandId === brandId) : undefined;
    if (own) {
      c.mentioned++;
      c.positions.push(own.position);
    }
    if (ms.some((m) => m.brandId !== brandId)) c.othersNamed = true;
    c.avgPosition = mean(c.positions);
    row.set(r.engine, c);
    cells.set(r.promptId, row);
  }
  return cells as Map<string, Map<string, Cell>>;
}

/** Lücke laut Vertrag: Prompt × Engine, wo die eigene Marke fehlt, andere Marken aber genannt werden. */
export function findGaps(resps: readonly Resp[], ments: readonly Ment[], brands: readonly BrandLike[]) {
  const own = brands.find((b) => b.isOwn);
  const brandName = new Map(brands.map((b) => [b.id, b]));
  const matrix = promptEngineMatrix(resps, ments, own?.id);
  const respsByPrompt = groupBy(resps, (r) => r.promptId);
  const byResp = groupBy(ments, (m) => m.responseId);
  const out = [];
  for (const [promptId, row] of matrix) {
    const engines = sortEngines(row.keys());
    const missing = engines.filter((e) => row.get(e)!.mentioned === 0 && row.get(e)!.othersNamed);
    if (!missing.length) continue;
    // „Stattdessen genannt“: getrackte Wettbewerber und ungetrackte Marken, die wahrscheinlich Wettbewerber sind; gleiche Namen zusammengefasst
    const named = new Map<string, { name: string; count: number; competitor: boolean }>();
    for (const r of respsByPrompt.get(promptId) ?? []) {
      if (!missing.includes(r.engine)) continue;
      const seen = new Set<string>();
      for (const m of byResp.get(r.id) ?? []) {
        const b = m.brandId ? brandName.get(m.brandId) : undefined;
        if (b?.isOwn) continue;
        const name = b?.name ?? m.name;
        if (!b && !isLikelyCompetitor(name, m.isCompetitor)) continue;
        const k = normName(name);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const e = named.get(k) ?? { name, count: 0, competitor: !!b };
        if (!b && /^\p{Lu}/u.test(name) && !/^\p{Lu}/u.test(e.name)) e.name = name;
        e.count++;
        named.set(k, e);
      }
    }
    out.push({
      promptId,
      engines,
      missing,
      partial: engines.filter((e) => {
        const c = row.get(e)!;
        return c.mentioned > 0 && c.mentioned < c.n;
      }),
      // in keiner KI-Suche genannt (für „Fragen ohne dich“)
      absent: engines.every((e) => row.get(e)!.mentioned === 0),
      named: [...named.values()].sort((a, b) => b.count - a.count || Number(b.competitor) - Number(a.competitor)),
    });
  }
  return out.sort((a, b) => b.missing.length - a.missing.length || b.named.length - a.named.length);
}

/** Text in Abschnitte zerlegen, damit Markennamen hervorgehoben werden können. */
export type Term = { term: string; kind: 'own' | 'competitor' | 'untracked' };
export function highlightSegments(text: string, terms: readonly Term[]): { text: string; kind: Term['kind'] | null }[] {
  const clean = [...new Map(terms.filter((t) => t.term.trim().length >= 2).map((t) => [t.term.toLowerCase(), t])).values()]
    .sort((a, b) => b.term.length - a.term.length);
  if (!clean.length || !text) return [{ text, kind: null }];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${clean.map((t) => esc(t.term)).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const kindOf = new Map(clean.map((t) => [t.term.toLowerCase(), t.kind]));
  const out: { text: string; kind: Term['kind'] | null }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), kind: null });
    out.push({ text: m[0], kind: kindOf.get(m[0].toLowerCase()) ?? 'untracked' });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: null });
  return out;
}

// ---------------------------------------------------------------------------
// Loader (SQL/Drizzle) – alle mit workspace_id gefiltert
// ---------------------------------------------------------------------------

export const FINISHED_STATUSES = ['done', 'budget_exceeded'] as const;

export type Filters = { engine?: string | null; topicId?: string | null; promptId?: string | null };

function baseWhere(workspaceId: string, collectionIds: string[], f: Filters): SQL {
  const conds: SQL[] = [
    eq(response.workspaceId, workspaceId),
    eq(run.workspaceId, workspaceId),
    inArray(run.collectionId, collectionIds),
    ne(response.answer, ''),
    // noch nicht ausgewertete Antworten (Marken fehlen) würden die Sichtbarkeit verfälschen
    eq(response.analyzed, true),
  ];
  if (f.engine) conds.push(eq(run.engine, f.engine));
  if (f.topicId) conds.push(eq(prompt.topicId, f.topicId));
  if (f.promptId) conds.push(eq(run.promptId, f.promptId));
  return and(...conds)!;
}

/**
 * Lädt die Kennzahl-Basis (Antworten mit Text) samt Mentions und Citations.
 * `cits` folgt der Quellenregel (effectiveSources), `read` sind die nur gelesenen Seiten (readNotCited).
 */
export async function loadBase(workspaceId: string, collectionIds: string[], f: Filters = {}) {
  if (!collectionIds.length) return { resps: [] as Resp[], ments: [] as Ment[], cits: [] as Cit[], read: [] as Cit[] };
  const where = baseWhere(workspaceId, collectionIds, f);
  const [resps, ments, cits] = await Promise.all([
    db
      .select({ id: response.id, runId: run.id, promptId: run.promptId, engine: run.engine, repetition: run.repetition, topicId: prompt.topicId, collectionId: run.collectionId })
      .from(response).innerJoin(run, eq(run.id, response.runId)).innerJoin(prompt, eq(prompt.id, run.promptId))
      .where(where),
    db
      .select({ responseId: mention.responseId, brandId: mention.brandId, name: mention.name, position: mention.position, recommended: mention.recommended, sentiment: mention.sentiment, snippet: mention.snippet, isCompetitor: mention.isCompetitor })
      .from(mention).innerJoin(response, eq(response.id, mention.responseId)).innerJoin(run, eq(run.id, response.runId)).innerJoin(prompt, eq(prompt.id, run.promptId))
      .where(and(where, eq(mention.workspaceId, workspaceId))),
    db
      .select({ responseId: citation.responseId, url: citation.url, domain: citation.domain, title: citation.title, position: citation.position, kind: citation.kind })
      .from(citation).innerJoin(response, eq(response.id, citation.responseId)).innerJoin(run, eq(run.id, response.runId)).innerJoin(prompt, eq(prompt.id, run.promptId))
      .where(and(where, eq(citation.workspaceId, workspaceId)))
      .orderBy(citation.position),
  ]);
  return { resps, ments, cits: effectiveSources(cits), read: readNotCited(cits) };
}

export const loadBrands = cache(async (workspaceId: string): Promise<(BrandLike & { aliases: string[]; description: string | null; kind: string | null; profileSource: string | null; logoType: string | null; logoUpdatedAt: Date | null })[]> => {
  // ohne logo_data (bis 270 KB Base64) – das liefert nur die Logo-Route
  const { logoData: _omit, ...cols } = getTableColumns(brand);
  const rows = await db.select(cols).from(brand).where(eq(brand.workspaceId, workspaceId)).orderBy(sql`${brand.isOwn} desc`, brand.name);
  return rows;
});

/** Collections des Workspaces, neueste zuerst – mit Anzahl ausgewerteter Antworten mit Text. */
export async function loadCollections(workspaceId: string) {
  return db
    .select({
      id: collection.id, status: collection.status, trigger: collection.trigger, costUsd: collection.costUsd,
      createdAt: collection.createdAt, startedAt: collection.startedAt, finishedAt: collection.finishedAt, error: collection.error,
      answered: sql<number>`(select count(*) from ${response} resp join ${run} rr on rr.id = resp.run_id
        where rr.collection_id = "collection"."id" and resp.workspace_id = ${workspaceId} and resp.answer <> '' and resp.analyzed)::int`,
    })
    .from(collection).where(eq(collection.workspaceId, workspaceId)).orderBy(sql`${collection.createdAt} desc`);
}

/**
 * Gewählte Collection: ?c=<id> (nur abgeschlossene des Workspaces), sonst die neueste abgeschlossene.
 * Collections ohne ausgewertete Antworten (z. B. alles wegen Budget übersprungen) sind nicht auswählbar –
 * sie stehen nur in der Kostentabelle der Einstellungen (`all`).
 */
export async function resolveCollection(workspaceId: string, requested?: string | null) {
  const all = await loadCollections(workspaceId);
  const finished = all.filter((c) => (FINISHED_STATUSES as readonly string[]).includes(c.status) && Number(c.answered) > 0);
  const selected = (requested && finished.find((c) => c.id === requested)) || finished[0] || null;
  return { all, finished, selected };
}

/** Zeitreihe je abgeschlossener Collection, als SQL-Aggregat (skaliert über viele Messungen). */
export async function loadTrend(workspaceId: string, own: BrandLike | undefined) {
  if (!own) return [];
  const domains = own.domains.map(normalizeHost).filter(Boolean);
  const domainArr = domains.length ? sql`ARRAY[${sql.join(domains.map((d) => sql`${d}`), sql`, `)}]::text[]` : sql`ARRAY[]::text[]`;
  const res = await db.execute<{
    id: string; created_at: string; n: number; mentioned: number; recommended: number; own_mentions: number; all_mentions: number; own_site: number; avg_pos: number | null;
  }>(sql`
    with r as (
      select resp.id, run.collection_id
      from ${response} resp join ${run} run on run.id = resp.run_id
      join ${collection} c on c.id = run.collection_id
      where resp.workspace_id = ${workspaceId} and c.workspace_id = ${workspaceId}
        and c.status in ('done','budget_exceeded') and resp.answer <> '' and resp.analyzed
    ),
    m as (
      select r.collection_id, mm.response_id, mm.brand_id, mm.position, mm.recommended
      from r join ${mention} mm on mm.response_id = r.id
    ),
    s as (
      select distinct r.collection_id, r.id
      from r join ${citation} ci on ci.response_id = r.id
      cross join lateral (select regexp_replace(lower(ci.domain), '^www\\.', '') as host) h
      where exists (select 1 from unnest(${domainArr}) d where h.host = d or h.host like '%.' || d)
        -- Quellenregel: searched-Zeilen nur, wenn die Antwort keine cited-Zeilen hat
        and (ci.kind = 'cited' or not exists (select 1 from ${citation} c2 where c2.response_id = ci.response_id and c2.kind = 'cited'))
    )
    select c.id, c.created_at,
      (select count(*) from r where r.collection_id = c.id)::int as n,
      (select count(distinct response_id) from m where m.collection_id = c.id and m.brand_id = ${own.id})::int as mentioned,
      (select count(distinct response_id) from m where m.collection_id = c.id and m.brand_id = ${own.id} and m.recommended)::int as recommended,
      (select count(*) from m where m.collection_id = c.id and m.brand_id = ${own.id})::int as own_mentions,
      (select count(*) from m where m.collection_id = c.id)::int as all_mentions,
      (select count(*) from s where s.collection_id = c.id)::int as own_site,
      (select avg(position)::float from m where m.collection_id = c.id and m.brand_id = ${own.id}) as avg_pos
    from ${collection} c
    where c.workspace_id = ${workspaceId} and c.status in ('done','budget_exceeded')
    order by c.created_at asc
  `);
  // Collections ohne Antworten (z. B. alles wegen Budget übersprungen) sind kein Trendpunkt
  return res.rows.filter((x) => Number(x.n) > 0).map((x) => ({
    id: x.id,
    createdAt: new Date(x.created_at),
    n: Number(x.n),
    visibility: ratio(Number(x.mentioned), Number(x.n)),
    recommendationRate: ratio(Number(x.recommended), Number(x.n)),
    shareOfVoice: ratio(Number(x.own_mentions), Number(x.all_mentions)),
    ownSiteRate: ratio(Number(x.own_site), Number(x.n)),
    avgPosition: x.avg_pos === null ? null : Number(x.avg_pos),
  }));
}

/** Engines, für die es in den Collections ausgewertete Antworten mit Text gibt (für Filter). */
export async function loadCollectionEngines(workspaceId: string, collectionIds: string[]) {
  if (!collectionIds.length) return [] as string[];
  const rows = await db.selectDistinct({ engine: run.engine }).from(run).innerJoin(response, eq(response.runId, run.id))
    .where(and(eq(run.workspaceId, workspaceId), inArray(run.collectionId, collectionIds), ne(response.answer, ''), eq(response.analyzed, true)));
  return sortEngines(rows.map((r) => r.engine));
}

/** Kosten je Engine einer Collection (Summe run.cost_usd). */
export async function loadEngineCosts(workspaceId: string, collectionId: string) {
  const rows = await db
    .select({ engine: run.engine, cost: sql<string>`coalesce(sum(${run.costUsd}), 0)` })
    .from(run).where(and(eq(run.workspaceId, workspaceId), eq(run.collectionId, collectionId))).groupBy(run.engine);
  return new Map(rows.map((r) => [r.engine, Number(r.cost)]));
}
