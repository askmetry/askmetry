// Ablauf „Bericht kaufen“ mit injizierten Abhängigkeiten (testbar ohne Next/DB/Stripe). Die Server Action ist actions.ts.
import { TERMS_VERSION, type HostedConfig, type PaymentProvider } from '@askmetry/core/hosted/config';
import type { PrepareReportInput } from '@askmetry/core/hosted/reports';
import type { FunnelEventName } from '@askmetry/core/hosted/funnel';
import { checkoutPaths, originPath, parseBuyForm, signupUrl, type BuyErrorCode } from './form';
import { priceInfo } from './price';
import type { CheckoutInput, CheckoutResult } from './provider';

export type BuyState = { error?: string; code?: BuyErrorCode } | null;

export interface BuyDeps {
  config: () => HostedConfig;
  /** angemeldeter Nutzer oder null */
  currentUser: () => Promise<{ id: string; email: string } | null>;
  locale: () => Promise<'de' | 'en'>;
  /** Fehlertext zum Code (i18n) */
  message: (code: BuyErrorCode) => Promise<string>;
  /** Check per Token → id (oder null) */
  findCheck: (token: string) => Promise<{ id: string } | null>;
  /** Mitgliedschaft mit Schreibrecht prüfen; 'denied' bei Leserecht, null wenn kein Mitglied/nicht vorhanden */
  editorWorkspace: (slug: string) => Promise<{ id: string } | 'denied' | null>;
  prepareReport: (i: PrepareReportInput) => Promise<{ reportId: string; workspaceId: string; slug: string }>;
  createCheckout: (i: CheckoutInput) => Promise<CheckoutResult>;
  attachCheckoutSession: (reportId: string, sessionId: string) => Promise<void>;
  trackEvent: (name: FunnelEventName, fields: { checkId?: string; reportId?: string; workspaceId?: string; userId?: string; props?: Record<string, unknown> }) => Promise<void>;
  /** wirft (Next: NEXT_REDIRECT) */
  redirect: (url: string) => never;
  now?: () => Date;
  log?: (m: string) => void;
}

export async function buyReportWith(deps: BuyDeps, formData: FormData): Promise<BuyState> {
  const fail = async (code: BuyErrorCode): Promise<BuyState> => ({ code, error: await deps.message(code) });
  const cfg = deps.config();
  if (!cfg.hosted) return fail('unavailable');

  const parsed = parseBuyForm(formData);
  if (!parsed.ok) return fail('invalid');
  const { tier, kind, target } = parsed.form;
  const origin = originPath(target);

  const user = await deps.currentUser();
  if (!user) deps.redirect(signupUrl(origin));
  const u = user!;

  if (!parsed.form.b2b) return fail('b2bRequired');
  if (!parsed.form.terms) return fail('termsRequired');

  // Ziel auflösen: Check (Erstkauf) oder eigener Arbeitsbereich (Nachmessung/weiterer Bericht)
  let checkId: string | undefined;
  let workspaceId: string | undefined;
  if ('checkToken' in target) {
    const c = await deps.findCheck(target.checkToken);
    if (!c) return fail('notFound');
    checkId = c.id;
  } else {
    const w = await deps.editorWorkspace(target.workspaceSlug);
    if (w === 'denied') return fail('noPermission');
    if (!w) return fail('notFound');
    workspaceId = w.id;
  }

  const provider: PaymentProvider = cfg.payments;
  const price = priceInfo(tier, kind, cfg);
  const now = deps.now?.() ?? new Date();
  let checkoutUrl: string;
  try {
    const r = await deps.prepareReport({
      userId: u.id, tier, kind, checkId, workspaceId,
      amountCents: price.netCents, b2bConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, provider,
    });
    const paths = checkoutPaths({ slug: r.slug, reportId: r.reportId, origin });
    const co = await deps.createCheckout({
      reportId: r.reportId, tier, kind, customerEmail: u.email, locale: await deps.locale(),
      successUrl: cfg.publicUrl + paths.success, cancelUrl: cfg.publicUrl + paths.cancel,
    });
    await deps.attachCheckoutSession(r.reportId, co.sessionId);
    await deps.trackEvent('checkout_started', {
      reportId: r.reportId, workspaceId: r.workspaceId, checkId, userId: u.id, props: { tier, kind, provider },
    }).catch(() => {});
    checkoutUrl = co.url;
  } catch (e) {
    // keine personenbezogenen Daten: nur Fehlertyp und -code (Stripe-Meldungen können die E-Mail enthalten)
    const code = (e as { code?: unknown })?.code;
    (deps.log ?? console.error)(`[billing] buyReport fehlgeschlagen (${tier}/${kind}): ${e instanceof Error ? e.name : 'Fehler'}${typeof code === 'string' ? ` ${code}` : ''}`);
    return fail(e instanceof Error && e.name === 'BillingConfigError' ? 'unavailable' : 'failed');
  }
  deps.redirect(checkoutUrl);
}
