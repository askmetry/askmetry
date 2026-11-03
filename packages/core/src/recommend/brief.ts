// Lagebericht (Markdown) und wichtigste Erkenntnis für die Übersicht. Liest aus der DB.
import { db, recommendation, workspace } from '@opengeo/db';
import { and, desc, eq } from 'drizzle-orm';
import { nextCronTick } from '../schedule.ts';
import { indexData, normName, type RecData } from './data.ts';
import { finishedCollections, loadRecData } from './index.ts';
import { CATEGORIES, categoryOf, categoryText, effortText, engineName, impactText, isLikelyCompetitor, localizeRec, scoreVerdict } from './present.ts';
import { outreachExclusionsFrom, type OutreachExclusion } from './rules.ts';
import { pctText, type Lang } from '../i18n.ts';

export interface BrandStanding { name: string; isOwn: boolean; named: number; rate: number }
export interface Overview {
  collectionId: string;
  at: Date;
  responses: number;
  engines: string[];
  own: BrandStanding & { domain: string | null; siteResponses: number; siteShare: number; byEngine: { engine: string; rate: number; named: number; responses: number }[] };
  /** Wettbewerber, absteigend nach Nennungen */
  competitors: BrandStanding[];
}

export type KeyInsightKind = 'source_not_named' | 'competitor_ahead' | 'leading' | 'none';
export interface KeyInsight {
  kind: KeyInsightKind;
  /** fertiger Satz für die UI, z. B. „KIs nutzen paylindo.de in 34 % der Antworten als Quelle – nennen Paylindo aber fast nie.“ */
  text: string;
  brand: string;
  domain: string | null;
  responses: number;
  ownNamed: number;
  ownRate: number;
  ownSiteResponses: number;
  ownSiteShare: number;
  topCompetitor: { name: string; named: number; rate: number } | null;
}

const pct = (x: number, lang: Lang = 'de') => pctText(x, lang);

/** Kennzahlen einer Messung (ohne DB): Nennungen je Marke, Quellenanteil der eigenen Website, Rate je KI-Suche. */
export function overviewFrom(d: RecData): Overview | null {
  const ix = indexData(d);
  if (!ix.own || !ix.N) return null;
  const named = new Map<string, Set<string>>();
  for (const m of ix.ments) {
    if (!m.brandId) continue;
    const s = named.get(m.brandId) ?? new Set<string>();
    s.add(m.responseId);
    named.set(m.brandId, s);
  }
  const engines = [...new Set(d.resps.map((r) => r.engine))];
  const own = ix.own;
  const ownSet = named.get(own.id) ?? new Set();
  const byEngine = engines.map((e) => {
    const rs = d.resps.filter((r) => r.engine === e);
    const n = rs.filter((r) => ownSet.has(r.id)).length;
    return { engine: e, rate: rs.length ? n / rs.length : 0, named: n, responses: rs.length };
  });
  return {
    collectionId: d.collectionId, at: d.at, responses: ix.N, engines,
    own: {
      name: own.name, isOwn: true, named: ownSet.size, rate: ownSet.size / ix.N,
      domain: own.domains[0] ?? null, siteResponses: ix.ownSiteResps.size, siteShare: ix.ownSiteResps.size / ix.N, byEngine,
    },
    competitors: ix.competitors.map((c) => {
      const n = named.get(c.id)?.size ?? 0;
      return { name: c.name, isOwn: false, named: n, rate: n / ix.N };
    }).sort((a, b) => b.named - a.named || a.name.localeCompare(b.name)),
  };
}

