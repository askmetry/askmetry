// Gekaufte Berichte (HOSTED.md „Ablauf“ 6–9): vorbereiten, bezahlt, starten, fertigstellen (PDF + Mail), Erinnerung.
import { brand, checkRequest, collection, db, prompt, recommendationGeneration, report, reportFile, topic, user, workspace, workspaceMember } from '@askmetry/db';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { mailTemplates, sendMail } from '../mail/index.ts';
import { CollectionActiveError, createCollection, hasActiveCollection, parseCollectionPlan } from '../runner.ts';
import { hostedConfig, publicUrl, REMEASURE_REMINDER_DAYS, REPORT_CONCURRENCY, REPORT_SCOPE, type PaymentProvider, type ReportKind, type ReportTier } from './config.ts';
import { generateMorePrompts, type DiscoveryAsker } from './discovery.ts';
import { trackEvent } from './funnel.ts';
import { canStartMeasurement, estimateMeasurementUsd } from './limits.ts';
import { notifyOps } from './notify.ts';
import { isOptedOut, optOutUrl } from './optout.ts';
import { collectionProgress, measurementState } from './progress.ts';
import type { ReportView } from './types.ts';
import { DAY_MS, errText, maskEmail } from './util.ts';

type Report = typeof report.$inferSelect;
type Lang = 'de' | 'en';

export interface PrepareReportInput {
  userId: string; tier: ReportTier; kind: ReportKind;
  /** Kauf aus einem Schnell-Check (Erstbericht) */
  checkId?: string;
  /** Kauf in einem bestehenden Kunden-Arbeitsbereich (Nachmessung oder weiterer Bericht); Mitgliedschaft prüft der Aufrufer */
  workspaceId?: string;
  amountCents: number; b2bConfirmedAt: Date; termsAcceptedAt: Date; termsVersion: string; provider: PaymentProvider;
}

export const TIER_LABEL: Record<Lang, Record<ReportTier, string>> = {
  de: { compact: 'Standortbestimmung', strategy: 'Strategiebericht' },
  en: { compact: 'Visibility baseline', strategy: 'Strategy report' },
};
const euro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
/** so oft PDF-Erzeugung versuchen, dann Bericht als fehlgeschlagen buchen */
export const PDF_MAX_ATTEMPTS = 3;
const pdfAttempts = new Map<string, number>();
/** Versandversuche der Bericht-Mail je Worker-Lauf; danach Hinweis an Ops und keine weiteren Versuche */
export const MAIL_MAX_ATTEMPTS = 5;
const mailAttempts = new Map<string, number>();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Marken, Themen und Prompts in einen neuen Kunden-Arbeitsbereich kopieren (keine Messdaten). */
async function copyWorkspace(tx: Tx, src: typeof workspace.$inferSelect): Promise<typeof workspace.$inferSelect> {
  const [ws] = await tx.insert(workspace).values({
    name: src.name, slug: `${src.slug.replace(/^check-/, 'w-').slice(0, 40)}-${crypto.randomBytes(3).toString('hex')}`,
    hostedKind: 'customer', scheduleEnabled: false, country: src.country, language: src.language,
    engines: src.engines, repetitions: src.repetitions, monthlyBudgetUsd: src.monthlyBudgetUsd,
  }).returning();
  const brands = await tx.select().from(brand).where(eq(brand.workspaceId, src.id)).orderBy(asc(brand.createdAt));
  if (brands.length) {
    await tx.insert(brand).values(brands.map((b) => ({
      workspaceId: ws.id, name: b.name, aliases: b.aliases, domains: b.domains, isOwn: b.isOwn, description: b.description,
      kind: b.kind, profileSource: b.profileSource, profileCheckedAt: b.profileCheckedAt, createdAt: b.createdAt,
    })));
  }
  const topics = await tx.select().from(topic).where(eq(topic.workspaceId, src.id));
  const topicMap = new Map<string, string>();
  for (const t of topics) topicMap.set(t.id, (await tx.insert(topic).values({ workspaceId: ws.id, name: t.name, createdAt: t.createdAt }).returning())[0].id);
  const prompts = await tx.select().from(prompt).where(eq(prompt.workspaceId, src.id)).orderBy(asc(prompt.createdAt));
  if (prompts.length) {
    await tx.insert(prompt).values(prompts.map((p) => ({
      workspaceId: ws.id, topicId: p.topicId ? topicMap.get(p.topicId) ?? null : null, text: p.text, language: p.language,
      country: p.country, tags: p.tags, active: p.active, createdAt: p.createdAt,
    })));
  }
  return ws;
}

