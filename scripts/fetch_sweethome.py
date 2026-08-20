"""Fetch the fourth model source: Sweet Home 3D's Blend Swap CC-0 library.

    .venv/bin/python scripts/fetch_sweethome.py          # 只抓缺的
    .venv/bin/python scripts/fetch_sweethome.py --force  # 全部重來

**Why a fourth source, when three were already in.** The other three each ran out
in a different way. Poly Haven is photogrammetry, so it has whatever somebody
happened to scan — beautiful, and no appliances at all. Kenney is flat-shaded
low-poly: correct silhouettes, but pull the camera in and a fridge is a toy.
Quaternius covers the same categories with real geometry but no textures. What
none of them has is **ordinary building-supply furniture measured at real size**:
a range hood, a sink cabinet, a toilet unit, a sliding-door wardrobe.

That is exactly what this library is. It is the furniture catalogue of an actual
interior-design program, so every model is a thing you can buy, at the size the
real one is, and most carry photographic texture maps.

**Licence: CC0 1.0 — and unusually, it says so in writing.** The download ships
a LICENSE.TXT: "This file is under the Creative Commons Zero (Public Domain)
license … you can use it for any purpose you see fit, even commercially, with no
requirements." That mattered here: cgbookcase was the other candidate and its
licence text is rendered by JavaScript, so there is no way to read it from the
file — an unreadable licence is not a permissive one.

Three things this source gives that the others could not:

1. **Real dimensions, from the catalogue rather than from me.** Each entry
   carries width/depth/height in centimetres, because the host program has to
   place them in a plan. No estimating, and no reading a bounding box that was
   authored at game scale (the Quaternius trap, documented in that script).
2. **Traditional Chinese names, already translated.** The library ships
   `PluginFurnitureCatalog_zh_TW.properties`.
3. **A rendered icon per model**, so the palette preview needs no render pass.

Note the sibling libraries on the same page are CC-BY (Scopia 500 models,
KatorLegaz 90, BlendSwap-CC-BY 135). Usable, but attribution then becomes a
distribution obligation, and every other asset here is deliberately free of one.
"""

import io
import json
import re
import sys
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import trimesh

ZIP = ('https://sourceforge.net/projects/sweethome3d/files/SweetHome3D-models/'
       '3DModels-1.9.3/3DModels-BlendSwap-CC-0-1.9.3.zip/download')
SH3F = 'BlendSwap-CC-0.sh3f'

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'public' / 'models'
CACHE = ROOT / '.cache' / 'sweethome'

# catalogue id → (this library's entry number, 分類, 風格)
#
# 名稱與尺寸**不寫在這裡**：兩者都從素材庫自己的 properties 讀。這是這個來源最好
# 的一點——它是一套真的室內設計軟體的家具目錄，尺寸是拿來排平面圖用的。
#
# 沿用既有 catalogue id 的那幾筆是**就地換掉** Kenney 的低多邊形版本，不是新增；
# 換 id 會讓既有存檔裡的物件失效，新增一份則會讓面板出現兩個一樣的東西。
WANT = {
    # ---- 換掉還留著的 Kenney ----
    'range_hood':      (161, '廚房', '現代'),
    'coffee_machine':  (111, '廚房', '現代'),
    'kitchen_island':  (148, '廚房', '現代'),
    'shower_round':    (131, '浴室', '現代'),
    'tv_wall':         (22,  '客廳', '現代'),
    'stairs':          (133, '客廳', '現代'),
    'desk_corner':     (152, '書房', '現代'),
    # ---- 廚房：整組系統廚具，這是前三個來源都沒有的 ----
    'sh_oven':         (28,  '廚房', '現代'),
    'sh_oven_double':  (16,  '廚房', '現代'),
    'sh_cooktop':      (24,  '廚房', '現代'),
    'sh_fridge_big':   (151, '廚房', '現代'),
    'sh_fridge':       (128, '廚房', '現代'),
    'sh_cab_sink':     (165, '廚房', '現代'),
    'sh_cab_lower':    (153, '廚房', '現代'),
    'sh_cab_corner':   (154, '廚房', '現代'),
    'sh_cab_upper':    (172, '廚房', '現代'),
    'sh_cab_upper_c':  (173, '廚房', '現代'),
    'sh_cab_high':     (146, '廚房', '現代'),
    'sh_cab_drawers':  (144, '廚房', '現代'),
    'sh_cab_glass':    (145, '廚房', '現代'),
    'sh_stool_bar':    (45,  '廚房', '現代'),
    # ---- 浴室 ----
    'sh_toilet':       (57,  '浴室', '現代'),
    'sh_washbasin':    (62,  '浴室', '現代'),
    'sh_vanity':       (122, '浴室', '現代'),
    'sh_bidet':        (104, '浴室', '現代'),
    'sh_shower_door':  (41,  '浴室', '現代'),
    'sh_towel_rack':   (59,  '浴室', '現代'),
    # ---- 臥室 ----
    'sh_wardrobe_slide': (68, '臥室', '現代'),
    'sh_cupboard':     (74,  '臥室', '現代'),
    'sh_bed1':         (2,   '臥室', '現代'),
    'sh_bed2':         (3,   '臥室', '古典'),
    'sh_bed_baby':     (87,  '臥室', '現代'),
    'sh_bedside':      (4,   '臥室', '現代'),
    # ---- 客廳 ----
    'sh_sofa_corner':  (67,  '客廳', '現代'),
    'sh_couch':        (112, '客廳', '現代'),
    'sh_sofa_winch':   (140, '客廳', '古典'),
    'sh_armchair_winch': (139, '客廳', '古典'),
    'sh_armchair':     (86,  '客廳', '現代'),
    'sh_tv_cabinet':   (52,  '客廳', '現代'),
    'sh_bookcase':     (6,   '客廳', '現代'),
    'sh_shelves_v':    (61,  '客廳', '現代'),
    'sh_oak_table':    (27,  '餐廳', '鄉村'),
    'sh_oak_chair':    (26,  '餐廳', '鄉村'),
    'sh_osaka_chair':  (125, '餐廳', '日式'),
    'sh_piano':        (30,  '客廳', '古典'),
    'sh_piano_bench':  (159, '客廳', '古典'),
    # ---- 日式：這個來源意外地補了兩件 ----
    'sh_tatami':       (170, '客廳', '日式'),
    'sh_lantern':      (149, '燈具', '日式'),
    # ---- 燈具與雜項 ----
    'sh_lamp':         (121, '燈具', '現代'),
    'sh_desk_lamp':    (15,  '燈具', '現代'),
    'sh_wall_light':   (137, '燈具', '現代'),
    'sh_ceiling_fan':  (92,  '燈具', '現代'),
    'sh_radiator':     (127, '客廳', '工業'),
    'sh_radiator_long': (34, '客廳', '工業'),
    'sh_pool_table':   (33,  '客廳', '現代'),
}


