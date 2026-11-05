import { describe, expect, it } from 'vitest';
import { areaCounts, checkStep, cleanDomain, lockedCount, refreshSeconds, roughScore, strongestCompetitor, teaserRanking } from './teaser';

describe('roughScore', () => {
  it('rundet auf 5er-Schritte', () => {
    expect(roughScore(0.31)).toBe(30);
    expect(roughScore(0.33)).toBe(35);
    expect(roughScore(1)).toBe(100);
  });
  it('0 nur ohne Nennung, sonst mindestens 5', () => {
    expect(roughScore(0)).toBe(0);
    expect(roughScore(null)).toBe(0);
    expect(roughScore(Number.NaN)).toBe(0);
    expect(roughScore(0.01)).toBe(5);
  });
  it('klemmt Werte über 1', () => expect(roughScore(1.4)).toBe(100));
});

describe('lockedCount', () => {
  it('zieht die freien Maßnahmen ab, nie negativ', () => {
    expect(lockedCount({ recommendationsTotal: 14 }, 2)).toBe(12);
    expect(lockedCount({ recommendationsTotal: 1 }, 2)).toBe(0);
    expect(lockedCount({ recommendationsTotal: 0 }, 0)).toBe(0);
  });
});

describe('areaCounts', () => {
  it('feste Reihenfolge, leere Bereiche fehlen', () => {
    expect(areaCounts({ technical: 2, own_content: 5, community: 0, other_sites: 3 })).toEqual([
      { area: 'own_content', cat: 'content', n: 5 },
      { area: 'other_sites', cat: 'offsite', n: 3 },
      { area: 'technical', cat: 'technical', n: 2 },
    ]);
    expect(areaCounts(null)).toEqual([]);
  });
});

describe('teaserRanking', () => {
  const s = { brand: { name: 'Paylindo', domain: 'paylindo.de', description: null }, promptsMentioned: 3, competitors: [{ name: 'SumUp', promptsMentioned: 8 }, { name: 'Zettle', promptsMentioned: 3 }] };
  it('sortiert absteigend, eigene Marke bei Gleichstand zuerst', () => {
    expect(teaserRanking(s).map((r) => [r.name, r.own])).toEqual([['SumUp', false], ['Paylindo', true], ['Zettle', false]]);
  });
  it('höchstens n Wettbewerber', () => {
    expect(teaserRanking(s, 1)).toHaveLength(2);
  });
});

describe('strongestCompetitor', () => {
  it('nur wenn genannt', () => {
    expect(strongestCompetitor({ topCompetitor: { name: 'SumUp', promptsMentioned: 0 } })).toBeNull();
    expect(strongestCompetitor({ topCompetitor: null })).toBeNull();
    expect(strongestCompetitor({ topCompetitor: { name: 'SumUp', promptsMentioned: 4 } })?.name).toBe('SumUp');
  });
});

describe('Status', () => {
  it('Schritte und Aktualisierung', () => {
    expect(checkStep('discovering')).toBe(0);
    expect(checkStep('awaiting_email')).toBe(1);
    expect(checkStep('measuring')).toBe(2);
    expect(checkStep('ready')).toBe(3);
    expect(refreshSeconds('awaiting_email')).toBeNull();
    expect(refreshSeconds('ready')).toBeNull();
    expect(refreshSeconds('queued')).toBe(5);
  });
});

describe('cleanDomain', () => {
  it('normalisiert und verwirft Unsinn', () => {
    expect(cleanDomain('https://www.Example.com/path?q')).toBe('example.com');
    expect(cleanDomain('reddit.com')).toBe('reddit.com');
    expect(cleanDomain('javascript:alert(1)')).toBeNull();
    expect(cleanDomain('localhost')).toBeNull();
  });
});