/** Bericht anlegen (pending_payment) samt Kunden-Arbeitsbereich. Mitgliedschaft bei workspaceId prüft der Aufrufer. */
export async function prepareReport(input: PrepareReportInput): Promise<{ reportId: string; workspaceId: string; slug: string }> {
  if (!REPORT_SCOPE[input.tier]) throw new Error(`Unbekannte Berichtsart: ${input.tier}`);
  if (input.kind !== 'initial' && input.kind !== 'remeasure') throw new Error(`Unbekannte Art: ${input.kind}`);
  const scope = REPORT_SCOPE[input.tier];
  const cfg = hostedConfig();
  return db.transaction(async (tx) => {
    let ws: typeof workspace.$inferSelect;
    let fromCheck = false;
    let previousReportId: string | null = null;
    if (input.checkId) {
      const [c] = await tx.select().from(checkRequest).where(eq(checkRequest.id, input.checkId));
      if (!c) throw new Error('Schnell-Check nicht gefunden');
      if (c.status !== 'ready' || !c.workspaceId) throw new Error('Schnell-Check ist nicht fertig – Kauf erst nach dem Ergebnis möglich');
      // Der Check-Arbeitsbereich bleibt ein unveränderlicher Schnappschuss (auch für spätere Checks derselben Domain aus
      // dem Cache). Jeder Käufer bekommt eine eigene Kopie OHNE Mess- und Maßnahmendaten – vor der Zahlung gibt es dort
      // nichts, was der Teaser nicht ohnehin zeigt. Zeile sperren: zwei Käufe gleichzeitig legen nur eine Kopie an.
      const [src] = await tx.select().from(workspace).where(eq(workspace.id, c.workspaceId)).for('update');
      // derselbe Käufer kauft erneut aus diesem Check → seine Kopie weiterverwenden
      const [mine] = await tx.select({ w: workspace }).from(report)
        .innerJoin(workspace, eq(workspace.id, report.workspaceId))
        .innerJoin(workspaceMember, and(eq(workspaceMember.workspaceId, workspace.id), eq(workspaceMember.userId, input.userId), eq(workspaceMember.role, 'owner')))
        .where(and(eq(report.checkId, c.id), eq(report.userId, input.userId), eq(workspace.hostedKind, 'customer')))
        .orderBy(desc(report.createdAt)).limit(1);
      if (mine) {
        ws = mine.w;
      } else {
        if (!src || src.hostedKind !== 'check') throw new Error('Schnell-Check-Daten nicht mehr vorhanden');
        ws = await copyWorkspace(tx, src);
        await tx.insert(workspaceMember).values({ workspaceId: ws.id, userId: input.userId, role: 'owner' });
        fromCheck = true;
      }
    } else if (input.workspaceId) {
      const [w] = await tx.select().from(workspace).where(eq(workspace.id, input.workspaceId));
      if (!w) throw new Error('Arbeitsbereich nicht gefunden');
      if (w.hostedKind !== 'customer') throw new Error('Berichte nur in Kunden-Arbeitsbereichen');
      ws = w;
    } else {
      throw new Error('checkId oder workspaceId fehlt');
    }
    if (input.kind === 'remeasure') {
      const [prev] = await tx.select({ id: report.id }).from(report)
        .where(and(eq(report.workspaceId, ws.id), eq(report.status, 'ready'), eq(report.tier, input.tier))).orderBy(desc(report.readyAt)).limit(1);
      if (!prev) throw new Error('Nachmessung braucht einen fertigen Bericht');
      previousReportId = prev.id;
    }
    // Messumfang und Budget je Berichtsart
    [ws] = await tx.update(workspace).set({
      engines: scope.engines, repetitions: scope.repetitions, scheduleEnabled: false,
      monthlyBudgetUsd: String(Math.max(Number(ws.monthlyBudgetUsd) || 0, cfg.reportBudgetUsd[input.tier])),
    }).where(eq(workspace.id, ws.id)).returning();
    if (fromCheck) {
      // Wettbewerber auf die Grenze der Berichtsart kürzen (nur frisch übernommene/kopierte Check-Daten)
      const comps = await tx.select({ id: brand.id }).from(brand).where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, false))).orderBy(asc(brand.createdAt));
      const extra = comps.slice(scope.competitors).map((b) => b.id);
      if (extra.length) await tx.delete(brand).where(inArray(brand.id, extra));
    }
    // Doppelkauf: ältere offene Checkouts desselben Nutzers für denselben Check bzw. Arbeitsbereich + Art abbrechen
    await tx.update(report).set({ status: 'canceled' }).where(and(
      eq(report.userId, input.userId), eq(report.tier, input.tier), eq(report.kind, input.kind), eq(report.status, 'pending_payment'),
      input.checkId ? eq(report.checkId, input.checkId) : eq(report.workspaceId, ws.id),
    ));
    const [r] = await tx.insert(report).values({
      workspaceId: ws.id, userId: input.userId, tier: input.tier, kind: input.kind, status: 'pending_payment', previousReportId,
      checkId: input.checkId ?? null, paymentProvider: input.provider, amountCents: input.amountCents,
      b2bConfirmedAt: input.b2bConfirmedAt, termsAcceptedAt: input.termsAcceptedAt, termsVersion: input.termsVersion,
    }).returning({ id: report.id });
    return { reportId: r.id, workspaceId: ws.id, slug: ws.slug };
  });
}

