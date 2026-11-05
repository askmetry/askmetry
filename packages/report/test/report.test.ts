import { brand, citation, closeDb, collection, db, domainLogo, mention, prompt, recommendation, report, response, run, topic, workspace } from '@askmetry/db';
import { inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildReportModel, encodePng, loadReportInput, loadWorkspaceInput, NOISE_PP, parseGuide, PLAN_MAX, planWeeks, renderModelPdf, renderReportPdf, renderWorkspacePdf,
  wilson, type ReportRec,
} from '../src/index.ts';
import { comparisonSentence, scopeLine, tierLabel } from '../src/text.ts';

const PREFIX = 'it-report-';
const ENGINES = ['chatgpt', 'gemini'] as const;

// ---------------------------------------------------------------------------
// reine Helfer
// ---------------------------------------------------------------------------

describe('wilson', () => {
  it('liefert ein plausibles 95-%-Intervall', () => {
    expect(wilson(0, 0)).toBeNull();
    const a = wilson(0, 10)!;
    expect(a.lo).toBe(0);
    expect(a.hi).toBeGreaterThan(0.2);
    const b = wilson(5, 10)!;
    expect(b.lo).toBeCloseTo(0.237, 2);
    expect(b.hi).toBeCloseTo(0.763, 2);
    const c = wilson(150, 300)!;
    expect(c.hi - c.lo).toBeLessThan(0.12); // 300 Antworten: etwa ±5–6 Punkte
  });
});

