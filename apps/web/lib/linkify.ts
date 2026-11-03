// Text der Maßnahmen klickbar machen – rein, auch im Browser nutzbar.
// Verlinkt werden nur Ziele aus den Belegen der Maßnahme (bekannte URLs und Hosts) sowie Subreddits; nichts Erfundenes.

export type LinkPart = string | { href: string; label: string };

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const short = (u: string) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, ''); } catch { return u; } };
const normTitle = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
const isHttp = (u: string) => { try { const x = new URL(u); return (x.protocol === 'http:' || x.protocol === 'https:') && !!x.hostname; } catch { return false; } };

/** Bekannte Ziele: vollständige URLs (nur exakt) + Hosts (eigene Domains, Domain der Maßnahme; beliebige Pfade). */
export function linkTargets(urls: (string | { url: string; title?: string | null } | null | undefined)[], hosts: (string | null | undefined)[] = []) {
  const byShort = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const hostSet = new Set<string>();
  for (const x of urls) {
    const u = typeof x === 'string' ? x : x?.url;
    if (!u || !isHttp(u)) continue;
    byShort.set(short(u).toLowerCase(), u);
    const title = typeof x === 'object' ? x?.title?.trim() : null;
    if (title && title.length >= 3) byTitle.set(normTitle(title), u);
  }
  for (const h of hosts) if (h && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) hostSet.add(h.toLowerCase().replace(/^www\./, ''));
  return { byShort, byTitle, hosts: hostSet };
}
export type LinkTargets = ReturnType<typeof linkTargets>;

const TOKEN = /(https?:\/\/[^\s<>„“”"'»«…–—]+)|(?<![\w@./-])((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>„“”"'»«,;…–—]*)?)|(?<![\w/])(r\/[A-Za-z0-9_]{2,21})(?![\w/])|[„“]([^„“”]{3,160})[“”]/gi;
const TRAIL = /[.,;:!?)\]]+$/;

const knownHost = (h: string, t: LinkTargets) => t.hosts.has(h.replace(/^www\./, ''));

export function linkify(text: string, t: LinkTargets): LinkPart[] {
  const out: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m[4]) {
      // zitierter Seiten-/Thread-Titel aus den Belegen
      const href = t.byTitle.get(normTitle(m[4]));
      const inner = href ? null : linkify(m[4], t);
      if (!href && !inner!.some((p) => typeof p !== 'string')) continue;
      const start = m.index!;
      if (start > last) out.push(text.slice(last, start));
      // kein Titel-Treffer: Pfade/Domains innerhalb der Anführungszeichen trotzdem verlinken
      out.push(m[0][0]!, ...(href ? [{ href, label: m[4] }] : inner!), m[0].slice(-1));
      last = start + m[0].length;
      continue;
    }
    let raw = m[0];
    const trail = TRAIL.exec(raw)?.[0] ?? '';
    if (trail) raw = raw.slice(0, -trail.length);
    let link: { href: string; label: string } | null = null;
    if (m[1]) {
      const h = hostOf(raw);
      const exact = t.byShort.has(short(raw).toLowerCase());
      if (h && isHttp(raw) && (exact || knownHost(h, t))) link = { href: raw, label: short(raw) };
    } else if (m[2]) {
      const key = raw.replace(/\/$/, '').replace(/^www\./i, '').toLowerCase();
      const full = t.byShort.get(key);
      const host = key.split('/')[0];
      if (full) link = { href: full, label: raw };
      else if (knownHost(host, t) && !/\.(txt|xml|json|php)$/i.test(key)) link = { href: `https://${raw.replace(/\/$/, '')}`, label: raw };
    } else if (m[3]) {
      link = { href: `https://www.reddit.com/${raw}/`, label: raw };
    }
    if (!link) continue;
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    out.push(link);
    if (trail) out.push(trail);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
