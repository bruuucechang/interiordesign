"""Fetch the furniture styles the scan libraries do not have, from Quaternius.

    .venv/bin/python scripts/fetch_quaternius.py          # 只抓缺的
    .venv/bin/python scripts/fetch_quaternius.py --force  # 全部重來

**Why a third source.** Poly Haven is exhausted: 77 of its 85 furniture models are
already in the catalogue and the 8 left are outdoor. More to the point it has
**no second wardrobe** — the whole site carries 26 cabinet-ish models and 22 are
in use. Photogrammetry is done by whoever happens to scan something, so it gives
one of each thing rather than a range, and "a range" is exactly what a furniture
palette needs.

Quaternius is CC0 1.0, hand-modelled, and comes in families: Closet /
ShortCloset, BedDouble / BedTwin / BedSingle, several sofas and chairs. That is
the shape of the gap.

**Three things about it are worse than a scan, and none is hidden.**

1. *No textures.* The pack pages say so outright (Textured: ✗). Every material is
   a flat colour. Same situation as Kenney, and the same answer: the material
   names are semantic (`Wood` `DarkWood` `Metal` `Comforter` `Mattress`
   `PillowCover`), so `dressFlat()` in furniture3d.ts hangs the project's scans on
   them by name.
2. *No glTF.* FBX / OBJ / Blend only. OBJ is the one that converts without
   Blender: trimesh reads it, keeps the per-material split, writes a .glb.
3. **Model size is not real size.** This is the one that matters, and it is the
   opposite of the Poly Haven rule. A scan is measured, so its own bounding box
   is the truth. These are authored at game scale — the closet measures 2.98 in
   model units on its tall axis and the double bed 4.26 on its long one, roughly
   2x life. So the catalogue size here is **declared from real furniture
   dimensions**, and the app scales the model to fill it. Reading sizes off these
   models would be repeating the 180cm-cabinet-renders-54cm bug from the other
   direction.

Downloads come from Google Drive, which **rate-limits hard** — a run that fetches
a whole pack usually stops partway with "Cannot retrieve the public link". That is
not a bug and not something to work around aggressively; the script is resumable,
so run it again later and it picks up what is missing.
"""

import json
import sys
import time
from pathlib import Path

import gdown
import trimesh

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'public' / 'models'
CACHE = ROOT / '.cache' / 'quaternius'

PACKS = {
    'ultimatefurniture':   '1n85oUi0RN5ZUXEIMKA-AnBsPErVXWcma',
    'ultimatehomeinterior': '1SNK9PwPi8xqqxmpU5xEZeiQjB26C1oX6',
    'furniture':           '1CLWStkb7cipC1ZdTunYJXKVqEVwtXWXK',
}