describe('planWeeks (30-Tage-Plan)', () => {
  const rec = (key: string, category: ReportRec['category'], priority: number, effort: number, impact = 2): ReportRec => ({
    key, type: category === 'technical' ? 'technical' : 'content_gap', category, categoryLabel: '', owner: '', title: key, why: '', steps: [],
    impact, effort, priority, impactText: '', effortText: '', deliverable: '', prompt: '', status: 'open',
  });
  it('setzt Voraussetzungen in Woche 1, hält die Reihenfolge und lässt keine Woche leer', () => {
    const recs = [
      rec('a', 'content', 9, 2), rec('b', 'content', 8, 3), rec('c', 'offsite', 7, 1), rec('d', 'community', 6, 2),
      rec('e', 'content', 5, 2), rec('robots', 'technical', 1, 1, 3), rec('schema', 'technical', 0.5, 1, 1),
    ];
    const plan = planWeeks(recs);
    expect(plan.weeks.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    const flat = plan.weeks.flatMap((w) => w.items.map((r) => r.key));
    expect([...flat, ...plan.later.map((r) => r.key)].sort()).toEqual(recs.map((r) => r.key).sort());
    expect(flat[0]).toBe('robots');
    // Reihenfolge = Voraussetzungen, dann Priorität
    expect(flat).toEqual(['robots', 'a', 'b', 'c', 'd', 'e', 'schema']);
    for (const w of plan.weeks) expect(w.items.length).toBeGreaterThan(0);
    expect(plan.later).toHaveLength(0);
  });
  it('nimmt höchstens PLAN_MAX Maßnahmen, der Rest kommt „später“', () => {
    const recs = Array.from({ length: 13 }, (_, i) => rec(`r${i}`, 'content', 20 - i, 2));
    const plan = planWeeks(recs);
    expect(plan.weeks.flatMap((w) => w.items)).toHaveLength(PLAN_MAX);
    expect(plan.weeks.map((w) => w.items.length)).toEqual([2, 2, 2, 2]);
    expect(plan.later.map((r) => r.key)).toEqual(['r8', 'r9', 'r10', 'r11', 'r12']);
  });
  it('verteilt nach Aufwand (intern), ohne die Reihenfolge zu brechen', () => {
    const plan = planWeeks([rec('big', 'content', 9, 3), rec('s1', 'content', 8, 1), rec('s2', 'content', 7, 1), rec('s3', 'content', 6, 1), rec('s4', 'content', 5, 1), rec('m', 'content', 4, 2)]);
    expect(plan.weeks.map((w) => w.items.map((r) => r.key))).toEqual([['big'], ['s1', 's2'], ['s3', 's4'], ['m']]);
  });
  it('kommt mit wenigen Maßnahmen zurecht', () => {
    expect(planWeeks([]).weeks.every((w) => w.items.length === 0)).toBe(true);
    const one = planWeeks([rec('x', 'content', 1, 1)]);
    expect(one.weeks[0].items).toHaveLength(1);
    expect(one.weeks.slice(1).every((w) => w.items.length === 0)).toBe(true);
  });
});

describe('parseGuide', () => {
  it('zerlegt das Leitfaden-Markdown in Titel, Einleitung und Blöcke', () => {
    const g = parseGuide(`<!-- Entwurf -->
# GEO kurz erklärt

So nennen dich KI-Suchen öfter.

## Was zählt
Ein **klarer** Absatz mit [Link](https://example.com/x).

- Punkt eins
- Punkt zwei
  geht weiter

### Wie lange dauert es?
Meist einige Wochen.

1. Erst messen
2. Dann handeln
`)!;
    expect(g.title).toBe('GEO kurz erklärt');
    expect(g.intro).toBe('So nennen dich KI-Suchen öfter.');
    expect(g.blocks).toEqual([
      { kind: 'h2', text: 'Was zählt' },
      { kind: 'p', text: 'Ein **klarer** Absatz mit Link (example.com/x).' },
      { kind: 'ul', items: ['Punkt eins', 'Punkt zwei geht weiter'] },
      { kind: 'h3', text: 'Wie lange dauert es?' },
      { kind: 'p', text: 'Meist einige Wochen.' },
      { kind: 'ol', items: ['Erst messen', 'Dann handeln'] },
    ]);
    expect(parseGuide('  \n<!-- leer -->\n')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mit Testdatenbank
// ---------------------------------------------------------------------------

type Ids = { ws: string; slug: string; own: string; sumup: string; zettle: string; prompts: string[]; c1: string; c2: string; r1: string; r2: string };
let ids: Ids;

/** Eine Messung einfügen: 3 Fragen × 2 KIs × 2 Durchläufe = 12 Antworten. ownNamed(p, e, rep) bestimmt, ob Paylindo genannt wird. */
async function insertCollection(wsId: string, b: { own: string; sumup: string; zettle: string }, prompts: string[], ownNamed: (pi: number, e: string, rep: number) => boolean, at: Date) {
  const [c] = await db.insert(collection).values({ workspaceId: wsId, status: 'done', trigger: 'manual', startedAt: at, finishedAt: new Date(at.getTime() + 60_000), createdAt: at }).returning();
  for (const [pi, pid] of prompts.entries()) {
    for (const e of ENGINES) {
      for (const rep of [1, 2]) {
        const [r] = await db.insert(run).values({
          collectionId: c.id, workspaceId: wsId, promptId: pid, engine: e, model: e === 'chatgpt' ? 'gpt-test' : 'gemini-test', repetition: rep, status: 'done',
          startedAt: at, finishedAt: at,
        }).returning();
        const [resp] = await db.insert(response).values({ runId: r.id, workspaceId: wsId, answer: `Antwort ${pi} ${e} ${rep}` }).returning();
        const own = ownNamed(pi, e, rep);
        const ms: (typeof mention.$inferInsert)[] = [{ responseId: resp.id, workspaceId: wsId, brandId: b.sumup, name: 'SumUp', position: 1, recommended: true }];
        if (own) ms.push({ responseId: resp.id, workspaceId: wsId, brandId: b.own, name: 'Paylindo', position: 2 });
        if (e === 'chatgpt') ms.push({ responseId: resp.id, workspaceId: wsId, brandId: b.zettle, name: 'Zettle', position: 3 });
        ms.push({ responseId: resp.id, workspaceId: wsId, brandId: null, name: 'Visa', position: 4, isCompetitor: false });
        await db.insert(mention).values(ms);
        // Quellen: ChatGPT zitiert die eigene Seite (Frage 0) und ein Portal; Gemini nur das Portal; eine Antwort hat nur gelesene Quellen
        const cits: (typeof citation.$inferInsert)[] = [];
        if (e === 'chatgpt') {
          if (pi === 0) cits.push({ responseId: resp.id, workspaceId: wsId, url: 'https://www.paylindo.de/ratgeber/kartenzahlung', domain: 'paylindo.de', title: 'Ratgeber Kartenzahlung', position: 1, kind: 'cited' });
          cits.push({ responseId: resp.id, workspaceId: wsId, url: 'https://vergleich.de/terminals', domain: 'vergleich.de', title: 'Vergleich', position: 2, kind: 'cited' });
          cits.push({ responseId: resp.id, workspaceId: wsId, url: 'https://www.reddit.com/r/Kartenzahlung/comments/x/y/', domain: 'reddit.com', position: 3, kind: 'searched' });
        } else if (pi === 2 && rep === 1) {
          cits.push({ responseId: resp.id, workspaceId: wsId, url: 'https://paylindo.de/preise', domain: 'paylindo.de', title: null, position: 1, kind: 'searched' });
        } else {
          cits.push({ responseId: resp.id, workspaceId: wsId, url: 'https://vergleich.de/terminals', domain: 'vergleich.de', title: 'Vergleich', position: 1, kind: 'cited' });
          cits.push({ responseId: resp.id, workspaceId: wsId, url: 'https://sumup.de/preise', domain: 'sumup.de', title: 'SumUp Preise', position: 2, kind: 'cited' });
        }
        await db.insert(citation).values(cits);
      }
    }
  }
  return c.id;
}

async function cleanup() {
  await db.delete(workspace).where(like(workspace.slug, `${PREFIX}%`));
  await db.delete(domainLogo).where(inArray(domainLogo.domain, ['sumup.de', 'zettle.com']));
}

/** ICO mit einem 2×2-BMP-Eintrag (32 Bit, BGRA, unten nach oben) – wie viele echte favicon.ico. */
function testIco(): Buffer {
  const w = 2, h = 2;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(w, 4); header.writeInt32LE(h * 2, 8); header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
  const px = Buffer.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
  const mask = Buffer.alloc(4 * h);
  const img = Buffer.concat([header, px, mask]);
  const dir = Buffer.alloc(6 + 16);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  dir[6] = w; dir[7] = h; dir.writeUInt16LE(1, 10); dir.writeUInt16LE(32, 12); dir.writeUInt32LE(img.length, 14); dir.writeUInt32LE(22, 18);
  return Buffer.concat([dir, img]);
}

beforeAll(async () => {
  await cleanup();
  const slug = `${PREFIX}${Date.now()}`;
  const [ws] = await db.insert(workspace).values({ name: 'Paylindo <Test>', slug, language: 'de', engines: [...ENGINES], repetitions: 2 }).returning();
  const [own, sumup, zettle] = await db.insert(brand).values([
    { workspaceId: ws.id, name: 'Paylindo', domains: ['paylindo.de'], isOwn: true, description: 'Vergleichsportal für Kartenterminals', kind: 'portal' },
    { workspaceId: ws.id, name: 'SumUp', domains: ['sumup.de'] },
    { workspaceId: ws.id, name: 'Zettle', domains: ['zettle.com'] },
  ]).returning();
  // Logos: eigenes hochgeladen (PNG), SumUp als ICO mit 32-Bit-BMP, Zettle als WebP (nicht darstellbar)
  await db.update(brand).set({ logoData: encodePng(2, 2, Buffer.alloc(16, 120)).toString('base64'), logoType: 'image/png' }).where(inArray(brand.id, [own.id]));
  await db.insert(domainLogo).values([
    { domain: 'sumup.de', status: 'ok', contentType: 'image/x-icon', data: testIco().toString('base64') },
    { domain: 'zettle.com', status: 'ok', contentType: 'image/webp', data: Buffer.from('RIFF\0\0\0\0WEBPVP8 ').toString('base64') },
  ]).onConflictDoNothing();
  const [t1, t2] = await db.insert(topic).values([{ workspaceId: ws.id, name: 'Kartenzahlung' }, { workspaceId: ws.id, name: 'Kassensysteme' }]).returning();
  const ps = await db.insert(prompt).values([
    { workspaceId: ws.id, topicId: t1.id, text: 'Welches Kartenterminal für ein Café?' },
    { workspaceId: ws.id, topicId: t1.id, text: 'SumUp oder Zettle – was ist besser?' },
    { workspaceId: ws.id, topicId: t2.id, text: 'Welche Kasse für einen Friseur – Preise in €?' },
  ]).returning();
  const pids = ps.map((p) => p.id);
  const b = { own: own.id, sumup: sumup.id, zettle: zettle.id };
  // Vorher: Paylindo nur bei ChatGPT zu Frage 0 (2 von 12). Jetzt: bei ChatGPT immer + Gemini Frage 1 (8 von 12).
  const c1 = await insertCollection(ws.id, b, pids, (pi, e) => e === 'chatgpt' && pi === 0, new Date('2026-09-01T10:00:00Z'));
  const c2 = await insertCollection(ws.id, b, pids, (pi, e) => e === 'chatgpt' || pi === 1, new Date('2026-11-01T10:00:00Z'));
  await db.insert(recommendation).values([
    {
      workspaceId: ws.id, lastCollectionId: c1, key: `content_gap:${pids[1]}`, type: 'content_gap', title: 'Seite zu „SumUp oder Zettle“ ausbauen',
      why: 'Bei dieser Frage nennen 4 von 4 Antworten SumUp, Paylindo nie.', steps: ['Seite ausrichten', 'Vergleichstabelle ergänzen'],
      impact: 3, effort: 2, priority: '4.2', evidence: { metrics: { responses: 4 }, promptIds: [pids[1]], prompts: [{ id: pids[1], text: 'SumUp oder Zettle – was ist besser?', missing: ['gemini'] }] },
    },
    {
      workspaceId: ws.id, lastCollectionId: c1, key: 'technical:robots', type: 'technical', title: 'KI-Crawler in der robots.txt freigeben',
      why: 'Die robots.txt sperrt OAI-SearchBot.', steps: ['robots.txt öffnen', 'Sperre entfernen'], impact: 3, effort: 1, priority: '2.0',
      evidence: { blockedBots: ['OAI-SearchBot'], domains: ['paylindo.de'] },
    },
    {
      workspaceId: ws.id, lastCollectionId: c1, key: 'outreach:vergleich.de', type: 'outreach', title: 'vergleich.de anschreiben', why: 'vergleich.de ist oft Quelle.', steps: ['Mail schreiben'],
      impact: 2, effort: 1, priority: '9', evidence: { domain: 'vergleich.de' }, status: 'dismissed',
    },
    {
      workspaceId: ws.id, lastCollectionId: c1, key: 'community:reddit:r/kartenzahlung', type: 'community', title: 'In r/Kartenzahlung mitdiskutieren', why: 'Wird gelesen.', steps: ['Lesen'],
      impact: 2, effort: 2, priority: '1', evidence: { source: 'r/Kartenzahlung' }, active: false,
    },
  ]);
  const base = { workspaceId: ws.id, userId: `${PREFIX}user`, tier: 'compact', status: 'ready', amountCents: 7900, paymentProvider: 'fake' };
  const [r1] = await db.insert(report).values({ ...base, kind: 'initial', collectionId: c1, readyAt: new Date('2026-09-01T12:00:00Z') }).returning();
  const [r2] = await db.insert(report).values({ ...base, kind: 'remeasure', previousReportId: r1.id, collectionId: c2, amountCents: 3900, readyAt: new Date('2026-11-01T12:00:00Z') }).returning();
  ids = { ws: ws.id, slug, ...b, prompts: pids, c1, c2, r1: r1.id, r2: r2.id };
});

afterAll(async () => {
  await cleanup();
  await closeDb();
});

describe('Datenaufbereitung (loadReportInput + buildReportModel)', () => {
  it('berechnet Kennzahlen nach CONTRACT.md', async () => {
    const m = buildReportModel(await loadReportInput(ids.r1));
    expect(m.kind).toBe('initial');
    expect(m.comparison).toBeNull();
    expect(m.scope).toMatchObject({ prompts: 3, repetitions: 2, engines: ['chatgpt', 'gemini'], planned: 12, responses: 12 });
    expect(scopeLine(m)).toBe('3 Fragen × 2 Durchläufe × 2 KIs = 12 Antworten');
    // Sichtbarkeit 2/12, Ø Position erst ab 5 Nennungen, Share of Voice = 2 / alle Nennungen (12 SumUp + 6 Zettle + 2 Paylindo + 12 Visa)
    expect(m.own.named).toBe(2);
    expect(m.own.rate).toBeCloseTo(2 / 12);
    expect(m.score).toBe(17);
    expect(m.own.avgPosition).toBeNull();
    expect(m.own.sov).toBeCloseTo(2 / 32);
    const sumup = m.brands.find((b) => b.name === 'SumUp')!;
    expect(sumup).toMatchObject({ named: 12, avgPosition: 1, recommended: 12 });
    expect(m.brands[0].name).toBe('SumUp');
    expect(m.ranking.leader?.name).toBe('SumUp');
    // Ungetrackte Nicht-Wettbewerber (Visa) zählen nicht in der Rangliste
    expect(m.ranking.total).toBe(3);
    // je KI
    const gpt = m.engines.find((e) => e.engine === 'chatgpt')!;
    expect(gpt).toMatchObject({ responses: 6, named: 2, ownSite: 2, models: ['gpt-test'] });
    expect(m.strongest?.engine).toBe('chatgpt');
    expect(m.weakest?.engine).toBe('gemini');
    // je Frage: Anteil über Wiederholungen
    const q0 = m.questions.find((q) => q.id === ids.prompts[0])!;
    expect(q0.cells.chatgpt).toEqual({ named: 2, total: 2 });
    expect(q0.cells.gemini).toEqual({ named: 0, total: 2 });
    expect(q0.others[0].name).toBe('SumUp');
  });

  it('wendet die Quellen-Regel an (cited vor searched)', async () => {
    const m = buildReportModel(await loadReportInput(ids.r1));
    // eigene Seite: 2 ChatGPT-Antworten (zitiert) + 1 Gemini-Antwort nur mit gelesener Quelle
    expect(m.sources.ownSite.responses).toBe(3);
    expect(m.sources.ownSite.named).toBe(2);
    expect(m.sources.ownSite.pages[0].url).toBe('https://paylindo.de/ratgeber/kartenzahlung');
    // reddit nur gelesen in Antworten mit Zitaten → zählt nicht
    expect(m.sources.top.find((d) => d.domain === 'reddit.com')).toBeUndefined();
    const v = m.sources.top.find((d) => d.domain === 'vergleich.de')!;
    expect(v.responses).toBe(11);
    expect(v.type).toBe('other');
    expect(m.sources.top.find((d) => d.domain === 'sumup.de')).toMatchObject({ type: 'competitor', brandName: 'SumUp' });
    expect(m.sources.competitorOnly[0].domain).toBe('vergleich.de');
    expect(m.sources.competitorSites[0]).toMatchObject({ name: 'SumUp', responses: 5 });
  });

  it('nimmt aktive, nicht ausgeblendete Maßnahmen nach Priorität und baut Prompts wie die Web-App', async () => {
    const m = buildReportModel(await loadReportInput(ids.r1));
    expect(m.recs.map((r) => r.key)).toEqual([`content_gap:${ids.prompts[1]}`, 'technical:robots']);
    expect(m.recs[0].category).toBe('content');
    expect(m.recs[0].prompt).toContain('Paylindo');
    expect(m.recs[0].prompt).toContain('Erfinde keine Zahlen');
    expect(m.recs[1].prompt).toMatch(/robots\.txt/);
    expect(m.recs[0].effortText).toBe('ca. 1 Tag');
    expect(m.topRecs).toHaveLength(2);
  });

  it('Nachmessung: Vergleich mit dem Vorbericht inkl. Rauschen-Hinweis', async () => {
    const m = buildReportModel(await loadReportInput(ids.r2));
    expect(m.kind).toBe('remeasure');
    const c = m.comparison!;
    expect(c.before.named).toBe(2);
    expect(c.after.named).toBe(8);
    expect(c.delta).toBeCloseTo(0.5);
    expect(c.withinNoise).toBe(false);
    expect(c.questionsGained).toBe(2); // Frage 1 und 2 neu (ChatGPT nennt jetzt immer), Frage 0 schon vorher
    expect(c.questionsLost).toBe(0);
    expect(c.engines.find((e) => e.engine === 'gemini')).toMatchObject({ before: 0 });
    expect(c.competitors.find((x) => x.name === 'SumUp')).toMatchObject({ before: 1, after: 1 });
    expect(comparisonSentence(m)).toMatch(/deutlich öfter/);
    // kleine Änderung → im Rauschen
    const small = { ...m, comparison: { ...c, delta: NOISE_PP / 2, withinNoise: true } };
    expect(comparisonSentence(small)).toMatch(/Schwankung/);
    expect(tierLabel(m.tier, m.kind, 'de')).toBe('Nachmessung');
    // Maßnahmen der Vor-Messung werden nicht übernommen, sondern aus den Regeln neu berechnet
    expect(m.recs.some((r) => r.key === 'technical:robots' && r.why.includes('OAI-SearchBot'))).toBe(false);
  });

  it('wirft bei einer Messung ohne auswertbare Antworten', async () => {
    const input = await loadReportInput(ids.r1);
    const empty = { ...input, current: { ...input.current, data: { ...input.current.data, resps: [], ments: [], cits: [] } } };
    expect(() => buildReportModel(empty as typeof input)).toThrow(/keine auswertbaren Antworten/);
  });

  it('Strategiebericht: Themen und 30-Tage-Plan', async () => {
    const input = await loadWorkspaceInput(ids.slug, { tier: 'strategy', collectionId: ids.c1, recs: 'db' });
    const m = buildReportModel(input);
    expect(m.topics.map((t) => t.name).sort()).toEqual(['Kartenzahlung', 'Kassensysteme']);
    const k = m.topics.find((t) => t.name === 'Kartenzahlung')!;
    expect(k).toMatchObject({ prompts: 2, responses: 8, named: 2 });
    expect(m.plan!.weeks.flatMap((w) => w.items).length + m.plan!.later.length).toBe(m.recs.length);
    expect(m.plan!.weeks[0].items.map((r) => r.key)).toContain('technical:robots');
    // Logos: eigene Marke hochgeladen (hat Vorrang), SumUp über domain_logo (ICO → PNG), Zettle als WebP → keins
    expect(m.logos[ids.own]?.format).toBe('png');
    expect(m.logos[ids.sumup]?.format).toBe('png');
    expect(m.logos[ids.zettle]).toBeUndefined();
    // Kompaktbericht ohne Plan
    expect(buildReportModel({ ...input, tier: 'compact' }).plan).toBeNull();
  });

  it('Vorschau ohne report-Zeile nimmt die neueste Messung; Maßnahmen notfalls aus den Regeln', async () => {
    const input = await loadWorkspaceInput(ids.slug, { tier: 'compact' });
    expect(input.current.collection.id).toBe(ids.c2);
    expect(input.reportId).toBeNull();
    // DB-Maßnahmen stammen aus Messung c1 → für c2 im Speicher aus den Regeln berechnet
    expect(input.recs.every((r) => (r.evidence as { phrasedBy?: string }).phrasedBy === 'rules')).toBe(true);
    const en = buildReportModel({ ...input, lang: 'en' });
    expect(tierLabel(en.tier, en.kind, 'en')).toBe('Baseline report');
  });
});

describe('renderReportPdf', () => {
  it('rendert ein gültiges PDF (Erstbericht und Nachmessung)', async () => {
    for (const id of [ids.r1, ids.r2]) {
      const pdf = await renderReportPdf(id);
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(20_000);
      expect(pdf.subarray(-8).toString('latin1')).toContain('%%EOF');
    }
  });
  it('rendert Strategiebericht auf Englisch', async () => {
    const pdf = await renderWorkspacePdf(ids.slug, { tier: 'strategy', lang: 'en' });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
  it('rendert Strategiebericht mit Leitfaden-Kapitel und übersteht ein kaputtes Logo', async () => {
    const input = await loadWorkspaceInput(ids.slug, { tier: 'strategy', collectionId: ids.c1, recs: 'db' });
    const m = buildReportModel({ ...input, guide: parseGuide('# GEO kurz erklärt\n\nEinleitung.\n\n## Abschnitt\n\n- Punkt') });
    const ok = await renderModelPdf(m);
    expect(ok.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const broken = { ...m, logos: { ...m.logos, [ids.zettle]: { format: 'png' as const, data: Buffer.from('kein png') } } };
    const pdf = await renderModelPdf(broken);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
  it('wirft bei unbekanntem Bericht', async () => {
    await expect(renderReportPdf('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/nicht gefunden/);
  });
});
