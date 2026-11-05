// Vertiefter Website-Check, Themen-Cluster statt Einzelseiten und die Maßnahmen-Typen ab Nov. 2026
// (comparison, listicle, reviews, entity, weitere technical-Befunde).
import { describe, expect, it } from 'vitest';
import { indexData, type Cit, type Ment, type PageCheck, type RecData, type Resp, type SiteCheckResult } from '../../src/recommend/data.ts';
import {
  buildCandidates, CONTENT_GAP_MAX, facetOf, ruleComparison, ruleContentGap, ruleEntity, ruleListicle, ruleReviews, ruleSearchIndex, ruleTechnical,
} from '../../src/recommend/rules.ts';
import {
  checkDomain, languagePrefixes, pageFacts, pageKindOf, parseSitemap, pickKeyPages, wikidataLookup, type FetchLike,
} from '../../src/recommend/site-check.ts';
import { buildClaudePrompt, categoryOf, promptDeliverable, recMetricLabels } from '../../src/recommend/present.ts';
import { recommendationMetric, technicalCovered, entityCovered } from '../../src/recommend/index.ts';

const OWN = 'b-own';
const brands = [
  { id: OWN, name: 'Synera', domains: ['synera.ai'], isOwn: true, kind: 'provider' },
  { id: 'b-nc', name: 'Neural Concept', domains: ['neuralconcept.com'], isOwn: false },
  { id: 'b-alt', name: 'Altair', domains: ['altair.com'], isOwn: false },
];
type Row = { p: string; e: string; m?: string[]; c?: string[] };
/** Messung: Prompts mit Thema (p → [text, topicId]), Antworten mit Marken (Name:Position) und Quellen (url[|Titel]) */
function fixture(promptDefs: Record<string, [string, string | null]>, rows: Row[], extra: Partial<RecData> = {}): RecData {
  const resps: Resp[] = [], ments: Ment[] = [], cits: Cit[] = [];
  const prompts = new Map(Object.entries(promptDefs).map(([id, [text, topic]]) => [id, { id, text, topicId: topic, topicName: topic ? `Thema ${topic}` : null }]));
  rows.forEach((r, i) => {
    const id = `r${i}`;
    resps.push({ id, promptId: r.p, engine: r.e });
    for (const m of r.m ?? []) {
      const [name, pos] = m.split(':');
      const b = brands.find((x) => x.name === name);
      ments.push({ responseId: id, brandId: b?.id ?? null, name, position: Number(pos), recommended: false, sentiment: 'neutral', snippet: `${name} automatisiert Simulationen – Antwort ${i}.` });
    }
    (r.c ?? []).forEach((u, j) => {
      const [url, title] = u.split('|');
      cits.push({ responseId: id, url, domain: new URL(url).hostname.replace(/^www\./, ''), title: title ?? null, position: j + 1, kind: 'cited' });
    });
  });
  return { workspaceId: 'ws', collectionId: 'c1', at: new Date('2026-11-05'), brands, prompts, resps, ments, cits, ...extra };
}
const engines = ['chatgpt', 'gemini', 'claude'];
const compOnly = (p: string, c: string[] = []) => engines.map((e) => ({ p, e, m: ['Altair:1', 'Neural Concept:2'], c }));

const check = (over: Partial<SiteCheckResult> = {}): SiteCheckResult => ({
  domain: 'synera.ai',
  home: { status: 200, finalUrl: 'https://www.synera.ai/', textChars: 7000, jsonLd: [], title: 'Synera', metaDescription: 'Agentic AI', canonical: 'https://www.synera.ai/', noindex: false, hreflang: ['en', 'de-de'], ms: 300 },
  robots: { status: 200, found: true, blocked: [], allowed: [] },
  llmsTxt: { status: 404, found: false },
  sitemap: { status: 200, found: true, url: 'https://www.synera.ai/sitemap.xml', source: 'robots', urls: 800, newest: '2026-11-04T00:00:00.000Z', hreflang: true },
  pages: [],
  languages: ['de'],
  wikidata: { status: 'none', ids: [], wikipedia: [] },
  ...over,
});
const page = (kind: PageCheck['kind'], url: string, over: Partial<PageCheck> = {}): PageCheck => ({
  kind, url, status: 200, title: 'T', textChars: 4000, jsonLd: [], metaDescription: 'D', canonical: url, noindex: false, ms: 100, ...over,
});

