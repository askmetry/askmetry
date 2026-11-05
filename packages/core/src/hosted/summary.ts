// Teaser-Zusammenfassung eines Schnell-Checks (rein, ohne DB). Kennzahlen nach CONTRACT.md:
// Basis = ausgewertete Antworten mit Text der Check-Messung; Quellen nach metricCitations (cited, sonst searched).
import { normalizeDomain } from '../domains.ts';
import { metricCitations, type RecData, type SiteCheckResult } from '../recommend/data.ts';
import { categoryOf, type RecCategory } from '../recommend/present.ts';
import { CHECK_SCOPE } from './config.ts';
import type { CheckSummary, RecArea } from './types.ts';

export const AREA_OF: Record<RecCategory, RecArea> = { content: 'own_content', offsite: 'other_sites', community: 'community', technical: 'technical' };
export const areaOf = (type: string): RecArea => AREA_OF[categoryOf(type)];

export interface SummaryRec { id: string; type: string; key: string; priority: string | number; active: boolean; status: string }

/** Freie Maßnahmen: möglichst 1 Technik + 1 eigene Inhalte (jeweils höchste Priorität), sonst nach Priorität auffüllen. */
export function pickFreeRecommendations<T extends SummaryRec>(recs: readonly T[], n = CHECK_SCOPE.freeRecommendations): T[] {
  const sorted = recs.filter((r) => r.active && r.status !== 'dismissed').sort((a, b) => Number(b.priority) - Number(a.priority));
  const out: T[] = [];
  for (const area of ['technical', 'own_content'] as RecArea[]) {
    const r = sorted.find((x) => areaOf(x.type) === area && !out.includes(x));
    if (r && out.length < n) out.push(r);
  }
  for (const r of sorted) if (out.length < n && !out.includes(r)) out.push(r);
  return out;
}

export function buildCheckSummary(input: {
  data: RecData;
  recs: readonly SummaryRec[];
  /** alle gemessenen Prompt-IDs (auch ohne Antwort) */
  measuredPromptIds: readonly string[];
  siteChecks?: readonly SiteCheckResult[];
}): CheckSummary {
  const { data } = input;
  const own = data.brands.find((b) => b.isOwn);
  const comps = data.brands.filter((b) => !b.isOwn);
  const promptOf = new Map(data.resps.map((r) => [r.id, r.promptId]));
  const named = new Map<string, Set<string>>(); // brandId → responseIds
  for (const m of data.ments) {
    if (!m.brandId) continue;
    if (!named.has(m.brandId)) named.set(m.brandId, new Set());
    named.get(m.brandId)!.add(m.responseId);
  }
  const promptsFor = (brandId: string) => new Set([...(named.get(brandId) ?? [])].map((r) => promptOf.get(r)).filter(Boolean)).size;
  const ownResps = own ? named.get(own.id) ?? new Set<string>() : new Set<string>();

  const competitors = comps.map((c) => ({ name: c.name, promptsMentioned: promptsFor(c.id) }))
    .sort((a, b) => b.promptsMentioned - a.promptsMentioned || a.name.localeCompare(b.name, 'de')).slice(0, CHECK_SCOPE.competitors);

  // Top-Domains: Anzahl Antworten, die die Domain als Quelle nutzen
  const domainResps = new Map<string, Set<string>>();
  for (const [rid, cits] of metricCitations(data.cits)) {
    if (!promptOf.has(rid)) continue;
    for (const c of cits) {
      const d = normalizeDomain(c.domain || c.url);
      if (!d) continue;
      if (!domainResps.has(d)) domainResps.set(d, new Set());
      domainResps.get(d)!.add(rid);
    }
  }
  const topDomains = [...domainResps].map(([domain, s]) => ({ domain, count: s.size }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, 3);

  const engineKeys = [...new Set(data.resps.map((r) => r.engine))];
  const engines = engineKeys.map((engine) => {
    const rs = data.resps.filter((r) => r.engine === engine);
    return { engine, responses: rs.length, mentioned: rs.filter((r) => ownResps.has(r.id)).length };
  }).sort((a, b) => CHECK_SCOPE.engines.indexOf(a.engine) - CHECK_SCOPE.engines.indexOf(b.engine));

  const active = input.recs.filter((r) => r.active && r.status !== 'dismissed');
  const counts: Record<RecArea, number> = { own_content: 0, other_sites: 0, community: 0, technical: 0 };
  for (const r of active) counts[areaOf(r.type)]++;

  const sc = input.siteChecks ?? [];
  const robotsKnown = sc.filter((c) => c.robots.status !== null && c.robots.status < 500 && c.robots.status !== 429);
  const homeKnown = sc.filter((c) => c.home.status !== null && c.home.status < 400);
  const top = competitors.find((c) => c.promptsMentioned > 0) ?? null;

  return {
    brand: { name: own?.name ?? '', domain: own?.domains[0] ?? '', description: own?.description ?? null },
    prompts: input.measuredPromptIds.length,
    promptsMentioned: own ? promptsFor(own.id) : 0,
    responses: data.resps.length,
    visibility: data.resps.length ? ownResps.size / data.resps.length : 0,
    topCompetitor: top,
    competitors,
    topDomains,
    engines,
    recommendationCounts: counts,
    recommendationsTotal: active.length,
    freeRecommendationIds: pickFreeRecommendations(active).map((r) => r.id),
    technical: sc.length ? {
      robotsBlocksAi: robotsKnown.length ? robotsKnown.some((c) => c.robots.blocked.length > 0) : null,
      jsOnly: homeKnown.length ? homeKnown.some((c) => (c.home.textChars ?? 0) < 500) : null,
    } : null,
  };
}
