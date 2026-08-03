#!/usr/bin/env bash
# Builds the standalone desktop application for the machine it runs on.
#
#   ./build-desktop.sh          macOS / Linux
#   build-desktop.bat           Windows
#
# PyInstaller cannot cross-compile, so run this on each platform you want to
# ship. Output: dist/InteriorDesigner/
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 建置前端"
(cd client && npm ci --silent && npm run build)

echo "==> 準備 Python 環境"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r server/requirements.txt pyinstaller

echo "==> 打包"
rm -rf build dist
./.venv/bin/pyinstaller desktop.spec --noconfirm --log-level WARN

echo
echo "完成： dist/InteriorDesigner/"
du -sh dist/InteriorDesigner
