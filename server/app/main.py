"""FastAPI backend for the interior designer.

Replaces the previous Express + node:sqlite service. Same five CRUD routes and
the same JSON shapes, so the client's net/api.ts did not have to change, plus
the compute endpoints that used to run in the browser.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Iterator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import db as store


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    store.init_db()
    yield


app = FastAPI(title="Interior Designer API", version="1.0.0", lifespan=lifespan)

# The Vite dev server proxies /api, but the client can also be served from a
# different origin in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db() -> Iterator[Session]:
    session = store.SessionLocal()
    try:
        yield session
    finally:
        session.close()


class SaveBody(BaseModel):
    name: str = Field(min_length=1)
    data: Any


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db)) -> dict[str, list[dict[str, Any]]]:
    return {"projects": store.list_projects(db)}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    project = store.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="not found")
    return project


@app.put("/api/projects/{project_id}")
def put_project(
    project_id: str, body: SaveBody, db: Session = Depends(get_db)
) -> dict[str, str]:
    if body.data is None:
        raise HTTPException(status_code=400, detail="name and data required")
    return store.save_project(db, project_id, body.name, body.data)


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    store.delete_project(db, project_id)
    return {"ok": True}
