#!/usr/bin/env bash
#
# Build the downloadable release.
#
#   ./scripts/package_release.sh [version]
#
# Produces dist/ai-trade-assistant-<version>.zip containing the backend, a
# pre-built frontend and the launchers. The person downloading it needs Python
# and nothing else — no Node, no build step, no configuration.

set -euo pipefail

VERSION="${1:-1.0.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="ai-trade-assistant-v${VERSION}"
STAGE="${ROOT}/dist/${NAME}"
OUT="${ROOT}/dist/${NAME}.zip"

cd "$ROOT"

echo "▸ Building the frontend…"
( cd Frontend && npm run build >/dev/null 2>&1 )

echo "▸ Staging…"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE/Backend"

# Backend source, minus caches
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'static' \
      Backend/app Backend/Requirements.txt "$STAGE/Backend/"

# The built UI, served by FastAPI so it is one process on one port
cp -R Frontend/dist "$STAGE/Backend/static"

# Launchers
cp run.py start.sh start.bat "Start Trade Assistant.command" "$STAGE/"
chmod +x "$STAGE/run.py" "$STAGE/start.sh" "$STAGE/Start Trade Assistant.command"

cp LICENSE "$STAGE/" 2>/dev/null || true

cat > "$STAGE/READ ME FIRST.txt" <<'TXT'
AI TRADE ASSISTANT
==================

WHAT THIS IS
  A market dashboard that scores a stock across seven technical factors,
  turns that into an action with an entry, a stop and targets, then replays
  the same logic over years of history to show what following it would
  actually have returned — against simply buying and holding.

TO START IT
  macOS    Double-click "Start Trade Assistant.command"
           (If macOS blocks it: right-click -> Open -> Open.)
  Windows  Double-click "start.bat"
  Linux    ./start.sh

  The first run takes about a minute while it sets up. After that it is a
  few seconds. Your browser opens automatically.

WHAT YOU NEED
  Python 3.10 or newer. Nothing else.
  https://www.python.org/downloads/
  On Windows, tick "Add Python to PATH" during install.

  It downloads market data, so you need to be online.

TO STOP IT
  Press Ctrl+C in the terminal window, or just close it.

PLEASE READ
  This is educational technical analysis, NOT financial advice. The signals
  describe what indicators say about past price action. They do not predict
  the future, and no backtest result implies a future one. Prices come from
  Yahoo Finance and are delayed. Never risk money you cannot afford to lose.

SOURCE
  https://github.com/Isaiahchonchoramirez/ai-trade-assistant
TXT

echo "▸ Zipping…"
( cd "${ROOT}/dist" && zip -qr "${NAME}.zip" "$NAME" -x '*.DS_Store' )
rm -rf "$STAGE"

SIZE=$(du -h "$OUT" | cut -f1 | tr -d ' ')
echo "✓ ${OUT}  (${SIZE})"
