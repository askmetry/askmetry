// STUB – wird vom Backend-Agenten implementiert.
export type FunnelEventName =
  | 'check_started' | 'check_email_submitted' | 'check_verified' | 'check_ready' | 'checkout_started' | 'report_paid'
  | 'report_started' | 'report_ready' | 'report_emailed' | 'remeasure_reminded' | 'remeasure_paid' | 'recommendation_done';
export async function trackEvent(_name: FunnelEventName, _fields: { checkId?: string; reportId?: string; workspaceId?: string; userId?: string; props?: Record<string, unknown> } = {}): Promise<void> {}
