# OpenGEO – Spezifikation & Konzept (v0.1, Entwurf)

> Arbeitstitel. Open-Source-Alternative zu Peec AI: misst, wie sichtbar Marken in KI-Suchmaschinen sind, welche Quellen diese nutzen, und leitet konkrete Maßnahmen ab.
> Stand: 31.10.2026 · Status: Konzept, Grundsatzentscheidungen in Kapitel 13, offene Fragen in Kapitel 14

---

## 1. Ziel in einem Satz

Für beliebig viele Marken regelmäßig dieselben Suchanfragen (Prompts) an ChatGPT, Gemini, Claude, Perplexity & Co. stellen, die Antworten auswerten (Wird die Marke genannt? An welcher Stelle? Wie? Welche Quellen werden zitiert?) und daraus eine priorisierte To-do-Liste zur Verbesserung ableiten.

## 2. Die drei Kernfragen der App

| Frage | Was die App liefert |
|---|---|
| **Wie gut werde ich genannt?** | Visibility, Share of Voice, Position, Sentiment – je Engine, Prompt, Thema, Zeitraum, im Vergleich zu Wettbewerbern |
| **Welche Quellen nutzen die KIs?** | Zitierte URLs & Domains, deren Typ (eigene Seite, Wettbewerber, Presse, Vergleichsportal, Forum/UGC, Wikipedia …), Häufigkeit, Trend |
| **Was muss ich tun?** | Gap-Analyse + konkrete Empfehlungen (Content, Quellen-Outreach, technische Maßnahmen), priorisiert nach Wirkung |

## 3. Begriffe

- **Brand** – eigene Marke (Name, Aliase/Schreibweisen, Domains, Produkte).
- **Competitor** – Wettbewerbermarke, gleiche Struktur wie Brand.
- **Topic** – Themencluster (z. B. „Dienstplan-Software für Arztpraxen“).
- **Prompt** – konkrete Frage, wie ein Nutzer sie einer KI stellt (z. B. „Welche Software eignet sich für Dienstpläne in einer Zahnarztpraxis?“). Mit Sprache, Land, Tags.
- **Engine** – eine KI-Suche (ChatGPT, Gemini, Google AI Overviews/AI Mode, Claude, Perplexity, Copilot, Grok, Mistral Le Chat …).
- **Run** – eine Ausführung Prompt × Engine × Zeitpunkt (mehrfach wiederholt wegen Zufälligkeit).
- **Mention** – Nennung einer Marke in einer Antwort.
- **Citation** – von der Engine angegebene Quelle (URL).

## 4. Kennzahlen (Metriken)

| Metrik | Definition |
|---|---|
| **Visibility** | Anteil der Antworten, in denen die Marke genannt wird (%) |
| **Share of Voice** | Nennungen der Marke / Nennungen aller getrackten Marken (%) |
| **Ø Position** | Durchschnittlicher Rang der Nennung in Listen/Empfehlungen (1 = zuerst genannt) |
| **Sentiment** | Tonalität der Nennung (positiv/neutral/negativ, Score 0–100) |
| **Citation Rate** | Anteil der Antworten, in denen eine eigene URL als Quelle zitiert wird |
| **Source Share** | Anteil einer Domain an allen Zitaten zu einem Thema |
| **Recommendation Rate** | Anteil, in dem die Marke explizit *empfohlen* wird (nicht nur erwähnt) |

KI-Antworten schwanken. Deshalb wird jeder Prompt pro Engine mehrfach ausgeführt (Standard: 3×), und Kennzahlen werden mit Stichprobengröße bzw. Konfidenzintervall angezeigt, damit man echte Trends von Rauschen unterscheiden kann.

## 5. Funktionsumfang

### 5.1 Setup
- Workspace → Brands → Competitors anlegen (Name, Aliase, Domains, Kurzbeschreibung).
- **Prompt-Generator:** Aus Website-URL + Branche schlägt ein LLM 20–50 realistische Prompts vor (informativ, vergleichend, transaktional, lokal). Nutzer wählt aus/editiert.
- **Wettbewerber-Erkennung:** Marken, die oft in Antworten auftauchen, aber nicht getrackt werden, werden automatisch vorgeschlagen.
- Prompts mit Sprache/Land (z. B. de-DE), Topic und Tags versehen.

