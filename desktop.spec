# PyInstaller build for the standalone desktop application.
#
#     pyinstaller desktop.spec --noconfirm
#
# Build the client first — client/dist is bundled as ./static, which is where
# desktop.py points INTERIOR_STATIC_DIR. build-desktop.sh does both in order.
#
# One directory, not one file. --onefile unpacks ~300 MB to a temp folder on
# every launch, which costs several seconds each time and leaves the antivirus
# on Windows scanning a fresh copy every run. A folder starts instantly.
#
# Cross-compilation is not possible: PyInstaller freezes the interpreter and
# binary extensions of the machine it runs on. The Windows .exe has to be built
# on Windows.

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

root = Path(SPECPATH)

hiddenimports = [
    # uvicorn picks its loop and protocol implementations by string name at
    # runtime, so nothing imports them statically for the analysis to follow.
    *collect_submodules("uvicorn"),
    # SQLAlchemy loads dialects through its own registry, likewise by name.
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.dialects.sqlite.pysqlite",
]

a = Analysis(
    [str(root / "server" / "desktop.py")],
    pathex=[str(root / "server")],
    binaries=[],
    datas=[(str(root / "client" / "dist"), "static")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # psycopg is only for the server deployment; the desktop build uses SQLite,
    # and dropping it saves the ~16 MB of bundled libpq.
    excludes=["psycopg", "psycopg_binary", "tkinter", "pytest", "PyInstaller"],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="InteriorDesigner",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,   # the window is the app's stop button, and shows the URL
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="InteriorDesigner",
)
