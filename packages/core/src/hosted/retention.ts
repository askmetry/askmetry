// Löschfristen (Rechtstexte): täglicher Worker-Job.
// - IP-Hash in check_request nach 7 Tagen entfernen
// - unbestätigte E-Mail (+ Code-Hash) nach 7 Tagen entfernen
// - Checks ohne Kauf (kein report mit check_id) nach 90 Tagen löschen, samt Arbeitsbereich mit hosted_kind = 'check'
//   (Kunden-Arbeitsbereiche nie)
// - funnel_event nach 24 Monaten löschen
import { checkRequest, db, funnelEvent, report, workspace } from '@askmetry/db';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { DAY_MS } from './util.ts';

export const RETENTION = { ipHashDays: 7, unverifiedEmailDays: 7, unpurchasedCheckDays: 90, funnelEventMonths: 24 };

export interface PurgeSummary { ipHashes: number; emails: number; checks: number; workspaces: number; funnelEvents: number }

export async function purgeExpiredData(now = new Date()): Promise<PurgeSummary> {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const ip = await db.update(checkRequest).set({ ipHash: null })
    .where(and(isNotNull(checkRequest.ipHash), lt(checkRequest.createdAt, before(RETENTION.ipHashDays)))).returning({ id: checkRequest.id });
  const mail = await db.update(checkRequest).set({ email: null, verifyCodeHash: null })
    .where(and(isNotNull(checkRequest.email), isNull(checkRequest.emailVerifiedAt), lt(checkRequest.createdAt, before(RETENTION.unverifiedEmailDays)))).returning({ id: checkRequest.id });

  // Checks ohne Kauf (kein Bericht verweist auf den Check)
  const old = await db.select({ id: checkRequest.id, workspaceId: checkRequest.workspaceId }).from(checkRequest)
    .where(and(lt(checkRequest.createdAt, before(RETENTION.unpurchasedCheckDays)),
      sql`not exists (select 1 from ${report} where ${report.checkId} = ${checkRequest.id})`));
  let workspaces = 0;
  if (old.length) {
    const ids = old.map((c) => c.id);
    const wsIds = [...new Set(old.map((c) => c.workspaceId).filter((x): x is string => !!x))];
    // Arbeitsbereich nur löschen, wenn er noch ein Check-Arbeitsbereich ist und kein jüngerer Check ihn (Cache) nutzt
    const deletable = wsIds.length ? await db.select({ id: workspace.id }).from(workspace).where(and(
      inArray(workspace.id, wsIds), eq(workspace.hostedKind, 'check'),
      sql`not exists (select 1 from ${checkRequest} c2 where c2.workspace_id = ${workspace.id} and c2.id not in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}))`,
    )) : [];
    await db.delete(checkRequest).where(inArray(checkRequest.id, ids));
    if (deletable.length) {
      const del = await db.delete(workspace).where(and(inArray(workspace.id, deletable.map((w) => w.id)), eq(workspace.hostedKind, 'check'))).returning({ id: workspace.id });
      workspaces = del.length;
    }
  }
  const fe = await db.delete(funnelEvent).where(lt(funnelEvent.createdAt, sql`${now.toISOString()}::timestamptz - interval '${sql.raw(String(RETENTION.funnelEventMonths))} months'`)).returning({ id: funnelEvent.id });
  return { ipHashes: ip.length, emails: mail.length, checks: old.length, workspaces, funnelEvents: fe.length };
}