### 5.2 Datenerhebung (Collector)
- Zeitplan je Projekt (täglich / wöchentlich / manuell).
- Pro Engine ein **Adapter** mit einheitlichem Ergebnisformat: `answer_text`, `citations[]`, `model`, `timestamp`, `raw`.
- Zwei Adapter-Arten (siehe Kapitel 6): **API** und **Browser (UI)**.
- Retries, Rate-Limits, Kosten-Tracking pro Run, Budget-Deckel.

### 5.3 Analyse (Parser)
1. **Marken-Erkennung:** String-/Alias-Matching + LLM-Extraktion (findet auch ungetrackte Marken).
2. **Position:** Reihenfolge der Nennungen; bei Listen der Listenplatz.
3. **Sentiment & Kontext:** LLM bewertet den Satz um die Nennung, speichert Snippet.
4. **Quellen:** URLs normalisieren, Domain extrahieren, Domain klassifizieren (eigene / Wettbewerber / Presse / Vergleichsportal / UGC wie Reddit / Wikipedia / Behörde / Sonstige). Klassifikation wird pro Domain gecacht.
5. **Antworttyp:** Liste, Einzelempfehlung, Erklärtext, Ablehnung.

### 5.4 Dashboard
- **Übersicht:** Visibility, SoV, Position, Sentiment als Zeitreihe; Ranking gegen Wettbewerber.
- **Prompts:** Tabelle aller Prompts mit Visibility je Engine (Heatmap); Klick → alle Antworten im Volltext mit hervorgehobenen Nennungen und Quellen.
- **Quellen:** Top-Domains und Top-URLs, gefiltert nach Engine/Topic; „Wo werden Wettbewerber zitiert, ich aber nicht?“
- **Engines:** Vergleich, welche KI die Marke wie behandelt.
- **Wettbewerber:** Kopf-an-Kopf-Vergleich.
- Filter überall: Zeitraum, Engine, Topic, Tag, Sprache/Land.

### 5.5 Empfehlungen („Was muss ich tun?“)
Regelbasiert + LLM-gestützt, jede Empfehlung mit Begründung (Daten) und geschätzter Wirkung:

| Typ | Beispiel |
|---|---|
| **Prompt-Lücke** | „Bei 12 Vergleichs-Prompts wird Wettbewerber X genannt, du nicht.“ |
| **Quellen-Outreach** | „Domain `vergleich-xy.de` wird in 30 % der Antworten zitiert und listet 4 Wettbewerber – dich nicht. → Eintrag/Kontakt.“ |
| **Content-Lücke** | „Zu ‚Kosten Dienstplan-Software‘ zitieren KIs Preisvergleichsartikel. Dir fehlt eine Preisseite / ein Vergleichsartikel.“ |
| **Eigene Seiten** | „Deine Seite /features wird nie zitiert; die Wettbewerberseite mit FAQ-Struktur schon.“ |
| **Technik-Check** | robots.txt sperrt `GPTBot`/`OAI-SearchBot`/`ClaudeBot`/`PerplexityBot`? `llms.txt` vorhanden? Schema.org (Organization, Product, FAQ)? Seite ohne JavaScript lesbar? Aktualität? |
| **Narrativ** | „Gemini beschreibt dich als ‚nur für Kliniken‘ – falsch. Quelle: veralteter Artikel Y.“ |
| **Sentiment** | „Negative Nennungen stammen überwiegend aus Reddit-Thread Z.“ |

Ausgabe als Aufgabenliste mit Status (offen/erledigt), damit man später sieht, ob eine Maßnahme die Kennzahlen bewegt hat.

### 5.6 Benachrichtigungen & Export
- Wöchentlicher Report (Telegram via vorhandenem `tg-send`, optional E-Mail).
- Alarme: Visibility-Einbruch, neuer Wettbewerber, neue häufig zitierte Quelle.
- CSV/JSON-Export, REST-API, später MCP-Server (damit man Claude direkt nach den Daten fragen kann).

