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

import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "InteriorDesigner"

# The standalone build opens in Traditional Chinese, and says so rather than
# leaving the front end to infer it from `navigator.language`.
#
# The browser's language is not the person's. This build is handed to one named
# recipient by somebody who knows what they read, and plenty of Chinese-reading
# people run an English-language Chrome because that is what the laptop shipped
# with — in which case the app would greet them, and teach them, in English.
#
# Only a default: the front end keeps whatever the user has chosen, so the EN
# toggle in the toolbar still works and still sticks.
LANG_QUERY = "?lang=zh-Hant"


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


# Tried in order. **The order matters more than the numbers do**, because the
# port is part of the origin, and the origin is what the browser files
# localStorage under: language, the "you have seen the tour" flag, the panel
# state, and the offline mirror of anything not yet written to the database.
#
# This used to be `(8791, 0)` — the usual port, else let the OS pick one. On a
# machine where 8791 never binds, "let the OS pick" means **a different port on
# every launch**, so every launch is a fresh origin with an empty localStorage,
# so every launch is a first run: the tour again, the language again, the
# folded panels again. That is what was reported as 「instruction 有時候會在奇怪
# 時機跳出來」 — not odd timing, the same first run over and over.
#
# And 8791 failing is not hypothetical: on Windows it sits inside the range
# Hyper-V reserves dynamically (8712–8811 on the machines this project has
# met), where bind fails with a permissions error that names nothing. Every
# fallback below is deliberately outside that range, so a machine that cannot
# have 8791 still gets the *same* second choice every time.
PORTS = (8791, 18791, 28791, 38791)


def free_port(ports: tuple[int, ...] = PORTS) -> int:
    """The first port on the list that binds — the same one on every launch.

    Falls back to an OS-assigned port only if all four are taken, which needs
    four copies running at once. That case gets a working app with a fresh
    origin; the alternative is refusing to open at all.

    `ports` is a parameter so the tests can supply a list they control: this
    machine may well have something on 8791 already, and a test that depends on
    what happens to be listening is a test that reports the machine, not the code.
    """
    for port in tuple(ports) + (0,):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no port available")


def running_instance(ports: tuple[int, ...] = PORTS) -> int | None:
    """The port a copy of this app is already serving on, if there is one.

    **Double-clicking the icon twice must not start a second server.** It used
    to: the first copy holds 8791, so the second one took whatever was next —
    and a different port is a different origin, which means an empty
    localStorage, which means the app greets a long-time user as a first-time
    one. The tour again, the language again, the folded panels again. That is
    the "instructions appear at odd moments" report, in its second form.

    Asked by name, not just by "is something listening": handing the user's
    browser to whatever else happens to own the port would be worse than
    starting a second copy.
    """
    for port in ports:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as r:
                if json.load(r).get("app") == APP_NAME:
                    return port
        except (urllib.error.URLError, OSError, ValueError):
            continue
    return None


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

    # Already running? Then this launch is somebody asking to see it — open the
    # window they wanted and leave the one server alone.
    existing = running_instance()
    if existing is not None:
        url = f"http://127.0.0.1:{existing}/{LANG_QUERY}"
        print(f"{APP_NAME} 已經在執行中，開啟現有的視窗： {url}")
        webbrowser.open(url)
        return 0

    port = free_port()
    url = f"http://127.0.0.1:{port}/{LANG_QUERY}"

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
