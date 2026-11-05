// Gratis-Schnell-Check (HOSTED.md „Ablauf“ 1–5): starten (Turnstile, ohne E-Mail), Worker-Verarbeitung, optionale
// Benachrichtigung per Mail, Teaser-Ansicht.
import { brand, checkRequest, collection, db, funnelEvent, prompt, recommendation, recommendationGeneration, response, run, siteCheck, topic, workspace } from '@askmetry/db';
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { validateBrandDomain } from '../domains.ts';
import { mailTemplates, sendMail } from '../mail/index.ts';
import { localizeRec } from '../recommend/present.ts';
import { loadRecData } from '../recommend/index.ts';
import { CollectionActiveError, createCollection, parseCollectionPlan } from '../runner.ts';
import type { SiteCheckResult } from '../recommend/data.ts';
import { CHECK_SCOPE, hostedConfig, publicUrl } from './config.ts';
import { discoverBrand, DiscoveryError, DISCOVERY_MODEL, type DiscoveryOptions, type DiscoveryProgress } from './discovery.ts';
import { trackEvent } from './funnel.ts';
import { canStartMeasurement, checkDiscoveriesPerHour, checkReservedUsd, checkSpendToday, estimateMeasurementUsd, globalSpendToday } from './limits.ts';
import { safeFetch, type Resolver, type Transport } from '../recommend/safe-fetch.ts';
import { SITE_CHECK_UA } from '../recommend/site-check.ts';
import { isMockMode } from '../engines/index.ts';
import { notifyOps } from './notify.ts';
import { measurementState } from './progress.ts';
import { areaOf, buildCheckSummary } from './summary.ts';
import type { CheckError, CheckProgress, CheckStatus, CheckSummary, CheckView, TeaserRecommendation } from './types.ts';
import { DAY_MS, errText, maskEmail, normalizeEmail, randomToken, safeEqual, serverSecret, sha256hex } from './util.ts';

type Check = typeof checkRequest.$inferSelect;
type Lang = 'de' | 'en';

/** Bestätigungscode gültig */
export const VERIFY_CODE_TTL_MS = DAY_MS;
/** erneutes Senden frühestens nach */
export const VERIFY_RESEND_MS = 60 * 1000;
/** höchstens so viele Bestätigungsmails je Check */
export const VERIFY_MAX_SENDS = 3;
/** hängende Discovery (Worker abgestürzt o. Ä.) nach dieser Zeit als Fehler buchen */
export const DISCOVERY_STALE_MS = 30 * 60 * 1000;
/** so viele Discoveries laufen gleichzeitig */
export const DISCOVERY_PARALLEL = 4;
/** Monatsbudget eines Check-Arbeitsbereichs (USD; Messung ~0,6 $ + Formulierung) */
export const CHECK_WORKSPACE_BUDGET_USD = '3';
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** eingereiht, aber noch keine Messung (z. B. Tagesbudget) → nach dieser Zeit als „blocked“ buchen */
export const QUEUED_STALE_MS = 15 * 60 * 1000;

/**
 * Schlüssel einer IP für die Ratenbegrenzung: IPv4 vollständig, IPv6 nur das /64-Präfix (ein Anschluss bekommt meist ein
 * ganzes /64 – sonst ließe sich das Limit durch Adresswechsel umgehen). IPv4-gemappte IPv6-Adressen zählen als IPv4.
 */
export function ipLimitKey(raw: string): string {
  let ip = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  if (isIPv4(ip) || !isIPv6(ip)) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  // eingebettetes IPv4 am Ende (z. B. 64:ff9b::1.2.3.4) betrifft nur die hinteren 64 Bit
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

/** sha256(IP-Schlüssel + BETTER_AUTH_SECRET) – die IP selbst wird nie gespeichert. IPv6: /64-Präfix (ipLimitKey). */
export function hashIp(ip: string): string {
  return sha256hex(`${ipLimitKey(ip)}|${serverSecret()}`);
}

/** Eingabe → Startseiten-URL + normalisierte Domain (ohne www.), null bei Unsinn/unzulässigem Ziel. */
export function normalizeCheckUrl(raw: string): { url: string; domain: string } | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 2000) return null;
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || (u.port && u.port !== '80' && u.port !== '443')) return null;
  const v = validateBrandDomain(u.hostname);
  if ('error' in v) return null;
  return { url: `${u.protocol}//${u.hostname}/`, domain: v.domain };
}

const since = (ms: number) => new Date(Date.now() - ms);

/** Schlüssel für Anfragen ohne IP: werden gemeinsam gezählt (nicht unbegrenzt). */
export const NO_IP_KEY = 'no-ip';

/** Schnelle Erreichbarkeitsprüfung der Startseite (safeFetch, kurzer Timeout, nur der Anfang des Bodys). */
export async function checkReachable(url: string, opts: { resolve?: Resolver; transport?: Transport; timeoutMs?: number } = {}): Promise<boolean> {
  try {
    const r = await safeFetch(url, {
      headers: { 'user-agent': SITE_CHECK_UA, accept: 'text/html,*/*;q=0.5' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000), maxBytes: 64_000, resolve: opts.resolve, transport: opts.transport,
    });
    return r.status < 400;
  } catch {
    return false;
  }
}

