#!/usr/bin/env bash
#
# Build "Trade Assistant.app".
#
#   ./packaging/build_macos_app.sh [version]
#
# The bundle is unsigned, so macOS will show a Gatekeeper warning on first
# launch. Signing and notarising it needs a paid Apple Developer account;
# without one, the first-run instructions in the release are the mitigation.

set -euo pipefail

VERSION="${1:-1.0.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/dist/Trade Assistant.app"
C="$APP/Contents"

cd "$ROOT"

echo "▸ Building the frontend…"
( cd Frontend && npm run build >/dev/null 2>&1 )

echo "▸ Drawing the icon…"
.venv/bin/python packaging/make_icon.py packaging/build >/dev/null

echo "▸ Assembling the bundle…"
rm -rf "$APP"
mkdir -p "$C/MacOS" "$C/Resources/payload/Backend"

rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'static' \
      Backend/app Backend/Requirements.txt "$C/Resources/payload/Backend/"
cp -R Frontend/dist "$C/Resources/payload/Backend/static"

cp packaging/launcher.sh "$C/MacOS/TradeAssistant"
chmod +x "$C/MacOS/TradeAssistant"
cp packaging/build/AppIcon.icns "$C/Resources/AppIcon.icns"

cat > "$C/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>                  <string>Trade Assistant</string>
  <key>CFBundleDisplayName</key>           <string>Trade Assistant</string>
  <key>CFBundleIdentifier</key>            <string>dev.isaiahramirez.tradeassistant</string>
  <key>CFBundleVersion</key>               <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>    <string>${VERSION}</string>
  <key>CFBundlePackageType</key>           <string>APPL</string>
  <key>CFBundleExecutable</key>            <string>TradeAssistant</string>
  <key>CFBundleIconFile</key>              <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>        <string>11.0</string>
  <key>NSHighResolutionCapable</key>       <true/>
  <!-- No dock icon or menu bar: this is a launcher for a browser app. -->
  <key>LSUIElement</key>                   <true/>
  <key>NSHumanReadableCopyright</key>
  <string>MIT. Educational technical analysis, not financial advice.</string>
</dict>
</plist>
PLIST

# An ad-hoc signature does not satisfy notarisation, but it does stop the
# "damaged and can't be opened" "error some macOS versions show for a bundle
# with no signature at all.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 \
  && echo "▸ Ad-hoc signed" \
  || echo "▸ Ad-hoc signing unavailable (bundle still works)"

# ---- Uninstaller ---------------------------------------------------------
# Dragging the app to the Trash leaves ~180 MB of environment behind in
# Application Support, so removal needs its own entry point.
UN="$ROOT/dist/Uninstall Trade Assistant.app"
rm -rf "$UN"
mkdir -p "$UN/Contents/MacOS" "$UN/Contents/Resources"
cp packaging/uninstaller.sh "$UN/Contents/MacOS/Uninstall"
chmod +x "$UN/Contents/MacOS/Uninstall"
cp packaging/build/AppIcon.icns "$UN/Contents/Resources/AppIcon.icns"
cat > "$UN/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>               <string>Uninstall Trade Assistant</string>
  <key>CFBundleIdentifier</key>         <string>dev.isaiahramirez.tradeassistant.uninstall</string>
  <key>CFBundleVersion</key>            <string>${VERSION}</string>
  <key>CFBundlePackageType</key>        <string>APPL</string>
  <key>CFBundleExecutable</key>         <string>Uninstall</string>
  <key>CFBundleIconFile</key>           <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>     <string>11.0</string>
  <key>LSUIElement</key>                <true/>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$UN" >/dev/null 2>&1 || true

touch "$APP" "$UN"
echo "✓ ${APP}  ($(du -sh "$APP" | cut -f1 | tr -d ' '))"
echo "✓ ${UN}  ($(du -sh "$UN" | cut -f1 | tr -d ' '))"
