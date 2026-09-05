"""Storing and retrieving plans."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
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


@router.get("/projects-deleted")
def list_deleted(db: Session = Depends(store.get_db)) -> dict[str, list[dict[str, Any]]]:
    """The bin. A separate path, not a flag on /projects.

    Anything that forgets a flag would list deleted plans as live ones; there is
    no way to forget a URL you did not call.
    """
    return {"projects": store.list_projects(db, deleted=True)}


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(store.get_db)) -> dict[str, Any]:
    project = store.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="not found")
    return project


@router.put("/projects/{project_id}")
def put_project(
    project_id: str,
    body: SaveBody,
    db: Session = Depends(store.get_db),
    if_unmodified_since: str | None = Header(default=None, alias="If-Unmodified-Since"),
) -> dict[str, Any]:
    """Save, unless somebody else saved first.

    The client sends the `updatedAtIso` it last saw. If the stored row has moved
    on since, this is two people editing one plan and the later write would
    erase the earlier one **with neither of them told**. A 409 gives the client
    something to show instead of a silent loss.

    Absent header = no opinion, which keeps every existing caller working: the
    offline replay, the trace scripts, and anything written before this existed.
    """
    if body.data is None:
        raise HTTPException(status_code=400, detail="name and data required")
    if if_unmodified_since:
        current = store.get_project(db, project_id)
        if current is not None and current["updatedAtIso"] != if_unmodified_since:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "conflict",
                    "storedAtIso": current["updatedAtIso"],
                    "yoursAtIso": if_unmodified_since,
                },
            )
    # Checked, not enforced: a save that does not match the schema is still the
    # user's work, and the client may legitimately be ahead of us.
    check_stored_plan(body.data, project_id=project_id)
    return store.save_project(db, project_id, body.name, body.data)


@router.delete("/projects/{project_id}")
def remove_project(project_id: str, db: Session = Depends(store.get_db)) -> dict[str, bool]:
    """Move to the bin — recoverable for `PURGE_AFTER_DAYS`, then really gone."""
    store.delete_project(db, project_id)
    return {"ok": True}


@router.post("/projects/{project_id}/restore")
def restore(project_id: str, db: Session = Depends(store.get_db)) -> dict[str, bool]:
    if not store.restore_project(db, project_id):
        raise HTTPException(status_code=404, detail="not in the bin")
    return {"ok": True}