export interface StartCheckOptions {
  /** Erreichbarkeit prüfen (Standard: an, außer im Mock-Modus) */
  reachability?: boolean;
  resolve?: Resolver; transport?: Transport;
  /** Cloudflare-Turnstile-Token aus dem URL-Formular (Pflicht, sobald TURNSTILE_SECRET_KEY gesetzt ist; in Produktion immer) */
  turnstileToken?: string | null;
  /** Client-IP nur für die Turnstile-Prüfung (wird nicht gespeichert) */
  ip?: string | null;
}

let turnstileWarned = false;

export async function startCheck(input: { url: string; locale: 'de' | 'en'; ipHash: string | null }, opts: StartCheckOptions = {}): Promise<{ token: string } | { error: CheckError }> {
  const cfg = hostedConfig();
  const target = normalizeCheckUrl(input.url);
  if (!target) return { error: 'invalid_url' };
  if (!cfg.checksEnabled) return { error: 'disabled' };
  // Bot-Schutz statt E-Mail-Gate: ohne gültiges Turnstile-Token kein Check (ohne Schlüssel nur außerhalb der Produktion).
  // Zuerst, damit Bots weder Limits noch Budgetabfragen auslösen.
  if (!cfg.turnstile.secretKey && !turnstileWarned) { turnstileWarned = true; console.warn('[hosted] TURNSTILE_SECRET_KEY fehlt – Bot-Schutz beim Check übersprungen'); }
  if (!(await verifyTurnstile(opts.turnstileToken, opts.ip))) return { error: 'bot_check_failed' };
  // Tagesbudget inkl. zugesagter Kosten laufender Checks (Discoveries + offene Runs)
  const reserved = await checkReservedUsd();
  if ((await checkSpendToday()) + reserved >= cfg.checkDailyBudgetUsd || (await globalSpendToday()) + reserved >= cfg.globalDailyBudgetUsd) {
    void notifyOps('Neue Schnell-Checks abgelehnt: Tagesbudget erreicht');
    return { error: 'disabled' };
  }
  // ohne IP: gemeinsamer Schlüssel (gleiche Grenze wie je IP)
  const ipKey = input.ipHash || hashIp(NO_IP_KEY);
  const ipCount = (q: Pick<typeof db, '$count'>) => q.$count(checkRequest, and(eq(checkRequest.ipHash, ipKey), gte(checkRequest.createdAt, since(DAY_MS))));
  const hourCount = (q: Pick<typeof db, '$count'>) => q.$count(checkRequest, and(isNull(checkRequest.reusedFromId), gte(checkRequest.createdAt, since(60 * 60 * 1000))));
  // Vorprüfung ohne Sperre (spart Cache-Suche und Erreichbarkeitsprüfung); verbindlich ist die Prüfung in der Transaktion unten
  if ((await ipCount(db)) >= cfg.checkLimitPerIp) return { error: 'rate_limited' };
  const locale: Lang = input.locale === 'en' ? 'en' : 'de';
  const token = randomToken(32);
  // 30-Tage-Cache je Domain: fertiges Ergebnis eines früheren Checks sofort zeigen (ohne neue Messung)
  const [orig] = cfg.checkCacheDays > 0 ? await db.select().from(checkRequest).where(and(
    eq(checkRequest.domain, target.domain), eq(checkRequest.locale, locale), eq(checkRequest.status, 'ready'),
    isNull(checkRequest.reusedFromId), sql`${checkRequest.summary} is not null`, sql`${checkRequest.workspaceId} is not null`,
    // nur unveränderte Check-Schnappschüsse wiederverwenden (nie einen Kunden-Arbeitsbereich)
    sql`exists (select 1 from ${workspace} w where w.id = ${checkRequest.workspaceId} and w.hosted_kind = 'check')`,
    gte(checkRequest.readyAt, since(cfg.checkCacheDays * DAY_MS)),
  )).orderBy(desc(checkRequest.readyAt)).limit(1) : [];
  const hourLimit = checkDiscoveriesPerHour();
  if (!orig) {
    if ((await hourCount(db)) >= hourLimit) {
      void notifyOps(`Schnell-Checks: Stundengrenze neuer Discoveries erreicht (${hourLimit})`);
      return { error: 'rate_limited' };
    }
    if ((opts.reachability ?? !isMockMode()) && !(await checkReachable(target.url, opts))) return { error: 'unreachable' };
  }
  const now = new Date();
  // Zählen + Einfügen unter Advisory-Locks (je IP-Schlüssel, für neue Discoveries zusätzlich global), damit gleichzeitige
  // Anfragen die Limits nicht gemeinsam überschreiten. Immer gleiche Reihenfolge (IP, dann global) → keine Deadlocks.
  const res = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`askmetry:check-ip:${ipKey}`}, 0))`);
    if (!orig) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('askmetry:check-hour', 0))`);
    if ((await ipCount(tx)) >= cfg.checkLimitPerIp) return { error: 'rate_limited' as const };
    if (!orig && (await hourCount(tx)) >= hourLimit) return { error: 'hour' as const };
    const [row] = await tx.insert(checkRequest).values({
      token, url: target.url, domain: target.domain, locale, ipHash: ipKey,
      ...(orig
        // Cache: sofort fertig; Fertig-Mail gibt es hier nie (der Nutzer sieht das Ergebnis direkt)
        ? { status: 'ready', reusedFromId: orig.id, workspaceId: orig.workspaceId, collectionId: orig.collectionId, summary: orig.summary, readyAt: now, readyMailSentAt: now }
        : { status: 'discovering', progress: { stage: 'read' } }),
    }).returning({ id: checkRequest.id });
    return { row };
  });
  if ('error' in res) {
    if (res.error === 'hour') void notifyOps(`Schnell-Checks: Stundengrenze neuer Discoveries erreicht (${hourLimit})`);
    return { error: 'rate_limited' };
  }
  const c = res.row;
  await trackEvent('check_started', { checkId: c.id, props: { reused: !!orig, locale } });
  if (orig) await trackEvent('check_ready', { checkId: c.id, props: { reused: true } });
  return { token };
}