export async function attachCheckoutSession(reportId: string, sessionId: string): Promise<void> {
  // auch an einen inzwischen abgebrochenen Bericht (Doppelklick): wird die Session doch bezahlt, findet der Webhook ihn
  await db.update(report).set({ checkoutSessionId: sessionId }).where(and(eq(report.id, reportId), inArray(report.status, ['pending_payment', 'canceled']), isNull(report.checkoutSessionId)));
}

/** Zahlung bestätigt (nur aus dem Webhook bzw. Fake-Checkout). Idempotent: gleiche Session erneut → already: true. */
export async function markReportPaid(input: { sessionId: string; paymentIntentId?: string | null; invoiceId?: string | null; amountCents?: number | null }): Promise<{ reportId: string; already: boolean } | null> {
  const res = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(report).where(eq(report.checkoutSessionId, input.sessionId)).for('update');
    if (!r) return null;
    if (!['pending_payment', 'canceled'].includes(r.status)) return { r, already: true };
    await tx.update(report).set({
      status: 'paid', paidAt: new Date(), paymentIntentId: input.paymentIntentId ?? r.paymentIntentId,
      invoiceId: input.invoiceId ?? r.invoiceId, ...(input.amountCents != null && { amountCents: input.amountCents }), error: null,
    }).where(eq(report.id, r.id));
    return { r, already: false };
  });
  if (!res) return null;
  const { r, already } = res;
  if (!already) {
    const amount = input.amountCents ?? r.amountCents;
    await trackEvent(r.kind === 'remeasure' ? 'remeasure_paid' : 'report_paid', { reportId: r.id, workspaceId: r.workspaceId, userId: r.userId, checkId: r.checkId ?? undefined, props: { tier: r.tier, amountCents: amount } });
    const [own] = await db.select({ domains: brand.domains }).from(brand).where(and(eq(brand.workspaceId, r.workspaceId), eq(brand.isOwn, true))).limit(1);
    void notifyOps(`Kauf: ${TIER_LABEL.de[r.tier as ReportTier] ?? r.tier}${r.kind === 'remeasure' ? ' (Nachmessung)' : ''}, ${euro(amount)}${own?.domains[0] ? `, ${own.domains[0]}` : ''}`);
  }
  return { reportId: r.id, already };
}

export async function markReportCanceled(sessionId: string): Promise<void> {
  await db.update(report).set({ status: 'canceled' }).where(and(eq(report.checkoutSessionId, sessionId), eq(report.status, 'pending_payment')));
}

