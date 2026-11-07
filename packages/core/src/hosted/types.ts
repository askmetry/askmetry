// Gemeinsame Typen der gehosteten Version (Web ↔ Kern). Siehe HOSTED.md.
import type { ReportKind, ReportTier } from './config.ts';

/** awaiting_email: nur noch Altbestand (früheres E-Mail-Gate); neue Checks gehen nach der Discovery direkt in queued. */
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
  | 'code_expired'
  | 'locked'            // Fragen/Themen nach dem Kauf nicht mehr am Check änderbar
  | 'too_many'          // mehr Fragen/Themen als erlaubt
  | 'too_few'           // letzte Frage lässt sich nicht löschen
  | 'too_short'
  | 'too_long'
  | 'duplicate'
  | 'brand_limit';      // eigene Marke in zu vielen Fragen

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
  /** Antworten mit Nennung der eigenen Marke (Zähler von `visibility`; fehlt in älteren Summaries) */
  responsesMentioned?: number;
  visibility: number;              // Anteil Antworten mit Nennung, 0..1 (Stichprobe) – gleiche Kennzahl wie der Score im Bericht
  /** true = Messung lief mit simulierten Antworten (Mock-Modus) – nie als echtes Ergebnis zeigen */
  simulated?: boolean;
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
  /** Arbeitsstand für die Checkliste der Warteansicht – nur echte Zustände aus der Datenbank, keine Texte der Discovery außer dem Markennamen */
  progress: CheckProgress;
  summary: CheckSummary | null;
  freeRecommendations: TeaserRecommendation[];   // nur die freien (CHECK_SCOPE.freeRecommendations)
  turnstileSiteKey: string | null;
  /** erster Zwischenstand wurde schon angezeigt (Funnel check_progress_seen) */
  progressSeen: boolean;
  /** Einwilligung in Erinnerung + Tipps per Mail liegt vor */
  marketingConsent: boolean;
  /** Zwischenstände für die Warteansicht (Marke, Wettbewerber, gemessene Fragen, erste Antworten); null vor der Discovery-Planung */
  live: CheckLive | null;
  /** konkrete Befunde fürs Ergebnis (nur bei ready) */
  findings: CheckFindings | null;
  /** die 20 Fragen der Standortbestimmung (nur bei ready) */
  questions: CheckQuestions | null;
  /** Themen für den Strategiebericht (nur bei ready; leer = KI wählt beim Kauf) */
  topics: string[];
  /** Fragen/Themen sind noch änderbar (fertig, noch kein bezahlter Bericht aus diesem Check) */
  editable: boolean;
}

/** Eine KI-Antwort der Check-Messung, wie sie die Warteansicht live zeigt. Nur Markennamen, kein Antworttext. */
export interface LiveAnswer {
  id: string;
  engine: string;
  question: string;
  /** genannte Marken in Reihenfolge der Nennung (eigene markiert; nur getrackte Marken und erkannte Wettbewerber) */
  brands: { name: string; own: boolean }[];
  ownNamed: boolean;
  /** analyzed = ausgewertet · pending = Auswertung läuft · empty = keine KI-Antwort (z. B. keine AI Overview) */
  state: 'analyzed' | 'pending' | 'empty';
}

export interface CheckLive {
  /** Kurzbeschreibung aus dem Markenprofil (falls erkannt) */
  description: string | null;
  competitors: string[];
  /** die gerade gemessenen Fragen (erste CHECK_SCOPE.measured) */
  questions: string[];
  /** neueste Antworten zuerst (höchstens CHECK_LIVE_ANSWERS) */
  answers: LiveAnswer[];
  /** alle bisher eingegangenen Antworten */
  answersTotal: number;
}

/** Ein konkreter Fall: auf <Frage> nennt <KI> <Wettbewerber> – dich nicht (bzw. bei `own` dich). */
export interface FindingCase {
  engine: string;
  question: string;
  /** genannte Wettbewerber (höchstens 3, Reihenfolge der Nennung) */
  competitors: string[];
  /** kurzer Ausschnitt aus der Antwort um die Nennung, reiner Text (ohne Markdown/HTML) */
  excerpt: string | null;
}

export interface CheckFindings {
  /** Antworten mit Wettbewerbern, aber ohne dich – höchstens 3, möglichst verschiedene KIs und Fragen */
  gaps: FindingCase[];
  /** Fallback ohne Lücken: Antworten, in denen du genannt wirst */
  wins: FindingCase[];
  /** Antworten, in denen irgendein Wettbewerber genannt wird, ohne dich (Zähler für „in X von Y“) */
  gapAnswers: number;
  answers: number;
  simulated: boolean;
}

export interface CheckQuestions {
  list: string[];
  /** vom Nutzer geändert (sonst Vorschlag der Discovery) */
  edited: boolean;
  max: number;
}

export interface CheckProgress {
  /** Discovery-Schritt (nur während discovering): read → profile → plan */
  stage: 'read' | 'profile' | 'plan' | null;
  /** erkannte (während der Discovery: vorläufige) Marke */
  brandName: string | null;
  competitors: number;
  /** gemessene Fragen (erste CHECK_SCOPE.measured) */
  prompts: number;
  /** Fortschritt je KI-Suche der Check-Messung (Reihenfolge wie CHECK_SCOPE.engines); leer, solange keine Messung angelegt ist */
  engines: { engine: string; done: number; total: number }[];
  /** alle Abfragen beendet, Auswertung der Antworten läuft noch */
  analyzing: boolean;
  /** Antworten ausgewertet, Maßnahmen werden abgeleitet */
  recommending: boolean;
}

export interface ReportView {
  id: string; workspaceId: string; tier: ReportTier; kind: ReportKind;
  status: 'pending_payment' | 'paid' | 'measuring' | 'ready' | 'failed' | 'canceled' | 'refunded';
  amountCents: number; currency: string; previousReportId: string | null;
  collectionId: string | null; createdAt: string; paidAt: string | null; startedAt: string | null; readyAt: string | null;
  hasPdf: boolean; emailedAt: string | null; error: string | null;
  /** Strategiebericht: Zusatzfragen werden noch erzeugt (Start erst danach möglich) */
  promptsPreparing: boolean;
  /** Fortschritt der Messung (nur bei measuring) */
  progress: { done: number; total: number } | null;
}
