// Regelbasierte Maßnahmen-Kandidaten: jede mit stabilem key, Evidenz (Zahlen + 1–5 Beispiele) und Standardtexten
// auf Deutsch und Englisch (`texts`; title/why/steps = Workspace-Sprache). Die Texte funktionieren ohne KI; phrase.ts kann sie
// optional verbessern. Deutsch und Englisch haben je Maßnahme gleich viele Schritte (done_steps beziehen sich auf die Indizes).
import {
  cleanUrl, communityGroup, domainMatches, groupBy, hostOf, indexData, normName, pct, shortPath, titleFromUrl,
  engineLabel, type Indexed, type PageKind, type RecData, type SiteCheckResult,
} from './data.ts';
import { isLikelyCompetitor } from './present.ts';
import { listJoin, type Lang } from '../i18n.ts';

/**
 * Maßnahmen-Typen. Neu ab Nov. 2026: comparison (eigene, transparente Vergleichs-/Alternativenseiten), listicle (Aufnahme in
 * fremde Bestenlisten/Vergleichsartikel, die die KIs zitieren), reviews (Bewertungsportale), entity (Wikidata/Wikipedia).
 * Darstellungs-Kategorie siehe present.ts `categoryOf`.
 */
export type RecType = 'name_on_own_page' | 'outreach' | 'content_gap' | 'community' | 'technical' | 'positioning' | 'sentiment'
  | 'comparison' | 'listicle' | 'reviews' | 'entity';
export const REC_TYPES: RecType[] = ['name_on_own_page', 'outreach', 'content_gap', 'community', 'technical', 'positioning', 'sentiment',
  'comparison', 'listicle', 'reviews', 'entity'];

/**
 * Wie gut ist die Wirkung der Maßnahme belegt? proven = dokumentierte Voraussetzung (z. B. Crawler-Sperre, noindex);
 * likely = Studien/Praxis zeigen einen deutlichen Zusammenhang; uncertain = plausibel, aber unsicher oder von Dritten abhängig.
 * Gespeichert als evidence.certainty.
 */
export type Certainty = 'proven' | 'likely' | 'uncertain';

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
  /** Wirkung: 1 klein · 2 mittel · 3 groß (Rubrik siehe IMPACT_RUBRIC) */
  impact: 1 | 2 | 3;
  /** Aufwand 1–3 (geht in die Priorität ein; die Darstellung zeigt ihn nicht mehr) */
  effort: 1 | 2 | 3;
  /** Belegstärke der Wirkung (von make() immer gesetzt, auch in evidence.certainty) */
  certainty?: Certainty;
  /** Anteil betroffener Antworten bzw. Prompts (0..1) */
  reach: number;
  priority: number;
  evidence: Evidence;
  /** Kernzahlen für die Entscheidung „neu formulieren?“ (grob gerundet, damit Rauschen keine Neuformulierung auslöst) */
  signature: unknown;
}

/**
 * Rubrik für impact (gilt für alle Regeln):
 * 3 = groß: Voraussetzung, ohne die KI-Suchen die Seiten nicht nutzen können (Crawler-Sperre, noindex, kein Text ohne JS),
 *     oder Inhalts-/Quellenlücke, die einen großen Teil der Antworten betrifft und bei der die Marke (fast) nie vorkommt.
 * 2 = mittel: belegter Hebel mit begrenzter Reichweite oder von Dritten abhängigem Erfolg.
 * 1 = klein: Grundpflege bzw. Wirkung unsicher (z. B. Schema, Meta-Description, hreflang, Wikidata).
 */
export const IMPACT_RUBRIC = { 3: 'large', 2: 'medium', 1: 'small' } as const;

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
type Draft = Omit<Candidate, 'priority' | 'title' | 'why' | 'steps' | 'texts' | 'certainty'> & { text: (l: Lang) => RuleText; certainty?: Certainty };
/** Standard-Belegstärke je Typ (Regeln können sie überschreiben) */
const CERTAINTY: Record<RecType, Certainty> = {
  name_on_own_page: 'likely', outreach: 'likely', content_gap: 'likely', community: 'likely', technical: 'likely', positioning: 'likely',
  sentiment: 'likely', comparison: 'likely', listicle: 'likely', reviews: 'likely', entity: 'uncertain',
};
/** Kandidat fertigstellen: Texte für alle Sprachen erzeugen und kürzen; title/why/steps in der Workspace-Sprache `lang`. */
function make(lang: Lang, c: Draft): Candidate {
  const { text, certainty: cert, ...rest } = c;
  const fin = (t: RuleText): RuleText => ({ title: clipText(t.title, TITLE_MAX), why: clipText(t.why, WHY_MAX), steps: t.steps });
  const texts: Record<Lang, RuleText> = { de: fin(text('de')), en: fin(text('en')) };
  const certainty = cert ?? CERTAINTY[c.type];
  return { ...rest, ...texts[lang], texts, lang, certainty, evidence: { ...rest.evidence, certainty }, priority: priorityOf(c.impact, c.reach, c.effort) };
}
const listL = (xs: string[], l: Lang) => listJoin(xs, l);

/** Frage für Titel kürzen */
const q = (text: string, n: number) => clipText(text.replace(/\?$/, ''), n);