async function byToken(token: string): Promise<Check | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const [c] = await db.select().from(checkRequest).where(eq(checkRequest.token, token));
  return c ?? null;
}

/** Turnstile serverseitig prüfen (nur mit TURNSTILE_SECRET_KEY; sonst übersprungen). */
export async function verifyTurnstile(tokenFromClient: string | null | undefined, ip?: string | null): Promise<boolean> {
  const secret = hostedConfig().turnstile.secretKey;
  // in Produktion Pflicht: ohne Schlüssel kein Mailversand (sonst unbegrenzter Versand an fremde Adressen)
  if (!secret) return process.env.NODE_ENV !== 'production';
  if (!tokenFromClient) return false;
  try {
    const body = new URLSearchParams({ secret, response: tokenFromClient, ...(ip ? { remoteip: ip } : {}) });
    const res = await fetch(TURNSTILE_URL, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    const j = (await res.json().catch(() => ({}))) as { success?: boolean };
    return j.success === true;
  } catch {
    console.error('[hosted] Turnstile-Prüfung nicht erreichbar');
    return false;
  }
}

/**
 * Optional: „Benachrichtige mich per Mail, wenn es fertig ist“. Schickt die Bestätigungsmail; erst nach dem Klick auf den
 * Link geht die Fertig-Mail raus. Sperrt nichts – der Check läuft unabhängig davon.
 */
export async function submitCheckEmail(token: string, email: string, opts: { turnstileToken?: string | null; ip?: string | null } = {}): Promise<{ ok: true } | { error: CheckError }> {
  const cfg = hostedConfig();
  const c = await byToken(token);
  if (!c) return { error: 'not_found' };
  // nur solange der Check noch läuft (awaiting_email: Altbestand aus dem früheren E-Mail-Gate)
  if (c.emailVerifiedAt || !['discovering', 'awaiting_email', 'queued', 'measuring'].includes(c.status)) return { error: 'wrong_state' };
  const e = normalizeEmail(email);
  if (!e) return { error: 'invalid_email' };
  if (c.verifySentAt && Date.now() - c.verifySentAt.getTime() < VERIFY_RESEND_MS) return { error: 'rate_limited' };
  // höchstens VERIFY_MAX_SENDS Bestätigungsmails je Check (auch bei wechselnder Adresse)
  const sent = await db.$count(funnelEvent, and(eq(funnelEvent.checkId, c.id), eq(funnelEvent.name, 'check_email_submitted')));
  if (sent >= VERIFY_MAX_SENDS) return { error: 'rate_limited' };
  const others = await db.$count(checkRequest, and(eq(checkRequest.email, e), ne(checkRequest.id, c.id), gte(checkRequest.createdAt, since(DAY_MS))));
  if (others >= cfg.checkLimitPerEmail) return { error: 'rate_limited' };
  if (!(await verifyTurnstile(opts.turnstileToken, opts.ip))) return { error: 'bot_check_failed' };

  const code = randomToken(32);
  // nur setzen, wenn seit dem Lesen niemand anders gesendet hat (Doppelklick)
  const claimed = await db.update(checkRequest).set({ email: e, verifyCodeHash: sha256hex(code), verifySentAt: new Date() })
    .where(and(eq(checkRequest.id, c.id), c.verifySentAt ? eq(checkRequest.verifySentAt, c.verifySentAt) : isNull(checkRequest.verifySentAt), isNull(checkRequest.emailVerifiedAt)))
    .returning({ id: checkRequest.id });
  if (!claimed.length) return { error: 'rate_limited' };
  const verifyUrl = `${publicUrl()}/check/${encodeURIComponent(c.token)}/bestaetigen?code=${encodeURIComponent(code)}`;
  try {
    await sendMail({ to: e, ...mailTemplates.checkVerify({ lang: c.locale === 'en' ? 'en' : 'de', domain: c.domain, verifyUrl }) });
  } catch (err) {
    // erneutes Senden sofort erlauben
    await db.update(checkRequest).set({ verifySentAt: null }).where(eq(checkRequest.id, c.id));
    void notifyOps(`Bestätigungsmail für Check ${c.domain} nicht versendet: ${errText(err)}`);
    throw err;
  }
  await trackEvent('check_email_submitted', { checkId: c.id });
  return { ok: true };
}

export async function verifyCheckEmail(token: string, code: string): Promise<{ ok: true } | { error: CheckError }> {
  const c = await byToken(token);
  if (!c) return { error: 'not_found' };
  if (!c.verifyCodeHash || !c.verifySentAt) return { error: 'wrong_state' };
  if (typeof code !== 'string' || !code || code.length > 200 || !safeEqual(sha256hex(code), c.verifyCodeHash)) return { error: 'code_invalid' };
  if (c.emailVerifiedAt) return { ok: true }; // Link zweimal geklickt
  if (Date.now() - c.verifySentAt.getTime() > VERIFY_CODE_TTL_MS) return { error: 'code_expired' };
  const now = new Date();
  // Die Bestätigung schaltet nur die Fertig-Mail frei (processChecks verschickt sie, sobald der Check fertig ist –
  // auch wenn er schon vor dem Klick fertig wurde). Gemessen wird ohnehin.
  const set: Partial<typeof checkRequest.$inferInsert> = { emailVerifiedAt: now, ...(c.status === 'awaiting_email' ? await legacyRelease(c) : {}) };
  await db.update(checkRequest).set(set).where(and(eq(checkRequest.id, c.id), isNull(checkRequest.emailVerifiedAt)));
  await trackEvent('check_verified', { checkId: c.id, props: { reused: !!c.reusedFromId, status: c.status } });
  if (set.status === 'ready') await trackEvent('check_ready', { checkId: c.id, props: { reused: true } });
  // schon fertig geworden, bevor der Link geklickt wurde → Fertig-Mail sofort (nicht erst im nächsten Worker-Durchgang)
  const [fresh] = await db.select().from(checkRequest).where(eq(checkRequest.id, c.id));
  if (fresh?.status === 'ready' && !fresh.readyMailSentAt && fresh.emailVerifiedAt) await sendReadyMail(fresh, (m) => console.error(`[hosted] ${m}`));
  return { ok: true };
}

/**
 * Altbestand aus dem früheren E-Mail-Gate (Status awaiting_email): ohne Gate einfach weiterlaufen lassen –
 * Cache-Treffer sofort fertig, sonst einreihen (Discovery war schon gelaufen) bzw. neu entdecken.
 */
async function legacyRelease(c: Check): Promise<Partial<typeof checkRequest.$inferInsert>> {
  const now = new Date();
  if (c.reusedFromId) {
    const [orig] = await db.select({ summary: checkRequest.summary }).from(checkRequest).where(eq(checkRequest.id, c.reusedFromId));
    if (orig?.summary) return { status: 'ready', summary: orig.summary, readyAt: now, readyMailSentAt: now };
    return { status: 'discovering', reusedFromId: null, workspaceId: null, collectionId: null, progress: { stage: 'read' } };
  }
  return c.workspaceId ? { status: 'queued', progress: { queuedAt: now.toISOString() } } : { status: 'discovering', progress: { stage: 'read' } };
}

const ERROR_KEYS = new Set(['disabled', 'unreachable', 'failed', 'invalid_url']);
/** check_request.error = „<schlüssel>|<detail>“ – nach außen nur der Schlüssel */
const errorKey = (e: string | null) => (e ? (ERROR_KEYS.has(e.split('|')[0]) ? e.split('|')[0] : 'failed') : null);

/** Arbeitsstand für die Checkliste: Discovery-Schritt, erkannte Zahlen, Fortschritt je KI-Suche, Auswertung. */
async function checkProgress(c: Check): Promise<CheckProgress> {
  const p: CheckProgress = { stage: null, brandName: null, competitors: 0, prompts: 0, engines: [], analyzing: false, recommending: false };
  const stored = (c.progress ?? null) as Partial<DiscoveryProgress> | null;
  if (c.status === 'discovering') {
    p.stage = stored?.stage === 'profile' || stored?.stage === 'plan' ? stored.stage : 'read';
    p.brandName = typeof stored?.brandName === 'string' ? stored.brandName.slice(0, 80) : null;
  }
  if (c.workspaceId) {
    const [brands, [{ n: prompts }]] = await Promise.all([
      db.select({ name: brand.name, isOwn: brand.isOwn }).from(brand).where(eq(brand.workspaceId, c.workspaceId)),
      db.select({ n: sql<number>`count(*)::int` }).from(prompt).where(and(eq(prompt.workspaceId, c.workspaceId), eq(prompt.active, true))),
    ]);
    p.brandName = brands.find((b) => b.isOwn)?.name ?? p.brandName;
    p.competitors = Math.min(CHECK_SCOPE.competitors, brands.filter((b) => !b.isOwn).length);
    p.prompts = Math.min(CHECK_SCOPE.measured, prompts);
  }
  if (c.collectionId && c.status !== 'ready') {
    const [runs, [col]] = await Promise.all([
      db.select({
        engine: run.engine, total: sql<number>`count(*)::int`,
        done: sql<number>`(count(*) filter (where ${inArray(run.status, ['done', 'failed', 'skipped'])}))::int`,
      }).from(run).where(eq(run.collectionId, c.collectionId)).groupBy(run.engine),
      db.select({ status: collection.status }).from(collection).where(eq(collection.id, c.collectionId)),
    ]);
    p.engines = CHECK_SCOPE.engines.map((e) => runs.find((r) => r.engine === e)).filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({ engine: r.engine, done: r.done, total: r.total }));
    const allDone = p.engines.length > 0 && p.engines.every((e) => e.done >= e.total);
    if (allDone || (col && !['queued', 'running'].includes(col.status))) {
      const [{ n: pending }] = await db.select({ n: sql<number>`count(*)::int` }).from(response)
        .innerJoin(run, eq(run.id, response.runId)).where(and(eq(run.collectionId, c.collectionId), eq(response.analyzed, false)));
      const finished = !!col && !['queued', 'running'].includes(col.status);
      p.analyzing = pending > 0 || !finished;
      p.recommending = !p.analyzing;
    }
  }
  return p;
}

