import { describe, expect, it } from 'vitest';
import { communityGroup, indexData, titleFromUrl, type Cit, type Ment, type RecData, type Resp, type SiteCheckResult } from '../../src/recommend/data.ts';
import { sanitize, signatureHash } from '../../src/recommend/phrase.ts';
import {
  buildCandidates, outreachExclusionsFrom, priorityOf, sourceKindOf, ruleCommunity, ruleContentGap, ruleNameOnOwnPage, ruleOutreach, rulePositioning, ruleSentiment, ruleTechnical, suggestTitle,
} from '../../src/recommend/rules.ts';

const OWN = 'b-own', SUMUP = 'b-sumup', ZETTLE = 'b-zettle';
const brands = [
  { id: OWN, name: 'Paylindo', domains: ['paylindo.de'], isOwn: true },
  { id: SUMUP, name: 'SumUp', domains: ['sumup.de', 'sumup.com'], isOwn: false },
  { id: ZETTLE, name: 'Zettle', domains: ['zettle.com'], isOwn: false },
];

/** kleine Messung: Antworten mit Marken (Name:Position[:r = empfohlen][:n = negativ]) und Quellen (url[|s = searched]) */
function fixture(rows: { p: string; e: string; m?: string[]; c?: string[] }[], extra: Partial<RecData> = {}): RecData {
  const resps: Resp[] = [], ments: Ment[] = [], cits: Cit[] = [];
  const prompts = new Map<string, { id: string; text: string; topicId: null; topicName: null }>();
  rows.forEach((r, i) => {
    const id = `r${i}`;
    resps.push({ id, promptId: r.p, engine: r.e });
    if (!prompts.has(r.p)) prompts.set(r.p, { id: r.p, text: `Frage ${r.p}?`, topicId: null, topicName: null });
    for (const m of r.m ?? []) {
      const [name, pos, ...flags] = m.split(':');
      const b = brands.find((x) => x.name === name);
      ments.push({ responseId: id, brandId: b?.id ?? null, name, position: Number(pos), recommended: flags.includes('r'), sentiment: flags.includes('n') ? 'negative' : 'neutral', snippet: `${name} ist eine gute Wahl für kleine Händler, sagt die KI in Antwort ${i}.` });
    }
    (r.c ?? []).forEach((u, j) => {
      const [url, k] = u.split('|');
      cits.push({ responseId: id, url, domain: new URL(url).hostname.replace(/^www\./, ''), title: null, position: j + 1, kind: k === 's' ? 'searched' : 'cited' });
    });
  });
  return { workspaceId: 'ws', collectionId: 'c1', at: new Date('2026-11-02'), brands, prompts, resps, ments, cits, ...extra };
}

