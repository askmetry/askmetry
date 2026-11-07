// Gehostete Version gegen askmetry_test: Check-Durchlauf, Limits/Cache/Budgets, Berichte, Erinnerung, Opt-out,
// Konto löschen, Löschfristen. Mock-Engines, Fake-Discovery, Mail-Outbox im Temp-Ordner, Fake-PDF.
import {
  brand, checkRequest, closeDb, collection, db, funnelEvent, prompt, recommendation, recommendationGeneration, report,
  run, session, topic, user, workspace, workspaceMember,
} from '@askmetry/db';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteUserData } from '../../src/hosted/account.ts';
import { checksWaiting, getCheckView, hasVisibleProgress, markCheckProgressSeen, processCheckReminders, processChecks, QUEUED_STALE_MS, startCheck, submitCheckEmail, trackCheckoutOpened, verifyCheckEmail } from '../../src/hosted/checks.ts';
import { editCheckQuestions, editCheckTopics } from '../../src/hosted/check-edit.ts';
import { CHECK_CONSENT_VERSION, CHECK_SCOPE } from '../../src/hosted/config.ts';
import { canStartMeasurement, checkReservedUsd, checkSpendToday, DISCOVERY_ESTIMATE_USD, globalSpendToday } from '../../src/hosted/limits.ts';
import { decodeOptOutParam, isOptedOut, optOut, verifyOptOut } from '../../src/hosted/optout.ts';
import { attachCheckoutSession, AUTOSTART_SINCE, autoStartReport, getReport, getReportPdf, markReportCanceled, markReportPaid, markReportRefunded, prepareReport, processReports, reportsForWorkspace, startReport } from '../../src/hosted/reports.ts';
import { purgeExpiredData } from '../../src/hosted/retention.ts';
import { funnelStats } from '../../src/hosted/stats.ts';
import { createCollection, parseCollectionPlan, processCollection } from '../../src/runner.ts';
import { createDueScheduledCollections } from '../../src/scheduler.ts';

const P = 'ithosted';
let outbox: string;
const fakePdf = async (id: string) => Buffer.from(`%PDF-1.4 fake ${id}`);
const DAY = 24 * 3600_000;

type Mail = { to: string; subject: string; text: string; links: string[]; attachments: { filename: string; bytes: number }[] };
function mails(to?: string): Mail[] {
  return readdirSync(outbox).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as Mail).filter((m) => !to || m.to === to);
}
const linkWith = (m: Mail, part: string) => m.links.find((l) => l.includes(part)) ?? m.text.match(new RegExp(`https?://\\S*${part}\\S*`))?.[0];

async function cleanup() {
  const ws = await db.select({ id: workspace.id }).from(workspace).where(sql`${workspace.id} in (select workspace_id from check_request where domain like ${`${P}%`}) or ${workspace.name} ilike ${`${P}%`} or ${workspace.slug} like ${`${P}%`}`);
  await db.delete(report).where(like(report.userId, `${P}%`));
  if (ws.length) await db.delete(workspace).where(inArray(workspace.id, ws.map((w) => w.id)));
  await db.delete(checkRequest).where(like(checkRequest.domain, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
}

async function addUser(id: string) {
  await db.insert(user).values({ id: `${P}-${id}`, name: id, email: `${id}@${P}-kunde.de`, emailVerified: true });
  return `${P}-${id}`;
}

beforeAll(async () => {
  outbox = mkdtempSync(path.join(os.tmpdir(), 'askmetry-outbox-'));
  process.env.ASKMETRY_MAIL_OUTBOX = outbox;
  process.env.ASKMETRY_PUBLIC_URL = 'http://localhost:3010';
  process.env.ASKMETRY_HOSTED = '1';
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await closeDb();
  rmSync(outbox, { recursive: true, force: true });
});
beforeEach(() => {
  for (const k of ['TURNSTILE_SECRET_KEY', 'ASKMETRY_CHECKS_ENABLED', 'ASKMETRY_CHECK_LIMIT_PER_IP', 'ASKMETRY_CHECK_LIMIT_PER_EMAIL', 'ASKMETRY_CHECK_DAILY_BUDGET_USD', 'ASKMETRY_GLOBAL_DAILY_BUDGET_USD', 'ASKMETRY_CHECK_DISCOVERIES_PER_HOUR']) delete process.env[k];
});

const tokenOf = (r: { token: string } | { error: string }) => { if (!('token' in r)) throw new Error(`erwartet Token, bekam ${r.error}`); return r.token; };
const row = async (token: string) => (await db.select().from(checkRequest).where(eq(checkRequest.token, token)))[0];

/** Check bis „ready“ durchlaufen lassen (Mock-Messung direkt abarbeiten) – ohne E-Mail, wie im Produkt. */
async function runCheck(domain: string, _email?: string, ipHash = `${P}-ip-${domain}`): Promise<string> {
  const token = tokenOf(await startCheck({ url: `https://www.${domain}/`, locale: 'de', ipHash }));
  await processChecks();
  const c = await row(token);
  expect(c.status).toBe('measuring');
  await processCollection(c.collectionId!, { retryDelayMs: 1 });
  // Maßnahmen sind direkt nach Abschluss berechnet; ohne Maßnahme wartet der Check kurz → Zeitpunkt zurückdatieren
  await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, c.collectionId!));
  await processChecks();
  expect((await row(token)).status).toBe('ready');
  return token;
}

