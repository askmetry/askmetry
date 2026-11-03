// Regelbasierte Maßnahmen-Kandidaten: jede mit stabilem key, Evidenz (Zahlen + 1–5 Beispiele) und Standardtexten
// auf Deutsch und Englisch (`texts`; title/why/steps = Workspace-Sprache). Die Texte funktionieren ohne KI; phrase.ts kann sie
// optional verbessern. Deutsch und Englisch haben je Maßnahme gleich viele Schritte (done_steps beziehen sich auf die Indizes).
import {
  cleanUrl, communityGroup, domainMatches, groupBy, hostOf, indexData, normName, pct, shortPath, titleFromUrl,
  type Indexed, type RecData, type SiteCheckResult,
} from './data.ts';
import { isLikelyCompetitor } from './present.ts';
import { listJoin, type Lang } from '../i18n.ts';

export type RecType = 'name_on_own_page' | 'outreach' | 'content_gap' | 'community' | 'technical' | 'positioning' | 'sentiment';
export const REC_TYPES: RecType[] = ['name_on_own_page', 'outreach', 'content_gap', 'community', 'technical', 'positioning', 'sentiment'];

export interface Example {
  prompt: string;
  engine: string;
  url?: string;
  title?: string;
  snippet?: string;
}

export interface Evidence {
  /** Kernzahlen der Regel (Antworten gesamt, betroffene Antworten, Anteile …) */
  metrics: Record<string, number | string | null>;
  /** 1–5 konkrete Beispiele */
  examples: Example[];
  /** Prompt-IDs, auf die sich die Wirkungsmessung bezieht */
  promptIds?: string[];
  /** Domain(s), URLs, Marken – je nach Typ */
  domain?: string;
  urls?: { url: string; title: string; count: number; kind?: 'cited' | 'searched' | 'mixed' }[];
  competitors?: { name: string; count: number }[];
  prompts?: { id: string; text: string; missing?: string[] }[];
  [k: string]: unknown;
}

/** Standardtexte einer Maßnahme in einer Sprache. */
export interface RuleText { title: string; why: string; steps: string[] }

export interface Candidate {
  key: string;
  type: RecType;
  /** Texte in der Workspace-Sprache (= texts[lang]) */
  title: string;
  why: string;
  steps: string[];
  /** Standardtexte in allen Sprachen (gespeichert als evidence.texts, Anzeige in der UI-Sprache) */
  texts: Record<Lang, RuleText>;
  /** Workspace-Sprache, in der title/why/steps stehen (fehlt = de) */
  lang?: Lang;
  impact: 1 | 2 | 3;
  effort: 1 | 2 | 3;
  /** Anteil betroffener Antworten bzw. Prompts (0..1) */
  reach: number;
  priority: number;
  evidence: Evidence;
  /** Kernzahlen für die Entscheidung „neu formulieren?“ (grob gerundet, damit Rauschen keine Neuformulierung auslöst) */
  signature: unknown;
}

/** Priorität = Wirkung × Reichweite / Aufwand (Reichweite mit Sockel, damit auch seltene, wichtige Punkte sichtbar bleiben). */
export function priorityOf(impact: number, reach: number, effort: number): number {
  const r = Math.max(0, Math.min(1, reach));
  return Math.round((10 * impact * (0.2 + 0.8 * r)) / effort * 1000) / 1000;
}

