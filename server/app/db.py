"""Storage for saved floor plans.

One table, one row per project. The plan itself is stored as a JSON column
rather than being decomposed into tables: the client owns the document schema
and evolves it freely (objects gained `bulge`, then `style`, then floors), so
pinning it to columns would mean a migration for every editor feature.

Two backends, chosen by DATABASE_URL:

  PostgreSQL  the server deployment, including the Docker compose stack
  SQLite      the desktop build, where bundling a database server is not an
              option and a single file next to the user's documents is what a
              standalone application should use

JSONB is Postgres-only, so the column is declared as portable JSON with a
Postgres variant. Declaring plain JSON would work everywhere, but a freshly
created Postgres database would then get a `json` column while every database
created before this change has `jsonb` — a schema difference for no gain.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import JSON, DateTime, String, create_engine, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

PLAN_JSON = JSON().with_variant(JSONB(), "postgresql")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://localhost/interior_design"
)

if DATABASE_URL.startswith("sqlite"):
    # A file path in the URL may point somewhere that does not exist yet.
    path = DATABASE_URL.split("///", 1)[-1]
    if path and path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread: uvicorn serves requests from a thread pool, and each
    # request opens its own session, so the connection legitimately moves
    # between threads.
    engine = create_engine(
        DATABASE_URL, future=True, connect_args={"check_same_thread": False}
    )
else:
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
    data: Mapped[dict[str, Any]] = mapped_column(PLAN_JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Deletion is a soft delete. A plan is hours of somebody's work and the only
    # copy; a `刪除` next to a row whose name is one of sixteen near-identical
    # ones is a mis-click waiting to happen, and until now the only way back was
    # a `pg_dump` taken beforehand — which a user does not have.
    #
    # NULL means live. Set means in the bin, and `purge_deleted` clears it out
    # after the grace period.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )


#: How long a deleted plan stays recoverable.
PURGE_AFTER_DAYS = 30


def init_db() -> None:
    Base.metadata.create_all(engine)
    # `create_all` only creates missing *tables*, never missing columns, so an
    # existing install needs the column added by hand. Additive and idempotent,
    # so it is safe to run on every boot.
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "ALTER TABLE floorplans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"
        )


def get_db() -> Iterator[Session]:
    """One session per request; the routers take this as a dependency."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def list_projects(db: Session, *, deleted: bool = False) -> list[dict[str, Any]]:
    """Live plans, or the ones in the bin.

    The default has to be "live". Anything that forgets the filter and lists
    everything puts deleted plans back in the open dialog, where opening one
    and editing it would resurrect it by the back door.
    """
    where = Floorplan.deleted_at.is_not(None) if deleted else Floorplan.deleted_at.is_(None)
    rows = db.execute(
        select(
            Floorplan.id, Floorplan.name, Floorplan.updated_at, Floorplan.deleted_at
        ).where(where).order_by(
            (Floorplan.deleted_at if deleted else Floorplan.updated_at).desc()
        )
    ).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            **_times(r.updated_at),
            **({"deletedAtIso": r.deleted_at.isoformat()} if r.deleted_at else {}),
        }
        for r in rows
    ]


def get_project(db: Session, project_id: str) -> dict[str, Any] | None:
    """A live plan, or None.

    A binned plan reads as absent. Returning it would let the client open one
    from a stale link, edit it, and have autosave write it straight back —
    resurrecting it without anyone choosing to. Restoring is a deliberate act
    (`/restore`), not a side effect of looking at something.
    """
    row = db.get(Floorplan, project_id)
    if row is None or row.deleted_at is not None:
        return None
    return {
        "id": row.id,
        "name": row.name,
        "data": row.data,
        **_times(row.updated_at),
    }


def save_project(db: Session, project_id: str, name: str, data: Any) -> dict[str, Any]:
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
    # The stored time comes back so the client can file its local mirror under
    # the server's clock rather than its own, and stop the two disagreeing.
    return {"id": project_id, "name": name, **_times(row.updated_at)}


def delete_project(db: Session, project_id: str) -> None:
    """Move to the bin. The row and its data stay put."""
    row = db.get(Floorplan, project_id)
    if row is not None and row.deleted_at is None:
        row.deleted_at = datetime.now(timezone.utc)
        db.commit()


def restore_project(db: Session, project_id: str) -> bool:
    """Take it back out of the bin. False if there was nothing to restore."""
    row = db.get(Floorplan, project_id)
    if row is None or row.deleted_at is None:
        return False
    row.deleted_at = None
    db.commit()
    return True


def purge_deleted(db: Session, older_than_days: int = PURGE_AFTER_DAYS) -> int:
    """Really remove what has been in the bin past the grace period.

    Called on startup rather than on a timer: a tool that is not running is not
    accumulating anything either, and a scheduler is a second thing to get
    wrong.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    rows = db.execute(
        select(Floorplan).where(
            Floorplan.deleted_at.is_not(None), Floorplan.deleted_at < cutoff
        )
    ).scalars().all()
    for row in rows:
        db.delete(row)
    if rows:
        db.commit()
    return len(rows)


def _times(dt: datetime | None) -> dict[str, str]:
    """Both forms of a timestamp: one to show, one to compare.

    `updatedAt` is what the project list prints and the old Node backend sent —
    "YYYY-MM-DD HH:MM:SS", in whatever zone the database hands back, with no
    marker saying which. That is fine to display and useless to compare, and
    the offline mirror has to compare: a plan saved locally while the backend
    was unreachable is only newer if the two times mean the same thing.
    `updatedAtIso` is therefore the same instant in UTC, spelled out.
    """
    if dt is None:
        return {"updatedAt": "", "updatedAtIso": ""}
    return {
        "updatedAt": dt.strftime("%Y-%m-%d %H:%M:%S"),
        "updatedAtIso": dt.astimezone(timezone.utc).isoformat(),
    }
