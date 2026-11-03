import { describe, expect, it } from 'vitest';
import {
  brandMetrics, competitorOnlyDomains, domainMatches, domainStats, findGaps, highlightSegments, normalizeHost, parseList, ratio,
  untrackedBrands, usedNotNamed, type Cit, type Ment, type Resp,
} from './metrics';
import { fmtPct, fmtNum } from './format';

const R = (id: string, engine = 'chatgpt', promptId = 'p1'): Resp => ({ id, runId: 'run-' + id, promptId, engine, repetition: 1, topicId: null, collectionId: 'c1' });
const M = (responseId: string, brandId: string | null, position: number, recommended = false, name = brandId ?? 'X'): Ment =>
  ({ responseId, brandId, name, position, recommended, sentiment: 'neutral', snippet: null });
const C = (responseId: string, url: string, kind: 'cited' | 'searched' = 'cited'): Cit =>
  ({ responseId, url, domain: new URL(url).hostname, title: null, position: 1, kind });

const own = { id: 'own', name: 'Paylindo', domains: ['paylindo.de'], isOwn: true };
const sumup = { id: 'sumup', name: 'SumUp', domains: ['sumup.com'], isOwn: false };

describe('Domain-Abgleich', () => {
  it('normalisiert Hosts', () => {
    expect(normalizeHost('https://WWW.Paylindo.de/blog?x=1')).toBe('paylindo.de');
    expect(normalizeHost('www.example.com:8080')).toBe('example.com');
  });
  it('gleicht IDN-Domains mit Punycode-Hosts ab', () => {
    expect(normalizeHost('https://www.Müller-Bäckerei.de/x')).toBe('xn--mller-bckerei-hfb76a.de');
    expect(domainMatches('blog.xn--mller-bckerei-hfb76a.de', ['müller-bäckerei.de'])).toBe(true);
    expect(domainMatches('müller-bäckerei.de', ['xn--mller-bckerei-hfb76a.de'])).toBe(true);
    // gespeichert wird lesbar
    expect(parseList('www.Müller-Bäckerei.de', { domains: true })).toEqual(['müller-bäckerei.de']);
  });
  it('erkennt exakte Domain und Subdomains, aber keine Suffix-Fremden', () => {
    expect(domainMatches('paylindo.de', ['paylindo.de'])).toBe(true);
    expect(domainMatches('www.paylindo.de', ['paylindo.de'])).toBe(true);
    expect(domainMatches('blog.paylindo.de', ['www.paylindo.de'])).toBe(true);
    expect(domainMatches('notpaylindo.de', ['paylindo.de'])).toBe(false);
    expect(domainMatches('paylindo.de.evil.com', ['paylindo.de'])).toBe(false);
    expect(domainMatches('paylindo.de', [])).toBe(false);
  });
  it('parst Listen', () => {
    expect(parseList('a, b ,a,,c')).toEqual(['a', 'b', 'c']);
    expect(parseList('https://www.x.de/, x.de; Y.com', { domains: true })).toEqual(['x.de', 'y.com']);
  });
});

describe('Prozente', () => {
  it('ratio und Formatierung', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(17, 45)).toBeCloseTo(0.3778);
    expect(fmtPct(17 / 45)).toBe('38 %');
    expect(fmtPct(null)).toBe('–');
    expect(fmtNum(2.25)).toBe('2,3');
  });
});

describe('Kennzahlen', () => {
  const resps = [R('a'), R('b'), R('c'), R('d', 'claude')];
  const ments = [
    M('a', 'own', 2, true), M('a', 'sumup', 1),
    M('b', 'sumup', 1), M('b', null, 2, false, 'Qonto'),
    M('c', 'own', 1),
    M('x', 'own', 1), // fremde Antwort – darf nicht zählen
  ];
  const cits = [
    C('a', 'https://www.paylindo.de/a'), C('a', 'https://paylindo.de/b'),
    C('b', 'https://blog.paylindo.de/x'),
    // d: Engine ohne Zitate (z. B. Claude) – alle Quellen nur durchsucht, zählen laut Quellenregel
    C('d', 'https://paylindo.de/c', 'searched'), C('d', 'https://sumup.com/', 'searched'),
  ];
  it('berechnet Sichtbarkeit, Position, Empfehlung, SoV, eigene Seite', () => {
    const m = brandMetrics(resps, ments, cits, own);
    expect(m.n).toBe(4);
    expect(m.visibility).toBe(0.5);
    expect(m.avgPosition).toBe(1.5);
    expect(m.recommendationRate).toBe(0.25);
    expect(m.shareOfVoice).toBe(2 / 5);
    expect(m.ownSite).toBe(3);
    expect(m.ownSiteRate).toBe(0.75);
    expect(m.ownSiteSearchedOnly).toBe(1);
  });
  it('fasst ungetrackte Marken zusammen', () => {
    const u = untrackedBrands(resps, [...ments, M('c', null, 3, false, 'qonto')]);
    expect(u[0]).toMatchObject({ name: 'Qonto', responses: 2 });
  });
  it('Quellen: Anteil an allen Antworten (wie Übersicht), Typ', () => {
    const s = domainStats(resps, cits, [own, sumup]);
    expect(s.base).toBe(4);
    expect(s.withSources).toBe(3);
    expect(s.rows[0]!.share).toBe(0.5);
    expect(s.rows[0]).toMatchObject({ domain: 'paylindo.de', responses: 2, type: 'own' });
    expect(s.rows.find((r) => r.domain === 'sumup.com')).toMatchObject({ type: 'competitor', brandName: 'SumUp' });
  });
  it('Als Quelle genutzt, aber nicht genannt', () => {
    const u = usedNotNamed(resps, ments, cits, own);
    expect(u.map((x) => x.response.id).sort()).toEqual(['b', 'd']);
  });
  it('Wettbewerber genannt, du nicht', () => {
    const r = competitorOnlyDomains(resps, ments, [...cits, C('b', 'https://vergleich.de/x')], [own, sumup]);
    expect(r.answers).toBe(1);
    expect(r.rows.map((x) => x.domain)).toEqual(['vergleich.de']);
    expect(r.rows[0]!.competitors).toEqual(['SumUp']);
  });
  it('Lücken je Prompt × Engine', () => {
    const rs = [R('a', 'chatgpt'), R('b', 'gemini'), R('c', 'claude'), R('e', 'claude')];
    const ms = [M('a', 'own', 1), M('b', 'sumup', 1), M('c', 'sumup', 1)];
    const g = findGaps(rs, ms, [own, sumup]);
    expect(g).toHaveLength(1);
    expect(g[0]!.missing).toEqual(['gemini', 'claude']);
    expect(g[0]!.named[0]).toMatchObject({ name: 'SumUp', competitor: true, count: 2 });
  });
});

describe('Hervorhebung', () => {
  it('markiert ganze Wörter, längste zuerst, case-insensitive', () => {
    const s = highlightSegments('Paylindo vergleicht SumUp-Geräte, nicht SumUpX. paylindo.de', [
      { term: 'Paylindo', kind: 'own' }, { term: 'SumUp', kind: 'competitor' }, { term: 'paylindo.de', kind: 'own' },
    ]);
    expect(s.filter((x) => x.kind).map((x) => x.text)).toEqual(['Paylindo', 'SumUp', 'paylindo.de']);
    expect(s.map((x) => x.text).join('')).toBe('Paylindo vergleicht SumUp-Geräte, nicht SumUpX. paylindo.de');
  });
});
