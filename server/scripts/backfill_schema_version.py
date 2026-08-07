"""Bring every stored plan up to the current schema version.

Run this after a change that bumps SCHEMA_VERSION. It does not know how to
migrate anything itself — it hands the plans to scripts/migrate-plans.ts, which
runs the editor's own migration, so the ladder has one implementation and the
database cannot end up transformed differently from the browser.

`updated_at` is left alone. Migrating is not the user editing, and the project
list is sorted by it: rewriting all of them would shuffle every plan to the top
and lose which one was actually worked on last.

    python -m scripts.backfill_schema_version              # dry run, the default
    python -m scripts.backfill_schema_version --apply

Take a backup first — for PostgreSQL:

    pg_dump interior_design > ~/interior_design_before_backfill.sql
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, update  # noqa: E402

from app.db import Floorplan, SessionLocal, engine  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TSX = ROOT / "node_modules" / ".bin" / "tsx"
MIGRATOR = ROOT / "scripts" / "migrate-plans.ts"


def run_migration(rows: list[dict]) -> dict:
    """The plans as the editor would migrate them."""
    if not TSX.exists():
        raise SystemExit(f"{TSX} is missing — run `npm install` first")
    result = subprocess.run(
        [str(TSX), str(MIGRATOR)],
        input=json.dumps(rows),
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if result.returncode != 0:
        raise SystemExit(f"migrate-plans.ts failed:\n{result.stderr}")
    return json.loads(result.stdout)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true",
        help="write the migrated plans back (without this, only report)",
    )
    args = parser.parse_args()

    with SessionLocal() as db:
        stored = [
            {"id": r.id, "name": r.name, "data": r.data}
            for r in db.execute(select(Floorplan)).scalars()
        ]

    if not stored:
        print("no stored plans")
        return

    out = run_migration([{"id": r["id"], "data": r["data"]} for r in stored])
    names = {r["id"]: r["name"] for r in stored}
    changed = [r for r in out["rows"] if r["changed"]]

    print(f"schema version {out['schemaVersion']}")
    print(f"{len(stored)} plan(s) stored, {len(changed)} need migrating")
    for row in changed:
        before = next(s for s in stored if s["id"] == row["id"])["data"]
        was = before.get("schemaVersion", 0) if isinstance(before, dict) else 0
        note = "" if isinstance(before, dict) and "floors" in before else "  (pre-floors)"
        print(f"  {row['id']:<24} {names[row['id']][:20]:<20} v{was} -> v{out['schemaVersion']}{note}")

    if not changed:
        return
    if not args.apply:
        print("\ndry run — nothing written. Re-run with --apply once the list looks right.")
        return

    with engine.begin() as conn:
        for row in changed:
            conn.execute(
                update(Floorplan)
                .where(Floorplan.id == row["id"])
                .values(data=row["data"])
            )
    print(f"\nwrote {len(changed)} plan(s); updated_at left untouched")


if __name__ == "__main__":
    main()
