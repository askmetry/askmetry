// Fake-Checkout (ASKMETRY_PAYMENTS=fake, nur Entwicklung/E2E): Session laden – nur für den Käufer selbst.
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { checkRequest, db, report, workspace } from '@askmetry/db';
import { hostedConfig } from '@askmetry/core/hosted/config';
import type { ReportKind, ReportTier } from '@askmetry/core/hosted/config';
import { checkoutPaths } from './form';
import { isFakeSessionId } from './provider';

/** Nur Entwicklung/E2E: in Produktion (NODE_ENV=production) immer aus, auch wenn ASKMETRY_PAYMENTS=fake gesetzt ist. */
export const fakeCheckoutEnabled = () => { const c = hostedConfig(); return c.hosted && c.payments === 'fake' && process.env.NODE_ENV !== 'production'; };

export interface FakeSession {
  sessionId: string; reportId: string; tier: ReportTier; kind: ReportKind; status: string;
  amountCents: number; currency: string; slug: string;
  success: string; cancel: string;
}

/** Session des angemeldeten Nutzers, sonst null (fremde Berichte sind „nicht gefunden“). */
export async function loadFakeSession(sessionId: string, userId: string): Promise<FakeSession | null> {
  if (!fakeCheckoutEnabled() || !isFakeSessionId(sessionId)) return null;
  const [r] = await db
    .select({ id: report.id, tier: report.tier, kind: report.kind, status: report.status, amountCents: report.amountCents,
      currency: report.currency, provider: report.paymentProvider, slug: workspace.slug, checkToken: checkRequest.token })
    .from(report)
    .innerJoin(workspace, eq(workspace.id, report.workspaceId))
    .leftJoin(checkRequest, eq(checkRequest.id, report.checkId))
    .where(and(eq(report.checkoutSessionId, sessionId), eq(report.userId, userId)))
    .limit(1);
  if (!r || r.provider !== 'fake') return null;
  // Abbruch führt zurück auf die Kaufseite: Teaser beim Erstkauf aus dem Check, sonst der Arbeitsbereich
  const origin = r.kind === 'initial' && r.checkToken ? `/check/${r.checkToken}` : `/w/${r.slug}`;
  const p = checkoutPaths({ slug: r.slug, reportId: r.id, origin });
  return {
    sessionId, reportId: r.id, tier: r.tier as ReportTier, kind: r.kind as ReportKind, status: r.status,
    amountCents: r.amountCents, currency: r.currency, slug: r.slug, success: p.success, cancel: p.cancel,
  };
}
