# Askmetry – gehostete Version (Paket 2)

Bau-Vertrag für die gehostete Beta auf askmetry.ai (Betreiber: lindotech GmbH). Ergänzt [CONTRACT.md](CONTRACT.md) – dessen Regeln gelten weiter (keine echten API-Aufrufe in Tests, Mock-Engines, Port 3010, Schlüssel nie ausgeben, kein `git commit`, keine Services installieren).

**Grundsatz:** Alles Gehostete ist hinter `ASKMETRY_HOSTED=1`. Ohne diese Variable verhält sich Askmetry exakt wie bisher (Selbst-Hosting). Jede neue Funktion prüft `isHosted()` aus `@askmetry/core/hosted/config`.

## Produkt (Entscheidungen vom 05.11.2026)

| Angebot | Inhalt | Preis netto (Beta) |
|---|---|---|
| **Schnell-Check** (gratis) | URL → Markenprofil, Wettbewerber, 10 Fragen; nach E-Mail-Bestätigung: Gemini, Google AI Overviews, Google AI Mode für alle 10 Fragen, ChatGPT für die ersten 5, je 1×; Website-Technikcheck; Maßnahmen | 0 € |
| **Standortbestimmung** (`compact`) | 20 Fragen × 3 Wiederholungen × 5 KIs, bis 3 Wettbewerber, alle Maßnahmen mit Schritten und fertigen Prompts, Quellen, **PDF + E-Mail-Versand** | 99 € (Beta 79 €) |
| **Strategiebericht** (`strategy`) | 60 Fragen in Themen, 3 Wiederholungen × 5 KIs, bis 5 Wettbewerber, Quellen je Thema, 90-Tage-Plan, **PDF + E-Mail-Versand** | 299 € (Beta 249 €) |
| **Nachmessung** (`kind = remeasure`) | gleiche Fragen und Einstellungen wie der vorige Bericht, Vorher/Nachher-Vergleich, PDF + E-Mail | 39 € / 119 € |

- Nachmessung ist **nicht** im Preis enthalten. 8 Wochen nach einem fertigen Bericht kommt eine einmalige Erinnerungsmail mit Abmeldelink.
- **Nur Unternehmen** (B2B): Häkchen „Ich kaufe als Unternehmer (§ 14 BGB)“ + AGB-Zustimmung vor dem Bezahlen, mit Zeitpunkt in `report`.
- Teaser zeigt: groben Sichtbarkeitswert („Stichprobe“), „in X von 10 Fragen genannt“, stärksten Wettbewerber mit seiner Zahl, Top-3 zitierte Domains, **Anzahl der Maßnahmen je Bereich** (Eigene Inhalte · Auf anderen Seiten · Community · Technik) und **2 Maßnahmen vollständig** (möglichst 1 Technik + 1 Inhalt). Alle anderen Maßnahmen: **weder Titel noch Text** – nur die Zahl. Keine erfundenen Zahlen.
- Abo, Agentur-Pakete, Perplexity: später, nicht in Paket 2.

## Umgebungsvariablen (alle optional, außer wo „Pflicht bei HOSTED“)