# catalogue id → (Quaternius model name, 中文名, 分類, 風格, w, d, h)
#
# **Sizes are real furniture, not model bounds** — see the module docstring. They
# come from the ordinary ranges: a two-door wardrobe is 120x60x200, a double bed
# 150x200, a bookcase 80x30x180. The app scales x/z to fill w/h and takes the
# height from the `height` column.
WANT = {
    # --- 衣櫃：這是這個來源存在的理由。實掃圖庫一款都沒有 ---
    'wardrobe_tall':    ('Closet',        '高衣櫃',     '臥室', '現代', 150, 60, 220),
    'wardrobe_short':   ('ShortCloset',   '矮衣櫃',     '臥室', '現代', 120, 60, 150),
    # --- 床 ---
    'bed_dbl_wood':     ('BedDouble',     '木框雙人床', '臥室', '現代', 150, 200, 80),
    'bed_twin_wood':    ('BedTwin',       '木框單人床', '臥室', '現代', 105, 200, 80),
    'bed_king':         ('Bed_King',      '加大雙人床', '臥室', '現代', 180, 200, 75),
    'bed_single_q':     ('Bed_Single',    '單人床',     '臥室', '現代', 90, 190, 75),
    'bed_bunk':         ('Bed_Bunk',      '上下舖',     '臥室', '現代', 100, 200, 175),
    # --- 沙發：一次十二款是這個 pack 最值錢的地方 ---
    'sofa_q':           ('Sofa',          '布沙發',     '客廳', '現代', 200, 88, 80),
    'sofa_q2':          ('Sofa2',         '布沙發 II',  '客廳', '現代', 210, 90, 82),
    'sofa_q3':          ('Sofa3',         '布沙發 III', '客廳', '現代', 195, 88, 78),
    'sofa_single_q':    ('Sofa_individual', '單人沙發', '客廳', '現代', 95, 88, 80),
    'couch_l':          ('Couch_L',       'L 型沙發',   '客廳', '現代', 260, 190, 78),
    'couch_lg1':        ('Couch_Large1',  '大沙發 I',   '客廳', '現代', 220, 92, 80),
    'couch_lg2':        ('Couch_Large2',  '大沙發 II',  '客廳', '現代', 225, 92, 80),
    'couch_lg3':        ('Couch_Large3',  '大沙發 III', '客廳', '現代', 230, 95, 84),
    'couch_md1':        ('Couch_Medium1', '雙人沙發 I', '客廳', '現代', 165, 90, 80),
    'couch_md2':        ('Couch_Medium2', '雙人沙發 II', '客廳', '現代', 170, 90, 80),
    'couch_sm1':        ('Couch_Small1',  '單人沙發 I', '客廳', '現代', 95, 88, 80),
    'couch_sm2':        ('Couch_Small2',  '單人沙發 II', '客廳', '現代', 100, 90, 82),
    # --- 椅凳 ---
    'chair_wood_q':     ('Chair',         '木餐椅',     '餐廳', '現代', 45, 48, 90),
    'chair_office':     ('OfficeChair',   '辦公椅',     '書房', '現代', 60, 60, 105),
    'chair_q1':         ('Chair_1',       '餐椅 I',     '餐廳', '現代', 45, 48, 88),
    'chair_q2':         ('Chair_2',       '餐椅 II',    '餐廳', '現代', 46, 50, 90),
    'chair_q3':         ('Chair_3',       '餐椅 III',   '餐廳', '現代', 47, 50, 86),
    'chair_q4':         ('Chair_4',       '餐椅 IV',    '餐廳', '現代', 45, 49, 92),
    'stool_q':          ('Stool',         '圓凳',       '客廳', '現代', 38, 38, 45),
    # --- 桌 ---
    'desk_wood':        ('Desk',          '木書桌',     '書房', '現代', 120, 60, 75),
    'table_q':          ('Table',         '餐桌',       '餐廳', '現代', 160, 90, 75),
    'table_q2':         ('Table2',        '餐桌 II',    '餐廳', '現代', 140, 80, 75),
    'table_round_lg':   ('Table_RoundLarge', '大圓桌',  '餐廳', '現代', 120, 120, 75),
    'table_round_sm':   ('Table_RoundSmall', '小圓桌',  '餐廳', '現代', 70, 70, 72),
    # --- 收納 ---
    'bookcase_tall':    ('Bookcase',      '高書櫃',     '書房', '現代', 90, 32, 200),
    'bookcase_books':   ('Bookcase_Books', '滿書書櫃',  '書房', '現代', 90, 32, 200),
    'bookshelf_q':      ('Bookshelf',     '書架',       '書房', '現代', 80, 30, 180),
    'nightstand_wood':  ('NightStand',    '木床頭櫃',   '臥室', '現代', 45, 40, 55),
    'nightstand_q1':    ('NightStand_1',  '床頭櫃 I',   '臥室', '現代', 45, 40, 55),
    'nightstand_q2':    ('NightStand_2',  '床頭櫃 II',  '臥室', '現代', 48, 42, 58),
    'drawer_q1':        ('Drawer_1',      '抽屜櫃 I',   '臥室', '現代', 90, 45, 80),
    'drawer_q2':        ('Drawer_2',      '抽屜櫃 II',  '臥室', '現代', 100, 45, 85),
    'drawer_q3':        ('Drawer_3',      '抽屜櫃 III', '臥室', '現代', 80, 45, 75),
    'shelf_q1':         ('Shelf_1',       '層架 I',     '客廳', '現代', 90, 30, 180),
    'shelf_q2':         ('Shelf_2',       '層架 II',    '客廳', '現代', 100, 32, 190),
    'shelf_wall_q':     ('Shelf_Small1',  '壁掛層板',   '客廳', '現代', 60, 22, 20),
    # --- 燈具：十九款，實掃圖庫的燈少得可憐 ---
    'light_pend1':      ('Light_Ceiling1', '吊燈 I',    '燈具', '現代', 40, 40, 45),
    'light_pend2':      ('Light_Ceiling2', '吊燈 II',   '燈具', '現代', 45, 45, 50),
    'light_pend3':      ('Light_Ceiling3', '吊燈 III',  '燈具', '現代', 35, 35, 40),
    'light_chand_q':    ('Light_Chandelier', '水晶吊燈', '燈具', '古典', 60, 60, 70),
    'light_floor_q1':   ('Light_Floor1',  '立燈 I',     '燈具', '現代', 40, 40, 160),
    'light_floor_q2':   ('Light_Floor2',  '立燈 II',    '燈具', '現代', 42, 42, 155),
    'light_desk_q':     ('Light_Desk',    '桌燈',       '燈具', '現代', 25, 25, 45),
    # --- 裝飾 ---
    'plant_q1':         ('Houseplant_1',  '盆栽 I',     '裝飾', '現代', 40, 40, 90),
    'plant_q2':         ('Houseplant_3',  '盆栽 II',    '裝飾', '現代', 45, 45, 120),
    'plant_q3':         ('Houseplant_5',  '盆栽 III',   '裝飾', '現代', 35, 35, 70),
    'carpet_q1':        ('Carpet_1',      '地毯 I',     '客廳', '現代', 200, 140, 2),
    'carpet_round_q':   ('Carpet_Round',  '圓地毯',     '客廳', '現代', 160, 160, 2),
    'curtain_dbl':      ('Curtains_Double', '雙開窗簾', '裝飾', '現代', 180, 12, 220),
    'fireplace_q':      ('Fireplace',     '壁爐',       '客廳', '古典', 120, 40, 110),
}