## 6. Kernentscheidung: Wie fragen wir die KIs ab?

| | **A) Offizielle APIs mit Websuche** | **B) Browser-Automatisierung der Web-Oberflächen** |
|---|---|---|
| Beispiele | OpenAI Responses API + `web_search`, Gemini API + Google-Search-Grounding, Claude API + Web-Search-Tool, Perplexity Sonar API | Playwright steuert chatgpt.com, gemini.google.com, Google-Suche (AI Overviews / AI Mode), claude.ai, perplexity.ai |
| Realitätsnähe | Mittel – API-Antworten weichen von dem ab, was Endnutzer sehen | Hoch – genau das, was Nutzer sehen |
| Stabilität | Hoch | Niedrig – UI-Änderungen, Captchas, Logins |
| Rechtliches | Unproblematisch | Verstößt meist gegen Nutzungsbedingungen; Captchas dürfen nicht umgangen werden |
| Kosten | Pay-per-use pro Anfrage (+ Websuche-Gebühr) | Abo-Accounts, Proxys, Wartungsaufwand |
| Google AI Overviews | Nicht per API verfügbar | Nur so (oder über SERP-Drittanbieter-APIs) |

**Empfehlung:** Hybrid mit klarer Reihenfolge – **MVP nur mit APIs** (stabil, sauber, schnell gebaut). Für Google AI Overviews/AI Mode später einen SERP-API-Anbieter als Adapter anbinden. Browser-Automatisierung nur optional als Plugin, nicht im Kern.

Die Adapter-Schnittstelle ist so gebaut, dass beide Arten austauschbar sind und Ergebnisse als „API“ bzw. „UI“ markiert werden.

## 7. Architektur

```
┌──────────────┐   ┌───────────────┐   ┌─────────────────┐
│ Web-App      │   │ Scheduler     │   │ Worker          │
│ Next.js      │──▶│ (pg-boss Cron)│──▶│ Collector       │──▶ Engine-Adapter (API / UI)
│ Dashboard,   │   └───────────────┘   │ Parser (LLM)    │
│ REST-API     │                       │ Recommender     │
└──────┬───────┘                       └────────┬────────┘
       │                PostgreSQL               │
       └──────────────────▶◀────────────────────┘
```

- **Monorepo, TypeScript:** `apps/web` (Next.js), `apps/worker` (Node), `packages/adapters`, `packages/core` (Metriken, Parser), `packages/db` (Drizzle-Schema).
- **DB:** PostgreSQL (lokal via Docker/colima). Rohantworten zusätzlich als JSON gespeichert, damit man später neu parsen kann.
- **Queue/Scheduler:** pg-boss (läuft in Postgres, keine weitere Infrastruktur).
- **Parser-LLM:** günstiges Modell für Extraktion/Sentiment, strukturierte JSON-Ausgabe.
- **Betrieb:** `docker compose up` (web + worker + db). Läuft auf dem Mac mini; später auf jedem Server.
- **Lizenz:** z. B. AGPL-3.0 (schützt vor geschlossenen SaaS-Kopien) oder MIT (maximale Verbreitung) – offen.

## 8. Datenmodell (Kern)

```
workspace(id, name)
brand(id, workspace_id, name, aliases[], domains[], is_own, description)
topic(id, workspace_id, name)
prompt(id, workspace_id, topic_id, text, language, country, tags[], active)
engine(id, key, kind[api|ui], model, enabled)
run(id, prompt_id, engine_id, repetition, started_at, status, cost_usd, error)
response(id, run_id, answer_text, raw_json, answer_type)
mention(id, response_id, brand_id NULL, raw_name, position, sentiment, is_recommended, snippet)
citation(id, response_id, url, normalized_url, domain, position, title)
domain(id, domain, category, is_own_brand_id, is_competitor_brand_id)
recommendation(id, workspace_id, brand_id, type, title, body, evidence_json, impact, status, created_at)
```

