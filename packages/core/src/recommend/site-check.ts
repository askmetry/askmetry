// Technischer Website-Check der eigenen Domain(s): robots.txt (KI-Crawler), llms.txt, strukturierte Daten, Text ohne JavaScript.
// Nur GET auf öffentliche Seiten, kostenlos. Höchstens einmal pro Tag je Domain (Ergebnis in site_check).
import { db, siteCheck } from '@opengeo/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import { normalizeDomain, validateBrandDomain } from '../domains.ts';
import type { SiteCheckResult } from './data.ts';
import { safeFetch, SAFE_FETCH_MAX_BYTES, type Resolver, type Transport } from './safe-fetch.ts';

export const SITE_CHECK_UA = 'OpenGEO-SiteCheck/0.1';
export const SITE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Fehlgeschlagene Checks (Domain nicht erreichbar/gesperrt) werden gespeichert und erst nach 6 h wiederholt. */
export const SITE_CHECK_FAILURE_RETRY_MS = 6 * 60 * 60 * 1000;
/** Höchstens so viele Domains der eigenen Marke werden geprüft. */
export const SITE_CHECK_MAX_DOMAINS = 5;
/** Gesamtfrist für den Website-Check eines Workspaces. */
export const SITE_CHECK_TOTAL_TIMEOUT_MS = 45_000;

/** KI-Crawler, deren Zugriff geprüft wird (Produkt-Token laut Anbieter-Doku). */
export const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Google-Extended', 'Googlebot',
] as const;

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
  return !isAllowed(rules, '/') || !isAllowed(rules, '/opengeo-pruefseite-x7q/');
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

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

type NetOpts = { fetch?: FetchLike; timeoutMs?: number; signal?: AbortSignal; resolve?: Resolver; transport?: Transport };

/** Standard-Abruf: safeFetch (nur öffentliche Ziele, Weiterleitungen einzeln geprüft, IP gepinnt, Body ≤ 2 MB). */
function defaultFetch(opts: NetOpts): FetchLike {
  return async (url, init) => {
    const r = await safeFetch(url, { headers: init?.headers, signal: init?.signal, resolve: opts.resolve, transport: opts.transport });
    return { status: r.status, url: r.url, text: async () => r.text };
  };
}

async function get(fetchFn: FetchLike, url: string, timeoutMs: number, outer?: AbortSignal) {
  try {
    const signal = outer ? AbortSignal.any([AbortSignal.timeout(timeoutMs), outer]) : AbortSignal.timeout(timeoutMs);
    const res = await fetchFn(url, { headers: { 'user-agent': SITE_CHECK_UA, accept: '*/*' }, signal });
    const text = (await res.text()).slice(0, SAFE_FETCH_MAX_BYTES);
    return { status: res.status, url: res.url || url, text, error: null as string | null };
  } catch (e) {
    return { status: null, url, text: '', error: ((e as Error)?.message ?? String(e)).slice(0, 200) };
  }
}

/** robots.txt-Status, der keine Aussage zulässt: Netzfehler, 429 (Rate-Limit) und 5xx. */
export const robotsStatusUnknown = (status: number | null) => status === null || status === 429 || status >= 500;

/** Eine Domain prüfen (ohne DB). */
export async function checkDomain(domain: string, opts: NetOpts = {}): Promise<SiteCheckResult> {
  const fetchFn = opts.fetch ?? defaultFetch(opts);
  const timeout = opts.timeoutMs ?? 10_000;
  const host = normalizeDomain(domain) ?? domain;
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

  // robots.txt: 2xx = auswerten; 4xx (außer 429) = keine Einschränkung; 429/5xx/Fehler = unbekannt (nicht als gesperrt werten)
  const robotsFound = robotsRes.status !== null && robotsRes.status >= 200 && robotsRes.status < 300 && !looksLikeHtml(robotsRes.text);
  const groups = robotsFound ? parseRobots(robotsRes.text) : [];
  const blocked = robotsFound ? AI_BOTS.filter((b) => isBotBlocked(groups, b)) : [];
  const allowed = robotsFound ? AI_BOTS.filter((b) => !blocked.includes(b)) : [];

  const llmsFound = llmsRes.status !== null && llmsRes.status >= 200 && llmsRes.status < 300
    && llmsRes.text.trim().length > 0 && !looksLikeHtml(llmsRes.text);

  const html = homeRes.status && homeRes.status < 400 ? homeRes.text : '';
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  return {
    domain: host,
    checkedAt: new Date().toISOString(),
    home: {
      status: homeRes.status,
      finalUrl: homeRes.url,
      error: homeRes.error,
      title: title ? visibleText(title).slice(0, 200) : null,
      textChars: html ? visibleText(html).length : null,
      jsonLd: html ? extractJsonLdTypes(html) : [],
      hasH1: html ? /<h1\b/i.test(html) : undefined,
    },
    robots: {
      status: robotsRes.status, found: robotsFound, error: robotsRes.error, blocked: [...blocked], allowed: [...allowed],
      managedBy: robotsFound && /cloudflare managed/i.test(robotsRes.text) ? 'cloudflare' : null,
    },
    llmsTxt: { status: llmsRes.status, found: llmsFound },
  };
}

const isFailure = (r: SiteCheckResult) => r.home.status === null && r.robots.status === null;

/**
 * Website-Check für die Domains der eigenen Marke (höchstens SITE_CHECK_MAX_DOMAINS, Gesamtfrist 45 s).
 * Nutzt ein höchstens 24 h altes Ergebnis aus site_check (fehlgeschlagene Checks: 6 h), sonst wird neu geprüft
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
      if (cached && (!isFailure(cached) || Date.now() - recent!.checkedAt.getTime() < SITE_CHECK_FAILURE_RETRY_MS)) { out.push(cached); continue; }
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
    opts.log?.(`Website-Check ${domain}: Startseite ${result.home.status ?? result.home.error}, robots.txt ${result.robots.found ? `gefunden (gesperrt: ${result.robots.blocked.join(', ') || 'keine'})` : 'fehlt'}, llms.txt ${result.llmsTxt.found ? 'ja' : 'nein'}, JSON-LD: ${result.home.jsonLd.join(', ') || 'keine'}, Text ohne JS: ${result.home.textChars ?? '–'} Zeichen`);
    out.push(result);
  }
  return out;
}
