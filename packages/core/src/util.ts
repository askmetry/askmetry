import crypto from 'node:crypto';
import { safeHttpUrl } from './domains.ts';
import { EngineError, isTransientStatus } from './errors.ts';

export const sha = (s: string, len = 12) => crypto.createHash('sha256').update(s).digest('hex').slice(0, len);
export const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function dedupeByUrl<T extends { url?: string | null }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    if (!c.url || seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 180_000): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: any;
  // kein Guthaben/Kontingent: Wiederholen ist sinnlos (gleicher 429 wie ein Rate-Limit)
  const fail = (detail: string) => new EngineError(`${res.status}: ${detail.slice(0, 300)}`, {
    status: res.status, retryable: isTransientStatus(res.status) && !/insufficient_quota|no credits remaining|credit balance/i.test(detail),
  });
  try { json = JSON.parse(text); } catch { throw fail(text); }
  if (!res.ok) throw fail(JSON.stringify(json.error ?? json));
  return json;
}

/**
 * Zitierte und durchsuchte Quellen zusammenführen: alle zitierten (kind 'cited', dedupliziert) und zusätzlich
 * alle durchsuchten, die nicht schon zitiert sind (kind 'searched', dedupliziert).
 */
export function mergeCitedAndSearched<T extends { url?: string | null; kind: 'cited' | 'searched' }>(cited: T[], searched: T[]): T[] {
  const c = dedupeByUrl(cited);
  // Abgleich ohne Tracking-Parameter: OpenAI hängt an zitierte URLs ?utm_source=openai an, an durchsuchte nicht
  const seen = new Set(c.map((x) => urlKey(x.url ?? '')));
  const out: T[] = [...c];
  for (const x of searched) {
    const k = urlKey(x.url ?? '');
    if (!safeHttpUrl(x.url) || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** Vergleichsschlüssel einer URL: ohne Tracking-Parameter (utm, ref, gclid …), Fragment, „www.“ und abschließenden Schrägstrich. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^(ref|fbclid|gclid|srsltid)$/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    return u.toString().replace(/\?$/, '').replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * Durchsuchte bzw. gelesene Quellen aus einer gespeicherten OpenAI-Response:
 * output[].type == 'web_search_call' → action.sources[] (Suche) bzw. action.url (open_page/find_in_page).
 */
export function openAiSearchedSources(raw: any): { url: string; title?: string | null; kind: 'searched' }[] {
  const out: { url: string; title?: string | null; kind: 'searched' }[] = [];
  for (const item of raw?.output ?? []) {
    if (item?.type !== 'web_search_call') continue;
    for (const src of item.action?.sources ?? []) if (typeof src?.url === 'string' && safeHttpUrl(src.url)) out.push({ url: src.url, title: src.title, kind: 'searched' });
    if (typeof item.action?.url === 'string' && safeHttpUrl(item.action.url)) out.push({ url: item.action.url, kind: 'searched' });
  }
  return dedupeByUrl(out);
}

/** Durchsuchte Quellen aus einer gespeicherten Claude-Antwort (content[].type == 'web_search_tool_result'). */
export function claudeSearchedSources(raw: any): { url: string; title?: string | null; kind: 'searched' }[] {
  const content = raw?.content ?? raw?.response?.content ?? [];
  const out: { url: string; title?: string | null; kind: 'searched' }[] = [];
  for (const block of content) {
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (typeof r?.url === 'string' && safeHttpUrl(r.url)) out.push({ url: r.url, title: r.title ?? null, kind: 'searched' });
    }
  }
  return dedupeByUrl(out);
}