Kennzahlen werden aus `mention`/`citation` berechnet (materialisierte Views pro Tag).

## 9. Kosten (gemessen am 31.10.2026)

Grundlage: Spike (20 Prompts × 5 Engines) und Kosten-Experiment (`spike/experiment.mjs`, 6 Prompts je Variante). Preise laut offiziellen Preisseiten, Stand 31.10.2026.

| Engine | Einstellung | Kosten/Anfrage | Bemerkung |
|---|---|---|---|
| ChatGPT | gpt-5.5, Suchkontext `low`, Denktiefe `low`, **flex** (ab 03.11.) | ~0,065 $ (ohne flex ~0,12 $) | Teure Standardeinstellung ~0,22 $. Abweichung zur günstigen Einstellung (Marken-Überlappung 0,43–0,46) = normale Schwankung zwischen zwei Läufen (0,46). gpt-5.4-mini: 0,02 $, aber deutlich andere Antworten (0,10) → nicht verwenden. |
| Claude | Sonnet 5.5, Denktiefe `medium`, max. 3 Suchen, Such-Anweisung | ~0,08 $ | Opus 5.5: ~0,19 $. Sonnet ohne Anweisung sucht oft gar nicht. Haiku 5.5: ~0,01 $, Option für knappe Budgets. |
| Gemini | gemini-3.5-flash + Google Search Grounding | ~0,01 $ | Grounding bis 5.000 Suchen/Monat kostenlos. |
| Google AI Overviews | DataForSEO Live + Nachladen | ~0,004 $ | Sporadische 40101-Fehler → Wiederholungen. Standard-Warteschlange wäre 3× günstiger. |
| Google AI Mode | DataForSEO Live | ~0,004 $ | |
| Auswertung | Claude Haiku 5.5 | < 0,001 $ | |

**Monat bei Standard-Einstellung** (20 Prompts × 2 Wiederholungen × wöchentlich ≈ 173 Anfragen je Engine): ChatGPT ~24 $, Claude ~12 $, Gemini ~2 $, Google ~1,5 $ → **~40 $ (~37 €)**. Ein Budget-Deckel pro Workspace stoppt Läufe bei Überschreitung.

Weitere Hebel für später: Batch-APIs (−50 % Tokens, Websuche teils unterstützt), Wiederholungen nur für Prompts mit unklarem Ergebnis, Haiku für Claude.

### 9.1 Qualitätstest vom 03.11.2026

Skript: `packages/core/scripts/quality-experiment.ts` (20 Prompts Paylindo + MediShift × 2 Wiederholungen, Rohdaten in `spike/quality/results/`). Referenz = teure Messung vom 31.10. (gpt-5.5 Standard, Claude Opus 5.5). Übereinstimmung = Jaccard der genannten Marken bzw. Quellen-Domains.

| Variante | $/Anfrage | Websuche genutzt | Marken: mit sich selbst | Marken: mit Referenz | Eigene Marke genannt |
|---|---|---|---|---|---|
| Referenz ChatGPT (gpt-5.5 Standard) | 0,26 | 100 % | – | – | 15 % |
| **gpt-5.5, low/low, flex** (neuer Standard) | **0,065** | 95 % | 0,42 | 0,38 | 18 % |
| chat-latest (Modell der ChatGPT-App) | 0,13* | 100 % | 0,39 | 0,29 | 13 % |
| Referenz Claude (Opus 5.5) | 0,18 | 85 % | – | – | 5 % |
| **Sonnet 5.5 + Such-Anweisung** (Standard) | **0,09** | 100 % | 0,46 | 0,21 | 18 % |

\* Kosten vorsichtig geschätzt (Abrechnung der Suche bei chat-latest unklar); Ø 1,1 Suchen, 3,4 Quellen-Domains und 5,2 Marken je Antwort (flex: 4,3 / 7,9).