def library() -> zipfile.ZipFile:
    """The .sh3f, downloaded once. It is 24MB, so it is cached, not re-fetched."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / 'BlendSwap-CC-0.zip'
    if not f.exists():
        print('下載 Sweet Home 3D 的 Blend Swap CC-0 素材庫（24MB）…', flush=True)
        req = urllib.request.Request(ZIP, headers={'User-Agent': 'interior-designer/1.0'})
        with urllib.request.urlopen(req, timeout=600) as r:
            f.write_bytes(r.read())
    z = zipfile.ZipFile(f)
    lic = z.read('LICENSE.TXT').decode('utf8', 'ignore')
    assert 'Creative Commons Zero' in lic, '授權檔內容不是 CC0，停手'
    return zipfile.ZipFile(io.BytesIO(z.read(SH3F)))


def catalogue(f: zipfile.ZipFile, name: str) -> dict[int, dict[str, str]]:
    d: dict[int, dict[str, str]] = defaultdict(dict)
    for line in f.read(name).decode('utf8', 'ignore').splitlines():
        m = re.match(r'([a-zA-Z]+)#(\d+)=(.*)', line)
        if m:
            # properties 檔裡的中文是 \uXXXX 轉義的
            d[int(m.group(2))][m.group(1)] = m.group(3).encode().decode('unicode_escape')
    return d


def convert(f: zipfile.ZipFile, model_path: str, dst: Path) -> int:
    """OBJ（＋MTL＋貼圖）→ GLB。

    整個模型資料夾要一起解出來再讀：OBJ 靠相對路徑找 .mtl，.mtl 又靠相對路徑找
    貼圖。只解 .obj 的話 trimesh 讀得起來、材質全掉光，而且不會報錯。
    """
    folder = model_path.lstrip('/').rsplit('/', 1)[0]
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        for n in f.namelist():
            if n.startswith(folder + '/') and not n.endswith('/'):
                p = base / n
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(f.read(n))
        scene = trimesh.load(base / model_path.lstrip('/'), force='scene')
        blob = scene.export(file_type='glb')
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(blob)
    return len(blob)


def main() -> int:
    force = '--force' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / 'manifest.json'
    manifest = json.loads(mpath.read_text(encoding='utf-8')) if mpath.exists() \
        else {'source': 'https://polyhaven.com', 'license': 'CC0 1.0', 'models': {}}

    f = library()
    en = catalogue(f, 'PluginFurnitureCatalog.properties')
    tw = catalogue(f, 'PluginFurnitureCatalog_zh_TW.properties')
    print(f'{len(WANT)} 件 → {OUT.relative_to(ROOT)}')

    added: list[tuple[str, str, str, str, float, float, float]] = []
    for cid, (num, cat, style) in WANT.items():
        e = en.get(num)
        if not e:
            print(f'  {cid:<18} #{num} 素材庫裡沒有這一號')
            continue
        asset = e['model'].rsplit('/', 1)[-1].removesuffix('.obj')
        out = OUT / cid / f'{asset}.glb'
        zh = tw.get(num, {}).get('name') or e.get('name', asset)
        w, d, h = float(e['width']), float(e['depth']), float(e['height'])
        if not force and out.exists() and cid in manifest['models']:
            added.append((cid, zh, cat, style, w, d, h))
            continue
        kb = convert(f, e['model'], out) / 1024
        # 素材庫本來就附一張渲好的圖示，省掉 bench/thumbs.mjs 的一輪
        try:
            (OUT / cid / 'thumb.png').write_bytes(f.read(e['icon'].lstrip('/')))
        except KeyError:
            pass
        manifest['models'][cid] = {
            'asset': asset, 'name': e.get('name', asset), 'file': f'{asset}.glb',
            'w': w, 'd': d, 'h': h, 'source': 'sweethome',
            'attribution': 'Sweet Home 3D — Blend Swap CC-0 library (CC0)',
        }
        print(f'  {cid:<18} {asset:<26} {kb:6.0f} KB   {w:.0f} × {d:.0f} × {h:.0f} cm   {zh}')
        added.append((cid, zh, cat, style, w, d, h))

    n = sync_catalogue(added)
    if n:
        print(f'furniture.ts 補了 {n} 筆目錄')
    manifest.setdefault('sources', {})['sweethome'] = 'https://www.sweethome3d.com/importModels.jsp'
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    by: dict[str, int] = {}
    for v in manifest['models'].values():
        by[v.get('source', '?')] = by.get(v.get('source', '?'), 0) + 1
    print(f'manifest 共 {len(manifest["models"])} 筆（'
          + '、'.join(f'{k} {c}' for k, c in sorted(by.items())) + '）')
    return 0


PICTO = {
    '櫃': "cabinet(ctx, w, h, 2);",
    '架': "openShelf(ctx, w, h, 4);",
    '床': "body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();\n"
          "      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();",
    '沙發': "body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();\n"
            "      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();",
    '椅': "body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();",
    '燈': "ctx.fillStyle = '#3a4150'; ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 2;\n"
          "      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();",
    '桌': "body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();",
}


# 素材庫的 zh_TW 翻得很鬆——Wardrobe 是「五斗櫃」、Japanese lantern 是「燈」、
# Upper cabinet 是「烘碗機」。名稱是面板上唯一的文字，錯的名字比沒有名字更難用，
# 所以這幾筆照模型實際是什麼覆蓋掉。沒列在這裡的沿用素材庫的翻譯。
NAME_FIX = {'sh_wardrobe_slide': '滑門衣櫃', 'sh_lantern': '日式石燈', 'sh_cab_upper': '吊櫃', 'sh_cab_high': '高身廚櫃', 'sh_cab_lower': '下櫃', 'sh_cab_corner': '轉角下櫃', 'sh_cab_upper_c': '轉角吊櫃', 'sh_cab_sink': '水槽櫃', 'sh_bookcase': '玻璃書櫃', 'sh_bed1': '雙人床（布質）', 'sh_bed2': '雙人床（木框）', 'sh_oven': '烤箱', 'sh_cooktop': '爐台', 'sh_fridge': '冰箱', 'sh_fridge_big': '大冰箱', 'sh_vanity': '浴櫃', 'sh_radiator': '暖氣片', 'sh_radiator_long': '長暖氣片', 'sh_shelves_v': '直立層架', 'sh_cupboard': '碗櫥', 'sh_piano_bench': '琴凳', 'sh_stool_bar': '吧檯高凳', 'sh_armchair': '扶手椅', 'sh_lamp': '立燈', 'tv_wall': '液晶電視', 'sh_couch': '大沙發'}


def sync_catalogue(rows) -> int:
    """目錄列跟模型同一輪寫出來——理由見 fetch_quaternius.py 的同名函式。"""
    ts = ROOT / 'client' / 'src' / 'data' / 'furniture.ts'
    src = ts.read_text(encoding='utf-8')
    out = []
    for cid, zh, cat, style, w, d, h in rows:
        if f"id: '{cid}'" in src:
            continue
        zh = NAME_FIX.get(cid, zh)
        pic = next((v for k, v in PICTO.items() if k in zh), PICTO['桌'])
        out.append(f"  {{ id: '{cid}', name: '{zh}', style: '{style}', cat: '{cat}', "
                   f"w: {round(w)}, h: {round(d)}, height: {round(h)}, draw(ctx, w, h) {{\n"
                   f"      {pic}\n    }} }},")
    if not out:
        return 0
    head = '\n  // ---- Sweet Home 3D 的 Blend Swap CC-0 素材庫：真實建材尺寸的一般家具 ----'
    if head.strip() in src:
        head = ''
    i = src.rindex('\n];')
    ts.write_text(src[:i] + ('\n' + head if head else '') + '\n' + '\n'.join(out) + src[i:],
                  encoding='utf-8')
    return len(out)


if __name__ == '__main__':
    raise SystemExit(main())