describe('Schnell-Check', () => {
  let token: string;
  const domain = `${P}-paylindo.de`;
  const email = `max@${P}-firma.de`;

  it('startCheck: URL prüfen, Notschalter, Token', async () => {
    expect(await startCheck({ url: 'http://localhost:3000', locale: 'de', ipHash: `${P}-ip-n1` })).toEqual({ error: 'invalid_url' });
    process.env.ASKMETRY_CHECKS_ENABLED = '0';
    expect(await startCheck({ url: domain, locale: 'de', ipHash: `${P}-ip-n2` })).toEqual({ error: 'disabled' });
    delete process.env.ASKMETRY_CHECKS_ENABLED;
    token = tokenOf(await startCheck({ url: `www.${domain}/irgendwas`, locale: 'de', ipHash: `${P}-ip-main` }));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = await row(token);
    expect(c).toMatchObject({ status: 'discovering', domain, url: `https://www.${domain}/`, ipHash: `${P}-ip-main` });
  });

  it('Limit je IP (24 h)', async () => {
    process.env.ASKMETRY_CHECK_LIMIT_PER_IP = '2';
    const ip = `${P}-ip-limit`;
    tokenOf(await startCheck({ url: `${P}-a.de`, locale: 'de', ipHash: ip }));
    tokenOf(await startCheck({ url: `${P}-b.de`, locale: 'de', ipHash: ip }));
    expect(await startCheck({ url: `${P}-c.de`, locale: 'de', ipHash: ip })).toEqual({ error: 'rate_limited' });
    expect('token' in (await startCheck({ url: `${P}-c.de`, locale: 'de', ipHash: `${P}-ip-other` }))).toBe(true);
  });

  it('ohne IP gemeinsam gezählt; Stundengrenze neuer Discoveries', async () => {
    process.env.ASKMETRY_CHECK_LIMIT_PER_IP = '1';
    tokenOf(await startCheck({ url: `${P}-noip-1.de`, locale: 'de', ipHash: null }));
    expect(await startCheck({ url: `${P}-noip-2.de`, locale: 'de', ipHash: null })).toEqual({ error: 'rate_limited' });
    process.env.ASKMETRY_CHECK_DISCOVERIES_PER_HOUR = '1';
    expect(await startCheck({ url: `${P}-hour.de`, locale: 'de', ipHash: `${P}-ip-hour` })).toEqual({ error: 'rate_limited' });
  });

  it('gleichzeitige Anfragen überschreiten Limit je IP und Stundengrenze nicht (Advisory-Locks)', async () => {
    process.env.ASKMETRY_CHECK_LIMIT_PER_IP = '2';
    const ip = `${P}-ip-race`;
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) => startCheck({ url: `${P}-race-${i}.de`, locale: 'de', ipHash: ip })));
    expect(res.filter((r) => 'token' in r)).toHaveLength(2);
    expect(res.filter((r) => 'error' in r && r.error === 'rate_limited')).toHaveLength(4);
    process.env.ASKMETRY_CHECK_LIMIT_PER_IP = '10';
    const lastHour = await db.$count(checkRequest, sql`${checkRequest.reusedFromId} is null and ${checkRequest.createdAt} >= now() - interval '1 hour'`);
    process.env.ASKMETRY_CHECK_DISCOVERIES_PER_HOUR = String(lastHour + 1);
    const res2 = await Promise.all(Array.from({ length: 5 }, (_, i) => startCheck({ url: `${P}-race-h${i}.de`, locale: 'de', ipHash: `${P}-ip-race-h${i}` })));
    expect(res2.filter((r) => 'token' in r)).toHaveLength(1);
  });

  it('Website nicht erreichbar → unreachable (Prüfung über safe-fetch)', async () => {
    const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
    const transport = async () => ({ status: 503, headers: {}, body: (async function* () { yield ''; })(), destroy() {} });
    expect(await startCheck({ url: `${P}-down.de`, locale: 'de', ipHash: `${P}-ip-down` }, { reachability: true, resolve, transport })).toEqual({ error: 'unreachable' });
    expect(await startCheck({ url: `${P}-intern.de`, locale: 'de', ipHash: `${P}-ip-down2` }, { reachability: true, resolve: async () => [{ address: '192.168.1.1', family: 4 as const }] })).toEqual({ error: 'unreachable' });
  });

  it('Turnstile: mit Schlüssel ohne gültiges Token kein Check', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    expect(await startCheck({ url: `${P}-bot.de`, locale: 'de', ipHash: `${P}-ip-bot` })).toEqual({ error: 'bot_check_failed' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: false })));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await startCheck({ url: `${P}-bot.de`, locale: 'de', ipHash: `${P}-ip-bot` }, { turnstileToken: 'falsch', ip: '203.0.113.9' })).toEqual({ error: 'bot_check_failed' });
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true })));
      expect('token' in (await startCheck({ url: `${P}-bot.de`, locale: 'de', ipHash: `${P}-ip-bot` }, { turnstileToken: 'gut' }))).toBe(true);
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('challenges.cloudflare.com');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Discovery legt Check-Arbeitsbereich ohne Mitglieder an und startet die Messung sofort (ohne E-Mail)', async () => {
    const before = await getCheckView(token);
    expect(before!.progress).toMatchObject({ stage: 'read', engines: [], competitors: 0 });
    const stages: string[] = [];
    await processChecks({ discovery: { onProgress: (p) => { stages.push(p.stage); } } });
    // Mock: Website lesen entfällt, die übrigen Zwischenstände werden gemeldet (alle wartenden Checks laufen parallel)
    expect(new Set(stages)).toEqual(new Set(['profile', 'plan']));
    const c = await row(token);
    expect(c.status).toBe('measuring');
    expect(c.emailVerifiedAt).toBeNull();
    expect(c.progress).toMatchObject({ queuedAt: expect.any(String) });
    expect(c.progress).not.toHaveProperty('stage');
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, c.workspaceId!));
    expect(ws).toMatchObject({ hostedKind: 'check', scheduleEnabled: false, monthlyBudgetUsd: '3.00' });
    expect(await db.$count(workspaceMember, eq(workspaceMember.workspaceId, ws.id))).toBe(0);
    expect(await db.$count(prompt, eq(prompt.workspaceId, ws.id))).toBe(20);
    expect(await db.$count(brand, eq(brand.workspaceId, ws.id))).toBe(6);
    const v = (await getCheckView(token))!;
    expect(v.progress).toMatchObject({ stage: null, brandName: `${P[0].toUpperCase()}${P.slice(1)}-paylindo`, competitors: 5, prompts: CHECK_SCOPE.measured, analyzing: false, recommending: false });
    expect(v.progress.engines).toEqual([
      { engine: 'gemini', done: 0, total: 8 }, { engine: 'google_aio', done: 0, total: 8 },
      { engine: 'google_ai_mode', done: 0, total: 8 }, { engine: 'chatgpt', done: 0, total: 4 },
    ]);
    expect(v.summary).toBeNull();
    // Zwischenstände für die Warteansicht: Wettbewerber und die gemessenen Fragen (sonst nichts aus dem Ergebnis)
    expect(v.live).toMatchObject({ competitors: ['Alpha Solutions', 'Beta Solutions', 'Gamma Solutions', 'Delta Solutions', 'Epsilon Solutions'], answers: [], answersTotal: 0 });
    expect(v.live!.questions).toHaveLength(CHECK_SCOPE.measured);
    expect(v.live!.questions[0]).toContain('kleine Unternehmen');
    expect(v).toMatchObject({ findings: null, questions: null, topics: [], editable: false });
    // Themenvorschläge der Discovery am Check gespeichert
    expect(c.topics).toEqual(['Auswahl', 'Kosten', 'Vergleich', 'Einrichtung', 'Service']);
  });

  it('Benachrichtigung per Mail (optional): Prüfung, Code nur gehasht, erneutes Senden frühestens nach 60 s', async () => {
    expect(await submitCheckEmail(token, 'kein-mail')).toEqual({ error: 'invalid_email' });
    expect(await submitCheckEmail('x'.repeat(43), email)).toEqual({ error: 'not_found' });
    expect(await submitCheckEmail(token, email)).toEqual({ ok: true });
    expect(await submitCheckEmail(token, email)).toEqual({ error: 'rate_limited' });
    const m = mails(email).at(-1)!;
    const code = new URL(linkWith(m, '/bestaetigen')!).searchParams.get('code')!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = await row(token);
    expect(c.verifyCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(c)).not.toContain(code);
    expect((await getCheckView(token))!.emailMasked).toBe(`m***@${P}-firma.de`);

    expect(await verifyCheckEmail(token, 'falsch')).toEqual({ error: 'code_invalid' });
    await db.update(checkRequest).set({ verifySentAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(checkRequest.id, c.id));
    expect(await verifyCheckEmail(token, code)).toEqual({ error: 'code_expired' });
    // erneut senden (nach Ablauf) → neuer Code, alter ungültig
    expect(await submitCheckEmail(token, email)).toEqual({ ok: true });
    const code2 = new URL(linkWith(mails(email).at(-1)!, '/bestaetigen')!).searchParams.get('code')!;
    expect(await verifyCheckEmail(token, code)).toEqual({ error: 'code_invalid' });
    expect(await verifyCheckEmail(token, code2)).toEqual({ ok: true });
    expect(await verifyCheckEmail(token, code2)).toEqual({ ok: true }); // zweiter Klick
    // Bestätigung ändert am Ablauf nichts – die Messung läuft ohnehin
    expect((await row(token))).toMatchObject({ status: 'measuring' });
    expect((await row(token)).emailVerifiedAt).not.toBeNull();
    expect(await submitCheckEmail(token, email)).toEqual({ error: 'wrong_state' });
  });

  it('Messung mit Check-Plan → ready mit Summary, Fertig-Mail, gesperrte Maßnahmen nicht in der Ansicht', async () => {
    const c = await row(token);
    expect(c.status).toBe('measuring');
    const [col] = await db.select().from(collection).where(eq(collection.id, c.collectionId!));
    const plan = parseCollectionPlan(col.plan);
    expect(plan).toMatchObject({
      engines: ['gemini', 'google_aio', 'google_ai_mode', 'chatgpt'], repetitions: 1, engineMaxPrompts: { chatgpt: 4 },
      concurrency: CHECK_SCOPE.concurrency,
    });
    expect(plan.promptIds).toHaveLength(8);
    await processCollection(col.id, { retryDelayMs: 1 });
    const mid = (await getCheckView(token))!;
    expect(mid.progress.engines.every((e) => e.done === e.total)).toBe(true);
    // live: neueste Antworten mit KI, Frage und genannten Marken (eigene markiert), kein Antworttext
    expect(mid.live!.answersTotal).toBe(28);
    expect(mid.live!.answers).toHaveLength(6);
    for (const a of mid.live!.answers) {
      expect(mid.live!.questions).toContain(a.question);
      expect(CHECK_SCOPE.engines).toContain(a.engine);
      expect(a.ownNamed).toBe(a.brands.some((b) => b.own));
      expect(a).not.toHaveProperty('answer');
    }
    expect(mid.progress.analyzing || mid.progress.recommending).toBe(true);
    await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, col.id));
    await processChecks();
    const done = await row(token);
    expect(done.status).toBe('ready');
    const view = (await getCheckView(token))!;
    const s = view.summary!;
    expect(s.prompts).toBe(8);
    expect(s.responses).toBeGreaterThan(20);
    expect(s.brand.name).toBe(`${P[0].toUpperCase()}${P.slice(1)}-paylindo`);
    expect(s.promptsMentioned).toBeLessThanOrEqual(8);
    expect(view.progress.engines).toEqual([]);
    const recs = await db.select().from(recommendation).where(and(eq(recommendation.workspaceId, done.workspaceId!), eq(recommendation.active, true)));
    expect(recs.length).toBeGreaterThan(1);
    expect(s.recommendationsTotal).toBe(recs.length);
    expect(view.freeRecommendations).toHaveLength(1);
    expect(view.freeRecommendations.map((r) => r.id)).toEqual(s.freeRecommendationIds);
    const json = JSON.stringify(view);
    for (const r of recs.filter((x) => !s.freeRecommendationIds.includes(x.id))) {
      expect(json).not.toContain(r.title);
      expect(json).not.toContain(r.why);
    }
    expect(json).not.toContain(email);
    // Fertig-Mail mit Teaser-Link (Adresse wurde bestätigt)
    const ready = mails(email).at(-1)!;
    expect(linkWith(ready, `/check/${token}`)).toBeTruthy();
    expect(done.readyMailSentAt).not.toBeNull();
    await processChecks();
    expect(mails(email).filter((m) => m.subject === ready.subject)).toHaveLength(1);
  });

  it('ohne bestätigte Adresse keine Fertig-Mail; Bestätigung nach dem Fertigwerden holt sie nach', async () => {
    const t = await runCheck(`${P}-spaet.de`);
    expect((await row(t)).readyMailSentAt).toBeNull();
    expect(await submitCheckEmail(t, `spaet@${P}-firma.de`)).toEqual({ error: 'wrong_state' }); // fertig: kein Formular mehr
    // Adresse während der Messung angegeben, Link erst nach dem Fertigwerden geklickt
    const t2 = tokenOf(await startCheck({ url: `${P}-spaet2.de`, locale: 'de', ipHash: `${P}-ip-spaet2` }));
    const who = `spaet2@${P}-firma.de`;
    expect(await submitCheckEmail(t2, who)).toEqual({ ok: true });
    await processChecks();
    const c2 = await row(t2);
    await processCollection(c2.collectionId!, { retryDelayMs: 1 });
    await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, c2.collectionId!));
    await processChecks();
    expect((await row(t2)).status).toBe('ready');
    expect(mails(who)).toHaveLength(1); // nur die Bestätigungsmail
    const code = new URL(linkWith(mails(who)[0], '/bestaetigen')!).searchParams.get('code')!;
    expect(await verifyCheckEmail(t2, code)).toEqual({ ok: true });
    // Fertig-Mail direkt beim Bestätigen, nicht doppelt durch den Worker
    expect(mails(who)).toHaveLength(2);
    await processChecks();
    expect(mails(who)).toHaveLength(2);
    expect(linkWith(mails(who)[1], `/check/${t2}`)).toBeTruthy();
  });

  it('Altbestand awaiting_email: Bestätigung reiht wie früher ein', async () => {
    const [c] = await db.insert(checkRequest).values({ token: `${P}-legacy-${'x'.repeat(30)}`, url: `https://${P}-legacy.de/`, domain: `${P}-legacy.de`, status: 'awaiting_email', workspaceId: (await row(token)).workspaceId }).returning();
    expect(await submitCheckEmail(c.token, `alt@${P}-firma.de`)).toEqual({ ok: true });
    const code = new URL(linkWith(mails(`alt@${P}-firma.de`).at(-1)!, '/bestaetigen')!).searchParams.get('code')!;
    expect(await verifyCheckEmail(c.token, code)).toEqual({ ok: true });
    expect((await row(c.token)).status).toBe('queued');
    await db.update(checkRequest).set({ status: 'failed' }).where(eq(checkRequest.id, c.id));
  });

  it('30-Tage-Cache je Domain: neuer Check sofort fertig (ohne E-Mail, ohne neue Messung)', async () => {
    const orig = await row(token);
    const before = mails().length;
    const t2 = tokenOf(await startCheck({ url: `https://${orig.domain}`, locale: 'de', ipHash: `${P}-ip-n3` }));
    const c2 = await row(t2);
    expect(c2).toMatchObject({ status: 'ready', reusedFromId: orig.id, workspaceId: orig.workspaceId, collectionId: orig.collectionId });
    const v = (await getCheckView(t2))!;
    expect(v.status).toBe('ready');
    expect(v.summary).toEqual(orig.summary);
    expect(v.freeRecommendations).toHaveLength(1);
    await processChecks();
    expect(mails().length).toBe(before);
    // andere Sprache → kein Cache
    expect((await row(tokenOf(await startCheck({ url: orig.domain, locale: 'en', ipHash: `${P}-ip-n4` })))).status).toBe('discovering');
  });

  it('Limit je E-Mail', async () => {
    process.env.ASKMETRY_CHECK_LIMIT_PER_EMAIL = '1';
    const t = tokenOf(await startCheck({ url: `${P}-mail-limit.de`, locale: 'de', ipHash: `${P}-ip-n5` }));
    expect(await submitCheckEmail(t, email)).toEqual({ error: 'rate_limited' });
  });

  it('Tagesbudgets: Check-Budget und globales Budget sperren neue Checks und Messungen', async () => {
    const c = await row(token);
    const [g] = await db.insert(recommendationGeneration).values({ workspaceId: c.workspaceId!, model: 'test', costUsd: '5.0000' }).returning();
    try {
      expect(await globalSpendToday()).toBeGreaterThanOrEqual(5);
      process.env.ASKMETRY_CHECK_DAILY_BUDGET_USD = '4';
      expect(await startCheck({ url: `${P}-budget.de`, locale: 'de', ipHash: `${P}-ip-n6` })).toEqual({ error: 'disabled' });
      expect(await canStartMeasurement('check')).toEqual({ ok: false, reason: 'check_budget' });
      expect(await canStartMeasurement('report')).toEqual({ ok: true });
      delete process.env.ASKMETRY_CHECK_DAILY_BUDGET_USD;
      process.env.ASKMETRY_GLOBAL_DAILY_BUDGET_USD = '4';
      expect(await canStartMeasurement('report')).toEqual({ ok: false, reason: 'global_budget' });
      expect(await startCheck({ url: `${P}-budget.de`, locale: 'de', ipHash: `${P}-ip-n7` })).toEqual({ error: 'disabled' });
    } finally {
      await db.delete(recommendationGeneration).where(eq(recommendationGeneration.id, g.id));
    }
  });

  it('Altbestand awaiting_email ohne Klick: Ansicht wie eingereiht, Worker gibt ihn frei', async () => {
    const [c] = await db.insert(checkRequest).values({ token: `${P}-legacy2-${'x'.repeat(30)}`, url: `https://${P}-legacy2.de/`, domain: `${P}-legacy2.de`, status: 'awaiting_email', workspaceId: (await row(token)).workspaceId }).returning();
    try {
      expect((await getCheckView(c.token))!.status).toBe('queued');
      await processChecks();
      const r = await row(c.token);
      expect(r.status).toBe('queued');
      expect(r.progress).toMatchObject({ queuedAt: expect.any(String) });
    } finally {
      await db.update(checkRequest).set({ status: 'failed' }).where(eq(checkRequest.id, c.id));
      const [active] = await db.select().from(collection).where(and(eq(collection.workspaceId, c.workspaceId!), inArray(collection.status, ['queued', 'running'])));
      if (active) await db.delete(collection).where(eq(collection.id, active.id));
    }
  });

  it('eingereiht ohne Messung (Budget): nach 15 min blocked, Berichte warten nicht mehr', async () => {
    const wsId = (await row(token)).workspaceId!;
    const old = new Date(Date.now() - QUEUED_STALE_MS - 60_000).toISOString();
    const [stale] = await db.insert(checkRequest).values({ token: `${P}-stale-${'x'.repeat(30)}`, url: `https://${P}-stale.de/`, domain: `${P}-stale.de`, status: 'queued', workspaceId: wsId, progress: { queuedAt: old } }).returning();
    const [fresh] = await db.insert(checkRequest).values({ token: `${P}-fresh-${'x'.repeat(30)}`, url: `https://${P}-fresh.de/`, domain: `${P}-fresh.de`, status: 'queued', workspaceId: wsId, progress: { queuedAt: new Date().toISOString() } }).returning();
    const [g] = await db.insert(recommendationGeneration).values({ workspaceId: wsId, model: 'test', costUsd: '5.0000' }).returning();
    process.env.ASKMETRY_CHECK_DAILY_BUDGET_USD = '4';
    try {
      expect(await checksWaiting()).toBe(true);
      await processChecks();
      expect(await row(stale.token)).toMatchObject({ status: 'blocked', collectionId: null });
      expect((await row(stale.token)).error).toMatch(/^disabled\|/);
      expect((await getCheckView(stale.token))!.error).toBe('disabled');
      expect((await row(fresh.token)).status).toBe('queued');
      await processChecks(); // zweiter Durchgang: bleibt blocked, keine zweite Meldung nötig
      expect((await row(stale.token)).status).toBe('blocked');
    } finally {
      await db.delete(recommendationGeneration).where(eq(recommendationGeneration.id, g.id));
      await db.update(checkRequest).set({ status: 'failed' }).where(inArray(checkRequest.id, [stale.id, fresh.id]));
    }
  });

  it('Fertig-Mail: gleichzeitige Durchgänge senden nur einmal; Versandfehler gibt den Anspruch zurück', async () => {
    const t = await runCheck(`${P}-claim.de`);
    const who = `claim@${P}-firma.de`;
    await db.update(checkRequest).set({ email: who, emailVerifiedAt: new Date() }).where(eq(checkRequest.token, t));
    const prevOutbox = process.env.ASKMETRY_MAIL_OUTBOX;
    // Outbox unterhalb einer Datei → Schreiben schlägt fehl (ENOTDIR)
    const blocker = path.join(outbox, 'keine-outbox.txt');
    writeFileSync(blocker, 'x');
    process.env.ASKMETRY_MAIL_OUTBOX = path.join(blocker, 'sub');
    try {
      await processChecks();
    } finally {
      process.env.ASKMETRY_MAIL_OUTBOX = prevOutbox;
    }
    expect((await row(t)).readyMailSentAt).toBeNull();
    await Promise.all([processChecks(), processChecks(), processChecks()]);
    expect(mails(who)).toHaveLength(1);
    expect((await row(t)).readyMailSentAt).not.toBeNull();
  });

  it('Tagesbudget reserviert Kosten laufender Checks (offene Runs + Discoveries)', async () => {
    const wsId = (await row(token)).workspaceId!;
    const prevMock = process.env.ASKMETRY_MOCK_ENGINES;
    // nur Budget-Abfragen ohne Mock (keine Engine-Aufrufe): Schätzkosten statt 0
    process.env.ASKMETRY_MOCK_ENGINES = '0';
    let colId: string | null = null;
    const [disc] = await db.insert(checkRequest).values({ token: `${P}-resv-${'x'.repeat(30)}`, url: `https://${P}-resv.de/`, domain: `${P}-resv.de`, status: 'discovering' }).returning();
    try {
      const base = await checkReservedUsd();
      expect(base).toBeGreaterThanOrEqual(DISCOVERY_ESTIMATE_USD);
      const ps = await db.select({ id: prompt.id }).from(prompt).where(eq(prompt.workspaceId, wsId)).limit(CHECK_SCOPE.measured);
      colId = (await createCollection(wsId, 'manual', { promptIds: ps.map((p) => p.id), engines: CHECK_SCOPE.engines, repetitions: 1, engineMaxPrompts: CHECK_SCOPE.engineMaxPrompts })).id;
      const withRuns = await checkReservedUsd();
      // 8 × (Gemini 0,024 + 2 × Google 0,004) + 4 × ChatGPT 0,08 = 0,576 $
      expect(withRuns - base).toBeCloseTo(0.576, 6);
      const spend = await checkSpendToday();
      process.env.ASKMETRY_CHECK_DAILY_BUDGET_USD = String(spend + 0.3);
      // ohne Reserve wäre Platz (spend < Budget), mit Reserve nicht
      expect(await canStartMeasurement('check')).toEqual({ ok: false, reason: 'check_budget' });
      expect(await startCheck({ url: `${P}-resv2.de`, locale: 'de', ipHash: `${P}-ip-resv` })).toEqual({ error: 'disabled' });
      process.env.ASKMETRY_CHECK_DAILY_BUDGET_USD = String(spend + withRuns + 1);
      expect(await canStartMeasurement('check')).toEqual({ ok: true });
    } finally {
      process.env.ASKMETRY_MOCK_ENGINES = prevMock;
      if (colId) await db.delete(collection).where(eq(collection.id, colId));
      await db.delete(checkRequest).where(eq(checkRequest.id, disc.id));
    }
    expect(await checkReservedUsd()).toBe(0); // Mock-Modus
  });

  it('gehostete Arbeitsbereiche nie über den Zeitplan messen', async () => {
    const c = await row(token);
    await db.update(workspace).set({ scheduleEnabled: true, scheduleCron: '* * * * *', scheduleUpdatedAt: new Date(Date.now() - DAY) }).where(eq(workspace.id, c.workspaceId!));
    const created = await createDueScheduledCollections(new Date());
    const ours = created.length ? await db.select().from(collection).where(and(inArray(collection.id, created), eq(collection.workspaceId, c.workspaceId!))) : [];
    expect(ours).toHaveLength(0);
    await db.update(workspace).set({ scheduleEnabled: false }).where(eq(workspace.id, c.workspaceId!));
  });
});

