@echo off
REM Builds the standalone desktop application on Windows.
REM Requires Python 3.11+ and Node 20+ on PATH. Output: dist\InteriorDesigner\
setlocal
cd /d "%~dp0"

echo ==^> building client
pushd client && call npm ci && call npm run build || exit /b 1
popd

echo ==^> preparing python environment
if not exist .venv python -m venv .venv || exit /b 1
.venv\Scripts\pip install --quiet --upgrade pip
.venv\Scripts\pip install --quiet -r server\requirements.txt pyinstaller || exit /b 1

echo ==^> freezing
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
.venv\Scripts\pyinstaller desktop.spec --noconfirm --log-level WARN || exit /b 1

echo.
echo done: dist\InteriorDesigner\InteriorDesigner.exe
