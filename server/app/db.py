"""PostgreSQL access for saved floor plans.

One table, one row per project. The plan itself is stored as JSONB rather than
being decomposed into tables: the client owns the document schema and evolves it
freely (objects gained `bulge`, then `style`, then floors), so pinning it to
columns would mean a migration for every editor feature.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, String, create_engine, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://localhost/interior_design"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    pass


class Floorplan(Base):
    __tablename__ = "floorplans"

    # Client-generated ids ("proj_mror5zlt_2"), so a plan keeps its identity
    # across the offline localStorage fallback and the server.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def init_db() -> None:
    Base.metadata.create_all(engine)


def list_projects(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(
        select(Floorplan.id, Floorplan.name, Floorplan.updated_at).order_by(
            Floorplan.updated_at.desc()
        )
    ).all()
    return [{"id": r.id, "name": r.name, "updatedAt": _iso(r.updated_at)} for r in rows]


def get_project(db: Session, project_id: str) -> dict[str, Any] | None:
    row = db.get(Floorplan, project_id)
    if row is None:
        return None
    return {
        "id": row.id,
        "name": row.name,
        "data": row.data,
        "updatedAt": _iso(row.updated_at),
    }


def save_project(db: Session, project_id: str, name: str, data: Any) -> dict[str, str]:
    row = db.get(Floorplan, project_id)
    now = datetime.now(timezone.utc)
    if row is None:
        row = Floorplan(id=project_id, name=name, data=data, created_at=now, updated_at=now)
        db.add(row)
    else:
        row.name = name
        row.data = data
        row.updated_at = now
    db.commit()
    return {"id": project_id, "name": name}


def delete_project(db: Session, project_id: str) -> None:
    row = db.get(Floorplan, project_id)
    if row is not None:
        db.delete(row)
        db.commit()


def _iso(dt: datetime | None) -> str:
    # The client only ever displays this, and the old Node backend sent
    # "YYYY-MM-DD HH:MM:SS", so keep that shape rather than full ISO-8601.
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else ""
