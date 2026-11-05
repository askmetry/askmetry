'use server';
// Server Action „Bericht kaufen“ für das Kaufformular (Teaser /check/<token> und Kunden-Arbeitsbereiche).
// Formularfelder: tier (compact|strategy), kind (initial|remeasure), checkToken? | workspaceSlug?, b2b=on, terms=on.
// Erfolg → redirect zum Checkout (Stripe oder /kasse/<id>); sonst { error, code }. Preise für die Anzeige: ./price (priceInfo).
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { checkRequest, db } from '@askmetry/db';
import { hostedConfig } from '@askmetry/core/hosted/config';
import { attachCheckoutSession, prepareReport } from '@askmetry/core/hosted/reports';
import { trackEvent } from '@askmetry/core/hosted/funnel';
import { getSession, isNoPermission, requireEditor } from '../session';
import { getI18n } from '../i18n/server';
import { buyReportWith, type BuyState } from './buy';
import { createCheckout } from './provider';

export async function buyReport(_prev: BuyState, formData: FormData): Promise<BuyState> {
  return buyReportWith({
    config: hostedConfig,
    currentUser: async () => {
      const s = await getSession();
      return s ? { id: s.user.id, email: s.user.email } : null;
    },
    locale: async () => (await getI18n()).locale,
    message: async (code) => (await getI18n()).t.billing.errors[code],
    findCheck: async (token) => {
      const [c] = await db.select({ id: checkRequest.id }).from(checkRequest).where(eq(checkRequest.token, token)).limit(1);
      return c ?? null;
    },
    editorWorkspace: async (slug) => {
      try {
        // requireWorkspace → notFound() für Nicht-Mitglieder (404, Existenz wird nicht verraten)
        const { ws } = await requireEditor(slug);
        return { id: ws.id };
      } catch (e) {
        if (isNoPermission(e)) return 'denied';
        throw e;
      }
    },
    prepareReport, createCheckout, attachCheckoutSession, trackEvent,
    redirect: (url) => redirect(url),
  }, formData);
}
