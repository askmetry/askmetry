import { describe, expect, it } from 'vitest';
import { matchesAnyDomain, matchesDomain, normalizeDomain } from '../../src/domains.ts';

describe('normalizeDomain', () => {
  it('entfernt www. und Schema, kleingeschrieben', () => {
    expect(normalizeDomain('https://www.SumUp.de/de-de/preise?x=1')).toBe('sumup.de');
    expect(normalizeDomain('www.paylindo.de')).toBe('paylindo.de');
    expect(normalizeDomain('paylindo.de')).toBe('paylindo.de');
    expect(normalizeDomain('https://blog.medishift.com/')).toBe('blog.medishift.com');
  });
  it('liefert null für Ungültiges', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain('http://')).toBeNull();
  });
});

describe('IDN', () => {
  it('Umlaut-Domains und Punycode sind gleich', () => {
    expect(normalizeDomain('https://www.Müller-Bäckerei.de/preise')).toBe('xn--mller-bckerei-hfb76a.de');
    expect(normalizeDomain('müller-bäckerei.de')).toBe(normalizeDomain('xn--mller-bckerei-hfb76a.de'));
    expect(matchesDomain('blog.xn--mller-bckerei-hfb76a.de', 'müller-bäckerei.de')).toBe(true);
    expect(matchesDomain('https://shop.müller-bäckerei.de/', 'xn--mller-bckerei-hfb76a.de')).toBe(true);
  });
});

describe('matchesDomain', () => {
  it('exakt oder Subdomain', () => {
    expect(matchesDomain('paylindo.de', 'paylindo.de')).toBe(true);
    expect(matchesDomain('blog.paylindo.de', 'paylindo.de')).toBe(true);
    expect(matchesDomain('www.paylindo.de', 'paylindo.de')).toBe(true);
    expect(matchesDomain('paylindo.de', 'www.paylindo.de')).toBe(true);
  });
  it('kein Treffer bei ähnlichen Domains', () => {
    expect(matchesDomain('notpaylindo.de', 'paylindo.de')).toBe(false);
    expect(matchesDomain('paylindo.de.evil.com', 'paylindo.de')).toBe(false);
    expect(matchesDomain(null, 'paylindo.de')).toBe(false);
  });
  it('matchesAnyDomain', () => {
    expect(matchesAnyDomain('sumup.com', ['sumup.de', 'sumup.com'])).toBe(true);
    expect(matchesAnyDomain('sumup.org', ['sumup.de', 'sumup.com'])).toBe(false);
  });
});
