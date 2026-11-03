# @opengeo/worker

Scheduler-Schleife und CLI für die Messläufe. Liest die Root-`.env` (`DATABASE_URL`, API-Schlüssel).

```bash
export PATH=~/.local/bin:~/.local/opt/node/bin:$PATH
cd apps/worker
pnpm start                                  # Schleife alle 60 s: fällige geplante Messungen anlegen, Warteschlange abarbeiten
pnpm once                                   # Warteschlange (queued + unterbrochene) abarbeiten, dann beenden
pnpm collect --workspace paylindo --mock    # manuelle Messung mit Mock-Engines (kostenlos)
pnpm collect --workspace paylindo           # echte Messung – kostet Geld!
pnpm seed [--owner du@example.com]          # Workspaces paylindo + medishift, Import der Spike-Ergebnisse
pnpm recommend --workspace paylindo [--no-llm]  # Maßnahmen neu berechnen (KI-Formulierung ~0,01 $, mit --no-llm kostenlos)
pnpm backfill-searched [--workspace paylindo]   # gelesene Quellen (searched) aus gespeicherten ChatGPT-/Claude-Rohdaten nachtragen (kostenlos, idempotent)
```

`OPENGEO_MOCK_ENGINES=1` (oder `--mock`) ersetzt alle Engines und die Auswertung durch lokale Mocks – keine API-Aufrufe.

Geplante Messungen: Cron `workspace.schedule_cron` in Europe/Berlin. Fällig, wenn der letzte Cron-Zeitpunkt nach der letzten geplanten Messung liegt (ohne bisherige geplante Messung: nach dem Anlegen des Workspace – ein neuer Workspace misst also erst beim nächsten Termin).

## Dauerbetrieb auf einem Mac (launchd)

Vorlagen in `deploy/`. Installation (einmalig, von Hand):

```bash
cd /pfad/zu/opengeo
pnpm --filter @opengeo/web build                     # Web-App bauen (vor dem ersten Start und nach Updates)
for f in worker web; do sed -e "s#__OPENGEO_DIR__#$PWD#g" -e "s#__HOME__#$HOME#g" apps/worker/deploy/com.opengeo.$f.plist > ~/Library/LaunchAgents/com.opengeo.$f.plist; done   # Platzhalter ersetzen
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opengeo.worker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opengeo.web.plist
```

- Status: `launchctl print gui/$(id -u)/com.opengeo.worker` · Logs: `~/Library/Logs/opengeo-worker.log`, `~/Library/Logs/opengeo-web.log`
- Neustart nach Code-Änderung: `launchctl kickstart -k gui/$(id -u)/com.opengeo.worker`
- Entfernen: `launchctl bootout gui/$(id -u)/com.opengeo.worker` (bzw. `com.opengeo.web`)
- Voraussetzung: Postgres läuft (`docker compose up -d db`, colima gestartet).
