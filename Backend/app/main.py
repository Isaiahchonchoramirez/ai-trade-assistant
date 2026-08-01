"""FastAPI entry point.

Development — the Vite dev server proxies /api here:

    uvicorn app.main:app --reload --port 8000

Packaged — if a built frontend is present next to the backend, it is served
from this same process, so the whole app is one command on one port with no
Node runtime required. That is what the downloadable release ships.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.v1.routes import router as api_router
from .core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)

log = logging.getLogger(__name__)

app = FastAPI(
    title=settings.app_name,
    description="Technical analysis, signal scoring and strategy backtesting over live market data.",
    version=settings.version,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


# --------------------------------------------------------------------------
# Bundled frontend
#
# Checked in order: an explicit override, the location the packaging script
# writes to, and the Vite output directory for anyone who just ran a build.
# --------------------------------------------------------------------------

BACKEND_DIR = Path(__file__).resolve().parent.parent
CANDIDATES = [
    Path(settings.static_dir) if settings.static_dir else None,
    BACKEND_DIR / "static",
    BACKEND_DIR.parent / "Frontend" / "dist",
]
STATIC_DIR = next((p for p in CANDIDATES if p and (p / "index.html").is_file()), None)


@app.get("/api")
def api_root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "version": settings.version,
        "docs": "/docs",
        "api": "/api/v1",
    }


if STATIC_DIR:
    log.info("serving the bundled frontend from %s", STATIC_DIR)
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        """Serve the built app, falling back to index.html for client routes."""
        candidate = (STATIC_DIR / path).resolve()
        # Confine to the static root — a crafted path must not escape it.
        if path and STATIC_DIR in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")

else:

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "name": settings.app_name,
            "version": settings.version,
            "docs": "/docs",
            "api": "/api/v1",
            "note": "No bundled frontend found. Run the Vite dev server, or build it into Backend/static.",
        }