describe('Website-Check: HTML- und Sitemap-Helfer', () => {
  it('pageFacts: Meta-Description, Canonical, noindex (Meta und X-Robots-Tag)', () => {
    const html = `<html lang="de"><head><title>Preise | Synera</title><meta name="description" content="Was Synera kostet">
      <link rel="canonical" href="/preise"><meta name="robots" content="index, follow"></head><body><h1>Preise</h1><p>Text</p></body></html>`;
    const f = pageFacts(html, 'https://synera.ai/preise');
    expect(f).toMatchObject({ title: 'Preise | Synera', metaDescription: 'Was Synera kostet', canonical: 'https://synera.ai/preise', noindex: false, hasH1: true });
    expect(pageFacts(html.replace('index, follow', 'noindex'), 'https://synera.ai/').noindex).toBe(true);
    expect(pageFacts(html, 'https://synera.ai/', 'noindex, nofollow').noindex).toBe(true);
    expect(pageFacts('<html><body>x</body></html>', 'https://synera.ai/').metaDescription).toBeNull();
    // keine Fehlalarme: andere Direktiven mit „none“, X-Robots-Tag für fremde Bots
    expect(pageFacts(html.replace('index, follow', 'index, max-image-preview:none'), 'https://synera.ai/').noindex).toBe(false);
    expect(pageFacts(html, 'https://synera.ai/', 'otherbot: noindex').noindex).toBe(false);
    expect(pageFacts(html, 'https://synera.ai/', 'googlebot: noindex').noindex).toBe(true);
  });

  it('parseSitemap: URL-Liste, Index, jüngstes lastmod, hreflang', () => {
    const sm = parseSitemap(`<?xml version="1.0"?><urlset><url><loc>https://x.de/a</loc><lastmod>2025-01-01</lastmod></url>
      <url><loc><![CDATA[https://x.de/b]]></loc><lastmod>2026-03-01T10:00:00Z</lastmod><xhtml:link rel="alternate" hreflang="en" href="https://x.de/en/b"/></url></urlset>`);
    expect(sm).toMatchObject({ index: false, locs: ['https://x.de/a', 'https://x.de/b'], hreflang: true });
    expect(sm.newest?.slice(0, 10)).toBe('2026-03-01');
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://x.de/s1.xml</loc></sitemap></sitemapindex>').index).toBe(true);
  });

  it('pageKindOf / pickKeyPages: Kernseiten erkennen, Blog/News/Studien nicht', () => {
    expect(pageKindOf('https://synera.ai/pricing')).toBe('pricing');
    expect(pageKindOf('https://synera.ai/de/preise')).toBe('pricing');
    expect(pageKindOf('https://synera.ai/platform')).toBe('product');
    expect(pageKindOf('https://synera.ai/synera-vs-neural-concept')).toBe('comparison');
    expect(pageKindOf('https://synera.ai/alternativen/altair')).toBe('comparison');
    expect(pageKindOf('https://synera.ai/de/ueber-synera')).toBe('about');
    expect(pageKindOf('https://synera.ai/faq')).toBe('faq');
    expect(pageKindOf('https://synera.ai/news/build-vs-buy')).toBeNull();
    expect(pageKindOf('https://synera.ai/analyst-study/gartner-ai-agent-promise-vs-reality')).toBeNull();
    expect(pageKindOf('https://synera.ai/blog/pricing')).toBeNull();
    const picked = pickKeyPages(['https://synera.ai/de/preise', 'https://synera.ai/pricing', 'https://synera.ai/about', 'https://synera.ai/company/about']);
    expect(picked.get('pricing')).toBe('https://synera.ai/pricing'); // ohne Sprachpräfix zuerst
    expect(picked.get('about')).toBe('https://synera.ai/about');
    expect(languagePrefixes(['https://x.de/de/a', 'https://x.de/de/b', 'https://x.de/en/a', 'https://x.de/en/b', 'https://x.de/a'])).toEqual(['de', 'en']);
    expect(languagePrefixes(['https://x.de/de/a', 'https://x.de/de/b', 'https://x.de/a', 'https://x.de/b'])).toEqual(['de']); // Standardsprache ohne Präfix + /de/
    // nur eine Sprache (alles unter /de/) bzw. Pfade, die keine Sprachcodes sind
    expect(languagePrefixes(['https://x.de/de/a', 'https://x.de/de/b', 'https://x.de/de/c'])).toEqual([]);
    expect(languagePrefixes(['https://x.de/go/a', 'https://x.de/go/b', 'https://x.de/a', 'https://x.de/b'])).toEqual([]);
    expect(pageKindOf('https://x.de/features/alternative-payment-methods')).toBeNull();
    expect(pageKindOf('https://x.de/alternatives-to-altair')).toBe('comparison');
    expect(pageKindOf('https://x.de/altair-alternativen')).toBe('comparison');
  });
});

