// „Von KI gelesen, aber nicht zitiert“: reine Helfer (ohne DB, testbar).
// Grundlage sind die searched-Zeilen aus Antworten, die eigene Zitate haben (metrics.readNotCited) –
// diese Seiten hat die Engine bei der Recherche gelesen, sie erscheinen aber nicht als Quelle.

import { classifyDomain, normalizeHost, ratio, type BrandLike, type Cit, type DomainType, type Resp } from './metrics';

export type CommunityKind = 'reddit' | 'youtube' | 'forum';

const FORUM_HOSTS = ['quora.com', 'gutefrage.net', 'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'trustpilot.com', 'facebook.com', 'tiktok.com', 'linkedin.com', 'x.com', 'twitter.com', 'wer-weiss-was.de', 'motor-talk.de', 'computerbase.de', 'hardwareluxx.de'];

/** Community-Plattform erkennen: Reddit, YouTube oder Forum/Fragen-Portal (Hostname-Heuristik). */
export function communityKind(hostOrUrl: string): CommunityKind | null {
  const h = normalizeHost(hostOrUrl);
  if (!h) return null;
  const is = (d: string) => h === d || h.endsWith('.' + d);
  if (is('reddit.com') || is('redd.it')) return 'reddit';
  if (is('youtube.com') || is('youtu.be')) return 'youtube';
  if (FORUM_HOSTS.some(is)) return 'forum';
  // forum.example.de, community.example.com, example-forum.de, …board.de
  if (/(^|[.-])(forum|forums|foren|community|communities|board|discuss|discourse)([.-]|$)/.test(h)) return 'forum';
  return null;
}

export const COMMUNITY_LABELS: Record<CommunityKind, string> = { reddit: 'Reddit', youtube: 'YouTube', forum: 'Forum / Community' };

/** Subreddit aus einer Reddit-URL („r/Kassensysteme“), sonst null. Groß-/Kleinschreibung wird vereinheitlicht. */
export function subredditOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (communityKind(u.hostname) !== 'reddit') return null;
    const m = u.pathname.match(/^\/r\/([A-Za-z0-9_]{2,32})(?:\/|$)/);
    return m ? `r/${m[1]!.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

/** Vergleichbare URL: Host ohne www, Pfad ohne abschließenden Slash, ohne utm-Parameter und Fragment. */
export function comparableUrl(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()].filter(([k]) => !k.toLowerCase().startsWith('utm_'));
    const q = params.length ? '?' + new URLSearchParams(params).toString() : '';
    return `${normalizeHost(u.hostname)}${u.pathname.replace(/\/+$/, '')}${q}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export type ReadPage = { url: string; title: string | null; responses: number };
export type ReadDomain = {
  domain: string;
  responses: number;       // Antworten, in denen die Domain gelesen, aber nicht zitiert wurde
  share: number | null;    // Anteil an Antworten mit gelesenen Seiten
  type: DomainType;
  brandName: string | null;
  community: CommunityKind | null;
  engines: string[];
  pages: ReadPage[];       // häufigste Seiten
  subreddits: { name: string; responses: number; pages: ReadPage[] }[];
};

/**
 * Gelesene, nicht zitierte Seiten je Domain.
 * `read` = searched-Zeilen aus Antworten mit Zitaten; `cited` = die zitierten Zeilen (Quellenregel).
 * Seiten, die in derselben Antwort auch zitiert wurden, zählen nicht als „nur gelesen“.
 */
export function readNotCitedStats(resps: readonly Resp[], read: readonly Cit[], cited: readonly Cit[], brands: readonly BrandLike[]) {
  const byId = new Map(resps.map((r) => [r.id, r]));
  const citedKeys = new Set(cited.filter((c) => c.kind === 'cited').map((c) => `${c.responseId}|${comparableUrl(c.url)}`));
  const answers = new Set<string>();
  type Acc = { responses: Set<string>; engines: Set<string>; pages: Map<string, { url: string; title: string | null; responses: Set<string> }>; subs: Map<string, { responses: Set<string>; pages: Map<string, { url: string; title: string | null; responses: Set<string> }> }> };
  const by = new Map<string, Acc>();
  const addPage = (m: Acc['pages'], c: Cit) => {
    const k = comparableUrl(c.url);
    const p = m.get(k) ?? { url: c.url, title: c.title, responses: new Set<string>() };
    p.responses.add(c.responseId);
    if (!p.title && c.title) p.title = c.title;
    m.set(k, p);
  };
  for (const c of read) {
    const r = byId.get(c.responseId);
    if (!r || c.kind !== 'searched') continue;
    if (citedKeys.has(`${c.responseId}|${comparableUrl(c.url)}`)) continue;
    const host = normalizeHost(c.domain || c.url);
    if (!host) continue;
    answers.add(c.responseId);
    const e: Acc = by.get(host) ?? { responses: new Set(), engines: new Set(), pages: new Map(), subs: new Map() };
    e.responses.add(c.responseId);
    e.engines.add(r.engine);
    addPage(e.pages, c);
    const sub = subredditOf(c.url);
    if (sub) {
      const s = e.subs.get(sub) ?? { responses: new Set<string>(), pages: new Map() };
      s.responses.add(c.responseId);
      addPage(s.pages, c);
      e.subs.set(sub, s);
    }
    by.set(host, e);
  }
  const toPages = (m: Acc['pages']): ReadPage[] =>
    [...m.values()].map((p) => ({ url: p.url, title: p.title, responses: p.responses.size }))
      .sort((a, b) => b.responses - a.responses || a.url.localeCompare(b.url));
  const rows: ReadDomain[] = [...by.entries()].map(([domain, e]) => {
    const cls = classifyDomain(domain, brands);
    return {
      domain,
      responses: e.responses.size,
      share: ratio(e.responses.size, answers.size),
      type: cls.type,
      brandName: cls.brand?.name ?? null,
      community: communityKind(domain),
      engines: [...e.engines].sort(),
      pages: toPages(e.pages),
      subreddits: [...e.subs.entries()]
        .map(([name, s]) => ({ name, responses: s.responses.size, pages: toPages(s.pages) }))
        .sort((a, b) => b.responses - a.responses || a.name.localeCompare(b.name)),
    };
  });
  rows.sort((a, b) => b.responses - a.responses || a.domain.localeCompare(b.domain));
  return { answers: answers.size, rows, community: rows.filter((r) => r.community) };
}
