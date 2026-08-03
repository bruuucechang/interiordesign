"""Desktop entry point.

Runs the whole application as one local process: the API and the built front end
served together, a SQLite file for storage, and the browser opened at it. No
Node, no Python, no PostgreSQL for the person using it — they double-click one
thing.

The browser is the window. That is a deliberate trade for keeping this a single
executable: wrapping it in a native shell would mean Tauri or Electron, which is
a different build entirely.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP_NAME = "InteriorDesigner"


def resource_dir() -> Path:
    """Where the bundled files live — inside the archive when frozen."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def data_dir() -> Path:
    """A per-user, writable place for the database.

    Never beside the executable: on macOS that is inside a read-only .app
    bundle, and on Windows it may be under Program Files.
    """
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    d = base / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def free_port(preferred: int = 8791) -> int:
    """Use the usual port when it is free, otherwise let the OS pick one.

    A fixed port would fail for the second copy, or when something else on the
    machine already holds it — neither should stop the app opening.
    """
    for port in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no port available")


def wait_until_up(port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.1)
    return False


def main() -> int:
    # A frozen console app writing to anything but a terminal is block-buffered,
    # so the URL and the data path would not appear until the process exits —
    # exactly the two lines the user needs while it is running.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(line_buffering=True)

    db_file = data_dir() / "floorplans.sqlite3"
    # Must be set before app.db is imported — it reads this at import time.
    os.environ.setdefault("DATABASE_URL", f"sqlite+pysqlite:///{db_file}")
    os.environ.setdefault("INTERIOR_STATIC_DIR", str(resource_dir() / "static"))

    port = free_port()
    url = f"http://127.0.0.1:{port}/"

    import uvicorn
    from app.main import app

    def open_when_ready() -> None:
        if wait_until_up(port):
            webbrowser.open(url)
        else:
            print(f"伺服器啟動逾時，請手動開啟 {url}", file=sys.stderr)

    threading.Thread(target=open_when_ready, daemon=True).start()

    print(f"{APP_NAME} 執行中： {url}")
    print(f"資料儲存於： {db_file}")
    print("關閉此視窗即結束程式。")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
