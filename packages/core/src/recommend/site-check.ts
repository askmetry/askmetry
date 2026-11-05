// Technischer Website-Check der eigenen Domain(s): robots.txt (KI-Crawler), llms.txt, strukturierte Daten, Text ohne JavaScript.
// Nur GET auf öffentliche Seiten, kostenlos. Höchstens einmal pro Tag je Domain (Ergebnis in site_check).
import { db, siteCheck } from '@askmetry/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import { normalizeDomain, validateBrandDomain } from '../domains.ts';
import { PAGE_KINDS, SITE_CHECK_MAX_DOMAINS, type PageCheck, type PageKind, type SiteCheckResult } from './data.ts';
import { safeFetch, SAFE_FETCH_MAX_BYTES, type Resolver, type Transport } from './safe-fetch.ts';

export const SITE_CHECK_UA = 'Askmetry-SiteCheck/0.1';
export const SITE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Fehlgeschlagene Checks (Domain nicht erreichbar/gesperrt) werden gespeichert und erst nach 6 h wiederholt. */
export const SITE_CHECK_FAILURE_RETRY_MS = 6 * 60 * 60 * 1000;
/** Höchstens so viele Domains der eigenen Marke werden geprüft. */
export { SITE_CHECK_MAX_DOMAINS };
/** Gesamtfrist für den Website-Check eines Workspaces. */
export const SITE_CHECK_TOTAL_TIMEOUT_MS = 45_000;

/**
 * KI-Crawler, deren Zugriff geprüft wird (Produkt-Token laut Anbieter-Doku). Bingbot zählt mit: ChatGPT-Suche und Copilot
 * stützen sich stark auf den Bing-Index (Seer 2024: 87 % der ChatGPT-Zitate stehen in den Bing-Top-Ergebnissen).
 */
export const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Google-Extended', 'Googlebot', 'Bingbot',
] as const;
/** Wikimedia verlangt einen User-Agent mit Kontakt. */
export const WIKIDATA_UA = 'Askmetry-SiteCheck/0.1 (+https://askmetry.ai)';
/** Frist je Unterseite bzw. Sitemap/Wikidata-Abruf */
const SUB_TIMEOUT_MS = 8_000;

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number; url?: string; headers?: { get(name: string): string | null }; text(): Promise<string>;
}>;

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309)
// ---------------------------------------------------------------------------

export type RobotsRule = { allow: boolean; path: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

/** robots.txt in Gruppen zerlegen: aufeinanderfolgende User-agent-Zeilen bilden eine Gruppe, Regeln gelten für alle ihre Agents. */
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.replace(/^﻿/, '').split(/\r?\n|\r/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      // Produkt-Token: „Googlebot/2.1“ → „googlebot“
      cur.agents.push(value === '*' ? '*' : (/^[a-z_-]+/i.exec(value)?.[0] ?? value).toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue; // Regeln vor dem ersten User-agent ignorieren
      // leeres Disallow = alles erlaubt (keine Regel)
      if (value === '' ) continue;
      cur.rules.push({ allow: field === 'allow', path: value });
    }
    // andere Felder (Sitemap, Crawl-delay, Content-Signal …) beenden die User-agent-Folge nicht und sind keine Regel
  }
  return groups;
}

/** Regeln, die für einen Crawler gelten: alle Gruppen mit passendem Produkt-Token (zusammengeführt), sonst die *-Gruppen. */
export function rulesFor(groups: RobotsGroup[], bot: string): RobotsRule[] {
  const token = bot.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && a === token));
  if (specific.length) return specific.flatMap((g) => g.rules);
  return groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
}

