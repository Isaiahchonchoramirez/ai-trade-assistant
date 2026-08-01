#!/bin/bash
# Double-click this file to launch the app.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 run.py
fi
echo
echo "  Python 3 is not installed."
echo "  Get it from https://www.python.org/downloads/ then double-click this again."
echo
read -r -p "  Press Enter to close…"