describe('Berichte', () => {
  const base = { amountCents: 7900, b2bConfirmedAt: new Date(), termsAcceptedAt: new Date(), termsVersion: '2026-11-05', provider: 'fake' as const };
  let buyer: string, other: string, stranger: string;
  let checkToken: string;
  let reportId: string, wsId: string;

  it('prepareReport: jeder Käufer bekommt eine eigene Kopie ohne Messdaten, Check bleibt unverändert, Wettbewerber gekürzt', async () => {
    buyer = await addUser('buyer'); other = await addUser('other'); stranger = await addUser('stranger');
    checkToken = await runCheck(`${P}-shop.de`, `buyer@${P}-kunde.de`);
    const c = await row(checkToken);
    // Erstkauf zu einem unfertigen Check wird abgelehnt
    const pending = await row(tokenOf(await startCheck({ url: `${P}-unfertig.de`, locale: 'de', ipHash: `${P}-ip-n8` })));
    await expect(prepareReport({ ...base, userId: buyer, tier: 'compact', kind: 'initial', checkId: pending.id })).rejects.toThrow(/nicht fertig/);

    const r = await prepareReport({ ...base, userId: buyer, tier: 'compact', kind: 'initial', checkId: c.id });
    reportId = r.reportId; wsId = r.workspaceId;
    expect(wsId).not.toBe(c.workspaceId);
    // Check-Schnappschuss unverändert: weiterhin Check, ohne Mitglieder
    const [src] = await db.select().from(workspace).where(eq(workspace.id, c.workspaceId!));
    expect(src.hostedKind).toBe('check');
    expect(await db.$count(workspaceMember, eq(workspaceMember.workspaceId, src.id))).toBe(0);
    // vor der Zahlung: keine Messungen und keine Maßnahmen im Kunden-Arbeitsbereich
    expect(await db.$count(collection, eq(collection.workspaceId, wsId))).toBe(0);
    expect(await db.$count(recommendation, eq(recommendation.workspaceId, wsId))).toBe(0);
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, wsId));
    expect(ws).toMatchObject({ hostedKind: 'customer', repetitions: 2, scheduleEnabled: false, monthlyBudgetUsd: '40.00' });
    expect(ws.engines).toHaveLength(5);
    expect(await db.select({ role: workspaceMember.role }).from(workspaceMember).where(and(eq(workspaceMember.workspaceId, wsId), eq(workspaceMember.userId, buyer)))).toEqual([{ role: 'owner' }]);
    expect(await db.$count(brand, and(eq(brand.workspaceId, wsId), eq(brand.isOwn, false)))).toBe(3);

    // Doppelkauf: älterer offener Checkout wird abgebrochen
    const again = await prepareReport({ ...base, userId: buyer, tier: 'compact', kind: 'initial', checkId: c.id });
    expect((await db.select().from(report).where(eq(report.id, reportId)))[0].status).toBe('canceled');
    reportId = again.reportId;
    expect(again.workspaceId).toBe(wsId);

    const copy = await prepareReport({ ...base, userId: other, tier: 'strategy', kind: 'initial', checkId: c.id, amountCents: 24900 });
    expect(copy.workspaceId).not.toBe(wsId);
    expect(await db.$count(prompt, eq(prompt.workspaceId, copy.workspaceId))).toBe(20);
    expect(await db.$count(collection, eq(collection.workspaceId, copy.workspaceId))).toBe(0);
    const srcComps = await db.$count(brand, and(eq(brand.workspaceId, c.workspaceId!), eq(brand.isOwn, false)));
    expect(await db.$count(brand, and(eq(brand.workspaceId, copy.workspaceId), eq(brand.isOwn, false)))).toBe(Math.min(srcComps, 5));
    expect(await db.$count(workspaceMember, and(eq(workspaceMember.workspaceId, copy.workspaceId), eq(workspaceMember.userId, other)))).toBe(1);
  });

  it('markReportPaid idempotent, startet die Messung automatisch, doppelter Webhook → kein Doppelstart', async () => {
    await attachCheckoutSession(reportId, `${P}-sess-1`);
    expect(await markReportPaid({ sessionId: `${P}-sess-1`, paymentIntentId: `${P}-pi-1`, amountCents: 0 })).toEqual({ reportId, already: false });
    expect(await markReportPaid({ sessionId: `${P}-sess-1` })).toEqual({ reportId, already: true });
    expect(await markReportPaid({ sessionId: `${P}-unbekannt` })).toBeNull();
    const [r] = await db.select().from(report).where(eq(report.id, reportId));
    expect(r).toMatchObject({ status: 'measuring', amountCents: 0, paymentIntentId: `${P}-pi-1`, error: null });
    expect(r.startedAt).not.toBeNull();
    expect(await db.$count(collection, eq(collection.workspaceId, wsId))).toBe(1);
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.name, 'report_paid'), eq(funnelEvent.reportId, reportId)))).toBe(1);
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.name, 'report_autostarted'), eq(funnelEvent.reportId, reportId)))).toBe(1);
    // gleichzeitige Starts (Webhook + Worker): nur einer beansprucht den Bericht
    expect(await autoStartReport(reportId)).toEqual({ error: 'wrong_state' });
    await processReports({});
    expect(await db.$count(collection, eq(collection.workspaceId, wsId))).toBe(1);
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.name, 'report_autostart_failed'), eq(funnelEvent.reportId, reportId)))).toBe(0);
  });

  it('Abbruch nur bei pending_payment; bezahlt nach Abbruch → trotzdem paid', async () => {
    const r = await prepareReport({ ...base, userId: buyer, tier: 'strategy', kind: 'initial', workspaceId: wsId });
    await attachCheckoutSession(r.reportId, `${P}-sess-cancel`);
    await markReportCanceled(`${P}-sess-cancel`);
    expect((await getReport(r.reportId))!.status).toBe('canceled');
    expect((await reportsForWorkspace(wsId)).some((x) => x.id === r.reportId)).toBe(false);
    expect(await markReportPaid({ sessionId: `${P}-sess-cancel` })).toEqual({ reportId: r.reportId, already: false });
    await markReportRefunded(`${P}-pi-unbekannt`);
    // für die weiteren Tests wieder neutralisieren
    await db.update(report).set({ status: 'refunded' }).where(eq(report.id, r.reportId));
  });

  it('Auto-Start: Plan mit 20 Fragen × 2 × 5 KIs, Fortschritt je KI; Startknopf danach weder fremd noch doppelt', async () => {
    expect(await startReport(reportId, stranger)).toEqual({ error: 'forbidden' });
    await db.insert(workspaceMember).values({ workspaceId: wsId, userId: other, role: 'viewer' });
    expect(await startReport(reportId, other)).toEqual({ error: 'forbidden' });
    expect(await startReport(reportId, buyer)).toEqual({ error: 'wrong_state' });
    const v = (await getReport(reportId))!;
    expect(v.status).toBe('measuring');
    expect(v.buyerEmailMasked).toBe(`b***@${P}-kunde.de`);
    expect(v.progress!.total).toBe(20 * 2 * 5);
    expect(v.progress).toMatchObject({ done: 0, phase: 'queued', etaMinutes: null, onlyBatchLeft: false });
    expect(v.progress!.engines.map((e) => e.engine)).toEqual(['chatgpt', 'claude', 'gemini', 'google_aio', 'google_ai_mode']);
    expect(v.progress!.engines.every((e) => e.total === 40 && e.answered === 0 && !e.batch)).toBe(true); // Mock: Claude ohne Batch
    const [col] = await db.select().from(collection).where(eq(collection.id, v.collectionId!));
    expect(parseCollectionPlan(col.plan)).toMatchObject({ repetitions: 2, batch: true });
    expect(parseCollectionPlan(col.plan).promptIds).toHaveLength(20);
  });

  it('processReports: ohne PDF-Renderer wartet er, mit Fake-PDF → ready, PDF gespeichert, Mail mit Anhang', async () => {
    const v = (await getReport(reportId))!;
    await processCollection(v.collectionId!, { retryDelayMs: 1 });
    await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, v.collectionId!));
    await processReports({});
    expect((await getReport(reportId))!.status).toBe('measuring');
    await processReports({ renderPdf: fakePdf });
    const done = (await getReport(reportId))!;
    expect(done).toMatchObject({ status: 'ready', hasPdf: true });
    expect(done.emailedAt).not.toBeNull();
    expect((await getReportPdf(reportId))!.data.toString()).toBe(`%PDF-1.4 fake ${reportId}`);
    const m = mails(`buyer@${P}-kunde.de`).at(-1)!;
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0].filename).toMatch(/\.pdf$/);
    expect(linkWith(m, `/bericht/${reportId}`)).toBeTruthy();
    const [ev] = await db.select().from(funnelEvent).where(and(eq(funnelEvent.name, 'report_ready'), eq(funnelEvent.reportId, reportId)));
    expect(ev.props).toMatchObject({ tier: 'compact', paidToReadyMin: expect.any(Number), startedToReadyMin: expect.any(Number) });
  });

  it('Nachmessung: exakt die Prompt-IDs des Vorberichts, neue Fragen bleiben außen vor', async () => {
    const r = await prepareReport({ ...base, userId: buyer, tier: 'compact', kind: 'remeasure', workspaceId: wsId, amountCents: 3900 });
    const [rr] = await db.select().from(report).where(eq(report.id, r.reportId));
    expect(rr.previousReportId).toBe(reportId);
    await db.insert(prompt).values({ workspaceId: wsId, text: 'Neue Frage nach dem Bericht?' });
    await attachCheckoutSession(r.reportId, `${P}-sess-re`);
    await markReportPaid({ sessionId: `${P}-sess-re` });
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.name, 'remeasure_paid'), eq(funnelEvent.reportId, r.reportId)))).toBe(1);
    // Nachmessung startet ebenfalls automatisch
    expect((await getReport(r.reportId))!.status).toBe('measuring');
    const prev = (await getReport(reportId))!;
    const now = (await getReport(r.reportId))!;
    const [a] = await db.select().from(collection).where(eq(collection.id, prev.collectionId!));
    const [b] = await db.select().from(collection).where(eq(collection.id, now.collectionId!));
    expect(parseCollectionPlan(b.plan).promptIds).toEqual(parseCollectionPlan(a.plan).promptIds);
    await processCollection(b.id, { retryDelayMs: 1 });
    await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, b.id));
    await processReports({ renderPdf: fakePdf });
    expect((await getReport(r.reportId))!.status).toBe('ready');
  });

  it('Strategiebericht: nach Zahlung 40 Zusatzfragen in Themen, Start mit 60 Fragen', async () => {
    const [copyWs] = await db.select({ id: workspaceMember.workspaceId }).from(workspaceMember).where(and(eq(workspaceMember.userId, other), eq(workspaceMember.role, 'owner')));
    const [r] = await db.select().from(report).where(and(eq(report.workspaceId, copyWs.id), eq(report.tier, 'strategy')));
    await attachCheckoutSession(r.id, `${P}-sess-strat`);
    await markReportPaid({ sessionId: `${P}-sess-strat` });
    expect(await startReport(r.id, other)).toEqual({ error: 'preparing' });
    // erst die Zusatzfragen, dann startet der Worker die Messung automatisch
    expect((await getReport(r.id))!).toMatchObject({ status: 'paid', promptsPreparing: true, autoStarting: false, error: null });
    await processReports({ renderPdf: fakePdf });
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, copyWs.id), eq(prompt.active, true)))).toBe(60);
    const topics = await db.select().from(topic).where(eq(topic.workspaceId, copyWs.id));
    expect(topics.length).toBeGreaterThanOrEqual(4);
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, copyWs.id), sql`${prompt.topicId} is null`))).toBe(0);
    expect((await getReport(r.id))!.status).toBe('measuring');
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.name, 'report_autostarted'), eq(funnelEvent.reportId, r.id)))).toBe(1);
    const [col] = await db.select().from(collection).where(eq(collection.id, (await getReport(r.id))!.collectionId!));
    expect(parseCollectionPlan(col.plan).promptIds).toHaveLength(60);
    // Messung nicht ausführen – aufräumen
    await db.update(collection).set({ status: 'failed' }).where(eq(collection.id, col.id));
    await processReports({ renderPdf: fakePdf });
    expect((await getReport(r.id))!.status).toBe('failed');
  });

  it('Erinnerung nach 8 Wochen einmalig mit Abmeldelink; nach Opt-out keine Mail', async () => {
    // Bericht ohne neueren Kauf im Arbeitsbereich: eigener Kunde
    const u = await addUser('remind');
    const t = await runCheck(`${P}-erinnerung.de`, `remind@${P}-kunde.de`);
    const r = await prepareReport({ ...base, userId: u, tier: 'compact', kind: 'initial', checkId: (await row(t)).id });
    await db.update(report).set({ status: 'ready', readyAt: new Date(Date.now() - 57 * DAY), emailedAt: new Date(), pdfGeneratedAt: new Date() }).where(eq(report.id, r.reportId));
    const to = `remind@${P}-kunde.de`;
    const before = mails(to).length;
    await processReports({ renderPdf: fakePdf });
    const sent = mails(to);
    expect(sent.length).toBe(before + 1);
    const link = new URL(linkWith(sent.at(-1)!, '/abmelden')!);
    const e = decodeOptOutParam(link.searchParams.get('e'))!;
    expect(e).toBe(to);
    expect(verifyOptOut(e, link.searchParams.get('sig')!)).toBe(true);
    await processReports({ renderPdf: fakePdf });
    expect(mails(to).length).toBe(before + 1); // einmalig

    await optOut(e);
    expect(await isOptedOut(to.toUpperCase())).toBe(true);
    await db.update(report).set({ remindedAt: null }).where(eq(report.id, r.reportId));
    await processReports({ renderPdf: fakePdf });
    expect(mails(to).length).toBe(before + 1);
    expect((await db.select().from(report).where(eq(report.id, r.reportId)))[0].remindedAt).not.toBeNull();
  });

  it('Erinnerung entfällt, wenn schon nachgemessen wurde', async () => {
    await db.update(report).set({ readyAt: new Date(Date.now() - 60 * DAY), remindedAt: null }).where(eq(report.id, reportId));
    const before = mails(`buyer@${P}-kunde.de`).length;
    await processReports({ renderPdf: fakePdf });
    expect(mails(`buyer@${P}-kunde.de`).length).toBe(before);
  });

  it('funnelStats zählt Checks und Käufe', async () => {
    const s = await funnelStats({ days: 30 });
    expect(s.checksStarted).toBeGreaterThan(3);
    expect(s.checksVerified).toBeGreaterThan(1);
    expect(s.purchases).toBeGreaterThanOrEqual(2);
    expect(s.remeasurePurchases).toBeGreaterThanOrEqual(1);
    expect(s.conversionVerifiedToPurchase).toBeGreaterThan(0);
  });

  it('deleteUserData: eigene Arbeitsbereiche, Mitgliedschaften, Berichte, Sitzungen, Nutzer', async () => {
    await db.insert(session).values({ id: `${P}-s1`, token: `${P}-tok`, userId: buyer, expiresAt: new Date(Date.now() + DAY) });
    // other ist viewer in wsId und owner einer Kopie
    const res = await deleteUserData(other);
    expect(res.userDeleted).toBe(true);
    expect(res.workspacesDeleted).toBe(1);
    expect(await db.$count(workspace, eq(workspace.id, wsId))).toBe(1); // gehört buyer
    expect(await db.$count(workspaceMember, eq(workspaceMember.userId, other))).toBe(0);
    expect(await db.$count(report, eq(report.userId, other))).toBe(0);

    const r2 = await deleteUserData(buyer);
    expect(r2.workspacesDeleted).toBe(1);
    expect(await db.$count(workspace, eq(workspace.id, wsId))).toBe(0);
    expect(await db.$count(session, eq(session.userId, buyer))).toBe(0);
    expect(await db.$count(user, eq(user.id, buyer))).toBe(0);
    expect(await db.$count(checkRequest, eq(checkRequest.email, `buyer@${P}-kunde.de`))).toBe(0);
  });
});