export async function getCheckView(token: string): Promise<CheckView | null> {
  const c = await byToken(token);
  if (!c) return null;
  const locale: Lang = c.locale === 'en' ? 'en' : 'de';
  const summary = c.status === 'ready' ? (c.summary as CheckSummary | null) : null;
  let freeRecommendations: TeaserRecommendation[] = [];
  const ids = summary?.freeRecommendationIds?.slice(0, CHECK_SCOPE.freeRecommendations) ?? [];
  if (ids.length && c.workspaceId) {
    // ausschließlich die freien Maßnahmen laden – Titel/Texte aller anderen verlassen den Server nie
    const rows = await db.select().from(recommendation).where(and(eq(recommendation.workspaceId, c.workspaceId), inArray(recommendation.id, ids)));
    freeRecommendations = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => {
      const l = localizeRec(r, locale);
      return { id: r.id, area: areaOf(r.type), type: r.type, title: l.title, why: l.why, steps: l.steps, impact: r.impact, effort: r.effort };
    });
  }
  return {
    // awaiting_email (Altbestand) gibt der Worker frei → in der Ansicht wie „eingereiht“ (mit Auto-Aktualisierung)
    token: c.token, status: (c.status === 'awaiting_email' ? 'queued' : c.status) as CheckStatus, url: c.url, domain: c.domain, locale,
    emailMasked: maskEmail(c.email), emailVerified: !!c.emailVerifiedAt,
    createdAt: c.createdAt.toISOString(), readyAt: c.readyAt?.toISOString() ?? null,
    error: c.status === 'failed' || c.status === 'blocked' ? errorKey(c.error) ?? 'failed' : null,
    progress: await checkProgress(c), summary, freeRecommendations,
    turnstileSiteKey: hostedConfig().turnstile.siteKey ?? null,
  };
}