export async function markReportRefunded(paymentIntentId: string): Promise<void> {
  const rows = await db.update(report).set({ status: 'refunded' })
    .where(and(eq(report.paymentIntentId, paymentIntentId), inArray(report.status, ['paid', 'measuring', 'ready']))).returning({ id: report.id, tier: report.tier, amount: report.amountCents });
  for (const r of rows) void notifyOps(`Erstattung: ${TIER_LABEL.de[r.tier as ReportTier] ?? r.tier}, ${euro(r.amount)}`);
}

/** Strategiebericht: es fehlen noch Fragen (werden nach Zahlung im Worker erzeugt). */
async function promptsMissing(r: Report): Promise<number> {
  if (r.tier !== 'strategy' || r.kind !== 'initial' || r.promptsGeneratedAt) return 0;
  const n = await db.$count(prompt, and(eq(prompt.workspaceId, r.workspaceId), eq(prompt.active, true)));
  return Math.max(0, REPORT_SCOPE.strategy.prompts - n);
}

/** Messung eines bezahlten Berichts starten – nur owner/admin, keine aktive Messung, Tagesbudget ok. */
export async function startReport(reportId: string, userId: string): Promise<{ ok: true } | { error: string }> {
  const [r] = await db.select().from(report).where(eq(report.id, reportId));
  if (!r) return { error: 'not_found' };
  const [m] = await db.select({ role: workspaceMember.role }).from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, r.workspaceId), eq(workspaceMember.userId, userId)));
  if (!m || (m.role !== 'owner' && m.role !== 'admin')) return { error: 'forbidden' };
  if (r.status !== 'paid') return { error: 'wrong_state' };
  if ((await promptsMissing(r)) > 0 && !r.error) return { error: 'preparing' };
  if (await hasActiveCollection(r.workspaceId)) return { error: 'measurement_active' };
  const scope = REPORT_SCOPE[r.tier as ReportTier];
  if (!scope) return { error: 'wrong_state' };

  let promptIds: string[];
  if (r.kind === 'remeasure') {
    const [prev] = r.previousReportId ? await db.select({ collectionId: report.collectionId }).from(report).where(eq(report.id, r.previousReportId)) : [];
    const [pc] = prev?.collectionId ? await db.select({ plan: collection.plan }).from(collection).where(eq(collection.id, prev.collectionId)) : [];
    promptIds = parseCollectionPlan(pc?.plan).promptIds ?? [];
    if (!promptIds.length) return { error: 'previous_missing' };
  } else {
    promptIds = (await db.select({ id: prompt.id }).from(prompt).where(and(eq(prompt.workspaceId, r.workspaceId), eq(prompt.active, true)))
      .orderBy(asc(prompt.createdAt)).limit(scope.prompts)).map((p) => p.id);
    if (!promptIds.length) return { error: 'no_prompts' };
  }
  const plan = { promptIds, engines: scope.engines, repetitions: scope.repetitions, batch: true, concurrency: REPORT_CONCURRENCY };
  const budget = await canStartMeasurement('report', estimateMeasurementUsd({ ...plan, prompts: promptIds.length }));
  if (!budget.ok) return { error: 'budget' };

  // Bericht zuerst beanspruchen (Doppelklick), dann Messung anlegen
  const claimed = await db.update(report).set({ status: 'measuring', startedAt: new Date(), error: null })
    .where(and(eq(report.id, r.id), eq(report.status, 'paid'))).returning({ id: report.id });
  if (!claimed.length) return { error: 'wrong_state' };
  try {
    const c = await createCollection(r.workspaceId, 'manual', plan);
    await db.update(report).set({ collectionId: c.id }).where(eq(report.id, r.id));
  } catch (e) {
    await db.update(report).set({ status: 'paid', startedAt: null }).where(eq(report.id, r.id));
    if (e instanceof CollectionActiveError) return { error: 'measurement_active' };
    throw e;
  }
  await trackEvent('report_started', { reportId: r.id, workspaceId: r.workspaceId, userId, props: { tier: r.tier, kind: r.kind, prompts: promptIds.length } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export interface ProcessReportsOptions {
  log?: (m: string) => void;
  shouldStop?: () => boolean;
  /** PDF-Erzeugung (aus @askmetry/report; vom Worker übergeben – core importiert das Paket nicht) */
  renderPdf?: (reportId: string) => Promise<Buffer>;
  /** KI für die Zusatzfragen des Strategieberichts (Tests) */
  ask?: DiscoveryAsker;
  now?: Date;
}

const reportUrl = (slug: string, id: string) => `${publicUrl()}/w/${slug}/bericht/${id}`;

async function wsInfo(workspaceId: string) {
  const [ws] = await db.select({ slug: workspace.slug, language: workspace.language, name: workspace.name }).from(workspace).where(eq(workspace.id, workspaceId));
  const [own] = await db.select({ name: brand.name, domains: brand.domains }).from(brand).where(and(eq(brand.workspaceId, workspaceId), eq(brand.isOwn, true))).limit(1);
  return { slug: ws?.slug ?? '', lang: (ws?.language === 'en' ? 'en' : 'de') as Lang, brandName: own?.name ?? ws?.name ?? '', domain: own?.domains[0] ?? '' };
}

async function failReport(r: Report, error: string, log: (m: string) => void) {
  await db.update(report).set({ status: 'failed', error: error.slice(0, 1000) }).where(eq(report.id, r.id));
  const info = await wsInfo(r.workspaceId);
  log(`Bericht ${r.id}: fehlgeschlagen – ${error}`);
  void notifyOps(`Bericht fehlgeschlagen: ${TIER_LABEL.de[r.tier as ReportTier] ?? r.tier}${info.domain ? `, ${info.domain}` : ''} – ${error.slice(0, 200)}`);
}

async function finishReport(r: Report, opts: ProcessReportsOptions, log: (m: string) => void) {
  const st = await measurementState(r.collectionId);
  if (st.state === 'running') return;
  if (st.state === 'failed') return failReport(r, `Messung: ${st.error}`, log);
  if (!opts.renderPdf) { log(`Bericht ${r.id}: Messung fertig, aber kein PDF-Renderer verfügbar (@askmetry/report) – wartet`); return; }
  let pdf: Buffer;
  try {
    pdf = await opts.renderPdf(r.id);
    if (!pdf?.length) throw new Error('leeres PDF');
  } catch (e) {
    const n = (pdfAttempts.get(r.id) ?? 0) + 1;
    pdfAttempts.set(r.id, n);
    log(`Bericht ${r.id}: PDF-Erzeugung fehlgeschlagen (Versuch ${n}/${PDF_MAX_ATTEMPTS}) – ${errText(e)}`);
    if (n >= PDF_MAX_ATTEMPTS) { pdfAttempts.delete(r.id); await failReport(r, `PDF: ${errText(e)}`, log); }
    return;
  }
  pdfAttempts.delete(r.id);
  const col = st.collection;
  const [g] = await db.select({ t: sql<string>`coalesce(sum(${recommendationGeneration.costUsd}), 0)` }).from(recommendationGeneration).where(eq(recommendationGeneration.collectionId, col.id));
  const cost = Number(col.costUsd) + Number(g?.t ?? 0);
  const now = new Date();
  await db.transaction(async (tx) => {
    const data = pdf.toString('base64');
    await tx.insert(reportFile).values({ reportId: r.id, data, bytes: pdf.length, contentType: 'application/pdf' })
      .onConflictDoUpdate({ target: reportFile.reportId, set: { data, bytes: pdf.length, createdAt: now } });
    await tx.update(report).set({ status: 'ready', readyAt: now, pdfGeneratedAt: now, costUsd: cost.toFixed(4), error: null }).where(and(eq(report.id, r.id), eq(report.status, 'measuring')));
  });
  await trackEvent('report_ready', { reportId: r.id, workspaceId: r.workspaceId, userId: r.userId, props: { tier: r.tier, kind: r.kind, costUsd: Number(cost.toFixed(4)) } });
  log(`Bericht ${r.id}: fertig (${pdf.length} Byte PDF, ${cost.toFixed(4)} $)`);
}

async function emailReport(r: Report, log: (m: string) => void) {
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, r.userId));
  const [f] = await db.select().from(reportFile).where(eq(reportFile.reportId, r.id));
  if (!u?.email || !f) { log(`Bericht ${r.id}: Mail nicht möglich (${!u ? 'Käufer fehlt' : 'PDF fehlt'})`); return; }
  const info = await wsInfo(r.workspaceId);
  const tierLabel = TIER_LABEL[info.lang][r.tier as ReportTier] ?? r.tier;
  try {
    await sendMail({
      to: u.email,
      ...mailTemplates.reportReady({ lang: info.lang, brandName: info.brandName, tierLabel, reportUrl: reportUrl(info.slug, r.id), remeasure: r.kind === 'remeasure' }),
      attachments: [{ filename: `askmetry-${(info.domain || 'bericht').replace(/[^a-z0-9.-]/gi, '')}-${r.readyAt?.toISOString().slice(0, 10) ?? 'bericht'}.pdf`, content: Buffer.from(f.data, 'base64'), contentType: f.contentType }],
    });
  } catch (e) {
    const n = (mailAttempts.get(r.id) ?? 0) + 1;
    mailAttempts.set(r.id, n);
    log(`Bericht ${r.id}: Mail an ${maskEmail(u.email)} fehlgeschlagen (Versuch ${n}/${MAIL_MAX_ATTEMPTS}) – ${errText(e)}`);
    if (n === MAIL_MAX_ATTEMPTS) void notifyOps(`Bericht-Mail nach ${n} Versuchen nicht versendet (Bericht ${r.id}) – PDF liegt im Konto`);
    return;
  }
  mailAttempts.delete(r.id);
  await db.update(report).set({ emailedAt: new Date() }).where(eq(report.id, r.id));
  await trackEvent('report_emailed', { reportId: r.id, workspaceId: r.workspaceId, userId: r.userId });
}

