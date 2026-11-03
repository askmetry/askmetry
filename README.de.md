# OpenGEO

Open-Source-Werkzeug, das misst, wie sichtbar Marken in KI-Suchmaschinen sind – ChatGPT, Gemini, Claude, Google AI Overviews und Google AI Mode (Perplexity optional) –, welche Quellen diese KIs nutzen und wo die eigene Marke fehlt. Daraus leitet es konkrete Maßnahmen ab.

Selbst gehostet, mandantenfähig, AGPL-3.0. Eigene API-Schlüssel, Abrechnung direkt bei den Anbietern.

[English version](README.md) (Haupt-README, dort auch alle Umgebungsvariablen im Detail)

- **Übersicht:** Sichtbarkeit, Ø Position, Empfehlungsrate, Share of Voice, eigene Seite als Quelle – je Engine und im Vergleich zu Wettbewerbern
- **Maßnahmen:** belegte Empfehlungen (eigene Inhalte, andere Seiten, Community, Technik) aus jeder Messung, je mit kopierfertigem Prompt für die eigene KI
- **Fragen:** Heatmap Frage × Engine, alle Antworten im Volltext mit markierten Marken und Quellen; Filter für Lücken (Wettbewerber genannt, du nicht)
- **Quellen:** meistgenutzte Domains, Seiten, auf denen Wettbewerber genannt werden (Outreach-Ziele), Antworten, die deine Seite nutzen, deine Marke aber nicht nennen
- **Einstellungen:** Marken, Wettbewerber, Fragen, Themen, Engines, Wiederholungen, Zeitplan, Monatsbudget, „Jetzt messen“
- **Oberfläche zweisprachig:** Deutsch und Englisch

Lizenz: [AGPL-3.0](LICENSE). Spezifikation: [SPEC.md](SPEC.md) · Bau-Absprachen: [CONTRACT.md](CONTRACT.md) · Mitmachen: [CONTRIBUTING.md](CONTRIBUTING.md)

## Selbst hosten mit Docker

```bash
cp .env.example .env     # POSTGRES_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL und API-Schlüssel eintragen
docker compose up -d     # baut die Images, legt das Schema an, startet db, web und worker
```

Dashboard unter <http://localhost:3010> (Port: `OPENGEO_PORT`; gebunden an `127.0.0.1`, für öffentlichen Zugriff einen Reverse-Proxy mit TLS davorsetzen). `OPENGEO_MOCK_ENGINES=1` zum kostenlosen Ausprobieren. Details zu Diensten, Updates, Backups und Schema-Änderungen: [README.md – Quickstart](README.md#quickstart-docker).

## Entwicklung

Voraussetzungen: Node 24, pnpm 11, Docker.

```bash
cp .env.example .env                 # Schlüssel eintragen, BETTER_AUTH_SECRET setzen
pnpm install
pnpm db:up                           # nur Postgres auf Port 5433 (docker-compose.dev.yml)
pnpm db:push                         # Schema anlegen
pnpm dev                             # Dashboard auf http://localhost:3010
pnpm worker                          # Worker: Zeitplan + Warteschlange (zweites Terminal)
```

Konto unter `/signup` anlegen, Workspace erstellen, Marken und Fragen eintragen, „Jetzt messen“.

Beispieldaten (Paylindo + MediShift aus dem Prototyp, ohne API-Kosten): `pnpm --filter @opengeo/worker seed --owner du@example.com`

`docker-compose.yml` ist der Selbsthosting-Stack, `docker-compose.dev.yml` nur die Entwicklungsdatenbank. Beide haben feste, unterschiedliche Projektnamen (`opengeo-selfhost` bzw. `opengeo`) und kommen sich im selben Checkout nicht in die Quere.

## Kosten

Standard-Einstellungen sind auf Kosten optimiert (Messwerte und Begründung: SPEC.md Kapitel 9). Bei 20 Fragen × 2 Wiederholungen × wöchentlich: ca. 40 $/Monat. Jeder Workspace hat einen Budget-Deckel; ist er erreicht, werden weitere Abfragen übersprungen. `OPENGEO_MOCK_ENGINES=1` ersetzt alle Engines durch einen kostenlosen Mock.

Kostenschutz für gehostete Instanzen:

- Neue Workspaces starten mit **ausgeschaltetem Zeitplan** – automatische Messungen erst nach bewusstem Einschalten in den Einstellungen.
- `OPENGEO_MAX_BUDGET_USD` (Standard `200`): Obergrenze für das Monatsbudget je Workspace. Höhere Werte lehnt die Web-App ab; der Worker deckelt zusätzlich auf diesen Wert.
- `OPENGEO_ALLOW_SIGNUP` (Standard `true`): mit `false` ist die Selbstregistrierung abgeschaltet (better-auth `disableSignUp`, `/signup` zeigt einen Hinweis). Konten dann vorher anlegen.
- Monatsausgaben = Summe der Run-Kosten nach Abschlusszeitpunkt (Europe/Berlin); auch bezahlte Fehlversuche werden verbucht.
- Fehlt `ANTHROPIC_API_KEY` (Auswertung), bricht der Worker eine echte Messung vor dem ersten Engine-Aufruf ab. Scheitert nur die Auswertung, bleibt die Antwort gespeichert und wird beim nächsten Worker-Durchgang (`once`/`start`) ohne neuen Engine-Aufruf ausgewertet.

## Tests

```bash
pnpm typecheck
pnpm test:unit                       # ohne Datenbank und Netzwerk
pnpm test:integration                # Mock-Engines, Datenbank opengeo_test (wird angelegt)
pnpm test                            # alles
node e2e/full-flow.mjs login|check|create|verify   # Browser-Test gegen http://localhost:3010 (Zugang in .e2e-credentials)
```

`create` + `verify` lösen mit dem Worker eine echte Messung aus (1 Frage × 5 Engines ≈ 0,25 $), außer der Worker läuft im Mock-Modus.

CI: [.github/workflows/ci.yml](.github/workflows/ci.yml) – Hinweise zum selbst gehosteten Runner in [CONTRIBUTING.md](CONTRIBUTING.md#ci-and-self-hosted-runners).

## Struktur

```
packages/db      Drizzle-Schema, DB-Client
packages/core    Engine-Adapter, Preise, Auswertung, Messlauf mit Budgetprüfung, Maßnahmen
apps/worker      Zeitplan-Schleife + CLI (seed, collect, once, recommend, …), launchd-Vorlagen
apps/web         Next.js-Dashboard mit Login und Mandantentrennung
spike/           Prototyp und Kosten-Experiment
e2e/             Browser-Test
```

Dauerbetrieb auf dem Mac mini ohne Docker: siehe [apps/worker/README.md](apps/worker/README.md).