describe('Auto-Start nach der Zahlung: Randfälle', () => {
  const base = { amountCents: 7900, b2bConfirmedAt: new Date(), termsAcceptedAt: new Date(), termsVersion: '2026-11-05', provider: 'fake' as const };
  let owner: string;
  const autoEvents = async (name: string, reportId: string) => db.$count(funnelEvent, and(eq(funnelEvent.name, name), eq(funnelEvent.reportId, reportId)));

  /** Kunden-Arbeitsbereich mit n aktiven Fragen (ohne Check) */
  async function customerWs(tag: string, n: number) {
    const [ws] = await db.insert(workspace).values({ name: `${P}-auto-${tag}`, slug: `${P}-auto-${tag}`, hostedKind: 'customer', scheduleEnabled: false }).returning();
    await db.insert(brand).values({ workspaceId: ws.id, name: `${P} Auto ${tag}`, domains: [`${P}-auto-${tag}.de`], isOwn: true });
    await db.insert(workspaceMember).values({ workspaceId: ws.id, userId: owner, role: 'owner' });
    if (n) await db.insert(prompt).values(Array.from({ length: n }, (_, i) => ({ workspaceId: ws.id, text: `Welcher Anbieter ist gut für ${tag} ${i}?`, createdAt: new Date(Date.now() - (n - i) * 1000) })));
    return ws;
  }
  async function buy(wsId: string, session: string) {
    const r = await prepareReport({ ...base, userId: owner, tier: 'compact', kind: 'initial', workspaceId: wsId });
    await attachCheckoutSession(r.reportId, session);
    await markReportPaid({ sessionId: session });
    return r.reportId;
  }

  beforeAll(async () => { owner = await addUser('auto-owner'); });

  it('zu wenige Fragen: kein Auto-Start, Grund sichtbar, einmal gemeldet; der Knopf startet trotzdem', async () => {
    const ws = await customerWs('wenig', 3);
    const id = await buy(ws.id, `${P}-sess-auto-few`);
    expect((await getReport(id))!).toMatchObject({ status: 'paid', error: 'autostart_too_few', autoStarting: false, promptsPreparing: false });
    expect(await autoEvents('report_autostart_failed', id)).toBe(1);
    await processReports({});
    expect((await getReport(id))!.status).toBe('paid'); // kein erneuter Versuch
    expect(await autoEvents('report_autostart_failed', id)).toBe(1);
    expect(await startReport(id, owner)).toEqual({ ok: true });
    expect((await getReport(id))!).toMatchObject({ status: 'measuring', error: null });
  });

  it('Tagesbudget: Fehler sichtbar, Worker versucht still erneut und startet, sobald Budget frei ist; danach wartet ein zweiter Kauf auf die laufende Messung', async () => {
    const ws = await customerWs('budget', 6);
    const [g] = await db.insert(recommendationGeneration).values({ workspaceId: ws.id, model: 'test', costUsd: '5.0000' }).returning();
    process.env.ASKMETRY_GLOBAL_DAILY_BUDGET_USD = '4';
    let id: string;
    try {
      id = await buy(ws.id, `${P}-sess-auto-budget`);
      expect((await getReport(id))!).toMatchObject({ status: 'paid', error: 'autostart_budget' });
      await processReports({});
      expect((await getReport(id))!.status).toBe('paid');
      expect(await autoEvents('report_autostart_failed', id)).toBe(1); // nur einmal je Grund
    } finally {
      delete process.env.ASKMETRY_GLOBAL_DAILY_BUDGET_USD;
      await db.delete(recommendationGeneration).where(eq(recommendationGeneration.id, g.id));
    }
    await processReports({});
    expect((await getReport(id))!).toMatchObject({ status: 'measuring', error: null });
    expect(await autoEvents('report_autostarted', id)).toBe(1);

    // weiterer Bericht im selben Arbeitsbereich, während gemessen wird → wartet und startet danach von selbst
    const second = await buy(ws.id, `${P}-sess-auto-second`);
    expect((await getReport(second))!).toMatchObject({ status: 'paid', error: 'autostart_queued' });
    await processReports({});
    expect((await getReport(second))!.status).toBe('paid');
    const first = (await getReport(id))!;
    await db.update(collection).set({ status: 'failed', finishedAt: new Date() }).where(eq(collection.id, first.collectionId!));
    await processReports({});
    expect((await getReport(second))!.status).toBe('measuring');
  });

  it('verpasster Auto-Start (Absturz nach der Zahlung) holt der Worker nach – aber nicht bei Altbeständen', async () => {
    const ws = await customerWs('verpasst', 6);
    const mk = async (paidAgoMs: number) => (await db.insert(report).values({
      workspaceId: ws.id, userId: owner, tier: 'compact', kind: 'initial', status: 'paid', amountCents: 1, paidAt: new Date(Date.now() - paidAgoMs),
    }).returning())[0].id;
    const fresh = await mk(10_000);
    expect((await getReport(fresh))!).toMatchObject({ autoStarting: true, error: null });
    await processReports({});
    expect((await getReport(fresh))!.status).toBe('paid'); // Webhook ist noch dran (Schonfrist)
    await db.delete(report).where(eq(report.id, fresh));
    const legacy = await mk(10 * DAY);
    const missed = await mk(5 * 60_000);
    expect((await getReport(missed))!.autoStarting).toBe(true);
    await processReports({});
    expect((await getReport(missed))!.status).toBe('measuring');
    expect((await getReport(legacy))!).toMatchObject({ status: 'paid', autoStarting: false });
    // Kauf von vor der Einführung des Auto-Starts (innerhalb von 7 Tagen) startet nicht ungefragt
    const ws2 = await customerWs('vorstichtag', 6);
    const [old] = await db.insert(report).values({ workspaceId: ws2.id, userId: owner, tier: 'compact', kind: 'initial', status: 'paid', amountCents: 1, paidAt: new Date(AUTOSTART_SINCE.getTime() - 60_000) }).returning();
    await processReports({ now: new Date(AUTOSTART_SINCE.getTime() + DAY) });
    expect((await getReport(old.id))!.status).toBe('paid');
  });

  it('Fortschritt: Zeile je KI, Claude im Sammelauftrag, ohne Antwort ruhig gezählt, ehrliche Restzeit', async () => {
    const ws = await customerWs('fortschritt', 6);
    const id = await buy(ws.id, `${P}-sess-auto-progress`);
    const v = (await getReport(id))!;
    const colId = v.collectionId!;
    await db.update(collection).set({ status: 'running', startedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(collection.id, colId));
    const runs = await db.select().from(run).where(eq(run.collectionId, colId));
    const ids = (engine: string) => runs.filter((r) => r.engine === engine).map((r) => r.id);
    const now = new Date();
    // ChatGPT fertig (1 ohne Antwort), Gemini halb, Claude wartet im Batch, Google-KIs fertig
    await db.update(run).set({ status: 'done', finishedAt: now }).where(inArray(run.id, [...ids('chatgpt').slice(1), ...ids('google_aio'), ...ids('google_ai_mode'), ...ids('gemini').slice(0, 6)]));
    await db.update(run).set({ status: 'failed', finishedAt: now, error: 'DataForSEO 500' }).where(inArray(run.id, ids('chatgpt').slice(0, 1)));
    await db.update(run).set({ status: 'running', batchId: 'msgbatch_test', batchSubmittedAt: now, startedAt: now }).where(inArray(run.id, ids('claude')));
    let p = (await getReport(id))!.progress!;
    expect(p.phase).toBe('collecting');
    expect(p.engines.find((e) => e.engine === 'chatgpt')).toMatchObject({ total: 12, answered: 11, failed: 1, batch: false });
    expect(p.engines.find((e) => e.engine === 'claude')).toMatchObject({ total: 12, inBatch: 12, batch: true });
    expect(p).toMatchObject({ onlyBatchLeft: false, batchOpen: true });
    // Gemini: 6 von 12 in 10 Minuten → noch ca. 10 Minuten + Auswertung
    expect(p.etaMinutes).toBeGreaterThanOrEqual(10);
    expect(p.etaMinutes).toBeLessThanOrEqual(16);
    await db.update(run).set({ status: 'done', finishedAt: now }).where(inArray(run.id, ids('gemini')));
    p = (await getReport(id))!.progress!;
    expect(p).toMatchObject({ onlyBatchLeft: true, etaMinutes: null });
    await db.update(run).set({ status: 'done', finishedAt: now }).where(inArray(run.id, ids('claude')));
    expect((await getReport(id))!.progress!.phase).toBe('analyzing'); // alle Abfragen beendet, Worker schließt gleich ab
    await db.update(collection).set({ status: 'done', finishedAt: new Date() }).where(eq(collection.id, colId));
    expect((await getReport(id))!.progress!.phase).toBe('recommending'); // noch keine Maßnahme, innerhalb der Schonfrist
    await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, colId));
    expect((await getReport(id))!.progress!.phase).toBe('done'); // jetzt: PDF erstellen
  });
});

