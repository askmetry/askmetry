// Askmetry – Datenbankschema (Domänen-Tabellen).
// Auth-Tabellen (better-auth) liegen in ./auth-schema.ts und werden hier re-exportiert.
import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

export * from './auth-schema.ts';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const workspaceRef = () => uuid('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' });

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'viewer']);
export const collectionStatus = pgEnum('collection_status', ['queued', 'running', 'done', 'failed', 'budget_exceeded']);
export const collectionTrigger = pgEnum('collection_trigger', ['scheduled', 'manual', 'import']);
export const runStatus = pgEnum('run_status', ['pending', 'running', 'done', 'failed', 'skipped']);
export const sentiment = pgEnum('sentiment', ['positive', 'neutral', 'negative']);
export const citationKind = pgEnum('citation_kind', ['cited', 'searched']);

// Ein Workspace = ein Mandant (Kunde/Team). Alle Daten hängen an workspace_id.
export const workspace = pgTable('workspace', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Wochenplan als Cron-Ausdruck in Europe/Berlin (Standard: Montag 03:17)
  scheduleCron: text('schedule_cron').notNull().default('17 3 * * 1'),
  // neue Workspaces messen erst nach bewusstem Einschalten automatisch (Kostenschutz)
  scheduleEnabled: boolean('schedule_enabled').notNull().default(false),
  // letzte Änderung von Messplan (Cron) oder Ein/Aus – ab hier zählt der Plan (kein Sofort-Lauf nach dem Einschalten)
  scheduleUpdatedAt: timestamp('schedule_updated_at', { withTimezone: true }),
  repetitions: integer('repetitions').notNull().default(2),
  // Engine-Keys, z. B. ['chatgpt','gemini','claude','google_aio','google_ai_mode']
  engines: text('engines').array().notNull().default(sql`ARRAY['chatgpt','gemini','claude','google_aio','google_ai_mode']::text[]`),
  // Monatliches Budget in USD; Läufe stoppen, wenn es erreicht ist
  monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 }).notNull().default('50'),
  country: text('country').notNull().default('DE'),
  language: text('language').notNull().default('de'),
  // Nur gehostete Version (ASKMETRY_HOSTED=1): 'check' = Arbeitsbereich eines Gratis-Schnell-Checks (ohne Mitglieder),
  // 'customer' = Arbeitsbereich eines Kunden (Messungen nur über gekaufte Berichte). null = selbst gehostet, unverändert.
  hostedKind: text('hosted_kind'),
  createdAt: createdAt(),
});

export const workspaceMember = pgTable('workspace_member', {
  workspaceId: workspaceRef(),
  userId: text('user_id').notNull(), // better-auth user.id
  role: memberRole('role').notNull().default('owner'),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]);

