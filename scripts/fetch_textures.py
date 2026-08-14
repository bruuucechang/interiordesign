"""Fetch the photographed material maps from ambientCG.

    .venv/bin/python scripts/fetch_textures.py          # 只抓缺的
    .venv/bin/python scripts/fetch_textures.py --force  # 全部重抓

Writes client/public/textures/<materialId>/{color,normal,rough}.jpg and a
manifest.json next to them. Run it again after editing ASSETS; it skips whatever
is already on disk.

Why the files are committed rather than fetched at build time: the app has to
work offline (the desktop build is a single executable with no network) and a
build that reaches the internet fails on the machine where nobody expected it
to. Twelve materials at 512² cost about 2 MB, which is cheaper than the problem.

**Licence: CC0 1.0.** ambientCG publishes everything public domain — no
attribution required, commercial use allowed, nothing to comply with at
distribution time. That is the whole reason it was chosen over the sites with
prettier textures and a licence that has to be read. `attribution` in the
manifest is courtesy, not obligation.

Sizes: 512², to match the procedural generators the photos replace (SIZE in
core/textures3d.ts) and because the 1K source downsamples cleanly to it. Larger
looked no better in a room-scale render and every material is uploaded to the
GPU per plan.

NormalGL, not NormalDX — three.js uses the OpenGL convention, where green points
up. Taking DX by mistake inverts every bump and nothing errors; it just lights
from the wrong side, which is close enough to right that it is easy to miss.
"""

import io
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

import cv2
import numpy as np

# materialId (core/materials.ts) → ambientCG asset. Chosen by eye off the
# contact sheets, not by tag search: tags rank "clean modern floor" the same for
# a bleached ash and a walnut, and the id has to look like what its label says.
#
# Four of these are second choices. The thumbnails on the site are lit spheres
# and they lie about value: WoodFloor048 read as walnut and rendered near-black,
# Concrete034 read as grey screed and rendered white, Carpet014 read as woven and
# rendered featureless, and Fabric012 read as grey linen and rendered navy blue.
# Every one of them was only caught by `node bench/shot.mjs` — pick from the
# render, never from the thumbnail.
#
# `paint` (乳膠漆) is deliberately absent. Every plaster scan on the site is a
# rough render, and at room scale a rough render on a painted wall reads as
# sandpaper — the exact failure this project already hit once when the
# procedural mixer was rewritten. The generated near-flat wall is more truthful.
ASSETS = {
    'wood':        'WoodFloor051',   # 橡木地板 — warm mid-oak plank, 180 cm
    'walnut':      'WoodFloor011',   # 胡桃木地板 — mid-dark warm brown plank
    'herringbone': 'WoodFloor034',   # 人字拼木 — the only warm-oak herringbone, 190 cm
    'tile':        'Tiles139',       # 拋光石英磚 — large cream tiles, 200 cm
    'marble':      'Marble012',      # 大理石 — white with grey veining
    'terrazzo':    'Terrazzo005',    # 磨石子 — grey/white chips
    'carpet':      'Carpet009',      # 地毯 — beige with a woven square pattern
    'concrete':    'Concrete016',    # 水泥粉光 — smooth mid-grey screed
    'plaster':     'Plaster003',     # 藝術塗料 — trowelled render
    'brick':       'Bricks060',      # 文化石 — whitewashed brick, 105 cm
    'walltile':    'Tiles010',       # 壁磚 — white gloss offset
    'wallpaper':   'Wallpaper002B',  # 壁紙 — off-white with a textile grain
}

SIZE = 512
QUALITY = 88
MAPS = {'color': '_Color.jpg', 'normal': '_NormalGL.jpg', 'rough': '_Roughness.jpg'}

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'public' / 'textures'
API = 'https://ambientcg.com/api/v2/full_json?id={}'
GET = 'https://ambientcg.com/get?file={}_1K-JPG.zip'


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'interior-designer/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def one(mid: str, asset: str, force: bool) -> dict:
    d = OUT / mid
    have = d.is_dir() and all((d / f'{k}.jpg').exists() for k in MAPS)
    meta = json.loads(fetch(API.format(asset)))['foundAssets'][0]
    # dimensionX is the real-world width of the scan in centimetres. It is the
    # honest tile size, and it is why the manifest carries one at all — guessing
    # it is how a 2 m tile ends up looking like mosaic.
    dim = meta.get('dimensionX') or 0
    entry = {'asset': asset, 'name': meta.get('displayName', asset),
             'tileCm': dim if dim > 0 else None,
             'attribution': f'ambientCG — {asset} (CC0)'}
    if have and not force:
        print(f'  {mid:<12} {asset:<14} 已存在，跳過')
        return entry

    print(f'  {mid:<12} {asset:<14} 下載中…', end='', flush=True)
    z = zipfile.ZipFile(io.BytesIO(fetch(GET.format(asset))))
    names = z.namelist()
    d.mkdir(parents=True, exist_ok=True)
    for key, suffix in MAPS.items():
        hit = next((n for n in names if n.endswith(suffix)), None)
        if hit is None:
            print(f'  ⚠ 沒有 {suffix}', end='')
            continue
        buf = np.frombuffer(z.read(hit), np.uint8)
        im = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        im = cv2.resize(im, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
        if key == 'rough':
            # Roughness is a single channel; storing three identical ones costs
            # bytes for nothing. three.js reads it off green.
            im = cv2.cvtColor(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
        cv2.imwrite(str(d / f'{key}.jpg'), im, [cv2.IMWRITE_JPEG_QUALITY, QUALITY])
    kb = sum((d / f'{k}.jpg').stat().st_size for k in MAPS if (d / f'{k}.jpg').exists()) / 1024
    print(f'  {kb:6.0f} KB   {dim or "?"} cm')
    return entry


def main() -> int:
    force = '--force' in sys.argv
    if force and OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    print(f'{len(ASSETS)} 種材質 → {OUT.relative_to(ROOT)}')
    manifest = {mid: one(mid, asset, force) for mid, asset in ASSETS.items()}
    (OUT / 'manifest.json').write_text(
        json.dumps({'source': 'https://ambientcg.com', 'license': 'CC0 1.0',
                    'size': SIZE, 'materials': manifest},
                   ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    total = sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file()) / 1024 / 1024
    print(f'共 {total:.1f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
