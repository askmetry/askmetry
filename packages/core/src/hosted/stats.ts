// Beta-Kennzahlen aus funnel_event, check_request, report und recommendation.
import { checkRequest, db, funnelEvent, recommendation, report } from '@askmetry/db';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { REMEASURE_REMINDER_DAYS } from './config.ts';
import { DAY_MS } from './util.ts';

export interface FunnelStats {
  days: number;
  since: string;
  checksStarted: number;
  checksVerified: number;
  checksReady: number;
  purchases: number;
  remeasurePurchases: number;
  revenueCents: number;
  /** Käufe (Erstberichte) / bestätigte Checks im Zeitraum */
  conversionVerifiedToPurchase: number | null;
  /** Summe der Check-Kosten im Zeitraum / zahlende Kunden im Zeitraum */
  teaserCostPerPayingCustomerUsd: number | null;
  checkCostUsd: number;
  /** abgehakte Maßnahmen 8 Wochen nach fertigen Berichten (Berichte, die seit mind. 8 Wochen fertig sind) */
  implementationRate: { done: number; total: number; rate: number | null };
  /** Anteil der seit mind. 8 Wochen fertigen Erstberichte, nach denen eine Nachmessung gekauft wurde */
  remeasureRate: { remeasured: number; eligible: number; rate: number | null };
}

export async function funnelStats(opts: { days?: number; now?: Date } = {}): Promise<FunnelStats> {
  const days = Math.max(1, Math.floor(opts.days ?? 30));
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - days * DAY_MS);
  const counts = await db.select({ name: funnelEvent.name, n: sql<number>`count(*)::int`, users: sql<number>`count(distinct ${funnelEvent.userId})::int` })
    .from(funnelEvent).where(and(gte(funnelEvent.createdAt, from), lte(funnelEvent.createdAt, now))).groupBy(funnelEvent.name);
  const c = (n: string) => counts.find((x) => x.name === n);
  const [rev] = await db.select({ cents: sql<number>`coalesce(sum(${report.amountCents}), 0)::int` }).from(report)
    .where(and(inArray(report.status, ['paid', 'measuring', 'ready']), gte(report.paidAt, from), lte(report.paidAt, now)));
  const [cost] = await db.select({ t: sql<string>`coalesce(sum(${checkRequest.costUsd}), 0)` }).from(checkRequest)
    .where(and(gte(checkRequest.createdAt, from), lte(checkRequest.createdAt, now)));
  const checkCost = Number(cost?.t ?? 0);
  const payingUsers = c('report_paid')?.users ?? 0;
  const verified = c('check_verified')?.n ?? 0;
  const purchases = c('report_paid')?.n ?? 0;

  // Berichte, die im Zeitraum die 8-Wochen-Marke erreicht haben
  const mature = new Date(now.getTime() - REMEASURE_REMINDER_DAYS * DAY_MS);
  const matureFrom = new Date(from.getTime() - REMEASURE_REMINDER_DAYS * DAY_MS);
  const ready = await db.select().from(report).where(and(eq(report.status, 'ready'), eq(report.kind, 'initial'), gte(report.readyAt, matureFrom), lte(report.readyAt, mature)));
  let done = 0, total = 0, remeasured = 0;
  for (const r of ready) {
    {
      // Maßnahmen, die es beim Fertigstellen des Berichts gab (auch wenn eine Nachmessung sie inzwischen neu berechnet hat)
      const recs = await db.select({ status: recommendation.status, changed: recommendation.statusChangedAt }).from(recommendation)
        .where(and(eq(recommendation.workspaceId, r.workspaceId), lte(recommendation.firstSeenAt, r.readyAt!)));
      const limit = r.readyAt!.getTime() + REMEASURE_REMINDER_DAYS * DAY_MS;
      total += recs.length;
      done += recs.filter((x) => x.status === 'done' && (!x.changed || x.changed.getTime() <= limit)).length;
    }
    const n = await db.$count(report, and(eq(report.workspaceId, r.workspaceId), eq(report.kind, 'remeasure'), inArray(report.status, ['paid', 'measuring', 'ready']), gte(report.createdAt, r.readyAt!)));
    if (n) remeasured++;
  }
  return {
    days, since: from.toISOString(),
    checksStarted: c('check_started')?.n ?? 0, checksVerified: verified, checksReady: c('check_ready')?.n ?? 0,
    purchases, remeasurePurchases: c('remeasure_paid')?.n ?? 0, revenueCents: rev?.cents ?? 0,
    conversionVerifiedToPurchase: verified ? purchases / verified : null,
    teaserCostPerPayingCustomerUsd: payingUsers ? checkCost / payingUsers : null, checkCostUsd: checkCost,
    implementationRate: { done, total, rate: total ? done / total : null },
    remeasureRate: { remeasured, eligible: ready.length, rate: ready.length ? remeasured / ready.length : null },
  };
}