/** Domains, bei denen Outreach nicht sinnvoll ist (Suchmaschinen, Lexika, Behörden) – Community-Quellen laufen separat. */
const NO_OUTREACH = [/(^|\.)google\.[a-z.]+$/, /(^|\.)wikipedia\.org$/, /(^|\.)wikimedia\.org$/, /(^|\.)bing\.com$/, /(^|\.)bund\.de$/,
  /(^|\.)bundesregierung\.de$/, /(^|\.)europa\.eu$/, /(^|\.)gesetze-im-internet\.de$/, /\.gov$/, /(^|\.)bundesbank\.de$/,
  /(^|\.)apple\.com$/, /(^|\.)play\.google\.com$/,
  // Forschung, Code, soziale Netzwerke: keine Redaktion, die man anschreiben kann (LinkedIn: eigene Beiträge, siehe GEO-PLAYBOOK)
  /(^|\.)arxiv\.org$/, /(^|\.)researchgate\.net$/, /(^|\.)semanticscholar\.org$/, /(^|\.)doi\.org$/, /(^|\.)github\.com$/,
  /(^|\.)linkedin\.com$/, /(^|\.)x\.com$/, /(^|\.)twitter\.com$/, /(^|\.)facebook\.com$/, /(^|\.)instagram\.com$/];

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
export type OutreachExclusionReason = 'competitor' | 'vendor' | 'rival_portal' | 'community' | 'reviews' | 'not_editorial' | 'below_threshold' | 'beyond_max';

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
/** Fachmedien (Auswahl) und Namen, die nach Redaktion klingen (Magazin, Zeitung, Journal, Praxis, News) */
const TRADE_MEDIA = /(^|\.)(vogel\.de|engineering\.com|digitalengineering247\.com|digital-engineering-magazin\.de|konstruktion-entwicklung\.de|industrie\.de|produktion\.de|elektroniknet\.de|computer-automation\.de|it-production\.com|springerprofessional\.de|channelpartner\.de|cio\.de|lead-digital\.de|internetworld\.de|absatzwirtschaft\.de|marktundmittelstand\.de|healthcare-computing\.de|e-health-com\.de|apotheke-adhoc\.de|zwp-online\.info)$/;
const MEDIA_NAME = /(magazin|magazine|zeitung|journal|praxis|news|nachrichten|report|today|weekly|daily|times|post)$|^(news|magazin)/;
export function sourceKindOf(host: string): SourceKind {
  if (REVIEW_SITES.test(host)) return 'reviews';
  if (MEDIA_SITES.test(host) || TRADE_MEDIA.test(host)) return 'media';
  if (host.split('.').slice(0, -1).some((l) => MEDIA_NAME.test(l))) return 'media';
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

/**
 * Host gehört wahrscheinlich einem anderen Anbieter, der in den Antworten genannt wird (z. B. Blog eines Wettbewerbers)?
 * Liefert den Anbieternamen. Nur Namen, die wahrscheinlich Anbieter sind (Urteil des Analyse-Modells bzw. Namensliste) –
 * ein Portal, das die KI als „Marke“ nennt, bleibt Ziel.
 */
function vendorMatcher(ix: Indexed): (host: string) => string | null {
  const own = ix.own!;
  const vendorByKey = new Map<string, string>();
  for (const m of ix.ments) {
    if (m.brandId === own.id || !isLikelyCompetitor(m.name, m.isCompetitor)) continue;
    // Ratgeber-/Vergleichsseiten sind für Anbieter Outreach-Ziele, für ein Vergleichsportal Konkurrenz
    if (own.kind !== 'portal' && EDITORIAL_NAME.test(m.name)) continue;
    const k = brandKey(m.name);
    // ab 3 Zeichen (SAP, PTC); Abgleich nur mit ganzen Host-Labels
    if (k.length >= 3 && !vendorByKey.has(k)) vendorByKey.set(k, m.name);
  }
  return (host: string) => {
    for (const l of hostLabels(host)) { const v = vendorByKey.get(l) ?? vendorByKey.get(l.replace(/\d+$/, '')); if (v) return v; }
    return null;
  };
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
  const vendorOf = vendorMatcher(ix);
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
      // Bewertungsportale bündelt die Maßnahme „reviews“
      if (REVIEW_SITES.test(host)) { exclude(host, rid, 'reviews', null); continue; }
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
  // Schwelle: 8 % der Antworten, bei großen Messungen gedeckelt (8 von 100) – sonst fällt bei 800 Antworten jede Quelle unter 64 Treffer heraus
  const minN = Math.max(minResp, Math.ceil(0.08 * Math.min(ix.N, 100)));
  const sorted = [...by.entries()]
    .sort((a, b) => b[1].resps.size - a[1].resps.size || b[1].prompts.size - a[1].prompts.size || a[0].localeCompare(b[0]));
  const rows = sorted.filter(([, e]) => e.resps.size >= minN).slice(0, max);
  const reasonText = (r: OutreachExclusionReason, d: string | null) => (opts.lang === 'en' ? {
    competitor: `website of competitor ${d}`,
    vendor: `a vendor’s site (${d} is itself named as a vendor in the answers)`,
    rival_portal: 'another comparison site – a direct competitor, no realistic outreach',
    community: 'community/forum – see the Community actions',
    reviews: 'review site – see the review-sites action',
    not_editorial: 'search engine, encyclopedia or authority – no editorial team to contact',
    below_threshold: `too rare (threshold: ${minN} answers)`,
    beyond_max: `not among the ${max} most important sources`,
  } : {
    competitor: `Website des Wettbewerbers ${d}`,
    vendor: `Seite eines Anbieters (${d} wird in den Antworten selbst als Anbieter genannt)`,
    rival_portal: 'anderes Vergleichsportal – direkter Wettbewerber, keine realistische Ansprache',
    community: 'Community/Forum – siehe Community-Maßnahmen',
    reviews: 'Bewertungsportal – siehe Maßnahme Bewertungsportale',
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
      certainty: sk === 'media' ? 'uncertain' : 'likely',
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

/**
 * Höchstens so viele Themenseiten schlägt content_gap vor. Fragen werden zu Clustern gebündelt (Thema der Frage, sonst Absicht),
 * statt je Testfrage eine Seite: Die Testfragen sind eine Stichprobe dessen, was Kunden fragen – eine gute Themenseite beantwortet
 * viele verwandte Fragen. Vergleichs-/Alternativfragen (nennen einen Wettbewerber) bündelt die Maßnahme „comparison“.
 */
export const CONTENT_GAP_MAX = 3;

/** Aspekt einer Frage – bestimmt die Gliederung der Themenseite. */
export type Facet = 'risk' | 'integration' | 'cost' | 'list' | 'howto' | 'explain' | 'other';
// Unicode-Wortgrenzen (B…E), weil \b Umlaute als Grenze behandelt
const FB = '(?<![\\p{L}\\p{N}])', FE = '(?![\\p{L}\\p{N}])';
const fre = (src: string) => new RegExp(src.replaceAll('<B>', FB).replaceAll('<E>', FE), 'iu');
/** Reihenfolge zählt: Fragewort-Muster („Welche …“, „Wie …“, „Was ist …“) vor den Listen-Stichwörtern im Satz,
 * damit „Was ist eine CRM-Software?“ Grundlagen und „Wie führe ich ein Tool ein?“ Vorgehen bleibt. */
const FACET_RE: [Facet, RegExp][] = [
  ['risk', fre('risik|<B>sicher(heit)?<E>|datenschutz|<B>ip<E>|compliance|dsgvo|gdpr|security|secure|<B>risks?<E>|privacy')],
  ['integration', fre('integr|anbind|verbind|schnittstell|<B>api<E>|connect|tool-landschaft|it-landschaft')],
  ['cost', fre('kostet|<B>kosten<E>|preis|<B>price|pricing|<B>costs?<E>|<B>roi<E>|amortis|budget|<B>lohnt|wirtschaftlich|<B>nutzen<E>.*berechn|förder(mittel|programm|ung)')],
  ['list', fre('^(welche[srn]?|was sind die besten|beste[nr]?|top|gibt es|which|what are the best|best|are there)<E>')],
  ['howto', fre('^(wie|how)<E>')],
  ['explain', fre('^(was ist|was sind|was unterscheidet|was ist der unterschied|warum|what is|what are|what\'s the difference|why)<E>')],
  ['list', fre('anbieter|<B>tools?<E>|software|<B>plattform(en)?<E>|<B>platforms?<E>|lösungen<E>|<B>solutions?<E>')],
];
export const facetOf = (text: string): Facet => FACET_RE.find(([, re]) => re.test(text.trim()))?.[0] ?? 'other';
const FACET_LABEL: Record<Lang, Record<Facet, string>> = {
  de: { risk: 'Risiken & Sicherheit', integration: 'Integration', cost: 'Kosten & Nutzen', list: 'Anbieter im Überblick', howto: 'Vorgehen in der Praxis', explain: 'Grundlagen', other: 'Weitere Fragen' },
  en: { risk: 'Risks & security', integration: 'Integration', cost: 'Cost & ROI', list: 'Provider overview', howto: 'How to do it', explain: 'Basics', other: 'Other questions' },
};
const FACET_WORD: Record<Lang, Record<Facet, string>> = {
  de: { risk: 'Risiken', integration: 'Integration', cost: 'Kosten', list: 'Anbieter', howto: 'Vorgehen', explain: 'Grundlagen', other: '' },
  en: { risk: 'risks', integration: 'integration', cost: 'cost', list: 'providers', howto: 'how-to', explain: 'basics', other: '' },
};

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Getrackte Marken (Name oder Alias), die im Fragetext vorkommen. */
export function brandsInText(text: string, brands: { name: string; aliases?: string[] | null; isOwn: boolean }[]) {
  const t = text.toLowerCase();
  return brands.filter((b) => [b.name, ...(b.aliases ?? [])].some((n) => n.trim().length >= 2
    && new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(n.trim().toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(t)));
}
/** Vergleichs- oder Alternativfrage: nennt einen getrackten Wettbewerber im Fragetext. */
export const isComparisonPrompt = (ix: Indexed, text: string) => brandsInText(text, ix.competitors).length > 0;

/** Lückenfragen: eigene Marke fehlt (fast) überall, Wettbewerber werden genannt, eigene Seite ist hier noch keine häufige Quelle. */
function gapStats(ix: Indexed, maxOwnRate = 0.2) {
  return promptStats(ix).filter((st) => st.own / st.n <= maxOwnRate && st.withComp >= 2 && st.ownSite / st.n < 0.4);
}

/** Eigene Seiten, die bei diesen Fragen herangezogen wurden – als Quelle genutzte (cited bzw. metricCits) zählen zehnfach. */
function ownPagesFor(ix: Indexed, pids: string[]): string[] {
  const own = ix.own!;
  const pageCount = new Map<string, number>();
  for (const pid of pids) {
    for (const r of ix.respsByPrompt.get(pid) ?? []) {
      const used = new Set(ix.metricCits.get(r.id) ?? []);
      for (const c of ix.allCits.get(r.id) ?? []) {
        if (!domainMatches(hostOf(c), own.domains)) continue;
        const u = cleanUrl(c.url);
        pageCount.set(u, (pageCount.get(u) ?? 0) + (used.has(c) ? 10 : 1));
      }
    }
  }
  return [...pageCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([u]) => u);
}
/** Taugt die eigene Seite als Ausgangspunkt einer Themenseite? Nicht: Startseite, Presse/News, Webinare, Events, Jobs, Rechtliches. */
export function isTopicBase(url: string): boolean {
  try {
    const segs = new URL(url).pathname.toLowerCase().split('/').filter(Boolean);
    if (!segs.length || (segs.length === 1 && /^[a-z]{2}(-[a-z]{2})?$/.test(segs[0]))) return false;
    return !segs.some((x) => /^(press|presse|pressemitteilungen?|news|newsroom|webinars?|events?|veranstaltungen|jobs|karriere|careers|impressum|imprint|datenschutz|privacy|legal|agb|terms|team|tags?|author|autor)$/.test(x));
  } catch { return false; }
}

/** Zusammenfassung mehrerer Lückenfragen (Cluster) */
function aggregate(ix: Indexed, sts: PromptStat[]) {
  const n = sts.reduce((a, s) => a + s.n, 0);
  const own = sts.reduce((a, s) => a + s.own, 0);
  const withComp = sts.reduce((a, s) => a + s.withComp, 0);
  const ownSite = sts.reduce((a, s) => a + s.ownSite, 0);
  const named = new Map<string, number>();
  for (const s of sts) for (const [k, v] of s.named) named.set(k, (named.get(k) ?? 0) + v);
  const namedSorted = [...named.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const comps = namedSorted.filter(([nm]) => ix.competitors.some((b) => b.name === nm)).slice(0, 4).map(([nm]) => nm);
  const others = namedSorted.filter(([nm]) => !comps.includes(nm)).slice(0, 3).map(([nm]) => nm);
  const examples: Example[] = [];
  for (const s of sts) {
    const r = (ix.respsByPrompt.get(s.pid) ?? []).find((x) => !ix.ownNamed.has(x.id) && ix.compsByResp.has(x.id));
    if (!r || examples.length >= 5) continue;
    const m = (ix.compsByResp.get(r.id) ?? []).sort((a, b) => a.position - b.position)[0];
    const src = (ix.metricCits.get(r.id) ?? [])[0];
    examples.push({ prompt: ix.promptText(s.pid), engine: r.engine, snippet: m?.snippet ? quote(m.snippet) : undefined, url: src ? cleanUrl(src.url) : undefined });
  }
  return { n, own, withComp, ownSite, namedSorted, alts: comps.length ? comps : others, examples };
}
const ownTimes = (own: number, l: Lang) => (l === 'en'
  ? own === 1 ? 'only once' : own ? `only ${own} times` : 'never'
  : own === 1 ? 'nur einmal' : own ? `nur ${own}-mal` : 'nie');

export function ruleContentGap(ix: Indexed, d: RecData): Candidate[] {
  const own = ix.own;
  if (!own) return [];
  const year = d.at.getFullYear();
  // Vergleichsfragen bündelt ruleComparison
  const gaps = gapStats(ix).filter((st) => !isComparisonPrompt(ix, ix.promptText(st.pid)));
  if (!gaps.length) return [];
  const anyTopic = gaps.some((st) => d.prompts.get(st.pid)?.topicId);
  // Cluster: Thema der Frage; Fragen ohne Thema nach Aspekt
  const clusters = groupBy(gaps, (st) => {
    const p = d.prompts.get(st.pid);
    return p?.topicId ? `topic:${p.topicId}` : `intent:${facetOf(p?.text ?? '')}`;
  });
  const keyPages = (d.siteChecks ?? []).flatMap((c) => c.pages ?? []).filter((p) => p.status !== null && p.status < 400);
  const assigned = new Set<string>();
  const drafts = [...clusters.entries()].map(([cid, sts]) => {
    sts.sort((a, b) => b.withComp / b.n - a.withComp / a.n || a.own - b.own || a.pid.localeCompare(b.pid));
    const agg = aggregate(ix, sts);
    const pids = sts.map((s) => s.pid);
    const facets = uniq(sts.map((s) => facetOf(ix.promptText(s.pid))));
    const facetOrder: Facet[] = ['explain', 'list', 'howto', 'integration', 'cost', 'risk', 'other'];
    facets.sort((a, b) => facetOrder.indexOf(a) - facetOrder.indexOf(b));
    const topicId = cid.startsWith('topic:') ? cid.slice(6) : null;
    const topicName = topicId ? d.prompts.get(pids[0])?.topicName ?? null : null;
    const label = (l: Lang) => topicName ?? FACET_LABEL[l][cid.slice(7) as Facet] ?? FACET_LABEL[l].other;
    const topicTotal = topicId ? [...d.prompts.values()].filter((p) => p.topicId === topicId).length : null;
    const ownRate = agg.own / agg.n;
    const compShare = agg.withComp / agg.n;
    return { cid, sts, agg, pids, facets, topicName, label, topicTotal, ownRate, compShare };
  });
  // die wichtigsten Cluster zuerst (Reichweite), höchstens CONTENT_GAP_MAX
  drafts.sort((a, b) => b.agg.withComp - a.agg.withComp || b.sts.length - a.sts.length || a.cid.localeCompare(b.cid));
  const out: Candidate[] = [];
  for (const c of drafts.slice(0, CONTENT_GAP_MAX)) {
    const ownPages = ownPagesFor(ix, c.pids).filter(isTopicBase);
    // Kosten-Cluster ohne genutzte eigene Seite → Preisseite aus dem Website-Check als Ausgangspunkt
    const pricing = c.facets.includes('cost') ? keyPages.find((p) => p.kind === 'pricing')?.url : undefined;
    const basePage = ownPages.find((u) => !assigned.has(u)) ?? (pricing && !assigned.has(cleanUrl(pricing)) ? cleanUrl(pricing) : null);
    if (basePage) assigned.add(basePage);
    const k = c.sts.length;
    const words = (l: Lang) => c.facets.map((f) => FACET_WORD[l][f]).filter(Boolean).slice(0, 3);
    const title = (l: Lang) => {
      const w = words(l);
      return `${c.label(l)}${w.length ? `: ${listL(w, l)}` : l === 'en' ? ' – overview' : ' – Überblick'} (${year})`;
    };
    const qs = c.sts.slice(0, 3).map((s) => q(ix.promptText(s.pid), 70));
    const more = k - qs.length;
    const sections = (l: Lang) => listL(c.facets.map((f) => FACET_LABEL[l][f]), l);
    const multi = k > 1;
    out.push(make(ix.lang, {
      key: `content_gap:${c.cid}`,
      type: 'content_gap',
      text: (l) => l === 'en' ? {
        title: multi
          ? `${basePage ? 'Expand' : 'Create'} one topic page on “${q(c.label('en'), 36)}” for ${k} questions`
          : `${basePage ? 'Expand' : 'Create'} a topic page on “${q(c.label('en'), 40)}”`,
        why: `On “${c.label('en')}”, ${c.agg.withComp} of ${c.agg.n} answers (${k} ${k === 1 ? 'question' : 'questions'}) name ${listL(c.agg.alts.slice(0, 2), 'en')} – ${own.name} ${ownTimes(c.agg.own, 'en')}.`,
        steps: [
          `${basePage ? `Turn ${shortPath(basePage)} into the topic page` : 'Create one topic page'} – it covers ${multi ? `${k} of the tested questions at once` : 'the tested question'}, e.g. ${qs.map((x) => `“${x}”`).join(', ')}${more > 0 ? ` and ${more} more (see evidence)` : ''}. Suggested title: “${title('en')}”.`,
          `The tested questions are a sample of what customers ask AI${c.topicTotal ? ` (${k} of ${c.topicTotal} tested questions on this topic)` : ''}: structure the page by aspects, not by single questions – ${sections('en')}. Then it also answers related questions nobody tested.`,
          `Open each section with a clear answer in two or three sentences; work ${own.name} in with verifiable facts (pricing, features, target group, customer examples).`,
          `Include the alternatives that get named (${listL(c.agg.alts.slice(0, 3), 'en')}) fairly – AI prefers balanced sources.`,
          'Link the page from your home and product pages. Add future questions on this topic as sections here instead of creating new single pages.',
        ],
      } : {
        title: multi
          ? `Eine Themenseite „${q(c.label('de'), 34)}“ für ${k} Fragen ${basePage ? 'ausbauen' : 'anlegen'}`
          : `Themenseite „${q(c.label('de'), 40)}“ ${basePage ? 'ausbauen' : 'anlegen'}`,
        why: `Zu „${c.label('de')}“ nennen ${c.agg.withComp} von ${c.agg.n} Antworten (${k} ${k === 1 ? 'Frage' : 'Fragen'}) ${listL(c.agg.alts.slice(0, 2), 'de')}, ${own.name} ${ownTimes(c.agg.own, 'de')}.`,
        steps: [
          `${basePage ? `${shortPath(basePage)} zur Themenseite ausbauen` : 'Eine Themenseite anlegen'} – sie deckt ${multi ? `${k} der getesteten Fragen auf einmal` : 'die getestete Frage'} ab, z. B. ${qs.map((x) => `„${x}“`).join(', ')}${more > 0 ? ` und ${more} weitere (siehe Belege)` : ''}. Titelvorschlag: „${title('de')}“.`,
          `Die getesteten Fragen sind eine Stichprobe dessen, was Kunden die KIs fragen${c.topicTotal ? ` (${k} von ${c.topicTotal} Testfragen zu diesem Thema)` : ''}: Gliedere nach Aspekten statt nach Einzelfragen – ${sections('de')}. So beantwortet die Seite auch verwandte Fragen, die niemand getestet hat.`,
          `Jeden Abschnitt mit einer klaren Antwort in zwei bis drei Sätzen beginnen; ${own.name} mit überprüfbaren Fakten einbinden (Preise, Funktionen, Zielgruppe, Kundenbeispiele).`,
          `Die genannten Alternativen (${listL(c.agg.alts.slice(0, 3), 'de')}) fair einbeziehen – KIs bevorzugen ausgewogene Quellen.`,
          'Die Seite von Startseite und Produktseiten verlinken. Spätere Fragen zum Thema hier als Abschnitt ergänzen statt neuer Einzelseiten.',
        ],
      },
      impact: (k >= 2 && c.ownRate <= 0.1 && c.compShare >= 0.5) || (c.ownRate === 0 && c.compShare >= 0.6) ? 3 : 2,
      effort: basePage ? 2 : 3,
      // Reichweite: Anteil aller Antworten, die dieses Cluster betrifft
      reach: c.agg.withComp / ix.N,
      evidence: {
        metrics: { responses: c.agg.n, ownNamed: c.agg.own, competitorOnly: c.agg.withComp, ownSiteUsed: c.agg.ownSite, totalResponses: ix.N, questions: k, topicQuestions: c.topicTotal },
        examples: c.agg.examples,
        promptIds: c.pids,
        prompts: c.sts.slice(0, 8).map((s) => ({ id: s.pid, text: ix.promptText(s.pid), missing: s.missing })),
        competitors: c.agg.namedSorted.slice(0, 6).map(([name, count]) => ({ name, count })),
        cluster: { kind: c.cid.startsWith('topic:') ? 'topic' : 'intent', id: c.cid.replace(/^(topic|intent):/, ''), label: c.label(ix.lang) },
        // Aspekte der Gliederung: Bezeichnungen in der Workspace-Sprache (für die KI) und in allen Sprachen (Claude-Prompt)
        facets: c.facets.map((f) => FACET_LABEL[ix.lang][f]),
        facetsByLang: { de: c.facets.map((f) => FACET_LABEL.de[f]), en: c.facets.map((f) => FACET_LABEL.en[f]) },
        titleSuggestion: title(ix.lang),
        basePage,
        ownPages: ownPages.slice(0, 3),
      },
      signature: { o: bucket(c.ownRate), c: bucket(c.compShare), k, b: basePage, a: anyTopic },
    }));
  }
  return out.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// comparison: eigene, transparente Vergleichs- und Alternativenseiten
// ---------------------------------------------------------------------------
export function ruleComparison(ix: Indexed, d: RecData): Candidate[] {
  const own = ix.own;
  if (!own || !ix.competitors.length) return [];
  const sts = gapStats(ix, 0.3).filter((st) => isComparisonPrompt(ix, ix.promptText(st.pid)));
  if (!sts.length) return [];
  sts.sort((a, b) => b.withComp - a.withComp || a.pid.localeCompare(b.pid));
  const agg = aggregate(ix, sts);
  // Wettbewerber, nach denen gefragt wird (im Fragetext), sonst die in den Antworten genannten
  const asked = new Map<string, number>();
  for (const s of sts) for (const b of brandsInText(ix.promptText(s.pid), ix.competitors)) asked.set(b.name, (asked.get(b.name) ?? 0) + 1);
  const targets = [...asked.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  for (const n of agg.alts) if (!targets.includes(n) && ix.competitors.some((c) => c.name === n)) targets.push(n);
  const top = targets.slice(0, 3);
  if (!top.length) return [];
  // vorhandene eigene Vergleichsseiten: Website-Check (Unterseite „comparison“) oder genutzte eigene URLs mit vs/alternative/vergleich
  const fromCheck = (d.siteChecks ?? []).flatMap((c) => c.pages ?? []).filter((p) => p.kind === 'comparison' && p.status !== null && p.status < 400).map((p) => cleanUrl(p.url));
  const fromCits = ownPagesFor(ix, sts.map((s) => s.pid)).filter((u) => /(^|[/-])(vs|versus|vergleich|compare|comparison|alternativ\w*)([/-]|$)/i.test(new URL(u).pathname));
  const existing = uniq([...fromCits, ...fromCheck]);
  const k = sts.length;
  const ownRate = agg.own / agg.n;
  const compShare = agg.withComp / agg.n;
  const qs = sts.slice(0, 3).map((s) => q(ix.promptText(s.pid), 70));
  const more = k - qs.length;
  const domain = own.domains[0] ?? '';
  return [make(ix.lang, {
    key: 'comparison:pages',
    type: 'comparison',
    text: (l) => l === 'en' ? {
      title: `${existing.length ? 'Expand' : 'Create'} comparison pages: ${own.name} vs. ${listL(top.slice(0, 2), 'en')}`,
      why: `For ${k} comparison and alternative ${k === 1 ? 'question' : 'questions'}, ${agg.withComp} of ${agg.n} answers name competitors – ${own.name} ${ownTimes(agg.own, 'en')}.`,
      steps: [
        `${existing.length ? `Build on ${existing.slice(0, 2).map(shortPath).join(', ')}: one` : 'One'} overview page “Alternatives to ${top[0]}” plus one page each “${own.name} vs. ${top[0]}”${top[1] ? `, “${own.name} vs. ${top[1]}”` : ''}${top[2] ? ` and “${own.name} vs. ${top[2]}”` : ''} on ${domain || 'your website'} – together they cover ${k === 1 ? 'the tested question' : `the ${k} tested questions`}, e.g. ${qs.map((x) => `“${x}”`).join(', ')}${more > 0 ? ` and ${more} more` : ''}.`,
        `Be transparent: clearly mark the page as ${own.name}’s comparison (publisher, as-of date), describe competitors fairly including their strengths and say who each option suits better. AI favors balanced sources, and comparative advertising must be objective and verifiable.`,
        'One table per page with the criteria the AI names in its answers (see evidence) – values only where you can back them up, with a source or test date.',
        'Don’t create seemingly independent comparison sites on extra domains: hidden self-promotion is misleading under unfair-competition law and gets devalued as spam.',
        'Link the pages from your home page, pricing page and FAQ, and update them every quarter (visible date).',
      ],
    } : {
      title: `Vergleichsseiten ${existing.length ? 'ausbauen' : 'anlegen'}: ${own.name} vs. ${listL(top.slice(0, 2), 'de')}`,
      why: `Bei ${k} Vergleichs- und Alternativ${k === 1 ? 'frage' : 'fragen'} nennen ${agg.withComp} von ${agg.n} Antworten Wettbewerber, ${own.name} ${ownTimes(agg.own, 'de')}.`,
      steps: [
        `${existing.length ? `Auf ${existing.slice(0, 2).map(shortPath).join(', ')} aufbauen: eine` : 'Eine'} Übersichtsseite „Alternativen zu ${top[0]}“ plus je eine Seite „${own.name} vs. ${top[0]}“${top[1] ? `, „${own.name} vs. ${top[1]}“` : ''}${top[2] ? ` und „${own.name} vs. ${top[2]}“` : ''} auf ${domain || 'der eigenen Website'} – zusammen decken sie ${k === 1 ? 'die getestete Frage' : `die ${k} getesteten Fragen`} ab, z. B. ${qs.map((x) => `„${x}“`).join(', ')}${more > 0 ? ` und ${more} weitere` : ''}.`,
        `Transparent bleiben: die Seite klar als Vergleich von ${own.name} kennzeichnen (Absender, Stand-Datum), Wettbewerber fair mit ihren Stärken darstellen und sagen, für wen welche Lösung besser passt. KIs bevorzugen ausgewogene Quellen, und vergleichende Werbung muss sachlich und nachprüfbar sein (§ 6 UWG).`,
        'Je Seite eine Tabelle mit den Kriterien, die die KIs in ihren Antworten nennen (siehe Belege) – Werte nur, wenn belegbar, mit Quelle oder Teststand.',
        'Keine scheinbar unabhängigen Vergleichsseiten auf Extra-Domains: verdeckte Eigenwerbung ist irreführend (UWG) und wird als Spam abgewertet.',
        'Die Seiten von Startseite, Preisseite und FAQ verlinken und quartalsweise aktualisieren (sichtbares Datum).',
      ],
    },
    impact: (k >= 2 && ownRate <= 0.1 && compShare >= 0.5) ? 3 : 2,
    effort: existing.length ? 2 : 3,
    reach: agg.withComp / ix.N,
    evidence: {
      metrics: { responses: agg.n, ownNamed: agg.own, competitorOnly: agg.withComp, totalResponses: ix.N, questions: k },
      examples: agg.examples,
      promptIds: sts.map((s) => s.pid),
      prompts: sts.slice(0, 8).map((s) => ({ id: s.pid, text: ix.promptText(s.pid), missing: s.missing })),
      competitors: agg.namedSorted.slice(0, 6).map(([name, count]) => ({ name, count })),
      targets: top,
      existingPages: existing.slice(0, 3),
      basePage: existing[0] ?? null,
    },
    signature: { o: bucket(ownRate), c: bucket(compShare), k, t: top, e: existing.length > 0 },
  })];
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
      impact, effort: 1, reach: allRedirected ? 0.1 : level === 3 ? 1 : level === 2 ? 0.4 : 0.2, certainty: answerBots.length ? 'proven' : 'likely',
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
  // wichtige Unterseiten, die ohne JavaScript (fast) leer sind
  const lowPages = ok.flatMap((c) => (c.pages ?? []).filter((p) => p.status !== null && p.status < 400 && p.textChars !== null && p.textChars < 300));
  if (lowText.length || lowPages.length) {
    const minChars = lowText.length ? Math.min(...lowText.map((c) => c.home.textChars ?? 0)) : Math.min(...lowPages.map((p) => p.textChars ?? 0));
    const homeLow = lowText.length > 0;
    const sub = lowPages.map((p) => shortPath(p.url)).slice(0, 3).join(', ');
    out.push(make(ix.lang, {
      key: 'technical:js_text', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Make your content available without JavaScript',
        why: homeLow
          ? `Without JavaScript, the home page shows only ${minChars} characters of text – many AI crawlers can’t see the content.`
          : `Without JavaScript, key pages show almost no text (${sub}) – many AI crawlers can’t see the content.`,
        steps: [
          'Check with your developers whether the pages can be rendered on the server or pre-rendered (SSR/SSG).',
          'Test it: open the page in a browser with JavaScript disabled – headings, text and prices must be visible.',
          'Serve at least the most important pages (home, product, pricing, guides) as HTML with text.',
        ],
      } : {
        title: 'Inhalte ohne JavaScript auslieferbar machen',
        why: homeLow
          ? `Ohne JavaScript zeigt die Startseite nur ${minChars} Zeichen Text – viele KI-Crawler sehen die Inhalte nicht.`
          : `Ohne JavaScript zeigen wichtige Unterseiten kaum Text (${sub}) – viele KI-Crawler sehen die Inhalte nicht.`,
        steps: [
          'Mit der Entwicklung klären, ob die Seiten serverseitig gerendert oder vorgerendert werden können (SSR/SSG).',
          'Prüfen: Seite mit deaktiviertem JavaScript im Browser öffnen – Überschriften, Texte und Preise müssen sichtbar sein.',
          'Mindestens die wichtigsten Seiten (Startseite, Produkt, Preise, Ratgeber) als HTML mit Text ausliefern.',
        ],
      },
      impact: homeLow ? 3 : 2, effort: 3, reach: homeLow ? 1 : 0.5, certainty: 'proven',
      evidence: {
        metrics: { ...metricsBase, minTextChars: minChars },
        examples: [], domains: domainsOf(homeLow ? lowText : ok),
        urls: lowPages.map((p) => ({ url: p.url, title: `${p.textChars} Zeichen`, count: 0 })),
      },
      signature: { d: domainsOf(lowText), p: lowPages.map((p) => p.url).sort() },
    }));
  }

  const noSchema = ok.filter((c) => !c.home.jsonLd.some(isEntitySchema) && !(c.pages ?? []).some((p) => p.kind === 'about' && p.jsonLd.some(isEntitySchema)));
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
      impact: 1, effort: 1, reach: 0.2, certainty: 'uncertain',
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf(noSchema), jsonLdFound: uniq(noSchema.flatMap((c) => [...c.home.jsonLd, ...(c.pages ?? []).flatMap((p) => p.jsonLd)])) },
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

  // --- ab hier: vertiefter Check (Felder fehlen bei älteren Ergebnissen → keine Maßnahme) ---
  type P = { kind: PageKind | 'home'; url: string; noindex?: boolean; canonical?: string | null; metaDescription?: string | null; title?: string | null; ms?: number | null; textChars?: number | null };
  const pagesOf = (c: SiteCheckResult): P[] => [
    { kind: 'home', url: c.home.finalUrl ?? `https://${c.domain}/`, noindex: c.home.noindex, canonical: c.home.canonical, metaDescription: c.home.metaDescription, title: c.home.title, ms: c.home.ms, textChars: c.home.textChars },
    ...(c.pages ?? []).filter((p) => p.status !== null && p.status < 400),
  ];
  const kindName = (k: P['kind'], l: Lang) => (l === 'en'
    ? { home: 'home page', pricing: 'pricing page', product: 'product page', comparison: 'comparison page', faq: 'FAQ', about: 'about page' }
    : { home: 'Startseite', pricing: 'Preisseite', product: 'Produktseite', comparison: 'Vergleichsseite', faq: 'FAQ', about: 'Über-uns-Seite' })[k];
  const pageList = (ps: P[], l: Lang) => listL(ps.slice(0, 4).map((p) => `${kindName(p.kind, l)} (${shortPath(p.url)})`), l);
  const ownHosts = uniq([...own.domains, ...checks.map((c) => c.domain), ...checks.map((c) => (c.home.finalUrl ? hostOf({ url: c.home.finalUrl, domain: '' }) : '')).filter(Boolean)]);
  const allPages = ok.flatMap(pagesOf);

  // noindex: belegt – Seiten ohne Index fehlen in den Suchindizes (Google, Bing), aus denen KI-Suchen schöpfen
  const noindex = allPages.filter((p) => p.noindex);
  if (noindex.length) {
    const home = noindex.some((p) => p.kind === 'home');
    out.push(make(ix.lang, {
      key: 'technical:noindex', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Remove the noindex tag from important pages',
        why: `${home ? 'The home page is' : `${noindex.length} important ${noindex.length === 1 ? 'page is' : 'pages are'}`} set to noindex – search indexes that AI search draws on leave ${home || noindex.length === 1 ? 'it' : 'them'} out.`,
        steps: [
          `Affected: ${pageList(noindex, 'en')}.`,
          'Remove “noindex” from the meta robots tag or the X-Robots-Tag header – often a CMS setting like “discourage search engines” left over from the launch.',
          'Then request indexing in Google Search Console and Bing Webmaster Tools (URL inspection).',
        ],
      } : {
        title: 'noindex-Sperre auf wichtigen Seiten entfernen',
        why: `${home ? 'Die Startseite ist' : `${noindex.length} wichtige ${noindex.length === 1 ? 'Seite ist' : 'Seiten sind'}`} auf noindex gesetzt – Suchindizes, aus denen KI-Suchen schöpfen, lassen ${home || noindex.length === 1 ? 'sie' : 'sie'} weg.`,
        steps: [
          `Betroffen: ${pageList(noindex, 'de')}.`,
          '„noindex“ aus dem Meta-Robots-Tag bzw. dem X-Robots-Tag-Header entfernen – oft eine CMS-Einstellung wie „Suchmaschinen davon abhalten …“ aus der Launch-Phase.',
          'Danach in der Google Search Console und den Bing Webmaster Tools die Indexierung anstoßen (URL-Prüfung).',
        ],
      },
      impact: home ? 3 : 2, effort: 1, reach: home ? 1 : 0.5, certainty: 'proven',
      evidence: { metrics: { ...metricsBase, pages: noindex.length }, examples: [], domains: domainsOf(ok), urls: noindex.map((p) => ({ url: p.url, title: kindName(p.kind, ix.lang), count: 0 })) },
      signature: { u: noindex.map((p) => p.url).sort() },
    }));
  }

  // Canonical auf eine fremde Domain bzw. Unterseite mit Canonical auf die Startseite: Suchmaschinen indexieren dann die andere URL
  const homeOf = (u: string) => { try { const x = new URL(u); return x.pathname.replace(/\/$/, '') === ''; } catch { return false; } };
  const badCanon = allPages.filter((p) => {
    if (!p.canonical) return false;
    const h = hostOf({ url: p.canonical, domain: '' });
    if (h && !domainMatches(h, ownHosts)) return true;
    return p.kind !== 'home' && homeOf(p.canonical) && !homeOf(p.url);
  });
  if (badCanon.length) {
    out.push(make(ix.lang, {
      key: 'technical:canonical', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Fix canonical tags that point to the wrong URL',
        why: `${badCanon.length} ${badCanon.length === 1 ? 'page declares' : 'pages declare'} another URL as canonical – search engines may index that one instead.`,
        steps: [
          `Check: ${listL(badCanon.slice(0, 4).map((p) => `${shortPath(p.url)} → ${shortPath(p.canonical!)}`), 'en')}.`,
          'Each page should name itself as canonical (self-referencing), unless it’s really a duplicate.',
          'Check the template or SEO plugin setting that generates the tag – one wrong default usually affects many pages.',
        ],
      } : {
        title: 'Falsch gesetzte Canonical-Tags korrigieren',
        why: `${badCanon.length} ${badCanon.length === 1 ? 'Seite verweist' : 'Seiten verweisen'} per Canonical auf eine andere URL – Suchmaschinen indexieren womöglich nur diese.`,
        steps: [
          `Prüfen: ${listL(badCanon.slice(0, 4).map((p) => `${shortPath(p.url)} → ${shortPath(p.canonical!)}`), 'de')}.`,
          'Jede Seite sollte sich selbst als Canonical nennen, außer sie ist wirklich ein Duplikat.',
          'Die Vorlage bzw. Einstellung im SEO-Plugin prüfen, die das Tag erzeugt – eine falsche Voreinstellung betrifft meist viele Seiten.',
        ],
      },
      impact: 2, effort: 1, reach: 0.5, certainty: 'likely',
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf(ok), urls: badCanon.map((p) => ({ url: p.url, title: `canonical → ${p.canonical}`, count: 0 })) },
      signature: { u: badCanon.map((p) => `${p.url}>${p.canonical}`).sort() },
    }));
  }

  // Sitemap fehlt oder ist seit über einem Jahr unverändert: Auffindbarkeit für Bing/Google (ChatGPT-Suche stützt sich stark auf Bing)
  const smChecked = ok.filter((c) => c.sitemap && c.sitemap.status !== null && !robotsStatusUnknownLocal(c.sitemap.status));
  const now = Date.now();
  const noSitemap = smChecked.filter((c) => !c.sitemap!.found);
  const stale = smChecked.filter((c) => c.sitemap!.found && c.sitemap!.newest && now - Date.parse(c.sitemap!.newest) > 365 * 86_400_000);
  if (noSitemap.length || stale.length) {
    const missing = noSitemap.length > 0;
    out.push(make(ix.lang, {
      key: 'technical:sitemap', type: 'technical',
      text: (l) => l === 'en' ? {
        title: missing ? 'Publish an XML sitemap and submit it to Bing and Google' : 'Keep the XML sitemap up to date',
        why: missing
          ? 'There’s no XML sitemap – new and updated pages reach the Bing and Google indexes that AI search draws on more slowly.'
          : `The sitemap’s newest entry is from ${stale[0].sitemap!.newest!.slice(0, 10)} – search engines can’t tell what changed.`,
        steps: [
          missing ? 'Have your CMS generate a sitemap (sitemap.xml) with all indexable pages and real lastmod dates.' : 'Make sure the sitemap is generated automatically and lastmod changes only when the content really changes.',
          'Reference it in robots.txt (“Sitemap: https://…/sitemap.xml”).',
          'Submit it in Bing Webmaster Tools and Google Search Console; enable IndexNow for Bing if your CMS supports it – ChatGPT search draws heavily on Bing.',
        ],
      } : {
        title: missing ? 'XML-Sitemap bereitstellen und bei Bing und Google einreichen' : 'XML-Sitemap aktuell halten',
        why: missing
          ? 'Es gibt keine XML-Sitemap – neue und geänderte Seiten landen langsamer in den Bing- und Google-Indizes, aus denen KI-Suchen schöpfen.'
          : `Der jüngste Eintrag der Sitemap stammt vom ${stale[0].sitemap!.newest!.slice(0, 10)} – Suchmaschinen erkennen nicht, was sich geändert hat.`,
        steps: [
          missing ? 'Das CMS eine Sitemap (sitemap.xml) mit allen indexierbaren Seiten und echten lastmod-Daten erzeugen lassen.' : 'Sicherstellen, dass die Sitemap automatisch erzeugt wird und lastmod sich nur bei echten Inhaltsänderungen ändert.',
          'In der robots.txt referenzieren („Sitemap: https://…/sitemap.xml“).',
          'In den Bing Webmaster Tools und der Google Search Console einreichen; IndexNow für Bing aktivieren, falls das CMS es kann – die ChatGPT-Suche stützt sich stark auf Bing.',
        ],
      },
      impact: 1, effort: 1, reach: missing ? 0.4 : 0.2, certainty: 'likely',
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf([...noSitemap, ...stale]), sitemaps: smChecked.map((c) => ({ domain: c.domain, ...c.sitemap! })) },
      signature: { m: domainsOf(noSitemap), s: domainsOf(stale) },
    }));
  }

  // Titel/Meta-Description fehlen: Suchtreffer (Titel + Snippet) sind das Erste, was KI-Suchen von einer Seite sehen – Wirkung unsicher
  // nur mit vertieftem Check (metaDescription gesetzt oder ausdrücklich null)
  const noMeta = allPages.filter((p) => p.textChars !== null && p.metaDescription !== undefined && (p.metaDescription === null || !p.title));
  if (noMeta.length) {
    out.push(make(ix.lang, {
      key: 'technical:meta', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Add page titles and meta descriptions to key pages',
        why: `${noMeta.length} key ${noMeta.length === 1 ? 'page lacks' : 'pages lack'} a title or meta description – search results that AI search scans first show no clear summary.`,
        steps: [
          `Affected: ${pageList(noMeta, 'en')}.`,
          'Title: what the page offers plus brand (“… | Brand”); description: one or two factual sentences (max. 155 characters) with the core statement.',
          'Keep expectations realistic: this is hygiene for search snippets, not a proven lever for being named in AI answers.',
        ],
      } : {
        title: 'Seitentitel und Meta-Descriptions für Kernseiten ergänzen',
        why: `${noMeta.length} ${noMeta.length === 1 ? 'Kernseite fehlt' : 'Kernseiten fehlen'} Titel oder Meta-Description – Suchtreffer, die KI-Suchen zuerst sichten, zeigen keine klare Zusammenfassung.`,
        steps: [
          `Betroffen: ${pageList(noMeta, 'de')}.`,
          'Titel: was die Seite bietet plus Marke („… | Marke“); Description: ein bis zwei sachliche Sätze (max. 155 Zeichen) mit der Kernaussage.',
          'Erwartung realistisch halten: Das ist Pflege der Suchtreffer, kein belegter Hebel für Nennungen in KI-Antworten.',
        ],
      },
      impact: 1, effort: 1, reach: 0.2, certainty: 'uncertain',
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf(ok), urls: noMeta.map((p) => ({ url: p.url, title: kindName(p.kind, ix.lang), count: 0 })) },
      signature: { u: noMeta.map((p) => p.url).sort() },
    }));
  }

  // Sprachversionen ohne hreflang: Suchmaschinen (und damit KI-Suchen) liefern evtl. die falsche Sprachfassung – Wirkung unsicher
  const noHreflang = ok.filter((c) => (c.languages?.length ?? 0) > 0 && c.home.hreflang !== undefined && !c.home.hreflang.length && !c.sitemap?.hreflang);
  if (noHreflang.length) {
    const langs = uniq(noHreflang.flatMap((c) => c.languages ?? []));
    out.push(make(ix.lang, {
      key: 'technical:hreflang', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Link language versions with hreflang',
        why: `The site has language versions (${langs.map((x) => `/${x}/`).join(', ')}) without hreflang – search may show the wrong language version.`,
        steps: [
          'Add hreflang links between each page and its translations (including x-default), in the HTML head or the sitemap.',
          'For DACH: use “de” for one German version for all countries; use de-DE/de-AT/de-CH only if content really differs.',
          'Effect on AI answers is indirect: it helps search engines pick the right version for German questions.',
        ],
      } : {
        title: 'Sprachversionen per hreflang verknüpfen',
        why: `Die Website hat Sprachversionen (${langs.map((x) => `/${x}/`).join(', ')}) ohne hreflang – Suchen zeigen womöglich die falsche Sprachfassung.`,
        steps: [
          'hreflang-Verweise zwischen jeder Seite und ihren Übersetzungen ergänzen (inkl. x-default), im HTML-Head oder in der Sitemap.',
          'Für DACH: „de“ für eine deutsche Fassung für alle Länder; de-DE/de-AT/de-CH nur, wenn sich die Inhalte wirklich unterscheiden.',
          'Die Wirkung auf KI-Antworten ist indirekt: Suchmaschinen finden für deutsche Fragen eher die deutsche Fassung.',
        ],
      },
      impact: 1, effort: 2, reach: 0.2, certainty: 'uncertain',
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf(noHreflang), languages: langs },
      signature: { d: domainsOf(noHreflang), l: langs },
    }));
  }

  // langsame Antwort (vom Askmetry-Server gemessen, inkl. Body): KI-Abrufe im Auftrag der Nutzer warten nur kurz – Wirkung unsicher
  const slow = allPages.filter((p) => (p.ms ?? 0) > SLOW_MS);
  if (slow.length) {
    const maxS = Math.max(...slow.map((p) => p.ms ?? 0)) / 1000;
    out.push(make(ix.lang, {
      key: 'technical:speed', type: 'technical',
      text: (l) => l === 'en' ? {
        title: 'Speed up slow pages',
        why: `${slow.length} key ${slow.length === 1 ? 'page needs' : 'pages need'} up to ${maxS.toFixed(1)} s to load as HTML – live fetches by AI assistants may give up.`,
        steps: [
          `Affected: ${pageList(slow, 'en')}.`,
          'Check server response time and caching (CDN, page cache) – the HTML itself should arrive in well under a second.',
          'Measured once from our server: re-test before investing; the effect on AI answers is plausible but not proven.',
        ],
      } : {
        title: 'Langsame Seiten beschleunigen',
        why: `${slow.length} ${slow.length === 1 ? 'Kernseite braucht' : 'Kernseiten brauchen'} bis zu ${maxS.toFixed(1).replace('.', ',')} s für das HTML – Live-Abrufe von KI-Assistenten brechen womöglich ab.`,
        steps: [
          `Betroffen: ${pageList(slow, 'de')}.`,
          'Server-Antwortzeit und Caching prüfen (CDN, Seiten-Cache) – das HTML selbst sollte deutlich unter einer Sekunde da sein.',
          'Einmalig von unserem Server gemessen: vor größerem Aufwand nachmessen; die Wirkung auf KI-Antworten ist plausibel, aber nicht belegt.',
        ],
      },
      impact: 1, effort: 2, reach: 0.2, certainty: 'uncertain',
      evidence: { metrics: { ...metricsBase, maxMs: Math.max(...slow.map((p) => p.ms ?? 0)) }, examples: [], domains: domainsOf(ok), urls: slow.map((p) => ({ url: p.url, title: `${p.ms} ms`, count: 0 })) },
      signature: { u: slow.map((p) => p.url).sort() },
    }));
  }
  return out;
}

