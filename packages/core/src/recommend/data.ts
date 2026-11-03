// Datenbasis und reine Helfer für den Maßnahmen-Generator (ohne DB).
// Gleiche Regeln wie apps/web/lib/metrics.ts: Domain-Abgleich host === d || host.endsWith('.' + d), www. entfernt, IDN als Punycode.
import { matchesAnyDomain, normalizeDomain } from '../domains.ts';
import { engineLabels, type EngineKey } from '../types.ts';

export type Resp = { id: string; promptId: string; engine: string };
export type Ment = { responseId: string; brandId: string | null; name: string; position: number; recommended: boolean; sentiment: string; snippet: string | null; isCompetitor?: boolean | null };
export type Cit = { responseId: string; url: string; domain: string; title: string | null; position: number; kind: 'cited' | 'searched' };
export type BrandLike = { id: string; name: string; aliases?: string[] | null; domains: string[]; isOwn: boolean; description?: string | null; kind?: string | null };
export type PromptInfo = { id: string; text: string; topicId: string | null; topicName: string | null };

export interface SiteCheckResult {
  domain: string;
  checkedAt?: string;
  /** Startseite: Status, Ziel-URL nach Weiterleitungen, Fehler */
  home: { status: number | null; finalUrl: string | null; error?: string | null; title?: string | null; textChars: number | null; jsonLd: string[]; hasH1?: boolean };
  robots: { status: number | null; found: boolean; error?: string | null; blocked: string[]; allowed: string[]; managedBy?: string | null };
  llmsTxt: { status: number | null; found: boolean };
}

/** Eine abgeschlossene Messung, aufbereitet für die Regeln. */
export interface RecData {
  workspaceId: string;
  collectionId: string;
  /** Zeitpunkt der Messung (für Jahreszahlen in Titelvorschlägen) */
  at: Date;
  brands: BrandLike[];
  prompts: Map<string, PromptInfo>;
  /** Antworten mit Text, ausgewertet */
  resps: Resp[];
  ments: Ment[];
  /** alle Quellen (cited + searched) */
  cits: Cit[];
  /** Website-Check der eigenen Domains (optional) */
  siteChecks?: SiteCheckResult[];
}

export const engineLabel = (k: string) => engineLabels[k as EngineKey] ?? k;
export const pct = (x: number) => `${Math.round(x * 100)} %`;
export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function domainMatches(host: string, domains: readonly string[]) {
  return matchesAnyDomain(host, domains);
}

export function hostOf(c: Pick<Cit, 'domain' | 'url'>): string {
  return normalizeDomain(c.domain || c.url) ?? '';
}

/** URL zum Anzeigen/Gruppieren: Tracking-Parameter (utm_*, ref) und Fragment entfernt. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^(ref|fbclid|gclid|srsltid)$/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    let s = u.toString();
    if (s.endsWith('?')) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
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

/**
 * „Quellen einer Antwort“ für Kennzahlen (CONTRACT.md): cited-Zeilen, falls die Antwort welche hat, sonst searched-Zeilen.
 * Ergebnis je responseId.
 */
export function metricCitations(cits: readonly Cit[]): Map<string, Cit[]> {
  const by = groupBy(cits, (c) => c.responseId);
  const out = new Map<string, Cit[]>();
  for (const [rid, cs] of by) {
    const cited = cs.filter((c) => c.kind === 'cited');
    out.set(rid, cited.length ? cited : cs.filter((c) => c.kind === 'searched'));
  }
  return out;
}

