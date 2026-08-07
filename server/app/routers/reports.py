"""Area schedules derived from a stored plan."""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import db as store
from ..plan import PlanFormatError, load_plan
from ..plan_schema import Project
from ..report import build_report, build_workbook

router = APIRouter(tags=["reports"])

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _load(project_id: str, db: Session) -> tuple[Project, str]:
    """The plan and the name to head the report with (the stored column wins)."""
    row = store.get_project(db, project_id)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    try:
        return load_plan(row["data"], project_id=project_id), row["name"]
    except PlanFormatError as exc:
        # 422 rather than an empty report: a schedule with no rows reads as
        # "this plan has no rooms", which is not what happened.
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/projects/{project_id}/report")
def project_report(
    project_id: str, db: Session = Depends(store.get_db)
) -> dict[str, Any]:
    """Room areas and furniture counts per floor."""
    project, name = _load(project_id, db)
    return build_report(project, name)


@router.get("/projects/{project_id}/report.xlsx")
def project_report_xlsx(
    project_id: str, db: Session = Depends(store.get_db)
) -> Response:
    """The same report as a spreadsheet, ready to price up."""
    project, name = _load(project_id, db)
    filename = quote(f"{name}_面積報表.xlsx")
    return Response(
        content=build_workbook(project, name),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