async function remind(r: Report, log: (m: string) => void) {
  // einmalig: sofort vermerken (auch wenn übersprungen)
  const claimed = await db.update(report).set({ remindedAt: new Date() }).where(and(eq(report.id, r.id), isNull(report.remindedAt))).returning({ id: report.id });
  if (!claimed.length) return;
  // schon eine neuere Messung gekauft? Dann keine Erinnerung
  const newer = await db.$count(report, and(eq(report.workspaceId, r.workspaceId), ne(report.id, r.id), inArray(report.status, ['paid', 'measuring', 'ready']), sql`${report.createdAt} > ${r.readyAt}`));
  if (newer) return;
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, r.userId));
  if (!u?.email || (await isOptedOut(u.email))) return;
  const info = await wsInfo(r.workspaceId);
  try {
    await sendMail({ to: u.email, ...mailTemplates.remeasureReminder({ lang: info.lang, brandName: info.brandName, buyUrl: `${publicUrl()}/w/${info.slug}/berichte?nachmessung=${r.id}`, optOutUrl: optOutUrl(u.email), readyAt: r.readyAt! }) });
  } catch (e) {
    log(`Bericht ${r.id}: Erinnerung an ${maskEmail(u.email)} fehlgeschlagen – ${errText(e)}`);
    return;
  }
  await trackEvent('remeasure_reminded', { reportId: r.id, workspaceId: r.workspaceId, userId: r.userId });
}

