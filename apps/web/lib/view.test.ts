import { describe, expect, it } from 'vitest';
import type { Cit } from './metrics';
import { parseSimpleCron, scheduleText, toCron } from './schedule';
import { fillLevel, rankingWithOwn, recForDomain, recTarget, recTargets, shapingSources, toScore, topWithOwn } from './view';

describe('fillLevel / toScore', () => {
  it('ordnet Anteile den Punkten zu', () => {
    expect(fillLevel(null)).toBeNull();
    expect(fillLevel(undefined)).toBeNull();
    expect(fillLevel(Number.NaN)).toBeNull();
    expect(fillLevel(0)).toBe('none');
    expect(fillLevel(0.01)).toBe('some');
    expect(fillLevel(0.59)).toBe('some');
    expect(fillLevel(0.6)).toBe('often');
    expect(fillLevel(1)).toBe('often');
  });
  it('rundet auf 0–100 und klemmt', () => {
    expect(toScore(null)).toBe(0);
    expect(toScore(0.384)).toBe(38);
    expect(toScore(0.385)).toBe(39);
    expect(toScore(1.2)).toBe(100);
    expect(toScore(-0.1)).toBe(0);
  });
});

describe('rankingWithOwn', () => {
  const rows = [
    { name: 'A', responses: 10, rate: 0.5, own: false },
    { name: 'B', responses: 8, rate: 0.4, own: false },
    { name: 'C', responses: 6, rate: 0.3, own: false },
    { name: 'Du', responses: 2, rate: 0.1, own: true },
  ];
  it('hängt die eigene Marke außerhalb der Top n an', () => {
    const r = rankingWithOwn(rows, 2);
    expect(r.rows.map((x) => [x.name, x.place])).toEqual([['A', 1], ['B', 2], ['Du', 4]]);
    expect(r.ownExtra).toBe(true);
  });
  it('kein Extra, wenn die eigene Marke schon in den Top n ist', () => {
    const r = rankingWithOwn(rows, 5);
    expect(r.rows).toHaveLength(4);
    expect(r.ownExtra).toBe(false);
  });
  it('bei Gleichstand steht die eigene Marke vorn', () => {
    const r = rankingWithOwn([{ name: 'Z', responses: 3, rate: 0.3, own: false }, { name: 'Du', responses: 3, rate: 0.3, own: true }], 1);
    expect(r.rows.map((x) => x.name)).toEqual(['Du']);
  });
  it('ohne eigene Marke nur die Top n', () => {
    expect(rankingWithOwn(rows.filter((x) => !x.own), 1).rows.map((x) => x.name)).toEqual(['A']);
  });
});

describe('shapingSources', () => {
  const c = (responseId: string, url: string): Cit => ({ responseId, url, domain: new URL(url).hostname, title: null, position: 1, kind: 'cited' });
  it('zählt Antworten je Domain, Reddit je Subreddit, ohne ausgeschlossene Domains', () => {
    const cits = [
      c('r1', 'https://www.check24.de/a'), c('r1', 'https://check24.de/b'), c('r2', 'https://check24.de/c'),
      c('r1', 'https://www.reddit.com/r/Finanzen/comments/x'), c('r3', 'https://www.reddit.com/r/finanzen/y'),
      c('r2', 'https://www.reddit.com/r/de/z'),
      c('r1', 'https://shop.paylindo.de/x'),
    ];
    expect(shapingSources(cits, 3, ['paylindo.de'])).toEqual([
      { label: 'check24.de', responses: 2 },
      { label: 'r/finanzen', responses: 2 },
      { label: 'r/de', responses: 1 },
    ]);
  });
});

describe('Messplan', () => {
  it('liest einfache Cron-Ausdrücke', () => {
    expect(parseSimpleCron('17 3 * * 1')).toEqual({ day: 1, hour: 3, minute: 17 });
    expect(parseSimpleCron(' 0  8 * * * ')).toEqual({ day: 'daily', hour: 8, minute: 0 });
    expect(parseSimpleCron('0 6 * * 7')).toEqual({ day: 0, hour: 6, minute: 0 });
  });
  it('lehnt komplexe Ausdrücke ab', () => {
    for (const x of ['*/15 * * * *', '0 3 1 * *', '0 3 * * 1-5', '0 3 * * 1,3', '60 3 * * 1', '0 24 * * 1', '0 3 * *', 'abc']) expect(parseSimpleCron(x)).toBeNull();
  });
  it('schreibt Cron zurück (Rundreise)', () => {
    for (const x of ['17 3 * * 1', '0 8 * * *', '30 22 * * 0']) expect(toCron(parseSimpleCron(x)!)).toBe(x);
  });
  it('formuliert Klartext', () => {
    expect(scheduleText('17 3 * * 1')).toBe('Jeden Montag, 3:17 Uhr');
    expect(scheduleText('5 18 * * *')).toBe('Täglich, 18:05 Uhr');
    expect(scheduleText('0 3 * * 1-5')).toBe('Eigener Zeitplan (0 3 * * 1-5)');
  });
});

describe('Quellen ↔ Maßnahmen', () => {
  it('liest das Ziel aus dem Schlüssel', () => {
    expect(recTarget('outreach:Check24.de')).toBe('check24.de');
    expect(recTarget('community:reddit:r/finanzen')).toBe('r/finanzen');
    expect(recTarget('community:youtube:youtube')).toBe('youtube.com');
    expect(recTarget('community:forum:forum.example.de')).toBe('forum.example.de');
    expect(recTarget('content_gap:123')).toBeNull();
    expect(recTarget('technical:robots')).toBeNull();
  });
  it('nur aktive, nicht ausgeblendete Maßnahmen; www egal', () => {
    const t = recTargets([
      { id: '1', key: 'outreach:check24.de', active: true, status: 'open' },
      { id: '2', key: 'outreach:alt.de', active: false, status: 'open' },
      { id: '3', key: 'outreach:weg.de', active: true, status: 'dismissed' },
      { id: '4', key: 'community:reddit:r/finanzen', active: true, status: 'done' },
    ]);
    expect(recForDomain(t, 'www.check24.de')).toBe('1');
    expect(recForDomain(t, 'CHECK24.DE')).toBe('1');
    expect(recForDomain(t, 'alt.de')).toBeUndefined();
    expect(recForDomain(t, 'weg.de')).toBeUndefined();
    expect(recForDomain(t, 'r/finanzen')).toBe('4');
  });
});

describe('topWithOwn', () => {
  const rows = [{ name: 'A', own: false, place: 1 }, { name: 'B', own: false, place: 2 }, { name: 'Du', own: true, place: 3 }];
  it('hängt die eigene Marke mit ihrem Platz an', () => {
    expect(topWithOwn(rows, 2)).toEqual({ rows: [rows[0], rows[1], rows[2]], ownExtra: true });
    expect(topWithOwn(rows, 3).ownExtra).toBe(false);
  });
});