/** Wichtigste Erkenntnis in einem Satz (ohne DB). */
export function keyInsightFrom(o: Overview, lang: Lang = 'de'): KeyInsight {
  const top = o.competitors[0] && o.competitors[0].named > 0 ? o.competitors[0] : null;
  const base = {
    brand: o.own.name, domain: o.own.domain, responses: o.responses, ownNamed: o.own.named, ownRate: o.own.rate,
    ownSiteResponses: o.own.siteResponses, ownSiteShare: o.own.siteShare,
    topCompetitor: top ? { name: top.name, named: top.named, rate: top.rate } : null,
  };
  // Website wird als Quelle genutzt, die Marke aber kaum genannt → stärkster, überraschendster Befund.
  // Basis immer: alle Antworten der Messung (N), Prozente nur zusätzlich zu „x von N“.
  if (lang === 'en') return keyInsightEn(o, top, base);
  if (o.own.domain && o.own.siteShare >= 0.15 && o.own.rate < o.own.siteShare / 2) {
    const how = o.own.rate < 0.05 ? `fast nie (${o.own.named} von ${o.responses})` : `nur in ${o.own.named} von ${o.responses}`;
    return { ...base, kind: 'source_not_named', text: `KIs nutzen ${o.own.domain} in ${o.own.siteResponses} von ${o.responses} Antworten (${pct(o.own.siteShare)}) als Quelle – nennen ${o.own.name} aber ${how}.` };
  }
  if (top && top.named > o.own.named) {
    return { ...base, kind: 'competitor_ahead', text: `${top.name} wird in ${top.named} von ${o.responses} Antworten genannt, ${o.own.name} in ${o.own.named}.` };
  }
  if (o.own.named > 0) {
    return { ...base, kind: 'leading', text: `${o.own.name} liegt vorn: in ${o.own.named} von ${o.responses} Antworten genannt${top ? ` – ${top.name} in ${top.named}` : ''}.` };
  }
  return { ...base, kind: 'none', text: `${o.own.name} wird in keiner der ${o.responses} Antworten genannt.` };
}

function keyInsightEn(o: Overview, top: BrandStanding | null, base: Omit<KeyInsight, 'kind' | 'text'>): KeyInsight {
  if (o.own.domain && o.own.siteShare >= 0.15 && o.own.rate < o.own.siteShare / 2) {
    const how = o.own.rate < 0.05 ? `almost never mention ${o.own.name} (${o.own.named} of ${o.responses})` : `mention ${o.own.name} in only ${o.own.named} of ${o.responses}`;
    return { ...base, kind: 'source_not_named', text: `AI search engines use ${o.own.domain} as a source in ${o.own.siteResponses} of ${o.responses} answers (${pct(o.own.siteShare, 'en')}) – but ${how}.` };
  }
  if (top && top.named > o.own.named) {
    return { ...base, kind: 'competitor_ahead', text: `${top.name} is mentioned in ${top.named} of ${o.responses} answers, ${o.own.name} in ${o.own.named}.` };
  }
  if (o.own.named > 0) {
    return { ...base, kind: 'leading', text: `${o.own.name} is in the lead: mentioned in ${o.own.named} of ${o.responses} answers${top ? ` – ${top.name} in ${top.named}` : ''}.` };
  }
  return { ...base, kind: 'none', text: `${o.own.name} isn’t mentioned in any of the ${o.responses} answers.` };
}

/** Wichtigste Erkenntnis der letzten abgeschlossenen Messung; null ohne Messung oder eigene Marke. */
export async function keyInsight(workspaceId: string, lang: Lang = 'de'): Promise<KeyInsight | null> {
  const [latest] = await finishedCollections(workspaceId, 1);
  if (!latest) return null;
  const o = overviewFrom(await loadRecData(workspaceId, latest.id));
  return o ? keyInsightFrom(o, lang) : null;
}

export interface RankingRow { name: string; own: boolean; tracked: boolean; responses: number; rate: number; place: number }
export interface BrandRanking { collectionId: string; responses: number; rows: RankingRow[]; own: RankingRow | null; total: number }

/**
 * Rangliste der Marken einer Messung (ohne DB) – dieselbe Logik wie in der UI:
 * getrackte Marken (inkl. eigener) + ungetrackte Namen, die wahrscheinlich Wettbewerber sind
 * (Urteil des Analyse-Modells per Mehrheit, sonst Namensliste; isLikelyCompetitor).
 * Zählt verschiedene Antworten, in denen die Marke genannt wird (Basis N = alle Antworten der Messung).
 * Sortierung: Antworten absteigend, bei Gleichstand eigene Marke zuerst, dann Name; Platz = laufende Nummer.
 */
