// Konfiguration der gehosteten Version (siehe HOSTED.md). Einzige Stelle, an der ASKMETRY_HOSTED & Co. gelesen werden.

const env = (k: string) => process.env[k]?.trim() || undefined;
const num = (k: string, d: number) => { const v = Number(env(k)); return env(k) !== undefined && Number.isFinite(v) && v >= 0 ? v : d; };
const flag = (k: string, d: boolean) => { const v = env(k)?.toLowerCase(); return v === undefined ? d : !['0', 'false', 'no', 'off'].includes(v); };

export type ReportTier = 'compact' | 'strategy';
export type ReportKind = 'initial' | 'remeasure';
export type PaymentProvider = 'stripe' | 'fake';

/** Gehostete Version an? (ASKMETRY_HOSTED=1) */
export const isHosted = () => flag('ASKMETRY_HOSTED', false);

/** Betreiber der gehosteten Version (Fußzeile in Mails und PDF). Selbsthosting zeigt ihn nicht. */
export const OPERATOR_LINE = 'lindotech GmbH · Eppendorfer Weg 151 · 20253 Hamburg';

/** Öffentliche Basis-URL ohne Schrägstrich am Ende. */
export function publicUrl(): string {
  return (env('ASKMETRY_PUBLIC_URL') ?? env('BETTER_AUTH_URL') ?? 'http://localhost:3010').replace(/\/+$/, '');
}

/** Umfang je Bericht (Fragen, Wettbewerber, Wiederholungen, KIs). */
export const REPORT_SCOPE: Record<ReportTier, { prompts: number; competitors: number; repetitions: number; engines: string[] }> = {
  compact: { prompts: 20, competitors: 3, repetitions: 3, engines: ['chatgpt', 'claude', 'gemini', 'google_aio', 'google_ai_mode'] },
  strategy: { prompts: 60, competitors: 5, repetitions: 3, engines: ['chatgpt', 'claude', 'gemini', 'google_aio', 'google_ai_mode'] },
};

/** Umfang des Gratis-Schnell-Checks. */
export const CHECK_SCOPE = {
  /** so viele Fragen erzeugt die Discovery (= Standortbestimmung), gemessen werden die ersten `measured` */
  generated: 20,
  measured: 10,
  competitors: 5,
  engines: ['gemini', 'google_aio', 'google_ai_mode', 'chatgpt'],
  engineMaxPrompts: { chatgpt: 5 } as Record<string, number>,
  repetitions: 1,
  /** Zahl der vollständig gezeigten Maßnahmen im Teaser */
  freeRecommendations: 2,
};

/** Version der AGB, der beim Kauf zugestimmt wird (bei Änderung der AGB hochzählen). */
export const TERMS_VERSION = '2026-11-05';

/** Tage nach einem fertigen Bericht bis zur Erinnerung an die Nachmessung. */
export const REMEASURE_REMINDER_DAYS = 56;

export interface HostedConfig {
  hosted: boolean;
  publicUrl: string;
  checksEnabled: boolean;
  checkDailyBudgetUsd: number;
  checkLimitPerIp: number;
  checkLimitPerEmail: number;
  checkCacheDays: number;
  globalDailyBudgetUsd: number;
  reportBudgetUsd: Record<ReportTier, number>;
  payments: PaymentProvider;
  stripe: {
    secretKey?: string; webhookSecret?: string; automaticTax: boolean; taxRateId?: string;
    prices: { compact?: string; strategy?: string; remeasure_compact?: string; remeasure_strategy?: string };
  };
  /** Anzeigepreise in Cent (netto) und durchgestrichene Listenpreise */
  priceCents: { compact: number; strategy: number; remeasure_compact: number; remeasure_strategy: number };
  listPriceCents: { compact: number; strategy: number };
  mail: { smtpUrl?: string; from: string; outbox?: string };
  turnstile: { siteKey?: string; secretKey?: string };
  telegram: { botToken?: string; chatId?: string };
}

