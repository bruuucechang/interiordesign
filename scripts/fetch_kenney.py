"""Fetch the furniture Poly Haven does not have, from Kenney's Furniture Kit.

    .venv/bin/python scripts/fetch_kenney.py          # 只抓缺的
    .venv/bin/python scripts/fetch_kenney.py --force  # 全部重抓

Writes client/public/models/<catalogueId>/<name>.glb and merges the entries into
the same manifest.json that scripts/fetch_models.py writes, so the app has one
place to look.

**Why a second source.** Poly Haven is photogrammetry and it has no wardrobe, no
fridge, no stove, no sanitaryware and no bed that is not a carved antique —
those simply are not things anyone scans. Everything here is a category with no
CC0 scan anywhere, where the alternative is the hand-built box it replaces.

**They look different, and that is a real cost.** Kenney's models are
flat-shaded low-poly with a small palette texture: clean silhouettes, correct
proportions, real handles and taps, but no material detail. Next to a scanned
sofa's fabric weave the difference is visible. It was checked by rendering both
in the same frame before taking them, not assumed either way. The judgement:
a plain, correctly-proportioned wardrobe beats a procedural box with a mirror
stripe, and a toilet that looks like a toilet beats one made of four cylinders.

**Licence: CC0 1.0**, same as everything else here. Kenney asks for credit and
says it is not mandatory; the manifest carries it either way.

Sizes come from the glTF POSITION accessors' own min/max — Kenney publishes no
dimensions, and guessing them is how a fridge ends up the size of a wardrobe.
"""

import io
import json
import struct
import sys
import urllib.request
import zipfile
from pathlib import Path

ZIP = ('https://kenney.nl/media/pages/assets/furniture-kit/'
       '440e0608a4-1677580847/kenney_furniture-kit.zip')
INSIDE = 'Models/GLTF format/{}.glb'

# catalogue id → Kenney model. Every one of these replaces a procedural builder.
MODELS = {
    'bed_double':      'bedDouble',
    'bed_single':      'bedSingle',
    'wardrobe':        'bookcaseClosedDoors',
    'fridge':          'kitchenFridgeLarge',
    'stove':           'kitchenStove',
    'sink':            'kitchenSink',
    'toilet':          'toilet',
    'bathtub':         'bathtub',
    'shower':          'shower',
    'tv':              'cabinetTelevisionDoors',
    'rug':             'rugRectangle',
    'plant':           'pottedPlant',
    'cabinet_storage': 'bookcaseClosedWide',
    'shoe_cabinet':    'kitchenCabinetDrawer',
    'cabinet_kitchen': 'kitchenCabinet',
    'vanity':          'bathroomCabinetDrawer',
    'open_shelf':      'bookcaseOpen',
    'tall_cabinet':    'bookcaseClosed',
    # 順帶補上台灣住宅常見、目錄本來沒有的
    'washer':          'washer',
    'microwave':       'kitchenMicrowave',
    'coat_rack':       'coatRackStanding',
}

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'public' / 'models'


def glb_size_cm(data: bytes) -> tuple[float, float, float]:
    """Real size of a .glb, from the POSITION accessors' min/max.

    glTF stores those per accessor precisely so a reader does not have to walk
    the vertex buffer. Node transforms are ignored: these models are authored in
    place at unit scale, which the numbers confirm — a double bed comes out
    2.0 x 1.6 m.
    """
    magic, _ver, _len = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67, 'not a glb'
    off, doc = 12, None
    while off < len(data):
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        if ctype == 0x4E4F534A:                      # 'JSON'
            doc = json.loads(data[off + 8:off + 8 + clen])
            break
        off += 8 + clen
    lo = [float('inf')] * 3
    hi = [float('-inf')] * 3
    for m in doc.get('meshes', []):
        for prim in m.get('primitives', []):
            a = doc['accessors'][prim['attributes']['POSITION']]
            for i in range(3):
                lo[i] = min(lo[i], a['min'][i])
                hi[i] = max(hi[i], a['max'][i])
    # glTF is metres and Y-up; the app wants centimetres and (width, depth).
    return tuple(round((hi[i] - lo[i]) * 100, 1) for i in range(3))


def main() -> int:
    force = '--force' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() \
        else {'source': 'https://polyhaven.com', 'license': 'CC0 1.0', 'models': {}}

    need = [c for c in MODELS if force or not (OUT / c).is_dir()]
    if need:
        print(f'下載 Kenney Furniture Kit（{len(need)} 件要抓）…', flush=True)
        req = urllib.request.Request(ZIP, headers={'User-Agent': 'interior-designer/1.0'})
        with urllib.request.urlopen(req, timeout=300) as r:
            z = zipfile.ZipFile(io.BytesIO(r.read()))
    print(f'{len(MODELS)} 件 → {OUT.relative_to(ROOT)}')

    for cid, name in MODELS.items():
        d = OUT / cid
        f = d / f'{name}.glb'
        if not force and f.exists():
            print(f'  {cid:<16} {name:<24} 已存在，跳過')
            continue
        blob = z.read(INSIDE.format(name))
        d.mkdir(parents=True, exist_ok=True)
        f.write_bytes(blob)
        w, h, dep = glb_size_cm(blob)          # x, y(height), z(depth)
        manifest['models'][cid] = {
            'asset': name, 'name': name, 'file': f'{name}.glb',
            'w': w, 'd': dep, 'h': h, 'source': 'kenney',
            'attribution': 'Kenney — Furniture Kit (CC0)',
        }
        print(f'  {cid:<16} {name:<24} {len(blob) / 1024:6.0f} KB   {w:.0f} × {dep:.0f} × {h:.0f} cm')

    manifest.setdefault('sources', {})['kenney'] = 'https://kenney.nl/assets/furniture-kit'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    total = sum(x.stat().st_size for x in OUT.rglob('*') if x.is_file()) / 1024 / 1024
    print(f'models 目錄共 {total:.1f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