function patternToRegex(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Ist der Pfad erlaubt? Längste passende Regel gewinnt, bei Gleichstand Allow (RFC 9309). */
export function isAllowed(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!patternToRegex(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** Gilt die Website für den Crawler als gesperrt? (Startseite oder eine typische Unterseite nicht erlaubt) */
export function isBotBlocked(groups: RobotsGroup[], bot: string): boolean {
  const rules = rulesFor(groups, bot);
  return !isAllowed(rules, '/') || !isAllowed(rules, '/askmetry-pruefseite-x7q/');
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/** @type-Werte aus allen JSON-LD-Blöcken (inkl. @graph und verschachtelter Objekte). */
export function extractJsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  const walk = (node: unknown, depth = 0) => {
    if (depth > 8 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    const t = (node as Record<string, unknown>)['@type'];
    // „schema:Organization“ / „https://schema.org/Organization“ → „Organization“
    for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string' && x.trim()) types.add(x.trim().replace(/^.*[/:#]/, ''));
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  for (const m of html.matchAll(re)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* ungültiges JSON-LD ignorieren */ }
  }
  return [...types];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' };

/** Sichtbarer Text ohne JavaScript (grob): Skripte, Styles, Templates und Tags entfernt, Leerraum zusammengefasst. */
export function visibleText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, e: string) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[e] ?? ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const looksLikeHtml = (s: string) => /^\s*(<!doctype|<html|<head|<body|<\?xml)/i.test(s);

const decodeAttr = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Attribute eines Start-Tags (Namen klein). */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.replace(/^<[a-z0-9]+/i, '').matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] ??= decodeAttr(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}
/** Alle Start-Tags eines Elements (ohne Kommentare und Skripte) als Attribut-Maps. */
function tagsOf(html: string, name: string): Record<string, string>[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  return [...clean.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => attrsOf(m[0]));
}
const absUrl = (href: string | undefined, base: string): string | null => {
  if (!href?.trim()) return null;
  try { const u = new URL(href.trim(), base); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; }
};
/** noindex/none als ganze Direktive; bei „bot: …“ (X-Robots-Tag) nur für alle Bots, Googlebot oder Bingbot. */
const noindexIn = (s: string | null | undefined) => !!s && s.split(',').some((part) => {
  const m = /^\s*([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(part);
  const bot = m && !/^(max-|unavailable_after)/i.test(m[1]) ? m[1].toLowerCase() : null;
  if (bot && !['googlebot', 'bingbot', 'robots'].includes(bot)) return false;
  return /^(noindex|none)$/i.test((bot ? m![2] : part).trim());
});

/** Seiten-Fakten aus HTML (ohne Abruf): Titel, Meta-Description, Canonical, noindex, Text ohne JS, JSON-LD. */
export function pageFacts(html: string, url: string, xRobotsTag?: string | null) {
  const metas = tagsOf(html, 'meta');
  const meta = (names: string[]) => metas.filter((m) => names.includes((m.name ?? '').toLowerCase())).map((m) => m.content ?? '');
  const description = meta(['description'])[0]?.replace(/\s+/g, ' ').trim() || null;
  const canonical = absUrl(tagsOf(html, 'link').find((l) => (l.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.href, url);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  return {
    title: title ? visibleText(title).slice(0, 200) : null,
    metaDescription: description ? description.slice(0, 300) : null,
    canonical,
    noindex: meta(['robots', 'googlebot', 'bingbot']).some(noindexIn) || noindexIn(xRobotsTag),
    textChars: visibleText(html).length,
    jsonLd: extractJsonLdTypes(html),
    hasH1: /<h1\b/i.test(html),
  };
}

/** <html lang> und hreflang-Alternativen der Seite. */
export function langInfo(html: string): { lang: string | null; hreflang: string[] } {
  const lang = tagsOf(html, 'html')[0]?.lang?.trim() || null;
  const hreflang = [...new Set(tagsOf(html, 'link')
    .filter((l) => (l.rel ?? '').toLowerCase().split(/\s+/).includes('alternate') && l.hreflang)
    .map((l) => l.hreflang.trim().toLowerCase()))];
  return { lang, hreflang };
}

/** Links der Seite auf denselben Host (www-Variante eingeschlossen), ohne Fragment/Query. */
export function sameHostLinks(html: string, base: string, hosts: string[]): string[] {
  const out = new Set<string>();
  for (const a of tagsOf(html, 'a')) {
    const u = absUrl(a.href, base);
    if (!u) continue;
    const p = new URL(u);
    if (!hosts.includes(p.hostname.toLowerCase().replace(/^www\./, ''))) continue;
    p.hash = ''; p.search = '';
    out.add(p.toString());
  }
  return [...out];
}

/** XML-Sitemap auswerten: Index oder URL-Liste, Anzahl <loc>, jüngstes <lastmod>, hreflang-Angaben. */
export function parseSitemap(xml: string): { index: boolean; locs: string[]; newest: string | null; hreflang: boolean } {
  const index = /<sitemapindex\b/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeAttr(m[1]));
  let newest: number | null = null;
  for (const m of xml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t) && t <= Date.now() + 86_400_000 && (newest === null || t > newest)) newest = t;
  }
  return { index, locs, newest: newest === null ? null : new Date(newest).toISOString(), hreflang: /hreflang\s*=/i.test(xml) };
}

/** ISO-639-1-Codes, die als Sprachpräfix in URLs üblich sind (nicht jede Zwei-Buchstaben-Pfadangabe wie /go/ oder /hr/). */
const LANG_CODES = new Set('de en fr it es nl pl pt cs sk sl hu ro bg el sv da no nb fi et lv lt tr ru uk ja zh ko ar he hi id th vi ms'.split(' '));
const LANG_SEG = { test: (seg: string) => { const m = /^([a-z]{2})(?:[-_][a-z]{2})?$/i.exec(seg); return !!m && LANG_CODES.has(m[1].toLowerCase()); } };
/** Blog-, News- und Presse-Bereiche: dort liegen Artikel, keine Kernseiten. */
const ARTICLE_SEG = /^(news|blog|blogs|press|presse|pressemitteilungen|magazin|magazine|webinars?|events?|artikel|articles?|insights|resources|ressourcen|case-stud(?:y|ies)|stories|podcasts?|analyst-stud(?:y|ies)|reports?|whitepapers?|studien|studies|downloads?|ebooks?|jobs|karriere|careers|team|tags?|category|kategorie|author|autor)$/i;
const KIND_SEG: Record<PageKind, RegExp> = {
  pricing: /^(preise?|pricing|prices|kosten|tarife?|plans|pakete|preismodell|preisliste)$/i,
  product: /^(produkte?|products?|platform|plattform|features|funktionen|leistungen|solutions?|loesungen|lösungen|software|services?|angebot)$/i,
  comparison: /^(vergleich|vergleiche|compare|comparison|alternativen?|alternatives?)$|^[a-z0-9]+(?:-[a-z0-9]+){0,2}-(?:vs|versus)-[a-z0-9]+(?:-[a-z0-9]+){0,2}$|^(?:alternatives?-to|alternativen-zu|alternative-zu)-|-alternative[ns]?$/i,
  faq: /^(faq|faqs|haeufige-fragen|häufige-fragen|fragen-und-antworten|hilfe|help|help-center|support)$/i,
  about: /^(ueber-uns|über-uns|about|about-us|unternehmen|company|wir|ueber-[a-z0-9-]+|über-[a-z0-9-]+)$/i,
};
const KIND_DEPTH: Record<PageKind, number> = { pricing: 2, product: 1, comparison: 3, faq: 2, about: 2 };

/** Art einer Unterseite anhand des Pfads (Sprachpräfix wie /de/ wird übersprungen); null = keine Kernseite. */
export function pageKindOf(url: string): PageKind | null {
  let segs: string[];
  try { segs = new URL(url).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase()); } catch { return null; }
  if (segs[0] && LANG_SEG.test(segs[0])) segs = segs.slice(1);
  if (!segs.length || segs.some((s) => ARTICLE_SEG.test(s)) || /\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|txt)$/i.test(segs[segs.length - 1])) return null;
  for (const kind of PAGE_KINDS) {
    if (segs.length > KIND_DEPTH[kind]) continue;
    if (segs.some((s) => KIND_SEG[kind].test(s))) return kind;
  }
  return null;
}

/** Je Art die kürzeste passende URL; Seiten ohne Sprachpräfix zuerst (Standardsprache). */
export function pickKeyPages(urls: string[]): Map<PageKind, string> {
  const best = new Map<PageKind, { url: string; score: number }>();
  for (const url of urls) {
    const kind = pageKindOf(url);
    if (!kind) continue;
    const path = new URL(url).pathname.replace(/\/$/, '');
    const segs = path.split('/').filter(Boolean);
    const score = (LANG_SEG.test(segs[0] ?? '') ? 1000 : 0) + segs.length * 100 + path.length;
    const cur = best.get(kind);
    if (!cur || score < cur.score) best.set(kind, { url, score });
  }
  return new Map([...best].map(([k, v]) => [k, v.url]));
}

/** Sprachpräfixe (/de/, /en/ …), die mindestens zweimal vorkommen – nur wenn es mindestens zwei Sprachen gibt
 * (eine Seite, die nur ihre Standardsprache oder nur /de/ hat, braucht kein hreflang). URLs ohne Präfix zählen als Standardsprache. */
export function languagePrefixes(urls: string[]): string[] {
  const n = new Map<string, number>();
  for (const u of urls) {
    try {
      const seg = new URL(u).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      const key = seg && LANG_SEG.test(seg) ? seg : '';
      n.set(key, (n.get(key) ?? 0) + 1);
    } catch { /* ungültige URL */ }
  }
  const langs = [...n].filter(([l, c]) => l && c >= 2).map(([l]) => l).sort();
  // Sprachversionen nur, wenn neben den Präfixen noch eine weitere Sprache (andere Präfixe oder Standardsprache ohne Präfix) existiert
  return langs.length >= 2 || (langs.length === 1 && (n.get('') ?? 0) >= 2) ? langs : [];
}

/** Mögliche Schreibweisen der offiziellen Website in Wikidata (P856). */
const websiteVariants = (host: string) => [`https://www.${host}/`, `https://${host}/`, `https://www.${host}`, `https://${host}`, `http://www.${host}/`, `http://${host}/`];

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

type NetOpts = { fetch?: FetchLike; timeoutMs?: number; signal?: AbortSignal; resolve?: Resolver; transport?: Transport };

/** Standard-Abruf: safeFetch (nur öffentliche Ziele, Weiterleitungen einzeln geprüft, IP gepinnt, Body ≤ 2 MB). */
function defaultFetch(opts: NetOpts): FetchLike {
  return async (url, init) => {
    const r = await safeFetch(url, { headers: init?.headers, signal: init?.signal, resolve: opts.resolve, transport: opts.transport });
    return { status: r.status, url: r.url, headers: { get: (n: string) => (n.toLowerCase() === 'x-robots-tag' ? r.xRobotsTag ?? null : null) }, text: async () => r.text };
  };
}

async function get(fetchFn: FetchLike, url: string, timeoutMs: number, outer?: AbortSignal, ua = SITE_CHECK_UA) {
  const t0 = Date.now();
  try {
    const signal = outer ? AbortSignal.any([AbortSignal.timeout(timeoutMs), outer]) : AbortSignal.timeout(timeoutMs);
    const res = await fetchFn(url, { headers: { 'user-agent': ua, accept: '*/*' }, signal });
    const text = (await res.text()).slice(0, SAFE_FETCH_MAX_BYTES);
    return { status: res.status, url: res.url || url, text, error: null as string | null, ms: Date.now() - t0, xRobotsTag: res.headers?.get('x-robots-tag') ?? null };
  } catch (e) {
    return { status: null, url, text: '', error: ((e as Error)?.message ?? String(e)).slice(0, 200), ms: null as number | null, xRobotsTag: null as string | null };
  }
}
type Got = Awaited<ReturnType<typeof get>>;
const okHtml = (r: Got) => r.status !== null && r.status >= 200 && r.status < 400 && !!r.text;
const bytesOf = (s: string) => new TextEncoder().encode(s).length;

/** Wikidata: Eintrag mit dieser Domain als offizieller Website (P856) und Wikipedia-Sprachversionen. Ohne API-Schlüssel. */
export async function wikidataLookup(fetchFn: FetchLike, host: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<NonNullable<SiteCheckResult['wikidata']>> {
  const t = opts.timeoutMs ?? SUB_TIMEOUT_MS;
  const q = `haswbstatement:${websiteVariants(host).map((v) => `P856=${v}`).join('|')}`;
  const search = await get(fetchFn, `https://www.wikidata.org/w/api.php?action=query&list=search&srprop=&srlimit=3&format=json&srsearch=${encodeURIComponent(q)}`, t, opts.signal, WIKIDATA_UA);
  let ids: string[];
  try {
    if (search.status !== 200) throw new Error();
    // MediaWiki meldet Fehler (Rate-Limit, maxlag, Suche gestört) mit HTTP 200 und {"error": …}
    const json = JSON.parse(search.text);
    if (json?.error || !Array.isArray(json?.query?.search)) throw new Error();
    ids = (json.query.search as { title?: string }[]).map((s) => s.title ?? '').filter((x) => /^Q\d+$/.test(x));
  } catch { return { status: 'error', ids: [], wikipedia: [] }; }
  if (!ids.length) return { status: 'none', ids: [], wikipedia: [] };
  const ent = await get(fetchFn, `https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&format=json&ids=${ids.join('|')}`, t, opts.signal, WIKIDATA_UA);
  const wikipedia = new Set<string>();
  try {
    const json = ent.status === 200 ? JSON.parse(ent.text) : null;
    if (!json?.entities || json.error) throw new Error();
    for (const e of Object.values(json.entities as Record<string, { sitelinks?: Record<string, unknown> }>)) {
      for (const k of Object.keys(e.sitelinks ?? {})) {
        const m = /^([a-z]{2,3})wiki$/.exec(k);
        if (m) wikipedia.add(m[1]);
      }
    }
  } catch {
    // Sitelinks unbekannt – Eintrag gilt als gefunden, Wikipedia-Artikel unbekannt (null)
    return { status: 'found', ids, wikipedia: null };
  }
  return { status: 'found', ids, wikipedia: [...wikipedia].sort((a, b) => (a === 'de' ? -1 : b === 'de' ? 1 : a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b))) };
}

/** robots.txt-Status, der keine Aussage zulässt: Netzfehler, 429 (Rate-Limit) und 5xx. */
export const robotsStatusUnknown = (status: number | null) => status === null || status === 429 || status >= 500;

/**
 * Eine Domain prüfen (ohne DB). Abrufe: robots.txt, llms.txt, Startseite, Sitemap (ggf. eine Teil-Sitemap),
 * bis zu 5 wichtige Unterseiten (Produkt, Preise, Vergleich, FAQ, Über uns) und – außer mit `entity: false` – zwei
 * Wikidata-Anfragen. Alles GET, ohne JavaScript, ohne API-Schlüssel.
 */
export async function checkDomain(domain: string, opts: NetOpts & { entity?: boolean } = {}): Promise<SiteCheckResult> {
  const fetchFn = opts.fetch ?? defaultFetch(opts);
  const timeout = opts.timeoutMs ?? 10_000;
  const sub = Math.min(timeout, SUB_TIMEOUT_MS);
  const host = normalizeDomain(domain) ?? domain;
  const wikidataP = opts.entity === false ? Promise.resolve(undefined) : wikidataLookup(fetchFn, host, { timeoutMs: sub, signal: opts.signal });
  const load = (base: string) => Promise.all([
    get(fetchFn, `${base}/robots.txt`, timeout, opts.signal),
    get(fetchFn, `${base}/llms.txt`, timeout, opts.signal),
    get(fetchFn, `${base}/`, timeout, opts.signal),
  ]);
  let [robotsRes, llmsRes, homeRes] = await load(`https://${host}`);
  // Apex nicht erreichbar (Netzfehler, kein HTTP-Status) → einmal www.<apex> versuchen
  if (homeRes.status === null && robotsRes.status === null && !opts.signal?.aborted) {
    const www = await load(`https://www.${host}`);
    if (www[2].status !== null || www[0].status !== null) [robotsRes, llmsRes, homeRes] = www;
  }
  const deep = await deepCheck(fetchFn, host, robotsRes, homeRes, sub, opts.signal);
  const wikidata = await wikidataP;

  // robots.txt: 2xx = auswerten; 4xx (außer 429) = keine Einschränkung; 429/5xx/Fehler = unbekannt (nicht als gesperrt werten)
  const robotsFound = robotsRes.status !== null && robotsRes.status >= 200 && robotsRes.status < 300 && !looksLikeHtml(robotsRes.text);
  const groups = robotsFound ? parseRobots(robotsRes.text) : [];
  const blocked = robotsFound ? AI_BOTS.filter((b) => isBotBlocked(groups, b)) : [];
  const allowed = robotsFound ? AI_BOTS.filter((b) => !blocked.includes(b)) : [];

  const llmsFound = llmsRes.status !== null && llmsRes.status >= 200 && llmsRes.status < 300
    && llmsRes.text.trim().length > 0 && !looksLikeHtml(llmsRes.text);

  const html = homeRes.status && homeRes.status < 400 ? homeRes.text : '';
  const f = html ? pageFacts(html, homeRes.url, homeRes.xRobotsTag) : null;
  const li = html ? langInfo(html) : { lang: null, hreflang: [] };
  return {
    domain: host,
    checkedAt: new Date().toISOString(),
    home: {
      status: homeRes.status,
      finalUrl: homeRes.url,
      error: homeRes.error,
      title: f?.title ?? null,
      textChars: f ? f.textChars : null,
      jsonLd: f?.jsonLd ?? [],
      hasH1: f?.hasH1,
      metaDescription: f?.metaDescription ?? null,
      canonical: f?.canonical ?? null,
      noindex: f?.noindex ?? false,
      lang: li.lang,
      hreflang: li.hreflang,
      ms: homeRes.ms,
      bytes: html ? bytesOf(html) : null,
    },
    robots: {
      status: robotsRes.status, found: robotsFound, error: robotsRes.error, blocked: [...blocked], allowed: [...allowed],
      managedBy: robotsFound && /cloudflare managed/i.test(robotsRes.text) ? 'cloudflare' : null,
    },
    llmsTxt: { status: llmsRes.status, found: llmsFound },
    sitemap: deep.sitemap,
    pages: deep.pages,
    languages: deep.languages,
    ...(wikidata ? { wikidata } : {}),
    // Frist (Gesamtfrist von runSiteCheck oder Aufrufer) lief während des Checks ab: Ergebnis evtl. unvollständig
    ...(opts.signal?.aborted ? { partial: true } : {}),
  };
}

/** Sitemap, Sprachversionen und wichtige Unterseiten (nach dem ersten Abruf von robots.txt und Startseite). */
async function deepCheck(fetchFn: FetchLike, host: string, robotsRes: Got, homeRes: Got, timeout: number, signal?: AbortSignal) {
  let origin = `https://${host}`;
  try { if (homeRes.status !== null) origin = new URL(homeRes.url).origin; } catch { /* Standard */ }
  const finalHost = (() => { try { return new URL(origin).hostname.toLowerCase().replace(/^www\./, ''); } catch { return host; } })();
  const hosts = [...new Set([host, finalHost])];
  // Sitemap: „Sitemap:“-Zeilen der robots.txt (nur bei gültiger robots.txt), sonst /sitemap.xml
  const robotsOk = robotsRes.status !== null && robotsRes.status >= 200 && robotsRes.status < 300 && !looksLikeHtml(robotsRes.text);
  const declared = robotsOk ? [...robotsRes.text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => absUrl(m[1], origin)).filter((u): u is string => !!u) : [];
  const isXml = (r: Got) => r.status !== null && r.status >= 200 && r.status < 300 && /<(urlset|sitemapindex)\b/i.test(r.text.slice(0, 5000));
  // bis zu 3 deklarierte Sitemaps nacheinander, die erste lesbare zählt
  const candidates = declared.length ? [...new Set(declared)].slice(0, 3) : [`${origin}/sitemap.xml`];
  let smRes: Got = await get(fetchFn, candidates[0], timeout, signal);
  // nicht auswertbar statt „fehlt“: komprimiert (.gz), 401/403 (WAF/Login), deklariert aber kein XML
  let unreadable = false;
  for (let i = 0; ; i++) {
    if (isXml(smRes)) break;
    const gz = /\.gz($|\?)/i.test(candidates[i]);
    if (gz || smRes.status === 401 || smRes.status === 403 || (declared.length && smRes.status !== null && smRes.status < 300)) unreadable = true;
    if (i + 1 >= candidates.length) break;
    smRes = await get(fetchFn, candidates[i + 1], timeout, signal);
  }
  let parsed = isXml(smRes) ? parseSitemap(smRes.text) : null;
  if (parsed) unreadable = false;
  // Sitemap-Index: die erste Teil-Sitemap (bevorzugt Seiten statt Beiträge/Bilder) mitlesen
  if (parsed?.index && parsed.locs.length) {
    const child = parsed.locs.find((u) => /page|seite/i.test(u)) ?? parsed.locs.find((u) => !/post|image|video|blog|news|tag|categor|author/i.test(u)) ?? parsed.locs[0];
    const childRes = await get(fetchFn, child, timeout, signal);
    if (isXml(childRes)) {
      const c = parseSitemap(childRes.text);
      parsed = { index: true, locs: c.locs, newest: [parsed.newest, c.newest].filter(Boolean).sort().pop() ?? null, hreflang: parsed.hreflang || c.hreflang };
    } else {
      // Teil-Sitemap nicht lesbar: keine Seiten-URLs bekannt (die Index-Einträge sind Sitemaps, keine Seiten)
      parsed = { ...parsed, locs: [] };
    }
  }
  const sitemap: NonNullable<SiteCheckResult['sitemap']> = {
    status: unreadable ? null : smRes.status, found: !!parsed, url: parsed ? smRes.url : null, source: parsed ? (declared.length ? 'robots' : 'default') : null,
    urls: parsed?.locs.length ?? 0, newest: parsed?.newest ?? null, hreflang: parsed?.hreflang ?? false,
    ...(parsed?.index ? { index: true } : {}),
  };
  const html = okHtml(homeRes) ? homeRes.text : '';
  const links = html ? sameHostLinks(html, homeRes.url, hosts) : [];
  const smLocs = (parsed?.locs ?? []).filter((u) => { try { return hosts.includes(new URL(u).hostname.toLowerCase().replace(/^www\./, '')); } catch { return false; } });
  const all = [...new Set([...links, ...smLocs.slice(0, 5000)])];
  const languages = languagePrefixes(all);
  const homePath = (() => { try { return new URL(homeRes.url).pathname.replace(/\/$/, ''); } catch { return ''; } })();
  const keys = [...pickKeyPages(all)].filter(([, u]) => { try { return new URL(u).pathname.replace(/\/$/, '') !== homePath; } catch { return false; } });
  const fetched = await Promise.all(keys.map(async ([kind, url]): Promise<PageCheck | null> => {
    const r = await get(fetchFn, url, timeout, signal);
    // Weiterleitung auf eine fremde Domain (z. B. Helpdesk-Anbieter): keine Befunde über die eigene Website ableiten
    const offHost = (() => { try { return !hosts.includes(new URL(r.url || url).hostname.toLowerCase().replace(/^www\./, '')); } catch { return true; } })();
    if (offHost) return null;
    const ok = okHtml(r);
    const pf = ok ? pageFacts(r.text, r.url, r.xRobotsTag) : null;
    return {
      kind, url: r.url || url, status: r.status, error: r.error, title: pf?.title ?? null, textChars: pf ? pf.textChars : null,
      jsonLd: pf?.jsonLd ?? [], metaDescription: pf?.metaDescription ?? null, canonical: pf?.canonical ?? null, noindex: pf?.noindex ?? false,
      ms: r.ms, bytes: ok ? bytesOf(r.text) : null,
    };
  }));
  const pages = fetched.filter((p): p is PageCheck => !!p);
  pages.sort((a, b) => PAGE_KINDS.indexOf(a.kind) - PAGE_KINDS.indexOf(b.kind));
  return { sitemap, pages, languages };
}

const isFailure = (r: SiteCheckResult) => r.home.status === null && r.robots.status === null;
/** Nur kurz cachen (SITE_CHECK_FAILURE_RETRY_MS): Fehlschlag oder wegen der Gesamtfrist abgebrochener Check. */
export const isShortLived = (r: SiteCheckResult) => isFailure(r) || r.partial === true;

/**
 * Website-Check für die Domains der eigenen Marke (höchstens SITE_CHECK_MAX_DOMAINS, Gesamtfrist 45 s).
 * Nutzt ein höchstens 24 h altes Ergebnis aus site_check (fehlgeschlagene oder wegen der Gesamtfrist abgebrochene Checks: 6 h), sonst wird neu geprüft
 * und gespeichert – auch Fehlschläge. Domains, die keine öffentlichen Hostnamen sind, werden ohne Abruf als Fehlschlag behandelt.
 * force = immer neu prüfen.
 */
export async function runSiteCheck(workspaceId: string, domains: string[], opts: NetOpts & { force?: boolean; log?: (m: string) => void; totalTimeoutMs?: number } = {}): Promise<SiteCheckResult[]> {
  const out: SiteCheckResult[] = [];
  const uniq = [...new Set(domains.map((d) => normalizeDomain(d)).filter((d): d is string => !!d))];
  if (uniq.length > SITE_CHECK_MAX_DOMAINS) opts.log?.(`Website-Check: nur die ersten ${SITE_CHECK_MAX_DOMAINS} von ${uniq.length} Domains werden geprüft.`);
  const deadline = AbortSignal.timeout(opts.totalTimeoutMs ?? SITE_CHECK_TOTAL_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline;
  for (const domain of uniq.slice(0, SITE_CHECK_MAX_DOMAINS)) {
    if (!opts.force) {
      const [recent] = await db.select().from(siteCheck)
        .where(and(eq(siteCheck.workspaceId, workspaceId), eq(siteCheck.domain, domain), gt(siteCheck.checkedAt, new Date(Date.now() - SITE_CHECK_MAX_AGE_MS))))
        .orderBy(desc(siteCheck.checkedAt)).limit(1);
      const cached = recent ? { ...(recent.result as SiteCheckResult), checkedAt: recent.checkedAt.toISOString() } : null;
      if (cached && (!isShortLived(cached) || Date.now() - recent!.checkedAt.getTime() < SITE_CHECK_FAILURE_RETRY_MS)) { out.push(cached); continue; }
    }
    if (signal.aborted) { opts.log?.(`Website-Check ${domain}: übersprungen (Gesamtfrist erreicht)`); continue; }
    const valid = validateBrandDomain(domain);
    const result: SiteCheckResult = 'error' in valid
      ? {
          domain, checkedAt: new Date().toISOString(),
          home: { status: null, finalUrl: null, error: valid.error, title: null, textChars: null, jsonLd: [] },
          robots: { status: null, found: false, error: valid.error, blocked: [], allowed: [], managedBy: null },
          llmsTxt: { status: null, found: false },
        }
      : await checkDomain(domain, { ...opts, signal });
    await db.insert(siteCheck).values({ workspaceId, domain, result });
    opts.log?.(`Website-Check ${domain}: Startseite ${result.home.status ?? result.home.error}, robots.txt ${result.robots.found ? `gefunden (gesperrt: ${result.robots.blocked.join(', ') || 'keine'})` : 'fehlt'}, llms.txt ${result.llmsTxt.found ? 'ja' : 'nein'}, JSON-LD: ${result.home.jsonLd.join(', ') || 'keine'}, Text ohne JS: ${result.home.textChars ?? '–'} Zeichen, Sitemap: ${result.sitemap?.found ? `${result.sitemap.urls} URLs` : 'keine'}, Unterseiten: ${(result.pages ?? []).map((p) => `${p.kind} ${p.status ?? p.error}`).join(', ') || 'keine erkannt'}, Wikidata: ${result.wikidata?.status ?? '–'}${result.partial ? ' (abgebrochen: Gesamtfrist erreicht)' : ''}`);
    out.push(result);
  }
  return out;
}
