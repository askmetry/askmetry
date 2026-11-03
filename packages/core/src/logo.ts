// Logos der Marken: Website-Icon der Domain (apple-touch-icon, <link rel=icon>, /favicon.ico) über safeFetch holen,
// Bildtyp an den Bytes prüfen und in domain_logo speichern. Kein Drittdienst (kein Google-Favicon-Service).
import { and, eq, inArray } from 'drizzle-orm';
import { brand, db, domainLogo } from '@opengeo/db';
import { validateBrandDomain } from './domains.ts';
import { safeFetch, type Resolver, type Transport } from './recommend/safe-fetch.ts';
import { SITE_CHECK_UA } from './recommend/site-check.ts';

export const LOGO_MAX_BYTES = 200_000;
/** Erfolgreiche Logos nach 30 Tagen, Fehlschläge nach 7 Tagen erneut versuchen. */
export const LOGO_TTL_MS = 30 * 24 * 3600_000;
export const LOGO_RETRY_MS = 24 * 3600 * 1000; // ohne Logo: nach einem Tag erneut versuchen

type Cand = { url: string; score: number };

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(2).find((x) => x != null) ?? null;

/** Icon-Kandidaten aus dem HTML, bestes zuerst: große PNG/Apple-Touch-Icons, dann SVG, dann kleine Icons, zuletzt /favicon.ico. */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const out: Cand[] = [];
  const head = /<head\b[\s\S]*?<\/head>/i.exec(html)?.[0] ?? html.slice(0, 100_000);
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase();
    const href = attr(m[0], 'href');
    if (!href || !/\b(icon|apple-touch-icon)\b/.test(rel) || /mask-icon/.test(rel)) continue;
    let url: string;
    try { url = new URL(href.replace(/&amp;/g, '&'), pageUrl).toString(); } catch { continue; }
    if (!/^https?:/.test(url)) continue;
    const sizes = (attr(m[0], 'sizes') ?? '').match(/(\d+)x\d+/g)?.map((x) => parseInt(x, 10)) ?? [];
    const size = sizes.length ? Math.max(...sizes) : rel.includes('apple-touch-icon') ? 180 : 0;
    const svg = /\.svg(\?|$)/i.test(url) || /svg/i.test(attr(m[0], 'type') ?? '');
    // Ziel: ~64–256 px. Zu große Icons (512) sind ok, aber schwerer.
    const score = svg ? 150 : size >= 64 ? 200 - Math.abs(size - 180) / 10 : size > 0 ? 50 + size : 40;
    out.push({ url, score });
  }
  try {
    const origin = new URL(pageUrl).origin;
    out.push({ url: `${origin}/apple-touch-icon.png`, score: 30 }, { url: `${origin}/favicon.ico`, score: 10 });
  } catch { /* ignore */ }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).map((c) => c.url).filter((u) => (seen.has(u) ? false : (seen.add(u), true))).slice(0, 5);
}

