'use server';
// Buttons des Fake-Checkouts. „Abschließen“ nimmt denselben Weg wie der Stripe-Webhook (markReportPaid, idempotent).
import { notFound, redirect } from 'next/navigation';
import { markReportCanceled, markReportPaid } from '@askmetry/core/hosted/reports';
import { requireUser } from '../session';
import { loadFakeSession } from './fake';

async function load(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId') ?? '');
  const s = await loadFakeSession(sessionId, user.id);
  if (!s) notFound();
  return s;
}

export async function completeFakeCheckout(formData: FormData): Promise<void> {
  const s = await load(formData);
  if (s.status === 'pending_payment') {
    await markReportPaid({ sessionId: s.sessionId, paymentIntentId: null, invoiceId: null, amountCents: s.amountCents });
  }
  redirect(s.success);
}

export async function cancelFakeCheckout(formData: FormData): Promise<void> {
  const s = await load(formData);
  if (s.status === 'pending_payment') await markReportCanceled(s.sessionId);
  redirect(s.cancel);
}
