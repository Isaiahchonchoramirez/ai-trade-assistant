"""Freeze the API into static JSON so the dashboard can be hosted without a backend.

The app needs a running FastAPI process to compute anything. That is fine
locally and impossible on a static host, so this captures a real response for
every call the UI makes and writes it to a directory the frontend can fetch
from directly.

Everything here is genuine output from the live engine — the demo is the same
dashboard reading a snapshot instead of a socket, not a mock.

Usage (with the backend running on :8000):

    python snapshot_demo.py ../../isaiahramirezdev/public/trade-assistant/demo
"""

from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

import urllib.error
import urllib.request

API = "http://127.0.0.1:8000/api/v1"

#: Symbols a visitor can click through. These are the default watchlist, so
#: every row in the sidebar leads somewhere.
SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA", "SPY", "BTC-USD"]

#: Ranges to freeze per symbol. 1D and 5D are intraday and would be stale
#: within the hour; MAX is megabytes per symbol. 5Y is kept only for AAPL,
#: where it shows the automatic log scale.
RANGES = ["1M", "3M", "6M", "1Y"]
EXTRA = {"AAPL": ["5Y"]}

#: The snapshot is taken at this capital; the frontend rescales linearly for
#: the other options, which is exact for an all-in/all-out strategy.
BASE_CAPITAL = 10_000


def get(path: str) -> dict | list:
    url = f"{API}{path}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return json.loads(response.read())
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 2:
                raise SystemExit(f"failed: {url} — {exc}\nIs the backend running on :8000?")
            time.sleep(2)
    raise SystemExit("unreachable")


def write(out: Path, name: str, payload: object) -> int:
    target = out / name
    # Separators drop the whitespace FastAPI does not emit anyway; being
    # explicit keeps the file identical no matter who serialises it.
    text = json.dumps(payload, separators=(",", ":"))
    target.write_text(text)
    return len(text)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)

    out = Path(sys.argv[1]).resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    total = 0
    manifest: dict[str, object] = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "symbols": SYMBOLS,
        "ranges": {s: RANGES + EXTRA.get(s, []) for s in SYMBOLS},
        "base_capital": BASE_CAPITAL,
    }

    print("meta, overview, watchlist…")
    total += write(out, "meta.json", get("/meta"))
    total += write(out, "overview.json", get("/market/overview"))
    total += write(out, "watchlist.json", get(f"/watchlist?symbols={','.join(SYMBOLS)}"))

    for symbol in SYMBOLS:
        safe = symbol.replace("^", "_")
        total += write(out, f"news-{safe}.json", get(f"/news/{symbol}"))
        for rng in RANGES + EXTRA.get(symbol, []):
            payload = get(f"/analysis/{symbol}?range={rng}&capital={BASE_CAPITAL}")
            size = write(out, f"analysis-{safe}-{rng}.json", payload)
            total += size
            print(f"  {symbol:8s} {rng:4s} {size // 1024:5d} KB")

    write(out, "manifest.json", manifest)

    print(f"\n{total / 1024 / 1024:.1f} MB across {len(list(out.iterdir()))} files -> {out}")


if __name__ == "__main__":
    main()
