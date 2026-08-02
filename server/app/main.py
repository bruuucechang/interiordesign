"""FastAPI backend for the interior designer.

Replaces the previous Express + node:sqlite service. Same five CRUD routes and
the same JSON shapes, so the client's net/api.ts did not have to change, plus
the compute endpoints that used to run in the browser.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from urllib.parse import quote
from typing import Any, AsyncIterator, Iterator

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import db as store
from .detect import DecodeError, detect_walls
from .report import build_report, build_workbook
from .rooms import detect_room_polygons


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


# ------------------------------------------------------------------ compute


class Point(BaseModel):
    x: float
    y: float


class WallIn(BaseModel):
    a: Point
    b: Point
    bulge: float = 0.0


class DetectRoomsBody(BaseModel):
    walls: list[WallIn]


@app.post("/api/rooms/detect")
def rooms_detect(body: DetectRoomsBody) -> dict[str, list[list[dict[str, float]]]]:
    """Bounded faces of the wall network — the rooms."""
    walls = [
        {"a": w.a.model_dump(), "b": w.b.model_dump(), "bulge": w.bulge}
        for w in body.walls
    ]
    return {"polygons": detect_room_polygons(walls)}


class DetectWallsBody(BaseModel):
    image: str = Field(min_length=1, description="data URL or bare base64")


@app.post("/api/walls/detect")
def walls_detect(body: DetectWallsBody) -> dict[str, Any]:
    """Trace wall centrelines out of an underlay image."""
    try:
        return detect_walls(body.image)
    except DecodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/projects/{project_id}/report")
def project_report(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Room areas and furniture counts per floor."""
    project = store.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="not found")
    return build_report({**project["data"], "name": project["name"]})


@app.get("/api/projects/{project_id}/report.xlsx")
def project_report_xlsx(project_id: str, db: Session = Depends(get_db)) -> Response:
    """The same report as a spreadsheet, ready to price up."""
    project = store.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="not found")
    data = build_workbook({**project["data"], "name": project["name"]})
    filename = quote(f"{project['name']}_面積報表.xlsx")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