| Variable | Bedeutung | Standard |
|---|---|---|
| `ASKMETRY_HOSTED` | `1` = gehostete Version an | aus |
| `ASKMETRY_PUBLIC_URL` | öffentliche Basis-URL für Links in Mails/Stripe (Pflicht bei HOSTED) | `BETTER_AUTH_URL` bzw. `http://localhost:3010` |
| `ASKMETRY_CHECKS_ENABLED` | `0` = Notschalter für neue Schnell-Checks | an |
| `ASKMETRY_CHECK_DAILY_BUDGET_USD` | Summe aller Check-Kosten pro Kalendertag (Europe/Berlin); darüber keine neuen Checks | 10 |
| `ASKMETRY_CHECK_LIMIT_PER_IP` / `_PER_EMAIL` | neue Checks je 24 h | 3 / 3 |
| `ASKMETRY_CHECK_DISCOVERIES_PER_HOUR` | neue Discoveries (kosten vor der E-Mail-Bestätigung) insgesamt pro Stunde | 30 |
| `ASKMETRY_CHECK_CACHE_DAYS` | Ergebnis je Domain wiederverwenden | 30 |
| `ASKMETRY_GLOBAL_DAILY_BUDGET_USD` | Notbremse für alle KI-Kosten pro Tag (Checks + Berichte); darüber starten keine neuen Messungen | 150 |
| `ASKMETRY_REPORT_BUDGET_USD_COMPACT` / `_STRATEGY` | Budget-Deckel je Bericht-Arbeitsbereich und Monat | 40 / 120 |
| `ASKMETRY_PAYMENTS` | `stripe` oder `fake` (nur Entwicklung/E2E; in Produktion verboten) | `stripe` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (Testmodus in Paket 2) | – |
| `STRIPE_PRICE_COMPACT`, `STRIPE_PRICE_STRATEGY`, `STRIPE_PRICE_REMEASURE_COMPACT`, `STRIPE_PRICE_REMEASURE_STRATEGY` | Price-IDs (Einmalzahlung, netto, `tax_behavior: exclusive`) | – |
| `STRIPE_AUTOMATIC_TAX` | `1` = Stripe Tax; sonst fester Steuersatz `STRIPE_TAX_RATE_ID` | aus |
| `ASKMETRY_PRICE_*_CENTS` | Anzeigepreise (COMPACT, STRATEGY, REMEASURE_COMPACT, REMEASURE_STRATEGY) und Listenpreise (`..._LIST_CENTS`) | 7900/24900/3900/11900, Liste 9900/29900 |
| `SMTP_URL` | z. B. `smtps://user:pass@smtp-relay.brevo.com:465` | – (dann Outbox) |
| `MAIL_FROM` | Absender, z. B. `Askmetry <hallo@askmetry.ai>` | `Askmetry <noreply@localhost>` |
| `ASKMETRY_MAIL_OUTBOX` | Ordner: Mails als `.eml` + `.json` ablegen statt senden (Entwicklung, E2E) | ohne SMTP: `./.mail-outbox` |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile beim Check; ohne Schlüssel wird übersprungen (Warnung im Log) | – |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Betriebs-Meldungen (Kauf, Fehler, Budget) | – |

Konfiguration lesen **nur** über `packages/core/src/hosted/config.ts` (eine Stelle, Standardwerte dort).

## Datenmodell (packages/db/src/schema.ts, Migration 0001)

- `workspace.hosted_kind`: `check` (Arbeitsbereich eines Schnell-Checks, **ohne Mitglieder**) | `customer` (Kunde, Messungen nur über Berichte) | null (selbst gehostet).
- `collection.plan` (jsonb, `CollectionPlan` in runner.ts): `promptIds`, `engines`, `repetitions`, `engineMaxPrompts`, `batch`. `createCollection(wsId, trigger, plan?)`.
- `check_request`: ein Schnell-Check (Token = Zugang zum Teaser). Status: `discovering` → `awaiting_email` → `queued` → `measuring` → `ready` | `failed` | `blocked`.
- `report`: gekaufter Bericht. Status: `pending_payment` → `paid` → `measuring` → `ready` | `failed`; außerdem `canceled`, `refunded`.
- `report_file`: PDF (Base64). `funnel_event`: Kennzahlen. `mail_opt_out`: Abmeldungen.

## Ablauf