export function rankingFrom(d: RecData): BrandRanking {
  const ix = indexData(d);
  const N = ix.N;
  const rows: Omit<RankingRow, 'place'>[] = [];
  const tracked = new Set<string>();
  const byBrand = new Map<string, Set<string>>();
  for (const m of ix.ments) {
    if (!m.brandId) continue;
    const s = byBrand.get(m.brandId) ?? new Set<string>();
    s.add(m.responseId);
    byBrand.set(m.brandId, s);
  }
  for (const b of d.brands) {
    for (const n of [b.name, ...(b.aliases ?? [])]) tracked.add(normName(n));
    const n = byBrand.get(b.id)?.size ?? 0;
    rows.push({ name: b.name, own: b.isOwn, tracked: true, responses: n, rate: N ? n / N : 0 });
  }
  const un = new Map<string, { names: Map<string, number>; resps: Set<string>; yes: number; no: number }>();
  for (const m of ix.ments) {
    if (m.brandId) continue;
    const k = normName(m.name);
    if (!k || tracked.has(k)) continue;
    const e = un.get(k) ?? { names: new Map(), resps: new Set(), yes: 0, no: 0 };
    e.names.set(m.name, (e.names.get(m.name) ?? 0) + 1);
    if (m.isCompetitor === true) e.yes++;
    else if (m.isCompetitor === false) e.no++;
    e.resps.add(m.responseId);
    un.set(k, e);
  }
  for (const e of un.values()) {
    // häufigste Schreibweise, bei Gleichstand die großgeschriebene (girocard/Girocard → eine Zeile)
    const name = [...e.names.entries()].sort((a, b) => b[1] - a[1] || Number(/^\p{Lu}/u.test(b[0])) - Number(/^\p{Lu}/u.test(a[0])))[0]![0];
    if (!isLikelyCompetitor(name, e.yes + e.no ? e.yes > e.no : null)) continue;
    rows.push({ name, own: false, tracked: false, responses: e.resps.size, rate: N ? e.resps.size / N : 0 });
  }
  const ranked = rows
    .sort((a, b) => b.responses - a.responses || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name, 'de'))
    .map((r, i) => ({ ...r, place: i + 1 }));
  return { collectionId: d.collectionId, responses: N, rows: ranked, own: ranked.find((r) => r.own) ?? null, total: ranked.length };
}

/** Rangliste der letzten abgeschlossenen Messung; null ohne Messung. */
export async function brandRanking(workspaceId: string): Promise<BrandRanking | null> {
  const [latest] = await finishedCollections(workspaceId, 1);
  if (!latest) return null;
  return rankingFrom(await loadRecData(workspaceId, latest.id));
}

/**
 * Häufige Quellen der letzten Messung, für die es bewusst keine Outreach-Maßnahme gibt – mit Grund
 * (z. B. „Seite eines Anbieters …“, „zu selten …“). Für die Quellen-Seite („Warum keine Maßnahme?“).
 */
export async function outreachExclusions(workspaceId: string, lang: Lang = 'de'): Promise<OutreachExclusion[]> {
  const [latest] = await finishedCollections(workspaceId, 1);
  if (!latest) return [];
  return outreachExclusionsFrom(indexData(await loadRecData(workspaceId, latest.id)), { lang });
}

const dateDe = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
const dateEn = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'Europe/Berlin', month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeEn = (d: Date) => `${d.toLocaleDateString('en-US', { timeZone: 'Europe/Berlin', weekday: 'long', month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', minute: '2-digit' })}`;
const dateTimeDe = (d: Date) => `${d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })} Uhr`;

/** Nächste geplante Messung als Text, null ohne aktiven Messplan. */
export function nextMeasurementText(ws: { scheduleEnabled: boolean; scheduleCron: string }, now = new Date(), lang: Lang = 'de'): string | null {
  if (!ws.scheduleEnabled) return null;
  try { const t = nextCronTick(ws.scheduleCron, now); return lang === 'en' ? dateTimeEn(t) : dateTimeDe(t); } catch { return null; }
}