describe('Website-Check: checkDomain mit Sitemap, Unterseiten und Wikidata (fetch injiziert)', () => {
  const pages: Record<string, { status: number; body: string; url?: string; xrt?: string }> = {
    'https://synera.ai/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /intern\nUser-agent: bingbot\nDisallow: /\nSitemap: https://www.synera.ai/sitemap.xml\n' },
    'https://synera.ai/llms.txt': { status: 404, body: '' },
    'https://synera.ai/': { status: 200, url: 'https://www.synera.ai/', body: '<html lang="en"><head><title>Synera</title><link rel="canonical" href="https://www.synera.ai/"></head><body><a href="/pricing">Pricing</a><a href="https://www.synera.ai/platform">Platform</a><a href="https://other.com/x">x</a><p>Text</p></body></html>' },
    'https://www.synera.ai/sitemap.xml': { status: 200, body: '<urlset><url><loc>https://www.synera.ai/about</loc><lastmod>2024-01-01</lastmod></url><url><loc>https://www.synera.ai/de/ueber-synera</loc></url><url><loc>https://www.synera.ai/de/preise</loc></url></urlset>' },
    'https://www.synera.ai/pricing': { status: 200, body: '<html><head><title>Pricing</title><meta name="description" content="Cost"></head><body>Preise</body></html>', xrt: 'noindex' },
    'https://www.synera.ai/platform': { status: 200, body: '<html><head><title>Platform</title></head><body><div id="app"></div></body></html>' },
    'https://www.synera.ai/about': { status: 200, body: '<html><head><title>About</title><link rel="canonical" href="https://www.synera.ai/"></head><body>About us</body></html>' },
  };
  const urls: string[] = [];
  const fake: FetchLike = async (url) => {
    urls.push(url);
    if (url.startsWith('https://www.wikidata.org/w/api.php?action=query')) return { status: 200, url, text: async () => JSON.stringify({ query: { search: [{ title: 'Q42' }] } }) };
    if (url.startsWith('https://www.wikidata.org/w/api.php?action=wbgetentities')) return { status: 200, url, text: async () => JSON.stringify({ entities: { Q42: { sitelinks: { enwiki: {}, dewiki: {}, commonswiki: {} } } } }) };
    const p = pages[url];
    return { status: p?.status ?? 404, url: p?.url ?? url, headers: { get: (n: string) => (n === 'x-robots-tag' ? p?.xrt ?? null : null) }, text: async () => p?.body ?? '' };
  };

  it('liefert Sitemap, Kernseiten mit noindex/Canonical, Sprachpräfixe, Bingbot-Sperre und Wikidata', async () => {
    const r = await checkDomain('synera.ai', { fetch: fake });
    expect(r.robots.blocked).toEqual(['Bingbot']);
    expect(r.home).toMatchObject({ canonical: 'https://www.synera.ai/', lang: 'en', noindex: false, metaDescription: null });
    expect(r.sitemap).toMatchObject({ found: true, source: 'robots', urls: 3 });
    expect(r.pages!.map((p) => p.kind)).toEqual(['product', 'pricing', 'about']);
    expect(r.pages!.find((p) => p.kind === 'pricing')).toMatchObject({ noindex: true, url: 'https://www.synera.ai/pricing' });
    expect(r.pages!.find((p) => p.kind === 'about')!.canonical).toBe('https://www.synera.ai/');
    expect(r.languages).toEqual(['de']);
    expect(r.wikidata).toEqual({ status: 'found', ids: ['Q42'], wikipedia: ['de', 'en'] });
    // Wikidata-Suche über die offizielle Website (P856), ohne API-Schlüssel
    expect(decodeURIComponent(urls.find((u) => u.includes('list=search'))!)).toContain('haswbstatement:P856=https://www.synera.ai/|P856=https://synera.ai/');
  });

  it('Weiterleitung auf fremde Domain wird verworfen; zweite deklarierte Sitemap wird gelesen; .gz = unbekannt', async () => {
    const site: Record<string, { status: number; body: string; url?: string }> = {
      'https://x.de/robots.txt': { status: 200, body: 'Sitemap: https://x.de/news.xml\nSitemap: https://x.de/pages.xml\n' },
      'https://x.de/': { status: 200, body: '<html><body><a href="/faq">FAQ</a><a href="/pricing">Preise</a></body></html>' },
      'https://x.de/faq': { status: 200, url: 'https://x.zendesk.com/hc', body: '<html><head><meta name="robots" content="noindex"></head><body>Help</body></html>' },
      'https://x.de/pricing': { status: 200, body: '<html><body>Preise</body></html>' },
      'https://x.de/pages.xml': { status: 200, body: '<urlset><url><loc>https://x.de/pricing</loc></url></urlset>' },
    };
    const f: FetchLike = async (url) => ({ status: site[url]?.status ?? 404, url: site[url]?.url ?? url, text: async () => site[url]?.body ?? '' });
    const r = await checkDomain('x.de', { fetch: f, entity: false });
    expect(r.pages!.map((p) => p.kind)).toEqual(['pricing']);
    expect(r.sitemap).toMatchObject({ found: true, url: 'https://x.de/pages.xml', urls: 1 });
    site['https://x.de/robots.txt'] = { status: 200, body: 'Sitemap: https://x.de/sitemap.xml.gz\n' };
    site['https://x.de/sitemap.xml.gz'] = { status: 200, body: '\u001f\u008b binary' };
    const gz = await checkDomain('x.de', { fetch: f, entity: false });
    expect(gz.sitemap).toMatchObject({ found: false, status: null });
    expect(technicalCovered('technical:sitemap', [gz])).toBe(false);
  });

  it('wikidataLookup: kein Treffer → none, Fehler → error', async () => {
    const apiErr: FetchLike = async (url) => ({ status: 200, url, text: async () => '{"error":{"code":"maxlag"}}' });
    expect((await wikidataLookup(apiErr, 'x.de')).status).toBe('error');
    const noLinks: FetchLike = async (url) => ({ status: url.includes('list=search') ? 200 : 503, url, text: async () => (url.includes('list=search') ? '{"query":{"search":[{"title":"Q7"}]}}' : '') });
    expect(await wikidataLookup(noLinks, 'x.de')).toEqual({ status: 'found', ids: ['Q7'], wikipedia: null });
    const none: FetchLike = async (url) => ({ status: 200, url, text: async () => '{"query":{"search":[]}}' });
    expect(await wikidataLookup(none, 'x.de')).toEqual({ status: 'none', ids: [], wikipedia: [] });
    const err: FetchLike = async (url) => ({ status: 503, url, text: async () => '' });
    expect((await wikidataLookup(err, 'x.de')).status).toBe('error');
  });

  it('technicalCovered/entityCovered: vertiefte Befunde nur mit vertieftem Check', () => {
    expect(technicalCovered('technical:sitemap', [check()])).toBe(true);
    expect(technicalCovered('technical:sitemap', [check({ sitemap: undefined })])).toBe(false);
    expect(technicalCovered('technical:noindex', [check({ pages: [page('pricing', 'https://www.synera.ai/pricing', { status: null })] })])).toBe(false);
    expect(technicalCovered('technical:noindex', [check()])).toBe(true);
    expect(entityCovered([check({ wikidata: { status: 'error', ids: [], wikipedia: [] } })])).toBe(false);
    expect(entityCovered([check()])).toBe(true);
  });
});

