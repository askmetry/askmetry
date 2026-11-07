// Funnel-Ereignisse für die Beta-Kennzahlen. Wirft nie; keine personenbezogenen Daten in props.
import { db, funnelEvent } from '@askmetry/db';

export type FunnelEventName =
  | 'check_started' | 'check_email_submitted' | 'check_verified' | 'check_ready' | 'checkout_started' | 'report_paid'
  | 'report_started' | 'report_autostarted' | 'report_autostart_failed' | 'report_ready' | 'report_emailed' | 'remeasure_reminded' | 'remeasure_paid' | 'recommendation_done'
  // Check-Seite vor dem Kauf: erster sichtbarer Zwischenstand (props.ms = Zeit seit Start), Einwilligung in Erinnerung/Tipps,
  // Fragen/Themen bearbeitet, Kaufformular geöffnet („Kasse geöffnet“; checkout_started = weiter zur Zahlung), Erinnerungsmail
  | 'check_progress_seen' | 'check_consent_given' | 'check_questions_edited' | 'check_topics_edited' | 'checkout_opened' | 'check_reminded';

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
