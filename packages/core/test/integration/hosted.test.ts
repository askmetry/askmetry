// Gehostete Version gegen askmetry_test: Check-Durchlauf, Limits/Cache/Budgets, Berichte, Erinnerung, Opt-out,
// Konto löschen, Löschfristen. Mock-Engines, Fake-Discovery, Mail-Outbox im Temp-Ordner, Fake-PDF.
import {
  brand, checkRequest, closeDb, collection, db, funnelEvent, prompt, recommendation, recommendationGeneration, report,
  session, topic, user, workspace, workspaceMember,
} from '@askmetry/db';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteUserData } from '../../src/hosted/account.ts';
import { getCheckView, processChecks, startCheck, submitCheckEmail, verifyCheckEmail } from '../../src/hosted/checks.ts';
import { canStartMeasurement, globalSpendToday } from '../../src/hosted/limits.ts';
import { decodeOptOutParam, isOptedOut, optOut, verifyOptOut } from '../../src/hosted/optout.ts';
import { attachCheckoutSession, getReport, getReportPdf, markReportCanceled, markReportPaid, markReportRefunded, prepareReport, processReports, reportsForWorkspace, startReport } from '../../src/hosted/reports.ts';
import { purgeExpiredData } from '../../src/hosted/retention.ts';
import { funnelStats } from '../../src/hosted/stats.ts';
import { parseCollectionPlan, processCollection } from '../../src/runner.ts';
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
  for (const k of ['ASKMETRY_CHECKS_ENABLED', 'ASKMETRY_CHECK_LIMIT_PER_IP', 'ASKMETRY_CHECK_LIMIT_PER_EMAIL', 'ASKMETRY_CHECK_DAILY_BUDGET_USD', 'ASKMETRY_GLOBAL_DAILY_BUDGET_USD', 'ASKMETRY_CHECK_DISCOVERIES_PER_HOUR']) delete process.env[k];
});

const tokenOf = (r: { token: string } | { error: string }) => { if (!('token' in r)) throw new Error(`erwartet Token, bekam ${r.error}`); return r.token; };
const row = async (token: string) => (await db.select().from(checkRequest).where(eq(checkRequest.token, token)))[0];