/** Worker: Zusatzfragen (Strategie) → fertige Messungen → PDF → ready → Mail; Erinnerungen nach 8 Wochen. */
export async function processReports(opts: ProcessReportsOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const stop = opts.shouldStop ?? (() => false);
  const step = async (r: Report, what: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { log(`Bericht ${r.id}: ${what} – Fehler ${(e as Error)?.stack ?? e}`); }
  };
  // 1. Strategiebericht: 40 weitere Fragen nach der Zahlung (einmal; Fehler → report.error, Start trotzdem möglich)
  for (const r of await db.select().from(report).where(and(eq(report.status, 'paid'), eq(report.tier, 'strategy'), eq(report.kind, 'initial'), isNull(report.error)))) {
    if (stop()) return;
    const missing = await promptsMissing(r);
    if (!missing) continue;
    await step(r, 'Zusatzfragen', async () => {
      try {
        const g = await generateMorePrompts(r.workspaceId, missing, undefined, { ask: opts.ask });
        await db.update(report).set({ promptsGeneratedAt: new Date() }).where(eq(report.id, r.id));
        log(`Bericht ${r.id}: ${g.created} Zusatzfragen in ${g.topics.length} Themen (${g.costUsd.toFixed(4)} $)`);
      } catch (e) {
        await db.update(report).set({ error: `prompts|${errText(e)}` }).where(eq(report.id, r.id));
        void notifyOps(`Zusatzfragen für Strategiebericht fehlgeschlagen: ${errText(e).slice(0, 200)}`);
        throw e;
      }
    });
  }
  // 2. laufende Messungen fertigstellen
  for (const r of await db.select().from(report).where(eq(report.status, 'measuring')).orderBy(asc(report.startedAt))) {
    if (stop()) return;
    await step(r, 'Fertigstellen', () => finishReport(r, opts, log));
  }
  // 3. Mail mit PDF (wiederholt sich nach Versandfehlern)
  for (const r of await db.select().from(report).where(and(eq(report.status, 'ready'), isNull(report.emailedAt), isNotNull(report.pdfGeneratedAt)))) {
    if (stop()) return;
    if ((mailAttempts.get(r.id) ?? 0) >= MAIL_MAX_ATTEMPTS) continue;
    await step(r, 'Mail', () => emailReport(r, log));
  }
  // 4. Erinnerung an die Nachmessung
  const due = new Date((opts.now ?? new Date()).getTime() - REMEASURE_REMINDER_DAYS * DAY_MS);
  for (const r of await db.select().from(report).where(and(eq(report.status, 'ready'), isNull(report.remindedAt), lte(report.readyAt, due)))) {
    if (stop()) return;
    await step(r, 'Erinnerung', () => remind(r, log));
  }
}

