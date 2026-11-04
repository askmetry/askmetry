import {
  brand, citation, closeDb, collection, db, mention, prompt, recommendation, recommendationGeneration, response, run, siteCheck, topic, workspace,
} from '@askmetry/db';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { backfillSearchedCitations } from '../../src/backfill.ts';
import { autofillBrandProfile, brandRanking, buildStatusBrief, generateRecommendations, keyInsight, loadRecData, outreachExclusions, recommendationMetric, type Phraser } from '../../src/recommend/index.ts';
import type { FetchLike } from '../../src/recommend/site-check.ts';
import { createCollection, monthToDateSpend, processCollection } from '../../src/runner.ts';
import type { Engine, EngineResult } from '../../src/types.ts';

const PREFIX = 'it-recommend-';

/** Test-Engine: SumUp wird genannt, Paylindo nie; zitiert wird u. a. die eigene Seite und ein Vergleichsportal */
const engine = (opts: { ownNamed?: boolean } = {}): Engine => ({
  key: 'mock', provider: 'test', enabled: () => true,
  run: async (p): Promise<EngineResult> => ({
    engine: 'test', model: 'test', noAiAnswer: false, usage: null, costUsd: 0, raw: null,
    answer: opts.ownNamed ? `1. **Paylindo** ist die beste Wahl.\n2. **SumUp** ist bekannt. (${p})` : `1. **SumUp** ist die beste Wahl, ich empfehle SumUp.\n2. **Zettle** ist auch gut. (${p})`,
    citations: [
      { url: 'https://paylindo.de/ratgeber/kartenzahlung', title: 'Ratgeber', kind: 'cited' },
      { url: 'https://www.vergleichsportal.de/kartenterminals', title: 'Kartenterminals im Vergleich', kind: 'cited' },
      { url: 'https://www.reddit.com/r/Kartenzahlung/comments/abc/welches_terminal/', kind: 'searched' },
    ],
  }),
});

async function seed(slug: string) {
  const [ws] = await db.insert(workspace).values({ name: slug, slug, engines: ['chatgpt', 'gemini'], repetitions: 1, monthlyBudgetUsd: '50' }).returning();
  await db.insert(brand).values([
    { workspaceId: ws.id, name: 'Paylindo', domains: ['paylindo.de'], isOwn: true },
    { workspaceId: ws.id, name: 'SumUp', domains: ['sumup.de'] },
    { workspaceId: ws.id, name: 'Zettle', domains: ['zettle.com'] },
  ]);
  const [t] = await db.insert(topic).values({ workspaceId: ws.id, name: 'Kartenzahlung' }).returning();
  await db.insert(prompt).values([
    { workspaceId: ws.id, topicId: t.id, text: 'Welches Kartenterminal für ein Café?' },
    { workspaceId: ws.id, topicId: t.id, text: 'SumUp oder Zettle?' },
    { workspaceId: ws.id, topicId: t.id, text: 'Kartenzahlung ohne Grundgebühr?' },
  ]);
  return ws;
}

async function measure(wsId: string, opts: Parameters<typeof processCollection>[1] = {}) {
  const c = await createCollection(wsId, 'manual');
  const s = await processCollection(c.id, { retryDelayMs: 1, engineFor: () => engine(), ...opts });
  return { c, s };
}

const recs = (wsId: string) => db.select().from(recommendation).where(eq(recommendation.workspaceId, wsId));

/** Phraser-Stub: formuliert jede Maßnahme um, kostet 0,01 $ je Aufruf */
function stubPhraser() {
  const calls: string[][] = [];
  const fn: Phraser = async (items) => {
    calls.push(items.map((c) => c.key));
    return {
      texts: new Map(items.map((c) => [c.key, { title: `KI: ${c.title}`, why: `KI-Begründung: ${c.why}`, steps: ['Schritt eins', 'Schritt zwei', 'Schritt drei'] }])),
      costUsd: 0.01, model: 'claude-haiku-5-5',
    };
  };
  return { fn, calls };
}

beforeAll(async () => { await db.delete(workspace).where(like(workspace.slug, `${PREFIX}%`)); });
afterAll(async () => { await db.delete(workspace).where(like(workspace.slug, `${PREFIX}%`)); await closeDb(); });