/** Check bis „ready“ durchlaufen lassen (Mock-Messung direkt abarbeiten). */
async function runCheck(domain: string, email: string, ipHash = `${P}-ip-${domain}`): Promise<string> {
  const token = tokenOf(await startCheck({ url: `https://www.${domain}/`, locale: 'de', ipHash }));
  await processChecks();
  expect(await submitCheckEmail(token, email)).toEqual({ ok: true });
  const m = mails(email).at(-1)!;
  const code = new URL(linkWith(m, '/bestaetigen')!).searchParams.get('code')!;
  expect(await verifyCheckEmail(token, code)).toEqual({ ok: true });
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

  it('Website nicht erreichbar → unreachable (Prüfung über safe-fetch)', async () => {
    const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
    const transport = async () => ({ status: 503, headers: {}, body: (async function* () { yield ''; })(), destroy() {} });
    expect(await startCheck({ url: `${P}-down.de`, locale: 'de', ipHash: `${P}-ip-down` }, { reachability: true, resolve, transport })).toEqual({ error: 'unreachable' });
    expect(await startCheck({ url: `${P}-intern.de`, locale: 'de', ipHash: `${P}-ip-down2` }, { reachability: true, resolve: async () => [{ address: '192.168.1.1', family: 4 as const }] })).toEqual({ error: 'unreachable' });
  });

  it('Discovery legt Check-Arbeitsbereich ohne Mitglieder an → awaiting_email', async () => {
    await processChecks();
    const c = await row(token);
    expect(c.status).toBe('awaiting_email');
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, c.workspaceId!));
    expect(ws).toMatchObject({ hostedKind: 'check', scheduleEnabled: false, monthlyBudgetUsd: '3.00' });
    expect(await db.$count(workspaceMember, eq(workspaceMember.workspaceId, ws.id))).toBe(0);
    expect(await db.$count(prompt, eq(prompt.workspaceId, ws.id))).toBe(20);
    expect(await db.$count(brand, eq(brand.workspaceId, ws.id))).toBe(6);
    const v = await getCheckView(token);
    expect(v!.discovered!.prompts).toHaveLength(10);
    expect(v!.discovered!.competitors).toHaveLength(5);
    expect(v!.summary).toBeNull();
  });

  it('E-Mail: Prüfung, Code nur gehasht, erneutes Senden frühestens nach 60 s', async () => {
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
    expect((await row(token)).status).toBe('queued');
    expect(await submitCheckEmail(token, email)).toEqual({ error: 'wrong_state' });
  });

  it('Messung mit Check-Plan → ready mit Summary, Fertig-Mail, gesperrte Maßnahmen nicht in der Ansicht', async () => {
    await processChecks();
    const c = await row(token);
    expect(c.status).toBe('measuring');
    const [col] = await db.select().from(collection).where(eq(collection.id, c.collectionId!));
    const plan = parseCollectionPlan(col.plan);
    expect(plan).toMatchObject({ engines: ['gemini', 'google_aio', 'google_ai_mode', 'chatgpt'], repetitions: 1, engineMaxPrompts: { chatgpt: 5 } });
    expect(plan.promptIds).toHaveLength(10);
    await processCollection(col.id, { retryDelayMs: 1 });
    await db.update(collection).set({ finishedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(collection.id, col.id));
    await processChecks();
    const done = await row(token);
    expect(done.status).toBe('ready');
    const view = (await getCheckView(token))!;
    const s = view.summary!;
    expect(s.prompts).toBe(10);
    expect(s.responses).toBeGreaterThan(20);
    expect(s.brand.name).toBe(`${P[0].toUpperCase()}${P.slice(1)}-paylindo`);
    expect(s.promptsMentioned).toBeLessThanOrEqual(10);
    expect(s.topDomains.length).toBeLessThanOrEqual(3);
    const recs = await db.select().from(recommendation).where(and(eq(recommendation.workspaceId, done.workspaceId!), eq(recommendation.active, true)));
    expect(recs.length).toBeGreaterThan(2);
    expect(s.recommendationsTotal).toBe(recs.length);
    expect(Object.values(s.recommendationCounts).reduce((a, b) => a + b, 0)).toBe(recs.length);
    expect(view.freeRecommendations).toHaveLength(2);
    expect(view.freeRecommendations.map((r) => r.id)).toEqual(s.freeRecommendationIds);
    const json = JSON.stringify(view);
    for (const r of recs.filter((x) => !s.freeRecommendationIds.includes(x.id))) {
      expect(json).not.toContain(r.title);
      expect(json).not.toContain(r.why);
    }
    expect(json).not.toContain(email);
    // Fertig-Mail mit Teaser-Link
    const ready = mails(email).at(-1)!;
    expect(linkWith(ready, `/check/${token}`)).toBeTruthy();
    expect(done.readyMailSentAt).not.toBeNull();
    await processChecks();
    expect(mails(email).filter((m) => m.subject === ready.subject)).toHaveLength(1);
  });

  it('30-Tage-Cache je Domain: neuer Check mit reused_from_id, nach Bestätigung sofort fertig', async () => {
    const orig = await row(token);
    const t2 = tokenOf(await startCheck({ url: `https://${orig.domain}`, locale: 'de', ipHash: `${P}-ip-n3` }));
    const c2 = await row(t2);
    expect(c2).toMatchObject({ status: 'awaiting_email', reusedFromId: orig.id, workspaceId: orig.workspaceId });
    const other = `erika@${P}-firma.de`;
    expect(await submitCheckEmail(t2, other)).toEqual({ ok: true });
    const code = new URL(linkWith(mails(other).at(-1)!, '/bestaetigen')!).searchParams.get('code')!;
    expect(await verifyCheckEmail(t2, code)).toEqual({ ok: true });
    const v = (await getCheckView(t2))!;
    expect(v.status).toBe('ready');
    expect(v.summary).toEqual(orig.summary);
    expect(v.freeRecommendations).toHaveLength(2);
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
    expect(ws).toMatchObject({ hostedKind: 'customer', repetitions: 3, scheduleEnabled: false, monthlyBudgetUsd: '40.00' });
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

  it('markReportPaid idempotent, Funnel-Ereignis einmal, unbekannte Session → null', async () => {
    await attachCheckoutSession(reportId, `${P}-sess-1`);
    expect(await markReportPaid({ sessionId: `${P}-sess-1`, paymentIntentId: `${P}-pi-1`, amountCents: 0 })).toEqual({ reportId, already: false });
    expect(await markReportPaid({ sessionId: `${P}-sess-1` })).toEqual({ reportId, already: true });
    expect(await markReportPaid({ sessionId: `${P}-unbekannt` })).toBeNull();
    const [r] = await db.select().from(report).where(eq(report.id, reportId));
    expect(r).toMatchObject({ status: 'paid', amountCents: 0, paymentIntentId: `${P}-pi-1` });
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.name, 'report_paid'), eq(funnelEvent.reportId, reportId)))).toBe(1);
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

  it('startReport: Mandantenprüfung, Plan mit 20 Fragen × 3 × 5 KIs, kein Doppelstart', async () => {
    expect(await startReport(reportId, stranger)).toEqual({ error: 'forbidden' });
    await db.insert(workspaceMember).values({ workspaceId: wsId, userId: other, role: 'viewer' });
    expect(await startReport(reportId, other)).toEqual({ error: 'forbidden' });
    expect(await startReport(reportId, buyer)).toEqual({ ok: true });
    expect(await startReport(reportId, buyer)).toEqual({ error: 'wrong_state' });
    const v = (await getReport(reportId))!;
    expect(v.status).toBe('measuring');
    expect(v.progress!.total).toBe(20 * 3 * 5);
    const [col] = await db.select().from(collection).where(eq(collection.id, v.collectionId!));
    expect(parseCollectionPlan(col.plan)).toMatchObject({ repetitions: 3, batch: true });
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
  });

  it('Nachmessung: exakt die Prompt-IDs des Vorberichts, neue Fragen bleiben außen vor', async () => {
    const r = await prepareReport({ ...base, userId: buyer, tier: 'compact', kind: 'remeasure', workspaceId: wsId, amountCents: 3900 });
    const [rr] = await db.select().from(report).where(eq(report.id, r.reportId));
    expect(rr.previousReportId).toBe(reportId);
    await db.insert(prompt).values({ workspaceId: wsId, text: 'Neue Frage nach dem Bericht?' });
    await attachCheckoutSession(r.reportId, `${P}-sess-re`);
    await markReportPaid({ sessionId: `${P}-sess-re` });
    expect(await db.$count(funnelEvent, and(eq(funnelEvent.name, 'remeasure_paid'), eq(funnelEvent.reportId, r.reportId)))).toBe(1);
    expect(await startReport(r.reportId, buyer)).toEqual({ ok: true });
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
    await processReports({ renderPdf: fakePdf });
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, copyWs.id), eq(prompt.active, true)))).toBe(60);
    const topics = await db.select().from(topic).where(eq(topic.workspaceId, copyWs.id));
    expect(topics.length).toBeGreaterThanOrEqual(4);
    expect(await db.$count(prompt, and(eq(prompt.workspaceId, copyWs.id), sql`${prompt.topicId} is null`))).toBe(0);
    expect(await startReport(r.id, other)).toEqual({ ok: true });
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
