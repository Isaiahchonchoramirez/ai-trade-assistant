#!/usr/bin/env bash
#
# Build the downloadable releases.
#
#   ./scripts/package_release.sh [version]
#
# Produces two artifacts in dist/:
#
#   Trade-Assistant-macOS-<version>.zip     the .app plus its uninstaller
#   ai-trade-assistant-<version>.zip        cross-platform, script launchers
#
# Both ship the frontend already built, so nothing needs Node at runtime.

set -euo pipefail

VERSION="${1:-1.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --------------------------------------------------------------- macOS app --
echo "▸ macOS app…"
./packaging/build_macos_app.sh "$VERSION" | sed 's/^/  /'

MACZIP="$ROOT/dist/Trade-Assistant-macOS-${VERSION}.zip"
rm -f "$MACZIP"
MACSTAGE="$ROOT/dist/mac-stage"
rm -rf "$MACSTAGE"; mkdir -p "$MACSTAGE"
cp -R "$ROOT/dist/Trade Assistant.app" "$MACSTAGE/"
cp -R "$ROOT/dist/Uninstall Trade Assistant.app" "$MACSTAGE/"

cat > "$MACSTAGE/READ ME FIRST.txt" <<'TXT'
TRADE ASSISTANT — macOS
=======================

TO INSTALL
  Drag "Trade Assistant.app" to your Applications folder. That is it.

THE FIRST TIME YOU OPEN IT
  macOS will say it "could not verify" the app. That is normal for any app
  not distributed through the App Store — it is not a warning about this app
  specifically. To get past it, once:

    1. Double-click Trade Assistant. Click "Done" on the warning.
    2. Open System Settings > Privacy & Security.
    3. Scroll to the bottom. Next to "Trade Assistant was blocked",
       click "Open Anyway".
    4. Enter your password, then click "Open".

  Every launch after that is just a double-click.

  (Why: signing an app so this prompt never appears requires a paid Apple
  developer account. This app is free, so it is unsigned.)

FIRST LAUNCH TAKES A MINUTE
  It sets up a private environment the first time. You will get a
  notification when it starts and your browser will open on its own.
  After that it opens in a couple of seconds.

WHAT YOU NEED
  Python 3.10 or newer — free from https://www.python.org/downloads/
  If it is missing, the app will offer to take you there.
  An internet connection, since it downloads live market data.

TO UNINSTALL
  Double-click "Uninstall Trade Assistant". It removes the private
  environment (about 180 MB) and offers to bin the app itself.

PLEASE READ
  Educational technical analysis, NOT financial advice. Signals describe what
  indicators say about past price action. They do not predict the future.
  Prices come from Yahoo Finance and are delayed. Never risk money you cannot
  afford to lose.

  https://github.com/Isaiahchonchoramirez/ai-trade-assistant
TXT

( cd "$MACSTAGE" && zip -qry "$MACZIP" . -x '*.DS_Store' )
rm -rf "$MACSTAGE"
echo "✓ ${MACZIP}  ($(du -h "$MACZIP" | cut -f1 | tr -d ' '))"

# ------------------------------------------------------- cross-platform zip --
echo "▸ Cross-platform bundle…"
NAME="ai-trade-assistant-v${VERSION}"
STAGE="${ROOT}/dist/${NAME}"
OUT="${ROOT}/dist/${NAME}.zip"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE/Backend" "$STAGE/packaging"

rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'static' \
      Backend/app Backend/Requirements.txt "$STAGE/Backend/"
cp -R Frontend/dist "$STAGE/Backend/static"

cp run.py start.sh start.bat "Start Trade Assistant.command" "$STAGE/"
cp packaging/install-windows.bat packaging/uninstall-windows.bat "$STAGE/"
cp packaging/app.ico "$STAGE/packaging/" 2>/dev/null || true
chmod +x "$STAGE/run.py" "$STAGE/start.sh" "$STAGE/Start Trade Assistant.command"
cp LICENSE "$STAGE/" 2>/dev/null || true

cat > "$STAGE/READ ME FIRST.txt" <<'TXT'
TRADE ASSISTANT
===============

WINDOWS
  Double-click install-windows.bat — it sets everything up and puts a
  Trade Assistant shortcut in your Start Menu and on your Desktop.
  To remove it later: uninstall-windows.bat

  (Or skip the installer and just double-click start.bat any time.)

LINUX
  ./start.sh

macOS
  Double-click "Start Trade Assistant.command".
  There is a nicer .app build for Mac — grab Trade-Assistant-macOS.zip
  from the releases page instead.

  If macOS says it "cannot verify" the file, that is standard for anything
  downloaded outside the App Store. Once: open System Settings >
  Privacy & Security, scroll down, click "Open Anyway".

WHAT YOU NEED
  Python 3.10 or newer — free from https://www.python.org/downloads/
  On Windows, tick "Add Python to PATH" during install.
  An internet connection, since it downloads live market data.

  The first run takes about a minute to set up. After that, seconds.

TO STOP IT
  Press Ctrl+C in the window, or just close it.

PLEASE READ
  Educational technical analysis, NOT financial advice. Signals describe what
  indicators say about past price action. They do not predict the future, and
  no backtest result implies a future one. Prices are delayed. Never risk
  money you cannot afford to lose.

  https://github.com/Isaiahchonchoramirez/ai-trade-assistant
TXT

( cd "${ROOT}/dist" && zip -qr "${NAME}.zip" "$NAME" -x '*.DS_Store' )
rm -rf "$STAGE"
echo "✓ ${OUT}  ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
