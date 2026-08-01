#!/bin/bash
#
# Trade Assistant.app — the executable inside Contents/MacOS.
#
# Launched from Finder this runs with no visible terminal, so every message to
# the user goes through native macOS dialogs. It sets up a private environment
# on first run, starts the server, and opens the browser.

set -uo pipefail

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RES="$BUNDLE/Contents/Resources"
PAYLOAD="$RES/payload"
SUPPORT="$HOME/Library/Application Support/Trade Assistant"
VENV="$SUPPORT/env"
LOG="$SUPPORT/launch.log"

mkdir -p "$SUPPORT"
exec 2>>"$LOG"
echo "--- $(date) ---" >>"$LOG"

# ---------------------------------------------------------------- dialogs ---

notify() {
  osascript -e "display notification \"$1\" with title \"Trade Assistant\"" >/dev/null 2>&1 || true
}

alert() { # alert <title> <message>
  osascript -e "display alert \"$1\" message \"$2\" as critical buttons {\"OK\"} default button 1" >/dev/null 2>&1 || true
}

ask_install_python() {
  local choice
  choice=$(osascript <<'AS' 2>/dev/null
display alert "Python is required" message "Trade Assistant needs Python 3.10 or newer — a free download from python.org.

Install it, then open Trade Assistant again." buttons {"Not now", "Get Python"} default button "Get Python"
return button returned of result
AS
)
  [ "$choice" = "Get Python" ] && open "https://www.python.org/downloads/"
}

# ----------------------------------------------------------------- python ---

find_python() {
  local candidates=(
    /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3
    "$(command -v python3 2>/dev/null)"
  )
  # Framework builds, newest first — covers the python.org installer.
  while IFS= read -r p; do candidates+=("$p"); done < <(
    ls -1d /Library/Frameworks/Python.framework/Versions/3.*/bin/python3 2>/dev/null | sort -rV
  )
  for p in "${candidates[@]}"; do
    [ -n "$p" ] && [ -x "$p" ] || continue
    if "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
      echo "$p"; return 0
    fi
  done
  return 1
}

PYTHON="$(find_python)" || { ask_install_python; exit 1; }
echo "python: $PYTHON" >>"$LOG"

# ------------------------------------------------------------ environment ---

REQ="$PAYLOAD/Backend/Requirements.txt"
STAMP="$VENV/.requirements-hash"
WANT="$(shasum -a 256 "$REQ" 2>/dev/null | cut -c1-16)"
HAVE="$(cat "$STAMP" 2>/dev/null || true)"

if [ ! -x "$VENV/bin/python" ] || [ "$WANT" != "$HAVE" ]; then
  notify "Setting up… this takes about a minute, one time only."
  if ! "$PYTHON" -m venv "$VENV" >>"$LOG" 2>&1; then
    alert "Setup failed" "Could not create the environment. Details are in:
$LOG"
    exit 1
  fi
  "$VENV/bin/python" -m pip install --quiet --upgrade pip >>"$LOG" 2>&1
  if ! "$VENV/bin/python" -m pip install --quiet -r "$REQ" >>"$LOG" 2>&1; then
    alert "Setup failed" "Could not download the components Trade Assistant needs.

Check your internet connection and try again. Details are in:
$LOG"
    exit 1
  fi
  echo "$WANT" >"$STAMP"
  notify "Ready. Opening Trade Assistant…"
fi

# ----------------------------------------------------------------- launch ---

PORT=$("$VENV/bin/python" - <<'PY'
import socket
for p in range(8000, 8040):
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", p)); print(p); break
        except OSError:
            continue
else:
    print(8000)
PY
)
URL="http://127.0.0.1:$PORT"
echo "port: $PORT" >>"$LOG"

# Open the browser once the server actually answers, not merely when it binds.
(
  for _ in $(seq 1 240); do
    if curl -fsS -m 1 "$URL/api/v1/health" >/dev/null 2>&1; then open "$URL"; exit 0; fi
    sleep 0.4
  done
  alert "Could not start" "The server did not come up in time. Details are in:
$LOG"
) &

cd "$PAYLOAD/Backend" || exit 1
export STATIC_DIR="$PAYLOAD/Backend/static"
export PYTHONWARNINGS=ignore
exec "$VENV/bin/python" -m uvicorn app.main:app \
  --host 127.0.0.1 --port "$PORT" --log-level warning
