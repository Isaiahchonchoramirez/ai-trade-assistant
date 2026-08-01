#!/bin/bash
cd "$(dirname "$0")" || exit 1
command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required: https://www.python.org/downloads/"; exit 1; }
exec python3 run.py