Ergebnisse:
- **Größte Unsicherheit ist der Zufall, nicht das Modell:** Zwei Läufe derselben Einstellung teilen nur ~40–46 % der Marken. Belastbare Aussagen entstehen erst über viele Prompts × Wiederholungen; Einsparungen lieber in Wiederholungen stecken.
- **ChatGPT flex:** gleiches Modell zum halben Tokenpreis; Abweichung zur Referenz im Rahmen der normalen Schwankung → Standard.
- **Claude Sonnet vs. Opus:** Sonnet sucht immer (Opus antwortete in 15 % ohne Websuche, also aus Trainingswissen) und ist das claude.ai-Standardmodell, weicht aber systematisch von Opus ab (0,21 < 0,46). Sonnet bleibt Standard, weil es dem Nutzererlebnis näher ist.
- **chat-latest** (vollständig gemessen, 40 Abfragen): doppelt so teuer wie flex, nennt weniger Marken und Quellen und weicht stärker von der Referenz ab (0,29 statt 0,38) → kein Vorteil, flex bleibt Standard.
- Wiederholungen bleiben vorerst bei 2 je Prompt (Entscheidung 03.11.2026).
- Offen: Claude-Batch-API (−50 % auf Tokens, Websuche unterstützt) im Runner.

## 10. Roadmap

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0 – Spike** (1–2 Tage) | Skript: je 10 Prompts für Paylindo und MediShift × ChatGPT, Gemini, Claude, Perplexity, Google AI Overviews; Antworten + Quellen als JSON + kurzer Bericht | Sehen, ob Daten brauchbar sind; echte Kosten pro Anfrage |
| **1 – MVP** | Mandantenfähiges Grundgerüst, Brands/Competitors/Prompts, 4 API-Engines + Google AI Overviews/AI Mode, Parser, Dashboard (Übersicht, Prompts, Quellen), wöchentlicher Lauf | Nutzbar für Paylindo & MediShift |
| **2 – Insights** | Empfehlungs-Engine, Technik-Check der Website, Prompt-Generator, Wettbewerber-Erkennung, Telegram-Report | Beantwortet „Was muss ich tun?“ |
| **3 – Ausbau** | Weitere Engines (Copilot, Le Chat …), Rollen/Teams, öffentliche API, MCP-Server | Team-tauglich |
| **4 – Open Source** | Doku, Docker-Image, Demo-Daten, Plugin-System für Adapter | Release |

## 11. Nicht-Ziele (vorerst)

- Kein Umgehen von Captchas oder Bot-Schutz.
- Keine automatische Content-Erstellung/Veröffentlichung (nur Empfehlungen).
- Kein klassisches SEO-Tool (Keyword-Rankings, Backlinks) – nur KI-Suche.

## 12. Risiken

- **API ≠ Nutzererlebnis:** Abweichungen offen ausweisen; stichprobenartig gegen die Web-Oberflächen vergleichen.
- **Zufälligkeit der Antworten:** Wiederholungen + Konfidenzintervalle.
- **Personalisierung/Standort:** Engines antworten je nach Land/Sprache anders → pro Prompt festlegen.
- **Kosten laufen davon:** Budget-Deckel, Kostenanzeige pro Lauf.
- **Engines ändern Modelle:** Modellversion pro Antwort speichern.

## 13. Entscheidungen (31.10.2026)

| Thema | Entscheidung | Folge für die Umsetzung |
|---|---|---|
| Zielgruppe | **OSS-Projekt mit späterer SaaS-Option** | Mandantenfähig von Anfang an (`workspace_id` überall, Login, Rollen); saubere Doku, `docker compose`-Setup, Adapter als Plugins. Lizenz eher AGPL-3.0 (Open-Core-/SaaS-Modell bleibt möglich). |
| Abfrage | **API zuerst, später hybrid** | MVP: OpenAI, Gemini, Claude, Perplexity per API. Phase 3: Google AI Overviews/AI Mode über SERP-API. Browser-Adapter nur optional. |
| Frequenz/Budget | **Wöchentlich, < 50 €/Monat** (für den Eigenbetrieb) | Standard: wöchentlicher Lauf, 3 Wiederholungen, ca. 50 Prompts × 4 Engines. Budget-Deckel pro Workspace; in der SaaS-Variante später frei wählbar. |
| Märkte | **DACH** | Prompts mit `language` + `country` (de-DE, de-AT, de-CH); Kennzahlen pro Land filterbar; Standort-Parameter der APIs nutzen, wo verfügbar. |