// Eigene Marke (isOwn) und Wettbewerber
export const brand = pgTable('brand', {
  id: id(),
  workspaceId: workspaceRef(),
  name: text('name').notNull(),
  aliases: text('aliases').array().notNull().default(sql`ARRAY[]::text[]`),
  domains: text('domains').array().notNull().default(sql`ARRAY[]::text[]`),
  isOwn: boolean('is_own').notNull().default(false),
  description: text('description'),
  // Art der Marke: 'provider' (Anbieter) | 'portal' (Vergleichsportal/Ratgeber) | 'retailer' (Händler) | 'other'; null = unbekannt
  kind: text('kind'),
  // Herkunft von Beschreibung/Typ: 'auto' (von der Website erkannt, noch nicht bestätigt) | 'user' (von Hand gesetzt/bestätigt); null = leer
  profileSource: text('profile_source'),
  profileCheckedAt: timestamp('profile_checked_at', { withTimezone: true }),
  // selbst hochgeladenes Logo (nur diese Marke; hat Vorrang vor dem Website-Logo in domain_logo)
  logoData: text('logo_data'),
  logoType: text('logo_type'),
  logoUpdatedAt: timestamp('logo_updated_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('brand_ws_idx').on(t.workspaceId)]);

export const topic = pgTable('topic', {
  id: id(),
  workspaceId: workspaceRef(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const prompt = pgTable('prompt', {
  id: id(),
  workspaceId: workspaceRef(),
  topicId: uuid('topic_id').references(() => topic.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  language: text('language').notNull().default('de'),
  country: text('country').notNull().default('DE'),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index('prompt_ws_idx').on(t.workspaceId)]);

// Ein Messdurchlauf (z. B. die Wochenmessung) über alle aktiven Prompts × Engines × Wiederholungen
export const collection = pgTable('collection', {
  id: id(),
  workspaceId: workspaceRef(),
  status: collectionStatus('status').notNull().default('queued'),
  trigger: collectionTrigger('trigger').notNull().default('manual'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  error: text('error'),
  // Optionaler Messumfang statt „alle aktiven Prompts × workspace.engines × workspace.repetitions“ (gehostete Checks/Berichte):
  // { promptIds?: string[], engines?: string[], repetitions?: number, engineMaxPrompts?: { [engine]: n }, batch?: boolean }
  plan: jsonb('plan'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('collection_ws_idx').on(t.workspaceId, t.createdAt),
  // höchstens eine aktive (wartende oder laufende) Messung je Workspace
  uniqueIndex('collection_one_active_idx').on(t.workspaceId).where(sql`status in ('queued', 'running')`),
]);

// Eine Abfrage: Prompt × Engine × Wiederholung innerhalb einer Collection
export const run = pgTable('run', {
  id: id(),
  collectionId: uuid('collection_id').notNull().references(() => collection.id, { onDelete: 'cascade' }),
  workspaceId: workspaceRef(),
  promptId: uuid('prompt_id').notNull().references(() => prompt.id, { onDelete: 'cascade' }),
  engine: text('engine').notNull(),
  model: text('model'),
  repetition: integer('repetition').notNull().default(1),
  status: runStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // Claude über die Message Batches API: ID des Batches, in dem der Run (status 'running') auf sein Ergebnis wartet.
  // Solche Runs gelten nie als hängend und werden nicht erneut eingereicht; Ergebnisse holt der Worker später ab.
  batchId: text('batch_id'),
  batchSubmittedAt: timestamp('batch_submitted_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('run_unique').on(t.collectionId, t.promptId, t.engine, t.repetition),
  index('run_status_idx').on(t.status),
  index('run_batch_idx').on(t.batchId).where(sql`batch_id is not null`),
]);

// Antwort einer Engine (1:1 zu run)
export const response = pgTable('response', {
  id: id(),
  runId: uuid('run_id').notNull().unique().references(() => run.id, { onDelete: 'cascade' }),
  workspaceId: workspaceRef(),
  answer: text('answer').notNull().default(''),
  answerType: text('answer_type'), // list | single_recommendation | explanation | refusal | empty
  noAiAnswer: boolean('no_ai_answer').notNull().default(false), // z. B. Google zeigt keine AI Overview
  // false = Antwort gespeichert, Auswertung (Marken) steht noch aus – der Worker holt sie nach
  analyzed: boolean('analyzed').notNull().default(true),
  usage: jsonb('usage'),
  raw: jsonb('raw'),
  createdAt: createdAt(),
});

// Markennennung in einer Antwort (eine Zeile pro Marke und Antwort; brandId null = ungetrackte Marke)
export const mention = pgTable('mention', {
  id: id(),
  responseId: uuid('response_id').notNull().references(() => response.id, { onDelete: 'cascade' }),
  workspaceId: workspaceRef(),
  brandId: uuid('brand_id').references(() => brand.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  sentiment: sentiment('sentiment').notNull().default('neutral'),
  recommended: boolean('recommended').notNull().default(false),
  snippet: text('snippet'),
  // nur bei ungetrackten Nennungen aussagekräftig: direkter Wettbewerber der eigenen Marke? (Analyse-Modell; null = unbekannt, z. B. ältere Messungen)
  isCompetitor: boolean('is_competitor'),
}, (t) => [index('mention_resp_idx').on(t.responseId), index('mention_brand_idx').on(t.brandId)]);

// Quelle einer Antwort. kind = cited (im Text zitiert) | searched (nur durchsucht, z. B. Claude ohne Inline-Zitate)
export const citation = pgTable('citation', {
  id: id(),
  responseId: uuid('response_id').notNull().references(() => response.id, { onDelete: 'cascade' }),
  workspaceId: workspaceRef(),
  url: text('url').notNull(),
  domain: text('domain').notNull(),
  title: text('title'),
  position: integer('position').notNull(),
  kind: citationKind('kind').notNull().default('cited'),
}, (t) => [index('citation_resp_idx').on(t.responseId), index('citation_domain_idx').on(t.workspaceId, t.domain)]);

// ---------------------------------------------------------------------------
// Maßnahmen: konkrete, priorisierte Handlungsempfehlungen je Workspace.
// Werden nach jeder abgeschlossenen Messung neu berechnet (regelbasierte Evidenz + KI-Formulierung).
// key ist stabil (z. B. 'outreach:chip.de'), damit Status und Verlauf über Messungen erhalten bleiben.
export const recommendationStatus = pgEnum('recommendation_status', ['open', 'in_progress', 'done', 'dismissed']);

export const recommendation = pgTable('recommendation', {
  id: id(),
  workspaceId: workspaceRef(),
  key: text('key').notNull(),
  // outreach | name_on_own_page | content_gap | technical | community | positioning | sentiment
  type: text('type').notNull(),
  title: text('title').notNull(),
  why: text('why').notNull(),              // 1–2 Sätze Begründung mit Zahlen
  steps: text('steps').array().notNull().default(sql`ARRAY[]::text[]`), // konkrete Schritte
  impact: integer('impact').notNull(),     // 1 gering · 2 mittel · 3 hoch
  effort: integer('effort').notNull(),     // 1 gering · 2 mittel · 3 hoch
  priority: numeric('priority', { precision: 8, scale: 3 }).notNull().default('0'), // höher = wichtiger
  // strukturierte Belege: { metrics: {...}, examples: [{ prompt, engine, url?, snippet? }], ... }
  evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
  // false = von der letzten Messung nicht mehr gestützt (Problem verschwunden oder Regel greift nicht mehr)
  active: boolean('active').notNull().default(true),
  status: recommendationStatus('status').notNull().default('open'),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
  // abgehakte Schritte (Indizes in steps), serverseitig, damit das Team sie teilt
  doneSteps: integer('done_steps').array().notNull().default(sql`'{}'::integer[]`),
  // Kennzahl zum Zeitpunkt des Statuswechsels auf in_progress/done (Wirkungsmessung)
  baseline: jsonb('baseline'),
  lastCollectionId: uuid('last_collection_id').references(() => collection.id, { onDelete: 'set null' }),
  generationCostUsd: numeric('generation_cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('recommendation_ws_key').on(t.workspaceId, t.key),
  index('recommendation_ws_idx').on(t.workspaceId, t.active, t.status),
]);

// Technischer Website-Check der eigenen Domain(s) (robots.txt, llms.txt, strukturierte Daten, Lesbarkeit ohne JS)
export const siteCheck = pgTable('site_check', {
  id: id(),
  workspaceId: workspaceRef(),
  domain: text('domain').notNull(),
  // { robots: { fetched, blocked: string[] }, llmsTxt: boolean, jsonLd: string[], textChars: number, title, ... }
  result: jsonb('result').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('site_check_ws_idx').on(t.workspaceId, t.checkedAt)]);

// Logos (Website-Icons) je Domain – öffentlich, deshalb workspace-übergreifend zwischengespeichert. status 'none' = kein Icon gefunden.
export const domainLogo = pgTable('domain_logo', {
  domain: text('domain').primaryKey(),
  status: text('status').notNull(), // 'ok' | 'none'
  contentType: text('content_type'),
  // Bild als Base64 (≤ 200 KB)
  data: text('data'),
  sourceUrl: text('source_url'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// Protokoll der KI-Formulierung von Maßnahmen (ein Eintrag je Generierung mit KI-Aufruf).
// Für die Monatsausgaben (Budget) zählen diese Kosten mit; recommendation.generation_cost_usd ist die Summe je Maßnahme.
export const recommendationGeneration = pgTable('recommendation_generation', {
  id: id(),
  workspaceId: workspaceRef(),
  collectionId: uuid('collection_id').references(() => collection.id, { onDelete: 'set null' }),
  model: text('model'),
  items: integer('items').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  createdAt: createdAt(),
}, (t) => [index('recommendation_generation_ws_idx').on(t.workspaceId, t.createdAt)]);

// ---------------------------------------------------------------------------
// Gehostete Version (ASKMETRY_HOSTED=1): Gratis-Schnell-Check, gekaufte Berichte, Funnel-Kennzahlen. Siehe HOSTED.md.

// Gratis-Schnell-Check: URL eingeben → Profil/Wettbewerber/Fragen → E-Mail bestätigen → kleine Messung → Teaser.
// status: discovering → awaiting_email → queued → measuring → ready | failed | blocked
export const checkRequest = pgTable('check_request', {
  id: id(),
  // geheimer Zugangsschlüssel für /check/<token> (32 Byte, base64url); wer ihn kennt, sieht den Teaser
  token: text('token').notNull().unique(),
  url: text('url').notNull(),
  domain: text('domain').notNull(),
  locale: text('locale').notNull().default('de'),
  status: text('status').notNull().default('discovering'),
  email: text('email'),
  // sha256 des Bestätigungscodes aus der E-Mail (Klartext nie speichern)
  verifyCodeHash: text('verify_code_hash'),
  verifySentAt: timestamp('verify_sent_at', { withTimezone: true }),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // sha256(IP + BETTER_AUTH_SECRET) für Ratenbegrenzung, nie die IP selbst
  ipHash: text('ip_hash'),
  workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
  collectionId: uuid('collection_id').references(() => collection.id, { onDelete: 'set null' }),
  // dieser Check zeigt das Ergebnis eines früheren Checks derselben Domain (30-Tage-Cache)
  reusedFromId: uuid('reused_from_id'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  error: text('error'),
  // Teaser-Zusammenfassung, beim Fertigstellen berechnet (Zahlen, keine gesperrten Texte)
  summary: jsonb('summary'),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  readyMailSentAt: timestamp('ready_mail_sent_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('check_request_domain_idx').on(t.domain, t.createdAt),
  index('check_request_ip_idx').on(t.ipHash, t.createdAt),
  index('check_request_status_idx').on(t.status),
]);

// Gekaufter Bericht. tier: compact (Standortbestimmung) | strategy (Strategiebericht); kind: initial | remeasure (Nachmessung).
// status: pending_payment → paid (wartet auf „Messung starten“) → measuring → ready | failed; canceled (Checkout abgebrochen/abgelaufen), refunded
export const report = pgTable('report', {
  id: id(),
  workspaceId: workspaceRef(),
  userId: text('user_id').notNull(),
  tier: text('tier').notNull(),
  kind: text('kind').notNull().default('initial'),
  status: text('status').notNull().default('pending_payment'),
  previousReportId: uuid('previous_report_id'),
  checkId: uuid('check_id').references(() => checkRequest.id, { onDelete: 'set null' }),
  // Zahlung (Stripe oder Fake-Anbieter in Entwicklung/E2E)
  paymentProvider: text('payment_provider').notNull().default('stripe'),
  checkoutSessionId: text('checkout_session_id').unique(),
  paymentIntentId: text('payment_intent_id'),
  invoiceId: text('invoice_id'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('eur'),
  // Kauf nur für Unternehmen: Bestätigung + AGB-Zustimmung mit Zeitpunkt
  b2bConfirmedAt: timestamp('b2b_confirmed_at', { withTimezone: true }),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  termsVersion: text('terms_version'),
  collectionId: uuid('collection_id').references(() => collection.id, { onDelete: 'set null' }),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  error: text('error'),
  // Strategiebericht: Zusatzfragen sind erzeugt (einmalig – danach nie erneut, auch wenn der Kunde Fragen deaktiviert)
  promptsGeneratedAt: timestamp('prompts_generated_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  pdfGeneratedAt: timestamp('pdf_generated_at', { withTimezone: true }),
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  // Erinnerung „Zeit für die Nachmessung“ (8 Wochen nach readyAt), einmalig
  remindedAt: timestamp('reminded_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('report_ws_idx').on(t.workspaceId, t.createdAt),
  index('report_user_idx').on(t.userId),
  index('report_status_idx').on(t.status),
]);

// PDF eines Berichts (getrennt, damit report-Zeilen klein bleiben). data = Base64.
export const reportFile = pgTable('report_file', {
  reportId: uuid('report_id').primaryKey().references(() => report.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull().default('application/pdf'),
  data: text('data').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: createdAt(),
});

// Funnel-Ereignisse für die Beta-Kennzahlen (keine personenbezogenen Daten in props).
// name: check_started | check_email_submitted | check_verified | check_ready | checkout_started | report_paid | report_started
//       | report_ready | report_emailed | remeasure_reminded | remeasure_paid | recommendation_done
export const funnelEvent = pgTable('funnel_event', {
  id: id(),
  name: text('name').notNull(),
  checkId: uuid('check_id'),
  reportId: uuid('report_id'),
  workspaceId: uuid('workspace_id'),
  userId: text('user_id'),
  props: jsonb('props'),
  createdAt: createdAt(),
}, (t) => [index('funnel_event_name_idx').on(t.name, t.createdAt)]);

// Abmeldung von Erinnerungs-Mails (Nachmessung) – E-Mail in Kleinbuchstaben
export const mailOptOut = pgTable('mail_opt_out', {
  email: text('email').primaryKey(),
  createdAt: createdAt(),
});
