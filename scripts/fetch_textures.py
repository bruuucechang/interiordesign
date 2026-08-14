"""Fetch the photographed material maps.

    .venv/bin/python scripts/fetch_textures.py          # 只抓缺的
    .venv/bin/python scripts/fetch_textures.py --force  # 全部重抓

Writes client/public/textures/<materialId>/{color,normal,arm}.jpg and a
manifest.json next to them. Run it again after editing ASSETS; it skips whatever
is already on disk.

**Poly Haven first, and the reason matters.** The first version of this script
took everything from ambientCG and the result looked cheap. The cause was not
resolution: all twelve assets it picked were `creationMethod: PBRProcedural` —
ambientCG's *own generated* materials, of which the site has 1412 against 351
real scans. So the change was swapping this project's procedural generator for
somebody else's. Poly Haven publishes only photogrammetry, which is why the
grout lines, the trowel marks and the colour drift across a wood plank are
there at all.

Where ambientCG is still used, it is filtered to `PBRPhotogrammetry` — that is
the only reason `carpet` and `wallpaper` come from there: Poly Haven's whole
catalogue has one carpet (`dirty_carpet`) and one wallpaper (`decrepit_wallpaper`).

**Licence: CC0 1.0 on both.** Public domain, commercial use, no attribution
required — nothing to comply with at distribution time. That is why these two
and not the sites with prettier textures and a licence that has to be read.

Why the files are committed rather than fetched at build time: the app has to
work offline (the desktop build is a single executable with no network) and a
build that reaches the internet fails on the machine where nobody expected it
to.

Three maps, not four. Poly Haven ships **ARM** — ambient occlusion in R,
roughness in G, metalness in B — which is exactly how three.js samples
`aoMap`/`roughnessMap`/`metalnessMap`, so one file feeds all three slots and the
AO is free. The ambientCG sets are packed into the same layout here so the app
only has to know one convention.

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

PH, ACG = 'polyhaven', 'ambientcg'

# materialId (core/materials.ts) → (source, asset). Chosen by eye off the contact
# sheets and then confirmed by `node bench/shot.mjs`, because the thumbnails are
# lit spheres and they lie about value — the first round shipped a walnut that
# rendered near-black, a grey screed that rendered white, a woven carpet that
# rendered flat and a grey linen that rendered navy blue. Pick from the render.
ASSETS = {
    'wood':        (PH,  'wooden_floor_01'),     # 橡木地板 — oak boards, 199 cm
    'walnut':      (PH,  'plank_flooring_04'),   # 胡桃木地板 — dark red-brown, 200 cm
    'herringbone': (PH,  'herringbone_parquet'), # 人字拼木 — 340 cm
    'tile':        (PH,  'interior_tiles'),      # 拋光石英磚 — large cream tiles, 190 cm
    'marble':      (PH,  'marble_01'),           # 大理石 — clean polished, 150 cm
    'terrazzo':    (ACG, 'Terrazzo005'),         # 磨石子 — 見下方註解
    'concrete':    (PH,  'painted_concrete_02'), # 水泥粉光 — smooth mid-grey, 400 cm
    'plaster':     (PH,  'white_stucco'),        # 藝術塗料 — trowelled, 200 cm
    'brick':       (PH,  'whitewashed_brick'),   # 文化石 — 200 cm
    'walltile':    (PH,  'long_white_tiles'),    # 壁磚 — white glazed, 127 cm
    'carpet':      (ACG, 'Fabric045'),           # 地毯 — 標籤就是 rug，米白織紋
    'wallpaper':   (ACG, 'Fabric043'),           # 壁紙 — 灰色布紋
}

# `paint` (乳膠漆) is deliberately absent from both sources. Every plaster scan
# is a rough render, and at room scale a rough render on a painted wall reads as
# sandpaper — the exact failure this project already hit once when the procedural
# mixer was rewritten. The generated near-flat wall is more truthful.

SIZE = 1024            # up from 512: these are scans now and they carry the detail
QUALITY = 86
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'public' / 'textures'

PH_FILES = 'https://api.polyhaven.com/files/{}'
PH_INFO = 'https://api.polyhaven.com/info/{}'
ACG_API = 'https://ambientcg.com/api/v2/full_json?id={}'
ACG_ZIP = 'https://ambientcg.com/get?file={}_2K-JPG.zip'


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'interior-designer/1.0'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def decode(buf: bytes) -> np.ndarray:
    return cv2.resize(cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_COLOR),
                      (SIZE, SIZE), interpolation=cv2.INTER_AREA)


def from_polyhaven(asset: str) -> tuple[dict, dict]:
    files = json.loads(fetch(PH_FILES.format(asset)))
    info = json.loads(fetch(PH_INFO.format(asset)))
    url = lambda k: files[k]['2k']['jpg']['url']
    maps = {'color': decode(fetch(url('Diffuse'))),
            'normal': decode(fetch(url('nor_gl'))),
            'arm': decode(fetch(url('arm')))}
    # `dimensions` is millimetres, and it is the real-world size of the scan —
    # the honest tile size. Guessing it is how a 2 m tile ends up as mosaic.
    dim = (info.get('dimensions') or [0, 0])[0] / 10
    return maps, {'tileCm': round(dim) if dim > 0 else None,
                  'attribution': f'Poly Haven — {asset} (CC0)'}


def from_ambientcg(asset: str) -> tuple[dict, dict]:
    meta = json.loads(fetch(ACG_API.format(asset)))['foundAssets'][0]
    z = zipfile.ZipFile(io.BytesIO(fetch(ACG_ZIP.format(asset))))
    pick = lambda s: next((n for n in z.namelist() if n.endswith(s)), None)
    ao = pick('_AmbientOcclusion.jpg')
    rough = pick('_Roughness.jpg')
    # Packed by hand into the same ARM layout Poly Haven ships, so the app has
    # one convention to know: AO in R, roughness in G, metalness in B.
    arm = np.zeros((SIZE, SIZE, 3), np.uint8)
    if ao:    arm[:, :, 2] = cv2.cvtColor(decode(z.read(ao)), cv2.COLOR_BGR2GRAY)      # BGR: R is index 2
    else:     arm[:, :, 2] = 255
    if rough: arm[:, :, 1] = cv2.cvtColor(decode(z.read(rough)), cv2.COLOR_BGR2GRAY)
    else:     arm[:, :, 1] = 200
    maps = {'color': decode(z.read(pick('_Color.jpg'))),
            'normal': decode(z.read(pick('_NormalGL.jpg'))),
            'arm': arm}
    dim = meta.get('dimensionX') or 0
    return maps, {'tileCm': dim if dim > 0 else None,
                  'attribution': f'ambientCG — {asset} (CC0)'}


def one(mid: str, src: str, asset: str, force: bool) -> dict:
    d = OUT / mid
    have = d.is_dir() and all((d / f'{k}.jpg').exists() for k in ('color', 'normal', 'arm'))
    if have and not force:
        print(f'  {mid:<12} {src:<10} {asset:<22} 已存在，跳過')
        return json.loads((d / 'meta.json').read_text(encoding='utf-8'))

    print(f'  {mid:<12} {src:<10} {asset:<22} 下載中…', end='', flush=True)
    maps, entry = (from_polyhaven if src == PH else from_ambientcg)(asset)
    d.mkdir(parents=True, exist_ok=True)
    for k, im in maps.items():
        cv2.imwrite(str(d / f'{k}.jpg'), im, [cv2.IMWRITE_JPEG_QUALITY, QUALITY])
    entry |= {'source': src, 'asset': asset}
    (d / 'meta.json').write_text(json.dumps(entry, ensure_ascii=False), encoding='utf-8')
    kb = sum((d / f'{k}.jpg').stat().st_size for k in maps) / 1024
    print(f'  {kb:6.0f} KB   {entry["tileCm"] or "?"} cm')
    return entry


def main() -> int:
    force = '--force' in sys.argv
    if force and OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    print(f'{len(ASSETS)} 種材質 → {OUT.relative_to(ROOT)}  ({SIZE}²)')
    manifest = {mid: one(mid, src, asset, force) for mid, (src, asset) in ASSETS.items()}
    (OUT / 'manifest.json').write_text(
        json.dumps({'sources': {PH: 'https://polyhaven.com', ACG: 'https://ambientcg.com'},
                    'license': 'CC0 1.0', 'size': SIZE, 'materials': manifest},
                   ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    total = sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file()) / 1024 / 1024
    print(f'共 {total:.1f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