describe('Technik-Maßnahmen aus dem vertieften Check', () => {
  const d = fixture({ p1: ['Welche Software beschleunigt CAE?', null] }, compOnly('p1'));
  const keys = (cs: { key: string }[]) => cs.map((c) => c.key).sort();

  it('ein technisch sauberer Check ergibt nur die Schema-Grundpflege', () => {
    expect(keys(ruleTechnical(indexData(d), [check()]))).toEqual(['technical:structured_data']);
  });

  it('noindex, Canonical, Sitemap, Meta, hreflang, Ladezeit', () => {
    const c = check({
      home: { ...check().home, noindex: true, metaDescription: null, hreflang: [], ms: 6000 },
      sitemap: { status: 404, found: false, url: null, source: null, urls: 0, newest: null, hreflang: false },
      pages: [page('pricing', 'https://www.synera.ai/pricing', { canonical: 'https://www.synera.ai/' }), page('product', 'https://www.synera.ai/platform', { textChars: 40 })],
    });
    const out = ruleTechnical(indexData(d), [c]);
    const by = Object.fromEntries(out.map((x) => [x.key, x]));
    expect(keys(out)).toEqual(['technical:canonical', 'technical:hreflang', 'technical:js_text', 'technical:meta', 'technical:noindex', 'technical:sitemap', 'technical:speed', 'technical:structured_data']);
    expect(by['technical:noindex']).toMatchObject({ impact: 3, certainty: 'proven' });
    expect(by['technical:js_text']).toMatchObject({ impact: 2 }); // nur Unterseite leer
    expect(by['technical:js_text'].why).toMatch(/Unterseiten/);
    expect(by['technical:sitemap'].steps.join(' ')).toMatch(/Bing Webmaster Tools/);
    expect(by['technical:meta'].certainty).toBe('uncertain');
    expect(by['technical:speed'].certainty).toBe('uncertain');
    expect(by['technical:noindex'].priority).toBeGreaterThan(by['technical:meta'].priority);
  });

  it('ältere Checks ohne vertiefte Felder erzeugen keine neuen Befunde', () => {
    const old: SiteCheckResult = { domain: 'synera.ai', home: { status: 200, finalUrl: 'https://synera.ai/', textChars: 5000, jsonLd: ['Organization'] }, robots: { status: 200, found: true, blocked: [], allowed: [] }, llmsTxt: { status: 404, found: false } };
    expect(ruleTechnical(indexData(d), [old])).toEqual([]);
    expect(ruleEntity(indexData(d), [old])).toEqual([]);
  });

  it('search_index: ChatGPT nutzt die eigene Website viel seltener als die anderen KI-Suchen', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push({ p: `p${i}`, e: 'chatgpt', m: ['Altair:1'], c: ['https://x.de/a'] });
      rows.push({ p: `p${i}`, e: 'gemini', m: ['Altair:1'], c: [i < 6 ? 'https://synera.ai/a' : 'https://x.de/a'] });
      rows.push({ p: `p${i}`, e: 'claude', m: ['Altair:1'], c: [i < 5 ? 'https://synera.ai/b' : 'https://x.de/a'] });
    }
    const defs = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}`, [`Frage ${i}?`, null] as [string, null]]));
    const [c] = ruleSearchIndex(indexData(fixture(defs, rows)), [check()]);
    expect(c.key).toBe('technical:search_index');
    expect(c.evidence.engines).toEqual(['chatgpt']);
    expect(c.title).toMatch(/Bing/);
    expect(c.certainty).toBe('uncertain');
    // Bot gesperrt → anderer Befund (robots), keine Index-Vermutung
    expect(ruleSearchIndex(indexData(fixture(defs, rows)), [check({ robots: { status: 200, found: true, blocked: ['OAI-SearchBot'], allowed: [] } })])).toEqual([]);
  });
});

describe('Themen-Cluster statt einer Seite je Testfrage', () => {
  const defs: Record<string, [string, string | null]> = {
    s1: ['Welche Software beschleunigt CAE-Simulationen durch KI?', 'sim'],
    s2: ['Was kostet Simulations-KI für 20 Ingenieure?', 'sim'],
    s3: ['Wie bereite ich FE-Modelle automatisch vor?', 'sim'],
    i1: ['Welche KI lässt sich in PLM integrieren?', 'int'],
    i2: ['Wie verbinde ich KI-Agenten mit Teamcenter?', 'int'],
    r1: ['Welche Tools automatisieren RFQ?', 'rfq'],
    d1: ['Beste Tools für Design-to-Cost?', 'dtc'],
    v1: ['Alternative zu Altair für Simulationsworkflows?', 'sim'],
    v2: ['Neural Concept oder Synera: was passt besser?', 'sim'],
    ok: ['Was ist agentische KI?', 'sim'],
  };
  const rows: Row[] = [
    // eigene Seite nur in einer von drei Antworten Quelle – sonst wäre es keine Lücke
    ...['s1', 's2', 's3', 'i1', 'i2', 'r1', 'd1', 'v1'].flatMap((p) => compOnly(p)).map((r) => (r.p.startsWith('s') && r.e === 'chatgpt' ? { ...r, c: ['https://synera.ai/automated-fe-analysis'] } : r)),
    ...engines.map((e) => ({ p: 'v2', e, m: ['Neural Concept:1'] })),
    ...engines.map((e) => ({ p: 'ok', e, m: ['Synera:1', 'Altair:2'] })),
  ];
  const d = fixture(defs, rows);
  const ix = indexData(d);

  it('bündelt Fragen je Thema, begrenzt die Zahl der Seiten und nennt die Stichprobe', () => {
    const out = ruleContentGap(ix, d);
    expect(out.length).toBeLessThanOrEqual(CONTENT_GAP_MAX);
    const sim = out.find((c) => c.key === 'content_gap:topic:sim')!;
    expect(sim.evidence.promptIds?.sort()).toEqual(['s1', 's2', 's3']); // Vergleichsfragen v1/v2 nicht hier
    expect(sim.evidence.metrics.questions).toBe(3);
    expect(sim.evidence.metrics.topicQuestions).toBe(6);
    expect(sim.evidence.basePage).toBe('https://synera.ai/automated-fe-analysis');
    expect(sim.title).toMatch(/Themenseite .* für 3 Fragen ausbauen/);
    expect(sim.steps[0]).toMatch(/deckt 3 der getesteten Fragen auf einmal ab/);
    expect(sim.steps[1]).toMatch(/Stichprobe .*3 von 6 Testfragen/);
    expect(sim.evidence.facets).toEqual(['Anbieter im Überblick', 'Vorgehen in der Praxis', 'Kosten & Nutzen']);
    expect(sim.texts.en.steps[1]).toMatch(/sample/);
    const ctx = { brand: { name: 'Synera', description: null, domains: ['synera.ai'], kind: 'provider' }, competitors: ['Altair'], workspaceName: 'Synera' };
    expect(buildClaudePrompt(sim, ctx)).toMatch(/Stichprobe/);
    expect(buildClaudePrompt(sim, ctx, 'en')).toMatch(/sample/);
    // 4 Themen mit Lücken, höchstens 3 Seiten – die mit der größten Reichweite
    expect(out.map((c) => c.key)).toContain('content_gap:topic:int');
    expect(out.every((c) => c.evidence.basePage !== 'https://synera.ai/automated-fe-analysis' || c.key === 'content_gap:topic:sim')).toBe(true);
  });

  it('facetOf ordnet Fragen einem Aspekt zu', () => {
    expect(facetOf('Was kostet eine KI-Plattform?')).toBe('cost');
    expect(facetOf('Welche Anbieter gibt es für RFQ?')).toBe('list');
    expect(facetOf('Wie sicher sind KI-Plattformen für CAD-Daten?')).toBe('risk');
    expect(facetOf('Wie verbinde ich KI mit SAP?')).toBe('integration');
    expect(facetOf('Wie führe ich KI ein?')).toBe('howto');
    expect(facetOf('Was ist eine CRM-Software?')).toBe('explain');
    expect(facetOf('Wie führe ich eine HR-Software ein?')).toBe('howto');
    expect(facetOf('Welche kostenlosen Tools gibt es?')).toBe('list');
    expect(facetOf('Gibt es Lösungen für den Bestand an CAD-Daten?')).toBe('list');
  });

  it('comparison: Vergleichs- und Alternativfragen als transparente Vergleichsseiten', () => {
    const [c] = ruleComparison(ix, d);
    expect(c.key).toBe('comparison:pages');
    expect(c.evidence.promptIds?.sort()).toEqual(['v1', 'v2']);
    expect(c.evidence.targets).toEqual(['Altair', 'Neural Concept']);
    expect(c.title).toBe('Vergleichsseiten anlegen: Synera vs. Altair und Neural Concept');
    const all = c.steps.join(' ');
    expect(all).toMatch(/Absender, Stand-Datum/);
    expect(all).toMatch(/Keine scheinbar unabhängigen Vergleichsseiten auf Extra-Domains/);
    expect(categoryOf('comparison')).toBe('content');
    // mit vorhandener Vergleichsseite aus dem Website-Check: ausbauen
    const withPage = ruleComparison(ix, { ...d, siteChecks: [check({ pages: [page('comparison', 'https://synera.ai/vergleich')] })] })[0];
    expect(withPage.title).toMatch(/ausbauen/);
    expect(withPage.evidence.basePage).toBe('https://synera.ai/vergleich');
  });
});

describe('Neue Off-Site-Maßnahmen aus den Quellen', () => {
  it('listicle: Bestenlisten, die Wettbewerber nennen – nicht die eigene Marke', () => {
    const rows: Row[] = [
      ...compOnly('p1', ['https://thecadhub.com/blog/best-plm-software|Best PLM software 2026', 'https://news.de/artikel-ohne-liste']),
      ...compOnly('p2', ['https://tools.de/top-10-simulation-tools', 'https://news.de/artikel-ohne-liste']),
      { p: 'p3', e: 'chatgpt', m: ['Synera:1', 'Altair:2'], c: ['https://thecadhub.com/blog/best-plm-software'] },
    ];
    const d = fixture({ p1: ['Beste PLM-Software?', null], p2: ['Top Simulationstools?', null], p3: ['X?', null] }, rows);
    const [c] = ruleListicle(indexData(d));
    expect(c.key).toBe('listicle:roundups');
    expect(c.evidence.urls?.map((u) => u.url)).toEqual(['https://thecadhub.com/blog/best-plm-software', 'https://tools.de/top-10-simulation-tools']);
    expect(c.evidence.metrics.affected).toBe(6);
    expect(c.steps.join(' ')).toMatch(/Anzeige kennzeichnet/);
    expect(categoryOf('listicle')).toBe('offsite');
    expect(ruleListicle(indexData(d), { skipHosts: new Set(['thecadhub.com', 'tools.de']) })).toEqual([]);
    // Umlaute sind keine Wortgrenze: „Bestände“ ist keine Bestenliste
    const d2 = fixture({ p1: ['X?', null] }, [...compOnly('p1', ['https://lager.de/artikel|Bestände richtig verwalten']), ...compOnly('p1', ['https://lager.de/artikel'])]);
    expect(ruleListicle(indexData(d2))).toEqual([]);
  });

  it('reviews: Bewertungsportale gebündelt, eigenes Profil erkannt', () => {
    const rows: Row[] = [
      ...compOnly('p1', ['https://www.g2.com/products/altair/reviews', 'https://capterra.com/p/1/neural']),
      { p: 'p2', e: 'gemini', m: ['Synera:1'], c: ['https://www.g2.com/products/synera/reviews'] },
    ];
    const [c] = ruleReviews(indexData(fixture({ p1: ['Welche Tools?', null], p2: ['Synera Bewertungen?', null] }, rows)));
    expect(c.key).toBe('reviews:profiles');
    expect(c.evidence.domains).toEqual(['g2.com', 'capterra.com']);
    expect(c.evidence.ownProfiles).toEqual(['https://g2.com/products/synera/reviews']);
    expect(c.steps.join(' ')).toMatch(/Keine gekauften oder gefälschten Bewertungen/);
    // Teilwort zählt nicht als eigenes Profil
    const nova = { ...fixture({ p1: ['Welche Tools?', null] }, compOnly('p1', ['https://www.g2.com/categories/innovation-management', 'https://capterra.com/p/1/x'])) };
    nova.brands = [{ ...brands[0], name: 'Nova' }, ...brands.slice(1)];
    expect(ruleReviews(indexData(nova))[0].evidence.ownProfiles).toEqual([]);
  });

  it('entity: Wikidata fehlt und Wikipedia ist häufige Quelle; ohne Wikipedia-Artikel-Vorschlag', () => {
    const rows = compOnly('p1', ['https://en.wikipedia.org/wiki/Computer-aided_engineering']);
    const d = fixture({ p1: ['Was ist CAE?', null] }, rows);
    const [c] = ruleEntity(indexData(d), [check()]);
    expect(c.key).toBe('entity:wikidata');
    expect(c.title).toBe('Wikidata-Eintrag für Synera anlegen');
    expect(c.impact).toBe(2); // Wikipedia in allen Antworten Quelle
    expect(c.certainty).toBe('uncertain');
    expect(c.steps.join(' ')).toMatch(/Keinen Wikipedia-Artikel über Synera selbst schreiben/);
    expect(c.steps.join(' ')).toMatch(/„Computer-aided engineering“/);
    // Wikidata und Wikipedia vorhanden → keine Maßnahme; Abfrage gescheitert → keine Aussage
    expect(ruleEntity(indexData(d), [check({ wikidata: { status: 'found', ids: ['Q1'], wikipedia: ['de'] } })])).toEqual([]);
    expect(ruleEntity(indexData(d), [check({ wikidata: { status: 'error', ids: [], wikipedia: [] } })])).toEqual([]);
    expect(ruleEntity(indexData(d), [check({ wikidata: { status: 'found', ids: ['Q1'], wikipedia: null } })])).toEqual([]);
    expect(recommendationMetric(c, d)).toBeNull();
    expect(recMetricLabels(c, 'Synera')).toBeNull();
  });
});

describe('Alle Maßnahmen: Wirkung, Belegstärke, Prompt', () => {
  const defs: Record<string, [string, string | null]> = { p1: ['Beste Tools für FE-Analyse?', 't'], p2: ['Alternative zu Altair?', 't'] };
  const rows: Row[] = [
    ...compOnly('p1', ['https://thecadhub.com/best-fe-tools', 'https://g2.com/x', 'https://en.wikipedia.org/wiki/FEA']),
    ...compOnly('p2', ['https://thecadhub.com/best-fe-tools', 'https://g2.com/y']),
  ];
  const d = fixture(defs, rows, { siteChecks: [check({ home: { ...check().home, noindex: true } })] });
  // Bestenlisten, die schon Outreach-Ziel sind, überspringt buildCandidates – für die Prompt-Prüfung ohne Ausschluss
  const all = [...buildCandidates(d), ...ruleListicle(indexData(d))];

  it('jede Maßnahme hat impact 1–3 und certainty (auch in der Evidenz)', () => {
    const types = new Set(all.map((c) => c.type));
    for (const t of ['content_gap', 'comparison', 'listicle', 'reviews', 'entity', 'technical']) expect(types, t).toContain(t);
    for (const c of all) {
      expect([1, 2, 3]).toContain(c.impact);
      expect(['proven', 'likely', 'uncertain']).toContain(c.certainty);
      expect(c.evidence.certainty).toBe(c.certainty);
    }
  });

  it('Claude-Prompt und Ergebnis-Satz für die neuen Typen (kein Technik-Fallback)', () => {
    const ctx = { brand: { name: 'Synera', description: null, domains: ['synera.ai'], kind: 'provider' }, competitors: ['Altair', 'Neural Concept'], workspaceName: 'Synera' };
    for (const type of ['comparison', 'listicle', 'reviews', 'entity']) {
      const c = all.find((x) => x.type === type)!;
      for (const lang of ['de', 'en'] as const) {
        const p = buildClaudePrompt(c, ctx, lang);
        expect(p, `${type} ${lang}`).not.toMatch(/Webagentur|web agency|Website-Repository|website repository/);
        expect(promptDeliverable(c, lang), type).not.toMatch(/technische Änderung|technical change/);
      }
    }
  });
});