/** Laufen Checks, die der Worker zügig weiterbringen soll? (kürzeres Schleifen-Intervall) */
export async function hasActiveChecks(): Promise<boolean> {
  const n = await db.$count(checkRequest, inArray(checkRequest.status, ['discovering', 'awaiting_email', 'queued', 'measuring']));
  if (n > 0) return true;
  // fertige Checks, deren Mail noch aussteht
  return (await db.$count(checkRequest, and(eq(checkRequest.status, 'ready'), isNull(checkRequest.readyMailSentAt), sql`${checkRequest.emailVerifiedAt} is not null`))) > 0;
}

/** Wartet Check-Arbeit, für die der Worker eine lange Berichts-Messung unterbrechen soll? (Discovery oder Einreihen) */
export async function checksWaiting(): Promise<boolean> {
  // eingereihte Checks nur eine Weile: nach QUEUED_STALE_MS bucht processChecks sie als „blocked“; bis dahin (und als
  // Sicherheitsnetz, falls das ausbleibt) zählen nur frische, damit Berichte nicht dauerhaft stehen
  return (await db.$count(checkRequest, or(eq(checkRequest.status, 'discovering'),
    and(eq(checkRequest.status, 'queued'), gte(checkRequest.createdAt, since(QUEUED_STALE_MS + DISCOVERY_STALE_MS)))))) > 0;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export interface ProcessChecksOptions {
  log?: (m: string) => void;
  shouldStop?: () => boolean;
  /** Discovery-Optionen (Tests: injizierte KI / fetch) */
  discovery?: DiscoveryOptions;
}

async function fail(c: Check, key: 'unreachable' | 'failed' | 'disabled', detail: string, log: (m: string) => void, status: 'failed' | 'blocked' = 'failed', extra: Partial<typeof checkRequest.$inferInsert> = {}) {
  await db.update(checkRequest).set({ status, error: `${key}|${detail}`.slice(0, 1000), ...extra }).where(eq(checkRequest.id, c.id));
  log(`Check ${c.id} (${c.domain}): ${status} – ${detail}`);
  if (key === 'failed') void notifyOps(`Schnell-Check fehlgeschlagen (${c.domain}): ${detail.slice(0, 200)}`);
}

/** Discovery-Ergebnis als Check-Arbeitsbereich (ohne Mitglieder) anlegen. */
async function createCheckWorkspace(c: Check, d: Awaited<ReturnType<typeof discoverBrand>>): Promise<string> {
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspace).values({
      name: d.brandName.slice(0, 80), slug: `check-${crypto.randomBytes(6).toString('hex')}`, hostedKind: 'check',
      scheduleEnabled: false, repetitions: CHECK_SCOPE.repetitions, engines: CHECK_SCOPE.engines,
      monthlyBudgetUsd: CHECK_WORKSPACE_BUDGET_USD, country: 'DE', language: c.locale === 'en' ? 'en' : 'de',
    }).returning();
    const now = new Date();
    await tx.insert(brand).values([
      { workspaceId: ws.id, name: d.brandName, domains: [c.domain], isOwn: true, description: d.description, kind: d.kind, profileSource: d.description ? 'auto' : null, profileCheckedAt: now, createdAt: now },
      ...d.competitors.map((x, i) => ({ workspaceId: ws.id, name: x.name, domains: x.domain ? [x.domain] : [], createdAt: new Date(now.getTime() + i + 1) })),
    ]);
    const [t] = await tx.insert(topic).values({ workspaceId: ws.id, name: d.topic }).returning();
    // aufsteigendes createdAt = Reihenfolge der Fragen (die ersten CHECK_SCOPE.measured werden gemessen)
    await tx.insert(prompt).values(d.prompts.map((text, i) => ({ workspaceId: ws.id, topicId: t.id, text, language: ws.language, country: 'DE', createdAt: new Date(now.getTime() + i) })));
    if (d.costUsd > 0) await tx.insert(recommendationGeneration).values({ workspaceId: ws.id, model: `${DISCOVERY_MODEL} (Discovery)`, items: d.prompts.length, costUsd: d.costUsd.toFixed(4) });
    return ws.id;
  });
}