### Ergänzt am 31.10.2026 (zweite Runde)

| Thema | Entscheidung | Folge für die Umsetzung |
|---|---|---|
| Testmarken | **Paylindo** und **MediShift** | Zwei unterschiedliche Fälle, siehe 13.1 |
| Google | **Wichtig** | Google AI Overviews + AI Mode rücken **ins MVP** (über SERP-API-Anbieter, z. B. DataForSEO oder SerpApi – Preise und Abdeckung im Spike prüfen). Gemini-API zusätzlich. |
| Hosting | **Mac mini** | `docker compose` (Postgres via colima), Web-App auf Port **3010** (3000–3008 belegt), Worker mit integriertem Scheduler; Wochenbericht über `tg-send`. |
| Lizenz | **Echtes Open Source + spätere Hosted-Version** | Empfehlung: **AGPL-3.0** (siehe 13.2) |
| Name | offen | Arbeitstitel OpenGEO bleibt vorerst |

### 13.1 Testmarken

**Paylindo** (paylindo.de) – Vergleichsportal für Kartenzahlung/EC-Terminals in Deutschland.
- Besonderheit: Als Vergleichsportal ist das Ziel doppelt: (a) als *Empfehlung* genannt werden („Wo vergleiche ich EC-Terminals?“) und (b) als *Quelle zitiert* werden („Was kostet ein EC-Terminal?“). Die **Citation Rate** ist hier mindestens so wichtig wie die Visibility.
- Zu trackende Marken: Vergleichsportale (Wettbewerber) **und** Anbieter (SumUp, Payone, Zettle, myPOS u. a.), um zu sehen, welche Quellen die KIs bei Anbieterfragen nutzen.
- Beispiel-Prompts: „Welches EC-Kartengerät ist für ein kleines Café am günstigsten?“, „EC-Terminal kaufen oder mieten?“, „Kartenzahlungspflicht 2027 – was muss ich als Händler tun?“, „Payone Erfahrungen“.
- Paylindo hat bereits einen öffentlichen MCP-Server/ChatGPT-App – später interessant als eigener Signal-Kanal.

**MediShift** – Dienstplan- und Personalplanungssoftware für Arztpraxen.
- Beispiel-Prompts: „Welche Dienstplan-Software eignet sich für eine Zahnarztpraxis?“, „Urlaubsplanung für MFA digital organisieren“, „Zeiterfassung in der Arztpraxis – welche Software?“.
- Wettbewerber: Kandidaten (Papershift, Planday, Shiftbase u. a.) sind Vermutungen – im Spike über die Wettbewerber-Erkennung ermitteln und vom Nutzer bestätigen lassen.
- Je Prompt de-DE, ausgewählte Prompts zusätzlich de-AT/de-CH.

### 13.2 Lizenz-Empfehlung: AGPL-3.0

- Echtes Open Source (von der OSI anerkannt). Jeder darf die App nutzen, ändern und selbst betreiben.
- Wer sie **als Online-Dienst anbietet**, muss seine Änderungen ebenfalls offenlegen. Das schützt davor, dass ein Dritter einfach eine geschlossene Konkurrenz-Hosted-Version baut.
- Als Rechteinhaber darfst du selbst jederzeit eine Hosted-Version betreiben – auch mit Zusatzfunktionen.
- Bewährtes Modell, z. B. Plausible Analytics und Cal.com (AGPL + Hosted-Version).
- Für Beiträge Dritter: ein Contributor License Agreement (CLA) einführen, sobald externe Pull Requests kommen. Sonst gehören Teile des Codes anderen, und spätere Lizenz-Entscheidungen werden schwer.
- Alternative MIT: maximal offen, aber jeder könnte eine geschlossene Hosted-Version bauen.

## 14. Noch offene Fragen

1. Wettbewerber von MediShift und Paylindo bestätigen (nach dem Spike).
2. Projektname.
