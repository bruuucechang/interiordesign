import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj, Vec } from '../model/schema';
import { layerForKind, DOOR_STYLES, WINDOW_STYLES, ELECTRICAL_BY_ID } from '../model/catalogue';
import { dist, snap, angleDeg, distToSegment, closestOnSegment, polygonArea } from '../core/geometry';
import { getModelHeight } from '../core/furniture3d';
import { dimensionChain, detectWalls } from '../net/api';
import { flash } from './feedback';
import { MaterialDef, floorMaterials, wallMaterials } from '../core/materials';
import { Unit, unitLabel, stepFor, fieldValue, formatLength, formatArea, parseLength } from '../core/units';

// The properties panel: everything shown for the current selection, plus the
// two actions reachable only from it (dimension a wall, trace walls from the
// underlay). `unit` lives here because the cm/m toggle in the panel header is
// the only thing that changes it.

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

let unit: Unit = 'cm';   // shared across selections; toggled from the panel header

export function refreshProps(editor: Editor, doc: Doc) {
  const host = $('#properties'); host.innerHTML = '';
  const ids = doc.selectedIds;
  if (!ids.length) { host.innerHTML = '<div class="muted">未選取物件</div>'; return; }
  if (ids.length > 1) {   // multi-selection: align / distribute / duplicate / delete
    const head = document.createElement('div'); head.className = 'prop-head';
    head.innerHTML = `<span class="prop-type">已選取 ${ids.length} 個物件</span>`;
    host.appendChild(head);

    const grid = document.createElement('div'); grid.className = 'align-grid';
    const btn = (label: string, title: string, fn: () => void) => { const b = document.createElement('button'); b.className = 'align-btn'; b.textContent = label; b.title = title; b.onclick = fn; grid.appendChild(b); };
    btn('⇤', '靠左對齊', () => editor.align('left'));
    btn('⇔', '水平置中', () => editor.align('hcenter'));
    btn('⇥', '靠右對齊', () => editor.align('right'));
    btn('⤒', '靠上對齊', () => editor.align('top'));
    btn('⇕', '垂直置中', () => editor.align('vcenter'));
    btn('⤓', '靠下對齊', () => editor.align('bottom'));
    if (ids.length >= 3) {
      btn('⇿', '水平均分', () => editor.distribute('h'));
      btn('⇳', '垂直均分', () => editor.distribute('v'));
    }
    host.appendChild(grid);

    // Walls get their own alignment, because aligning walls by bounding box is
    // not what anyone means: a run of wall is a face, and two walls of
    // different thickness whose boxes line up still have a step between them.
    const walls = doc.selectedObjects.filter(o => o.kind === 'wall');
    if (walls.length >= 2) {
      const wl = document.createElement('div'); wl.className = 'panel-title'; wl.style.borderTop = 'none';
      wl.textContent = `牆面對齊（${walls.length} 道）`;
      const wg = document.createElement('div'); wg.className = 'align-grid';
      const wb = (label: string, ref: 'left' | 'center' | 'right', title: string) => {
        const b = document.createElement('button'); b.className = 'align-btn'; b.textContent = label; b.title = title;
        b.onclick = () => {
          const r = editor.alignWallFaces(ref);
          // Say what it refused to touch. A count that does not match what was
          // selected is the only warning that a slanted or curved wall was left
          // where it was.
          flash(r.skipped
            ? `對齊 ${r.moved} 道，跳過 ${r.skipped} 道（不平行或是曲線牆）`
            : r.moved ? `對齊 ${r.moved} 道` : '這些牆已經對齊了');
        };
        wg.appendChild(b);
      };
      wb('◧', 'left', '左緣對齊（相對各自的畫線方向）');
      wb('⊹', 'center', '中心線對齊');
      wb('◨', 'right', '右緣對齊');
      host.append(wl, wg);
    }

    const grp = document.createElement('button'); grp.className = 'prop-action';
    if (doc.canUngroup) { grp.textContent = '解散群組 (⇧⌘G)'; grp.onclick = () => doc.ungroupSelection(); }
    else { grp.textContent = '組成群組 (⌘G)'; grp.onclick = () => doc.groupSelection(); }
    host.appendChild(grp);

    const dup = document.createElement('button'); dup.className = 'prop-action'; dup.textContent = '複製 (⌘D)';
    dup.onclick = () => editor.duplicateSelection();
    host.appendChild(dup);
    const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '刪除全部';
    del.onclick = () => { doc.commit(); for (const o of doc.selectedObjects) doc.remove(o.id); };
    host.appendChild(del);
    return;
  }
  const o = doc.selected!;
  const up = (patch: Partial<Obj>) => doc.update(o.id, patch);

  // field builders (append to a given parent)
  const dim = (parent: HTMLElement, label: string, cm: number, setCm: (v: number) => void, min = 0) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = `${label} (${unitLabel(unit)})`;
    const inp = document.createElement('input'); inp.type = 'number';
    inp.value = fieldValue(cm, unit); inp.step = stepFor(unit);
    inp.addEventListener('focus', () => doc.commit());
    inp.addEventListener('input', () => { const v = parseLength(inp.value, unit, min); if (v !== null) setCm(v); });
    row.append(l, inp); parent.appendChild(row);
    return inp;      // 呼叫端要能回頭改它——見門窗的左右牆長
  };
  const deg = (parent: HTMLElement, label: string, value: number, set: (v: number) => void) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = `${label} (°)`;
    const inp = document.createElement('input'); inp.type = 'number'; inp.value = String(Math.round(value)); inp.step = '1';
    inp.addEventListener('focus', () => doc.commit());
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!isNaN(v)) set(v); });
    row.append(l, inp); parent.appendChild(row);
  };
  const text = (parent: HTMLElement, label: string, value: string, set: (v: string) => void) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = value;
    inp.addEventListener('focus', () => doc.commit());
    inp.addEventListener('input', () => set(inp.value));
    row.append(l, inp); parent.appendChild(row);
  };
  const info = (parent: HTMLElement, label: string, value: string) => {
    const row = document.createElement('div'); row.className = 'prop';
    row.innerHTML = `<label>${label}</label><span>${value}</span>`; parent.appendChild(row);
  };
  const section = (title: string) => {
    const el = document.createElement('details'); el.className = 'prop-sec'; el.open = true;
    const s = document.createElement('summary'); s.textContent = title; el.appendChild(s);
    const body = document.createElement('div'); body.className = 'prop-body'; el.appendChild(body);
    return { el, body };
  };
  const colorRow = (parent: HTMLElement, label: string, value: string, set: (v: string) => void) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = value; inp.className = 'color-input';
    let committed = false;
    inp.addEventListener('input', () => { if (!committed) { doc.commit(); committed = true; } set(inp.value); });
    inp.addEventListener('change', () => { committed = false; });
    row.append(l, inp); parent.appendChild(row);
  };
  const rangeRow = (parent: HTMLElement, label: string, value: number, set: (v: number) => void) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = '0'; inp.max = '100'; inp.value = String(value); inp.className = 'range-input';
    let committed = false;
    inp.addEventListener('input', () => { if (!committed) { doc.commit(); committed = true; } set(parseFloat(inp.value)); });
    inp.addEventListener('change', () => { committed = false; });
    row.append(l, inp); parent.appendChild(row);
  };
  // Common interior finishes, the way a consumer product offers them: a strip of
  // swatches for the usual answers, with the colour picker for anything else.
  const FINISHES: { hex: string; label: string }[] = [
    { hex: '#3a4150', label: '原色' },   // the catalogue's own dark body
    { hex: '#8a6a4a', label: '胡桃木' },
    { hex: '#c9a884', label: '橡木' },
    { hex: '#e8e4dd', label: '象牙白' },
    { hex: '#4a5a6a', label: '灰藍' },
    { hex: '#6b7f6e', label: '橄欖綠' },
    { hex: '#8d5a5a', label: '磚紅' },
    { hex: '#2c2f36', label: '碳黑' },
  ];
  const swatchRow = (parent: HTMLElement, current: string | undefined, set: (v: string | undefined) => void) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = '材質';
    const wrap = document.createElement('div'); wrap.className = 'swatches';
    for (const f of FINISHES) {
      const b = document.createElement('button');
      b.className = 'swatch' + (current?.toLowerCase() === f.hex ? ' active' : '');
      b.style.background = f.hex; b.title = f.label;
      b.onclick = () => { doc.commit(); set(f.hex); };
      wrap.appendChild(b);
    }
    const reset = document.createElement('button');
    reset.className = 'swatch reset' + (current ? '' : ' active');
    reset.textContent = '↺'; reset.title = '恢復目錄預設';
    reset.onclick = () => { doc.commit(); set(undefined); };
    wrap.appendChild(reset);
    row.append(l, wrap); parent.appendChild(row);
  };
  /**
   * The material picker: one swatch per material in the category.
   *
   * The swatch is the material's own representative colour rather than a
   * rendered thumbnail — a thumbnail would mean building the 512² texture for
   * every material just to open the panel, and the panel opens on every
   * selection change.
   */
  const matRow = (parent: HTMLElement, label: string, defs: MaterialDef[], current: string, set: (v: string) => void) => {
    const row = document.createElement('div'); row.className = 'prop prop-mat';
    const l = document.createElement('label'); l.textContent = label;
    const wrap = document.createElement('div'); wrap.className = 'mat-grid';
    for (const d of defs) {
      const b = document.createElement('button');
      b.className = 'mat-swatch' + (current === d.id ? ' active' : '');
      b.title = d.label;
      b.style.background = d.swatch;
      const cap = document.createElement('span'); cap.textContent = d.label;
      b.appendChild(cap);
      b.onclick = () => { doc.commit(); set(d.id); };
      wrap.appendChild(b);
    }
    row.append(l, wrap); parent.appendChild(row);
  };

  // header: type + unit toggle
  const head = document.createElement('div'); head.className = 'prop-head';
  const type = document.createElement('span'); type.className = 'prop-type'; type.textContent = kindLabel(o.kind);
  const uBtn = document.createElement('button'); uBtn.className = 'unit-toggle'; uBtn.textContent = unit === 'cm' ? '公分' : '公尺';
  uBtn.title = '切換單位（公分 / 公尺）';
  uBtn.onclick = () => { unit = unit === 'cm' ? 'm' : 'cm'; refreshProps(editor, doc); };
  head.append(type, uBtn); host.appendChild(head);

  // basic params
  const basics = document.createElement('div'); basics.className = 'prop-body'; host.appendChild(basics);
  const size = section('尺寸');
  const pos = section('位置');

  switch (o.kind) {
    case 'furniture':
      info(basics, '名稱', o.label);
      dim(size.body, '寬', o.w, v => up({ w: Math.max(5, v) } as any), 5);
      dim(size.body, '深', o.h, v => up({ h: Math.max(5, v) } as any), 5);
      dim(size.body, '高', o.height ?? getModelHeight(o.item, o.w, o.h), v => up({ height: Math.max(5, v) } as any), 5);
      dim(pos.body, 'X', o.x, v => up({ x: v } as any));
      dim(pos.body, 'Y', o.y, v => up({ y: v } as any));
      deg(pos.body, '旋轉', o.angle, v => up({ angle: v } as any));
      dim(pos.body, '離地板距離', o.elevation ?? 0, v => up({ elevation: Math.max(0, v) } as any));
      break;
    case 'room': {
      text(basics, '名稱', o.name, v => up({ name: v, auto: false } as any));   // renaming adopts an auto room
      const poly = o.poly && o.poly.length >= 3 ? o.poly : null;
      info(basics, '面積', formatArea(poly ? polygonArea(poly) : o.w * o.h, unit));
      if (!poly) {
        dim(size.body, '寬', o.w, v => up({ w: Math.max(10, v) } as any), 10);
        dim(size.body, '深', o.h, v => up({ h: Math.max(10, v) } as any), 10);
        dim(pos.body, 'X', o.x, v => up({ x: v } as any));
        dim(pos.body, 'Y', o.y, v => up({ y: v } as any));
      }
      break;
    }
    case 'partition': {
      // Length and ends, and a note about what it is not. A dashed line that
      // divides the area take-off but builds nothing is a distinction worth
      // stating where the person is looking at it.
      const note = document.createElement('div'); note.className = 'muted'; note.style.fontSize = '12px';
      note.textContent = '只在平面上分割區域：計入面積報表，3D 不出現，不計價';
      basics.appendChild(note);
      dim(size.body, '長度', dist(o.a, o.b), v => {
        const L = Math.max(1, v), cur = dist(o.a, o.b);
        const ux = cur > 1e-6 ? (o.b.x - o.a.x) / cur : 1;
        const uy = cur > 1e-6 ? (o.b.y - o.a.y) / cur : 0;
        up({ b: { x: o.a.x + ux * L, y: o.a.y + uy * L } } as any);
      }, 1);
      dim(pos.body, 'A · X', o.a.x, v => up({ a: { x: v, y: o.a.y } } as any));
      dim(pos.body, 'A · Y', o.a.y, v => up({ a: { x: o.a.x, y: v } } as any));
      dim(pos.body, 'B · X', o.b.x, v => up({ b: { x: v, y: o.b.y } } as any));
      dim(pos.body, 'B · Y', o.b.y, v => up({ b: { x: o.b.x, y: v } } as any));
      break;
    }
    case 'wall':
      dim(size.body, '長度', dist(o.a, o.b), v => {   // resize by moving the far end along the wall
        const L = Math.max(1, v), cur = dist(o.a, o.b);
        const ux = cur > 1e-6 ? (o.b.x - o.a.x) / cur : 1;
        const uy = cur > 1e-6 ? (o.b.y - o.a.y) / cur : 0;
        up({ b: { x: o.a.x + ux * L, y: o.a.y + uy * L } } as any);
      }, 1);
      dim(size.body, '厚度', o.thickness, v => up({ thickness: Math.max(2, v) } as any), 2);
      dim(size.body, '高度', o.height ?? 270, v => up({ height: Math.max(10, v) } as any), 10);
      {
        // Split at a measured distance, which is how a wall gets a different
        // thickness or finish along part of its run. The field is committed on
        // the button, not on every keystroke: splitting live would cut the wall
        // at 1, then 12, then 120 as the number is typed.
        const row = document.createElement('div'); row.className = 'prop';
        const l = document.createElement('label'); l.textContent = `分割於 (${unitLabel(unit)})`;
        const inp = document.createElement('input'); inp.type = 'number';
        inp.value = fieldValue(dist(o.a, o.b) / 2, unit); inp.step = stepFor(unit);
        const go = document.createElement('button'); go.className = 'align-btn'; go.textContent = '✂';
        go.title = '從 a 端量這個距離把牆切成兩道';
        go.onclick = () => {
          const cm = parseLength(inp.value, unit, 0);
          if (cm === null) { flash('請先輸入距離'); return; }
          flash(editor.splitSelectedWall(cm)
            ? '已分割'
            : (o as any).bulge
              ? '曲線牆還不能分割 — 照弦線切會把弧弄丟'
              : '距離超出牆的範圍');
        };
        inp.style.width = '70px';
        row.append(l, inp, go); size.body.appendChild(row);
      }
      {
        const b = document.createElement('button');
        b.className = 'prop-action'; b.textContent = '📏 自動標註這道牆';
        b.title = '沿牆產生連續尺寸鏈，在門窗與牆交會處斷開';
        b.onclick = () => addDimensionChain(doc, o);
        basics.appendChild(b);
      }
      break;
    case 'beam':
      dim(size.body, '長度', dist(o.a, o.b), v => {   // resize by moving the far end along the beam
        const L = Math.max(1, v), cur = dist(o.a, o.b);
        const ux = cur > 1e-6 ? (o.b.x - o.a.x) / cur : 1;
        const uy = cur > 1e-6 ? (o.b.y - o.a.y) / cur : 0;
        up({ b: { x: o.a.x + ux * L, y: o.a.y + uy * L } } as any);
      }, 1);
      dim(size.body, '寬度', o.width, v => up({ width: Math.max(2, v) } as any), 2);
      dim(size.body, '高度', o.height, v => up({ height: Math.max(2, v) } as any), 2);
      dim(pos.body, '離地面高度', o.elevation, v => up({ elevation: Math.max(0, v) } as any), 0);   // underside above the floor
      break;
    case 'door': case 'window': {
      // style picker (門/窗 form) — wraps to fit the panel
      const styles = o.kind === 'door' ? DOOR_STYLES : WINDOW_STYLES;
      const cur = o.style || styles[0].id;
      const srow = document.createElement('div'); srow.className = 'prop';
      const sl = document.createElement('label'); sl.textContent = '樣式';
      const swrap = document.createElement('div'); swrap.className = 'mat-btns'; swrap.style.flexWrap = 'wrap';
      for (const s of styles) {
        const b = document.createElement('button'); b.className = 'mat-btn' + (cur === s.id ? ' active' : ''); b.textContent = s.label;
        b.onclick = () => {   // toggle active here too — the focused button suppresses the panel rebuild
          doc.commit(); up({ style: s.id } as any);
          swrap.querySelectorAll('.mat-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
        };
        swrap.appendChild(b);
      }
      srow.append(sl, swrap); basics.appendChild(srow);

      // Which way the door is hung and which way it opens. Four buttons rather
      // than two toggles: a plan reader wants to see the hand at a glance, and
      // "hinge right + swing out" is one fact about a door, not two.
      if (o.kind === 'door') {
        const hrow = document.createElement('div'); hrow.className = 'prop prop-mat';
        const hl = document.createElement('label'); hl.textContent = '開口朝向';
        const hwrap = document.createElement('div'); hwrap.className = 'align-grid';
        hwrap.style.gridTemplateColumns = 'repeat(2, 1fr)';
        const hands: [string, 'left' | 'right', 'in' | 'out'][] = [
          ['◟ 左內', 'left', 'in'], ['◞ 右內', 'right', 'in'],
          ['◜ 左外', 'left', 'out'], ['◝ 右外', 'right', 'out'],
        ];
        for (const [label, hinge, swing] of hands) {
          const b = document.createElement('button');
          const on = (o.hinge ?? 'left') === hinge && (o.swing ?? 'in') === swing;
          b.className = 'align-btn' + (on ? ' active' : '');
          b.textContent = label;
          b.style.fontSize = '12px';
          b.onclick = () => {
            doc.commit(); up({ hinge, swing } as any);
            hwrap.querySelectorAll('.align-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
          };
          hwrap.appendChild(b);
        }
        hrow.append(hl, hwrap); basics.appendChild(hrow);
      }
      // 左右牆長是連動的：left + 寬度 + right 恆等於整道牆。改寬度也會同時改變
      // 兩邊，所以這個 setter 也要通知它們。宣告在前面是因為欄位是照順序建的，
      // 而這個 callback 要到使用者真的動手時才會跑，那時兩個欄位都已經存在。
      let syncOffsets: ((widthCm: number) => void) | null = null;
      dim(size.body, '寬度', o.width, v => { const w = Math.max(10, v); up({ width: w } as any); syncOffsets?.(w); }, 10);
      dim(size.body, '高度', o.height ?? (o.kind === 'door' ? 210 : 100), v => up({ height: Math.max(10, v) } as any), 10);
      // find the host straight wall to expose editable left/right offsets
      let host: { w: Extract<Obj, { kind: 'wall' }>; L: number; dc: number; dir: Vec } | null = null; let bestD = 40;
      for (const w of doc.objects) {
        if (w.kind !== 'wall' || w.bulge) continue;
        const cs = closestOnSegment({ x: o.x, y: o.y }, w.a, w.b), d = dist({ x: o.x, y: o.y }, cs.point);
        if (d < bestD) { const L = dist(w.a, w.b); bestD = d; host = { w, L, dc: cs.t * L, dir: { x: L > 1e-6 ? (w.b.x - w.a.x) / L : 1, y: L > 1e-6 ? (w.b.y - w.a.y) / L : 0 } }; }
      }
      if (host) {
        const { w, L, dir } = host;
        // 開口中心與半寬會被使用者改動，所以是變數不是常數——每次落位之後更新。
        let c = host.dc, hw = o.width / 2;
        /** 把中心放到 ndc（沿牆的距離），夾在牆內，回傳真正落在哪。 */
        const place = (ndc: number) => {
          c = Math.min(L - hw, Math.max(hw, ndc));
          up({ x: w.a.x + dir.x * c, y: w.a.y + dir.y * c, angle: angleDeg(w.a, w.b) } as any);
          return c;
        };
        let leftInp: HTMLInputElement | null = null, rightInp: HTMLInputElement | null = null;
        /**
         * 兩個欄位是同一個事實的兩種說法：left + 寬度 + right ≡ 牆長。
         *
         * 改了一邊不更新另一邊的話，面板上會同時出現兩個互相矛盾的數字，而且
         * **停在那裡**——`doc.onChange` 裡的 refreshProps 在焦點還在屬性面板時
         * 會刻意跳過（不然使用者打到一半的輸入框會被整個換掉），所以正在編輯的
         * 那一刻正是它最不會自己更新的時候。
         *
         * 用的是 `place()` 夾過之後的實際位置，不是使用者打進去的數字：輸入
         * 500 但牆只有 300 的時候，對面那格要顯示夾住之後的結果，不是一個
         * 從來沒有成立過的值。
         */
        const sync = (except: HTMLInputElement | null) => {
          if (leftInp && leftInp !== except) leftInp.value = fieldValue(Math.max(0, c - hw), unit);
          if (rightInp && rightInp !== except) rightInp.value = fieldValue(Math.max(0, L - c - hw), unit);
        };
        syncOffsets = (widthCm) => { hw = widthCm / 2; place(c); sync(null); };
        leftInp = dim(pos.body, '左側牆長', Math.max(0, c - hw), v => { place(v + hw); sync(leftInp); }, 0);
        rightInp = dim(pos.body, '右側牆長', Math.max(0, L - c - hw), v => { place(L - v - hw); sync(rightInp); }, 0);
        // 打字的當下不動使用者正在打的那一格——游標會跳。但離開欄位時要把它校正成
        // 真正發生的事：在 300 公分的牆上打 9999，門會貼到底，那一格就該顯示貼到底
        // 之後的值，而不是一個從來沒成立過的數字留在畫面上。
        for (const inp of [leftInp, rightInp]) inp.addEventListener('change', () => sync(null));
      }
      deg(pos.body, '角度', o.angle, v => up({ angle: v } as any));
      dim(pos.body, '離地板距離', o.elevation ?? (o.kind === 'door' ? 0 : 90), v => up({ elevation: Math.max(0, v) } as any));
      break;
    }
    case 'dimension':
      info(basics, '長度', formatLength(dist(o.a, o.b), unit));
      dim(pos.body, '偏移', o.offset, v => up({ offset: v } as any));
      break;
    case 'electrical': {
      // A fitting has no size — what matters on site is which way it faces and
      // how high off the floor it sits.
      const spec = ELECTRICAL_BY_ID[o.item];
      info(basics, '種類', o.label || spec?.name || o.item);
      dim(basics, '安裝高度', o.elevation ?? spec?.elevation ?? 30,
          v => up({ elevation: Math.max(0, v) } as any));
      // deg(), not dim(): an angle is not a length, so it must not follow the
      // cm/m toggle — that turned 30° into "0.30 m".
      deg(pos.body, '角度', o.angle, v => up({ angle: ((v % 360) + 360) % 360 } as any));
      dim(pos.body, 'X', o.x, v => up({ x: v } as any));
      dim(pos.body, 'Y', o.y, v => up({ y: v } as any));
      break;
    }
    case 'image': {
      rangeRow(basics, '透明度', Math.round((o.opacity ?? 1) * 100), v => up({ opacity: Math.max(0, Math.min(1, v / 100)) } as any));
      const gen = document.createElement('button'); gen.className = 'prop-action'; gen.textContent = '🪄 自動偵測牆體';
      gen.title = '從底圖自動生成牆體（適合清晰的平面線稿）';
      gen.onclick = () => autoWallsFromImage(editor, doc, o);
      basics.appendChild(gen);
      dim(size.body, '寬', o.w, v => up({ w: Math.max(10, v) } as any), 10);
      dim(size.body, '高', o.h, v => up({ h: Math.max(10, v) } as any), 10);
      dim(pos.body, 'X', o.x, v => up({ x: v } as any));
      dim(pos.body, 'Y', o.y, v => up({ y: v } as any));
      break;
    }
  }

  if (size.body.children.length) host.appendChild(size.el);
  if (pos.body.children.length) host.appendChild(pos.el);

  // material / finish
  const material = section('材質');
  if (o.kind === 'wall') {
    // Picking a finish clears `color`, because colour wins in the renderer —
    // leaving it set would mean choosing 文化石 and seeing nothing change.
    matRow(material.body, '牆面', wallMaterials(), o.color ? '' : (o.finish ?? 'paint'),
           v => up({ finish: v, color: undefined } as any));
    colorRow(material.body, '自訂色', o.color ?? '#eceff4', v => up({ color: v } as any));
  }
  if (o.kind === 'room') {
    matRow(material.body, '地板', floorMaterials(), o.floor && !o.floor.startsWith('#') ? o.floor : 'wood',
           v => up({ floor: v, auto: false } as any));
    colorRow(material.body, '自訂色', o.floor && o.floor.startsWith('#') ? o.floor : '#b0895e', v => up({ floor: v, auto: false } as any));
  }
  if (o.kind === 'furniture') {
    swatchRow(material.body, o.color, v => up({ color: v } as any));
    colorRow(material.body, '自訂色', o.color ?? '#8a6a4a', v => up({ color: v } as any));
  }
  if (material.body.children.length) host.appendChild(material.el);

  const dup = document.createElement('button'); dup.className = 'prop-action'; dup.textContent = '複製 (⌘D)';
  dup.onclick = () => editor.duplicateSelection();
  host.appendChild(dup);
  const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '刪除物件';
  del.onclick = () => { doc.commit(); doc.remove(o.id); };
  host.appendChild(del);
}

function kindLabel(k: string) {
  return ({ wall: '牆', beam: '樑', partition: '隔間線', room: '房間', door: '門', window: '窗', furniture: '家具',
            dimension: '尺寸標註', image: '底圖', electrical: '水電配件' } as Record<string, string>)[k] ?? k;
}

// Dimension one wall the way a plan does it: a run of measurements broken at
// the openings and junctions along it, rather than a single overall figure.
async function addDimensionChain(doc: Doc, wall: Extract<Obj, { kind: 'wall' }>) {
  flash('正在計算尺寸鏈…');
  const dims = await dimensionChain(wall, doc.objects);
  if (!dims) { flash('無法計算 — 後端未連線'); return; }
  if (!dims.length) { flash('這道牆太短，沒有可標註的區段'); return; }
  doc.commit();
  // Grouped, so the whole chain can be moved or deleted in one go.
  const gid = genId('grp');
  for (const d of dims) {
    doc.add({ id: genId('dimension'), kind: 'dimension', layer: layerForKind('dimension'),
              a: d.a, b: d.b, offset: d.offset, group: gid } as Obj);
  }
  flash(`已加入 ${dims.length} 段尺寸標註`);
}

/**
 * 把「四道牆圍成一個小方框」就地換成一根實心的牆。
 *
 * 判斷條件刻意收得很緊：兩邊都 ≤ 120cm、四個角要對得上、而且四道牆都只屬於這個
 * 框。放寬的話會把一間小廁所吃掉——那是把一個房間變成一根柱子，比留著四道牆糟
 * 得多。
 */
function collapseColumns(walls: [Vec, Vec, number][]) {
  const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
  const horiz = ([a, b]: [Vec, Vec, number]) => near(a.y, b.y);
  const vert = ([a, b]: [Vec, Vec, number]) => near(a.x, b.x);
  const xs = ([a, b]: [Vec, Vec, number]) => [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const ys = ([a, b]: [Vec, Vec, number]) => [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const gone = new Set<[Vec, Vec, number]>();
  const add: [Vec, Vec, number][] = [];
  for (const top of walls) {
    if (gone.has(top) || !horiz(top)) continue;
    const [x0, x1] = xs(top);
    if (x1 - x0 > 120 || x1 - x0 < 5) continue;
    const bottom = walls.find(w => w !== top && !gone.has(w) && horiz(w)
      && near(xs(w)[0], x0) && near(xs(w)[1], x1)
      && Math.abs(w[0].y - top[0].y) > 5 && Math.abs(w[0].y - top[0].y) <= 120);
    if (!bottom) continue;
    const [y0, y1] = [Math.min(top[0].y, bottom[0].y), Math.max(top[0].y, bottom[0].y)];
    const sides = walls.filter(w => !gone.has(w) && vert(w)
      && near(ys(w)[0], y0) && near(ys(w)[1], y1) && (near(w[0].x, x0) || near(w[0].x, x1)));
    if (sides.length !== 2) continue;
    for (const m of [top, bottom, ...sides]) gone.add(m);
    const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    add.push(w >= h
      ? [{ x: x0, y: cy }, { x: x1, y: cy }, h]
      : [{ x: cx, y: y0 }, { x: cx, y: y1 }, w]);
  }
  if (!add.length) return;
  for (let i = walls.length - 1; i >= 0; i--) if (gone.has(walls[i])) walls.splice(i, 1);
  walls.push(...add);
}

// Auto-generate walls from an underlay image, then let room detection fill in rooms.
async function autoWallsFromImage(editor: Editor, doc: Doc, o: Extract<Obj, { kind: 'image' }>) {
  flash('正在辨識牆體…');
  const traced = await detectWalls(o.src);
  if (!traced) { flash('無法辨識牆體 — 後端未連線'); return; }
  {
    const { segments, thickness, w: iw, h: ih } = traced;
    const grid = editor.gridSize || 10;
    const toWorld = (p: Vec) => ({ x: snap(o.x + (p.x / iw) * o.w, grid), y: snap(o.y + (p.y / ih) * o.h, grid) });
    // 像素 → 公分。底圖可能不等比放，取兩軸的平均當厚度的比例。
    const pxToCm = ((o.w / iw) + (o.h / ih)) / 2;
    const raw: [Vec, Vec, number][] = segments
      .map(([a, b], i) => [toWorld(a), toWorld(b), (thickness?.[i] ?? 0) * pxToCm] as [Vec, Vec, number])
      .filter(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) >= grid * 2);

    // weld nearby endpoints into shared nodes so corners actually meet
    const nodes: Vec[] = [];
    const node = (p: Vec) => { for (const q of nodes) if (Math.hypot(p.x - q.x, p.y - q.y) <= grid * 1.5) return q; const n = { x: p.x, y: p.y }; nodes.push(n); return n; };
    const welded = raw.map(([a, b, t]) => [node(a), node(b), t] as [Vec, Vec, number]).filter(([a, b]) => a !== b);

    // split walls where another wall's node lands mid-span (T-junctions), so rooms close
    const walls: [Vec, Vec, number][] = [];
    for (const [a, b, t] of welded) {
      const mids = nodes
        .filter(p => p !== a && p !== b && distToSegment(p, a, b) <= grid)
        .map(p => { const cs = closestOnSegment(p, a, b); p.x = cs.point.x; p.y = cs.point.y; return { p, t: cs.t }; })   // weld the node exactly onto the wall
        .filter(m => m.t > 0.02 && m.t < 0.98)
        .sort((x, y) => x.t - y.t);
      const seq = [a, ...mids.map(m => m.p), b];
      for (let i = 1; i < seq.length; i++) if (Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y) >= grid) walls.push([seq[i - 1], seq[i], t]);
    }
    if (!walls.length) { flash('偵測不到牆體 — 請確認是清晰、線條分明的平面圖'); return; }
    doc.commit();
    // **柱子是柱子，不是四道牆。** 底圖上的柱子是一個實心黑塊，四邊各描一條線，
    // 於是辨識出來會是四道圍成小方框的牆。那在 2D 看得過去，3D 就是一個空心的
    // 方管，而且外緣比黑塊大一整個牆厚。一道 `thickness` 等於短邊、中心線沿長邊
    // 的牆本來就是一個實心長方體——不需要新的物件種類，2D 填充、房間偵測、選取
    // 編輯全部照舊。
    collapseColumns(walls);

    // **厚度用量到的，不是寫死的。** 底圖上一道牆畫成兩條線，兩條線之間就是它的
    // 厚度；以前這裡一律給 12，於是圖上 24 公分的牆生出 12 公分的、8 公分的隔間
    // 生出 12 公分的——後者直接畫到使用者的線外面去。量不到（只看到一個面）才退回
    // 12。夾在 4–60 之間：Hough 偶爾會把兩道平行的牆併成一組，那會量出一個離譜的
    // 厚度，而一道 3 公尺厚的牆比一道 12 公分的錯牆難發現得多。
    for (const [a, b, t] of walls) {
      const thick = t >= 4 ? Math.min(60, Math.round(t)) : 12;
      doc.add({ id: genId('wall'), kind: 'wall', layer: layerForKind('wall'), a, b, thickness: thick } as Obj);
    }
    editor.selectTool('select');
    flash(`已從底圖生成 ${walls.length} 道牆（封閉區域會自動成為房間，可再手動調整）`);
  }
}