/** HTML langsamer als das gilt als langsam (inkl. Body, vom Askmetry-Server gemessen) */
export const SLOW_MS = 4_000;
const robotsStatusUnknownLocal = (status: number | null) => status === null || status === 429 || status >= 500;

/**
 * Suchindex-Lücke (datengetrieben, ohne Abruf): Nutzt ChatGPT (Bing-Index) bzw. Claude (Brave Search) die eigene Website
 * deutlich seltener als die anderen KI-Suchen, ist die Website dort womöglich schlecht indexiert. Andere Ursachen sind möglich →
 * Wirkung unsicher.
 */
export function ruleSearchIndex(ix: Indexed, checks: SiteCheckResult[] | undefined): Candidate[] {
  const own = ix.own;
  if (!own?.domains.length || !checks?.length) return [];
  const blocked = new Set(checks.flatMap((c) => c.robots.blocked));
  const n = new Map<string, number>(), used = new Map<string, number>();
  for (const r of ix.respById.values()) {
    // nur Antworten mit Quellen: Claude sucht z. B. nicht bei jeder Frage – ohne Suche kann keine Quelle fehlen
    if (!(ix.allCits.get(r.id)?.length)) continue;
    n.set(r.engine, (n.get(r.engine) ?? 0) + 1);
    if (ix.ownSiteResps.has(r.id)) used.set(r.engine, (used.get(r.engine) ?? 0) + 1);
  }
  const share = (e: string) => (n.get(e) ? (used.get(e) ?? 0) / n.get(e)! : 0);
  const INDEX: Record<string, { index: string; tool: string; bots: string[] }> = {
    chatgpt: { index: 'Bing', tool: 'Bing Webmaster Tools', bots: ['OAI-SearchBot', 'Bingbot'] },
    claude: { index: 'Brave Search', tool: 'Brave Search', bots: ['Claude-SearchBot'] },
  };
  const weak = Object.keys(INDEX).filter((e) => {
    const others = [...n.keys()].filter((x) => x !== e && x !== 'mock' && (n.get(x) ?? 0) >= 10);
    // Vergleich mit dem Median der anderen KI-Suchen (nicht der besten – eine Ausreißer-Engine allein soll nicht auslösen)
    const sh = others.map(share).sort((a, b) => a - b);
    const mid = sh.length ? (sh.length % 2 ? sh[(sh.length - 1) / 2] : (sh[sh.length / 2 - 1] + sh[sh.length / 2]) / 2) : 0;
    return (n.get(e) ?? 0) >= 10 && others.length >= 2 && mid >= 0.05 && share(e) < 0.35 * mid && !INDEX[e].bots.some((b) => blocked.has(b));
  });
  if (!weak.length) return [];
  const others = [...n.keys()].filter((x) => !weak.includes(x) && x !== 'mock' && (n.get(x) ?? 0) >= 10).sort((a, b) => share(b) - share(a));
  const best = others[0];
  const fmt = (e: string) => `${Math.round(share(e) * 100)} %`;
  const domain = own.domains[0];
  const idx = weak.map((e) => INDEX[e].index);
  return [make(ix.lang, {
    key: 'technical:search_index', type: 'technical',
    text: (l) => l === 'en' ? {
      title: `Check that ${domain} is indexed in ${listL(idx, 'en')}`,
      why: `${listL(weak.map((e) => engineLabel(e)), 'en')} ${weak.length === 1 ? 'uses' : 'use'} ${domain} in ${listL(weak.map(fmt), 'en')} of answers with sources, ${engineLabel(best)} in ${fmt(best)} – possibly an index gap.`,
      steps: [
        ...(weak.includes('chatgpt') ? ['Register the site in Bing Webmaster Tools, submit the sitemap and check the indexed pages and crawl errors – ChatGPT search draws heavily on Bing.'] : []),
        ...(weak.includes('claude') ? [`Search for your key pages on search.brave.com (e.g. “site:${domain}”) – Claude’s web search uses Brave.`] : []),
        'Enable IndexNow (supported by Bing and others) so new pages are found quickly.',
        'Other causes are possible (different sources per engine) – re-check after the next measurement.',
      ],
    } : {
      title: `Indexierung von ${domain} in ${listL(idx, 'de')} prüfen`,
      why: `${listL(weak.map((e) => engineLabel(e)), 'de')} ${weak.length === 1 ? 'nutzt' : 'nutzen'} ${domain} in ${listL(weak.map(fmt), 'de')} der Antworten mit Quellen, ${engineLabel(best)} in ${fmt(best)} – womöglich eine Index-Lücke.`,
      steps: [
        ...(weak.includes('chatgpt') ? ['Website in den Bing Webmaster Tools anmelden, Sitemap einreichen und indexierte Seiten sowie Crawling-Fehler prüfen – die ChatGPT-Suche stützt sich stark auf Bing.'] : []),
        ...(weak.includes('claude') ? [`Wichtige Seiten auf search.brave.com suchen (z. B. „site:${domain}“) – die Websuche von Claude nutzt Brave.`] : []),
        'IndexNow aktivieren (von Bing u. a. unterstützt), damit neue Seiten schnell gefunden werden.',
        'Andere Ursachen sind möglich (jede KI-Suche nutzt andere Quellen) – nach der nächsten Messung erneut prüfen.',
      ],
    },
    impact: 2, effort: 1, reach: 0.3, certainty: 'uncertain',
    evidence: {
      metrics: { responses: ix.N, ownSiteResponses: ix.ownSiteResps.size, ...Object.fromEntries([...n.keys()].map((e) => [`share_${e}`, Math.round(share(e) * 1000) / 1000])) },
      examples: [], domain, engines: weak, comparedTo: best,
    },
    signature: { w: weak, b: bucket(share(best)) },
  })];
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

// ---------------------------------------------------------------------------
// listicle: in fremde Bestenlisten und Vergleichsartikel aufgenommen werden
// ---------------------------------------------------------------------------
/** URL/Titel klingt nach Liste oder Vergleich („Die 10 besten …“, „X vs. Y“, „Alternativen zu …“, „Top Tools“). */
// Wortgrenzen mit Unicode-Lookarounds: \b behandelt Umlaute als Grenze („Bestände“ wäre sonst „best“)
const LIST_RE = /(?<![\p{L}\p{N}])(best|beste[nrs]?|besten|top[\s-]?\d*|\d+[\s-]*(best|top|tools|software|anbieter|alternativ\p{L}*|plattformen|platforms|programme|lösungen|solutions)|vergleich\p{L}*|comparison|compared|alternativ\p{L}*|ranking|vs|versus)(?![\p{L}\p{N}])/iu;
export const LISTICLE_MAX = 6;

export function ruleListicle(ix: Indexed, opts: { skipHosts?: Set<string> } = {}): Candidate[] {
  const own = ix.own;
  if (!own || !ix.competitors.length) return [];
  const vendorOf = vendorMatcher(ix);
  const pages = new Map<string, { host: string; title: string | null; resps: Set<string>; prompts: Set<string>; comps: Map<string, number> }>();
  for (const [rid, cs] of ix.compsByResp) {
    if (ix.ownNamed.has(rid)) continue;
    const names = uniq(cs.map((m) => ix.compById.get(m.brandId!)!.name));
    const seen = new Set<string>();
    for (const c of ix.metricCits.get(rid) ?? []) {
      const host = hostOf(c);
      if (!host || domainMatches(host, own.domains) || ix.competitors.some((b) => domainMatches(host, b.domains))) continue;
      if (communityGroup(c.url) || NO_OUTREACH.some((re) => re.test(host)) || REVIEW_SITES.test(host) || vendorOf(host) || opts.skipHosts?.has(host)) continue;
      if (own.kind === 'portal' && sourceKindOf(host) === 'comparison') continue;
      const u = cleanUrl(c.url);
      if (seen.has(u)) continue;
      seen.add(u);
      const e = pages.get(u) ?? { host, title: c.title, resps: new Set(), prompts: new Set(), comps: new Map() };
      e.title ||= c.title;
      e.resps.add(rid);
      e.prompts.add(ix.respById.get(rid)!.promptId);
      for (const n of names) e.comps.set(n, (e.comps.get(n) ?? 0) + 1);
      pages.set(u, e);
    }
  }
  // Liste/Vergleich: am Titel bzw. Pfad erkennbar („beste“, „Top 10“, „Alternativen“, „vs“, „Tools“ …)
  const listLike = (u: string, t: string | null) => { try { return LIST_RE.test(`${t ?? ''} ${decodeURIComponent(new URL(u).pathname).replace(/[-_/]+/g, ' ')}`); } catch { return false; } };
  const rows = [...pages.entries()].filter(([u, e]) => e.resps.size >= 2 && listLike(u, e.title))
    .sort((a, b) => b[1].resps.size - a[1].resps.size || b[1].comps.size - a[1].comps.size || a[0].localeCompare(b[0]));
  if (!rows.length || (rows.length < 2 && rows[0][1].resps.size < 3)) return [];
  const top = rows.slice(0, LISTICLE_MAX);
  const affected = new Set(top.flatMap(([, e]) => [...e.resps]));
  const share = affected.size / ix.N;
  const comps = new Map<string, number>();
  for (const [, e] of top) for (const [n, v] of e.comps) comps.set(n, (comps.get(n) ?? 0) + v);
  const compNames = [...comps.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const list = top.slice(0, 3).map(([u]) => shortPath(u)).join(', ');
  const examples: Example[] = top.slice(0, 5).map(([url, e]) => {
    const rid = [...e.resps][0];
    const r = ix.respById.get(rid)!;
    const m = (ix.compsByResp.get(rid) ?? []).sort((a, b) => a.position - b.position)[0];
    return { prompt: ix.promptText(r.promptId), engine: r.engine, url, title: titleFromUrl(url, e.title), snippet: m?.snippet ? quote(m.snippet) : undefined };
  });
  const n = top.length;
  return [make(ix.lang, {
    key: 'listicle:roundups',
    type: 'listicle',
    text: (l) => l === 'en' ? {
      title: `Get ${own.name} into ${n} best-of lists and comparison articles`,
      why: `${n} list and comparison ${n === 1 ? 'article is a source' : 'articles are sources'} in ${affected.size} of ${ix.N} answers that name ${compNames[0]}, but not ${own.name}.`,
      steps: [
        `Start with these articles: ${list} – who writes them, when were they last updated, which providers are listed and by which criteria?`,
        'Find out how providers get included: contact the author or editor, a submission form, or an affiliate/partner program (imprint, “for vendors”, footer).',
        `Send the author a short fact sheet that matches the article’s criteria (category, target group, pricing, customer examples) plus a test account – facts, not marketing copy.`,
        'Paid placements only if the article marks them as advertising; never offer hidden rewards for a positive mention.',
        `After it’s published, wait for the next measurement: is ${own.name} named in answers that use these articles?`,
      ],
    } : {
      title: `${own.name} in ${n} Bestenlisten und Vergleichsartikel bringen`,
      why: `${n} Listen- und Vergleichsartikel sind Quelle in ${affected.size} von ${ix.N} Antworten, die ${compNames[0]} nennen, ${own.name} aber nicht.`,
      steps: [
        `Mit diesen Artikeln beginnen: ${list} – wer schreibt dort, wann zuletzt aktualisiert, welche Anbieter stehen drin und nach welchen Kriterien?`,
        'Herausfinden, wie Anbieter aufgenommen werden: Autor bzw. Redaktion direkt, Einreichungsformular oder Affiliate-/Partnerprogramm (Impressum, „Für Anbieter“, Fußzeile).',
        'Dem Autor ein kurzes Faktenblatt passend zu den Kriterien des Artikels schicken (Kategorie, Zielgruppe, Preise, Kundenbeispiele) plus Testzugang – Fakten statt Werbetext.',
        'Bezahlte Platzierungen nur, wenn der Artikel sie als Anzeige kennzeichnet; nie verdeckte Gegenleistungen für eine positive Nennung anbieten.',
        `Nach der Veröffentlichung die nächste Messung abwarten: Wird ${own.name} in Antworten mit diesen Artikeln als Quelle genannt?`,
      ],
    },
    impact: share >= 0.15 ? 3 : share >= 0.03 ? 2 : 1,
    effort: 2,
    reach: share,
    evidence: {
      metrics: { responses: ix.N, affected: affected.size, share, pages: n, candidates: rows.length },
      examples,
      promptIds: uniq(top.flatMap(([, e]) => [...e.prompts])),
      urls: top.map(([url, e]) => ({ url, title: titleFromUrl(url, e.title), count: e.resps.size })),
      competitors: compNames.slice(0, 6).map((name) => ({ name, count: comps.get(name)! })),
      domains: uniq(top.map(([, e]) => e.host)),
    },
    signature: { u: top.slice(0, 3).map(([u]) => u), b: bucket(share) },
  })];
}

// ---------------------------------------------------------------------------
// reviews: Bewertungsportale (G2, Capterra, OMR Reviews, Trustpilot …)
// ---------------------------------------------------------------------------
export function ruleReviews(ix: Indexed): Candidate[] {
  const own = ix.own;
  if (!own) return [];
  const ownKey = brandKey(own.name);
  const hosts = new Map<string, { resps: Set<string>; compResps: Set<string>; urls: Map<string, { title: string | null; n: number }>; prompts: Set<string> }>();
  for (const [rid, cs] of ix.metricCits) {
    for (const c of cs) {
      const host = hostOf(c);
      if (!REVIEW_SITES.test(host)) continue;
      const e = hosts.get(host) ?? { resps: new Set(), compResps: new Set(), urls: new Map(), prompts: new Set() };
      e.resps.add(rid);
      e.prompts.add(ix.respById.get(rid)!.promptId);
      if (ix.compsByResp.has(rid) && !ix.ownNamed.has(rid)) e.compResps.add(rid);
      const u = cleanUrl(c.url);
      const ue = e.urls.get(u) ?? { title: c.title, n: 0 };
      ue.n++; ue.title ||= c.title;
      e.urls.set(u, ue);
      hosts.set(host, e);
    }
  }
  const rows = [...hosts.entries()].sort((a, b) => b[1].resps.size - a[1].resps.size || a[0].localeCompare(b[0]));
  const affected = new Set(rows.flatMap(([, e]) => [...e.resps]));
  if (affected.size < 2) return [];
  const share = affected.size / ix.N;
  const compOnly = new Set(rows.flatMap(([, e]) => [...e.compResps]));
  // eigenes Profil schon von einer KI genutzt? (Markenname im Pfad, z. B. g2.com/products/synera)
  const ownProfiles = rows.flatMap(([, e]) => [...e.urls.keys()]).filter((u) => ownKey.length >= 3 && new URL(u).pathname.split('/').some((seg) => {
    // ganzes Pfadsegment oder Wortfolge darin (synera, synera-gmbh), nicht Teilwort („nova“ ≠ „innovation“)
    const toks = seg.toLowerCase().split(/[-_.]+/).map(brandKey).filter(Boolean);
    return toks.some((_, i) => toks.slice(i).some((__, j) => toks.slice(i, i + j + 1).join('') === ownKey));
  }));
  const names = rows.slice(0, 3).map(([h]) => h);
  const comps = new Map<string, number>();
  for (const rid of affected) for (const m of ix.compsByResp.get(rid) ?? []) { const n = ix.compById.get(m.brandId!)!.name; comps.set(n, (comps.get(n) ?? 0) + 1); }
  const compNames = [...comps.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const examples: Example[] = rows.flatMap(([, e]) => [...e.urls.entries()].slice(0, 2)).slice(0, 5).map(([url, u]) => {
    const c = ix.cits.find((x) => cleanUrl(x.url) === url)!;
    const r = ix.respById.get(c.responseId)!;
    return { prompt: ix.promptText(r.promptId), engine: r.engine, url, title: titleFromUrl(url, u.title) };
  });
  return [make(ix.lang, {
    key: 'reviews:profiles',
    type: 'reviews',
    text: (l) => l === 'en' ? {
      title: `Maintain review profiles on ${listL(names.slice(0, 2), 'en')}`,
      why: `Review sites like ${names[0]} are a source in ${affected.size} of ${ix.N} answers${compNames[0] ? ` – often next to ${compNames[0]}` : ''}.`,
      steps: [
        `${ownProfiles.length ? `AI already uses your profile (${shortPath(ownProfiles[0])}); check the others too: ` : 'Check whether '}${own.name} has a complete profile on ${listL(names, 'en')}; if not, claim or create it (description, category, pricing, screenshots, integrations).`,
        'Pick the categories that match the questions in your measurement – AI uses review sites to compare providers within a category.',
        'Ask happy customers for honest reviews, e.g. 10 emails after a successful project. No fake or bought reviews and no rewards that depend on a positive rating – that breaks platform rules and consumer-protection law.',
        'Reply to reviews in a factual tone, including critical ones, and link the profiles from your website.',
      ],
    } : {
      title: `Bewertungsprofile auf ${listL(names.slice(0, 2), 'de')} pflegen`,
      why: `Bewertungsportale wie ${names[0]} sind Quelle in ${affected.size} von ${ix.N} Antworten${compNames[0] ? ` – oft neben ${compNames[0]}` : ''}.`,
      steps: [
        `${ownProfiles.length ? `Dein Profil wird schon genutzt (${shortPath(ownProfiles[0])}); die anderen auch prüfen: ` : 'Prüfen, ob '}${own.name} auf ${listL(names, 'de')} ein vollständiges Profil hat; falls nicht, übernehmen bzw. anlegen (Beschreibung, Kategorie, Preise, Screenshots, Integrationen).`,
        'Die Kategorien wählen, die zu den Fragen der Messung passen – KIs nutzen Bewertungsportale, um Anbieter einer Kategorie zu vergleichen.',
        'Zufriedene Kunden um ehrliche Bewertungen bitten, z. B. 10 Mails nach einem erfolgreichen Projekt. Keine gekauften oder gefälschten Bewertungen und keine Belohnung, die von einer positiven Bewertung abhängt – das verstößt gegen Portalregeln und UWG.',
        'Auf Bewertungen sachlich antworten, auch auf kritische, und die Profile von der eigenen Website verlinken.',
      ],
    },
    impact: share >= 0.1 ? 3 : share >= 0.02 ? 2 : 1,
    effort: 2,
    reach: share,
    evidence: {
      metrics: { responses: ix.N, affected: affected.size, share, competitorOnly: compOnly.size, portals: rows.length },
      examples,
      promptIds: uniq(rows.flatMap(([, e]) => [...e.prompts])),
      domains: rows.map(([h]) => h),
      urls: rows.flatMap(([, e]) => [...e.urls.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3)).slice(0, 8).map(([url, u]) => ({ url, title: titleFromUrl(url, u.title), count: u.n })),
      competitors: compNames.slice(0, 6).map((name) => ({ name, count: comps.get(name)! })),
      ownProfiles: ownProfiles.slice(0, 3),
    },
    signature: { h: names, b: bucket(share), o: ownProfiles.length > 0 },
  })];
}

// ---------------------------------------------------------------------------
// entity: Wikidata / Wikipedia
// ---------------------------------------------------------------------------
const WIKIPEDIA = /(^|\.)wikipedia\.org$/;
export function ruleEntity(ix: Indexed, checks: SiteCheckResult[] | undefined): Candidate[] {
  const own = ix.own;
  if (!own || !checks?.length) return [];
  const wd = checks.map((c) => c.wikidata).filter((w): w is NonNullable<SiteCheckResult['wikidata']> => !!w);
  if (!wd.length || wd.every((w) => w.status === 'error')) return [];
  const found = wd.find((w) => w.status === 'found');
  // Wikipedia als Quelle (alle Quellen, auch nur gelesene: Wikipedia prägt das Grundwissen der Modelle)
  const wikiResps = new Set<string>();
  const articles = new Map<string, { title: string | null; n: number }>();
  for (const [rid, cs] of ix.allCits) {
    for (const c of cs) {
      if (!WIKIPEDIA.test(hostOf(c))) continue;
      wikiResps.add(rid);
      const u = cleanUrl(c.url);
      const a = articles.get(u) ?? { title: c.title, n: 0 };
      a.n++; a.title ||= c.title;
      articles.set(u, a);
    }
  }
  const share = wikiResps.size / ix.N;
  // Wikipedia-Artikel unbekannt (Sitelinks-Abfrage gescheitert): keine Aussage
  if (found && found.wikipedia === null) return [];
  const hasWikipedia = !!found?.wikipedia?.length;
  if (hasWikipedia) return [];
  // mit Wikidata-Eintrag, aber ohne Wikipedia: nur relevant, wenn die KIs Wikipedia hier oft nutzen
  if (found && share < 0.2) return [];
  const top = [...articles.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 5);
  const wikiTitle = (u: string, t: string | null) => {
    if (t?.trim()) return t.replace(/\s+[–—-]\s+Wikipedia$/i, '').trim();
    try { return decodeURIComponent(new URL(u).pathname.split('/').pop() ?? '').replace(/_/g, ' ') || u; } catch { return u; }
  };
  const artList = (l: Lang) => top.slice(0, 3).map(([u, a]) => (l === 'en' ? `“${wikiTitle(u, a.title)}”` : `„${wikiTitle(u, a.title)}“`)).join(', ');
  const domain = own.domains[0];
  const wikiWhy = (l: Lang) => (l === 'en'
    ? share >= 0.01 ? `Wikipedia is a source in ${wikiResps.size} of ${ix.N} answers` : 'Wikipedia shapes what models know about companies'
    : share >= 0.01 ? `Wikipedia ist Quelle in ${wikiResps.size} von ${ix.N} Antworten` : 'Wikipedia prägt, was Modelle über Firmen wissen');
  return [make(ix.lang, {
    key: 'entity:wikidata',
    type: 'entity',
    text: (l) => l === 'en' ? {
      title: found ? `Build Wikipedia presence for ${own.name} via independent sources` : `Create a Wikidata item for ${own.name}`,
      why: found
        ? `${wikiWhy('en')}; ${own.name} has a Wikidata item but no Wikipedia article.`
        : `${wikiWhy('en')}; there’s no Wikidata item listing ${domain} as the official website.`,
      steps: [
        found
          ? `Complete the Wikidata item (${found.ids[0]}): description, official website, founding date, headquarters, industry, LinkedIn – each with a reliable source.`
          : `First search wikidata.org for “${own.name}” – an item may exist without (or with a different) official website; then add ${domain} there instead of creating a duplicate. Otherwise create a Wikidata item: name, one-line description (“${own.name}, …”), official website ${domain}, founding date, headquarters, industry, LinkedIn – only facts with public, reliable sources (press, register entry). Wikidata requires that the company is identifiable through such sources.`,
        'Disclose your conflict of interest on your user page – paid or employer-related edits must be disclosed under the Wikimedia terms of use.',
        `Don’t write or commission a Wikipedia article about ${own.name}: relevance criteria and conflict-of-interest rules make that risky. Wikipedia presence comes from independent coverage (trade press, studies, analyst reports) – work on that first.`,
        top.length
          ? `In the articles the AI reads (${artList('en')}) suggest additions at most on the talk page, with disclosure and independent sources – no promotional edits.`
          : 'Link the Wikidata item from your website (sameAs, task for your web agency) and from your profiles.',
      ],
    } : {
      title: found ? `Wikipedia-Präsenz für ${own.name} über unabhängige Quellen aufbauen` : `Wikidata-Eintrag für ${own.name} anlegen`,
      why: found
        ? `${wikiWhy('de')}; ${own.name} hat einen Wikidata-Eintrag, aber keinen Wikipedia-Artikel.`
        : `${wikiWhy('de')}; einen Wikidata-Eintrag mit ${domain} als offizieller Website gibt es nicht.`,
      steps: [
        found
          ? `Den Wikidata-Eintrag (${found.ids[0]}) vervollständigen: Beschreibung, offizielle Website, Gründung, Sitz, Branche, LinkedIn – jeweils mit seriöser Quelle.`
          : `Zuerst auf wikidata.org nach „${own.name}“ suchen – ein Eintrag kann existieren, aber ohne oder mit anderer Website-Angabe; dann dort die offizielle Website ${domain} ergänzen statt einen zweiten anzulegen. Sonst einen Wikidata-Eintrag anlegen: Name, Kurzbeschreibung („${own.name}, …“), offizielle Website ${domain}, Gründung, Sitz, Branche, LinkedIn – nur Angaben mit öffentlichen, seriösen Belegen (Presse, Handelsregister). Wikidata verlangt, dass das Unternehmen über solche Quellen identifizierbar ist.`,
        'Interessenkonflikt auf der Benutzerseite offenlegen – bezahlte bzw. vom Arbeitgeber veranlasste Bearbeitungen müssen laut Wikimedia-Nutzungsbedingungen offengelegt werden.',
        `Keinen Wikipedia-Artikel über ${own.name} selbst schreiben oder in Auftrag geben: Relevanzkriterien und Interessenkonflikt-Regeln machen das riskant. Wikipedia-Präsenz entsteht über unabhängige Berichterstattung (Fachmedien, Studien, Analystenberichte) – daran zuerst arbeiten.`,
        top.length
          ? `In den Artikeln, die die KIs lesen (${artList('de')}), Ergänzungen höchstens auf der Diskussionsseite vorschlagen – mit Offenlegung und unabhängigen Belegen, keine Werbe-Edits.`
          : 'Den Wikidata-Eintrag von der Website (sameAs, Aufgabe der Webagentur) und den Profilen aus verlinken.',
      ],
    },
    impact: !found && share >= 0.2 ? 2 : 1,
    effort: 1,
    certainty: 'uncertain',
    reach: Math.min(1, share),
    evidence: {
      metrics: { responses: ix.N, wikipediaResponses: wikiResps.size, share },
      examples: [],
      domain,
      wikidata: found ? { ids: found.ids, wikipedia: found.wikipedia } : null,
      urls: top.map(([url, a]) => ({ url, title: wikiTitle(url, a.title), count: a.n })),
    },
    signature: { f: !!found, b: bucket(share) },
  })];
}

/** Alle Regeln auf eine Messung anwenden. Ohne eigene Marke gibt es keine Maßnahmen. */
export function buildCandidates(d: RecData): Candidate[] {
  const ix = indexData(d);
  if (!ix.own || !ix.N) return [];
  const outreach = ruleOutreach(ix);
  const all = [
    ...ruleNameOnOwnPage(ix, d),
    ...outreach,
    ...ruleContentGap(ix, d),
    ...ruleComparison(ix, d),
    // Listen auf Domains, die schon eine eigene Outreach-Maßnahme haben, nicht doppelt
    ...ruleListicle(ix, { skipHosts: new Set(outreach.map((c) => c.evidence.domain).filter((x): x is string => !!x)) }),
    ...ruleReviews(ix),
    ...ruleEntity(ix, d.siteChecks),
    ...ruleCommunity(ix),
    ...ruleTechnical(ix, d.siteChecks),
    ...ruleSearchIndex(ix, d.siteChecks),
    ...rulePositioning(ix),
    ...ruleSentiment(ix),
  ];
  return all.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}
