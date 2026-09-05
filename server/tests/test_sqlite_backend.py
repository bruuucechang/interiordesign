"""The desktop build's database, which nothing else here touches.

`db.py` declares two backends — PostgreSQL for the server, SQLite for the
standalone desktop application — but every other test in this directory runs
against PostgreSQL, because `conftest.py` sets DATABASE_URL before the app is
imported. So half of the stated contract had no coverage at all.

That is not theoretical. `init_db()` was written with
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, which is PostgreSQL-only syntax. On
SQLite it raises inside the FastAPI lifespan, so the packaged desktop app
printed its URL, failed to start, and never listened on the port. Every test
was green the whole time. It was found by installing the Windows build and
asking for the page.

These run in a subprocess because `db.py` reads DATABASE_URL and builds its
engine **at import time** — the module is already bound to Postgres by the time
any test body runs, and re-importing it in-process would poison the shared
module for everything else.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]


def _run(db_path: Path, body: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ, DATABASE_URL=f"sqlite+pysqlite:///{db_path}")
    return subprocess.run(
        [sys.executable, "-c", body],
        cwd=SERVER_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


FRESH = """
from app.db import init_db, engine
from sqlalchemy import inspect

init_db()
init_db()   # the desktop build runs this on every launch, so it must be idempotent

cols = {c["name"] for c in inspect(engine).get_columns("floorplans")}
missing = {"id", "name", "data", "created_at", "updated_at", "deleted_at", "owner"} - cols
assert not missing, f"missing columns: {missing}"
print("OK")
"""


def test_init_db_on_a_fresh_sqlite_file(tmp_path):
    r = _run(tmp_path / "fresh.sqlite3", FRESH)
    assert r.returncode == 0, r.stderr
    assert "OK" in r.stdout


LEGACY = """
import sqlite3, os, re

# The shape a desktop install had before soft delete and owners existed. Built
# with the sqlite3 module directly so it cannot accidentally pick up today's
# model definition — the point is to be genuinely old.
path = re.sub(r"^sqlite\\+pysqlite:///", "", os.environ["DATABASE_URL"])
con = sqlite3.connect(path)
con.execute(
    "CREATE TABLE floorplans ("
    " id VARCHAR(64) NOT NULL PRIMARY KEY,"
    " name VARCHAR(200) NOT NULL,"
    " data JSON NOT NULL,"
    " created_at TIMESTAMP NOT NULL,"
    " updated_at TIMESTAMP NOT NULL)"
)
con.execute(
    "INSERT INTO floorplans VALUES ('proj_old_1','舊圖','{}', "
    "'2026-08-19 14:33:08', '2026-08-19 14:33:08')"
)
con.commit()
con.close()

from app.db import init_db, engine
from sqlalchemy import inspect, text

init_db()

cols = {c["name"] for c in inspect(engine).get_columns("floorplans")}
assert "deleted_at" in cols and "owner" in cols, cols

# Upgrading must not disturb the plan that was already there. A desktop user's
# only copy of their work lives in this file.
with engine.begin() as conn:
    row = conn.execute(text(
        "SELECT name, deleted_at, owner FROM floorplans WHERE id='proj_old_1'"
    )).one()
assert row[0] == "舊圖", row
assert row[1] is None, "an existing plan must not come back marked deleted"
assert row[2] is None, "an existing plan has no owner, and must stay visible"
print("OK")
"""


def test_init_db_upgrades_a_pre_existing_desktop_file(tmp_path):
    r = _run(tmp_path / "legacy.sqlite3", LEGACY)
    assert r.returncode == 0, r.stderr
    assert "OK" in r.stdout


BOOT = """
from fastapi.testclient import TestClient
from app.main import app

# The real startup path: this is where the PostgreSQL-only DDL blew up, inside
# the lifespan handler rather than anywhere a unit test was looking.
with TestClient(app) as client:
    r = client.get("/api/projects")
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.json()["projects"] == []
print("OK")
"""


def test_the_app_actually_starts_on_sqlite(tmp_path):
    r = _run(tmp_path / "boot.sqlite3", BOOT)
    assert r.returncode == 0, r.stderr
    assert "OK" in r.stdout


ROUNDTRIP = """
from fastapi.testclient import TestClient
from app.main import app

# Everything the desktop application actually does to its file. Booting and
# listing an empty table proves the schema is legal; it does not prove a plan
# survives being written, binned and brought back — and the soft-delete columns
# that broke startup are exactly the ones these paths use.
PLAN = {"id": "proj_sqlite_1", "schemaVersion": 1, "name": "測試平面圖",
        "floors": [{"id": "f1", "name": "1F", "elevation": 0, "objects": []}],
        "activeFloorId": "f1"}
HDR = {"X-Owner": "ann"}

with TestClient(app) as c:
    assert c.put("/api/projects/proj_sqlite_1",
                 json={"name": "測試平面圖", "data": PLAN}, headers=HDR).status_code == 200

    got = c.get("/api/projects/proj_sqlite_1", headers=HDR)
    assert got.status_code == 200, got.text
    assert got.json()["data"]["id"] == "proj_sqlite_1"
    assert [p["id"] for p in c.get("/api/projects", headers=HDR).json()["projects"]] == ["proj_sqlite_1"]

    # Owner isolation has to hold here too — the desktop build is single-user
    # today, but the column is the same column and a silent leak is the kind of
    # thing that only shows up once two people share a machine.
    assert c.get("/api/projects/proj_sqlite_1", headers={"X-Owner": "bob"}).status_code == 404

    assert c.delete("/api/projects/proj_sqlite_1", headers=HDR).status_code in (200, 204)
    assert c.get("/api/projects", headers=HDR).json()["projects"] == []
    # Binned, not gone: opening it again must not resurrect it either.
    assert c.get("/api/projects/proj_sqlite_1", headers=HDR).status_code == 404
    assert [p["id"] for p in c.get("/api/projects-deleted", headers=HDR).json()["projects"]] == ["proj_sqlite_1"]

    assert c.post("/api/projects/proj_sqlite_1/restore", headers=HDR).status_code in (200, 204)
    back = c.get("/api/projects/proj_sqlite_1", headers=HDR)
    assert back.status_code == 200, back.text
    assert back.json()["data"]["floors"][0]["id"] == "f1"
print("OK")
"""


def test_save_bin_and_restore_round_trip_on_sqlite(tmp_path):
    r = _run(tmp_path / "roundtrip.sqlite3", ROUNDTRIP)
    assert r.returncode == 0, r.stderr
    assert "OK" in r.stdout
