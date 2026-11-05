// Funnel-Ereignisse für die Beta-Kennzahlen. Wirft nie; keine personenbezogenen Daten in props.
import { db, funnelEvent } from '@askmetry/db';

export type FunnelEventName =
  | 'check_started' | 'check_email_submitted' | 'check_verified' | 'check_ready' | 'checkout_started' | 'report_paid'
  | 'report_started' | 'report_ready' | 'report_emailed' | 'remeasure_reminded' | 'remeasure_paid' | 'recommendation_done';

const PII_KEYS = /mail|name|phone|ip|address|token|code/i;

export async function trackEvent(name: FunnelEventName, fields: { checkId?: string; reportId?: string; workspaceId?: string; userId?: string; props?: Record<string, unknown> } = {}): Promise<void> {
  try {
    const props = fields.props
      ? Object.fromEntries(Object.entries(fields.props).filter(([k, v]) => !PII_KEYS.test(k) && v !== undefined))
      : null;
    await db.insert(funnelEvent).values({
      name, checkId: fields.checkId ?? null, reportId: fields.reportId ?? null, workspaceId: fields.workspaceId ?? null,
      userId: fields.userId ?? null, props: props && Object.keys(props).length ? props : null,
    });
  } catch (e) {
    console.error(`[hosted] Funnel-Ereignis ${name} nicht gespeichert: ${(e as Error)?.message ?? e}`);
  }
}