export function hostedConfig(): HostedConfig {
  const smtpUrl = env('SMTP_URL');
  const payments = env('ASKMETRY_PAYMENTS') === 'fake' ? 'fake' : 'stripe';
  return {
    hosted: isHosted(),
    publicUrl: publicUrl(),
    checksEnabled: flag('ASKMETRY_CHECKS_ENABLED', true),
    checkDailyBudgetUsd: num('ASKMETRY_CHECK_DAILY_BUDGET_USD', 10),
    checkLimitPerIp: num('ASKMETRY_CHECK_LIMIT_PER_IP', 3),
    checkLimitPerEmail: num('ASKMETRY_CHECK_LIMIT_PER_EMAIL', 3),
    checkCacheDays: num('ASKMETRY_CHECK_CACHE_DAYS', 30),
    globalDailyBudgetUsd: num('ASKMETRY_GLOBAL_DAILY_BUDGET_USD', 150),
    reportBudgetUsd: { compact: num('ASKMETRY_REPORT_BUDGET_USD_COMPACT', 40), strategy: num('ASKMETRY_REPORT_BUDGET_USD_STRATEGY', 120) },
    payments,
    stripe: {
      secretKey: env('STRIPE_SECRET_KEY'), webhookSecret: env('STRIPE_WEBHOOK_SECRET'),
      automaticTax: flag('STRIPE_AUTOMATIC_TAX', false), taxRateId: env('STRIPE_TAX_RATE_ID'),
      prices: {
        compact: env('STRIPE_PRICE_COMPACT'), strategy: env('STRIPE_PRICE_STRATEGY'),
        remeasure_compact: env('STRIPE_PRICE_REMEASURE_COMPACT'), remeasure_strategy: env('STRIPE_PRICE_REMEASURE_STRATEGY'),
      },
    },
    priceCents: {
      compact: num('ASKMETRY_PRICE_COMPACT_CENTS', 7900), strategy: num('ASKMETRY_PRICE_STRATEGY_CENTS', 24900),
      remeasure_compact: num('ASKMETRY_PRICE_REMEASURE_COMPACT_CENTS', 3900), remeasure_strategy: num('ASKMETRY_PRICE_REMEASURE_STRATEGY_CENTS', 11900),
    },
    listPriceCents: { compact: num('ASKMETRY_PRICE_COMPACT_LIST_CENTS', 9900), strategy: num('ASKMETRY_PRICE_STRATEGY_LIST_CENTS', 29900) },
    mail: {
      smtpUrl, from: env('MAIL_FROM') ?? 'Askmetry <noreply@localhost>',
      outbox: env('ASKMETRY_MAIL_OUTBOX') ?? (smtpUrl ? undefined : '.mail-outbox'),
    },
    turnstile: { siteKey: env('TURNSTILE_SITE_KEY'), secretKey: env('TURNSTILE_SECRET_KEY') },
    telegram: { botToken: env('TELEGRAM_BOT_TOKEN'), chatId: env('TELEGRAM_CHAT_ID') },
  };
}

/** Preis-Schlüssel für Stripe/Anzeige je Bericht. */
export const priceKey = (tier: ReportTier, kind: ReportKind) => (kind === 'remeasure' ? `remeasure_${tier}` : tier) as keyof HostedConfig['priceCents'];

/** Fehlende Pflichtwerte für den Betrieb (Start-Check im Worker/Web; leer = alles da). Fake-Zahlung in Produktion ist ein Fehler. */
export function hostedConfigProblems(c: HostedConfig = hostedConfig(), production = process.env.NODE_ENV === 'production'): string[] {
  if (!c.hosted) return [];
  const p: string[] = [];
  if (!process.env.ASKMETRY_PUBLIC_URL?.trim()) p.push('ASKMETRY_PUBLIC_URL fehlt');
  if (c.payments === 'fake' && production) p.push('ASKMETRY_PAYMENTS=fake ist in Produktion nicht erlaubt');
  if (c.payments === 'stripe') {
    if (!c.stripe.secretKey) p.push('STRIPE_SECRET_KEY fehlt');
    if (!c.stripe.webhookSecret) p.push('STRIPE_WEBHOOK_SECRET fehlt');
    for (const [k, v] of Object.entries(c.stripe.prices)) if (!v) p.push(`Stripe-Preis für ${k} fehlt (STRIPE_PRICE_${k.toUpperCase()})`);
    if (!c.stripe.automaticTax && !c.stripe.taxRateId) p.push('STRIPE_TAX_RATE_ID fehlt (oder STRIPE_AUTOMATIC_TAX=1)');
  }
  if (production && !c.mail.smtpUrl) p.push('SMTP_URL fehlt (Mails landen sonst nur in der Outbox)');
  if (production && (!c.turnstile.siteKey || !c.turnstile.secretKey)) p.push('TURNSTILE_SITE_KEY/TURNSTILE_SECRET_KEY fehlen (Bot-Schutz beim Check aus)');
  return p;
}