describe('Check-Seite vor dem Kauf', () => {
  const base = { amountCents: 7900, b2bConfirmedAt: new Date(), termsAcceptedAt: new Date(), termsVersion: '2026-11-05', provider: 'fake' as const };
  let token: string;

  it('Befunde: Lücken mit Wettbewerbern und Ausschnitt, verschiedene KIs/Fragen; Fragen und Themen sichtbar', async () => {
    token = await runCheck(`${P}-vorkauf.de`);
    const v = (await getCheckView(token))!;
    const f = v.findings!;
    expect(f.simulated).toBe(true);
    expect(f.answers).toBeGreaterThan(20);
    expect(f.gaps.length).toBeGreaterThan(0);
    expect(f.gaps.length).toBeLessThanOrEqual(3);
    for (const g of f.gaps) {
      expect(g.competitors.length).toBeGreaterThan(0);
      expect(g.competitors.join()).not.toContain(v.summary!.brand.name);
      expect(g.excerpt).toBeTruthy();
      expect(g.excerpt).not.toMatch(/\*\*|<|>/);
      expect(g.excerpt!.toLowerCase()).toContain(g.competitors[0].toLowerCase());
    }
    expect(new Set(f.gaps.map((g) => g.question)).size).toBe(f.gaps.length);
    expect(v.questions).toEqual({ list: expect.any(Array), edited: false, max: 20 });
    expect(v.questions!.list).toHaveLength(20);
    expect(v.topics).toEqual(['Auswahl', 'Kosten', 'Vergleich', 'Einrichtung', 'Service']);
    expect(v.editable).toBe(true);
    expect(v.live).toBeNull();
  });

  it('Fragen bearbeiten: Grenzen wie sanitizePrompts, nur am Check (Schnappschuss und Cache-Treffer unverändert)', async () => {
    const list = (await getCheckView(token))!.questions!.list;
    expect(await editCheckQuestions('x'.repeat(43), { action: 'add', text: 'Eine ganz neue Frage zum Test?' })).toEqual({ error: 'not_found' });
    expect(await editCheckQuestions(token, { action: 'add', text: 'Neue Frage?' })).toEqual({ error: 'too_many' }); // schon 20
    expect(await editCheckQuestions(token, { action: 'edit', index: 0, expected: list[0], text: 'kurz' })).toEqual({ error: 'too_short' });
    expect(await editCheckQuestions(token, { action: 'edit', index: 0, expected: list[0], text: 'x'.repeat(301) })).toEqual({ error: 'too_long' });
    expect(await editCheckQuestions(token, { action: 'edit', index: 0, expected: list[0], text: list[1].toUpperCase() })).toEqual({ error: 'duplicate' });
    expect(await editCheckQuestions(token, { action: 'edit', index: 0, expected: 'veraltet', text: 'Was ist die beste Lösung für Arztpraxen?' })).toEqual({ error: 'wrong_state' });
    const r1 = await editCheckQuestions(token, { action: 'edit', index: 0, expected: list[0], text: '  <b>Was ist die beste Lösung für Arztpraxen?</b> ' });
    expect(r1).toMatchObject({ ok: true });
    const r2 = await editCheckQuestions(token, { action: 'delete', index: 19, expected: list[19] });
    expect(r2).toMatchObject({ ok: true });
    const r3 = await editCheckQuestions(token, { action: 'add', text: 'Welche Software nutzen Zahnarztpraxen für die Planung?' });
    expect(r3).toMatchObject({ ok: true });
    const v = (await getCheckView(token))!;
    expect(v.questions!.edited).toBe(true);
    expect(v.questions!.list[0]).toBe('Was ist die beste Lösung für Arztpraxen?');
    expect(v.questions!.list.at(-1)).toBe('Welche Software nutzen Zahnarztpraxen für die Planung?');
    expect(v.questions!.list).toHaveLength(20);
    // eigene Marke in höchstens 2 Fragen
    const brandName = v.summary!.brand.name;
    const withBrand = v.questions!.list.filter((q) => q.toLowerCase().includes(brandName.toLowerCase())).length;
    let res;
    for (let i = withBrand; i < 3; i++) {
      const idx = v.questions!.list.findIndex((q) => !q.toLowerCase().includes(brandName.toLowerCase()));
      const cur = (await getCheckView(token))!.questions!.list;
      res = await editCheckQuestions(token, { action: 'edit', index: idx, expected: cur[idx], text: `Ist ${brandName} gut für Variante ${i}?` });
    }
    expect(res).toEqual({ error: 'brand_limit' });
    // Check-Arbeitsbereich (geteilter Schnappschuss) bleibt unverändert, ein Cache-Treffer sieht die Vorschläge
    const c = await row(token);
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, c.workspaceId!), eq(prompt.text, 'Was ist die beste Lösung für Arztpraxen?')))).toBe(0);
    const cached = (await getCheckView(tokenOf(await startCheck({ url: c.domain, locale: 'de', ipHash: `${P}-ip-vk2` }))))!;
    expect(cached.questions).toMatchObject({ edited: false });
    expect(cached.questions!.list[0]).toBe(list[0]);
    expect(cached.topics).toEqual(['Auswahl', 'Kosten', 'Vergleich', 'Einrichtung', 'Service']);
  });

  it('Themen bearbeiten: umbenennen, entfernen, hinzufügen, höchstens 6, keine Duplikate', async () => {
    const t = (await getCheckView(token))!.topics;
    expect(await editCheckTopics(token, { action: 'edit', index: 0, expected: t[0], text: 'Dienstplanung' })).toMatchObject({ ok: true, list: ['Dienstplanung', ...t.slice(1)] });
    expect(await editCheckTopics(token, { action: 'add', text: 'dienstplanung' })).toEqual({ error: 'duplicate' });
    expect(await editCheckTopics(token, { action: 'add', text: 'Z' })).toEqual({ error: 'too_short' });
    expect(await editCheckTopics(token, { action: 'add', text: 'Zeiterfassung' })).toMatchObject({ ok: true });
    expect(await editCheckTopics(token, { action: 'add', text: 'Urlaubsplanung' })).toEqual({ error: 'too_many' });
    expect(await editCheckTopics(token, { action: 'delete', index: 4, expected: 'Service' })).toMatchObject({ ok: true });
    expect(await editCheckTopics(token, { action: 'add', text: 'Urlaubsplanung' })).toMatchObject({ ok: true });
    expect((await getCheckView(token))!.topics).toEqual(['Dienstplanung', 'Kosten', 'Vergleich', 'Einrichtung', 'Zeiterfassung', 'Urlaubsplanung']);
    const n = await db.$count(funnelEvent, and(eq(funnelEvent.checkId, (await row(token)).id), eq(funnelEvent.name, 'check_topics_edited')));
    expect(n).toBe(4);
    // ein späterer Check derselben Domain aus dem Cache startet mit den Discovery-Themen, nicht mit diesen Änderungen
    const cached = (await getCheckView(tokenOf(await startCheck({ url: (await row(token)).domain, locale: 'de', ipHash: `${P}-ip-vk3` }))))!;
    expect(cached.topics).toEqual(['Auswahl', 'Kosten', 'Vergleich', 'Einrichtung', 'Service']);
  });

  it('Kauf: Kopie übernimmt die bearbeiteten Fragen, Strategiebericht die Themen; danach gesperrt', async () => {
    const u = await addUser('vorkauf');
    const c = await row(token);
    const list = (await getCheckView(token))!.questions!.list;
    const r = await prepareReport({ ...base, userId: u, tier: 'strategy', kind: 'initial', checkId: c.id, amountCents: 24900 });
    const ps = await db.select().from(prompt).where(and(eq(prompt.workspaceId, r.workspaceId), eq(prompt.active, true))).orderBy(prompt.createdAt);
    expect(ps.map((p) => p.text)).toEqual(list);
    expect(ps.every((p) => p.topicId)).toBe(true);
    // unbezahlt: weiter änderbar, erneuter Kauf (gleiche Kopie, noch nichts gemessen) übernimmt die neue Fassung
    const r1 = await editCheckQuestions(token, { action: 'edit', index: 1, expected: list[1], text: 'Welche Lösung hilft bei Schichtplänen im Krankenhaus?' });
    expect(r1).toMatchObject({ ok: true });
    const again = await prepareReport({ ...base, userId: u, tier: 'strategy', kind: 'initial', checkId: c.id, amountCents: 24900 });
    expect(again.workspaceId).toBe(r.workspaceId);
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, r.workspaceId), eq(prompt.text, 'Welche Lösung hilft bei Schichtplänen im Krankenhaus?')))).toBe(1);
    expect(await db.$count(prompt, eq(prompt.workspaceId, r.workspaceId))).toBe(20);
    await attachCheckoutSession(again.reportId, `${P}-sess-vorkauf`);
    // Checkout offen, Nutzer ändert noch eine Frage und zahlt dann die alte Sitzung → Änderung kommt trotzdem an
    const r2 = await editCheckQuestions(token, { action: 'edit', index: 2, expected: list[2], text: 'Wie plane ich Bereitschaftsdienste fair im Team?' });
    expect(r2).toMatchObject({ ok: true });
    await markReportPaid({ sessionId: `${P}-sess-vorkauf` });
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, r.workspaceId), eq(prompt.text, 'Wie plane ich Bereitschaftsdienste fair im Team?')))).toBe(1);
    expect(await db.$count(prompt, eq(prompt.workspaceId, r.workspaceId))).toBe(20);
    expect(await editCheckQuestions(token, { action: 'add', text: 'Noch eine Frage nach dem Kauf?' })).toEqual({ error: 'locked' });
    expect(await editCheckTopics(token, { action: 'add', text: 'Neu' })).toEqual({ error: 'locked' });
    expect((await getCheckView(token))!.editable).toBe(false);
    await processReports({ renderPdf: fakePdf });
    const names = (await db.select({ name: topic.name }).from(topic).where(eq(topic.workspaceId, r.workspaceId))).map((x) => x.name);
    for (const n of ['Dienstplanung', 'Kosten', 'Vergleich', 'Einrichtung', 'Zeiterfassung', 'Urlaubsplanung']) expect(names).toContain(n);
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, r.workspaceId), eq(prompt.active, true)))).toBe(60);
  });

  it('Einwilligung: optional, mit Zeitpunkt und Textversion; gilt nur für die eingegebene Adresse', async () => {
    const t = tokenOf(await startCheck({ url: `${P}-einwilligung.de`, locale: 'de', ipHash: `${P}-ip-ew` }));
    expect(await submitCheckEmail(t, `ohne@${P}-firma.de`)).toEqual({ ok: true });
    expect(await row(t)).toMatchObject({ marketingConsentAt: null, marketingConsentVersion: null });
    // neue Adresse ohne Häkchen → Einwilligung weg
    await db.update(checkRequest).set({ verifySentAt: new Date(Date.now() - 2 * 60_000) }).where(eq(checkRequest.token, t));
    expect(await submitCheckEmail(t, `andere@${P}-firma.de`)).toEqual({ ok: true });
    expect(await row(t)).toMatchObject({ marketingConsentAt: null, marketingConsentVersion: null });
    await db.update(checkRequest).set({ verifySentAt: new Date(Date.now() - 2 * 60_000) }).where(eq(checkRequest.token, t));
    expect(await submitCheckEmail(t, `mit@${P}-firma.de`, { consent: true })).toEqual({ ok: true });
    expect(await row(t)).toMatchObject({ email: `mit@${P}-firma.de`, marketingConsentVersion: CHECK_CONSENT_VERSION });
    expect((await row(t)).marketingConsentAt).toBeInstanceOf(Date);
    expect((await getCheckView(t))!.marketingConsent).toBe(true);
    const ev = await db.select().from(funnelEvent).where(and(eq(funnelEvent.checkId, (await row(t)).id), eq(funnelEvent.name, 'check_consent_given')));
    expect(ev).toHaveLength(1);
  });

  it('Erinnerung 24 h nach dem Ergebnis: nur mit Einwilligung und bestätigter Adresse, einmalig, nicht nach Kauf oder Abmeldung', async () => {
    const mk = async (name: string, consent: boolean) => {
      const t = tokenOf(await startCheck({ url: `${P}-rem-${name}.de`, locale: 'de', ipHash: `${P}-ip-rem-${name}` }));
      const to = `${name}@${P}-erinnerung.de`;
      expect(await submitCheckEmail(t, to, { consent })).toEqual({ ok: true });
      const code = new URL(linkWith(mails(to).at(-1)!, '/bestaetigen')!).searchParams.get('code')!;
      expect(await verifyCheckEmail(t, code)).toEqual({ ok: true });
      await processChecks();
      const c = await row(t);
      await processCollection(c.collectionId!, { retryDelayMs: 1 });
      await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, c.collectionId!));
      await processChecks();
      expect((await row(t)).status).toBe('ready');
      return { t, to, id: c.id };
    };
    const yes = await mk('ja', true), no = await mk('nein', false), bought = await mk('kauf', true), out = await mk('ab', true);
    const reminders = (to: string) => mails(to).filter((m) => !!linkWith(m, '/abmelden'));
    // vor Ablauf von 24 h nichts
    await processCheckReminders();
    for (const x of [yes, no, bought, out]) expect(reminders(x.to)).toHaveLength(0);
    const u = await addUser('remkauf');
    const r = await prepareReport({ ...base, userId: u, tier: 'compact', kind: 'initial', checkId: bought.id });
    await attachCheckoutSession(r.reportId, `${P}-sess-remkauf`);
    await markReportPaid({ sessionId: `${P}-sess-remkauf` });
    await optOut(out.to);
    const later = new Date(Date.now() + 25 * 3600_000);
    await processCheckReminders({ now: later });
    await processCheckReminders({ now: later });
    expect(reminders(yes.to)).toHaveLength(1);
    expect(reminders(no.to)).toHaveLength(0);
    expect(reminders(bought.to)).toHaveLength(0);
    expect(reminders(out.to)).toHaveLength(0);
    const m = reminders(yes.to)[0] as Mail & { headers?: Record<string, string> };
    expect(linkWith(m, `/check/${yes.t}`)).toBeTruthy();
    const unsub = new URL(linkWith(m, '/abmelden')!);
    expect(decodeOptOutParam(unsub.searchParams.get('e'))).toBe(yes.to);
    expect(m.headers?.['List-Unsubscribe']).toContain('/abmelden?');
    expect(m.text).toMatch(/simulierten Antworten/);
    const f = (await getCheckView(yes.t))!.findings!;
    if (f.gaps[0]) expect(m.text).toContain(f.gaps[0].question);
    expect((await row(yes.t)).reminderSentAt).not.toBeNull();
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.checkId, yes.id), eq(funnelEvent.name, 'check_reminded')))).toBe(1);
  });

  it('Funnel: erster sichtbarer Zwischenstand einmal mit Dauer, Kaufformular geöffnet', async () => {
    const t = tokenOf(await startCheck({ url: `${P}-funnel.de`, locale: 'de', ipHash: `${P}-ip-funnel` }));
    const v0 = (await getCheckView(t))!;
    expect(hasVisibleProgress(v0)).toBe(false);
    await processChecks();
    const v1 = (await getCheckView(t))!;
    expect(hasVisibleProgress(v1)).toBe(true);
    await markCheckProgressSeen(t, 'queued');
    await markCheckProgressSeen(t, 'measuring');
    const id = (await row(t)).id;
    const ev = await db.select().from(funnelEvent).where(and(eq(funnelEvent.checkId, id), eq(funnelEvent.name, 'check_progress_seen')));
    expect(ev).toHaveLength(1);
    expect(ev[0].props).toMatchObject({ ms: expect.any(Number), stage: 'queued' });
    await trackCheckoutOpened(t, 'strategy');
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.checkId, id), eq(funnelEvent.name, 'checkout_opened')))).toBe(1);
  });
});