1. **Startseite** (`/`, nur HOSTED; sonst wie bisher Weiterleitung): URL-Feld → `POST` Server Action `startCheck(url)` → `/check/<token>`.
2. **Discovery** (Worker, Status `discovering`): Website lesen (safe-fetch), Markenprofil (`inferBrandProfile`), dann **ein** Sonnet-Aufruf ohne Websuche: bis 5 Wettbewerber (Name + Domain) und 20 Kundenfragen (Sprache des Checks, ohne eigenen Markennamen, gemischt: Kategorie, Problem, Vergleich, Alternative, Kaufentscheidung). Legt Arbeitsbereich (`hosted_kind = check`) mit Marken, Thema und Prompts an. Kosten auf `check_request.cost_usd`. → `awaiting_email`.
3. **E-Mail-Gate** (Web): E-Mail + Turnstile → Bestätigungsmail mit Link `/check/<token>/bestaetigen?code=…` (Code 24 h gültig). Klick → `queued`.
4. **Messung** (Worker): Collection mit Plan `{ promptIds: erste 10, engines: [gemini, google_aio, google_ai_mode, chatgpt], repetitions: 1, engineMaxPrompts: { chatgpt: 5 } }`, Maßnahmen wie gewohnt (`finalizeCollection`). → `ready`, `summary` berechnen, Mail „Dein Schnell-Check ist fertig“ mit Link.
5. **Teaser** (`/check/<token>`): Zahlen aus `summary` + 2 freie Maßnahmen; Kauf-Buttons für beide Berichte.
6. **Kauf**: angemeldet sein (sonst Registrierung; E-Mail aus dem Check vorbelegt) → Formular B2B + AGB → `createCheckout({ tier, checkId | workspaceSlug, kind })` → Stripe Checkout (`mode: payment`, Rechnung, USt-ID-Feld, Rechnungsadresse Pflicht) bzw. Fake-Checkout. Webhook `checkout.session.completed` → `markReportPaid(sessionId, …)` (idempotent).
7. **Bericht vorbereiten** (`/w/<slug>/bericht/<id>`): Kunde prüft Fragen (20 bzw. 60, für `strategy` werden beim Bezahlen 40 weitere in Themen erzeugt) und Wettbewerber, dann „Messung starten“ → `startReport(reportId)` → Collection mit Plan (Prompts des Berichts, 5 KIs, 3 Wiederholungen, `batch: true`). Nachmessung startet direkt mit denselben Prompt-IDs.
8. **Fertig** (Worker, nach `finalizeCollection`): PDF erzeugen → `report_file`, Mail mit PDF-Anhang und Link → `ready`. Telegram: Kauf und Fehler.
9. **Erinnerung** (Worker, täglich): 8 Wochen nach `ready_at` einmalig Mail „Zeit für die Nachmessung?“ (nicht bei Abmeldung).

**Arbeitsbereich beim Kauf:** Gehört der Check-Arbeitsbereich noch niemandem, wird er zum Kunden-Arbeitsbereich (`hosted_kind = customer`, Käufer = owner). Sonst wird er kopiert (Marken, Themen, Prompts – keine Messdaten). Ein Kunde kann einen Arbeitsbereich pro Marke haben.

**In Kunden-Arbeitsbereichen (HOSTED) gesperrt:** „Jetzt messen“, Zeitplan, Monatsbudget, Engine-Auswahl, Wiederholungen, neuer Arbeitsbereich per Formular. Stattdessen „Nachmessung kaufen“ / „Bericht kaufen“. Fragen und Wettbewerber sind bearbeitbar, solange kein Bericht misst.

## Module und Zuständigkeiten (Dateien nur in eigenem Bereich ändern)

