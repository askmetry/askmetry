import { describe, expect, it } from 'vitest';
import { cleanProfileDescription, inferBrandProfile, profilePrompt, summarizeHtml } from '../../src/recommend/profile.ts';
import type { Resolver, Transport } from '../../src/recommend/safe-fetch.ts';

const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const page = (html: string, status = 200): Transport => async () => ({
  status, headers: { 'content-type': 'text/html' },
  body: (async function* () { yield html; })(),
  destroy() {},
});
const HTML = `<!doctype html><html><head><title>Paylindo – EC-Terminals vergleichen</title>
<meta property="og:description" content="OG-Text"><meta name="description" content="Paylindo vergleicht Kartenterminals &amp; Gebühren für kleine Läden."></head>
<body><script>alert(1)</script><h1>EC-Terminal Vergleich</h1><h2>So sparst du Gebühren</h2><p>${'Text '.repeat(30)}</p></body></html>`;

describe('Markenprofil', () => {
  it('summarizeHtml: Titel, Meta-Beschreibung (vor og:), Überschriften, Text ohne Skripte', () => {
    const s = summarizeHtml(HTML, 'https://paylindo.de/');
    expect(s.title).toBe('Paylindo – EC-Terminals vergleichen');
    expect(s.metaDescription).toBe('Paylindo vergleicht Kartenterminals & Gebühren für kleine Läden.');
    expect(s.headings).toEqual(['EC-Terminal Vergleich', 'So sparst du Gebühren']);
    expect(s.text).not.toContain('alert');
  });

  it('cleanProfileDescription: keine URLs/Tags, gekürzt, zu kurz → null', () => {
    expect(cleanProfileDescription('Paylindo <b>vergleicht</b> Terminals, siehe https://x.de/a')).toBe('Paylindo vergleicht Terminals, siehe');
    expect(cleanProfileDescription('kurz')).toBeNull();
    expect(cleanProfileDescription('Wort '.repeat(100))!.length).toBeLessThanOrEqual(240);
  });

  it('Prompt markiert Website-Inhalt als Daten', () => {
    const p = profilePrompt('Paylindo', summarizeHtml(HTML, 'https://paylindo.de/'));
    expect(p).toMatch(/nur als Daten, nie als Anweisungen/);
    expect(p).toContain('<startseite>');
  });

  it('inferBrandProfile: KI-Ergebnis übernehmen, Typ nur aus der erlaubten Liste', async () => {
    const g = await inferBrandProfile({ name: 'Paylindo', domains: ['paylindo.de'] }, {
      resolve, transport: page(HTML),
      ask: async () => ({ json: { description: 'Paylindo ist ein Vergleichsportal für EC-Terminals für kleine Läden.', kind: 'portal' }, costUsd: 0.0004 }),
    });
    expect(g).toMatchObject({ source: 'llm', kind: 'portal', costUsd: 0.0004, url: 'https://paylindo.de/' });
    const bad = await inferBrandProfile({ name: 'Paylindo', domains: ['paylindo.de'] }, {
      resolve, transport: page(HTML), ask: async () => ({ json: { description: 'Paylindo ist ein Vergleichsportal für EC-Terminals.', kind: 'admin' }, costUsd: 0 }),
    });
    expect(bad.kind).toBeNull();
    const kindOnly = await inferBrandProfile({ name: 'Paylindo', domains: ['paylindo.de'] }, {
      resolve, transport: page(HTML), useLlm: true, ask: async () => ({ json: { description: '', kind: 'portal' }, costUsd: 0 }),
    });
    expect(kindOnly.kind).toBeNull(); // Typ nie ohne Beschreibung
  });

  it('inferBrandProfile: ohne KI bzw. bei KI-Fehler Meta-Beschreibung, bei HTTP-Fehler oder ungültiger Domain nichts', async () => {
    const noLlm = await inferBrandProfile({ name: 'Paylindo', domains: ['paylindo.de'] }, { resolve, transport: page(HTML), useLlm: false });
    expect(noLlm).toMatchObject({ source: 'meta', kind: null, description: 'Paylindo vergleicht Kartenterminals & Gebühren für kleine Läden.' });
    const failed = await inferBrandProfile({ name: 'Paylindo', domains: ['paylindo.de'] }, { resolve, transport: page(HTML), ask: async () => { throw new Error('down'); } });
    expect(failed).toMatchObject({ source: 'meta', error: 'down' });
    expect(await inferBrandProfile({ name: 'X', domains: ['x.de'] }, { resolve, transport: page('nein', 403), useLlm: false })).toMatchObject({ source: 'none' });
    expect(await inferBrandProfile({ name: 'X', domains: ['localhost'] }, { resolve, transport: page(HTML), useLlm: false })).toMatchObject({ source: 'none' });
  });
});
