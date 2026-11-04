import { describe, expect, it } from 'vitest';
import { brandMetrics, competitorOnlyDomains, domainStats, effectiveSources, readNotCited, usedNotNamed, type Cit, type Ment, type Resp } from './metrics';
import { metricCitations } from '../../../packages/core/src/recommend/data.ts';
import { communityKind, comparableUrl, readNotCitedStats, subredditOf } from './sources';

const R = (id: string, engine = 'chatgpt'): Resp => ({ id, runId: 'run-' + id, promptId: 'p1', engine, repetition: 1, topicId: null, collectionId: 'c1' });
const C = (responseId: string, url: string, kind: 'cited' | 'searched' = 'cited', title: string | null = null): Cit =>
  ({ responseId, url, domain: new URL(url).hostname.replace(/^www\./, ''), title, position: 1, kind });
const M = (responseId: string, brandId: string | null, position = 1): Ment => ({ responseId, brandId, name: brandId ?? 'X', position, recommended: false, sentiment: 'neutral', snippet: null });

const own = { id: 'own', name: 'Paylindo', domains: ['paylindo.de'], isOwn: true };
const sumup = { id: 'sumup', name: 'SumUp', domains: ['sumup.com'], isOwn: false };

describe('Quellenregel: cited, falls vorhanden, sonst searched', () => {
  const cits = [
    C('a', 'https://chip.de/x'),                       // ChatGPT: zitiert
    C('a', 'https://paylindo.de/blog', 'searched'),    // ChatGPT: nur gelesen → zählt nicht
    C('a', 'https://www.reddit.com/r/de/comments/1', 'searched'),
    C('b', 'https://paylindo.de/preise', 'searched'),  // Claude: keine Zitate → searched zählt
  ];
  it('filtert searched-Zeilen von Antworten mit Zitaten heraus', () => {
    expect(effectiveSources(cits).map((c) => c.url)).toEqual(['https://chip.de/x', 'https://paylindo.de/preise']);
    expect(effectiveSources(effectiveSources(cits))).toHaveLength(2); // idempotent
    expect(readNotCited(cits).map((c) => c.url)).toEqual(['https://paylindo.de/blog', 'https://www.reddit.com/r/de/comments/1']);
  });
  it('ist gleichwertig zu metricCitations aus @askmetry/core', () => {
    const mixed = [...cits, C('c', 'https://x.de/1', 'searched'), C('c', 'https://y.de/2', 'searched'), C('d', 'https://z.de/', 'cited'), C('d', 'https://z.de/s', 'searched')];
    const core = [...metricCitations(mixed).values()].flat();
    const key = (c: Cit) => `${c.responseId}|${c.url}|${c.kind}`;
    expect(effectiveSources(mixed).map(key).sort()).toEqual(core.map(key).sort());
  });
  it('Kennzahlen zählen gelesene Seiten nicht als Quelle', () => {
    const m = brandMetrics([R('a'), R('b', 'claude')], [], cits, own);
    expect(m.ownSite).toBe(1); // nur b
    expect(m.ownSiteSearchedOnly).toBe(1);
    expect(m.ownSiteRate).toBe(0.5);
  });
  it('domainStats, competitorOnlyDomains, usedNotNamed folgen der Regel', () => {
    const ds = domainStats([R('a'), R('b', 'claude')], cits, [own, sumup]);
    expect(ds.rows.map((r) => r.domain).sort()).toEqual(['chip.de', 'paylindo.de']);
    expect(ds.rows.find((r) => r.domain === 'paylindo.de')!.responses).toBe(1);
    const comp = competitorOnlyDomains([R('a')], [M('a', 'sumup')], cits, [own, sumup]);
    expect(comp.rows.map((r) => r.domain)).toEqual(['chip.de']);
    const un = usedNotNamed([R('a'), R('b', 'claude')], [], cits, own);
    expect(un.map((u) => u.response.id)).toEqual(['b']);
  });
});

describe('Community-Erkennung und Subreddits', () => {
  it('erkennt Plattformen', () => {
    expect(communityKind('www.reddit.com')).toBe('reddit');
    expect(communityKind('old.reddit.com')).toBe('reddit');
    expect(communityKind('https://m.youtube.com/watch?v=1')).toBe('youtube');
    expect(communityKind('youtu.be')).toBe('youtube');
    expect(communityKind('gutefrage.net')).toBe('forum');
    expect(communityKind('forum.example.de')).toBe('forum');
    expect(communityKind('kassen-forum.de')).toBe('forum');
    expect(communityKind('community.shopify.com')).toBe('forum');
    expect(communityKind('chip.de')).toBeNull();
    expect(communityKind('notreddit.com')).toBeNull();
    expect(communityKind('platform.de')).toBeNull();
  });
  it('liest Subreddits aus URLs', () => {
    expect(subredditOf('https://www.reddit.com/r/Kassensysteme/comments/abc/titel/')).toBe('r/kassensysteme');
    expect(subredditOf('https://old.reddit.com/r/de')).toBe('r/de');
    expect(subredditOf('https://www.reddit.com/user/x')).toBeNull();
    expect(subredditOf('https://example.com/r/de')).toBeNull();
    expect(subredditOf('kein-link')).toBeNull();
  });
  it('vergleicht URLs ohne utm, Slash und www', () => {
    expect(comparableUrl('https://www.Chip.de/test/?utm_source=openai')).toBe(comparableUrl('https://chip.de/test'));
    expect(comparableUrl('https://chip.de/test?id=2')).not.toBe(comparableUrl('https://chip.de/test'));
  });
});

describe('readNotCitedStats', () => {
  const resps = [R('a'), R('b'), R('c', 'claude')];
  const all = [
    C('a', 'https://chip.de/x'),
    C('a', 'https://www.reddit.com/r/Kassensysteme/comments/1/x', 'searched', 'Welches Terminal?'),
    C('a', 'https://www.reddit.com/r/selbststaendig/comments/2/y', 'searched'),
    C('a', 'https://chip.de/x?utm_source=openai', 'searched'), // auch zitiert → nicht „nur gelesen“
    C('b', 'https://chip.de/y'),
    C('b', 'https://reddit.com/r/kassensysteme/comments/3/z', 'searched'),
    C('b', 'https://www.youtube.com/watch?v=abc', 'searched'),
    C('b', 'https://paylindo.de/blog', 'searched'),
    C('c', 'https://reddit.com/r/de/comments/9', 'searched'), // Claude: ist Quelle, nicht „gelesen“
  ];
  const s = readNotCitedStats(resps, readNotCited(all), effectiveSources(all), [own, sumup]);
  it('gruppiert nach Domain und Subreddit', () => {
    expect(s.answers).toBe(2);
    const reddit = s.rows.find((r) => r.domain === 'reddit.com')!;
    expect(reddit.responses).toBe(2);
    expect(reddit.community).toBe('reddit');
    expect(reddit.subreddits.map((x) => [x.name, x.responses])).toEqual([['r/kassensysteme', 2], ['r/selbststaendig', 1]]);
    expect(reddit.subreddits[0]!.pages.map((p) => p.title)).toContain('Welches Terminal?');
    expect(s.rows[0]!.domain).toBe('reddit.com');
  });
  it('markiert eigene Domains, Community und lässt zitierte Seiten weg', () => {
    expect(s.rows.find((r) => r.domain === 'paylindo.de')!.type).toBe('own');
    expect(s.community.map((r) => r.domain).sort()).toEqual(['reddit.com', 'youtube.com']);
    expect(s.rows.some((r) => r.domain === 'chip.de')).toBe(false);
  });
});
