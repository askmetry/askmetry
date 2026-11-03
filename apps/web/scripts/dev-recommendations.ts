// Entwicklungsdaten für die Maßnahmen-Seite und „Von KI gelesen“ – NUR für Test-Workspaces.
// Aufruf: pnpm --filter @opengeo/web exec tsx scripts/dev-recommendations.ts [slug=e2e-test] [--remove]
// Legt Maßnahmen mit key-Präfix „fixture:“ an (idempotent) und ergänzt bei einer ChatGPT-Antwort mit Zitaten
// einige gelesene, nicht zitierte Seiten (title-Präfix „[fixture]“). --remove entfernt beides wieder.
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env'), quiet: true });

const { and, eq, like, sql } = await import('drizzle-orm');
const S = await import('@opengeo/db');
const { db, closeDb } = S;

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--')) ?? 'e2e-test';
const remove = args.includes('--remove');
if (['paylindo', 'medishift'].includes(slug)) {
  console.error('Abbruch: echte Workspaces werden vom Core-Agenten befüllt, nicht mit Fixture-Daten.');
  process.exit(1);
}
const [ws] = await db.select().from(S.workspace).where(eq(S.workspace.slug, slug));
if (!ws) {
  console.error(`Workspace „${slug}“ nicht gefunden.`);
  process.exit(1);
}

await db.delete(S.recommendation).where(and(eq(S.recommendation.workspaceId, ws.id), like(S.recommendation.key, 'fixture:%')));
await db.delete(S.citation).where(and(eq(S.citation.workspaceId, ws.id), like(S.citation.title, '[fixture]%')));
if (remove) {
  await closeDb();
  console.log(`Fixture-Daten aus „${slug}“ entfernt.`);
  process.exit(0);
}

const prompts = await db.select({ id: S.prompt.id, text: S.prompt.text }).from(S.prompt).where(eq(S.prompt.workspaceId, ws.id)).limit(3);
const p0 = prompts[0];
// Format laut CONTRACT „Maßnahmen“: Beispiele ohne promptId, Prompts in evidence.prompts, Kennzahlen als Objekte
const ex = (engine: string, extra: Record<string, unknown> = {}) => ({ prompt: p0?.text ?? 'Beispiel-Prompt', engine, ...extra });
const ps = prompts.map((p) => ({ id: p.id, text: p.text }));
const snap = (value: number, num: number, den: number, label = 'Sichtbarkeit bei den betroffenen Prompts') => ({ label, value, num, den, higherIsBetter: true, collectionId: null });
const [col] = await db.select({ id: S.collection.id }).from(S.collection)
  .where(and(eq(S.collection.workspaceId, ws.id), eq(S.collection.status, 'done'))).orderBy(sql`${S.collection.createdAt} desc`).limit(1);