def obj_files(pack: str, folder_id: str, force: bool) -> dict[str, Path]:
    """Everything under the pack's OBJ/ folder, downloaded once and cached.

    Listing and downloading are separate calls so the FBX and .blend copies —
    which are most of the bytes and none of the use — never get fetched.
    """
    d = CACHE / pack
    have = {f.stem: f for f in d.glob('OBJ/*.obj')} if d.exists() else {}
    want = {n for n, *_ in WANT.values()}
    if not force and want <= set(have):
        return have
    d.mkdir(parents=True, exist_ok=True)
    try:
        listing = gdown.download_folder(id=folder_id, output=str(d), quiet=True,
                                        use_cookies=False, skip_download=True) or []
    except Exception as e:
        print(f'  ⚠ {pack} 連目錄都列不到（{type(e).__name__}: {e}）')
        return have
    # 只抓 OBJ/ 底下、而且是這份清單真的要的那幾個檔。整個 pack 抓下來的話，
    # FBX 與 .blend 佔掉絕大部分的位元組跟絕大部分的 Drive 請求，而一個都用不到。
    fails: list[str] = []
    for f in listing:
        p = Path(f.path if hasattr(f, 'path') else f)
        if p.suffix.lower() not in ('.obj', '.mtl') or 'OBJ' not in p.parts:
            continue
        if p.stem not in want or (p.exists() and not force):
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        # 一個檔被擋不是「這個 pack 沒救了」。第一版在這裡 break，於是每一次
        # 執行都停在同一個 .mtl 上，後面那四十幾個 .obj 一個都沒試過——看起來
        # 像 Drive 把整包鎖死，其實是我自己不再問。
        for attempt in range(3):
            try:
                gdown.download(id=f.id, output=str(p), quiet=True, use_cookies=False, resume=True)
                time.sleep(0.4)                  # Drive 對連發特別敏感
                break
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        else:
            fails.append(p.name)
    if fails:
        print(f'  ⚠ {pack}：{len(fails)} 個檔被 Drive 擋（{", ".join(fails[:4])}'
              f'{" …" if len(fails) > 4 else ""}）——稍後再跑一次就會補上')
    return {f.stem: f for f in d.glob('OBJ/*.obj')}


def convert(src: Path, dst: Path) -> int:
    """OBJ → GLB, keeping one geometry per material so names survive.

    The names are the whole point: `dressFlat()` matches on them to decide which
    scan a surface gets. A merged mesh would be one nameless blob.
    """
    scene = trimesh.load(src, force='scene')
    blob = scene.export(file_type='glb')
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(blob)
    return len(blob)


