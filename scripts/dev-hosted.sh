#!/usr/bin/env bash
# Entwicklung der gehosteten Version: Web (Port 3010) bzw. Worker mit Mock-KIs, Fake-Zahlung und Mail-Outbox.
# Aufruf aus dem Repo-Root: scripts/dev-hosted.sh web | worker  (echte KIs: ASKMETRY_MOCK_ENGINES=0 voranstellen)
set -euo pipefail
export PATH=~/.local/bin:~/.local/opt/node/bin:$PATH
export ASKMETRY_HOSTED=1 ASKMETRY_MOCK_ENGINES=${ASKMETRY_MOCK_ENGINES:-1} ASKMETRY_PAYMENTS=fake ASKMETRY_SCHEDULER=0
export ASKMETRY_PUBLIC_URL=${ASKMETRY_PUBLIC_URL:-http://localhost:3010}
export ASKMETRY_MAIL_OUTBOX=${ASKMETRY_MAIL_OUTBOX:-$PWD/.mail-outbox}
case "${1:-}" in
  web) exec pnpm --filter @askmetry/web dev ;;
  worker) exec pnpm --filter @askmetry/worker start ;;
  *) echo "Aufruf: scripts/dev-hosted.sh web|worker" >&2; exit 1 ;;
esac
