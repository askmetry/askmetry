# OpenGEO

Open-Source-Werkzeug, das misst, wie sichtbar Marken in KI-Suchmaschinen sind – ChatGPT, Gemini, Claude, Google AI Overviews und Google AI Mode (Perplexity optional) –, welche Quellen diese KIs nutzen und wo die eigene Marke fehlt.

- **Übersicht:** Sichtbarkeit, Ø Position, Empfehlungsrate, Share of Voice, eigene Seite als Quelle – je Engine und im Vergleich zu Wettbewerbern
- **Prompts:** Heatmap Prompt × Engine, alle Antworten im Volltext mit markierten Marken und Quellen
- **Quellen:** meistgenutzte Domains, Seiten, auf denen Wettbewerber genannt werden (Outreach-Ziele), Antworten, die deine Seite nutzen, deine Marke aber nicht nennen
- **Lücken:** wo Wettbewerber genannt werden, du aber nicht
- **Einstellungen:** Marken, Prompts, Themen, Engines, Wiederholungen, Zeitplan, Monatsbudget, „Jetzt messen“

Lizenz: [AGPL-3.0](LICENSE). Spezifikation: [SPEC.md](SPEC.md) · Bau-Absprachen: [CONTRACT.md](CONTRACT.md)

## Schnellstart

Voraussetzungen: Node 24, pnpm, Docker.

```bash
cp .env.example .env                 # Schlüssel eintragen, BETTER_AUTH_SECRET setzen
pnpm install
pnpm db:up                           # Postgres auf Port 5433
pnpm db:push                         # Schema anlegen
pnpm dev                             # Dashboard auf http://localhost:3010
pnpm worker                          # Worker: Zeitplan + Warteschlange (zweites Terminal)
```

Konto unter `/signup` anlegen, Workspace erstellen, Marken und Prompts eintragen, „Jetzt messen“.

Beispieldaten (Paylindo + MediShift aus dem Prototyp, ohne API-Kosten): `pnpm --filter @opengeo/worker seed --owner du@example.com`

## Kosten

Standard-Einstellungen sind auf Kosten optimiert (Messwerte und Begründung: SPEC.md Kapitel 9). Bei 20 Prompts × 2 Wiederholungen × wöchentlich: ca. 40 $/Monat. Jeder Workspace hat einen Budget-Deckel; ist er erreicht, werden weitere Abfragen übersprungen. `OPENGEO_MOCK_ENGINES=1` ersetzt alle Engines durch einen kostenlosen Mock.

Kostenschutz für gehostete Instanzen:

- Neue Workspaces starten mit **ausgeschaltetem Zeitplan** – automatische Messungen erst nach bewusstem Einschalten in den Einstellungen.
- `OPENGEO_MAX_BUDGET_USD` (Standard `200`): Obergrenze für das Monatsbudget je Workspace. Höhere Werte lehnt die Web-App ab; der Worker deckelt zusätzlich auf diesen Wert.
- `OPENGEO_ALLOW_SIGNUP` (Standard `true`): mit `false` ist die Selbstregistrierung abgeschaltet (better-auth `disableSignUp`, `/signup` zeigt einen Hinweis). Konten dann z. B. lokal anlegen, bevor die Variable gesetzt wird.
- Monatsausgaben = Summe der Run-Kosten nach Abschlusszeitpunkt (Europe/Berlin); auch bezahlte Fehlversuche werden verbucht.
- Fehlt `ANTHROPIC_API_KEY` (Auswertung), bricht der Worker eine echte Messung vor dem ersten Engine-Aufruf ab. Scheitert nur die Auswertung, bleibt die Antwort gespeichert und wird beim nächsten Worker-Durchgang (`once`/`start`) ohne neuen Engine-Aufruf ausgewertet.

## Tests

```bash
pnpm typecheck
pnpm test                            # Unit- + Integrationstests (Mock-Engines, Datenbank opengeo_test)
node e2e/full-flow.mjs login|check|create|verify   # Browser-Test gegen http://localhost:3010 (Zugang in .e2e-credentials)
```

`create` + `verify` lösen mit dem Worker eine echte Messung aus (1 Prompt × 5 Engines ≈ 0,25 $).

## Struktur

```
packages/db      Drizzle-Schema, DB-Client
packages/core    Engine-Adapter, Preise, Auswertung, Messlauf mit Budgetprüfung
apps/worker      Zeitplan-Schleife + CLI (seed, collect, once), launchd-Vorlagen
apps/web         Next.js-Dashboard mit Login und Mandantentrennung
spike/           Prototyp und Kosten-Experiment
e2e/             Browser-Test
```

Dauerbetrieb auf dem Mac mini: siehe [apps/worker/README.md](apps/worker/README.md).
