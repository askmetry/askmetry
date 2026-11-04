# @askmetry/worker

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

`ASKMETRY_MOCK_ENGINES=1` (oder `--mock`) ersetzt alle Engines und die Auswertung durch lokale Mocks – keine API-Aufrufe.

Geplante Messungen: Cron `workspace.schedule_cron` in Europe/Berlin. Fällig, wenn der letzte Cron-Zeitpunkt nach der letzten geplanten Messung liegt (ohne bisherige geplante Messung: nach dem Anlegen des Workspace – ein neuer Workspace misst also erst beim nächsten Termin).

## Dauerbetrieb auf einem Mac (launchd)

Vorlagen in `deploy/`. Installation (einmalig, von Hand):

```bash
cd /pfad/zu/askmetry
pnpm --filter @askmetry/web build                     # Web-App bauen (vor dem ersten Start und nach Updates)
for f in worker web; do sed -e "s#__ASKMETRY_DIR__#$PWD#g" -e "s#__HOME__#$HOME#g" apps/worker/deploy/com.askmetry.$f.plist > ~/Library/LaunchAgents/com.askmetry.$f.plist; done   # Platzhalter ersetzen
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.askmetry.worker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.askmetry.web.plist
```

- Status: `launchctl print gui/$(id -u)/com.askmetry.worker` · Logs: `~/Library/Logs/askmetry-worker.log`, `~/Library/Logs/askmetry-web.log`
- Neustart nach Code-Änderung: `launchctl kickstart -k gui/$(id -u)/com.askmetry.worker`
- Entfernen: `launchctl bootout gui/$(id -u)/com.askmetry.worker` (bzw. `com.askmetry.web`)
- Voraussetzung: Postgres läuft (`pnpm db:up`, colima gestartet). Alternativ ohne launchd: `docker compose up -d` im Repo-Wurzelverzeichnis (siehe README.md).
