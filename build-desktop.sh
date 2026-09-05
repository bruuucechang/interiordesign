#!/usr/bin/env bash
# Builds the standalone desktop application for the machine it runs on.
#
#   ./build-desktop.sh          macOS / Linux
#   build-desktop.bat           Windows
#
# PyInstaller cannot cross-compile, so run this on each platform you want to
# ship. Output: dist/InteriorDesigner/
#
# Order matters, and it used to be wrong. The 3D models live in
# `client/public/models/` — 63 MB, gitignored — and Vite copies `public/` into
# `client/dist` **during the client build**. So they have to be fetched before
# it, and fetching needs the Python environment. Hence: venv, assets, client,
# freeze. Building the client first (as this script did) produced a package
# missing two thirds of the furniture, with no error anywhere.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 準備 Python 環境"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r server/requirements.txt pyinstaller

echo "==> 下載 3D 素材（已存在的會跳過）"
for s in fetch_models fetch_kenney fetch_quaternius fetch_sweethome; do
  ./.venv/bin/python "scripts/$s.py"
done

echo "==> 建置前端"
(cd client && npm ci --silent && npm run build)

echo "==> 檢查素材有沒有進到建置裡"
node scripts/check-assets.mjs client/dist

echo "==> 打包"
rm -rf build dist
./.venv/bin/pyinstaller desktop.spec --noconfirm --log-level WARN

echo "==> 檢查素材有沒有進到打包裡"
node scripts/check-assets.mjs dist/InteriorDesigner/_internal/static

echo
echo "完成： dist/InteriorDesigner/"
du -sh dist/InteriorDesigner