describe('Maßnahmen (Test-DB)', () => {
  it('werden nach einer Messung automatisch erzeugt (ohne KI, ohne Netzwerk im Mock-Modus)', async () => {
    expect(process.env.DATABASE_URL).toMatch(/askmetry_test$/);
    const ws = await seed(`${PREFIX}auto`);
    const { s } = await measure(ws.id);
    expect(s.status).toBe('done');
    const rows = await recs(ws.id);
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual(expect.arrayContaining(['name_on_own_page', 'outreach:vergleichsportal.de', 'community:reddit:r/kartenzahlung']));
    expect(keys.some((k) => k.startsWith('content_gap:'))).toBe(false); // eigene Seite ist überall Quelle → kein Content-Gap
    expect(rows.every((r) => r.active && r.status === 'open' && r.steps.length >= 2)).toBe(true);
    const own = rows.find((r) => r.key === 'name_on_own_page')!;
    const ev = own.evidence as any;
    expect(ev.phrasedBy).toBe('rules');
    expect(ev.baseline).toMatchObject({ num: 0, den: 6, value: 0, higherIsBetter: true });
    expect(own.baseline).toMatchObject({ value: 0 });
    expect(Number(own.generationCostUsd)).toBe(0);
    expect(await db.select().from(siteCheck).where(eq(siteCheck.workspaceId, ws.id))).toHaveLength(0);
  });

  it('Upsert erhält Status, formuliert nur Neues/Geändertes per KI, verbucht Kosten und inaktiviert Überholtes', async () => {
    const ws = await seed(`${PREFIX}upsert`);
    await measure(ws.id, { recommend: false });
    const p1 = stubPhraser();
    const g1 = await generateRecommendations(ws.id, { phraser: p1.fn, siteCheck: false });
    expect(g1.llm).toBe('used');
    expect(g1.created).toBeGreaterThan(2);
    expect(p1.calls[0]).toHaveLength(g1.created);
    let rows = await recs(ws.id);
    expect(rows.every((r) => r.title.startsWith('KI: ') && (r.evidence as any).phrasedBy === 'llm')).toBe(true);
    const total = rows.reduce((a, r) => a + Number(r.generationCostUsd), 0);
    expect(total).toBeCloseTo(0.01, 3);
    const [gen] = await db.select().from(recommendationGeneration).where(eq(recommendationGeneration.workspaceId, ws.id));
    expect(Number(gen.costUsd)).toBe(0.01);
    expect(await monthToDateSpend(ws.id)).toBeCloseTo(0.01, 4);

    // Status setzen (wie die Web-App)
    const outreach = rows.find((r) => r.key.startsWith('outreach:'))!;
    const community = rows.find((r) => r.key.startsWith('community:'))!;
    await db.update(recommendation).set({ status: 'in_progress', statusChangedAt: new Date() }).where(eq(recommendation.id, outreach.id));
    await db.update(recommendation).set({ status: 'dismissed', statusChangedAt: new Date() }).where(eq(recommendation.id, community.id));

    // gleiche Messung erneut: keine neue KI-Formulierung, Texte und Status bleiben
    const p2 = stubPhraser();
    const g2 = await generateRecommendations(ws.id, { phraser: p2.fn, siteCheck: false });
    expect(p2.calls).toHaveLength(0);
    expect(g2).toMatchObject({ created: 0, deactivated: 0, phrased: 0 });
    rows = await recs(ws.id);
    expect(rows.find((r) => r.id === outreach.id)!.status).toBe('in_progress');
    expect(rows.find((r) => r.id === community.id)!.status).toBe('dismissed');
    expect(rows.every((r) => r.title.startsWith('KI: '))).toBe(true);

    // neue Messung: eigene Marke wird jetzt genannt → name_on_own_page/outreach nicht mehr gestützt → inaktiv, Status bleibt
    const c2 = await createCollection(ws.id, 'manual');
    await processCollection(c2.id, { retryDelayMs: 1, engineFor: () => engine({ ownNamed: true }), recommend: false });
    const g3 = await generateRecommendations(ws.id, { phraser: stubPhraser().fn, siteCheck: false });
    expect(g3.collectionId).toBe(c2.id);
    rows = await recs(ws.id);
    const o = rows.find((r) => r.id === outreach.id)!;
    expect(o.active).toBe(false);
    expect(o.status).toBe('in_progress');
    expect(rows.find((r) => r.key === 'name_on_own_page')!.active).toBe(false);
    // Wirkungsmessung: Kennzahl auf der neuen Messung (vorher 0 → jetzt 1)
    const data = await loadRecData(ws.id, c2.id);
    expect(recommendationMetric({ type: o.type, key: o.key, evidence: o.evidence }, data)!.value).toBe(1);
    expect((o.evidence as any).baseline.value).toBe(0);
  });

  it('Budget erreicht → Standardtexte ohne KI-Aufruf', async () => {
    const ws = await seed(`${PREFIX}budget`);
    await measure(ws.id, { recommend: false });
    await db.update(workspace).set({ monthlyBudgetUsd: '0' }).where(eq(workspace.id, ws.id));
    const p = stubPhraser();
    const g = await generateRecommendations(ws.id, { phraser: p.fn, siteCheck: false });
    expect(g.llm).toBe('budget');
    expect(p.calls).toHaveLength(0);
    expect((await recs(ws.id)).every((r) => (r.evidence as any).phrasedBy === 'rules')).toBe(true);
  });

  it('Fehler bei der Maßnahmen-Berechnung lassen die Messung nicht scheitern', async () => {
    const ws = await seed(`${PREFIX}error`);
    const log = vi.fn();
    const { s, c } = await measure(ws.id, { log, recommend: { phraser: async () => { throw new Error('KI kaputt'); } } });
    expect(s.status).toBe('done');
    const [col] = await db.select().from(collection).where(eq(collection.id, c.id));
    expect(col.status).toBe('done');
    expect(log.mock.calls.some(([m]) => /Maßnahmen konnten nicht berechnet werden.*KI kaputt/s.test(m))).toBe(true);
  });

  it('Website-Check: technische Maßnahmen, Ergebnis in site_check, höchstens 1× pro Tag', async () => {
    const ws = await seed(`${PREFIX}site`);
    await measure(ws.id, { recommend: false });
    const fetchFn = vi.fn<FetchLike>(async (url) => {
      const body = url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n'
        : url.endsWith('/llms.txt') ? 'nicht gefunden' : '<html><body><div id="app"></div></body></html>';
      return { status: url.endsWith('/llms.txt') ? 404 : 200, url, text: async () => body };
    });
    await generateRecommendations(ws.id, { siteCheck: true, fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(4); // Startseite für das Markenprofil + robots.txt, llms.txt, Startseite
    const keys = (await recs(ws.id)).filter((r) => r.type === 'technical').map((r) => r.key).sort();
    expect(keys).toEqual(['technical:js_text', 'technical:robots', 'technical:structured_data']);
    const [sc] = await db.select().from(siteCheck).where(eq(siteCheck.workspaceId, ws.id));
    expect((sc.result as any).robots.blocked).toEqual(['OAI-SearchBot']);
    await generateRecommendations(ws.id, { siteCheck: true, fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(4); // Ergebnis von heute wiederverwendet, Profil erst nach einer Woche erneut
    // ohne Check bleiben technische Maßnahmen aktiv
    await generateRecommendations(ws.id, { siteCheck: false });
    expect((await recs(ws.id)).filter((r) => r.type === 'technical').every((r) => r.active)).toBe(true);
    // technical: keine irreführende Wirkungs-Kennzahl
    for (const r of (await recs(ws.id)).filter((x) => x.type === 'technical')) {
      expect(r.baseline).toBeNull();
      expect((r.evidence as any).current).toBeNull();
    }
  });

  it('Markenprofil: automatisch aus der Website, nie über Eingaben des Nutzers', async () => {
    const ws = await seed(`${PREFIX}profile`);
    await db.update(brand).set({ description: null, kind: null, profileSource: null, profileCheckedAt: null }).where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true)));
    const html = '<html><head><meta name="description" content="Paylindo vergleicht EC-Terminals für kleine Läden."></head><body><p>Vergleich</p></body></html>';
    const fetchFn: FetchLike = async (url) => ({ status: 200, url, text: async () => html });
    const own = async () => (await db.select().from(brand).where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true))))[0];
    const g = await autofillBrandProfile(ws.id, { fetch: fetchFn, useLlm: false });
    expect(g?.source).toBe('meta');
    expect(await own()).toMatchObject({ description: 'Paylindo vergleicht EC-Terminals für kleine Läden.', profileSource: 'auto', kind: null });
    expect(await autofillBrandProfile(ws.id, { fetch: fetchFn, useLlm: false })).toBeNull(); // kürzlich geprüft
    await db.update(brand).set({ description: 'Von Hand', kind: 'portal', profileSource: 'user' }).where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true)));
    expect(await autofillBrandProfile(ws.id, { fetch: fetchFn, useLlm: false, force: true })).toBeNull();
    expect(await own()).toMatchObject({ description: 'Von Hand', kind: 'portal', profileSource: 'user' });
    // Altbestand: Beschreibung von Hand, aber noch ohne Herkunft → gilt als Angabe des Nutzers
    await db.update(brand).set({ description: 'Alt von Hand', kind: 'provider', profileSource: null, profileCheckedAt: null }).where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true)));
    expect(await autofillBrandProfile(ws.id, { fetch: fetchFn, useLlm: false, force: true })).toBeNull();
    expect(await own()).toMatchObject({ description: 'Alt von Hand', kind: 'provider' });
    // nur ein Typ gewählt, „Von Website erkennen“ (replace): Beschreibung kommt dazu, der gewählte Typ bleibt
    await db.update(brand).set({ description: null, kind: 'portal', profileSource: 'user', profileCheckedAt: null }).where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true)));
    await autofillBrandProfile(ws.id, { fetch: fetchFn, force: true, replaceUser: true, ask: async () => ({ json: { description: 'Paylindo ist ein Anbieter von EC-Terminals.', kind: 'provider' }, costUsd: 0.0005 }) });
    expect(await own()).toMatchObject({ description: 'Paylindo ist ein Anbieter von EC-Terminals.', kind: 'portal', profileSource: 'auto' });
    // Mindestpause: sofortiger zweiter Klick löst keinen Abruf aus
    expect(await autofillBrandProfile(ws.id, { fetch: fetchFn, force: true, replaceUser: true, useLlm: false })).toBeNull();
    const gens = await db.select().from(recommendationGeneration).where(eq(recommendationGeneration.workspaceId, ws.id));
    expect(gens.some((g) => Number(g.costUsd) === 0.0005)).toBe(true);
  });

  it('backfill-searched trägt durchsuchte ChatGPT-Quellen idempotent nach', async () => {
    const ws = await seed(`${PREFIX}backfill`);
    const { c } = await measure(ws.id, { recommend: false });
    const [r] = await db.select({ id: response.id }).from(response).innerJoin(run, eq(run.id, response.runId))
      .where(and(eq(run.collectionId, c.id), eq(run.engine, 'chatgpt'))).limit(1);
    await db.delete(citation).where(and(eq(citation.responseId, r.id), eq(citation.kind, 'searched')));
    await db.update(response).set({
      raw: { output: [{ type: 'web_search_call', action: { sources: [
        { url: 'https://paylindo.de/ratgeber/kartenzahlung' }, // schon zitiert → nicht doppelt
        { url: 'https://www.reddit.com/r/Finanzen/comments/x/y/' }, { url: 'https://www.reddit.com/r/Finanzen/comments/x/y/' },
      ] } }] },
    }).where(eq(response.id, r.id));
    const a = await backfillSearchedCitations({ workspaceId: ws.id });
    expect(a.inserted).toBe(1);
    const b = await backfillSearchedCitations({ workspaceId: ws.id });
    expect(b.inserted).toBe(0);
    const cs = await db.select().from(citation).where(eq(citation.responseId, r.id));
    expect(cs.filter((x) => x.kind === 'searched').map((x) => [x.domain, x.position])).toEqual([['reddit.com', 3]]);
    expect(await db.select().from(mention).where(eq(mention.responseId, r.id))).not.toHaveLength(0);
  });
  it('Website-Check: Fehlschläge werden gespeichert und 6 h gedrosselt; höchstens 5 Domains; private Domains ohne Abruf', async () => {
    const ws = await seed(`${PREFIX}sitefail`);
    await measure(ws.id, { recommend: false });
    // Beschreibung gesetzt → keine Profilerkennung; gezählt werden nur die Abrufe des Website-Checks
    await db.update(brand).set({ domains: ['paylindo.de', 'localhost', 'b.de', 'c.de', 'd.de', 'e.de', 'f.de'], description: 'Paylindo vergleicht EC-Terminals.' })
      .where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true)));
    const fetchFn = vi.fn<FetchLike>(async () => { throw new Error('ECONNREFUSED'); });
    await generateRecommendations(ws.id, { siteCheck: true, fetch: fetchFn });
    const rows = await db.select().from(siteCheck).where(eq(siteCheck.workspaceId, ws.id));
    expect(rows.map((r) => r.domain).sort()).toEqual(['b.de', 'c.de', 'd.de', 'localhost', 'paylindo.de']);
    // localhost nie abgerufen; 4 Domains × 3 Dateien × (Apex + www)
    expect(fetchFn.mock.calls.some(([u]) => u.includes('localhost'))).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(4 * 3 * 2);
    await generateRecommendations(ws.id, { siteCheck: true, fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(24); // Fehlschlag gilt 6 h
    await db.update(siteCheck).set({ checkedAt: new Date(Date.now() - 7 * 3600_000) }).where(eq(siteCheck.workspaceId, ws.id));
    await generateRecommendations(ws.id, { siteCheck: true, fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(48);
  });

  it('wird während der Berechnung eine neuere Messung fertig, wird nicht gespeichert; Generierungen je Workspace laufen nacheinander', async () => {
    const ws = await seed(`${PREFIX}race`);
    await measure(ws.id, { recommend: false });
    const before = await recs(ws.id);
    let newer: Promise<unknown> | null = null;
    const phraser: Phraser = async (items) => {
      // „parallel“ fertig werdende Messung
      newer ??= measure(ws.id, { recommend: false });
      await newer;
      return { texts: new Map(), costUsd: 0.002, model: 'm' };
    };
    const g = await generateRecommendations(ws.id, { phraser, siteCheck: false });
    expect(g.candidates).toBe(0);
    expect(await recs(ws.id)).toHaveLength(before.length);
    // gebuchte KI-Kosten bleiben gebucht
    const gen = await db.select().from(recommendationGeneration).where(eq(recommendationGeneration.workspaceId, ws.id));
    expect(gen.map((x) => x.costUsd)).toEqual(['0.0020']);

    // Lock: zwei gleichzeitige Generierungen überlappen nicht
    const spans: [number, number][] = [];
    const slow: Phraser = async (items) => {
      const t0 = Date.now(); await new Promise((r) => setTimeout(r, 150)); spans.push([t0, Date.now()]);
      return { texts: new Map(), costUsd: 0, model: 'm' };
    };
    await db.delete(recommendation).where(eq(recommendation.workspaceId, ws.id));
    await Promise.all([generateRecommendations(ws.id, { phraser: slow, siteCheck: false }), generateRecommendations(ws.id, { phraser: slow, siteCheck: false })]);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    if (spans.length === 2) expect(spans[1][0]).toBeGreaterThanOrEqual(spans[0][1]);
  });

  it('gescheiterte KI-Formulierung wird höchstens zweimal versucht', async () => {
    const ws = await seed(`${PREFIX}attempts`);
    await measure(ws.id, { recommend: false });
    const calls: number[] = [];
    const failing: Phraser = async (items) => { calls.push(items.length); return { texts: new Map(), costUsd: 0.001, model: 'm', error: 'kaputt' }; };
    for (let i = 0; i < 3; i++) await generateRecommendations(ws.id, { phraser: failing, siteCheck: false });
    expect(calls.length).toBe(2);
    expect((await recs(ws.id)).every((r) => (r.evidence as any).phraseAttempts?.n === 2)).toBe(true);
    expect((await recs(ws.id)).every((r) => r.status === 'open')).toBe(true);
  });

  it('nur http(s)-URLs werden als Quelle gespeichert', async () => {
    const ws = await seed(`${PREFIX}urls`);
    const bad: Engine = {
      ...engine(), run: async (p) => ({
        ...(await engine().run(p, {} as any)),
        citations: [
          { url: 'javascript://evil.com/%0aalert(1)', kind: 'cited' },
          { url: 'data:text/html,<b>x</b>', kind: 'cited' },
          { url: 'https://ok.de/a', kind: 'cited' },
        ],
      }),
    };
    const { c } = await measure(ws.id, { recommend: false, engineFor: () => bad });
    const cs = await db.select({ url: citation.url }).from(citation).innerJoin(response, eq(response.id, citation.responseId))
      .innerJoin(run, eq(run.id, response.runId)).where(eq(run.collectionId, c.id));
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((x) => x.url === 'https://ok.de/a')).toBe(true);
  });
  it('Lagebericht und wichtigste Erkenntnis', async () => {
    const ws = await seed(`${PREFIX}brief`);
    await measure(ws.id, { recommend: false });
    await generateRecommendations(ws.id, { siteCheck: false, llm: false });
    const md = await buildStatusBrief(ws.id);
    for (const h of ['# Lagebericht KI-Sichtbarkeit: Paylindo', '## Wo wir stehen', '## Wichtigste Erkenntnis', '## Die 3 wichtigsten Maßnahmen', '## Nächste Messung', 'Nutze das als Kontext für deine KI']) expect(md).toContain(h);
    expect(md).toMatch(/KI-Sichtbarkeit: 0\/100 – Kaum sichtbar/);
    expect(md).toMatch(/\| 1 \| SumUp \| \d+ von \d+ \|/);
    expect(md).toMatch(/Platz 3 von 3 Marken/);
    expect(md).toMatch(/KI-Sichtbarkeit heißt:/);
    expect(md).toMatch(/Gemini 0 von \d+ \(0 %\)/);
    const k = await keyInsight(ws.id);
    expect(k?.kind).toBe('source_not_named');
    expect(k?.text).toMatch(/^KIs nutzen paylindo\.de in (\d+) von \1 Antworten \(100 %\) als Quelle – nennen Paylindo aber fast nie \(0 von \d+\)\.$/);
    expect(Array.isArray(await outreachExclusions(ws.id))).toBe(true);
  });

  it('Analyse: is_competitor wird je Nennung gespeichert', async () => {
    const ws = await seed(`${PREFIX}competitor`);
    const analyzer = async () => ({
      answer_type: 'list' as const, costUsd: 0,
      brands: [
        { name: 'SumUp', tracked: 'SumUp', position: 1, sentiment: 'neutral' as const, recommended: true, snippet: 'SumUp', is_competitor: true },
        { name: 'Visa', tracked: null, position: 2, sentiment: 'neutral' as const, recommended: false, snippet: 'Visa', is_competitor: false },
        { name: 'myPOS', tracked: null, position: 3, sentiment: 'neutral' as const, recommended: false, snippet: 'myPOS', is_competitor: true },
      ],
    });
    const { c } = await measure(ws.id, { recommend: false, analyzer });
    const ms = await db.select({ name: mention.name, isCompetitor: mention.isCompetitor }).from(mention)
      .innerJoin(response, eq(response.id, mention.responseId)).innerJoin(run, eq(run.id, response.runId)).where(eq(run.collectionId, c.id));
    expect(ms.find((m) => m.name === 'Visa')?.isCompetitor).toBe(false);
    expect(ms.find((m) => m.name === 'myPOS')?.isCompetitor).toBe(true);
    // Rangliste wie in der UI: Visa (kein Wettbewerber) fehlt, myPOS (ungetrackt, Wettbewerber) ist dabei
    const r = (await brandRanking(ws.id))!;
    expect(r.rows.map((x) => x.name)).not.toContain('Visa');
    expect(r.rows.find((x) => x.name === 'myPOS')).toMatchObject({ tracked: false });
    expect(r.own).toMatchObject({ name: 'Paylindo', own: true });
    expect(r.total).toBe(r.rows.length);
    expect(r.rows.map((x) => x.place)).toEqual(r.rows.map((_, i) => i + 1));
  });
});