/** Reddit, YouTube, Foren & Q&A-Seiten – Quellen, bei denen man selbst mitdiskutieren kann. */
export type CommunityGroup = { kind: 'reddit' | 'youtube' | 'forum'; id: string; label: string };
export function communityGroup(url: string): CommunityGroup | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = normalizeDomain(u.hostname) ?? '';
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') {
    const m = /^\/r\/([^/]+)/i.exec(u.pathname);
    if (!m) return { kind: 'reddit', id: 'reddit', label: 'Reddit' };
    return { kind: 'reddit', id: `r/${m[1].toLowerCase()}`, label: `r/${m[1]}` };
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return { kind: 'youtube', id: 'youtube', label: 'YouTube' };
  if (host === 'gutefrage.net' || host.endsWith('.gutefrage.net')) return { kind: 'forum', id: 'gutefrage.net', label: 'gutefrage.net' };
  if (/(^|\.)(forum|forums|community|board|discourse)\./.test(host) || /forum/.test(host) || /\/(forum|forums|threads?|community|thema)\//i.test(u.pathname)) {
    return { kind: 'forum', id: host, label: host };
  }
  return null;
}

/** Lesbarer Titel für Threads/Videos ohne gespeicherten Titel (z. B. ChatGPT-Suchquellen). */
export function titleFromUrl(url: string, title?: string | null): string {
  if (title?.trim()) return title.trim();
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (/youtube\.com$|youtu\.be$/.test(host)) {
      const v = u.searchParams.get('v') ?? (host === 'youtu.be' ? u.pathname.slice(1) : /\/(shorts|embed)\/([^/]+)/.exec(u.pathname)?.[2]);
      if (v) return `YouTube-Video ${v}`;
      const ch = /^\/(@[^/]+|c\/[^/]+|channel\/[^/]+|user\/[^/]+)/.exec(u.pathname)?.[1];
      return ch ? `YouTube-Kanal ${ch.replace(/^(c|channel|user)\//, '')}` : 'YouTube';
    }
    const sub = /^\/r\/([^/]+)/.exec(u.pathname)?.[1];
    const reddit = /\/r\/[^/]+\/comments\/([^/]+)(?:\/([^/]+))?/.exec(u.pathname);
    if (sub && reddit && !reddit[2]) return `Thread in r/${sub} (${reddit[1]})`;
    if (sub && !reddit) return `r/${sub}`;
    const slug = reddit?.[2] ?? u.pathname.split('/').filter(Boolean).pop() ?? '';
    const words = decodeURIComponent(slug).replace(/\.(html?|php)$/, '').replace(/[_-]+/g, ' ').trim();
    if (!words || /^[a-z0-9]{6,12}$/i.test(words)) return host + u.pathname.replace(/\/$/, '');
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return url;
  }
}

export function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Index über die Datenbasis, den alle Regeln nutzen. */
export function indexData(d: RecData) {
  const own = d.brands.find((b) => b.isOwn);
  const competitors = d.brands.filter((b) => !b.isOwn);
  const compById = new Map(competitors.map((b) => [b.id, b]));
  const respIds = new Set(d.resps.map((r) => r.id));
  const respById = new Map(d.resps.map((r) => [r.id, r]));
  const ments = d.ments.filter((m) => respIds.has(m.responseId));
  const cits = d.cits.filter((c) => respIds.has(c.responseId));
  const mentsByResp = groupBy(ments, (m) => m.responseId);
  const ownNamed = new Set(own ? ments.filter((m) => m.brandId === own.id).map((m) => m.responseId) : []);
  const compsByResp = new Map<string, Ment[]>();
  for (const [rid, ms] of mentsByResp) {
    const cs = ms.filter((m) => m.brandId && compById.has(m.brandId));
    if (cs.length) compsByResp.set(rid, cs);
  }
  const metricCits = metricCitations(cits);
  const allCits = groupBy(cits, (c) => c.responseId);
  const respsByPrompt = groupBy(d.resps, (r) => r.promptId);
  const ownSiteResps = new Set<string>();
  if (own?.domains.length) {
    for (const [rid, cs] of metricCits) if (cs.some((c) => domainMatches(hostOf(c), own.domains))) ownSiteResps.add(rid);
  }
  const promptText = (pid: string) => d.prompts.get(pid)?.text ?? '';
  return {
    own, competitors, compById, respById, ments, cits, mentsByResp, ownNamed, compsByResp, metricCits, allCits,
    respsByPrompt, ownSiteResps, promptText, N: d.resps.length,
  };
}
export type Indexed = ReturnType<typeof indexData>;
