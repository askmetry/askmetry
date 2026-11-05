// Entwicklungsdaten für die gehostete Oberfläche (Schnell-Check, Berichte), solange das Backend noch Stubs hat.
// Aufruf: pnpm --filter @askmetry/web exec tsx scripts/dev-hosted-fixture.ts [--source paylindo]
// Idempotent: ersetzt alle Fixture-Zeilen (Workspaces „fixture-*“, Checks mit Token „fixture-*“, Nutzer kunde@askmetry.test).
// Quelle ist ein bestehender Workspace mit Messung (Standard: paylindo); er wird kopiert, nie verändert.
// Zugangsdaten landen in FIXTURE_CREDENTIALS (Standard: apps/web/.dev-hosted-credentials, Modus 600) und werden nicht ausgegeben.
import { config } from 'dotenv';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env'), quiet: true });

const { hashPassword } = await import('better-auth/crypto');
const { eq, like, sql } = await import('drizzle-orm');
const S = await import('@askmetry/db');
const { db, closeDb } = S;

const srcSlug = process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1]! : 'paylindo';
const [src] = await db.select().from(S.workspace).where(eq(S.workspace.slug, srcSlug));
if (!src) throw new Error(`Quell-Workspace ${srcSlug} fehlt`);

// --- aufräumen
await db.delete(S.checkRequest).where(like(S.checkRequest.token, 'fixture-%'));
await db.delete(S.workspace).where(like(S.workspace.slug, 'fixture-%'));
const EMAIL = 'kunde@askmetry.test';
const old = await db.select({ id: S.user.id }).from(S.user).where(eq(S.user.email, EMAIL));
if (old[0]) await db.delete(S.user).where(eq(S.user.id, old[0].id));

// --- Nutzer
const password = randomBytes(12).toString('base64url');
const userId = randomUUID().replace(/-/g, '');
await db.insert(S.user).values({ id: userId, email: EMAIL, name: 'Kundin Test', emailVerified: true });
await db.insert(S.account).values({ id: randomUUID().replace(/-/g, ''), accountId: userId, providerId: 'credential', userId, password: await hashPassword(password) });
const credFile = process.env.FIXTURE_CREDENTIALS ?? path.resolve(here, '../.dev-hosted-credentials');
writeFileSync(credFile, `# Nur lokale Entwicklung\nE2E_EMAIL=${EMAIL}\nE2E_PASSWORD=${password}\n`, { mode: 0o600 });

/** Workspace kopieren: Marken, Themen, Fragen, Maßnahmen; mit `measurements` auch die letzte fertige Messung samt Antworten. */
async function copyWorkspace(slug: string, name: string, hostedKind: 'check' | 'customer', measurements: boolean, promptLimit?: number) {
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(S.workspace).values({ name, slug, hostedKind, language: src.language, country: src.country, engines: src.engines, repetitions: src.repetitions, scheduleEnabled: false }).returning();
    const W = ws!.id;
    const q = (s: string) => tx.execute(sql.raw(s));
    const s = `'${src.id}'`;
    await q(`create temp table m_brand on commit drop as select id old, gen_random_uuid() new from brand where workspace_id=${s}`);
    await q(`insert into brand (id, workspace_id, name, aliases, domains, is_own, description, kind, profile_source, profile_checked_at, logo_data, logo_type, logo_updated_at)
      select m.new, '${W}', name, aliases, domains, is_own, description, kind, profile_source, profile_checked_at, logo_data, logo_type, logo_updated_at from brand b join m_brand m on m.old=b.id`);
    await q(`create temp table m_topic on commit drop as select id old, gen_random_uuid() new from topic where workspace_id=${s}`);
    await q(`insert into topic (id, workspace_id, name) select m.new, '${W}', name from topic t join m_topic m on m.old=t.id`);
    await q(`create temp table m_prompt on commit drop as select id old, gen_random_uuid() new from (select id from prompt where workspace_id=${s} order by created_at ${promptLimit ? `limit ${promptLimit}` : ''}) x`);
    await q(`insert into prompt (id, workspace_id, topic_id, text, language, country, tags, active, created_at)
      select m.new, '${W}', mt.new, text, language, country, tags, active, p.created_at from prompt p join m_prompt m on m.old=p.id left join m_topic mt on mt.old=p.topic_id`);
    let collectionId: string | null = null;
    if (measurements) {
      await q(`create temp table m_col on commit drop as select id old, gen_random_uuid() new from (select id from collection where workspace_id=${s} and status='done' order by finished_at desc limit 1) x`);
      await q(`insert into collection (id, workspace_id, status, trigger, cost_usd, started_at, finished_at, created_at, plan)
        select m.new, '${W}', status, trigger, cost_usd, started_at, finished_at, c.created_at, plan from collection c join m_col m on m.old=c.id`);
      await q(`create temp table m_run on commit drop as select r.id old, gen_random_uuid() new from run r join m_col c on c.old=r.collection_id join m_prompt p on p.old=r.prompt_id`);
      await q(`insert into run (id, collection_id, workspace_id, prompt_id, engine, model, repetition, status, attempts, cost_usd, started_at, finished_at, created_at)
        select m.new, mc.new, '${W}', mp.new, engine, model, repetition, status, attempts, cost_usd, started_at, finished_at, r.created_at
        from run r join m_run m on m.old=r.id join m_col mc on mc.old=r.collection_id join m_prompt mp on mp.old=r.prompt_id`);
      await q(`create temp table m_resp on commit drop as select x.id old, gen_random_uuid() new from response x join m_run m on m.old=x.run_id`);
      await q(`insert into response (id, run_id, workspace_id, answer, answer_type, no_ai_answer, usage, raw, created_at, analyzed)
        select m.new, mr.new, '${W}', answer, answer_type, no_ai_answer, usage, null, x.created_at, analyzed from response x join m_resp m on m.old=x.id join m_run mr on mr.old=x.run_id`);
      await q(`insert into mention (response_id, workspace_id, brand_id, name, position, sentiment, recommended, snippet, is_competitor)
        select mr.new, '${W}', mb.new, name, position, sentiment, recommended, snippet, is_competitor from mention x join m_resp mr on mr.old=x.response_id left join m_brand mb on mb.old=x.brand_id`);
      await q(`insert into citation (response_id, workspace_id, url, domain, title, position, kind)
        select mr.new, '${W}', url, domain, title, position, kind from citation x join m_resp mr on mr.old=x.response_id`);
      collectionId = String(((await q(`select new from m_col`)) as unknown as { rows: { new: string }[] }).rows[0]?.new ?? '') || null;
    }
    await q(`insert into recommendation (workspace_id, key, type, title, why, steps, impact, effort, priority, evidence, active, status, generation_cost_usd, first_seen_at, last_seen_at, done_steps)
      select '${W}', key, type, title, why, steps, impact, effort, priority, evidence, active, 'open', 0, first_seen_at, last_seen_at, '{}' from recommendation where workspace_id=${s} and active`);
    return { id: W, collectionId };
  });
}