async function runDiscovery(c: Check, opts: ProcessChecksOptions, log: (m: string) => void) {
  if (Date.now() - c.createdAt.getTime() > DISCOVERY_STALE_MS) return fail(c, 'failed', 'Discovery hängt (Zeitlimit)', log);
  const budget = await canStartMeasurement('check');
  if (!budget.ok) return fail(c, 'disabled', 'Tagesbudget erreicht', log, 'blocked');
  let d;
  // Zwischenstände für die Checkliste der Warteansicht (nur solange der Check noch in der Discovery ist)
  const onProgress = async (p: DiscoveryProgress) => {
    await db.update(checkRequest).set({ progress: { stage: p.stage, ...(p.brandName && { brandName: p.brandName.slice(0, 80) }) } })
      .where(and(eq(checkRequest.id, c.id), eq(checkRequest.status, 'discovering')));
    await opts.discovery?.onProgress?.(p);
  };
  try {
    d = await discoverBrand({ url: c.url, domain: c.domain, locale: c.locale === 'en' ? 'en' : 'de' }, { ...opts.discovery, onProgress });
  } catch (e) {
    const cost = (e as DiscoveryError)?.costUsd ?? 0;
    const key = e instanceof DiscoveryError ? e.code : 'failed';
    return fail(c, key, errText(e), log, 'failed', { costUsd: cost.toFixed(4) });
  }
  const wsId = await createCheckWorkspace(c, d);
  // kein E-Mail-Gate mehr: direkt einreihen und die Messung sofort anlegen (der Worker arbeitet sie im selben Durchgang ab)
  const moved = await db.update(checkRequest).set({ workspaceId: wsId, costUsd: d.costUsd.toFixed(4), status: 'queued', progress: { queuedAt: new Date().toISOString() } })
    .where(and(eq(checkRequest.id, c.id), eq(checkRequest.status, 'discovering'))).returning();
  log(`Check ${c.id} (${c.domain}): Discovery fertig (${d.source}, ${d.prompts.length} Fragen, ${d.competitors.length} Wettbewerber, ${d.costUsd.toFixed(4)} $)`);
  if (moved[0]) await startMeasurement(moved[0], log);
}

