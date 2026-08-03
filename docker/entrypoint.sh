#!/bin/sh
# Wait for PostgreSQL before starting.
#
# compose's depends_on only waits for the container, not for the server inside
# it to accept connections, so a cold `docker compose up` would otherwise race:
# the API starts, fails to create its table, and exits.
set -e

python - <<'PY'
import os, sys, time
import psycopg

url = os.environ.get("DATABASE_URL", "")
# psycopg wants a plain URL; SQLAlchemy's driver suffix is not part of one.
dsn = url.replace("postgresql+psycopg://", "postgresql://")

deadline = time.time() + 60
last = None
while time.time() < deadline:
    try:
        with psycopg.connect(dsn, connect_timeout=3):
            print("database ready", flush=True)
            sys.exit(0)
    except Exception as e:      # noqa: BLE001 — any failure means "not yet"
        last = e
        time.sleep(1)

print(f"database not reachable after 60s: {last}", file=sys.stderr)
sys.exit(1)
PY

exec "$@"