// --- Schnell-Checks in allen Zuständen
const checkWs = await copyWorkspace('fixture-check', 'Fixture Check', 'check', false, 10);
const recs = await db.select({ id: S.recommendation.id, type: S.recommendation.type }).from(S.recommendation).where(eq(S.recommendation.workspaceId, checkWs.id));
const area = (t: string) => (t === 'outreach' ? 'other_sites' : t === 'community' ? 'community' : t === 'technical' ? 'technical' : 'own_content');
const counts = { own_content: 0, other_sites: 0, community: 0, technical: 0 } as Record<string, number>;
for (const r of recs) counts[area(r.type)]!++;
const free = [recs.find((r) => r.type === 'technical') ?? recs.find((r) => area(r.type) === 'own_content'), recs.find((r) => r.type === 'outreach')].filter(Boolean).map((r) => r!.id).slice(0, 2);
const own = (await db.select().from(S.brand).where(eq(S.brand.workspaceId, checkWs.id))).find((b) => b.isOwn)!;
const summary = {
  brand: { name: own.name, domain: own.domains[0] ?? 'example.com', description: own.description },
  prompts: 10, promptsMentioned: 3, responses: 35, visibility: 4 / 35,
  topCompetitor: { name: 'SumUp', promptsMentioned: 8 },
  competitors: [{ name: 'SumUp', promptsMentioned: 8 }, { name: 'Zettle', promptsMentioned: 6 }, { name: 'Payone', promptsMentioned: 4 }, { name: 'myPOS', promptsMentioned: 2 }],
  topDomains: [{ domain: 'kartenleservergleich.de', count: 9 }, { domain: 'reddit.com', count: 6 }, { domain: 'sumup.com', count: 5 }],
  engines: [{ engine: 'gemini', responses: 10, mentioned: 1 }, { engine: 'google_aio', responses: 10, mentioned: 2 }, { engine: 'google_ai_mode', responses: 10, mentioned: 1 }, { engine: 'chatgpt', responses: 5, mentioned: 0 }],
  recommendationCounts: counts, recommendationsTotal: recs.length, freeRecommendationIds: free,
  technical: { robotsBlocksAi: false, jsOnly: false },
};
const domain = own.domains[0] ?? 'paylindo.de';
const base = { url: `https://${domain}/`, domain, locale: 'de' };
const rows: (typeof S.checkRequest.$inferInsert)[] = [
  { ...base, token: 'fixture-discovering-a', status: 'discovering' },
  { ...base, token: 'fixture-discovering-b', status: 'discovering', workspaceId: checkWs.id },
  { ...base, token: 'fixture-awaiting-0000', status: 'awaiting_email', workspaceId: checkWs.id },
  { ...base, token: 'fixture-awaiting-sent', status: 'awaiting_email', workspaceId: checkWs.id, email: EMAIL, verifySentAt: new Date() },
  { ...base, token: 'fixture-queued-000000', status: 'queued', workspaceId: checkWs.id, email: EMAIL, emailVerifiedAt: new Date() },
  { ...base, token: 'fixture-measuring-000', status: 'measuring', workspaceId: checkWs.id, email: EMAIL, emailVerifiedAt: new Date() },
  { ...base, token: 'fixture-ready-0000000', status: 'ready', workspaceId: checkWs.id, email: EMAIL, emailVerifiedAt: new Date(), summary, readyAt: new Date() },
  { ...base, token: 'fixture-ready-en-0000', status: 'ready', locale: 'en', workspaceId: checkWs.id, email: EMAIL, emailVerifiedAt: new Date(), summary, readyAt: new Date() },
  { ...base, token: 'fixture-failed-000000', status: 'failed', error: 'unreachable' },
  { ...base, token: 'fixture-blocked-00000', status: 'blocked' },
];
await db.insert(S.checkRequest).values(rows);
const [readyCheck] = await db.select({ id: S.checkRequest.id }).from(S.checkRequest).where(eq(S.checkRequest.token, 'fixture-ready-0000000'));