# 面板圖例：按分類挑一個俯視圖形。實際顯示的是模型自己的預覽圖，這只是後備。
PICTO = {
    '沙發': "body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();\n"
            "      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();",
    '椅':   "body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();",
    '床':   "body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();\n"
            "      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();",
    '櫃':   "cabinet(ctx, w, h, 2);",
    '架':   "openShelf(ctx, w, h, 3);",
    '桌':   "body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();",
    '圓':   "body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();",
    '燈':   "ctx.fillStyle = '#3a4150'; ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 2;\n"
            "      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();",
    '毯':   "ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;\n"
            "      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();",
    '栽':   "ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;\n"
            "      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();",
}


def sync_catalogue(added: list[str]) -> int:
    """Write the catalogue rows for whatever just converted.

    **This is the whole reason it lives in the fetch script.** Twice already a
    batch of models landed on disk, went into the manifest, and stayed invisible
    for a full round trip because `furniture.ts` had no row for them — the app
    only ever draws what the catalogue lists, and a missing row is not an error,
    just an absence. Emitting the row in the same run that writes the .glb means
    the two cannot drift apart.
    """
    ts = ROOT / 'client' / 'src' / 'data' / 'furniture.ts'
    src = ts.read_text(encoding='utf-8')
    rows = []
    for cid in added:
        if f"id: '{cid}'" in src:
            continue
        _name, zh, cat, style, w, d, h = WANT[cid]
        pic = next((v for k, v in PICTO.items() if k in zh), PICTO['桌'])
        rows.append(f"  {{ id: '{cid}', name: '{zh}', style: '{style}', cat: '{cat}', "
                    f"w: {w}, h: {d}, height: {h}, draw(ctx, w, h) {{\n      {pic}\n    }} }},")
    if not rows:
        return 0
    head = '\n  // ---- Quaternius（CC0）：實掃圖庫沒有第二款的那些。尺寸是真實尺寸，不是模型尺寸 ----'
    if head.strip() in src:
        head = ''
    i = src.rindex('\n];')
    ts.write_text(src[:i] + ('\n' + head if head else '') + '\n' + '\n'.join(rows) + src[i:], encoding='utf-8')
    return len(rows)


def main() -> int:
    force = '--force' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / 'manifest.json'
    manifest = json.loads(mpath.read_text(encoding='utf-8')) if mpath.exists() \
        else {'source': 'https://polyhaven.com', 'license': 'CC0 1.0', 'models': {}}

    pool: dict[str, Path] = {}
    for pack, fid in PACKS.items():
        if all(n in pool for n, *_ in WANT.values()):
            break                                 # 已經湊齊就不要再敲 Drive
        print(f'{pack} …', flush=True)
        pool |= obj_files(pack, fid, force)

    done = missing = 0
    added: list[str] = []
    for cid, (name, zh, cat, style, w, d, h) in WANT.items():
        out = OUT / cid / f'{name}.glb'
        if not force and out.exists() and cid in manifest['models']:
            done += 1
            continue
        src = pool.get(name)
        if src is None:
            print(f'  {cid:<18} {name:<18} ✗ 還沒下載到')
            missing += 1
            continue
        kb = convert(src, out) / 1024
        manifest['models'][cid] = {
            'asset': name, 'name': name, 'file': f'{name}.glb',
            'w': w, 'd': d, 'h': h, 'source': 'quaternius',
            'attribution': 'Quaternius (CC0)',
        }
        print(f'  {cid:<18} {name:<18} {kb:6.0f} KB   {w} × {d} × {h} cm（真實尺寸，非模型尺寸）')
        added.append(cid)
        done += 1
        time.sleep(0.05)

    # 已經在磁碟上、但目錄還沒有列的也一起補——之前中斷的那幾輪就是卡在這裡
    added += [c for c in WANT if c in manifest['models'] and c not in added]
    n_rows = sync_catalogue(added)
    if n_rows:
        print(f'furniture.ts 補了 {n_rows} 筆目錄')
    manifest.setdefault('sources', {})['quaternius'] = 'https://quaternius.com'
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    n = len(manifest['models'])
    by = {}
    for v in manifest['models'].values():
        by[v.get('source', '?')] = by.get(v.get('source', '?'), 0) + 1
    print(f'manifest 共 {n} 筆（' + '、'.join(f'{k} {v}' for k, v in sorted(by.items())) + '）')
    if missing:
        print(f'{missing} 件還沒下載到——Google Drive 會限流，等一下再跑一次這支就好')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
