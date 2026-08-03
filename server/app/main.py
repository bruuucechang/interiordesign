"""FastAPI backend for the interior designer.

Replaces the previous Express + node:sqlite service. Same five CRUD routes and
the same JSON shapes, so the client's net/api.ts did not have to change, plus
the compute endpoints that used to run in the browser.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote
from typing import Any, AsyncIterator, Iterator

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import db as store
from .detect import DecodeError, detect_walls
from .dimensions import dimension_chain, outward_offset
from .dxf import DxfError, convert as convert_dxf, inspect as inspect_dxf
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


class DimensionChainBody(BaseModel):
    wall: WallIn
    objects: list[dict[str, Any]] = []
    offset: float | None = None


@app.post("/api/dimensions/chain")
def dimensions_chain(body: DimensionChainBody) -> dict[str, list[dict[str, Any]]]:
    """A run of consecutive dimensions along one wall, broken at its openings."""
    wall = {"a": body.wall.a.model_dump(), "b": body.wall.b.model_dump()}
    offset = body.offset if body.offset is not None else outward_offset(wall, body.objects)
    return {"dimensions": dimension_chain(wall, body.objects, offset)}


class DetectWallsBody(BaseModel):
    image: str = Field(min_length=1, description="data URL or bare base64")


@app.post("/api/walls/detect")
def walls_detect(body: DetectWallsBody) -> dict[str, Any]:
    """Trace wall centrelines out of an underlay image."""
    try:
        return detect_walls(body.image)
    except DecodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class DxfBody(BaseModel):
    file: str = Field(min_length=1, description="data URL or bare base64 of a DXF")


class DxfImportBody(DxfBody):
    layers: list[str] | None = None
    unit: str | None = None


@app.post("/api/dxf/inspect")
def dxf_inspect(body: DxfBody) -> dict[str, Any]:
    """What the file contains, so the user can pick layers before importing."""
    try:
        return inspect_dxf(body.file)
    except DxfError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/dxf/import")
def dxf_import(body: DxfImportBody) -> dict[str, Any]:
    """The chosen layers, converted to editor walls in centimetres."""
    try:
        return convert_dxf(body.file, body.layers, body.unit)
    except DxfError as e:
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


# ---------------------------------------------------------------- static site
#
# The container image drops the built client into ./static. Serving it from the
# same origin as the API means the browser needs no CORS or proxy setup — and
# net/api.ts already uses relative /api paths. Mounted last so it cannot shadow
# an API route. Absent in development, where Vite serves the client instead.


# INTERIOR_STATIC_DIR lets the desktop build point at the bundle, where the
# files are unpacked somewhere unrelated to this module's location.
_STATIC = Path(os.environ.get("INTERIOR_STATIC_DIR")
               or Path(__file__).resolve().parent.parent / "static")
if _STATIC.is_dir():
    app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")
