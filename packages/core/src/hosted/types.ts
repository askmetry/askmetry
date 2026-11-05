// Gemeinsame Typen der gehosteten Version (Web ↔ Kern). Siehe HOSTED.md.
import type { ReportKind, ReportTier } from './config.ts';

export type CheckStatus = 'discovering' | 'awaiting_email' | 'queued' | 'measuring' | 'ready' | 'failed' | 'blocked';

export type CheckError =
  | 'disabled'          // Notschalter / Tagesbudget erreicht
  | 'invalid_url'
  | 'unreachable'       // Website nicht abrufbar
  | 'rate_limited'
  | 'invalid_email'
  | 'bot_check_failed'
  | 'not_found'
  | 'wrong_state'
  | 'code_invalid'
  | 'code_expired';

/** Bereiche der Maßnahmen im Teaser (gleiche Einteilung wie die Maßnahmen-Seite). */
export type RecArea = 'own_content' | 'other_sites' | 'community' | 'technical';

export interface TeaserRecommendation {
  id: string; area: RecArea; type: string; title: string; why: string; steps: string[]; impact: number; effort: number;
}

/** Teaser-Zusammenfassung (check_request.summary). Nur Zahlen und öffentliche Domains – keine gesperrten Texte. */
export interface CheckSummary {
  brand: { name: string; domain: string; description: string | null };
  prompts: number;                 // gemessene Fragen (10)
  promptsMentioned: number;        // Fragen, in denen die eigene Marke mindestens einmal genannt wurde
  responses: number;               // ausgewertete Antworten
  visibility: number;              // Anteil Antworten mit Nennung, 0..1 (Stichprobe)
  topCompetitor: { name: string; promptsMentioned: number } | null;
  competitors: { name: string; promptsMentioned: number }[];  // höchstens 5, absteigend
  topDomains: { domain: string; count: number }[];             // Top-3 zitierte Domains
  engines: { engine: string; responses: number; mentioned: number }[];
  recommendationCounts: Record<RecArea, number>;
  recommendationsTotal: number;
  freeRecommendationIds: string[];
  technical: { robotsBlocksAi: boolean | null; jsOnly: boolean | null } | null;
}

export interface CheckView {
  token: string;
  status: CheckStatus;
  url: string;
  domain: string;
  locale: 'de' | 'en';
  emailMasked: string | null;      // z. B. „m***@firma.de“
  emailVerified: boolean;
  createdAt: string;
  readyAt: string | null;
  error: string | null;            // nutzerfreundlicher Fehlerschlüssel (CheckError) oder null
  /** vor dem Ende: erkannte Marke/Wettbewerber/Fragen zur Anzeige während des Wartens */
  discovered: { brandName: string; description: string | null; competitors: string[]; prompts: string[] } | null;
  summary: CheckSummary | null;
  freeRecommendations: TeaserRecommendation[];   // nur die freien (höchstens 2)
  turnstileSiteKey: string | null;
}

export interface ReportView {
  id: string; workspaceId: string; tier: ReportTier; kind: ReportKind;
  status: 'pending_payment' | 'paid' | 'measuring' | 'ready' | 'failed' | 'canceled' | 'refunded';
  amountCents: number; currency: string; previousReportId: string | null;
  collectionId: string | null; createdAt: string; paidAt: string | null; startedAt: string | null; readyAt: string | null;
  hasPdf: boolean; emailedAt: string | null; error: string | null;
  /** Fortschritt der Messung (nur bei measuring) */
  progress: { done: number; total: number } | null;
}