const recs = [
  {
    key: 'fixture:outreach:kassensystemevergleich.de', type: 'outreach', impact: 3, effort: 2, priority: '9.2',
    title: 'Bei kassensystemevergleich.de in den Anbietervergleich aufnehmen lassen',
    why: 'Die Seite wird in 6 von 10 Antworten zitiert, in denen SumUp genannt wird, du aber nicht.',
    steps: ['Redaktion über das Kontaktformular anschreiben', 'Datenblatt mit Gebühren und Alleinstellungsmerkmalen mitschicken', 'Nach 2 Wochen nachfassen'],
    evidence: { metrics: { responses: 10 }, prompts: ps, promptIds: ps.map((p) => p.id), competitors: [{ name: 'SumUp', count: 6 }, { name: 'Zettle', count: 4 }], baseline: snap(0.2, 1, 5), current: snap(0.2, 1, 5), previous: null, examples: [ex('chatgpt', { url: 'https://kassensystemevergleich.de/vergleich', title: 'Kassensysteme im Vergleich', snippet: 'SumUp und Zettle sind die günstigsten Einstiegslösungen' }), ex('gemini')] },
  },
  {
    key: 'fixture:name_on_own_page:preise', type: 'name_on_own_page', impact: 3, effort: 1, priority: '8.7',
    title: 'Markennamen auf der Preisseite deutlich nennen',
    why: 'Die KIs nutzen deine Preisseite als Quelle, nennen dich aber in 4 Antworten nicht – der Markenname fehlt im Fließtext.',
    steps: ['Markennamen in H1 und ersten Absatz aufnehmen', 'Kurze Zusammenfassung „Was ist …?“ ergänzen'],
    evidence: { urls: [{ url: 'https://paylindo.de/kartenterminal-kosten', title: 'Kartenterminal Kosten', count: 4 }], baseline: snap(0.25, 1, 4, 'Nennungsrate in Antworten mit eigener Seite'), current: snap(0.25, 1, 4, 'Nennungsrate in Antworten mit eigener Seite'), examples: [ex('claude', { url: 'https://paylindo.de/kartenterminal-kosten' })] },
  },
  {
    key: 'fixture:community:reddit', type: 'community', impact: 2, effort: 2, priority: '6.1',
    title: 'In r/selbststaendig bei Fragen zu Kartenterminals mitdiskutieren',
    why: 'ChatGPT liest bei 3 Prompts Reddit-Threads, in denen deine Marke nicht vorkommt.',
    steps: ['Die drei meistgelesenen Threads beantworten', 'Offen als Anbieter auftreten'],
    evidence: { source: 'r/selbststaendig', urls: [{ url: 'https://www.reddit.com/r/selbststaendig/comments/abc/kartenterminal/', title: 'Kartenterminal Empfehlung?', count: 3, kind: 'searched' }], prompts: ps, examples: [ex('chatgpt', { url: 'https://www.reddit.com/r/selbststaendig/comments/abc/kartenterminal/' })] },
  },
  {
    key: 'fixture:technical:llms', type: 'technical', impact: 1, effort: 1, priority: '4.0',
    title: 'llms.txt anlegen', why: 'Deine Domain hat keine llms.txt – eine kleine, schnelle Verbesserung.', steps: ['Datei /llms.txt mit den wichtigsten Seiten anlegen'],
    evidence: { current: snap(0.3, 3, 10, 'Anteil Antworten mit eigener Seite als Quelle') }, status: 'in_progress' as const, statusChangedAt: new Date(Date.now() - 3 * 86400_000), baseline: snap(0.2, 2, 10, 'Anteil Antworten mit eigener Seite als Quelle'),
  },
  {
    key: 'fixture:content_gap:pflicht', type: 'content_gap', impact: 2, effort: 3, priority: '5.5',
    title: 'Ratgeber zur Kartenzahlungspflicht schreiben', why: 'Bei diesem Prompt nennen alle Engines andere Marken, dich keine.', steps: ['Gliederung erstellen', 'Artikel veröffentlichen', 'Intern verlinken'],
    evidence: { titleSuggestion: 'Kartenzahlungspflicht 2027: Was Händler jetzt tun müssen', prompts: ps.slice(0, 1).map((p) => ({ ...p, missing: true })), current: snap(0.4, 2, 5) }, status: 'done' as const, statusChangedAt: new Date(Date.now() - 86400_000), baseline: snap(0, 0, 5),
  },
  {
    key: 'fixture:sentiment:gebuehren', type: 'sentiment', impact: 2, effort: 2, priority: '3.0',
    title: 'Kritik an Gebühren aufgreifen', why: 'Zwei Antworten erwähnen versteckte Gebühren.', steps: [], evidence: null,
    status: 'dismissed' as const, statusChangedAt: new Date(),
  },
  {
    key: 'fixture:positioning:alt', type: 'positioning', impact: 2, effort: 2, priority: '7.0', active: false,
    title: 'Als Vergleichsportal positionieren', why: 'Wurde von der letzten Messung nicht mehr gestützt.', steps: ['Claim anpassen'], evidence: {},
  },
];
await db.insert(S.recommendation).values(recs.map((r) => ({
  // Spalte baseline wie beim Generator = evidence.baseline (Stand bei Entstehung), sofern nicht explizit gesetzt
  workspaceId: ws.id, lastCollectionId: col?.id ?? null, baseline: (r.evidence as { baseline?: unknown } | null)?.baseline ?? null, ...r, evidence: r.evidence ?? {},
})));

// Gelesene, nicht zitierte Seiten an eine ChatGPT-Antwort mit Zitaten hängen
const [resp] = await db.execute<{ id: string }>(sql`
  select resp.id from ${S.response} resp join ${S.run} r on r.id = resp.run_id
  where resp.workspace_id = ${ws.id} and r.engine = 'chatgpt' and resp.answer <> ''
    and exists (select 1 from ${S.citation} c where c.response_id = resp.id and c.kind = 'cited')
  limit 1`).then((x) => x.rows);
if (resp) {
  const urls = [
    'https://www.reddit.com/r/selbststaendig/comments/abc/kartenterminal_empfehlung/',
    'https://www.reddit.com/r/Kassensysteme/comments/def/sumup_oder_zettle/',
    'https://www.youtube.com/watch?v=fixture123',
    'https://www.gutefrage.net/frage/welches-ec-geraet',
    'https://www.chip.de/artikel/kartenterminals-test',
  ];
  await db.insert(S.citation).values(urls.map((u, i) => ({
    responseId: resp.id, workspaceId: ws.id, url: u, domain: new URL(u).hostname.replace(/^www\./, ''),
    title: `[fixture] ${new URL(u).hostname.replace(/^www\./, '')}`, position: 100 + i, kind: 'searched' as const,
  })));
}
await closeDb();
console.log(`Fixture-Maßnahmen (${recs.length}) und gelesene Seiten in „${slug}“ angelegt.`);
