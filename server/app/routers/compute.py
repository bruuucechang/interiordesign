"""Stateless geometry the editor asks for while the user is drawing.

Nothing here touches the database. These endpoints exist because the work is
batch — behind a debounce, or triggered by a click — rather than on the
per-frame path the editor keeps for itself.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..detect import DecodeError, detect_walls
from ..dimensions import dimension_chain, outward_offset
from ..plan import parse_objects
from ..rooms import detect_room_polygons
from ..schemas import DetectRoomsBody, DetectWallsBody, DimensionChainBody

router = APIRouter(tags=["compute"])


@router.post("/rooms/detect")
def rooms_detect(body: DetectRoomsBody) -> dict[str, list[list[dict[str, float]]]]:
    """Bounded faces of the wall network — the rooms."""
    walls = [
        {"a": w.a.model_dump(), "b": w.b.model_dump(), "bulge": w.bulge}
        for w in body.walls
    ]
    return {"polygons": detect_room_polygons(walls)}


@router.post("/dimensions/chain")
def dimensions_chain(body: DimensionChainBody) -> dict[str, list[dict[str, Any]]]:
    """A run of consecutive dimensions along one wall, broken at its openings."""
    wall = {"a": body.wall.a.model_dump(), "b": body.wall.b.model_dump()}
    # Sent mid-edit, so an object the schema does not recognise is dropped
    # rather than failing the request — it could not have contributed a break.
    objects = parse_objects(body.objects, where="dimensions/chain")
    offset = body.offset if body.offset is not None else outward_offset(wall, objects)
    return {"dimensions": dimension_chain(wall, objects, offset)}


@router.post("/walls/detect")
def walls_detect(body: DetectWallsBody) -> dict[str, Any]:
    """Trace wall centrelines out of an underlay image."""
    try:
        return detect_walls(body.image)
    except DecodeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
