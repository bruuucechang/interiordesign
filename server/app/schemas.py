"""Request and response bodies for the HTTP layer.

Hand-written, unlike plan_schema.py: these describe what a call carries, not
what a saved plan is. The two are different things and drift apart on purpose —
`WallIn` is a bare segment because room detection needs nothing else, while a
stored wall has a layer, a group, a finish colour.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SaveBody(BaseModel):
    name: str = Field(min_length=1)
    #: The plan itself. Deliberately untyped here — it is checked against the
    #: generated schema in the router, which logs a mismatch instead of
    #: rejecting the save. See plan.check_stored_plan for why.
    data: Any


class Point(BaseModel):
    x: float
    y: float


class WallIn(BaseModel):
    a: Point
    b: Point
    bulge: float = 0.0


class DetectRoomsBody(BaseModel):
    walls: list[WallIn]


class DimensionChainBody(BaseModel):
    wall: WallIn
    objects: list[Any] = []
    offset: float | None = None


class DetectWallsBody(BaseModel):
    image: str = Field(min_length=1, description="data URL or bare base64")


class DxfBody(BaseModel):
    file: str = Field(min_length=1, description="data URL or bare base64 of a DXF")


class DxfImportBody(DxfBody):
    layers: list[str] | None = None
    unit: str | None = None
