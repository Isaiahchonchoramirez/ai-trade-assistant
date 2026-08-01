#!/usr/bin/env python3
"""Start the AI Trade Assistant.

    python3 run.py

Creates a virtual environment on first run, installs what it needs, starts the
server and opens a browser. Nothing else to configure — no API keys, no
accounts, no Node runtime (the release ships the frontend already built).

Re-running is cheap: the environment is only rebuilt when Requirements.txt
changes.
"""

from __future__ import annotations

import hashlib
import os
import platform
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "Backend"
VENV = ROOT / ".venv"
REQUIREMENTS = BACKEND / "Requirements.txt"
STAMP = VENV / ".requirements-hash"

DEFAULT_PORT = 8000
MIN_PYTHON = (3, 10)


# --------------------------------------------------------------------------
# Console
# --------------------------------------------------------------------------

COLOUR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def paint(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOUR else text


def step(text: str) -> None:
    print(paint(f"  ▸ {text}", "36"), flush=True)


def ok(text: str) -> None:
    print(paint(f"  ✓ {text}", "32"), flush=True)


def warn(text: str) -> None:
    print(paint(f"  ! {text}", "33"), flush=True)


def die(text: str, *hints: str) -> None:
    print(paint(f"\n  ✗ {text}", "31"))
    for hint in hints:
        print(f"    {hint}")
    print()
    # A double-clicked window vanishes on exit; hold it open so the message
    # is actually readable.
    if not sys.stdin.isatty():
        try:
            input("  Press Enter to close…")
        except (EOFError, KeyboardInterrupt):
            pass
    sys.exit(1)


BANNER = r"""
   ___    _____             _        _         _     _
  / _ \  |_   _| _ __ __ _ | |_ ___ | |       / \   (_)
 | |_| |   | | | '__/ _` || __/ _ \/ _` |    / _ \  | |
 |  _  |   | | | | | (_| || ||  __/ (_| |   / ___ \ | |
 |_| |_|   |_| |_|  \__,_| \__\___|\__,_|  /_/   \_\|_|
"""


# --------------------------------------------------------------------------
# Environment
# --------------------------------------------------------------------------


def venv_python() -> Path:
    if platform.system() == "Windows":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()[:16]


def ensure_python() -> None:
    if sys.version_info < MIN_PYTHON:
        die(
            f"Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+ is required "
            f"(this is {sys.version_info.major}.{sys.version_info.minor}).",
            "Get it from https://www.python.org/downloads/",
        )


def ensure_venv() -> Path:
    python = venv_python()

    if not python.is_file():
        step("Setting up a private environment (one time, ~30 seconds)…")
        try:
            subprocess.run(
                [sys.executable, "-m", "venv", str(VENV)],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or b"").decode(errors="replace").strip()
            die(
                "Could not create the virtual environment.",
                detail or "python3 -m venv failed",
                "On Debian/Ubuntu you may need: sudo apt install python3-venv",
            )
        python = venv_python()

    current = requirements_hash()
    installed = STAMP.read_text().strip() if STAMP.is_file() else None

    if installed != current:
        step("Installing dependencies (one time, ~60 seconds)…")
        result = subprocess.run(
            [str(python), "-m", "pip", "install", "--quiet", "--upgrade", "pip"],
            capture_output=True,
        )
        result = subprocess.run(
            [str(python), "-m", "pip", "install", "--quiet", "-r", str(REQUIREMENTS)],
            capture_output=True,
        )
        if result.returncode != 0:
            detail = (result.stderr or b"").decode(errors="replace").strip()
            die(
                "Dependency install failed.",
                detail.splitlines()[-1] if detail else "pip returned an error",
                "Check your internet connection and try again.",
            )
        STAMP.write_text(current)
        ok("Dependencies installed")
    else:
        ok("Environment ready")

    return python


# --------------------------------------------------------------------------
# Networking
# --------------------------------------------------------------------------


def free_port(preferred: int) -> int:
    """The preferred port if it is free, otherwise the next one that is."""
    for candidate in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", candidate))
                return candidate
            except OSError:
                continue
    die(f"No free port between {preferred} and {preferred + 19}.")
    return preferred


def wait_then_open(url: str, port: int) -> None:
    """Open the browser once the server actually answers."""
    deadline = time.time() + 90
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                time.sleep(0.6)  # let the first request succeed, not just connect
                print(flush=True)
                ok(f"Running at {paint(url, '1;36')}")
                print(paint("    Press Ctrl+C in this window to stop.\n", "2"), flush=True)
                try:
                    webbrowser.open(url)
                except Exception:
                    warn(f"Could not open a browser automatically — visit {url}")
                return
        time.sleep(0.35)
    warn(f"Server is taking a while. Try {url} in your browser.")


# --------------------------------------------------------------------------


def main() -> None:
    print(paint(BANNER, "36"), flush=True)
    print(paint("  Technical signals, backtested. Not financial advice.\n", "2"), flush=True)

    if not REQUIREMENTS.is_file():
        die(
            "This does not look like the app directory.",
            f"Expected to find {REQUIREMENTS}",
            "Run this script from inside the unzipped folder.",
        )

    ensure_python()
    python = ensure_venv()

    bundled = (BACKEND / "static" / "index.html").is_file()
    if not bundled:
        warn("No bundled frontend found — the API will run, but there is no UI.")
        warn("This release should include one; try re-downloading.")

    port = free_port(int(os.environ.get("PORT", DEFAULT_PORT)))
    if port != DEFAULT_PORT:
        warn(f"Port {DEFAULT_PORT} was busy — using {port} instead.")

    url = f"http://127.0.0.1:{port}"
    step("Starting the server…")
    threading.Thread(target=wait_then_open, args=(url, port), daemon=True).start()

    env = {**os.environ, "PYTHONWARNINGS": "ignore", "PYTHONUNBUFFERED": "1"}
    try:
        subprocess.run(
            [
                str(python), "-m", "uvicorn", "app.main:app",
                "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning",
            ],
            cwd=str(BACKEND),
            env=env,
            check=False,
        )
    except KeyboardInterrupt:
        pass

    print(paint("\n  Stopped. Run this again any time.\n", "2"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(paint("\n  Stopped.\n", "2"))