// --- Kunden-Workspaces mit Berichten
const member = (wsId: string) => db.insert(S.workspaceMember).values({ workspaceId: wsId, userId, role: 'owner' });
const paidBase = { userId, amountCents: 7900, paymentProvider: 'fake', b2bConfirmedAt: new Date(), termsAcceptedAt: new Date(), termsVersion: '2026-11-05' };
const day = 86400_000;

// 1) fertiger Bericht mit Messdaten + PDF
const done = await copyWorkspace('fixture-kunde', `${own.name} (Fixture)`, 'customer', true);
await member(done.id);
const [r1] = await db.insert(S.report).values({ ...paidBase, workspaceId: done.id, tier: 'compact', status: 'ready', checkId: readyCheck!.id, collectionId: done.collectionId,
  paidAt: new Date(Date.now() - 2 * day), startedAt: new Date(Date.now() - 2 * day), readyAt: new Date(Date.now() - day), emailedAt: new Date(Date.now() - day), pdfGeneratedAt: new Date(Date.now() - day) }).returning();
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
await db.insert(S.reportFile).values({ reportId: r1!.id, data: pdf.toString('base64'), bytes: pdf.length });
await db.insert(S.report).values({ ...paidBase, workspaceId: done.id, tier: 'compact', kind: 'remeasure', status: 'canceled', amountCents: 3900, previousReportId: r1!.id });

// 2) bezahlt, wartet auf „Messung starten“ (+ eine offene Zahlung)
const prep = await copyWorkspace('fixture-kunde-neu', 'Neu GmbH (Fixture)', 'customer', false);
await member(prep.id);
await db.insert(S.report).values({ ...paidBase, workspaceId: prep.id, tier: 'compact', status: 'paid', paidAt: new Date() });
await db.insert(S.report).values({ ...paidBase, workspaceId: prep.id, tier: 'strategy', status: 'pending_payment', amountCents: 24900 });

// 3) misst gerade (Fortschritt aus Runs)
const meas = await copyWorkspace('fixture-kunde-misst', 'Misst AG (Fixture)', 'customer', false);
await member(meas.id);
const [col] = await db.insert(S.collection).values({ workspaceId: meas.id, status: 'running', trigger: 'manual', startedAt: new Date() }).returning();
const ps = await db.select({ id: S.prompt.id }).from(S.prompt).where(eq(S.prompt.workspaceId, meas.id));
const runs = ps.flatMap((p, i) => ['chatgpt', 'gemini', 'claude'].map((engine, j) => ({ collectionId: col!.id, workspaceId: meas.id, promptId: p.id, engine, status: ((i * 3 + j) % 3 === 0 ? 'pending' : 'done') as 'pending' | 'done' })));
if (runs.length) await db.insert(S.run).values(runs);
await db.insert(S.report).values({ ...paidBase, workspaceId: meas.id, tier: 'compact', status: 'measuring', collectionId: col!.id, paidAt: new Date(), startedAt: new Date() });

console.log(`Fixture fertig (Quelle ${srcSlug}). Checks: ${rows.map((r) => r.token).join(', ')}`);
console.log('Workspaces: fixture-kunde (fertig), fixture-kunde-neu (bezahlt), fixture-kunde-misst (misst). Zugang: siehe Credentials-Datei.');
await closeDb();