/** Top-Maßnahmen für Übersicht/Lagebericht: aktiv, nicht erledigt/ausgeblendet, möglichst aus verschiedenen Kategorien. */
export function pickTopRecommendations<T extends { type: string; priority: string | number }>(rows: T[], n = 3): T[] {
  const sorted = [...rows].sort((a, b) => Number(b.priority) - Number(a.priority));
  const out: T[] = [];
  const cats = new Set<string>();
  for (const r of sorted) if (out.length < n && !cats.has(categoryOf(r.type))) { out.push(r); cats.add(categoryOf(r.type)); }
  for (const r of sorted) if (out.length < n && !out.includes(r)) out.push(r);
  return out.sort((a, b) => Number(b.priority) - Number(a.priority));
}

/**
 * Lagebericht als Markdown: Stand, Vergleich mit den Top-3-Wettbewerbern, wichtigste Erkenntnis, Top-3-Maßnahmen
 * mit Zuständigkeit und Zeit, nächste Messung. Für den Chef und als Kontext für einen KI-Assistenten.
 */
export async function buildStatusBrief(workspaceId: string, now = new Date(), lang: Lang = 'de'): Promise<string> {
  const en = lang === 'en';
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
  if (!ws) throw new Error('Workspace nicht gefunden');
  const cols = await finishedCollections(workspaceId, 2);
  const next = nextMeasurementText(ws, now, lang);
  const nextLine = en
    ? (next ? `Next measurement: ${next}.` : 'No measurement schedule active – the next measurement has to be started manually.')
    : (next ? `Nächste Messung: ${next}.` : 'Kein Messplan aktiv – die nächste Messung wird manuell gestartet.');
  const heading = (name: string) => (en ? `# Status report – AI visibility: ${name}` : `# Lagebericht KI-Sichtbarkeit: ${name}`);
  if (!cols[0]) return [heading(ws.name), '', en ? 'There is no completed measurement yet.' : 'Es gibt noch keine abgeschlossene Messung.', '', nextLine].join('\n');
  const data = await loadRecData(workspaceId, cols[0].id);
  const o = overviewFrom(data);
  if (!o) return [heading(ws.name), '', en ? 'No own brand has been set up for this workspace.' : 'Für diesen Workspace ist keine eigene Marke angelegt.', '', nextLine].join('\n');
  const prev = cols[1] ? overviewFrom(await loadRecData(workspaceId, cols[1].id)) : null;
  const ranking = rankingFrom(data);
  const score = Math.round(o.own.rate * 100);
  const verdict = scoreVerdict(score, lang);
  const insight = keyInsightFrom(o, lang);
  const of = (a: number, b: number) => (en ? `${a} of ${b}` : `${a} von ${b}`);
  const eng = (k: string) => engineName(k, lang);

  const L: string[] = [];
  L.push(heading(o.own.name), '');
  L.push(en
    ? `As of: measurement from ${dateEn(o.at)} · ${o.responses} answers from ${o.engines.map(eng).join(', ')}`
    : `Stand: Messung vom ${dateDe(o.at)} · ${o.responses} Antworten von ${o.engines.map(eng).join(', ')}`, '');
  L.push(en ? '## Where we stand' : '## Wo wir stehen');
  L.push(en
    ? `AI visibility means: how often AI search engines such as ChatGPT, Gemini or Google AI Overviews mention ${o.own.name} on their own when customers ask questions about our topic. It’s based on all ${o.responses} answers from the latest measurement.`
    : `KI-Sichtbarkeit heißt: Wie oft nennen KI-Suchen wie ChatGPT, Gemini oder die Google-Übersicht ${o.own.name} von sich aus, wenn Kundinnen und Kunden Fragen zu unserem Thema stellen. Grundlage sind alle ${o.responses} Antworten der letzten Messung.`, '');
  let delta = '';
  if (prev) {
    const d = score - Math.round(prev.own.rate * 100);
    const ds = d > 0 ? `+${d}` : d === 0 ? '±0' : d;
    delta = en
      ? ` Previous measurement: ${Math.round(prev.own.rate * 100)}/100 (${ds} points).`
      : ` Vormessung: ${Math.round(prev.own.rate * 100)}/100 (${ds} Punkte).`;
  }
  const place = ranking.own
    ? (en ? ` That puts ${o.own.name} at #${ranking.own.place} out of ${ranking.total} brands.` : ` Damit liegt ${o.own.name} auf Platz ${ranking.own.place} von ${ranking.total} Marken.`)
    : '';
  L.push(en
    ? `**AI visibility: ${score}/100 – ${verdict.label}.** ${o.own.name} is mentioned in ${of(o.own.named, o.responses)} answers.${place}${delta}`
    : `**KI-Sichtbarkeit: ${score}/100 – ${verdict.label}.** ${o.own.name} wird in ${of(o.own.named, o.responses)} Antworten genannt.${place}${delta}`, '');
  L.push(`${en ? 'By AI search' : 'Je KI-Suche'}: ${o.own.byEngine.map((e) => `${eng(e.engine)} ${of(e.named, e.responses)} (${pct(e.rate, lang)})`).join(' · ')}`, '');
  const rows = ranking.rows.filter((r) => !r.own).slice(0, 3);
  if (ranking.own) rows.push(ranking.own);
  rows.sort((a, b) => a.place - b.place);
  L.push(en ? '| Place | Brand | Mentioned | Share of answers |' : '| Platz | Marke | Genannt | Anteil der Antworten |', '|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.place} | ${r.own ? `**${r.name} (${en ? 'us' : 'wir'})**` : r.name} | ${of(r.responses, o.responses)} | ${pct(r.rate, lang)} |`);
  L.push('');
  L.push(en ? '## Key insight' : '## Wichtigste Erkenntnis', insight.text, '');

  const recRows = await db.select().from(recommendation)
    .where(and(eq(recommendation.workspaceId, workspaceId), eq(recommendation.active, true)))
    .orderBy(desc(recommendation.priority));
  const top = pickTopRecommendations(recRows.filter((r) => r.status === 'open' || r.status === 'in_progress'));
  L.push(en ? '## The 3 most important actions' : '## Die 3 wichtigsten Maßnahmen');
  if (!top.length) L.push(en ? 'No open actions at the moment.' : 'Aktuell keine offenen Maßnahmen.');
  top.forEach((r0, i) => {
    const r = localizeRec(r0, lang);
    const cat = categoryText(categoryOf(r.type), lang);
    L.push(`${i + 1}. **${r.title}** – ${cat.label} (${cat.owner}) · ${impactText(r.impact, lang)} · ${effortText(r, lang)}${r.status === 'in_progress' ? (en ? ' · in progress' : ' · in Arbeit') : ''}`);
    L.push(`   ${r.why}`);
  });
  const open = recRows.filter((r) => r.status === 'open' || r.status === 'in_progress');
  if (open.length > top.length) {
    const counts = new Map<string, number>();
    for (const r of open) counts.set(categoryOf(r.type), (counts.get(categoryOf(r.type)) ?? 0) + 1);
    const byCat = [...counts.entries()].sort((a, b) => CATEGORIES[a[0] as keyof typeof CATEGORIES].order - CATEGORIES[b[0] as keyof typeof CATEGORIES].order)
      .map(([c, n]) => `${categoryText(c as keyof typeof CATEGORIES, lang).label} ${n}`).join(' · ');
    L.push('', en ? `${open.length} open actions in total: ${byCat}.` : `Insgesamt ${open.length} offene Maßnahmen: ${byCat}.`);
  }
  L.push('');
  L.push(en ? '## Next measurement' : '## Nächste Messung', nextLine, '');
  L.push('---');
  L.push(en
    ? `Use this as context for your AI: paste this report into a conversation with ChatGPT, Claude or Gemini and ask, for example, “What should we tackle first this week?”. All numbers come from the measurement; “mentioned” means the AI search engine names ${o.own.name} in its answer.`
    : `Nutze das als Kontext für deine KI: Füge diesen Lagebericht in ein Gespräch mit ChatGPT, Claude oder Gemini ein und frag z. B. „Was sollten wir diese Woche zuerst angehen?“. Alle Zahlen stammen aus der Messung; „genannt“ heißt, die KI-Suche erwähnt ${o.own.name} in ihrer Antwort.`);
  return L.join('\n');
}
