// STUB – wird vom Backend-Agenten implementiert (Signaturen verbindlich, siehe HOSTED.md).
import type { PaymentProvider, ReportKind, ReportTier } from './config.ts';
import type { ReportView } from './types.ts';

const todo = (): never => { throw new Error('hosted/reports: noch nicht implementiert'); };

export interface PrepareReportInput {
  userId: string; tier: ReportTier; kind: ReportKind;
  /** Kauf aus einem Schnell-Check (Erstbericht) */
  checkId?: string;
  /** Kauf in einem bestehenden Kunden-Arbeitsbereich (Nachmessung oder weiterer Bericht); Mitgliedschaft prüft der Aufrufer */
  workspaceId?: string;
  amountCents: number; b2bConfirmedAt: Date; termsAcceptedAt: Date; termsVersion: string; provider: PaymentProvider;
}

export async function prepareReport(_input: PrepareReportInput): Promise<{ reportId: string; workspaceId: string; slug: string }> { return todo(); }
export async function attachCheckoutSession(_reportId: string, _sessionId: string): Promise<void> { return todo(); }
export async function markReportPaid(_input: { sessionId: string; paymentIntentId?: string | null; invoiceId?: string | null; amountCents?: number | null }): Promise<{ reportId: string; already: boolean } | null> { return todo(); }
export async function markReportCanceled(_sessionId: string): Promise<void> { return todo(); }
export async function markReportRefunded(_paymentIntentId: string): Promise<void> { return todo(); }
export async function startReport(_reportId: string, _userId: string): Promise<{ ok: true } | { error: string }> { return todo(); }
export async function processReports(_opts: { log?: (m: string) => void; shouldStop?: () => boolean } = {}): Promise<void> { return todo(); }
export async function reportsForWorkspace(_workspaceId: string): Promise<ReportView[]> { return todo(); }
export async function getReport(_reportId: string): Promise<ReportView | null> { return todo(); }
/** PDF eines Berichts (nur Daten; Berechtigung prüft der Aufrufer) */
export async function getReportPdf(_reportId: string): Promise<{ data: Buffer; contentType: string } | null> { return todo(); }
