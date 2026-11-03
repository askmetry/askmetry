import { describe, expect, it } from 'vitest';
import { linkify, linkTargets } from './linkify.ts';

const t = linkTargets(
  ['https://www.paylindo.de/ratgeber/kosten/', 'https://gruendung.de/kartenterminal-vergleich?utm=x', 'https://www.reddit.com/r/Kartenzahlung/comments/1/a/'],
  ['paylindo.de', 'handelsblatt.com'],
);
const links = (s: string) => linkify(s, t).filter((p) => typeof p !== 'string');

describe('linkify', () => {
  it('verlinkt Kurzpfade aus den Belegen mit der Original-URL', () => {
    expect(links('Zuerst paylindo.de/ratgeber/kosten überarbeiten.')).toEqual([{ href: 'https://www.paylindo.de/ratgeber/kosten/', label: 'paylindo.de/ratgeber/kosten' }]);
    expect(linkify('Seite paylindo.de/ratgeber/kosten.', t).at(-1)).toBe('.');
  });
  it('verlinkt bekannte Domains, Subreddits und volle URLs bekannter Hosts', () => {
    expect(links('handelsblatt.com eine Auswertung anbieten')).toEqual([{ href: 'https://handelsblatt.com', label: 'handelsblatt.com' }]);
    expect(links('In r/Kartenzahlung mitdiskutieren')).toEqual([{ href: 'https://www.reddit.com/r/Kartenzahlung/', label: 'r/Kartenzahlung' }]);
    expect(links('Siehe https://gruendung.de/kartenterminal-vergleich?utm=x)')[0]).toMatchObject({ href: 'https://gruendung.de/kartenterminal-vergleich?utm=x' });
  });
  it('verlinkt nichts Unbekanntes oder Gefährliches', () => {
    expect(links('Mehr auf boese.de/seite und javascript:alert(1) sowie https://boese.de/x')).toEqual([]);
    expect(links('z. B. „Paylindo-Kostenvergleich 2026“, ca. 2 Std.')).toEqual([]);
    expect(links('paylindo.de/robots.txt prüfen')).toEqual([]);
  });
  it('verlinkt zitierte Titel nur, wenn sie aus den Belegen stammen', () => {
    const tt = linkTargets([{ url: 'https://www.reddit.com/r/Kartenzahlung/comments/1/a/', title: 'Eure meinung' }], []);
    const parts = linkify('Diese Threads lesen: „Eure meinung“, „Erfunden“.', tt);
    expect(parts.filter((p) => typeof p !== 'string')).toEqual([{ href: 'https://www.reddit.com/r/Kartenzahlung/comments/1/a/', label: 'Eure meinung' }]);
    expect(parts.map((p) => (typeof p === 'string' ? p : p.label)).join('')).toBe('Diese Threads lesen: „Eure meinung“, „Erfunden“.');
  });
  it('verlinkt Kurzpfade auch in Anführungszeichen, ohne Satzzeichen im href', () => {
    const parts = linkify('Siehe „paylindo.de/ratgeber/kosten“ und paylindo.de/preise… dann', t);
    expect(parts.filter((p) => typeof p !== 'string')).toEqual([
      { href: 'https://www.paylindo.de/ratgeber/kosten/', label: 'paylindo.de/ratgeber/kosten' },
      { href: 'https://paylindo.de/preise', label: 'paylindo.de/preise' },
    ]);
    expect(parts.map((p) => (typeof p === 'string' ? p : p.label)).join('')).toBe('Siehe „paylindo.de/ratgeber/kosten“ und paylindo.de/preise… dann');
  });
  it('fremde Hosts nur mit exakter Beleg-URL, keine Subdomains', () => {
    expect(links('reddit.com/user/spam und https://www.reddit.com/r/scam/wiki und news.handelsblatt.com')).toEqual([]);
  });
  it('Text bleibt vollständig erhalten', () => {
    const s = 'Lies paylindo.de/ratgeber/kosten und r/Kartenzahlung, dann handelsblatt.com.';
    expect(linkify(s, t).map((p) => (typeof p === 'string' ? p : p.label)).join('')).toBe(s);
  });
});