// ---------------------------------------------------------------------------
// Ansichten
// ---------------------------------------------------------------------------

async function toView(r: Report): Promise<ReportView> {
  const hasPdf = (await db.$count(reportFile, eq(reportFile.reportId, r.id))) > 0;
  return {
    id: r.id, workspaceId: r.workspaceId, tier: r.tier as ReportTier, kind: r.kind as ReportKind, status: r.status as ReportView['status'],
    amountCents: r.amountCents, currency: r.currency, previousReportId: r.previousReportId, collectionId: r.collectionId,
    createdAt: r.createdAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null, startedAt: r.startedAt?.toISOString() ?? null,
    readyAt: r.readyAt?.toISOString() ?? null, hasPdf, emailedAt: r.emailedAt?.toISOString() ?? null,
    // Fehlertext nur als Schlüssel nach außen (Details stehen im Log)
    error: r.error ? (r.error.startsWith('prompts|') ? 'prompts_failed' : r.status === 'failed' ? 'failed' : null) : null,
    progress: r.status === 'measuring' && r.collectionId ? await collectionProgress(r.collectionId) : null,
    promptsPreparing: r.status === 'paid' && !r.error && (await promptsMissing(r)) > 0,
  };
}

/** Berichte eines Arbeitsbereichs, neueste zuerst (ohne abgebrochene Checkouts). Berechtigung prüft der Aufrufer. */
export async function reportsForWorkspace(workspaceId: string): Promise<ReportView[]> {
  const rows = await db.select().from(report).where(and(eq(report.workspaceId, workspaceId), ne(report.status, 'canceled'))).orderBy(desc(report.createdAt));
  return Promise.all(rows.map(toView));
}

/** Ein Bericht (Berechtigung prüft der Aufrufer über workspaceId). */
export async function getReport(reportId: string): Promise<ReportView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return null;
  const [r] = await db.select().from(report).where(eq(report.id, reportId));
  return r ? toView(r) : null;
}

/** PDF eines Berichts (nur Daten; Berechtigung prüft der Aufrufer) */
export async function getReportPdf(reportId: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return null;
  const [f] = await db.select().from(reportFile).where(eq(reportFile.reportId, reportId));
  return f ? { data: Buffer.from(f.data, 'base64'), contentType: f.contentType } : null;
}
