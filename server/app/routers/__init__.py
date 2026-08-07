"""HTTP routing, one module per group of endpoints.

Where a new endpoint goes:

  projects.py   anything that stores or retrieves a plan
  reports.py    anything derived from a stored plan
  compute.py    stateless geometry the editor asks for mid-edit
  dxf.py        importing someone else's drawing

The work itself stays out of here. A router validates the request, calls one of
the modules a level up (rooms, dimensions, detect, dxf, report), and turns
their errors into status codes — nothing more.
"""
from __future__ import annotations

from fastapi import APIRouter

from . import compute, dxf, projects, reports

router = APIRouter(prefix="/api")
router.include_router(projects.router)
router.include_router(reports.router)
router.include_router(compute.router)
router.include_router(dxf.router)

__all__ = ["router"]
