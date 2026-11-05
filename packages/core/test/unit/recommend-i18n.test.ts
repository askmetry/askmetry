// Standardtexte der Maßnahmen in beiden Sprachen (evidence.texts) und Sprache der KI-Formulierung.
import { describe, expect, it } from 'vitest';
import { indexData, type Cit, type Ment, type RecData, type Resp, type SiteCheckResult } from '../../src/recommend/data.ts';
import { payloadOf, sanitize } from '../../src/recommend/phrase.ts';
import { buildCandidates, outreachExclusionsFrom, type Candidate } from '../../src/recommend/rules.ts';
import { profilePrompt } from '../../src/recommend/profile.ts';

const brands = [
  { id: 'b-own', name: 'Paylindo', domains: ['paylindo.de'], isOwn: true },
  { id: 'b-sumup', name: 'SumUp', domains: ['sumup.de'], isOwn: false },
  { id: 'b-zettle', name: 'Zettle', domains: ['zettle.com'], isOwn: false },
];

/** Messung, die möglichst alle Regeln auslöst (eigene Seite, Outreach je Quellenart, Lücke, Community, Positionierung, Stimmung). */
function richFixture(lang?: 'de' | 'en'): RecData {
  const resps: Resp[] = [], ments: Ment[] = [], cits: Cit[] = [];
  const prompts = new Map<string, { id: string; text: string; topicId: null; topicName: null }>();
  const rows: { p: string; e: string; m: string[]; c: string[] }[] = [];
  const engines = ['chatgpt', 'gemini', 'claude'];
  // p1–p3: nur Wettbewerber, viele Drittquellen + Community
  for (const p of ['p1', 'p2', 'p3']) for (const e of engines) rows.push({
    p, e, m: ['SumUp:1:r', 'Zettle:2'],
    c: [...(p === 'p1' ? ['https://paylindo.de/ratgeber/kosten'] : []), 'https://kartenzahlung-vergleich.de/test', 'https://g2.com/x', 'https://handelsblatt.com/a', 'https://blog-ratgeber.de/b',
      'https://reddit.com/r/Kartenzahlung/comments/abc/frage/', 'https://reddit.com/r/Kartenzahlung/comments/def/zwei/', 'https://youtube.com/watch?v=abc123',
      'https://youtube.com/watch?v=def456', 'https://forum.kassen.de/t/1', 'https://forum.kassen.de/t/2'],
  });
  // p4–p6: beide genannt, SumUp vorn; eine negative Nennung
  for (const p of ['p4', 'p5', 'p6']) for (const e of engines) rows.push({ p, e, m: ['SumUp:1:r', `Paylindo:2${p === 'p4' && e === 'chatgpt' ? ':n' : ''}`], c: ['https://test.de/x'] });
  rows.forEach((r, i) => {
    const id = `r${i}`;
    resps.push({ id, promptId: r.p, engine: r.e });
    if (!prompts.has(r.p)) prompts.set(r.p, { id: r.p, text: r.p === 'p3' ? 'Welches Kartenterminal passt für p3 – SumUp oder Zettle?' : `Welches Kartenterminal passt für ${r.p}?`, topicId: null, topicName: null });
    for (const m of r.m) {
      const [name, pos, ...flags] = m.split(':');
      const b = brands.find((x) => x.name === name);
      ments.push({ responseId: id, brandId: b?.id ?? null, name, position: Number(pos), recommended: flags.includes('r'), sentiment: flags.includes('n') ? 'negative' : 'neutral', snippet: `${name} ist günstig und hat keine Vertragslaufzeit – Antwort ${i}.` });
    }
    r.c.forEach((url, j) => cits.push({ responseId: id, url, domain: new URL(url).hostname.replace(/^www\./, ''), title: null, position: j + 1, kind: 'cited' }));
  });
  const check: SiteCheckResult = {
    domain: 'paylindo.de',
    home: { status: 200, finalUrl: 'https://paylindo.de/', textChars: 120, jsonLd: [] },
    robots: { status: 200, found: true, blocked: ['OAI-SearchBot', 'GPTBot', 'Google-Extended'], allowed: [] },
    llmsTxt: { status: 404, found: false },
    wikidata: { status: 'none', ids: [], wikipedia: [] },
  };
  return { workspaceId: 'ws', collectionId: 'c1', at: new Date('2026-11-02'), brands, prompts, resps, ments, cits, siteChecks: [check], ...(lang ? { lang } : {}) };
}

const GERMAN = /[äöüÄÖÜß„]| und | oder | nicht | für | mit | der | die | das |Antworten|Seite |prüfen|Maßnahme/;
const allText = (t: { title: string; why: string; steps: string[] }) => [t.title, t.why, ...t.steps].join(' \n ');
// Fremdinhalt (Fragen, Ausschnitte, Thread-Titel aus der Fixture) ist deutsch – vor der Prüfung entfernen
const stripData = (s: string) => s.replace(/Welches Kartenterminal passt für p\d( – SumUp oder Zettle)?\??/g, '').replace(/“[^”]*”/g, '“”');

