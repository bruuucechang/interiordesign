@echo off
REM Builds the standalone desktop application on Windows.
REM Requires Python 3.11+ and Node 20+ on PATH. Output: dist\InteriorDesigner\
REM
REM Order matters — see the comment in build-desktop.sh. The 3D models are
REM fetched before the client build, because Vite copies client\public into
REM client\dist during it, and fetching needs the Python environment.
REM
REM `npm run assets` is deliberately not used here: those npm scripts hardcode
REM .venv/bin/python, which does not exist on Windows.
setlocal
cd /d "%~dp0"

echo ==^> preparing python environment
if not exist .venv python -m venv .venv || exit /b 1
.venv\Scripts\pip install --quiet --upgrade pip
.venv\Scripts\pip install --quiet -r server\requirements.txt pyinstaller || exit /b 1

echo ==^> fetching 3D assets (existing ones are skipped)
for %%S in (fetch_models fetch_kenney fetch_quaternius fetch_sweethome) do (
  .venv\Scripts\python scripts\%%S.py || exit /b 1
)

echo ==^> building client
pushd client && call npm ci && call npm run build || exit /b 1
popd

echo ==^> checking assets reached the build
node scripts\check-assets.mjs client\dist || exit /b 1

echo ==^> freezing
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
.venv\Scripts\pyinstaller desktop.spec --noconfirm --log-level WARN || exit /b 1

echo ==^> checking assets reached the package
node scripts\check-assets.mjs dist\InteriorDesigner\_internal\static || exit /b 1

echo.
echo done: dist\InteriorDesigner\InteriorDesigner.exe
