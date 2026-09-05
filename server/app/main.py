"""The FastAPI application: wiring only.

Endpoints live in routers/, request bodies in schemas.py, the shape of a saved
plan in plan_schema.py (generated). This module builds the app, mounts them,
and serves the built client — nothing that could be called business logic.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db as store
from .routers import router as api_router

log = logging.getLogger("interior.app")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    store.init_db()
    # Empty the bin of anything past the grace period, on the way up. A tool
    # that is not running is not accumulating either, so this beats a scheduler
    # — one less moving part that can be wrong while nobody is looking.
    with store.SessionLocal() as db:
        gone = store.purge_deleted(db)
    if gone:
        log.info("purged %d plan(s) deleted more than %d days ago", gone, store.PURGE_AFTER_DAYS)
    yield


app = FastAPI(title="Interior Designer API", version="1.0.0", lifespan=lifespan)

# The Vite dev server proxies /api, but the client can also be served from a
# different origin in production.
# `allow_origins=["*"]` with no authentication meant any page in any tab could
# read and rewrite every plan on this server. That is survivable on a localhost
# tool used by one person and not survivable anywhere else, and nothing in the
# code said which of those it was.
#
# Default to the origins this app is actually served from; `INTERIOR_ORIGINS`
# (comma-separated) widens it deliberately rather than by oversight.
_DEFAULT_ORIGINS = [
    "http://localhost:5180", "http://127.0.0.1:5180",     # vite dev
    "http://localhost:8791", "http://127.0.0.1:8791",     # served by this app
    "http://localhost:18791", "http://127.0.0.1:18791",   # docker
]
_origins = [o.strip() for o in os.environ.get("INTERIOR_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or _DEFAULT_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# ---------------------------------------------------------------- static site
#
# The container image drops the built client into ./static. Serving it from the
# same origin as the API means the browser needs no CORS or proxy setup — and
# net/api.ts already uses relative /api paths. Mounted last so it cannot shadow
# an API route. Absent in development, where Vite serves the client instead.
#
# INTERIOR_STATIC_DIR lets the desktop build point at the bundle, where the
# files are unpacked somewhere unrelated to this module's location.
_STATIC = Path(
    os.environ.get("INTERIOR_STATIC_DIR")
    or Path(__file__).resolve().parent.parent / "static"
)
if _STATIC.is_dir():
    app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")