| Bereich | Dateien | Verantwortlich |
|---|---|---|
| Schema, Migrationen, Runner-Plan, dieser Vertrag | `packages/db/**`, `packages/core/src/runner.ts`, `HOSTED.md` | Lead |
| Hosted-Kern | `packages/core/src/hosted/**` (config, checks, discovery, reports, limits, funnel, notify, stats), Tests in `packages/core/test/**/hosted*` | Backend |
| Worker-Jobs | `apps/worker/src/**` | Backend |
| Mail | `packages/core/src/mail/**` (Mailer + Vorlagen DE/EN) | PDF & Mail |
| PDF | neues Paket `packages/report` (`@askmetry/report`, @react-pdf/renderer) | PDF & Mail |
| Bezahlung | `apps/web/lib/billing/**`, `apps/web/app/api/stripe/**`, `apps/web/app/kasse/**` (Fake-Checkout), `scripts/stripe-setup.ts` | Billing |
| Web-Oberfläche | übrige `apps/web/**` inkl. i18n | Web |
| Rechtstexte | `apps/web/content/legal/*.md` | Recht |
| E2E | `e2e/hosted-flow.mjs` | Lead |

## Schnittstellen (Signaturen sind verbindlich; Stubs liegen bereits an Ort und Stelle)

```ts
// @askmetry/core/hosted/config
isHosted(): boolean; publicUrl(): string; hostedConfig(): HostedConfig  // alle Werte aus der Tabelle oben
// @askmetry/core/hosted/checks
startCheck(input: { url: string; locale: 'de'|'en'; ipHash: string | null }): Promise<{ token: string } | { error: CheckError }>
submitCheckEmail(token: string, email: string): Promise<{ ok: true } | { error: CheckError }>   // schickt Bestätigungsmail
verifyCheckEmail(token: string, code: string): Promise<{ ok: true } | { error: CheckError }>
getCheckView(token: string): Promise<CheckView | null>        // alles, was der Teaser braucht (ohne gesperrte Texte!)
processChecks(opts?): Promise<void>                            // Worker: discovery + Messung anstoßen + fertigstellen + Mails
hashIp(ip: string): string
// @askmetry/core/hosted/reports
prepareReport(input: { userId; tier; kind; checkId?; workspaceId?; amountCents; b2bConfirmedAt; termsAcceptedAt; termsVersion; provider }): Promise<{ reportId; workspaceId; slug }>
attachCheckoutSession(reportId, sessionId): Promise<void>
markReportPaid(input: { sessionId; paymentIntentId?; invoiceId?; amountCents? }): Promise<{ reportId; already: boolean } | null>
markReportCanceled(sessionId): Promise<void>
startReport(reportId, userId): Promise<{ ok: true } | { error: string }>
processReports(opts?): Promise<void>                           // Worker: fertige Messungen → PDF → Mail → ready; Erinnerungen
reportsForWorkspace(workspaceId), getReport(reportId)
// @askmetry/core/hosted/funnel
trackEvent(name, fields?): Promise<void>
// @askmetry/core/hosted/notify
notifyOps(text): Promise<void>                                 // Telegram, still ohne Konfiguration, nie werfen
// @askmetry/core/mail
sendMail({ to, subject, html, text, attachments? }): Promise<void>
mailTemplates.checkVerify / checkReady / reportReady / remeasureReminder / authVerify / authReset  → { subject, html, text }
// @askmetry/report
renderReportPdf(reportId: string): Promise<Buffer>
```

## Qualität

- Jede Datei mit Logik bekommt Tests (vitest; Integrationstests gegen `askmetry_test`). Keine echten API-Aufrufe: Mock-Engines, Fake-Zahlung, Mail-Outbox, KI-Aufrufe über injizierbare Funktionen (wie `ProfileAsker`).
- Sicherheit: Check-Token und Bestätigungscodes mit `crypto.randomBytes`, Codes nur gehasht speichern, Vergleich zeitkonstant. Webhook-Signatur prüfen, Bezahlstatus nur aus dem Webhook (nie aus der Redirect-URL). Mandantenprüfung wie bisher über `requireWorkspace`. Keine personenbezogenen Daten in Logs/Telegram (E-Mail höchstens maskiert).
- Texte: Deutsch (Standard) und Englisch, Leitplanken aus DESIGN.md (answer first, schlicht) und GEO-PLAYBOOK.md (nur realistische Maßnahmen).
