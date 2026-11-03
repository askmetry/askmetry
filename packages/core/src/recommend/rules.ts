// Regelbasierte Maßnahmen-Kandidaten: jede mit stabilem key, Evidenz (Zahlen + 1–5 Beispiele) und deutschen Standardtexten.
// Die Texte funktionieren ohne KI; phrase.ts kann sie optional verbessern.
import {
  cleanUrl, communityGroup, domainMatches, engineLabel, groupBy, hostOf, indexData, normName, pct, shortPath, titleFromUrl,
  type Indexed, type RecData, type SiteCheckResult,
} from './data.ts';
import { isLikelyCompetitor } from './present.ts';

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

export interface Candidate {
  key: string;
  type: RecType;
  title: string;
  why: string;
  steps: string[];
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
const listDe = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} und ${xs[xs.length - 1]}`);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const enginesOf = (ix: Indexed, rids: Iterable<string>) => uniq([...rids].map((r) => ix.respById.get(r)?.engine ?? '')).filter(Boolean);
const ENGINE_ORDER = ['chatgpt', 'gemini', 'claude', 'perplexity', 'google_aio', 'google_ai_mode', 'mock'];
const sortEngines = (es: string[]) => [...es].sort((a, b) => (ENGINE_ORDER.indexOf(a) + 1 || 99) - (ENGINE_ORDER.indexOf(b) + 1 || 99));
const engineNames = (es: string[]) => listDe(sortEngines(es).map(engineLabel));

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
function make(c: Omit<Candidate, 'priority'>): Candidate {
  return { ...c, title: clipText(c.title, TITLE_MAX), why: clipText(c.why, WHY_MAX), priority: priorityOf(c.impact, c.reach, c.effort) };
}
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
  return [make({
    key: 'name_on_own_page',
    type: 'name_on_own_page',
    title: `${own.name} auf den Seiten nennen, die KIs schon nutzen`,
    why: `KIs nutzen ${domain} in ${usedTotal} von ${ix.N} Antworten als Quelle – in ${affected.length} davon fehlt der Name ${own.name}.`,
    // Belegt ist: KIs übernehmen Fakten, Zahlen und Zitate aus einer Seite. Den Markennamen nennen sie vor allem, wenn er an
    // eigene Daten/Werkzeuge gebunden ist oder die Seite die Marke klar als Kategorie-Akteur ausweist – nicht durch Namen in jedem Titel.
    steps: [
      `Diese Seiten zuerst überarbeiten: ${pages.slice(0, 5).map(([u]) => shortPath(u)).join(', ')}.`,
      `Im ersten Absatz einmal sagen, wer hier informiert – Marke plus Kategorie, z. B. „${own.name}, ${own.kind === 'portal' ? 'das Vergleichsportal für …' : 'die Lösung für …'}“. Überschriften bleiben sachlich, kein Markenname in jedem Titel.`,
      `Eigene Daten, Tabellen und Rechner als Werk von ${own.name} benennen (z. B. „${own.name}-Kostenvergleich ${d.at.getFullYear()}“) – zitierfähige Zahlen werden mit Quelle übernommen.`,
      `Title-Tag mit Marken-Suffix prüfen („… | ${own.name}“), wie im SEO üblich – nur ergänzen, wenn es fehlt.`,
      `Autorenkasten bzw. „Über ${own.name}“-Absatz mit einem gleichlautenden Satz zur Positionierung auf allen diesen Seiten.`,
    ],
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
export function outreachExclusionsFrom(ix: Indexed, opts: { max?: number; minResponses?: number } = {}): OutreachExclusion[] {
  return outreachScan(ix, opts).excluded;
}

export function ruleOutreach(ix: Indexed, opts: { max?: number; minResponses?: number } = {}): Candidate[] {
  return outreachScan(ix, opts).candidates;
}

function outreachScan(ix: Indexed, opts: { max?: number; minResponses?: number } = {}): { candidates: Candidate[]; excluded: OutreachExclusion[] } {
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
  const reasonText = (r: OutreachExclusionReason, d: string | null) => ({
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
    const why = `${host} ist in ${e.resps.size} von ${ix.N} Antworten Quelle, die ${compNames[0] ?? 'Wettbewerber'} nennen, ${own.name} aber nicht.`;
    const t = outreachText(sk, host, own.name, portal, pages, compNames);
    return make({
      key: `outreach:${host}`,
      type: 'outreach',
      title: t.title,
      why,
      steps: [
        ...t.steps,
        `Nach der Veröffentlichung die nächste Messung abwarten: Taucht ${own.name} in Antworten mit ${host} als Quelle auf?`,
      ],
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
function outreachText(sk: SourceKind, host: string, brand: string, portal: boolean, pages: string, comps: string[]): { title: string; steps: string[] } {
  const cmp = comps.length ? ` (dort genannt: ${listDe(comps.slice(0, 3))})` : '';
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
  const q = t.endsWith('?') ? t : /^(welche|wie|was|wo|wann|warum|wer|lohnt|ist|sind|kann)\b/i.test(t) ? `${t}?` : t;
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
    out.push(make({
      key: `content_gap:${st.pid}`,
      type: 'content_gap',
      title: `Seite zu „${q(text, 44)}“ ${basePage ? 'ausbauen' : 'erstellen'}`,
      why: `Bei dieser Frage nennen ${st.withComp} von ${st.n} Antworten ${listDe((comps.length ? comps : others).slice(0, 2))}, ${own.name} ${st.own === 1 ? 'nur einmal' : st.own ? `nur ${st.own}-mal` : 'nie'}.`,
      steps: [
        `${basePage ? `Bestehende Seite ${shortPath(basePage)} gezielt auf diese Frage ausrichten` : `Eine eigene Seite anlegen, die genau diese Frage beantwortet${ownPages.length ? ` (und von ${shortPath(ownPages[0])} aus verlinken)` : ''}`} – Titelvorschlag: „${title}“.`,
        'Gleich am Anfang eine klare Antwort in zwei bis drei Sätzen geben, danach Details, eine Vergleichstabelle und häufige Fragen.',
        `${own.name} ausdrücklich in die Antwort einbinden – mit überprüfbaren Fakten (z. B. Preise, Leistungen, Zielgruppe) und einer klaren Aussage, wann ${own.name} weiterhilft.`,
        `Die genannten Alternativen (${listDe((comps.length ? comps : others).slice(0, 3))}) fair einbeziehen – KIs bevorzugen ausgewogene Quellen.`,
        'Die Seite von passenden bestehenden Seiten aus verlinken.',
      ],
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
    if (e.g.kind === 'reddit') {
      return make({
        ...base,
        title: e.g.id === 'reddit' ? 'Auf Reddit hilfreich mitdiskutieren' : `In ${e.g.label} hilfreich mitdiskutieren`,
        why: `Die KIs lesen ${e.g.label} in ${e.resps.size} von ${ix.N} Antworten mit – bei Fragen, in denen ${own.name} kaum vorkommt.`,
        steps: [
          `Diese Threads lesen: ${threadList}. Welche Fragen, Einwände und Empfehlungen tauchen auf?`,
          `Mit einem persönlichen Konto sachlich antworten und offenlegen, dass du für ${own.name} arbeitest – erst helfen, nur verlinken, wenn der Link die Frage wirklich beantwortet.`,
          `Vorher die Regeln von ${e.g.label} lesen; keine Fake-Konten, gekauften Upvotes oder Werbeposts – Astroturfing verstößt gegen die Reddit-Regeln und schadet der Marke.`,
          'Wiederkehrende Fragen aus den Threads zusätzlich auf der eigenen Website beantworten (FAQ oder Ratgeber).',
        ],
      });
    }
    if (e.g.kind === 'youtube') {
      return make({
        ...base,
        title: 'Erklärvideos auf YouTube zu diesen Fragen veröffentlichen',
        why: `YouTube-Videos fließen in ${e.resps.size} von ${ix.N} Antworten ein – bei Fragen, in denen ${own.name} kaum vorkommt.`,
        steps: [
          `Diese Videos ansehen: ${threadList} – was wird gezeigt, was fehlt?`,
          `Ein kurzes Erklärvideo zur Frage „${prompts[0]}“ produzieren, mit klarer Antwort in den ersten 30 Sekunden.`,
          'Titel und Beschreibung wie die Frage formulieren, Kapitelmarken setzen und ein vollständiges Transkript bzw. Untertitel hochladen – KIs werten den Text aus.',
          'Das Video auf der passenden Seite der eigenen Website einbetten.',
        ],
      });
    }
    return make({
      ...base,
      title: `Im Forum ${e.g.label} Fragen beantworten`,
      why: `Beiträge aus ${e.g.label} fließen in ${e.resps.size} von ${ix.N} Antworten ein – bei Fragen, in denen ${own.name} kaum vorkommt.`,
      steps: [
        `Diese Beiträge lesen: ${threadList}.`,
        `Mit einem Konto, das ${own.name} offen als Arbeitgeber nennt, fachlich antworten – ohne Werbesprache und gemäß Forenregeln.`,
        'Häufige Fragen aus dem Forum auf der eigenen Website ausführlich beantworten.',
      ],
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
    let allRedirected = true;
    for (const c of blocked) {
      const target = c.home.finalUrl ? hostOf({ url: c.home.finalUrl, domain: '' }) : '';
      const tc = checks.find((x) => x !== c && target && domainMatches(target, [x.domain]));
      if (target && !domainMatches(target, [c.domain]) && tc && !tc.robots.blocked.some((b) => c.robots.blocked.includes(b))) {
        redirectNotes.push(`${c.domain} leitet auf ${target} weiter, wo diese Crawler erlaubt sind – die Sperre betrifft nur Links, die noch auf ${c.domain} zeigen.`);
      } else allRedirected = false;
    }
    const level = answerBots.length ? 3 : gemini ? 2 : 1;
    const impact = Math.max(1, level - (allRedirected ? 1 : 0)) as 1 | 2 | 3;
    const cloudflare = blocked.some((c) => c.robots.managedBy === 'cloudflare');
    const consequence = answerBots.length
      ? `Damit können ${listDe(answerBots)} die Seiten nicht abrufen – sie fehlen als Quelle in den Antworten.`
      : gemini
        ? `Die Such-Crawler von ChatGPT, Claude und Perplexity dürfen zugreifen. Google-Extended steuert aber, ob Gemini die Inhalte für Antworten (Grounding) nutzen darf${training.length ? `; ${listDe(training)} betreffen nur das Training der Modelle` : ''}.`
        : `Die Such-Crawler dürfen zugreifen; gesperrt sind nur Trainings-Crawler. Das beeinflusst nicht die Websuche, aber langfristig, was die Modelle ohne Suche über ${own.name} wissen.`;
    out.push(make({
      key: 'technical:robots', type: 'technical',
      title: answerBots.length
        ? 'KI-Such-Crawler in der robots.txt freigeben'
        : `robots.txt-Sperre für ${gemini ? 'Gemini und Trainings-Crawler' : 'Trainings-Crawler'} prüfen`,
      why: answerBots.length
        ? `Die robots.txt sperrt ${listDe(answerBots.slice(0, 2))}${answerBots.length > 2 ? ' u. a.' : ''} – deren KI-Suchen können die Seiten nicht abrufen.`
        : `Die robots.txt sperrt ${listDe(bots.slice(0, 3))}; die Such-Crawler dürfen zugreifen.`,
      // ausführliche Einordnung für Detailansicht und Claude-Prompt

      steps: [
        `robots.txt ansehen: ${blocked.map((c) => `https://${c.domain}/robots.txt`).join(', ')}.`,
        cloudflare
          ? 'Die Datei wird von Cloudflare verwaltet („Managed robots.txt“ bzw. AI Crawl Control) – die Einstellung im Cloudflare-Dashboard anpassen, nicht die Datei selbst.'
          : `Für die gewünschten Bots die Disallow-Regel entfernen oder „Allow: /“ setzen.`,
        answerBots.length
          ? 'Mindestens die Such-Bots OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot und Googlebot zulassen – sie entscheiden über die Sichtbarkeit in Antworten.'
          : `Bewusst entscheiden: ${[gemini ? 'Google-Extended freigeben, wenn Gemini die Inhalte für Antworten nutzen soll' : '', training.length ? `Trainings-Crawler (${training.join(', ')}) dürfen gesperrt bleiben, wenn das gewollt ist` : ''].filter(Boolean).join('; ')}.`,
        'Hinweis: Google AI Overviews und AI Mode richten sich nach Googlebot, nicht nach Google-Extended.',
      ],
      impact, effort: 1, reach: allRedirected ? 0.1 : level === 3 ? 1 : level === 2 ? 0.4 : 0.2,
      evidence: {
        metrics: { ...metricsBase, blockedBots: bots.length, blockedAnswerBots: answerBots.length },
        examples: [], domains: domainsOf(blocked), blockedBots: bots, answerBots, redirects: redirectNotes, managedBy: cloudflare ? 'cloudflare' : null, consequence,
      },
      signature: { bots: [...bots].sort(), r: allRedirected },
    }));
  }

  const lowText = ok.filter((c) => (c.home.textChars ?? 0) < 500);
  if (lowText.length) {
    out.push(make({
      key: 'technical:js_text', type: 'technical',
      title: 'Inhalte ohne JavaScript auslieferbar machen',
      why: `Ohne JavaScript zeigt die Startseite nur ${Math.min(...lowText.map((c) => c.home.textChars ?? 0))} Zeichen Text – viele KI-Crawler sehen die Inhalte nicht.`,
      steps: [
        'Mit der Entwicklung klären, ob die Seiten serverseitig gerendert oder vorgerendert werden können (SSR/SSG).',
        'Prüfen: Seite mit deaktiviertem JavaScript im Browser öffnen – Überschriften, Texte und Preise müssen sichtbar sein.',
        'Mindestens die wichtigsten Seiten (Startseite, Produkt, Preise, Ratgeber) als HTML mit Text ausliefern.',
      ],
      impact: 3, effort: 3, reach: 1,
      evidence: { metrics: { ...metricsBase, minTextChars: Math.min(...lowText.map((c) => c.home.textChars ?? 0)) }, examples: [], domains: domainsOf(lowText) },
      signature: { d: domainsOf(lowText) },
    }));
  }

  const noSchema = ok.filter((c) => !c.home.jsonLd.some(isEntitySchema));
  if (noSchema.length) {
    out.push(make({
      key: 'technical:structured_data', type: 'technical',
      title: 'Unternehmensdaten als Organization-Schema hinterlegen',
      why: 'Der Startseite fehlt ein Organization-Schema – kein direkter Hebel für Zitate, hilft KIs aber, die Marke eindeutig zuzuordnen.',
      steps: [
        `Organization-Schema (JSON-LD) auf der Startseite: Name „${own.name}“, Logo, URL, Kontakt, sameAs (LinkedIn, Bewertungsprofile, Wikidata falls vorhanden).`,
        'Die Beschreibung im Schema gleichlautend zur Über-uns-Seite und zu den Profilen halten.',
        'Mit validator.schema.org prüfen.',
        'Erwartung realistisch halten: Tests zeigen keinen messbaren Zitations-Effekt durch nachträgliches Schema – das ist Grundpflege, kein Hebel.',
      ],
      impact: 1, effort: 1, reach: 0.2,
      evidence: { metrics: metricsBase, examples: [], domains: domainsOf(noSchema), jsonLdFound: uniq(noSchema.flatMap((c) => c.home.jsonLd)) },
      signature: { d: domainsOf(noSchema) },
    }));
  }

  // llms.txt: bewusst keine Maßnahme – kein KI-Anbieter nutzt sie nachweislich (Ahrefs 2026, Google: nicht unterstützt).

  const blockedHome = checks.filter((c) => c.home.status !== null && [401, 403, 429, 503].includes(c.home.status));
  if (blockedHome.length) {
    out.push(make({
      key: 'technical:bot_protection', type: 'technical',
      title: 'Bot-Schutz auf Sperren für KI-Crawler prüfen',
      why: `Die Startseite weist automatische Abrufe ab (HTTP ${blockedHome.map((c) => c.home.status).join('/')}) – womöglich auch KI-Crawler.`,
      steps: [
        'In Firewall/CDN (z. B. Cloudflare „AI Scrapers and Crawlers“) prüfen, ob KI-Bots blockiert werden.',
        'Die Such-Bots OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User und PerplexityBot gezielt zulassen.',
      ],
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
  return [make({
    key: `positioning:${normName(comp.name)}`,
    type: 'positioning',
    title: `${own.name} klar gegen ${comp.name} positionieren`,
    why: `${comp.name} steht in ${s.ahead.size} von ${s.both} gemeinsamen Antworten vor ${own.name}${s.recAhead.size ? ` und wird ${s.recAhead.size === 1 ? 'einmal' : `${s.recAhead.size}-mal`} empfohlen` : ''}.`,
    steps: [
      `Die Gründe sammeln, die die KIs für ${comp.name} nennen (siehe Belege), und ehrlich prüfen, wo ${own.name} gleichwertig oder besser ist.`,
      `Eine faire Vergleichsseite „${own.name} vs. ${comp.name}“ veröffentlichen: Tabelle mit Preisen, Funktionen und Zielgruppe, klare Aussage, für wen ${own.name} die bessere Wahl ist.`,
      `Die eigenen Stärken als kurze, zitierfähige Sätze formulieren und auf Startseite, Preisseite und FAQ einheitlich verwenden.`,
      `Kundenstimmen und Bewertungen auf den Portalen sammeln, auf denen ${comp.name} gelobt wird.`,
    ],
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
  return [make({
    key: 'sentiment:negative',
    type: 'sentiment',
    title: `Negative Aussagen über ${own.name} prüfen und richtigstellen`,
    why: `${neg.length} von ${ownMs.length} Nennungen von ${own.name} ${neg.length === 1 ? 'ist' : 'sind'} negativ.`,
    steps: [
      'Jede negative Aussage prüfen: Stimmt sie (noch)? Woher stammt sie (siehe Quellen)?',
      `Veraltete oder falsche Angaben auf der eigenen Website klar und aktuell richtigstellen (z. B. FAQ „Stimmt es, dass …?“).${topSources.length ? ` Häufigste Quellen: ${topSources.slice(0, 3).map((s) => s.domain).join(', ')}.` : ''}`,
      'Bei Drittseiten die Redaktion mit Belegen um Korrektur bitten; auf Bewertungsportalen sachlich antworten.',
      'Berechtigte Kritik intern weitergeben – und kommunizieren, wenn sie behoben ist.',
    ],
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