/** Bildtyp an den ersten Bytes erkennen (Content-Type der Server ist oft falsch). */
export function sniffImage(b: Uint8Array): string | null {
  const hex = (n: number) => [...b.subarray(0, n)].map((x) => x.toString(16).padStart(2, '0')).join('');
  if (b.length < 8) return null;
  if (hex(8) === '89504e470d0a1a0a') return 'image/png';
  if (hex(3) === 'ffd8ff') return 'image/jpeg';
  if (hex(4) === '47494638') return 'image/gif';
  if (hex(4) === '52494646' && new TextDecoder().decode(b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (hex(4) === '00000100') return 'image/x-icon';
  const head = new TextDecoder().decode(b.subarray(0, 1000)).trimStart().toLowerCase();
  // Wurzel muss <svg sein (nach optionalem XML-Kopf/Kommentaren); Skripte und Event-Handler lehnen wir ab
  const root = head.replace(/^<\?xml[\s\S]*?\?>/, '').replace(/^(\s|<!--[\s\S]*?-->|<!doctype[^>]*>)*/, '');
  const all = new TextDecoder().decode(b).toLowerCase();
  // abgelehnt: Skripte (auch mit Präfix), Event-Handler (auch nach „/“), Entities/Kodierungstricks, externe Verweise und CSS-Importe
  const unsafe = /<([a-z0-9_-]+:)?(script|foreignobject|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript:|&#|<!entity|@import|url\((?!\s*['"]?\s*#)/.test(all)
    || /\b(xlink:)?href\s*=(?!\s*["']?\s*#)/.test(all);
  if (root.startsWith('<svg') && !unsafe) return 'image/svg+xml';
  return null;
}

type NetOpts = { resolve?: Resolver; transport?: Transport; signal?: AbortSignal };

/** Logo einer Domain holen. Wirft nicht; null = keins gefunden. */
export async function fetchLogo(domain: string, opts: NetOpts = {}): Promise<{ contentType: string; bytes: Uint8Array; url: string } | null> {
  const v = validateBrandDomain(domain);
  if ('error' in v) return null;
  const total = opts.signal ? AbortSignal.any([AbortSignal.timeout(20_000), opts.signal]) : AbortSignal.timeout(20_000);
  const headers = { 'user-agent': SITE_CHECK_UA, accept: 'text/html,image/*;q=0.8,*/*;q=0.5' };
  let page = `https://${v.domain}/`;
  let html = '';
  try {
    const r = await safeFetch(page, { headers, signal: AbortSignal.any([AbortSignal.timeout(8_000), total]), resolve: opts.resolve, transport: opts.transport, maxBytes: 500_000 });
    if (r.status < 400) { html = r.text; page = r.url; }
  } catch { /* Icons trotzdem unter den Standardpfaden versuchen */ }
  for (const url of iconCandidates(html, page)) {
    if (total.aborted) break;
    try {
      const r = await safeFetch(url, { headers, signal: AbortSignal.any([AbortSignal.timeout(6_000), total]), resolve: opts.resolve, transport: opts.transport, binary: true, maxBytes: LOGO_MAX_BYTES });
      if (r.status >= 400 || !r.bytes || r.truncated || r.bytes.length < 50) continue;
      const contentType = sniffImage(r.bytes);
      if (contentType) return { contentType, bytes: r.bytes, url: r.url };
    } catch { /* nächster Kandidat */ }
  }
  return null;
}

/** Logos für die Domains eines Workspaces (eigene Marke + Wettbewerber) holen, die fehlen oder veraltet sind. */
export async function refreshLogos(workspaceId: string, opts: NetOpts & { force?: boolean; log?: (m: string) => void; max?: number } = {}) {
  const brands = await db.select({ domains: brand.domains }).from(brand).where(eq(brand.workspaceId, workspaceId));
  // je Marke die erste Domain (Hauptdomain)
  const domains = [...new Set(brands.map((b) => b.domains[0]).filter(Boolean).map((d) => d.toLowerCase().replace(/^www\./, '')))];
  if (!domains.length) return { fetched: 0, found: 0 };
  const now = Date.now();
  const existing = await db.select().from(domainLogo).where(inArray(domainLogo.domain, domains));
  const fresh = new Set(existing.filter((l) => !opts.force && now - l.fetchedAt.getTime() < (l.status === 'ok' ? LOGO_TTL_MS : LOGO_RETRY_MS)).map((l) => l.domain));
  const todo = domains.filter((d) => !fresh.has(d)).slice(0, opts.max ?? 30);
  let found = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (d) => {
      const logo = await fetchLogo(d, opts);
      if (logo) found++;
      // kurzer Ausfall: vorhandenes Logo behalten statt es durch „none“ zu ersetzen
      if (!logo && existing.some((l) => l.domain === d && l.status === 'ok')) return;
      const row = logo
        ? { domain: d, status: 'ok', contentType: logo.contentType, data: Buffer.from(logo.bytes).toString('base64'), sourceUrl: logo.url, fetchedAt: new Date() }
        : { domain: d, status: 'none', contentType: null, data: null, sourceUrl: null, fetchedAt: new Date() };
      await db.insert(domainLogo).values(row).onConflictDoUpdate({ target: domainLogo.domain, set: row });
    }));
  }
  opts.log?.(`Logos: ${todo.length} geprüft, ${found} gefunden`);
  return { fetched: todo.length, found };
}

/** Gespeichertes Logo (nur status ok). */
export async function loadLogo(domain: string) {
  const [l] = await db.select().from(domainLogo).where(and(eq(domainLogo.domain, domain.toLowerCase()), eq(domainLogo.status, 'ok'))).limit(1);
  return l?.data && l.contentType ? { contentType: l.contentType, bytes: Buffer.from(l.data, 'base64') } : null;
}

/** Welche dieser Domains haben ein Logo? (für die UI: nur dann ein <img> rendern, sonst Initiale) */
export async function domainsWithLogo(domains: string[]): Promise<Set<string>> {
  const ds = [...new Set(domains.map((d) => d.toLowerCase()))];
  if (!ds.length) return new Set();
  const rows = await db.select({ domain: domainLogo.domain }).from(domainLogo).where(and(inArray(domainLogo.domain, ds), eq(domainLogo.status, 'ok')));
  return new Set(rows.map((r) => r.domain));
}