describe('Maßnahmen-Texte in zwei Sprachen', () => {
  const de = buildCandidates(richFixture());
  const en = buildCandidates(richFixture('en'));

  it('deckt alle Regeltypen ab', () => {
    expect(new Set(de.map((c) => c.type))).toEqual(new Set(['name_on_own_page', 'outreach', 'content_gap', 'comparison', 'reviews', 'entity', 'community', 'technical', 'positioning', 'sentiment']));
    expect(de.some((c) => c.key === 'community:youtube:youtube')).toBe(true);
    expect(de.some((c) => c.key.startsWith('community:forum:'))).toBe(true);
  });

  it('jede Maßnahme hat texts.de und texts.en mit gleich vielen Schritten', () => {
    for (const c of de) {
      expect(c.texts.de, c.key).toBeTruthy();
      expect(c.texts.en, c.key).toBeTruthy();
      expect(c.texts.en.steps.length, c.key).toBe(c.texts.de.steps.length);
      for (const t of [c.texts.de, c.texts.en]) {
        expect(t.title.length, t.title).toBeLessThanOrEqual(70);
        expect(t.why.length, t.why).toBeLessThanOrEqual(140);
        expect(t.steps.every((s) => s.trim().length > 5), c.key).toBe(true);
      }
    }
  });

  it('Englisch ohne deutsche Reste (abgesehen von Fremdinhalt aus den Belegen)', () => {
    for (const c of de) {
      const txt = stripData(allText(c.texts.en));
      expect(txt, `${c.key}: ${txt}`).not.toMatch(GERMAN);
    }
  });

  it('title/why/steps = Workspace-Sprache; Standard Deutsch', () => {
    for (const c of de) expect({ title: c.title, why: c.why, steps: c.steps }).toEqual(c.texts.de);
    expect(en.map((c) => c.key)).toEqual(de.map((c) => c.key));
    for (const c of en) {
      expect({ title: c.title, why: c.why, steps: c.steps }).toEqual(c.texts.en);
      // gleiche Texte je Sprache unabhängig von der Workspace-Sprache, gleiche Evidenz-Signatur
      const d = de.find((x) => x.key === c.key)!;
      expect(c.texts).toEqual(d.texts);
      expect(c.signature).toEqual(d.signature);
      expect(c.priority).toBe(d.priority);
    }
  });

  it('technische Einordnung (consequence/redirects) in beiden Sprachen', () => {
    const r = de.find((c) => c.key === 'technical:robots')!;
    const e = en.find((c) => c.key === 'technical:robots')!;
    expect(r.evidence.consequence).toMatch(/Damit können/);
    expect(e.evidence.consequence).toMatch(/can’t fetch/);
    expect((r.evidence.consequenceByLang as Record<string, string>).en).toBe(e.evidence.consequence);
  });

  it('Gründe ohne Outreach-Maßnahme auf Englisch', () => {
    const ix = indexData(richFixture());
    const deX = outreachExclusionsFrom(ix, { max: 1 });
    const enX = outreachExclusionsFrom(ix, { max: 1, lang: 'en' });
    expect(enX.map((x) => x.reason)).toEqual(deX.map((x) => x.reason));
    expect(deX.some((x) => /nicht unter den 1 wichtigsten Quellen/.test(x.text))).toBe(true);
    expect(enX.some((x) => /not among the 1 most important sources/.test(x.text))).toBe(true);
    for (const x of enX) expect(x.text, x.text).not.toMatch(/[äöüß]| und | nicht /);
  });
});

describe('KI-Formulierung', () => {
  it('schickt keine Texte anderer Sprachen an die KI', () => {
    const cands = buildCandidates(richFixture('en'));
    const json = JSON.stringify(payloadOf(cands));
    expect(json).not.toMatch(/"texts"|"consequenceByLang"|"redirectsByLang"/);
    // Entwurf in der Workspace-Sprache
    expect(payloadOf(cands)[0]!.draft).toEqual(cands[0]!.texts.en);
  });

  it('sanitize: Sie/Ihr-Prüfung nur auf Deutsch', () => {
    const c = buildCandidates(richFixture()).find((x) => x.type === 'positioning') as Candidate;
    const t = { title: 'Ihr Vergleich mit SumUp ausbauen', why: 'SumUp steht in 9 von 9 gemeinsamen Antworten vor Paylindo.', steps: ['Ihre Stärken sammeln.', 'Vergleichsseite veröffentlichen.'] };
    expect(sanitize(t, c)).toBeNull();
    expect(sanitize(t, c, 'de')).toBeNull();
    const en = { title: 'Position Paylindo clearly against SumUp', why: 'SumUp comes before Paylindo in 9 of 9 shared answers.', steps: ['Collect your strengths.', 'Publish a fair comparison page.'] };
    expect(sanitize(en, c, 'en')).toMatchObject({ title: en.title, steps: en.steps });
  });
});

describe('Markenprofil-Prompt', () => {
  const page = { url: 'https://paylindo.de/', title: 'Paylindo', metaDescription: null, headings: [], text: 'Kartenzahlung für kleine Läden' };
  it('Satz in der Workspace-Sprache', () => {
    expect(profilePrompt('Paylindo', page)).toMatch(/genau EIN deutscher Satz/);
    expect(profilePrompt('Paylindo', page, 'en')).toMatch(/exactly ONE English sentence/);
  });
});
