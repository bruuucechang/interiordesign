"""Importing a CAD drawing.

Two stages on purpose: a DXF's layers have no standard names, so the user is
shown what the file contains and picks before anything is converted.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..dxf import DxfError, convert, inspect
from ..schemas import DxfBody, DxfImportBody

router = APIRouter(prefix="/dxf", tags=["dxf"])


@router.post("/inspect")
def dxf_inspect(body: DxfBody) -> dict[str, Any]:
    """What the file contains, so the user can pick layers before importing."""
    try:
        return inspect(body.file)
    except DxfError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import")
def dxf_import(body: DxfImportBody) -> dict[str, Any]:
    """The chosen layers, converted to editor walls in centimetres."""
    try:
        return convert(body.file, body.layers, body.unit)
    except DxfError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
