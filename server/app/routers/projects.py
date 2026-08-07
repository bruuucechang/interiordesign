"""Storing and retrieving plans."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import db as store
from ..plan import check_stored_plan
from ..schemas import SaveBody

router = APIRouter(tags=["projects"])


@router.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@router.get("/projects")
def list_projects(db: Session = Depends(store.get_db)) -> dict[str, list[dict[str, Any]]]:
    return {"projects": store.list_projects(db)}


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(store.get_db)) -> dict[str, Any]:
    project = store.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="not found")
    return project


@router.put("/projects/{project_id}")
def put_project(
    project_id: str, body: SaveBody, db: Session = Depends(store.get_db)
) -> dict[str, str]:
    if body.data is None:
        raise HTTPException(status_code=400, detail="name and data required")
    # Checked, not enforced: a save that does not match the schema is still the
    # user's work, and the client may legitimately be ahead of us.
    check_stored_plan(body.data, project_id=project_id)
    return store.save_project(db, project_id, body.name, body.data)


@router.delete("/projects/{project_id}")
def remove_project(project_id: str, db: Session = Depends(store.get_db)) -> dict[str, bool]:
    store.delete_project(db, project_id)
    return {"ok": True}