describe('Löschfristen', () => {
  it('IP-Hash und unbestätigte E-Mail nach 7 Tagen, Checks ohne Kauf nach 90 Tagen, Funnel nach 24 Monaten', async () => {
    const old = (d: number) => new Date(Date.now() - d * DAY);
    const mk = async (domain: string, extra: Partial<typeof checkRequest.$inferInsert>) =>
      (await db.insert(checkRequest).values({ token: `${P}-${domain}-${Math.random()}`, url: `https://${domain}/`, domain, status: 'ready', ...extra }).returning())[0];
    const ip = await mk(`${P}-ret-ip.de`, { ipHash: 'h', createdAt: old(8), email: 'x@y.de', emailVerifiedAt: old(8) });
    const fresh = await mk(`${P}-ret-fresh.de`, { ipHash: 'h', email: 'a@b.de' });
    const unver = await mk(`${P}-ret-mail.de`, { email: 'u@y.de', verifyCodeHash: 'abc', createdAt: old(8) });
    const [cws] = await db.insert(workspace).values({ name: `${P}-ret`, slug: `${P}-ret-check`, hostedKind: 'check' }).returning();
    const gone = await mk(`${P}-ret-old.de`, { createdAt: old(91), workspaceId: cws.id });
    const [kws] = await db.insert(workspace).values({ name: `${P}-ret-k`, slug: `${P}-ret-kunde`, hostedKind: 'customer' }).returning();
    const kept = await mk(`${P}-ret-kunde.de`, { createdAt: old(91), workspaceId: kws.id });
    const u = await addUser('ret');
    const bought = await mk(`${P}-ret-bought.de`, { createdAt: old(91), workspaceId: kws.id });
    await db.insert(report).values({ workspaceId: kws.id, userId: u, tier: 'compact', amountCents: 1, checkId: bought.id, status: 'paid' });
    // abgebrochener Checkout: Kopie nach 30 Tagen weg, der Check zählt nicht als gekauft
    const [aws] = await db.insert(workspace).values({ name: `${P}-ret-a`, slug: `${P}-ret-abbruch`, hostedKind: 'customer', createdAt: old(31) }).returning();
    const abandonedCheck = await mk(`${P}-ret-abbruch.de`, { createdAt: old(91) });
    await db.insert(report).values({ workspaceId: aws.id, userId: u, tier: 'compact', amountCents: 1, checkId: abandonedCheck.id, status: 'canceled', createdAt: old(31) });
    // alte Kopie, aber gerade läuft ein neuer Checkout → bleibt
    const [lws] = await db.insert(workspace).values({ name: `${P}-ret-l`, slug: `${P}-ret-laufend`, hostedKind: 'customer', createdAt: old(31) }).returning();
    await db.insert(report).values({ workspaceId: lws.id, userId: u, tier: 'compact', amountCents: 1, status: 'pending_payment' });
    const [fe] = await db.insert(funnelEvent).values({ name: 'check_started', createdAt: new Date(Date.now() - 25 * 30 * DAY) }).returning();
    const [fe2] = await db.insert(funnelEvent).values({ name: 'check_started', createdAt: old(300) }).returning();

    const p = await purgeExpiredData();
    expect(p.checks).toBeGreaterThanOrEqual(2);
    const get = async (id: string) => (await db.select().from(checkRequest).where(eq(checkRequest.id, id)))[0];
    expect((await get(ip.id)).ipHash).toBeNull();
    expect((await get(ip.id)).email).toBe('x@y.de'); // bestätigt → bleibt
    expect(await get(fresh.id)).toMatchObject({ ipHash: 'h', email: 'a@b.de' });
    expect(await get(unver.id)).toMatchObject({ email: null, verifyCodeHash: null });
    expect(await get(gone.id)).toBeUndefined();
    expect(await db.$count(workspace, eq(workspace.id, cws.id))).toBe(0);
    expect(await get(kept.id)).toBeUndefined();
    expect(await db.$count(workspace, eq(workspace.id, kws.id))).toBe(1); // Kunden-Arbeitsbereich nie
    expect(await get(bought.id)).toBeDefined();
    expect(await db.$count(workspace, eq(workspace.id, aws.id))).toBe(0);
    expect(await db.$count(workspace, eq(workspace.id, lws.id))).toBe(1);
    await db.delete(workspace).where(eq(workspace.id, lws.id));
    expect(await get(abandonedCheck.id)).toBeUndefined();
    expect(await db.$count(funnelEvent, eq(funnelEvent.id, fe.id))).toBe(0);
    expect(await db.$count(funnelEvent, eq(funnelEvent.id, fe2.id))).toBe(1);
    await db.delete(workspace).where(eq(workspace.id, kws.id));
  });
});
