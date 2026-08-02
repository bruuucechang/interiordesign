"""Copy saved plans from the old node:sqlite file into PostgreSQL.

Idempotent: rows are matched on the client-generated id, so re-running only
refreshes what is already there. Run with --dry-run first; it reports exactly
what would change without touching the database.

    python -m scripts.migrate_sqlite_to_pg --dry-run
    python -m scripts.migrate_sqlite_to_pg
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db as store  # noqa: E402

SQLITE_PATH = Path(__file__).resolve().parents[1] / "data" / "interior.db"


def read_sqlite(path: Path) -> list[dict]:
    if not path.exists():
        return []
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT id, name, data, created_at, updated_at FROM projects ORDER BY updated_at"
        ).fetchall()
    finally:
        con.close()

    out = []
    for r in rows:
        try:
            data = json.loads(r["data"])
        except json.JSONDecodeError as e:
            print(f"  ! skipping {r['id']}: unreadable JSON ({e})")
            continue
        out.append(
            {
                "id": r["id"],
                "name": r["name"],
                "data": data,
                "created_at": _parse(r["created_at"]),
                "updated_at": _parse(r["updated_at"]),
            }
        )
    return out


def _parse(s: str | None) -> datetime:
    # SQLite wrote "YYYY-MM-DD HH:MM:SS" in UTC via datetime('now').
    if not s:
        return datetime.now(timezone.utc)
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report without writing")
    args = ap.parse_args()

    rows = read_sqlite(SQLITE_PATH)
    print(f"SQLite  : {SQLITE_PATH}")
    print(f"          {len(rows)} project(s) readable")
    if not rows:
        print("Nothing to migrate.")
        return 0

    store.init_db()
    with store.SessionLocal() as db:
        existing = {r["id"] for r in store.list_projects(db)}
        new = [r for r in rows if r["id"] not in existing]
        update = [r for r in rows if r["id"] in existing]
        print(f"Postgres: {store.DATABASE_URL}")
        print(f"          {len(existing)} already there → {len(new)} new, {len(update)} to refresh")

        if args.dry_run:
            for r in rows[:5]:
                objs = sum(len(f.get("objects", [])) for f in r["data"].get("floors", []))
                print(f"  would write {r['id']:<24} {r['name'][:18]:<20} {objs:>3} objects")
            if len(rows) > 5:
                print(f"  … and {len(rows) - 5} more")
            print("\nDry run — nothing written.")
            return 0

        for r in rows:
            row = db.get(store.Floorplan, r["id"])
            if row is None:
                db.add(
                    store.Floorplan(
                        id=r["id"], name=r["name"], data=r["data"],
                        created_at=r["created_at"], updated_at=r["updated_at"],
                    )
                )
            else:
                row.name, row.data = r["name"], r["data"]
                row.created_at, row.updated_at = r["created_at"], r["updated_at"]
        db.commit()

        after = store.list_projects(db)
        print(f"\nDone. Postgres now holds {len(after)} project(s).")
        # Verify a sample round-trips identically rather than trusting the write.
        sample = rows[len(rows) // 2]
        got = store.get_project(db, sample["id"])
        ok = got is not None and got["data"] == sample["data"]
        print(f"Round-trip check on {sample['id']}: {'OK' if ok else 'MISMATCH'}")
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