const bucket = (x: number) => Math.round(x * 10); // 10-%-Schritte
const quote = (s: string, n = 160) => {
  const t = s.replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const enginesOf = (ix: Indexed, rids: Iterable<string>) => uniq([...rids].map((r) => ix.respById.get(r)?.engine ?? '')).filter(Boolean);
const ENGINE_ORDER = ['chatgpt', 'gemini', 'claude', 'perplexity', 'google_aio', 'google_ai_mode', 'mock'];
const sortEngines = (es: string[]) => [...es].sort((a, b) => (ENGINE_ORDER.indexOf(a) + 1 || 99) - (ENGINE_ORDER.indexOf(b) + 1 || 99));

/** Markenname → Vergleichsschlüssel (nur Buchstaben/Ziffern, klein) */
const brandKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
/** Labels eines Hosts ohne TLD und typische Präfixe (blog.kenjo.io → ['kenjo']) */
const hostLabels = (host: string) => host.split('.').slice(0, -1).filter((l) => !['www', 'blog', 'de', 'help', 'support', 'app', 'co', 'com'].includes(l)).map(brandKey);

/** Kurzbegründung: ein Satz, höchstens WHY_MAX Zeichen, ohne URLs (die stehen in der Evidenz). */
export const WHY_MAX = 140;
/** Titel: Handlung als Verb-Satz, höchstens TITLE_MAX Zeichen. */
export const TITLE_MAX = 70;
const clipText = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[\s,;:–-]+$/, '')}…`;
};
type Draft = Omit<Candidate, 'priority' | 'title' | 'why' | 'steps' | 'texts'> & { text: (l: Lang) => RuleText };
/** Kandidat fertigstellen: Texte für alle Sprachen erzeugen und kürzen; title/why/steps in der Workspace-Sprache `lang`. */
function make(lang: Lang, c: Draft): Candidate {
  const { text, ...rest } = c;
  const fin = (t: RuleText): RuleText => ({ title: clipText(t.title, TITLE_MAX), why: clipText(t.why, WHY_MAX), steps: t.steps });
  const texts: Record<Lang, RuleText> = { de: fin(text('de')), en: fin(text('en')) };
  return { ...rest, ...texts[lang], texts, lang, priority: priorityOf(c.impact, c.reach, c.effort) };
}
const listL = (xs: string[], l: Lang) => listJoin(xs, l);

/** Frage für Titel kürzen */
const q = (text: string, n: number) => clipText(text.replace(/\?$/, ''), n);

/** Domains, bei denen Outreach nicht sinnvoll ist (Suchmaschinen, Lexika, Behörden) – Community-Quellen laufen separat. */
const NO_OUTREACH = [/(^|\.)google\.[a-z.]+$/, /(^|\.)wikipedia\.org$/, /(^|\.)wikimedia\.org$/, /(^|\.)bing\.com$/, /(^|\.)bund\.de$/,
  /(^|\.)bundesregierung\.de$/, /(^|\.)europa\.eu$/, /(^|\.)gesetze-im-internet\.de$/, /\.gov$/, /(^|\.)bundesbank\.de$/,
  /(^|\.)apple\.com$/, /(^|\.)play\.google\.com$/];

// ---------------------------------------------------------------------------
// name_on_own_page
// ---------------------------------------------------------------------------
export function ruleNameOnOwnPage(ix: Indexed, d: { at: Date } = { at: new Date() }): Candidate[] {
  const own = ix.own;
  if (!own?.domains.length) return [];
  const affected = [...ix.ownSiteResps].filter((r) => !ix.ownNamed.has(r));
  if (affected.length < 2) return [];
  const urls = new Map<string, { title: string | null; resps: Set<string>; prompts: Set<string>; engines: Set<string> }>();
  for (const rid of affected) {
    const resp = ix.respById.get(rid)!;
    for (const c of ix.metricCits.get(rid) ?? []) {
      if (!domainMatches(hostOf(c), own.domains)) continue;
      const u = cleanUrl(c.url);
      const e = urls.get(u) ?? { title: c.title, resps: new Set(), prompts: new Set(), engines: new Set() };
      e.resps.add(rid); e.prompts.add(resp.promptId); e.engines.add(resp.engine);
      e.title ||= c.title;
      urls.set(u, e);
    }
  }
  const pages = [...urls.entries()].sort((a, b) => b[1].resps.size - a[1].resps.size || a[0].localeCompare(b[0]));
  const promptIds = uniq(affected.map((r) => ix.respById.get(r)!.promptId));
  const share = affected.length / ix.N;
  const usedTotal = ix.ownSiteResps.size;
  const examples: Example[] = pages.slice(0, 5).map(([url, e]) => {
    const rid = [...e.resps][0];
    const r = ix.respById.get(rid)!;
    const top = (ix.compsByResp.get(rid) ?? []).sort((a, b) => a.position - b.position)[0];
    return { prompt: ix.promptText(r.promptId), engine: r.engine, url, title: titleFromUrl(url, e.title), snippet: top?.snippet ? quote(top.snippet) : undefined };
  });
  const domain = own.domains[0];
  const pageList = pages.slice(0, 5).map(([u]) => shortPath(u)).join(', ');
  return [make(ix.lang, {
    key: 'name_on_own_page',
    type: 'name_on_own_page',
    // Belegt ist: KIs übernehmen Fakten, Zahlen und Zitate aus einer Seite. Den Markennamen nennen sie vor allem, wenn er an
    // eigene Daten/Werkzeuge gebunden ist oder die Seite die Marke klar als Kategorie-Akteur ausweist – nicht durch Namen in jedem Titel.
    text: (l) => l === 'en' ? {
      title: `Name ${own.name} on the pages AI already uses`,
      why: `AI uses ${domain} as a source in ${usedTotal} of ${ix.N} answers – ${affected.length} of them don’t mention ${own.name}.`,
      steps: [
        `Revise these pages first: ${pageList}.`,
        `In the first paragraph, say once who is behind the information – brand plus category, e.g. “${own.name}, ${own.kind === 'portal' ? 'the comparison site for …' : 'the solution for …'}”. Keep headings factual; no brand name in every title.`,
        `Label your own data, tables and calculators as ${own.name}’s work (e.g. “${own.name} cost comparison ${d.at.getFullYear()}”) – AI picks up quotable numbers together with their source.`,
        `Check that the title tag has a brand suffix (“… | ${own.name}”), as usual in SEO – only add it if it’s missing.`,
        `Add an author box or an “About ${own.name}” paragraph with the same positioning sentence on all of these pages.`,
      ],
    } : {
      title: `${own.name} auf den Seiten nennen, die KIs schon nutzen`,
      why: `KIs nutzen ${domain} in ${usedTotal} von ${ix.N} Antworten als Quelle – in ${affected.length} davon fehlt der Name ${own.name}.`,
      steps: [
        `Diese Seiten zuerst überarbeiten: ${pageList}.`,
        `Im ersten Absatz einmal sagen, wer hier informiert – Marke plus Kategorie, z. B. „${own.name}, ${own.kind === 'portal' ? 'das Vergleichsportal für …' : 'die Lösung für …'}“. Überschriften bleiben sachlich, kein Markenname in jedem Titel.`,
        `Eigene Daten, Tabellen und Rechner als Werk von ${own.name} benennen (z. B. „${own.name}-Kostenvergleich ${d.at.getFullYear()}“) – zitierfähige Zahlen werden mit Quelle übernommen.`,
        `Title-Tag mit Marken-Suffix prüfen („… | ${own.name}“), wie im SEO üblich – nur ergänzen, wenn es fehlt.`,
        `Autorenkasten bzw. „Über ${own.name}“-Absatz mit einem gleichlautenden Satz zur Positionierung auf allen diesen Seiten.`,
      ],
    },
    // Wirkung belegt nur indirekt (Entitäts-Klarheit, zitierfähige eigene Daten) → höchstens mittel
    impact: 2,
    // vorhandene Seiten nachschärfen (die Schritte fokussieren auf die Top-5) – geringer Aufwand, hohe Wirkung
    effort: 1,
    reach: share,
    evidence: {
      metrics: { responses: ix.N, affected: affected.length, share, ownSiteResponses: usedTotal, pages: pages.length, prompts: promptIds.length },
      examples,
      promptIds,
      domain,
      urls: pages.slice(0, 10).map(([url, e]) => ({ url, title: titleFromUrl(url, e.title), count: e.resps.size })),
      prompts: promptIds.slice(0, 10).map((id) => ({ id, text: ix.promptText(id) })),
    },
    signature: { b: bucket(share), p: pages.slice(0, 3).map(([u]) => u) },
  })];
}

// ---------------------------------------------------------------------------
// outreach
// ---------------------------------------------------------------------------
export type OutreachExclusionReason = 'competitor' | 'vendor' | 'rival_portal' | 'community' | 'not_editorial' | 'below_threshold' | 'beyond_max';

/**
 * Art einer fremden Quelle – bestimmt, welche Ansprache realistisch ist (GEO-PLAYBOOK.md, „Auf anderen Seiten“):
 * reviews = Bewertungsportal (Profil anlegen, Bewertungen sammeln), comparison = Vergleichs-/Testportal (Listung beantragen –
 * für ein Vergleichsportal selbst: direkter Wettbewerber), media = Redaktion/Fachmedium (eigene Daten als Story anbieten),
 * site = sonstiger Ratgeber/Blog (Autor Fakten bzw. Daten anbieten).
 */
export type SourceKind = 'reviews' | 'comparison' | 'media' | 'site';
const REVIEW_SITES = /(^|\.)(g2\.com|capterra\.[a-z.]+|getapp\.[a-z.]+|softwareadvice\.[a-z.]+|omr\.com|trustpilot\.[a-z.]+|provenexpert\.com|trustedshops\.[a-z.]+|kununu\.com|trusted\.de|softguide\.de)$/;
const MEDIA_SITES = /(^|\.)(handelsblatt\.com|faz\.net|spiegel\.de|zeit\.de|sueddeutsche\.de|welt\.de|focus\.de|stern\.de|n-tv\.de|tagesschau\.de|wiwo\.de|capital\.de|manager-magazin\.de|businessinsider\.de|t3n\.de|heise\.de|golem\.de|chip\.de|computerbild\.de|netzwelt\.de|gruenderszene\.de|deutsche-startups\.de|impulse\.de|aerzteblatt\.de|aerztezeitung\.de|derstandard\.at|diepresse\.com|nzz\.ch|handelszeitung\.ch|computerwoche\.de|onlinehaendler-news\.de|wuv\.de|horizont\.net|finanztip\.de|test\.de|stiftung-warentest\.de|zm-online\.de|medical-tribune\.de|kma-online\.de|forbes\.com|techcrunch\.com)$/;
/** Domain klingt nach Vergleichs-/Test-/Kostenportal. Bewusst nur der Domainname: Ein Fachmagazin mit einem Vergleichsartikel ist kein Vergleichsportal. */
const COMPARISON_HOST = /(vergleich|compare|kompass|testsieger|testbericht|bestenliste|check24|verivox|mobiletransaction|kosten|tarif|rechner)/i;
export function sourceKindOf(host: string): SourceKind {
  if (REVIEW_SITES.test(host)) return 'reviews';
  if (MEDIA_SITES.test(host)) return 'media';
  if (COMPARISON_HOST.test(host.replace(/\.[a-z]+$/, ''))) return 'comparison';
  return 'site';
}
export interface OutreachExclusion { domain: string; responses: number; reason: OutreachExclusionReason; detail: string | null; text: string }
export const OUTREACH_MAX = 5;
/** Namen, die nach Ratgeber/Vergleich/Magazin klingen – keine Anbieter-Website */
const EDITORIAL_NAME = /(vergleich|kompass|ratgeber|magazin|journal|blog|news|portal|testsieger)/i;

/** Alle Quellen-Domains aus Antworten mit Wettbewerber (ohne eigene Marke) – mit Grund, warum es (k)eine Outreach-Maßnahme gibt. */
export function outreachExclusionsFrom(ix: Indexed, opts: { max?: number; minResponses?: number; lang?: Lang } = {}): OutreachExclusion[] {
  return outreachScan(ix, opts).excluded;
}

export function ruleOutreach(ix: Indexed, opts: { max?: number; minResponses?: number } = {}): Candidate[] {
  return outreachScan(ix, opts).candidates;
}

function outreachScan(ix: Indexed, opts: { max?: number; minResponses?: number; lang?: Lang } = {}): { candidates: Candidate[]; excluded: OutreachExclusion[] } {
  const own = ix.own;
  if (!own) return { candidates: [], excluded: [] };
  const max = opts.max ?? OUTREACH_MAX;
  const minResp = opts.minResponses ?? 2;
  // Antworten mit Wettbewerber, ohne eigene Marke
  const target = new Map<string, string[]>();
  for (const [rid, cs] of ix.compsByResp) {
    if (ix.ownNamed.has(rid)) continue;
    target.set(rid, uniq(cs.sort((a, b) => a.position - b.position).map((m) => ix.compById.get(m.brandId!)!.name)));
  }
  // Domains anderer (ungetrackter) Anbieter, die in den Antworten genannt werden (z. B. Blog eines Wettbewerbers) – kein Outreach-Ziel
  // nur Namen, die wahrscheinlich Anbieter sind (Urteil des Analyse-Modells bzw. Namensliste) – ein Portal, das die KI als „Marke“ nennt, bleibt Outreach-Ziel
  const vendorByKey = new Map<string, string>();
  for (const m of ix.ments) {
    if (m.brandId === own.id || !isLikelyCompetitor(m.name, m.isCompetitor)) continue;
    // Ratgeber-/Vergleichsseiten sind für Anbieter Outreach-Ziele, für ein Vergleichsportal Konkurrenz
    if (own.kind !== 'portal' && EDITORIAL_NAME.test(m.name)) continue;
    const k = brandKey(m.name);
    if (k.length >= 4 && !vendorByKey.has(k)) vendorByKey.set(k, m.name);
  }
  const vendorOf = (host: string) => {
    for (const l of hostLabels(host)) { const v = vendorByKey.get(l) ?? vendorByKey.get(l.replace(/\d+$/, '')); if (v) return v; }
    return null;
  };
  const excludedBy = new Map<string, { resps: Set<string>; reason: OutreachExclusionReason; detail: string | null }>();
  const exclude = (host: string, rid: string, reason: OutreachExclusionReason, detail: string | null) => {
    const e = excludedBy.get(host) ?? { resps: new Set(), reason, detail };
    e.resps.add(rid);
    excludedBy.set(host, e);
  };
  const by = new Map<string, { resps: Set<string>; urls: Map<string, { title: string | null; n: number }>; comps: Map<string, number>; prompts: Set<string> }>();
  for (const [rid, comps] of target) {
    const seenHosts = new Set<string>();
    for (const c of ix.metricCits.get(rid) ?? []) {
      const host = hostOf(c);
      if (!host || domainMatches(host, own.domains)) continue;
      const comp = ix.competitors.find((b) => domainMatches(host, b.domains));
      if (comp) { exclude(host, rid, 'competitor', comp.name); continue; }
      if (communityGroup(c.url)) { exclude(host, rid, 'community', null); continue; }
      if (NO_OUTREACH.some((re) => re.test(host))) { exclude(host, rid, 'not_editorial', null); continue; }
      const vendor = vendorOf(host);
      if (vendor) { exclude(host, rid, 'vendor', vendor); continue; }
      if (own.kind === 'portal' && sourceKindOf(host) === 'comparison') { exclude(host, rid, 'rival_portal', null); continue; }
      const e = by.get(host) ?? { resps: new Set(), urls: new Map(), comps: new Map(), prompts: new Set() };
      const u = cleanUrl(c.url);
      const ue = e.urls.get(u) ?? { title: c.title, n: 0 };
      if (!seenHosts.has(`${host}|${u}`)) { ue.n++; seenHosts.add(`${host}|${u}`); }
      ue.title ||= c.title;
      e.urls.set(u, ue);
      if (!e.resps.has(rid)) {
        e.resps.add(rid);
        e.prompts.add(ix.respById.get(rid)!.promptId);
        for (const n of comps) e.comps.set(n, (e.comps.get(n) ?? 0) + 1);
      }
      by.set(host, e);
    }
  }
  const minN = Math.max(minResp, Math.ceil(0.08 * ix.N));
  const sorted = [...by.entries()]
    .sort((a, b) => b[1].resps.size - a[1].resps.size || b[1].prompts.size - a[1].prompts.size || a[0].localeCompare(b[0]));
  const rows = sorted.filter(([, e]) => e.resps.size >= minN).slice(0, max);
  const reasonText = (r: OutreachExclusionReason, d: string | null) => (opts.lang === 'en' ? {
    competitor: `website of competitor ${d}`,
    vendor: `a vendor’s site (${d} is itself named as a vendor in the answers)`,
    rival_portal: 'another comparison site – a direct competitor, no realistic outreach',
    community: 'community/forum – see the Community actions',
    not_editorial: 'search engine, encyclopedia or authority – no editorial team to contact',
    below_threshold: `too rare (threshold: ${minN} answers)`,
    beyond_max: `not among the ${max} most important sources`,
  } : {
    competitor: `Website des Wettbewerbers ${d}`,
    vendor: `Seite eines Anbieters (${d} wird in den Antworten selbst als Anbieter genannt)`,
    rival_portal: 'anderes Vergleichsportal – direkter Wettbewerber, keine realistische Ansprache',
    community: 'Community/Forum – siehe Community-Maßnahmen',
    not_editorial: 'Suchmaschine, Lexikon oder Behörde – keine Redaktion, die man anschreiben kann',
    below_threshold: `zu selten (Schwelle: ${minN} Antworten)`,
    beyond_max: `nicht unter den ${max} wichtigsten Quellen`,
  })[r];
  const excluded: OutreachExclusion[] = [
    ...[...excludedBy.entries()].map(([domain, e]) => ({ domain, responses: e.resps.size, reason: e.reason, detail: e.detail })),
    ...sorted.filter(([h]) => !rows.some(([x]) => x === h)).map(([domain, e]) => ({
      domain, responses: e.resps.size, reason: (e.resps.size >= minN ? 'beyond_max' : 'below_threshold') as OutreachExclusionReason, detail: null,
    })),
  ].map((x) => ({ ...x, text: reasonText(x.reason, x.detail) })).sort((a, b) => b.responses - a.responses || a.domain.localeCompare(b.domain));
  const portal = own.kind === 'portal';
  const candidates = rows.map(([host, e]) => {
    const share = e.resps.size / ix.N;
    const comps = [...e.comps.entries()].sort((a, b) => b[1] - a[1]);
    const urls = [...e.urls.entries()].sort((a, b) => b[1].n - a[1].n);
    const engines = enginesOf(ix, e.resps);
    const examples: Example[] = [...e.resps].slice(0, 5).map((rid) => {
      const r = ix.respById.get(rid)!;
      const c = (ix.metricCits.get(rid) ?? []).find((x) => hostOf(x) === host)!;
      const comp = (ix.compsByResp.get(rid) ?? []).sort((a, b) => a.position - b.position)[0];
      return { prompt: ix.promptText(r.promptId), engine: r.engine, url: cleanUrl(c.url), title: titleFromUrl(c.url, c.title), snippet: comp?.snippet ? quote(comp.snippet) : undefined };
    });
    const compNames = comps.slice(0, 3).map(([n]) => n);
    const sk = sourceKindOf(host);
    const pages = urls.slice(0, 3).map(([u]) => shortPath(u)).join(', ');
    return make(ix.lang, {
      key: `outreach:${host}`,
      type: 'outreach',
      text: (l) => {
        const t = outreachText(sk, host, own.name, portal, pages, compNames, l);
        return l === 'en' ? {
          title: t.title,
          why: `${host} is a source in ${e.resps.size} of ${ix.N} answers that mention ${compNames[0] ?? 'competitors'} but not ${own.name}.`,
          steps: [...t.steps, `After it’s published, wait for the next measurement: does ${own.name} show up in answers that use ${host} as a source?`],
        } : {
          title: t.title,
          why: `${host} ist in ${e.resps.size} von ${ix.N} Antworten Quelle, die ${compNames[0] ?? 'Wettbewerber'} nennen, ${own.name} aber nicht.`,
          steps: [...t.steps, `Nach der Veröffentlichung die nächste Messung abwarten: Taucht ${own.name} in Antworten mit ${host} als Quelle auf?`],
        };
      },
      // Erfolg hängt von Dritten ab → hohe Wirkung erst ab großer Reichweite
      // Medien hängen von Journalisten ab → höchstens mittel; Bewertungsportale und Listungen liegen in eigener Hand
      impact: (sk === 'media' ? Math.min(2, share >= 0.1 ? 2 : 1) : share >= 0.3 ? 3 : share >= 0.1 ? 2 : 1) as 1 | 2 | 3,
      effort: sk === 'media' ? 3 : 2,
      reach: share,
      evidence: {
        sourceKind: sk,
        metrics: { responses: ix.N, affected: e.resps.size, share, prompts: e.prompts.size, competitorOnlyResponses: target.size },
        examples,
        promptIds: [...e.prompts],
        domain: host,
        urls: urls.slice(0, 8).map(([url, u]) => ({ url, title: titleFromUrl(url, u.title), count: u.n })),
        competitors: comps.map(([name, count]) => ({ name, count })),
        engines,
      },
      signature: { n: Math.min(e.resps.size, 10), c: compNames, u: urls.slice(0, 2).map(([u]) => u), sk, ...(own.kind ? { k: own.kind } : {}) },
    });
  });
  return { candidates, excluded };
}

/** Realistische Ansprache je Quellenart und Markentyp (Titel + Schritte ohne den Mess-Schritt). */
function outreachText(sk: SourceKind, host: string, brand: string, portal: boolean, pages: string, comps: string[], lang: Lang): { title: string; steps: string[] } {
  if (lang === 'en') return outreachTextEn(sk, host, brand, portal, pages, comps);
  const cmp = comps.length ? ` (dort genannt: ${listL(comps.slice(0, 3), 'de')})` : '';
  switch (sk) {
    case 'reviews':
      return {
        title: `Profil auf ${host} anlegen und Bewertungen sammeln`,
        steps: [
          `Prüfen, ob ${brand} auf ${host} schon ein Profil hat; falls nicht, kostenlos anlegen und vollständig ausfüllen (Beschreibung, Kategorie, Preise, Screenshots).`,
          `Zufriedene Kunden gezielt um eine ehrliche Bewertung bitten – z. B. 10 Anfragen per Mail nach einem erfolgreichen Projekt. Keine Bewertungen kaufen oder vorschreiben.`,
          `Auf Bewertungen sachlich antworten, auch auf kritische.`,
          `Das Profil von der eigenen Website und im Organization-Schema (sameAs) verlinken.`,
        ],
      };
    case 'comparison':
      // nur für Anbieter – Vergleichsportale schließen andere Vergleichsportale vorher aus
      return {
        title: `Bei ${host} als Anbieter listen lassen`,
        steps: [
          `Diese Seiten lesen: ${pages} – welche Anbieter stehen dort${cmp}, nach welchen Kriterien wird verglichen?`,
          `Herausfinden, wie Anbieter dort aufgenommen werden: Anbieter- oder Partnerformular, Affiliate-Programm oder bezahlte Listung (Impressum, „Für Anbieter“, Fußzeile).`,
          `Ein Datenblatt mit genau diesen Kriterien schicken (Preise, Konditionen, Zielgruppe, Besonderheiten) – Vergleichsportale brauchen Fakten, keine Werbetexte.`,
          `Kosten einer bezahlten Listung gegen die Reichweite abwägen: ${host} ist in den KI-Antworten eine häufige Quelle.`,
        ],
      };
    case 'media':
      return {
        title: portal ? `${host} eine eigene Auswertung als Story anbieten` : `${host} Daten oder ein Experten-Zitat anbieten`,
        steps: [
          `Diese Artikel lesen: ${pages} – welches Thema, welcher Autor, wie aktuell?`,
          portal
            ? `Aus den eigenen Vergleichsdaten eine Zahl mit Nachrichtenwert ableiten (z. B. „So viel zahlen kleine Läden 2026 für Kartenzahlung“) und als kurze Auswertung mit Methodik aufbereiten.`
            : `Etwas anbieten, das die Redaktion selbst nicht hat: eigene Zahlen (z. B. anonymisierte Kundendaten), ein Praxisbeispiel oder ein fachliches Zitat.`,
          `Den Autor bzw. das Ressort direkt anschreiben (Autorenzeile, LinkedIn) – kurz, mit Bezug auf einen konkreten Artikel, ohne Werbesprache.`,
          `Erwartung realistisch halten: Medien entscheiden selbst; lieber 5 passende Redaktionen ansprechen als eine.`,
        ],
      };
    default:
      return {
        title: portal ? `${host} eigene Vergleichsdaten als Quelle anbieten` : `${host}: Autor Fakten und Testzugang anbieten`,
        steps: [
          `Diese Seiten lesen: ${pages} – wer schreibt dort, welche Anbieter werden genannt${cmp}?`,
          portal
            ? `Dem Autor eine konkrete Ergänzung anbieten: aktuelle Gebühren- oder Kostentabelle aus dem ${brand}-Vergleich, frei verwendbar mit Quellenangabe.`
            : `Dem Autor kurz und sachlich schreiben, was ${brand} bietet und für wen – mit Testzugang und belegten Fakten, ohne Werbesprache.`,
          `Falls die Seite veraltet ist: auf neue Fakten hinweisen und eine Aktualisierung anregen.`,
          `Prüfen, ob die Seite Affiliate-Links nutzt – dann gibt es oft ein Partnerprogramm, über das eine Aufnahme realistischer ist.`,
        ],
      };
  }
}

function outreachTextEn(sk: SourceKind, host: string, brand: string, portal: boolean, pages: string, comps: string[]): { title: string; steps: string[] } {
  const cmp = comps.length ? ` (including ${listL(comps.slice(0, 3), 'en')})` : '';
  switch (sk) {
    case 'reviews':
      return {
        title: `Create a profile on ${host} and collect reviews`,
        steps: [
          `Check whether ${brand} already has a profile on ${host}; if not, create one for free and fill it in completely (description, category, pricing, screenshots).`,
          `Ask happy customers for an honest review – e.g. 10 emails after a successful project. Never buy or script reviews.`,
          `Reply to reviews in a factual tone, including critical ones.`,
          `Link the profile from your website and in your Organization schema (sameAs).`,
        ],
      };
    case 'comparison':
      return {
        title: `Get listed as a provider on ${host}`,
        steps: [
          `Read these pages: ${pages} – which providers are listed${cmp}, and what criteria are they compared on?`,
          `Find out how providers get added: a provider or partner form, an affiliate program or a paid listing (imprint, “for providers”, footer).`,
          `Send a data sheet covering exactly these criteria (pricing, terms, target group, special features) – comparison sites need facts, not marketing copy.`,
          `Weigh the cost of a paid listing against its reach: ${host} is a frequent source in AI answers.`,
        ],
      };
    case 'media':
      return {
        title: portal ? `Pitch your own analysis to ${host} as a story` : `Offer ${host} data or an expert quote`,
        steps: [
          `Read these articles: ${pages} – what topic, which author, how recent?`,
          portal
            ? `Pull a newsworthy number from your comparison data (e.g. “What small shops pay for card payments in 2026”) and package it as a short analysis with methodology.`
            : `Offer something the newsroom doesn’t have: your own numbers (e.g. anonymized customer data), a real-world example or an expert quote.`,
          `Contact the author or desk directly (byline, LinkedIn) – briefly, referring to a specific article, without marketing speak.`,
          `Keep expectations realistic: editors decide for themselves; better to approach 5 relevant newsrooms than one.`,
        ],
      };
    default:
      return {
        title: portal ? `Offer ${host} your comparison data as a source` : `${host}: offer the author facts and a test account`,
        steps: [
          `Read these pages: ${pages} – who writes there, and which providers are named${cmp}?`,
          portal
            ? `Offer the author a concrete addition: an up-to-date fee or cost table from the ${brand} comparison, free to use with attribution.`
            : `Write to the author briefly and factually about what ${brand} offers and for whom – with a test account and verifiable facts, no marketing speak.`,
          `If the page is outdated: point out the new facts and suggest an update.`,
          `Check whether the page uses affiliate links – then there’s often a partner program that makes being included more realistic.`,
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// content_gap
// ---------------------------------------------------------------------------
type PromptStat = { pid: string; n: number; own: number; withComp: number; withOthers: number; ownSite: number; missing: string[]; named: Map<string, number> };

export function promptStats(ix: Indexed): PromptStat[] {
  const out: PromptStat[] = [];
  const displayNames = new Map<string, string>(ix.competitors.map((b) => [normName(b.name), b.name]));
  for (const [pid, rs] of ix.respsByPrompt) {
    const st: PromptStat = { pid, n: rs.length, own: 0, withComp: 0, withOthers: 0, ownSite: 0, missing: [], named: new Map() };
    const engOwn = new Map<string, boolean>();
    for (const r of rs) {
      const owned = ix.ownNamed.has(r.id);
      if (owned) st.own++;
      if (ix.ownSiteResps.has(r.id)) st.ownSite++;
      engOwn.set(r.engine, (engOwn.get(r.engine) ?? false) || owned);
      const ms = ix.mentsByResp.get(r.id) ?? [];
      const others = ms.filter((m) => !ix.own || m.brandId !== ix.own.id);
      if (others.length) st.withOthers++;
      if (ix.compsByResp.has(r.id) && !owned) st.withComp++;
      if (!owned) {
        const seen = new Set<string>();
        for (const m of others) {
          // ungetrackte Nennungen nur, wenn wahrscheinlich Wettbewerber (keine Visa, girocard, Trustpilot …)
          if (!m.brandId && !isLikelyCompetitor(m.name, m.isCompetitor)) continue;
          const raw = m.brandId ? ix.compById.get(m.brandId)?.name ?? m.name : m.name.trim().replace(/\s+/g, ' ');
          const k = normName(raw);
          if (seen.has(k)) continue;
          seen.add(k);
          // gleiche Schreibweise für dieselbe Marke (girocard/Girocard)
          const name = displayNames.get(k) ?? raw;
          displayNames.set(k, name);
          st.named.set(name, (st.named.get(name) ?? 0) + 1);
        }
      }
    }
    st.missing = [...engOwn.entries()].filter(([, v]) => !v).map(([e]) => e);
    out.push(st);
  }
  return out;
}

/** Titelvorschlag ohne KI: Frage als H1, ergänzt um Jahr bzw. Vergleich. */
export function suggestTitle(promptText: string, year: number): string {
  const t = promptText.trim().replace(/\s+/g, ' ');
  const q = t.endsWith('?') ? t : /^(welche|wie|was|wo|wann|warum|wer|lohnt|ist|sind|kann|what|which|how|where|when|why|who|is|are|can|should|does|do)\b/i.test(t) ? `${t}?` : t;
  return /\b20\d\d\b/.test(q) ? q : `${q} (${year})`;
}

export const CONTENT_GAP_MAX = 10;

export function ruleContentGap(ix: Indexed, d: RecData): Candidate[] {
  const own = ix.own;
  if (!own) return [];
  const year = d.at.getFullYear();
  const out: Candidate[] = [];
  // jede eigene Seite höchstens einer Frage zuordnen (eine Seite kann nicht auf mehrere Fragen ausgerichtet werden)
  const assigned = new Set<string>();
  const stats = promptStats(ix).sort((a, b) => b.withComp / b.n - a.withComp / a.n || a.own - b.own || a.pid.localeCompare(b.pid));
  for (const st of stats) {
    const ownRate = st.own / st.n;
    // eigene Marke fehlt (fast) überall, Wettbewerber werden genannt
    if (ownRate > 0.2 || st.withComp < 2) continue;
    // eigene Seite wird hier schon oft genutzt → das ist ein name_on_own_page-Thema, keine Inhaltslücke
    if (st.ownSite / st.n >= 0.4) continue;
    const text = ix.promptText(st.pid);
    const rs = ix.respsByPrompt.get(st.pid) ?? [];
    const named = [...st.named.entries()].sort((a, b) => b[1] - a[1]);
    const comps = named.filter(([n]) => ix.competitors.some((b) => b.name === n)).slice(0, 4).map(([n]) => n);
    const others = named.filter(([n]) => !comps.includes(n)).slice(0, 3).map(([n]) => n);
    // eigene Seiten, die bei dieser Frage herangezogen wurden – als Quelle genutzte zuerst
    const pageCount = new Map<string, number>();
    for (const r of rs) {
      for (const c of ix.allCits.get(r.id) ?? []) {
        if (!domainMatches(hostOf(c), own.domains)) continue;
        const u = cleanUrl(c.url);
        const used = (ix.metricCits.get(r.id) ?? []).includes(c);
        pageCount.set(u, (pageCount.get(u) ?? 0) + (used ? 10 : 1));
      }
    }
    const ownPages = [...pageCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([u]) => u);
    const basePage = ownPages.find((u) => !assigned.has(u)) ?? null;
    if (basePage) assigned.add(basePage);
    const title = suggestTitle(text, year);
    const examples: Example[] = rs.filter((r) => !ix.ownNamed.has(r.id) && ix.compsByResp.has(r.id)).slice(0, 5).map((r) => {
      const m = (ix.compsByResp.get(r.id) ?? []).sort((a, b) => a.position - b.position)[0];
      const src = (ix.metricCits.get(r.id) ?? [])[0];
      return { prompt: text, engine: r.engine, snippet: m?.snippet ? quote(m.snippet) : undefined, url: src ? cleanUrl(src.url) : undefined };
    });
    const alts = comps.length ? comps : others;
    out.push(make(ix.lang, {
      key: `content_gap:${st.pid}`,
      type: 'content_gap',
      text: (l) => l === 'en' ? {
        title: `${basePage ? 'Expand' : 'Create'} a page on “${q(text, 44)}”`,
        why: `For this question, ${st.withComp} of ${st.n} answers name ${listL(alts.slice(0, 2), 'en')} – ${own.name} ${st.own === 1 ? 'only once' : st.own ? `only ${st.own} times` : 'never'}.`,
        steps: [
          `${basePage ? `Align the existing page ${shortPath(basePage)} with this question` : `Create a dedicated page that answers exactly this question${ownPages.length ? ` (and link to it from ${shortPath(ownPages[0])})` : ''}`} – suggested title: “${title}”.`,
          'Open with a clear answer in two or three sentences, then add details, a comparison table and FAQs.',
          `Work ${own.name} explicitly into the answer – with verifiable facts (e.g. pricing, features, target group) and a clear statement of when ${own.name} is the right choice.`,
          `Include the alternatives that get named (${listL(alts.slice(0, 3), 'en')}) fairly – AI prefers balanced sources.`,
          'Link to the page from relevant existing pages.',
        ],
      } : {
        title: `Seite zu „${q(text, 44)}“ ${basePage ? 'ausbauen' : 'erstellen'}`,
        why: `Bei dieser Frage nennen ${st.withComp} von ${st.n} Antworten ${listL(alts.slice(0, 2), 'de')}, ${own.name} ${st.own === 1 ? 'nur einmal' : st.own ? `nur ${st.own}-mal` : 'nie'}.`,
        steps: [
          `${basePage ? `Bestehende Seite ${shortPath(basePage)} gezielt auf diese Frage ausrichten` : `Eine eigene Seite anlegen, die genau diese Frage beantwortet${ownPages.length ? ` (und von ${shortPath(ownPages[0])} aus verlinken)` : ''}`} – Titelvorschlag: „${title}“.`,
          'Gleich am Anfang eine klare Antwort in zwei bis drei Sätzen geben, danach Details, eine Vergleichstabelle und häufige Fragen.',
          `${own.name} ausdrücklich in die Antwort einbinden – mit überprüfbaren Fakten (z. B. Preise, Leistungen, Zielgruppe) und einer klaren Aussage, wann ${own.name} weiterhilft.`,
          `Die genannten Alternativen (${listL(alts.slice(0, 3), 'de')}) fair einbeziehen – KIs bevorzugen ausgewogene Quellen.`,
          'Die Seite von passenden bestehenden Seiten aus verlinken.',
        ],
      },
      impact: ownRate === 0 && st.withComp / st.n >= 0.6 ? 3 : 2,
      effort: basePage ? 2 : 3,
      // Reichweite: Anteil aller Antworten, die diese Lücke betrifft (ein Prompt von vielen)
      reach: st.withComp / ix.N,
      evidence: {
        metrics: { responses: st.n, ownNamed: st.own, competitorOnly: st.withComp, ownSiteUsed: st.ownSite, totalResponses: ix.N },
        examples,
        promptIds: [st.pid],
        prompts: [{ id: st.pid, text, missing: st.missing }],
        competitors: named.slice(0, 6).map(([name, count]) => ({ name, count })),
        titleSuggestion: title,
        basePage,
        ownPages: ownPages.slice(0, 3),
      },
      signature: { o: st.own, c: Math.min(st.withComp, st.n), m: st.missing.length, b: basePage },
    }));
  }
  // höchstens CONTENT_GAP_MAX Fragen – die wichtigsten zuerst (mehr Seiten auf einmal setzt ohnehin niemand um)
  return out.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)).slice(0, CONTENT_GAP_MAX);
}

// ---------------------------------------------------------------------------
// community
// ---------------------------------------------------------------------------
export function ruleCommunity(ix: Indexed, opts: { max?: number } = {}): Candidate[] {
  const own = ix.own;
  if (!own) return [];
  const weakPrompts = new Set(promptStats(ix).filter((s) => s.own / s.n < 0.5).map((s) => s.pid));
  const groups = new Map<string, {
    g: ReturnType<typeof communityGroup> & {}; resps: Set<string>; cited: Set<string>; prompts: Set<string>;
    threads: Map<string, { title: string | null; n: number; cited: boolean }>;
  }>();
  for (const c of ix.cits) {
    const r = ix.respById.get(c.responseId);
    if (!r || !weakPrompts.has(r.promptId)) continue;
    const g = communityGroup(c.url);
    if (!g) continue;
    const key = `${g.kind}:${g.id}`;
    const e = groups.get(key) ?? { g, resps: new Set(), cited: new Set(), prompts: new Set(), threads: new Map() };
    e.resps.add(r.id);
    e.prompts.add(r.promptId);
    if (c.kind === 'cited') e.cited.add(r.id);
    const u = cleanUrl(c.url);
    const t = e.threads.get(u) ?? { title: c.title, n: 0, cited: false };
    t.n++; t.title ||= c.title; t.cited ||= c.kind === 'cited';
    e.threads.set(u, t);
    groups.set(key, e);
  }
  const rows = [...groups.entries()].filter(([, e]) => e.resps.size >= 2 || e.threads.size >= 2)
    .sort((a, b) => b[1].resps.size - a[1].resps.size || a[0].localeCompare(b[0])).slice(0, opts.max ?? 3);
  return rows.map(([key, e]) => {
    const share = e.resps.size / ix.N;
    const engines = enginesOf(ix, e.resps);
    const threads = [...e.threads.entries()].sort((a, b) => b[1].n - a[1].n || Number(!!b[1].title) - Number(!!a[1].title) || a[0].localeCompare(b[0]));
    const readOnly = e.resps.size - e.cited.size;
    // Beispiel-Prompt: der mit den meisten betroffenen Antworten
    const pCount = new Map<string, number>();
    for (const rid of e.resps) { const pid = ix.respById.get(rid)!.promptId; pCount.set(pid, (pCount.get(pid) ?? 0) + 1); }
    const prompts = [...pCount.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => ix.promptText(id));
    const examples: Example[] = threads.slice(0, 5).map(([url, t]) => {
      const c = ix.cits.find((x) => cleanUrl(x.url) === url && e.resps.has(x.responseId))!;
      const r = ix.respById.get(c.responseId)!;
      return { prompt: ix.promptText(r.promptId), engine: r.engine, url, title: titleFromUrl(url, t.title) };
    });
    const base = {
      key: `community:${key}`, type: 'community' as const, reach: share, effort: 2 as const,
      impact: (share >= 0.1 ? 2 : 1) as 1 | 2,
      evidence: {
        metrics: { responses: ix.N, affected: e.resps.size, cited: e.cited.size, readOnly, threads: e.threads.size, prompts: e.prompts.size },
        examples,
        promptIds: [...e.prompts],
        source: e.g.label,
        urls: threads.slice(0, 8).map(([url, t]) => ({ url, title: titleFromUrl(url, t.title), count: t.n, kind: t.cited ? 'cited' as const : 'searched' as const })),
        prompts: [...e.prompts].slice(0, 5).map((id) => ({ id, text: ix.promptText(id) })),
        engines,
      },
      signature: { n: Math.min(e.resps.size, 10), t: threads.slice(0, 2).map(([u]) => u) },
    };
    const threadList = threads.slice(0, 3).map(([u, t]) => `„${titleFromUrl(u, t.title)}“`).join(', ');
    const threadListEn = threads.slice(0, 3)
      .map(([u, t]) => `“${titleFromUrl(u, t.title).replace(/^YouTube-Video /, 'YouTube video ').replace(/^YouTube-Kanal /, 'YouTube channel ')}”`).join(', ');
    if (e.g.kind === 'reddit') {
      return make(ix.lang, {
        ...base,
        text: (l) => l === 'en' ? {
          title: e.g.id === 'reddit' ? 'Join the conversation on Reddit – helpfully' : `Join the conversation in ${e.g.label} – helpfully`,
          why: `AI reads ${e.g.label} in ${e.resps.size} of ${ix.N} answers – for questions where ${own.name} barely appears.`,
          steps: [
            `Read these threads: ${threadListEn}. Which questions, objections and recommendations come up?`,
            `Reply factually from a personal account and disclose that you work for ${own.name} – help first, and only link when the link truly answers the question.`,
            `Read the rules of ${e.g.label} first; no fake accounts, bought upvotes or promotional posts – astroturfing breaks Reddit’s rules and hurts the brand.`,
            'Also answer recurring questions from the threads on your own website (FAQ or guide).',
          ],
        } : {
          title: e.g.id === 'reddit' ? 'Auf Reddit hilfreich mitdiskutieren' : `In ${e.g.label} hilfreich mitdiskutieren`,
          why: `Die KIs lesen ${e.g.label} in ${e.resps.size} von ${ix.N} Antworten mit – bei Fragen, in denen ${own.name} kaum vorkommt.`,
          steps: [
            `Diese Threads lesen: ${threadList}. Welche Fragen, Einwände und Empfehlungen tauchen auf?`,
            `Mit einem persönlichen Konto sachlich antworten und offenlegen, dass du für ${own.name} arbeitest – erst helfen, nur verlinken, wenn der Link die Frage wirklich beantwortet.`,
            `Vorher die Regeln von ${e.g.label} lesen; keine Fake-Konten, gekauften Upvotes oder Werbeposts – Astroturfing verstößt gegen die Reddit-Regeln und schadet der Marke.`,
            'Wiederkehrende Fragen aus den Threads zusätzlich auf der eigenen Website beantworten (FAQ oder Ratgeber).',
          ],
        },
      });
    }
    if (e.g.kind === 'youtube') {
      return make(ix.lang, {
        ...base,
        text: (l) => l === 'en' ? {
          title: 'Publish YouTube explainer videos on these questions',
          why: `YouTube videos feed into ${e.resps.size} of ${ix.N} answers – for questions where ${own.name} barely appears.`,
          steps: [
            `Watch these videos: ${threadListEn} – what do they show, what’s missing?`,
            `Produce a short explainer video on the question “${prompts[0]}”, with a clear answer in the first 30 seconds.`,
            'Phrase the title and description like the question, add chapters and upload a full transcript or subtitles – AI evaluates the text.',
            'Embed the video on the matching page of your website.',
          ],
        } : {
          title: 'Erklärvideos auf YouTube zu diesen Fragen veröffentlichen',
          why: `YouTube-Videos fließen in ${e.resps.size} von ${ix.N} Antworten ein – bei Fragen, in denen ${own.name} kaum vorkommt.`,
          steps: [
            `Diese Videos ansehen: ${threadList} – was wird gezeigt, was fehlt?`,
            `Ein kurzes Erklärvideo zur Frage „${prompts[0]}“ produzieren, mit klarer Antwort in den ersten 30 Sekunden.`,
            'Titel und Beschreibung wie die Frage formulieren, Kapitelmarken setzen und ein vollständiges Transkript bzw. Untertitel hochladen – KIs werten den Text aus.',
            'Das Video auf der passenden Seite der eigenen Website einbetten.',
          ],
        },
      });
    }
    return make(ix.lang, {
      ...base,
      text: (l) => l === 'en' ? {
        title: `Answer questions in the ${e.g.label} forum`,
        why: `Posts from ${e.g.label} feed into ${e.resps.size} of ${ix.N} answers – for questions where ${own.name} barely appears.`,
        steps: [
          `Read these posts: ${threadListEn}.`,
          `Reply with expertise from an account that openly names ${own.name} as your employer – no marketing speak, following the forum rules.`,
          'Answer frequent questions from the forum in depth on your own website.',
        ],
      } : {
        title: `Im Forum ${e.g.label} Fragen beantworten`,
        why: `Beiträge aus ${e.g.label} fließen in ${e.resps.size} von ${ix.N} Antworten ein – bei Fragen, in denen ${own.name} kaum vorkommt.`,
        steps: [
          `Diese Beiträge lesen: ${threadList}.`,
          `Mit einem Konto, das ${own.name} offen als Arbeitgeber nennt, fachlich antworten – ohne Werbesprache und gemäß Forenregeln.`,
          'Häufige Fragen aus dem Forum auf der eigenen Website ausführlich beantworten.',
        ],
      },
    });
  });
}

// ---------------------------------------------------------------------------
// technical
// ---------------------------------------------------------------------------
/** Crawler, die Inhalte für Antworten abrufen (Suche bzw. Abruf im Auftrag der Nutzer) */
const ANSWER_BOTS: string[] = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Googlebot'];
/** reine Trainings-Crawler */
const TRAINING_BOTS: string[] = ['GPTBot', 'ClaudeBot'];
const SCHEMA_TYPES = ['Organization', 'Corporation', 'LocalBusiness', 'Product', 'SoftwareApplication', 'Service', 'FAQPage', 'WebSite',
  'Dentist', 'Physician', 'MedicalBusiness', 'MedicalClinic', 'MedicalOrganization', 'ProfessionalService', 'Store', 'OnlineStore', 'OnlineBusiness',
  'Restaurant', 'FinancialService', 'InsuranceAgency', 'EducationalOrganization', 'NGO', 'NewsMediaOrganization', 'WebApplication', 'MobileApplication'];
const isEntitySchema = (t: string) => SCHEMA_TYPES.includes(t) || /(Organization|Business|Service|Store)$/.test(t);

export function ruleTechnical(ix: Indexed, checks: SiteCheckResult[] | undefined): Candidate[] {
  const own = ix.own;
  if (!own || !checks?.length) return [];
  // Domains, die auf eine andere eigene Domain weiterleiten, nicht doppelt bewerten (gleiche Startseite)
  const ok = checks.filter((c) => {
    if (c.home.status === null || c.home.status >= 400) return false;
    const target = c.home.finalUrl ? hostOf({ url: c.home.finalUrl, domain: '' }) : c.domain;
    return !target || domainMatches(target, [c.domain]) || !checks.some((x) => x !== c && domainMatches(target, [x.domain]));
  });
  const out: Candidate[] = [];
  const ownSiteShare = ix.N ? ix.ownSiteResps.size / ix.N : 0;
  const metricsBase = { responses: ix.N, ownSiteResponses: ix.ownSiteResps.size, ownSiteShare };
  const domainsOf = (cs: SiteCheckResult[]) => cs.map((c) => c.domain);

  const blocked = checks.filter((c) => c.robots.found && c.robots.blocked.length);
  if (blocked.length) {
    const bots = uniq(blocked.flatMap((c) => c.robots.blocked));
    const answerBots = bots.filter((b) => ANSWER_BOTS.includes(b));
    const gemini = bots.includes('Google-Extended');
    const training = bots.filter((b) => TRAINING_BOTS.includes(b));
    // Domain leitet auf eine andere eigene Domain weiter, deren robots.txt die Bots erlaubt → Sperre wirkt nur auf Links zur alten Domain
    const redirectNotes: string[] = [];
    const redirectNotesEn: string[] = [];
    let allRedirected = true;
    for (const c of blocked) {
      const target = c.home.finalUrl ? hostOf({ url: c.home.finalUrl, domain: '' }) : '';
      const tc = checks.find((x) => x !== c && target && domainMatches(target, [x.domain]));
      if (target && !domainMatches(target, [c.domain]) && tc && !tc.robots.blocked.some((b) => c.robots.blocked.includes(b))) {
        redirectNotes.push(`${c.domain} leitet auf ${target} weiter, wo diese Crawler erlaubt sind – die Sperre betrifft nur Links, die noch auf ${c.domain} zeigen.`);
        redirectNotesEn.push(`${c.domain} redirects to ${target}, where these crawlers are allowed – the block only affects links that still point to ${c.domain}.`);
      } else allRedirected = false;
    }
    const level = answerBots.length ? 3 : gemini ? 2 : 1;
    const impact = Math.max(1, level - (allRedirected ? 1 : 0)) as 1 | 2 | 3;
    const cloudflare = blocked.some((c) => c.robots.managedBy === 'cloudflare');
    const consequenceOf = (l: Lang) => (l === 'en'
      ? answerBots.length
        ? `This means ${listL(answerBots, 'en')} can’t fetch the pages – they’re missing as a source in the answers.`
        : gemini
          ? `The search crawlers of ChatGPT, Claude and Perplexity are allowed. Google-Extended, however, controls whether Gemini may use the content for answers (grounding)${training.length ? `; ${listL(training, 'en')} only affect model training` : ''}.`
          : `The search crawlers are allowed; only training crawlers are blocked. That doesn’t affect web search, but in the long run it affects what the models know about ${own.name} without searching.`
      : answerBots.length
        ? `Damit können ${listL(answerBots, 'de')} die Seiten nicht abrufen – sie fehlen als Quelle in den Antworten.`
        : gemini
          ? `Die Such-Crawler von ChatGPT, Claude und Perplexity dürfen zugreifen. Google-Extended steuert aber, ob Gemini die Inhalte für Antworten (Grounding) nutzen darf${training.length ? `; ${listL(training, 'de')} betreffen nur das Training der Modelle` : ''}.`
          : `Die Such-Crawler dürfen zugreifen; gesperrt sind nur Trainings-Crawler. Das beeinflusst nicht die Websuche, aber langfristig, was die Modelle ohne Suche über ${own.name} wissen.`);
    const robotsUrls = blocked.map((c) => `https://${c.domain}/robots.txt`).join(', ');
    out.push(make(ix.lang, {
      key: 'technical:robots', type: 'technical',
      text: (l) => l === 'en' ? {
        title: answerBots.length
          ? 'Allow AI search crawlers in robots.txt'
          : `Review the robots.txt block for ${gemini ? 'Gemini and training crawlers' : 'training crawlers'}`,
        why: answerBots.length
          ? `robots.txt blocks ${listL(answerBots.slice(0, 2), 'en')}${answerBots.length > 2 ? ' and others' : ''} – their AI search can’t fetch the pages.`
          : `robots.txt blocks ${listL(bots.slice(0, 3), 'en')}; the search crawlers are allowed.`,
        steps: [
          `Look at robots.txt: ${robotsUrls}.`,
          cloudflare
            ? 'The file is managed by Cloudflare (“Managed robots.txt” or AI Crawl Control) – change the setting in the Cloudflare dashboard, not the file itself.'
            : `Remove the Disallow rule for the bots you want, or set “Allow: /”.`,
          answerBots.length
            ? 'Allow at least the search bots OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot and Googlebot – they decide visibility in answers.'
            : `Decide deliberately: ${[gemini ? 'allow Google-Extended if Gemini should use the content for answers' : '', training.length ? `training crawlers (${training.join(', ')}) can stay blocked if that’s intended` : ''].filter(Boolean).join('; ')}.`,
          'Note: Google AI Overviews and AI Mode follow Googlebot, not Google-Extended.',
        ],
      } : {
        title: answerBots.length
          ? 'KI-Such-Crawler in der robots.txt freigeben'
          : `robots.txt-Sperre für ${gemini ? 'Gemini und Trainings-Crawler' : 'Trainings-Crawler'} prüfen`,
        why: answerBots.length
          ? `Die robots.txt sperrt ${listL(answerBots.slice(0, 2), 'de')}${answerBots.length > 2 ? ' u. a.' : ''} – deren KI-Suchen können die Seiten nicht abrufen.`
          : `Die robots.txt sperrt ${listL(bots.slice(0, 3), 'de')}; die Such-Crawler dürfen zugreifen.`,
        steps: [
          `robots.txt ansehen: ${robotsUrls}.`,
          cloudflare
            ? 'Die Datei wird von Cloudflare verwaltet („Managed robots.txt“ bzw. AI Crawl Control) – die Einstellung im Cloudflare-Dashboard anpassen, nicht die Datei selbst.'
            : `Für die gewünschten Bots die Disallow-Regel entfernen oder „Allow: /“ setzen.`,
          answerBots.length
            ? 'Mindestens die Such-Bots OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot und Googlebot zulassen – sie entscheiden über die Sichtbarkeit in Antworten.'
            : `Bewusst entscheiden: ${[gemini ? 'Google-Extended freigeben, wenn Gemini die Inhalte für Antworten nutzen soll' : '', training.length ? `Trainings-Crawler (${training.join(', ')}) dürfen gesperrt bleiben, wenn das gewollt ist` : ''].filter(Boolean).join('; ')}.`,
          'Hinweis: Google AI Overviews und AI Mode richten sich nach Googlebot, nicht nach Google-Extended.',
        ],
      },
      impact, effort: 1, reach: allRedirected ? 0.1 : level === 3 ? 1 : level === 2 ? 0.4 : 0.2,
      evidence: {
        metrics: { ...metricsBase, blockedBots: bots.length, blockedAnswerBots: answerBots.length },
        // ausführliche Einordnung für Detailansicht und Claude-Prompt: redirects/consequence in der Workspace-Sprache, *ByLang in allen
        examples: [], domains: domainsOf(blocked), blockedBots: bots, answerBots, managedBy: cloudflare ? 'cloudflare' : null,
        redirects: ix.lang === 'en' ? redirectNotesEn : redirectNotes, redirectsByLang: { de: redirectNotes, en: redirectNotesEn },
        consequence: consequenceOf(ix.lang), consequenceByLang: { de: consequenceOf('de'), en: consequenceOf('en') },
      },
      signature: { bots: [...bots].sort(), r: allRedirected },
    }));
  }

  const lowText = ok.filter((c) => (c.home.textChars ?? 0) < 500);
  if (lowText.length) {
    const minChars = Math.min(...lowText.map((c) => c.home.textChars ?? 0));
    out.push(make(ix.lang, {
      key: 'technical:js_text', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Make your content available without JavaScript',
        why: `Without JavaScript, the home page shows only ${minChars} characters of text – many AI crawlers can’t see the content.`,
        steps: [
          'Check with your developers whether the pages can be rendered on the server or pre-rendered (SSR/SSG).',
          'Test it: open the page in a browser with JavaScript disabled – headings, text and prices must be visible.',
          'Serve at least the most important pages (home, product, pricing, guides) as HTML with text.',
        ],
      } : {
        title: 'Inhalte ohne JavaScript auslieferbar machen',
        why: `Ohne JavaScript zeigt die Startseite nur ${minChars} Zeichen Text – viele KI-Crawler sehen die Inhalte nicht.`,
        steps: [
          'Mit der Entwicklung klären, ob die Seiten serverseitig gerendert oder vorgerendert werden können (SSR/SSG).',
          'Prüfen: Seite mit deaktiviertem JavaScript im Browser öffnen – Überschriften, Texte und Preise müssen sichtbar sein.',
          'Mindestens die wichtigsten Seiten (Startseite, Produkt, Preise, Ratgeber) als HTML mit Text ausliefern.',
        ],
      },
      impact: 3, effort: 3, reach: 1,
      evidence: { metrics: { ...metricsBase, minTextChars: Math.min(...lowText.map((c) => c.home.textChars ?? 0)) }, examples: [], domains: domainsOf(lowText) },
      signature: { d: domainsOf(lowText) },
    }));
  }

  const noSchema = ok.filter((c) => !c.home.jsonLd.some(isEntitySchema));
  if (noSchema.length) {
    out.push(make(ix.lang, {
      key: 'technical:structured_data', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Add your company details as Organization schema',
        why: 'The home page has no Organization schema – not a direct lever for citations, but it helps AI identify the brand unambiguously.',
        steps: [
          `Organization schema (JSON-LD) on the home page: name “${own.name}”, logo, URL, contact, sameAs (LinkedIn, review profiles, Wikidata if available).`,
          'Keep the description in the schema identical to your About page and profiles.',
          'Validate it with validator.schema.org.',
          'Keep expectations realistic: tests show no measurable citation effect from adding schema later – it’s basic hygiene, not a lever.',
        ],
      } : {
        title: 'Unternehmensdaten als Organization-Schema hinterlegen',
        why: 'Der Startseite fehlt ein Organization-Schema – kein direkter Hebel für Zitate, hilft KIs aber, die Marke eindeutig zuzuordnen.',
        steps: [
          `Organization-Schema (JSON-LD) auf der Startseite: Name „${own.name}“, Logo, URL, Kontakt, sameAs (LinkedIn, Bewertungsprofile, Wikidata falls vorhanden).`,
          'Die Beschreibung im Schema gleichlautend zur Über-uns-Seite und zu den Profilen halten.',
          'Mit validator.schema.org prüfen.',
          'Erwartung realistisch halten: Tests zeigen keinen messbaren Zitations-Effekt durch nachträgliches Schema – das ist Grundpflege, kein Hebel.',
        ],
      },
      impact: 1, effort: 1, reach: 0.2,
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf(noSchema), jsonLdFound: uniq(noSchema.flatMap((c) => c.home.jsonLd)) },
      signature: { d: domainsOf(noSchema) },
    }));
  }

  // llms.txt: bewusst keine Maßnahme – kein KI-Anbieter nutzt sie nachweislich (Ahrefs 2026, Google: nicht unterstützt).

  const blockedHome = checks.filter((c) => c.home.status !== null && [401, 403, 429, 503].includes(c.home.status));
  if (blockedHome.length) {
    const statuses = blockedHome.map((c) => c.home.status).join('/');
    out.push(make(ix.lang, {
      key: 'technical:bot_protection', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Check your bot protection for blocks on AI crawlers',
        why: `The home page rejects automated requests (HTTP ${statuses}) – possibly AI crawlers too.`,
        steps: [
          'Check your firewall/CDN (e.g. Cloudflare “AI Scrapers and Crawlers”) for rules that block AI bots.',
          'Explicitly allow the search bots OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User and PerplexityBot.',
        ],
      } : {
        title: 'Bot-Schutz auf Sperren für KI-Crawler prüfen',
        why: `Die Startseite weist automatische Abrufe ab (HTTP ${statuses}) – womöglich auch KI-Crawler.`,
        steps: [
          'In Firewall/CDN (z. B. Cloudflare „AI Scrapers and Crawlers“) prüfen, ob KI-Bots blockiert werden.',
          'Die Such-Bots OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User und PerplexityBot gezielt zulassen.',
        ],
      },
      impact: 2, effort: 1, reach: 0.5,
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf(blockedHome), statuses: blockedHome.map((c) => c.home.status) },
      signature: { d: domainsOf(blockedHome) },
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// positioning
// ---------------------------------------------------------------------------
export function rulePositioning(ix: Indexed, opts: { minResponses?: number } = {}): Candidate[] {
  const own = ix.own;
  if (!own || !ix.competitors.length) return [];
  // nur Antworten, in denen beide genannt werden (fehlt die eigene Marke, ist das eine Lücke, keine Positionierung)
  const stats = new Map<string, { ahead: Set<string>; recAhead: Set<string>; both: number; ownAhead: number; without: number; snippets: { rid: string; text: string; rec: boolean }[] }>();
  for (const [rid, comps] of ix.compsByResp) {
    const ownM = (ix.mentsByResp.get(rid) ?? []).find((m) => m.brandId === own.id);
    for (const m of comps) {
      const s = stats.get(m.brandId!) ?? { ahead: new Set(), recAhead: new Set(), both: 0, ownAhead: 0, without: 0, snippets: [] };
      if (!ownM) { s.without++; continue; }
      s.both++;
      if (ownM.position < m.position) s.ownAhead++;
      if (m.position < ownM.position) {
        s.ahead.add(rid);
        if (m.recommended) s.recAhead.add(rid);
        if (m.snippet?.trim()) s.snippets.push({ rid, text: m.snippet, rec: m.recommended });
      }
      stats.set(m.brandId!, s);
    }
  }
  // Positionierung setzt voraus, dass die eigene Marke überhaupt im Vergleich vorkommt (sonst: Lücke, nicht Positionierung)
  if (ix.ownNamed.size < Math.max(3, 0.1 * ix.N)) return [];
  const ranked = [...stats.entries()].filter(([, x]) => x.both >= 2)
    .sort((a, b) => b[1].ahead.size - a[1].ahead.size || b[1].recAhead.size - a[1].recAhead.size);
  const top = ranked[0];
  if (!top || top[1].ahead.size < (opts.minResponses ?? 2)) return [];
  const [cid, s] = top;
  const comp = ix.compById.get(cid)!;
  const share = s.ahead.size / ix.N;
  const seen = new Set<string>();
  // aussagekräftige Begründungen zuerst: empfohlen, nennt den Wettbewerber, ausreichend lang
  const score = (x: { text: string; rec: boolean }) => Number(x.rec) * 4 + Number(x.text.toLowerCase().includes(comp.name.toLowerCase())) * 2
    + Number(x.text.length >= 50) * 2 - Number(x.text.length > 260);
  const snippets = s.snippets.sort((a, b) => score(b) - score(a)).filter((x) => {
    const k = normName(x.text).slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const examples: Example[] = snippets.slice(0, 5).map((x) => {
    const r = ix.respById.get(x.rid)!;
    return { prompt: ix.promptText(r.promptId), engine: r.engine, snippet: quote(x.text, 200) };
  });
  const ownSnips = ix.ments.filter((m) => m.brandId === own.id && m.snippet).slice(0, 3).map((m) => {
    const r = ix.respById.get(m.responseId)!;
    return { prompt: ix.promptText(r.promptId), engine: r.engine, snippet: quote(m.snippet!, 200) };
  });
  const promptIds = uniq([...s.ahead].map((rid) => ix.respById.get(rid)!.promptId));
  return [make(ix.lang, {
    key: `positioning:${normName(comp.name)}`,
    type: 'positioning',
    text: (l) => l === 'en' ? {
      title: `Position ${own.name} clearly against ${comp.name}`,
      why: `${comp.name} comes before ${own.name} in ${s.ahead.size} of ${s.both} shared answers${s.recAhead.size ? ` and is recommended ${s.recAhead.size === 1 ? 'once' : `${s.recAhead.size} times`}` : ''}.`,
      steps: [
        `Collect the reasons AI gives for ${comp.name} (see evidence) and honestly check where ${own.name} is as good or better.`,
        `Publish a fair comparison page “${own.name} vs. ${comp.name}”: a table with pricing, features and target group, and a clear statement of who ${own.name} is the better choice for.`,
        `Phrase your strengths as short, quotable sentences and use them consistently on your home page, pricing page and FAQ.`,
        `Collect testimonials and reviews on the sites where ${comp.name} gets praised.`,
      ],
    } : {
      title: `${own.name} klar gegen ${comp.name} positionieren`,
      why: `${comp.name} steht in ${s.ahead.size} von ${s.both} gemeinsamen Antworten vor ${own.name}${s.recAhead.size ? ` und wird ${s.recAhead.size === 1 ? 'einmal' : `${s.recAhead.size}-mal`} empfohlen` : ''}.`,
      steps: [
        `Die Gründe sammeln, die die KIs für ${comp.name} nennen (siehe Belege), und ehrlich prüfen, wo ${own.name} gleichwertig oder besser ist.`,
        `Eine faire Vergleichsseite „${own.name} vs. ${comp.name}“ veröffentlichen: Tabelle mit Preisen, Funktionen und Zielgruppe, klare Aussage, für wen ${own.name} die bessere Wahl ist.`,
        `Die eigenen Stärken als kurze, zitierfähige Sätze formulieren und auf Startseite, Preisseite und FAQ einheitlich verwenden.`,
        `Kundenstimmen und Bewertungen auf den Portalen sammeln, auf denen ${comp.name} gelobt wird.`,
      ],
    },
    impact: 2,
    effort: 2,
    reach: share,
    evidence: {
      metrics: { responses: ix.N, competitorAhead: s.ahead.size, recommendedAhead: s.recAhead.size, bothNamed: s.both, ownAhead: s.ownAhead, competitorWithoutOwn: s.without },
      examples,
      promptIds,
      competitor: comp.name,
      competitorId: cid,
      ownExamples: ownSnips,
      runnersUp: ranked.slice(1, 4).map(([id, x]) => ({ name: ix.compById.get(id)!.name, ahead: x.ahead.size, recommendedAhead: x.recAhead.size, bothNamed: x.both })),
    },
    signature: { c: comp.name, b: bucket(share) },
  })];
}

// ---------------------------------------------------------------------------
// sentiment
// ---------------------------------------------------------------------------
export function ruleSentiment(ix: Indexed): Candidate[] {
  const own = ix.own;
  if (!own) return [];
  const ownMs = ix.ments.filter((m) => m.brandId === own.id);
  const neg = ownMs.filter((m) => m.sentiment === 'negative');
  if (!neg.length) return [];
  const examples: Example[] = neg.slice(0, 5).map((m) => {
    const r = ix.respById.get(m.responseId)!;
    const src = (ix.metricCits.get(m.responseId) ?? [])[0];
    return { prompt: ix.promptText(r.promptId), engine: r.engine, snippet: m.snippet ? quote(m.snippet, 220) : undefined, url: src ? cleanUrl(src.url) : undefined };
  });
  const sources = groupBy(neg.flatMap((m) => (ix.metricCits.get(m.responseId) ?? []).map((c) => hostOf(c))), (h) => h);
  const topSources = [...sources.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([h, xs]) => ({ domain: h, count: xs.length }));
  const share = neg.length / Math.max(1, ownMs.length);
  const srcList = topSources.slice(0, 3).map((s) => s.domain).join(', ');
  return [make(ix.lang, {
    key: 'sentiment:negative',
    type: 'sentiment',
    text: (l) => l === 'en' ? {
      title: `Review and correct negative statements about ${own.name}`,
      why: `${neg.length} of ${ownMs.length} mentions of ${own.name} ${neg.length === 1 ? 'is' : 'are'} negative.`,
      steps: [
        'Check every negative statement: is it (still) true? Where does it come from (see sources)?',
        `Correct outdated or wrong information on your own website, clearly and up to date (e.g. an FAQ “Is it true that …?”).${topSources.length ? ` Most frequent sources: ${srcList}.` : ''}`,
        'For third-party sites, ask the editors for a correction with evidence; reply factually on review sites.',
        'Pass legitimate criticism on internally – and communicate once it’s fixed.',
      ],
    } : {
      title: `Negative Aussagen über ${own.name} prüfen und richtigstellen`,
      why: `${neg.length} von ${ownMs.length} Nennungen von ${own.name} ${neg.length === 1 ? 'ist' : 'sind'} negativ.`,
      steps: [
        'Jede negative Aussage prüfen: Stimmt sie (noch)? Woher stammt sie (siehe Quellen)?',
        `Veraltete oder falsche Angaben auf der eigenen Website klar und aktuell richtigstellen (z. B. FAQ „Stimmt es, dass …?“).${topSources.length ? ` Häufigste Quellen: ${srcList}.` : ''}`,
        'Bei Drittseiten die Redaktion mit Belegen um Korrektur bitten; auf Bewertungsportalen sachlich antworten.',
        'Berechtigte Kritik intern weitergeben – und kommunizieren, wenn sie behoben ist.',
      ],
    },
    impact: neg.length >= 3 ? 3 : 2,
    effort: 2,
    reach: Math.min(1, neg.length / Math.max(1, ix.N) * 3),
    evidence: {
      metrics: { ownMentions: ownMs.length, negative: neg.length, share },
      examples,
      promptIds: uniq(neg.map((m) => ix.respById.get(m.responseId)!.promptId)),
      sources: topSources,
    },
    signature: { n: Math.min(neg.length, 10) },
  })];
}

/** Alle Regeln auf eine Messung anwenden. Ohne eigene Marke gibt es keine Maßnahmen. */
export function buildCandidates(d: RecData): Candidate[] {
  const ix = indexData(d);
  if (!ix.own || !ix.N) return [];
  const all = [
    ...ruleNameOnOwnPage(ix, d),
    ...ruleOutreach(ix),
    ...ruleContentGap(ix, d),
    ...ruleCommunity(ix),
    ...ruleTechnical(ix, d.siteChecks),
    ...rulePositioning(ix),
    ...ruleSentiment(ix),
  ];
  return all.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}