describe('Maßnahmen-Regeln', () => {
  it('Texte: Titel ≤ 70 Zeichen, why ein Satz ≤ 140 Zeichen ohne URL, du-Form, keine Technik-Schritte außerhalb technical', () => {
    const long = 'Welches Kartenterminal mit sehr langer Beschreibung eignet sich für einen Friseursalon mit drei Filialen in Bayern';
    const rows = ['p1', 'p2', 'p3', 'p4'].flatMap((p) => ['chatgpt', 'gemini', 'claude'].map((e) => ({
      p, e, m: ['SumUp:1:r', 'Zettle:2'],
      c: ['https://paylindo.de/blog/a', 'https://kassensystemevergleich-mit-sehr-langem-namen.de/vergleich', 'https://reddit.com/r/Kartenzahlung/comments/abc/x/|s'],
    })));
    const d = fixture(rows);
    d.prompts.set('p1', { id: 'p1', text: long, topicId: null, topicName: null });
    const all = buildCandidates(d);
    expect(all.length).toBeGreaterThan(2);
    for (const c of all) {
      expect(c.title.length, c.title).toBeLessThanOrEqual(70);
      expect(c.why.length, c.why).toBeLessThanOrEqual(140);
      expect(c.why, c.why).not.toMatch(/https?:\/\/|\/blog\//);
      expect([c.title, c.why, ...c.steps].join(' ')).not.toMatch(/\b(Sie|Ihr|Ihre|Ihnen)\b/);
      if (c.type !== 'technical') expect(c.steps.join(' ')).not.toMatch(/JSON-LD|Schema|robots\.txt|llms\.txt/);
    }
  });

  it('name_on_own_page: eigene Domain als Quelle, Marke nicht genannt', () => {
    const d = fixture([
      { p: 'p1', e: 'chatgpt', m: ['SumUp:1'], c: ['https://www.paylindo.de/blog/a?utm_source=openai', 'https://test.de/x'] },
      { p: 'p2', e: 'gemini', m: ['Zettle:1'], c: ['https://paylindo.de/blog/a'] },
      { p: 'p3', e: 'claude', m: ['Paylindo:1'], c: ['https://paylindo.de/blog/b'] }, // genannt → zählt nicht
      // eigene Seite nur gelesen, Antwort hat aber cited-Quellen → zählt nicht (Kennzahl nutzt cited)
      { p: 'p4', e: 'chatgpt', m: ['SumUp:1'], c: ['https://test.de/y', 'https://paylindo.de/blog/c|s'] },
    ]);
    const [c] = ruleNameOnOwnPage(indexData(d));
    expect(c.key).toBe('name_on_own_page');
    expect(c.evidence.metrics).toMatchObject({ affected: 2, responses: 4, ownSiteResponses: 3 });
    expect(c.evidence.urls).toEqual([{ url: 'https://paylindo.de/blog/a', title: 'A', count: 2 }]);
    expect(c.why).toContain('3 von 4 Antworten'); // Basis N = alle Antworten der Messung
    expect(c.why).toContain('in 2 davon fehlt');
    expect(c.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('outreach: nur Drittseiten aus Antworten mit Wettbewerber ohne eigene Marke; keine Wettbewerber-, Community- oder Anbieter-Domains', () => {
    const rows = [];
    for (let i = 0; i < 4; i++) {
      rows.push({ p: `p${i}`, e: 'gemini', m: ['SumUp:1', 'Payfix:2'], c: [`https://www.vergleich.de/test-${i}`, 'https://sumup.de/preise', 'https://reddit.com/r/x/comments/1/a', 'https://payfix.de/blog', 'https://de.wikipedia.org/wiki/EC'] });
    }
    rows.push({ p: 'p9', e: 'chatgpt', m: ['SumUp:1', 'Paylindo:2'], c: ['https://andere.de/x', 'https://andere.de/y'] }); // eigene Marke genannt
    const out = ruleOutreach(indexData(fixture(rows)));
    expect(out.map((c) => c.key)).toEqual(['outreach:vergleich.de']);
    expect(out[0].evidence.metrics).toMatchObject({ affected: 4 });
    expect(out[0].evidence.competitors).toEqual([{ name: 'SumUp', count: 4 }]);
    expect(out[0].evidence.examples).toHaveLength(4);
    expect(out[0].title).toContain('vergleich.de');
  });

  it('outreach: Redaktionen/Ratgeber, die als Marke auftauchen, bleiben Ziel; Ausschlüsse haben einen Grund', () => {
    const rows = [];
    for (let i = 0; i < 4; i++) {
      rows.push({ p: `p${i}`, e: 'gemini', m: ['SumUp:1', 'Handelsblatt:2', 'Zahlungskompass:3', 'Qonto:4'], c: [`https://www.handelsblatt.com/a-${i}`, `https://zahlungskompass.de/b-${i}`, 'https://qonto.com/de/terminal', 'https://sumup.de/preise'] });
    }
    const ix = indexData(fixture(rows));
    expect(ruleOutreach(ix).map((c) => c.key).sort()).toEqual(['outreach:handelsblatt.com', 'outreach:zahlungskompass.de']);
    const ex = outreachExclusionsFrom(ix);
    expect(ex.find((e) => e.domain === 'qonto.com')).toMatchObject({ reason: 'vendor', responses: 4 });
    expect(ex.find((e) => e.domain === 'qonto.com')!.text).toContain('Anbieter');
    expect(ex.find((e) => e.domain === 'sumup.de')).toMatchObject({ reason: 'competitor' });
    // Für ein Vergleichsportal ist ein anderer Ratgeber Konkurrenz, kein Outreach-Ziel
    const portal = indexData(fixture(rows, { brands: brands.map((b) => (b.isOwn ? { ...b, kind: 'portal' } : b)) }));
    expect(ruleOutreach(portal).map((c) => c.key)).toEqual(['outreach:handelsblatt.com']);
  });

  it('outreach: Ansprache passt zur Art der Quelle; Vergleichsportale sind für ein Portal Wettbewerber', () => {
    expect(sourceKindOf('capterra.de')).toBe('reviews');
    expect(sourceKindOf('www.g2.com'.replace(/^www\./, ''))).toBe('reviews');
    expect(sourceKindOf('handelsblatt.com')).toBe('media');
    expect(sourceKindOf('kassensystemevergleich.de')).toBe('comparison');
    expect(sourceKindOf('kartenkosten.de')).toBe('comparison');
    expect(sourceKindOf('gruendung.de')).toBe('site');
    const rows = [];
    for (let i = 0; i < 4; i++) {
      rows.push({ p: `p${i}`, e: 'gemini', m: ['SumUp:1'], c: [`https://capterra.de/x-${i}`, `https://kartenleservergleich.de/y-${i}`, `https://www.handelsblatt.com/a-${i}`, `https://gruendung.de/b-${i}`] });
    }
    const provider = ruleOutreach(indexData(fixture(rows, { brands: brands.map((b) => (b.isOwn ? { ...b, kind: 'provider' } : b)) })), { max: 10 });
    const t = Object.fromEntries(provider.map((c) => [c.key, c]));
    // Bewertungsportale bündelt die Maßnahme „reviews“ – kein eigenes Outreach mehr
    expect(t['outreach:capterra.de']).toBeUndefined();
    expect(outreachExclusionsFrom(indexData(fixture(rows))).find((e) => e.domain === 'capterra.de')).toMatchObject({ reason: 'reviews' });
    expect(t['outreach:kartenleservergleich.de'].title).toMatch(/als Anbieter listen/);
    expect(t['outreach:handelsblatt.com'].title).toMatch(/Daten oder ein Experten-Zitat/);
    expect(t['outreach:handelsblatt.com'].effort).toBe(3);
    expect(t['outreach:handelsblatt.com'].impact).toBeLessThanOrEqual(2);
    expect(t['outreach:gruendung.de'].title).toMatch(/Autor/);
    for (const c of provider) expect(c.steps.join(' ')).not.toMatch(/Wettbewerber.*(bitten|anschreiben)/);
    const portalIx = indexData(fixture(rows, { brands: brands.map((b) => (b.isOwn ? { ...b, kind: 'portal' } : b)) }));
    const portal = ruleOutreach(portalIx, { max: 10 });
    expect(portal.map((c) => c.key)).not.toContain('outreach:kartenleservergleich.de');
    expect(outreachExclusionsFrom(portalIx).find((e) => e.domain === 'kartenleservergleich.de')).toMatchObject({ reason: 'rival_portal' });
    expect(portal.find((c) => c.key === 'outreach:handelsblatt.com')!.title).toMatch(/eigene Auswertung/);
  });

  it('name_on_own_page: kein Markenname in jedem Titel, sondern Absender im ersten Absatz und benannte eigene Daten', () => {
    const rows = ['p1', 'p2', 'p3'].map((p) => ({ p, e: 'chatgpt', m: ['SumUp:1'], c: ['https://paylindo.de/ratgeber/a'] }));
    const [c] = ruleNameOnOwnPage(indexData(fixture(rows)));
    const all = c.steps.join(' ');
    expect(all).toMatch(/ersten Absatz/);
    expect(all).toMatch(/kein Markenname in jedem Titel/);
    expect(all).not.toMatch(/in H1, Einleitung und Fazit/);
    expect(c.impact).toBe(2);
  });

  it('content_gap: Wettbewerber genannt, eigene Marke fehlt; nicht wenn die eigene Seite schon oft Quelle ist', () => {
    const d = fixture([
      { p: 'gap', e: 'chatgpt', m: ['SumUp:1', 'Zettle:2'], c: ['https://a.de'] },
      { p: 'gap', e: 'gemini', m: ['SumUp:1'] },
      { p: 'gap', e: 'claude', m: ['Zettle:1'] },
      { p: 'used', e: 'chatgpt', m: ['SumUp:1'], c: ['https://paylindo.de/x'] },
      { p: 'used', e: 'gemini', m: ['SumUp:1'], c: ['https://paylindo.de/x'] },
      { p: 'ok', e: 'chatgpt', m: ['Paylindo:1', 'SumUp:2'] },
      { p: 'ok', e: 'gemini', m: ['SumUp:1'] },
    ]);
    const out = ruleContentGap(indexData(d), d);
    // ohne Thema: Cluster nach Aspekt der Frage
    expect(out.map((c) => c.key)).toEqual(['content_gap:intent:other']);
    expect(out[0].evidence.promptIds).toEqual(['gap']);
    expect(out[0].evidence.titleSuggestion).toBe('Weitere Fragen – Überblick (2026)');
    expect(out[0].evidence.prompts?.[0].missing?.sort()).toEqual(['chatgpt', 'claude', 'gemini']);
    expect(out[0].why).toMatch(/ nie\.$/);
    expect(out[0].effort).toBe(3); // keine eigene Seite → erstellen
    expect(out[0].steps.join(' ')).toMatch(/Stichprobe/);
  });

  it('community: Reddit nach Subreddit gruppiert, inkl. nur gelesener Threads, nur bei schwacher eigener Marke', () => {
    const d = fixture([
      { p: 'p1', e: 'chatgpt', m: ['SumUp:1'], c: ['https://a.de', 'https://www.reddit.com/r/Kartenzahlung/comments/1abc/sumup_oder_zettle/|s'] },
      { p: 'p2', e: 'chatgpt', m: ['SumUp:1'], c: ['https://www.reddit.com/r/Kartenzahlung/comments/2def/|s', 'https://www.youtube.com/watch?v=xyz|s'] },
      { p: 'p3', e: 'chatgpt', m: ['Paylindo:1'], c: ['https://www.reddit.com/r/Finanzen/comments/9/a/|s'] }, // Marke stark
      { p: 'p3', e: 'gemini', m: ['Paylindo:1'], c: ['https://www.reddit.com/r/Finanzen/comments/8/b/'] },
    ]);
    const out = ruleCommunity(indexData(d));
    expect(out.map((c) => c.key)).toEqual(['community:reddit:r/kartenzahlung']);
    expect(out[0].evidence.metrics).toMatchObject({ affected: 2, readOnly: 2, threads: 2 });
    expect(out[0].evidence.urls?.map((u) => u.title).sort()).toEqual(['Sumup oder zettle', 'Thread in r/Kartenzahlung (2def)']);
    expect(out[0].why).toMatch(/lesen r\/Kartenzahlung in 2 von \d+ Antworten mit/);
    expect(out[0].steps.join(' ')).toMatch(/offenlegen/);
  });

  it('positioning: nur wenn die eigene Marke im Vergleich vorkommt; Wettbewerber mit den meisten Empfehlungen davor', () => {
    const rows = [];
    for (let i = 0; i < 4; i++) rows.push({ p: `p${i}`, e: 'chatgpt', m: ['SumUp:1:r', 'Paylindo:2', 'Zettle:3'] });
    rows.push({ p: 'p9', e: 'gemini', m: ['Zettle:1', 'Paylindo:2'] });
    const [c] = rulePositioning(indexData(fixture(rows)));
    expect(c.key).toBe('positioning:sumup');
    expect(c.evidence.metrics).toMatchObject({ competitorAhead: 4, recommendedAhead: 4, bothNamed: 4 });
    expect(c.evidence.examples[0].snippet).toContain('SumUp');
    // Antworten ohne eigene Marke zählen nicht als „vor der eigenen Marke“
    const mixed = [...rows];
    for (let i = 0; i < 5; i++) mixed.push({ p: `q${i}`, e: 'claude', m: ['Zettle:1:r'] });
    const [m] = rulePositioning(indexData(fixture(mixed)));
    expect(m.key).toBe('positioning:sumup');
    expect(m.evidence.metrics).toMatchObject({ competitorAhead: 4 });
    // eigene Marke kaum genannt → keine Positionierung
    const weak = [];
    for (let i = 0; i < 20; i++) weak.push({ p: `p${i}`, e: 'chatgpt', m: ['SumUp:1:r'] });
    weak.push({ p: 'x', e: 'gemini', m: ['SumUp:1', 'Paylindo:2'] });
    expect(rulePositioning(indexData(fixture(weak)))).toEqual([]);
  });

  it('sentiment: negative Nennungen der eigenen Marke mit Ausschnitt', () => {
    const [c] = ruleSentiment(indexData(fixture([
      { p: 'p1', e: 'chatgpt', m: ['Paylindo:1:n'], c: ['https://forum.de/t/1'] },
      { p: 'p2', e: 'chatgpt', m: ['Paylindo:1'] },
    ])));
    expect(c.key).toBe('sentiment:negative');
    expect(c.evidence.metrics).toMatchObject({ negative: 1, ownMentions: 2 });
    expect(c.evidence.examples[0]).toMatchObject({ engine: 'chatgpt', url: 'https://forum.de/t/1' });
  });

  it('technical: Sperre von Such-Crawlern hoch priorisiert, keine llms.txt-Maßnahme, Schema nur Grundpflege', () => {
    const check = (over: Partial<SiteCheckResult> = {}): SiteCheckResult => ({
      domain: 'paylindo.de',
      home: { status: 200, finalUrl: 'https://paylindo.de/', textChars: 120, jsonLd: [] },
      robots: { status: 200, found: true, blocked: ['OAI-SearchBot', 'GPTBot'], allowed: [] },
      llmsTxt: { status: 404, found: false },
      ...over,
    });
    const d = fixture([{ p: 'p1', e: 'chatgpt', m: ['SumUp:1'] }]);
    const out = ruleTechnical(indexData(d), [check()]);
    const byKey = Object.fromEntries(out.map((c) => [c.key, c]));
    expect(Object.keys(byKey).sort()).toEqual(['technical:js_text', 'technical:robots', 'technical:structured_data']);
    expect(byKey['technical:robots'].impact).toBe(3);
    expect(byKey['technical:robots'].title).toContain('freigeben');
    expect(byKey['technical:robots'].evidence.answerBots).toContain('OAI-SearchBot');
    expect(byKey['technical:structured_data'].impact).toBe(1);
    expect(byKey['technical:structured_data'].why).toMatch(/kein direkter Hebel/);
    expect(byKey['technical:robots'].priority).toBeGreaterThan(byKey['technical:structured_data'].priority);
    // nur Trainings-Crawler gesperrt → niedrige Wirkung
    const training = ruleTechnical(indexData(d), [check({ robots: { status: 200, found: true, blocked: ['GPTBot', 'ClaudeBot'], allowed: [] } })]);
    expect(training.find((c) => c.key === 'technical:robots')!.impact).toBe(1);
    expect(ruleTechnical(indexData(d), undefined)).toEqual([]);
  });

  it('buildCandidates: sortiert nach Priorität, eindeutige keys; ohne eigene Marke leer', () => {
    const d = fixture([
      { p: 'p1', e: 'chatgpt', m: ['SumUp:1'], c: ['https://paylindo.de/a', 'https://v.de/1'] },
      { p: 'p1', e: 'gemini', m: ['SumUp:1'], c: ['https://paylindo.de/a', 'https://v.de/2'] },
      { p: 'p2', e: 'gemini', m: ['Zettle:1'], c: ['https://v.de/3'] },
      { p: 'p2', e: 'claude', m: ['Zettle:1'], c: ['https://v.de/3'] },
    ]);
    const out = buildCandidates(d);
    expect(out.length).toBeGreaterThan(1);
    expect(new Set(out.map((c) => c.key)).size).toBe(out.length);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].priority).toBeGreaterThanOrEqual(out[i].priority);
    for (const c of out) {
      expect(c.title.length).toBeGreaterThan(10);
      expect(c.why.length).toBeGreaterThan(20);
      expect(c.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.evidence.examples.length).toBeLessThanOrEqual(5);
    }
    expect(buildCandidates({ ...d, brands: brands.filter((b) => !b.isOwn) })).toEqual([]);
  });
});

describe('Helfer', () => {
  it('priorityOf: Wirkung × Reichweite / Aufwand', () => {
    expect(priorityOf(3, 1, 1)).toBe(30);
    expect(priorityOf(3, 0.5, 3)).toBeLessThan(priorityOf(3, 0.5, 1));
    expect(priorityOf(1, 0, 1)).toBe(2);
  });

  it('communityGroup und titleFromUrl', () => {
    expect(communityGroup('https://old.reddit.com/r/de_EDV/comments/x/y')).toEqual({ kind: 'reddit', id: 'r/de_edv', label: 'r/de_EDV' });
    expect(communityGroup('https://youtu.be/abc')?.kind).toBe('youtube');
    expect(communityGroup('https://www.gutefrage.net/frage/x')?.id).toBe('gutefrage.net');
    expect(communityGroup('https://chip.de/test')).toBeNull();
    expect(titleFromUrl('https://www.youtube.com/watch?v=abc')).toBe('YouTube-Video abc');
    expect(titleFromUrl('https://x.de/a', 'Gesetzter Titel')).toBe('Gesetzter Titel');
  });

  it('suggestTitle ergänzt Fragezeichen und Jahr', () => {
    expect(suggestTitle('Welche Software eignet sich für Praxen', 2026)).toBe('Welche Software eignet sich für Praxen? (2026)');
    expect(suggestTitle('Kartenzahlungspflicht 2027 – was tun?', 2026)).toBe('Kartenzahlungspflicht 2027 – was tun?');
  });

  it('sanitize lehnt erfundene URLs und zu kurze Texte ab (Fallback bleibt)', () => {
    const [c] = ruleSentiment(indexData(fixture([{ p: 'p1', e: 'chatgpt', m: ['Paylindo:1:n'], c: ['https://forum.de/t/1'] }])));
    const ok = { title: 'Negative Aussagen richtigstellen', why: 'Eine von einer Nennung ist negativ, Quelle forum.de.', steps: ['Prüfen auf https://forum.de/t/1', 'Richtigstellen'] };
    expect(sanitize(ok, c)).toEqual(ok);
    expect(sanitize({ ...ok, steps: ['Siehe https://erfunden.de/x', 'b'] }, c)).toBeNull();
    expect(sanitize({ ...ok, steps: ['nur einer'] }, c)).toBeNull();
    expect(sanitize({ ...ok, steps: ['Auf vergleich24.de nachsehen', 'b', 'c'] }, c)).toBeNull(); // erfundene nackte Domain
    expect(sanitize({ ...ok, steps: ['robots.txt und llms.txt prüfen', 'Beitrag auf forum.de lesen'] }, { ...c, type: 'technical' })).not.toBeNull();
    // Technik-Schritte nur in technischen Maßnahmen, du-Form, why ein Satz ≤ 140 Zeichen ohne URL
    expect(sanitize({ ...ok, steps: ['Organization-Schema (JSON-LD) einbinden', 'b'] }, c)).toBeNull();
    expect(sanitize({ ...ok, steps: ['Lesen Sie die Seite', 'b'] }, c)).toBeNull();
    expect(sanitize({ ...ok, why: 'Erster Satz mit Zahl 3 von 5. Zweiter Satz folgt hier.' }, c)!.why).toBe(c.why);
    expect(sanitize({ ...ok, why: 'Die Seite forum.de/thread/1 wird in 3 von 5 Antworten gelesen.' }, c)!.why).toBe(c.why);
    expect(signatureHash(c)).toBe(signatureHash({ ...c }));
  });
});