/** Seit wann ist der Check eingereiht? (progress.queuedAt, sonst createdAt) */
function queuedSince(c: Check): number {
  const q = (c.progress as { queuedAt?: unknown } | null)?.queuedAt;
  const t = typeof q === 'string' ? Date.parse(q) : NaN;
  return Number.isFinite(t) ? t : c.createdAt.getTime();
}

async function startMeasurement(c: Check, log: (m: string) => void) {
  if (!c.workspaceId) return fail(c, 'failed', 'Arbeitsbereich fehlt', log);
  const ps = await db.select({ id: prompt.id }).from(prompt).where(and(eq(prompt.workspaceId, c.workspaceId), eq(prompt.active, true)))
    .orderBy(asc(prompt.createdAt)).limit(CHECK_SCOPE.measured);
  if (!ps.length) return fail(c, 'failed', 'keine Fragen', log);
  const plan = { promptIds: ps.map((p) => p.id), engines: CHECK_SCOPE.engines, repetitions: CHECK_SCOPE.repetitions, engineMaxPrompts: CHECK_SCOPE.engineMaxPrompts, concurrency: CHECK_SCOPE.concurrency };
  const budget = await canStartMeasurement('check', estimateMeasurementUsd({ ...plan, prompts: ps.length }));
  if (!budget.ok) {
    const why = `${budget.reason === 'global_budget' ? 'globales' : 'Check-'}Tagesbudget erreicht`;
    if (Date.now() - queuedSince(c) < QUEUED_STALE_MS) { log(`Check ${c.id}: wartet – ${why}`); return; }
    // zu lange eingereiht: aufgeben (einmalig, bedingt auf „queued“) statt Berichte und Nutzer endlos warten zu lassen
    const moved = await db.update(checkRequest).set({ status: 'blocked', error: `disabled|eingereiht ohne Messung (${why})` })
      .where(and(eq(checkRequest.id, c.id), eq(checkRequest.status, 'queued'), isNull(checkRequest.collectionId))).returning({ id: checkRequest.id });
    if (moved.length) {
      log(`Check ${c.id} (${c.domain}): blocked – ${Math.round(QUEUED_STALE_MS / 60_000)} min eingereiht ohne Messung (${why})`);
      void notifyOps(`Schnell-Check ${c.domain} aufgegeben: ${Math.round(QUEUED_STALE_MS / 60_000)} min eingereiht ohne Messung (${why})`);
    }
    return;
  }
  let collectionId: string;
  try {
    collectionId = (await createCollection(c.workspaceId, 'manual', plan)).id;
  } catch (e) {
    if (!(e instanceof CollectionActiveError)) throw e;
    const [active] = await db.select({ id: collection.id }).from(collection)
      .where(and(eq(collection.workspaceId, c.workspaceId), inArray(collection.status, ['queued', 'running']))).limit(1);
    if (!active) throw e;
    collectionId = active.id;
  }
  await db.update(checkRequest).set({ collectionId, status: 'measuring' }).where(and(eq(checkRequest.id, c.id), eq(checkRequest.status, 'queued')));
  log(`Check ${c.id} (${c.domain}): Messung ${collectionId} angelegt`);
}

/** Summary einer fertigen Check-Messung berechnen (Kennzahlen nach CONTRACT.md). */
export async function computeCheckSummary(workspaceId: string, collectionId: string, plan: unknown): Promise<CheckSummary> {
  const data = await loadRecData(workspaceId, collectionId);
  const recs = await db.select({ id: recommendation.id, type: recommendation.type, key: recommendation.key, priority: recommendation.priority, active: recommendation.active, status: recommendation.status, impact: recommendation.impact, evidence: recommendation.evidence })
    .from(recommendation).where(and(eq(recommendation.workspaceId, workspaceId), eq(recommendation.active, true), eq(recommendation.lastCollectionId, collectionId)));
  const checks = await db.select({ result: siteCheck.result }).from(siteCheck).where(eq(siteCheck.workspaceId, workspaceId)).orderBy(desc(siteCheck.checkedAt)).limit(5);
  const latestByDomain = new Map<string, SiteCheckResult>();
  for (const s of checks) { const r = s.result as SiteCheckResult; if (!latestByDomain.has(r.domain)) latestByDomain.set(r.domain, r); }
  const measured = parseCollectionPlan(plan).promptIds ?? [...new Set(data.resps.map((r) => r.promptId))];
  // simulierte Antworten (Mock-Modus) kennzeichnen, damit der Teaser sie nie als echtes Ergebnis zeigt
  const [mock] = await db.select({ id: run.id }).from(run).where(and(eq(run.collectionId, collectionId), eq(run.model, 'mock'))).limit(1);
  return buildCheckSummary({ data, recs, measuredPromptIds: measured, siteChecks: [...latestByDomain.values()], simulated: !!mock });
}

