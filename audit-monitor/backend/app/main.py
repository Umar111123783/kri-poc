"""Audit Monitor API – continuous KRI monitoring and Audit planner for Internal Audit.

Run locally:   uvicorn app.main:app --reload --port 8000
Docs:          http://localhost:8000/docs
The built React app (frontend/dist) is served from / when present, so a single
container serves both API and UI.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings as app_settings
from .routers import exceptions, kris, planner, runs, settings

app = FastAPI(
    title=app_settings.app_name,
    version=app_settings.app_version,
    description="Continuous KRI monitoring and Audit planner for Internal Audit.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (kris.router, runs.router, exceptions.router, planner.router, settings.router):
    app.include_router(r)


@app.get("/api/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok"}


# ---- serve the built front end (frontend/dist) when it exists ----
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
