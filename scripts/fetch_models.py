"""Fetch the CC0 furniture models from Poly Haven.

    .venv/bin/python scripts/fetch_models.py          # 只抓缺的
    .venv/bin/python scripts/fetch_models.py --force  # 全部重抓

Writes client/public/models/<catalogueId>/ — the .gltf, its .bin and its
textures, under the filenames the .gltf itself references — plus a manifest.json
recording each model's real size and where it came from.

**Licence: CC0 1.0**, the same as the surface textures, for the same reason:
public domain, commercial use, no attribution, nothing to comply with when the
desktop build ships as one executable.

**1k, then re-encoded to 512.** A sofa at 1k is 0.5 MB all-in and at 2k it is
2.1 MB — but several of these models ship three or four 1k maps per material, so
the seventeen came to 20 MB as downloaded. In a plan view of a whole flat a sofa
is 200 px tall; 512² at quality 80 is indistinguishable there and takes it to
about a third. The re-encode happens once, here, rather than every build.

`dimensions` from the API is the model's real size in millimetres, [w, d, h].
It is carried into the manifest and into the catalogue's default w/h, so a piece
dropped from the palette is the size the real thing is instead of a number
somebody typed. The 3D loader scales the model to whatever w/h the object ends
up with, so resizing still works — it just starts honest.
"""

import json
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

# catalogue id (client/src/data/furniture.ts) → Poly Haven model.
#
# The built-ins are not here on purpose: fridge, stove, sink, toilet, bathtub,
# shower, wardrobe, tv, rug and the kitchen/tall cabinets stay procedural.
# Poly Haven has none of them, and they are the pieces that get traced off a
# drawing at a specific size — a scanned 1980s cabinet would be worse than the
# box that at least matches the plan.
MODELS = {
    # 既有品項換成實掃模型
    'sofa':            'Sofa_01',
    'armchair':        'modern_arm_chair_01',
    'coffee':          'modern_coffee_table_01',
    'dining':          'dining_table',
    'chair':           'dining_chair_02',
    'nightstand':      'ClassicNightstand_01',
    'dresser':         'drawer_cabinet',
    'bookshelf':       'steel_frame_shelves_01',
    'cabinet_side':    'modern_wooden_cabinet',
    'desk':            'metal_office_desk',
    'display_cabinet': 'wooden_display_shelves_01',
    # 新增的款式
    'sofa_l':          'sofa_03',
    'side_table':      'side_table_01',
    'stool':           'wooden_stool_01',
    'ottoman':         'Ottoman_01',
    'lounge':          'mid_century_lounge_chair',
    'roundtable':      'round_wooden_table_01',

    # 第二批款式
    'armchair_classic': 'ArmChair_01',
    'accent_chair':     'GreenChair_01',
    'rocking':          'Rockingchair_01',
    'sofa_2':           'sofa_02',
    'bench':            'painted_wooden_bench',
    'console':          'ClassicConsole_01',
    'coffee_round':     'coffee_table_round_01',
    'side_tall':        'side_table_tall_01',
    'table_wood':       'WoodenTable_01',
    'stool_fold':       'folding_wooden_stool',
    'stool_bar':        'metal_stool_01',
    'cabinet_painted':  'painted_wooden_cabinet',
    'shelf_narrow':     'steel_frame_shelves_02',
    'bookshelf_wood':   'wooden_bookshelf_worn',
    'shelf_wall':       'painted_wooden_shelves',
    'mirror':           'ornate_mirror_01',
    'daybed':           'vintage_day_bed',
    # 中式一套。這間房子在台灣，太師椅、條案、屏風是會出現的東西。
    'cn_armchair':      'chinese_armchair',
    'cn_cabinet':       'chinese_cabinet',
    'cn_teatable':      'chinese_tea_table',
    'cn_screen':        'chinese_screen_panels',
    'cn_console':       'chinese_console_table',
}

RES = '1k'
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'public' / 'models'
FILES = 'https://api.polyhaven.com/files/{}'
INFO = 'https://api.polyhaven.com/info/{}'


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'interior-designer/1.0'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


TEX_SIZE = 512
TEX_QUALITY = 80


def shrink(d: Path) -> None:
    """Re-encode every texture in a downloaded model in place."""
    for f in list(d.rglob('*.jpg')) + list(d.rglob('*.png')):
        im = cv2.imread(str(f), cv2.IMREAD_UNCHANGED)
        if im is None:
            continue
        h, w = im.shape[:2]
        if max(h, w) > TEX_SIZE:
            k = TEX_SIZE / max(h, w)
            im = cv2.resize(im, (max(1, int(w * k)), max(1, int(h * k))), interpolation=cv2.INTER_AREA)
        if f.suffix == '.jpg':
            cv2.imwrite(str(f), im, [cv2.IMWRITE_JPEG_QUALITY, TEX_QUALITY])
        else:
            cv2.imwrite(str(f), im)


def one(cid: str, asset: str, force: bool) -> dict:
    d = OUT / cid
    files = json.loads(fetch(FILES.format(asset)))
    info = json.loads(fetch(INFO.format(asset)))
    node = files['gltf'][RES]['gltf']
    name = node['url'].rsplit('/', 1)[-1]
    dims = [round(x / 10, 1) for x in (info.get('dimensions') or [0, 0, 0])]
    entry = {'asset': asset, 'name': info.get('name', asset), 'file': name,
             'w': dims[0], 'd': dims[1], 'h': dims[2],
             'attribution': f'Poly Haven — {asset} (CC0)'}

    if d.is_dir() and (d / name).exists() and not force:
        print(f'  {cid:<16} {asset:<28} 已存在，跳過')
        return entry

    print(f'  {cid:<16} {asset:<28} 下載中…', end='', flush=True)
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(fetch(node['url']))
    # The .gltf refers to its .bin and textures by these exact relative paths,
    # so they have to keep their names and their subdirectory.
    for rel, f in node.get('include', {}).items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(fetch(f['url']))
    shrink(d)
    kb = sum(f.stat().st_size for f in d.rglob('*') if f.is_file()) / 1024
    print(f'  {kb:6.0f} KB   {dims[0]:.0f} × {dims[1]:.0f} × {dims[2]:.0f} cm')
    return entry


def main() -> int:
    force = '--force' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    print(f'{len(MODELS)} 件家具 → {OUT.relative_to(ROOT)}  ({RES})')
    manifest = {cid: one(cid, asset, force) for cid, asset in MODELS.items()}
    (OUT / 'manifest.json').write_text(
        json.dumps({'source': 'https://polyhaven.com', 'license': 'CC0 1.0',
                    'resolution': RES, 'models': manifest},
                   ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    total = sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file()) / 1024 / 1024
    print(f'共 {total:.1f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