async function finishMeasurement(c: Check, log: (m: string) => void) {
  const st = await measurementState(c.collectionId);
  if (st.state === 'running') return;
  if (st.state === 'failed') return fail(c, 'failed', `Messung: ${st.error}`, log);
  const col = st.collection;
  const summary = await computeCheckSummary(c.workspaceId!, col.id, col.plan);
  if (!summary.responses) return fail(c, 'failed', 'Messung ohne ausgewertete Antworten', log);
  const [g] = await db.select({ t: sql<string>`coalesce(sum(${recommendationGeneration.costUsd}), 0)` }).from(recommendationGeneration).where(eq(recommendationGeneration.workspaceId, c.workspaceId!));
  const cost = Number(col.costUsd) + Number(g?.t ?? 0);
  const ok = await db.update(checkRequest).set({ status: 'ready', summary, readyAt: new Date(), costUsd: cost.toFixed(4), error: null })
    .where(and(eq(checkRequest.id, c.id), eq(checkRequest.status, 'measuring'))).returning({ id: checkRequest.id });
  if (!ok.length) return;
  await trackEvent('check_ready', { checkId: c.id, workspaceId: c.workspaceId!, props: { costUsd: Number(cost.toFixed(4)), recommendations: summary.recommendationsTotal } });
  log(`Check ${c.id} (${c.domain}): fertig – sichtbar in ${summary.promptsMentioned} von ${summary.prompts} Fragen, ${summary.recommendationsTotal} Maßnahmen, ${cost.toFixed(4)} $`);
}

async function sendReadyMail(c: Check, log: (m: string) => void) {
  if (!c.email || !c.emailVerifiedAt) return;
  const total = (c.summary as CheckSummary | null)?.recommendationsTotal ?? 0;
  // erst beanspruchen, dann senden: Worker und Bestätigungslink können gleichzeitig hier ankommen → nur einer sendet
  const claimed = await db.update(checkRequest).set({ readyMailSentAt: new Date() })
    .where(and(eq(checkRequest.id, c.id), isNull(checkRequest.readyMailSentAt))).returning({ id: checkRequest.id });
  if (!claimed.length) return;
  try {
    await sendMail({ to: c.email, ...mailTemplates.checkReady({ lang: c.locale === 'en' ? 'en' : 'de', domain: c.domain, checkUrl: `${publicUrl()}/check/${encodeURIComponent(c.token)}`, recommendationsTotal: total }) });
  } catch (e) {
    // Anspruch zurückgeben → nächster Worker-Durchgang versucht es erneut
    await db.update(checkRequest).set({ readyMailSentAt: null }).where(eq(checkRequest.id, c.id));
    log(`Check ${c.id}: Fertig-Mail an ${maskEmail(c.email)} fehlgeschlagen – ${errText(e)}`);
  }
}

/** Worker: Discovery → Messung anstoßen → fertigstellen → Fertig-Mail (nur mit bestätigter Adresse). Fehler eines Checks stoppen die anderen nicht. */
export async function processChecks(opts: ProcessChecksOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const stop = opts.shouldStop ?? (() => false);
  const list = await db.select().from(checkRequest)
    .where(inArray(checkRequest.status, ['discovering', 'awaiting_email', 'queued', 'measuring'])).orderBy(asc(checkRequest.createdAt)).limit(50);
  const step = async (c: Check) => {
    if (stop()) return;
    try {
      if (c.status === 'awaiting_email') {
        const set = await legacyRelease(c);
        await db.update(checkRequest).set(set).where(and(eq(checkRequest.id, c.id), eq(checkRequest.status, 'awaiting_email')));
        log(`Check ${c.id} (${c.domain}): Altbestand awaiting_email → ${set.status}`);
        if (set.status === 'ready') await trackEvent('check_ready', { checkId: c.id, props: { reused: true } });
      } else if (c.status === 'discovering') await runDiscovery(c, opts, log);
      else if (c.status === 'queued') await startMeasurement(c, log);
      else if (c.status === 'measuring') await finishMeasurement(c, log);
    } catch (e) {
      log(`Check ${c.id} (${c.domain}): Fehler – ${(e as Error)?.stack ?? e}`);
    }
  };
  // Discoveries gleichzeitig (je ~30 s KI-Aufruf; mehrere Nutzer sollen nicht aufeinander warten), der Rest nacheinander
  const discovering = list.filter((c) => c.status === 'discovering');
  for (let i = 0; i < discovering.length; i += DISCOVERY_PARALLEL) await Promise.all(discovering.slice(i, i + DISCOVERY_PARALLEL).map(step));
  for (const c of list) if (c.status !== 'discovering') await step(c);
  // Fertig-Mails (auch Wiederholung nach Versandfehler), höchstens einen Tag lang
  const mails = await db.select().from(checkRequest).where(and(
    eq(checkRequest.status, 'ready'), isNull(checkRequest.readyMailSentAt), sql`${checkRequest.emailVerifiedAt} is not null`, gte(checkRequest.readyAt, since(DAY_MS)),
  )).limit(50);
  for (const c of mails) { if (stop()) return; await sendReadyMail(c, log); }
}
