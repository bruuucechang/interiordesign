import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj, Vec, layerForKind } from '../model/types';
import { FURNITURE, FURNITURE_CATS } from '../data/furniture';
import { dist, snap, angleDeg, distToSegment, closestOnSegment, polygonArea, polygonCentroid, pointInPolygon, pointInRect } from '../core/geometry';
import { detectRoomPolygons } from '../core/rooms';
import { detectWallsFromImage } from '../core/detect';
import { getModelHeight } from '../core/furniture3d';
import { exportPNG, exportPDF } from '../core/exporter';
import { listProjects, loadProject, saveProject, deleteProject } from '../net/api';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// 常用 = the everyday drawing tools, shown as the first catalog section.
const COMMON_TOOLS = [
  { name: 'select', ic: '⬚', label: '選取' },
  { name: 'pan', ic: '✋', label: '平移' },
  { name: 'wall', ic: '▬', label: '直線牆' },
  { name: 'wallCurve', ic: '◠', label: '曲線牆' },
  { name: 'beam', ic: '═', label: '樑' },
  { name: 'door', ic: '🚪', label: '門' },
  { name: 'window', ic: '🪟', label: '窗' },
];

export function initUI(editor: Editor, doc: Doc) {
  buildCatalog(editor);
  buildFloors(editor, doc);
  buildLayers(editor, doc);
  refreshProps(editor, doc);
  wireTopbar(editor, doc);

  editor.hooks.toolChange = (name) => markActiveTool(name);
  editor.hooks.zoom = (pct) => { $('#zoomLabel').textContent = pct + '%'; };
  markActiveTool('select');

  doc.onChange(() => {
    buildFloors(editor, doc); buildLayers(editor, doc);
    // don't rebuild the property panel while the user is typing in one of its
    // fields (it would replace the focused input); the edit is already applied.
    if (!$('#properties').contains(document.activeElement)) refreshProps(editor, doc);
    scheduleAutosave(doc); scheduleReconcile(doc); updateUndoRedo(doc);
  });
  updateUndoRedo(doc);
  const nameInput = $<HTMLInputElement>('#projectName');
  nameInput.value = doc.project.name;
  nameInput.addEventListener('input', () => { doc.project.name = nameInput.value || '未命名平面圖'; scheduleAutosave(doc); });

  const imgInput = $<HTMLInputElement>('#imageInput');
  imgInput.addEventListener('change', () => {
    const file = imgInput.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { importImage(editor, doc, reader.result as string); imgInput.value = ''; };
    reader.readAsDataURL(file);
  });
}

// ---- unified catalog: 常用 tools first, then furniture by room ----
function buildCatalog(editor: Editor) {
  const host = $('#catalog'); host.innerHTML = '';
  const title = (text: string) => { const d = document.createElement('div'); d.className = 'panel-title'; d.textContent = text; host.appendChild(d); };

  // 常用 — everyday drawing tools
  title('常用');
  const pal = document.createElement('div'); pal.className = 'palette';
  for (const t of COMMON_TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool-btn'; b.dataset.tool = t.name;
    b.innerHTML = `<span class="ic">${t.ic}</span>${t.label}`;
    b.onclick = () => editor.selectTool(t.name);
    pal.appendChild(b);
  }
  host.appendChild(pal);

  // furniture, grouped by room category
  for (const cat of FURNITURE_CATS) {
    const items = FURNITURE.filter(f => f.cat === cat);
    if (!items.length) continue;
    title(cat);
    const grid = document.createElement('div'); grid.className = 'furniture-grid';
    for (const item of items) {
      const b = document.createElement('button');
      b.className = 'furn-btn'; b.dataset.furn = item.id;
      const cv = document.createElement('canvas');
      const maxW = 60, maxH = 34; const s = Math.min(maxW / item.w, maxH / item.h);
      cv.width = maxW; cv.height = maxH;
      const ctx = cv.getContext('2d')!;
      ctx.translate((maxW - item.w * s) / 2, (maxH - item.h * s) / 2); ctx.scale(s, s);
      item.draw(ctx, item.w, item.h);
      b.appendChild(cv);
      b.appendChild(document.createTextNode(item.name));
      b.onclick = () => {
        editor.currentFurniture = item.id;
        editor.selectTool('furniture');
        document.querySelectorAll('.furn-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.querySelectorAll('.tool-btn').forEach(x => x.classList.remove('active'));
      };
      grid.appendChild(b);
    }
    host.appendChild(grid);
  }
}
function markActiveTool(name: string) {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tool === name));
  if (name !== 'furniture') document.querySelectorAll('.furn-btn').forEach(b => b.classList.remove('active'));
}

function updateUndoRedo(doc: Doc) {
  const u = document.querySelector('[data-act="undo"]') as HTMLButtonElement | null;
  const r = document.querySelector('[data-act="redo"]') as HTMLButtonElement | null;
  if (u) u.disabled = !doc.canUndo;
  if (r) r.disabled = !doc.canRedo;
}

// ---- floors ----
function buildFloors(editor: Editor, doc: Doc) {
  const host = $('#floors'); host.innerHTML = '';
  for (const f of [...doc.floors].reverse()) {   // highest level on top
    const row = document.createElement('div'); row.className = 'floor-row' + (f.id === doc.project.activeFloorId ? ' active' : '');
    const name = document.createElement('span'); name.className = 'fname'; name.textContent = f.name;
    name.title = '點擊切換樓層，雙擊重新命名';
    name.onclick = () => doc.setActiveFloor(f.id);
    name.ondblclick = () => { const n = prompt('樓層名稱', f.name); if (n) doc.renameFloor(f.id, n); };
    const elev = document.createElement('span'); elev.className = 'felev'; elev.textContent = (f.elevation / 100).toFixed(1) + 'm';
    const del = document.createElement('button'); del.textContent = '✕'; del.title = '刪除樓層';
    del.onclick = (e) => { e.stopPropagation(); if (doc.floors.length > 1 && confirm(`刪除樓層「${f.name}」？`)) doc.removeFloor(f.id); };
    row.append(name, elev, del);
    host.appendChild(row);
  }
  const add = document.createElement('button'); add.className = 'add-floor'; add.textContent = '＋ 新增樓層';
  add.onclick = () => doc.addFloor();
  host.appendChild(add);
}

// ---- layers ----
function buildLayers(editor: Editor, doc: Doc) {
  const host = $('#layers'); host.innerHTML = '';
  // display top-of-stack first
  const layers = [...doc.project.layers].reverse();
  for (const l of layers) {
    const row = document.createElement('div'); row.className = 'layer-row';
    const eye = document.createElement('button'); eye.textContent = l.visible ? '👁' : '🚫'; eye.className = l.visible ? 'on' : '';
    eye.onclick = () => { doc.toggleLayerVisible(l.id); };
    const lock = document.createElement('button'); lock.textContent = l.locked ? '🔒' : '🔓'; lock.className = l.locked ? '' : 'on';
    lock.onclick = () => { doc.toggleLayerLock(l.id); };
    const name = document.createElement('span'); name.className = 'name'; name.textContent = l.name;
    name.style.color = l.color;
    const up = document.createElement('button'); up.textContent = '▲'; up.onclick = () => doc.moveLayer(l.id, 1);
    const dn = document.createElement('button'); dn.textContent = '▼'; dn.onclick = () => doc.moveLayer(l.id, -1);
    row.append(eye, lock, name, up, dn);
    host.appendChild(row);
  }
}

// ---- properties ----
type Unit = 'cm' | 'm';
let unit: Unit = 'cm';   // shared across selections; toggled from the panel header
const uLabel = () => (unit === 'm' ? 'm' : 'cm');
const toU = (cm: number) => (unit === 'm' ? cm / 100 : cm);
const fromU = (v: number) => (unit === 'm' ? v * 100 : v);
const fmtLenU = (cm: number) => (unit === 'm' ? (cm / 100).toFixed(2) + ' m' : Math.round(cm) + ' cm');
const fmtAreaU = (cm2: number) => (unit === 'm' ? (cm2 / 10000).toFixed(2) + ' m²' : Math.round(cm2) + ' cm²');

function refreshProps(editor: Editor, doc: Doc) {
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
    const l = document.createElement('label'); l.textContent = `${label} (${uLabel()})`;
    const inp = document.createElement('input'); inp.type = 'number';
    const d = toU(cm); inp.value = unit === 'm' ? d.toFixed(2) : String(Math.round(d)); inp.step = unit === 'm' ? '0.01' : '1';
    inp.addEventListener('focus', () => doc.commit());
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!isNaN(v)) setCm(Math.max(min, fromU(v))); });
    row.append(l, inp); parent.appendChild(row);
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
  const floorRow = (parent: HTMLElement, current: string, set: (v: string) => void) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = '地板';
    const wrap = document.createElement('div'); wrap.className = 'mat-btns';
    const mk = (val: string, label: string) => { const b = document.createElement('button'); b.className = 'mat-btn' + (current === val ? ' active' : ''); b.textContent = label; b.onclick = () => { doc.commit(); set(val); }; wrap.appendChild(b); };
    mk('wood', '木地板'); mk('tile', '磁磚');
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
      info(basics, '面積', fmtAreaU(poly ? polygonArea(poly) : o.w * o.h));
      if (!poly) {
        dim(size.body, '寬', o.w, v => up({ w: Math.max(10, v) } as any), 10);
        dim(size.body, '深', o.h, v => up({ h: Math.max(10, v) } as any), 10);
        dim(pos.body, 'X', o.x, v => up({ x: v } as any));
        dim(pos.body, 'Y', o.y, v => up({ y: v } as any));
      }
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
      dim(size.body, '寬度', o.width, v => up({ width: Math.max(10, v) } as any), 10);
      dim(size.body, '高度', o.height ?? (o.kind === 'door' ? 210 : 100), v => up({ height: Math.max(10, v) } as any), 10);
      // find the host straight wall to expose editable left/right offsets
      let host: { w: Extract<Obj, { kind: 'wall' }>; L: number; dc: number; dir: Vec } | null = null; let bestD = 40;
      for (const w of doc.objects) {
        if (w.kind !== 'wall' || w.bulge) continue;
        const cs = closestOnSegment({ x: o.x, y: o.y }, w.a, w.b), d = dist({ x: o.x, y: o.y }, cs.point);
        if (d < bestD) { const L = dist(w.a, w.b); bestD = d; host = { w, L, dc: cs.t * L, dir: { x: L > 1e-6 ? (w.b.x - w.a.x) / L : 1, y: L > 1e-6 ? (w.b.y - w.a.y) / L : 0 } }; }
      }
      if (host) {
        const { w, L, dc, dir } = host, hw = o.width / 2;
        const place = (ndc: number) => { const c = Math.min(L - hw, Math.max(hw, ndc)); up({ x: w.a.x + dir.x * c, y: w.a.y + dir.y * c, angle: angleDeg(w.a, w.b) } as any); };
        dim(pos.body, '左側牆長', Math.max(0, dc - hw), v => place(v + hw), 0);
        dim(pos.body, '右側牆長', Math.max(0, L - dc - hw), v => place(L - v - hw), 0);
      }
      deg(pos.body, '角度', o.angle, v => up({ angle: v } as any));
      dim(pos.body, '離地板距離', o.elevation ?? (o.kind === 'door' ? 0 : 90), v => up({ elevation: Math.max(0, v) } as any));
      break;
    }
    case 'dimension':
      info(basics, '長度', fmtLenU(dist(o.a, o.b)));
      dim(pos.body, '偏移', o.offset, v => up({ offset: v } as any));
      break;
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
  if (o.kind === 'wall') colorRow(material.body, '顏色', o.color ?? '#eceff4', v => up({ color: v } as any));
  if (o.kind === 'room') {
    floorRow(material.body, o.floor && !o.floor.startsWith('#') ? o.floor : 'wood', v => up({ floor: v, auto: false } as any));
    colorRow(material.body, '自訂色', o.floor && o.floor.startsWith('#') ? o.floor : '#b0895e', v => up({ floor: v, auto: false } as any));
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
  return ({ wall: '牆', beam: '樑', room: '房間', door: '門', window: '窗', furniture: '家具', dimension: '尺寸標註', image: '底圖' } as Record<string, string>)[k] ?? k;
}

// ---- top bar ----
let autosaveTimer: number | undefined;
function scheduleAutosave(doc: Doc) {
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => saveProject(doc.serialize()), 800);
}

// Collapsible 匯出 menu: its items are built only while open and removed on
// close (dynamic rendering — no idle DOM), keeping the topbar light.
function wireExportMenu(editor: Editor, doc: Doc) {
  const wrap = $('#exportMenu'), toggle = $('#exportToggle');
  const items: { label: string; act: string }[] = [
    { label: '匯出 PNG', act: 'export-png' },
    { label: '匯出 PDF', act: 'export-pdf' },
    { label: '🧊 匯出 3D 模型', act: 'export-glb' },
  ];
  let pop: HTMLElement | null = null;
  const onDoc = (e: Event) => { if (!wrap.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  function close() {
    if (pop) { pop.remove(); pop = null; }
    wrap.classList.remove('open');
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey);
  }
  function open() {
    pop = document.createElement('div'); pop.className = 'menu-pop';
    for (const it of items) {
      const b = document.createElement('button'); b.textContent = it.label;
      b.onclick = () => { close(); handle(it.act, editor, doc); };
      pop.appendChild(b);
    }
    wrap.appendChild(pop); wrap.classList.add('open');
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
  }
  toggle.onclick = (e) => { e.stopPropagation(); pop ? close() : open(); };
}

function wireTopbar(editor: Editor, doc: Doc) {
  document.querySelectorAll('#topbar [data-act]').forEach(btn => {
    (btn as HTMLElement).onclick = () => handle((btn as HTMLElement).dataset.act!, editor, doc);
  });
  wireExportMenu(editor, doc);
  $('#zoomOut').onclick = () => editor.zoomBy(1 / 1.1);
  $('#zoomIn').onclick = () => editor.zoomBy(1.1);
  $('#zoomLabel').onclick = () => editor.resetView();
  const snap = $<HTMLInputElement>('#snapToggle');
  snap.onchange = () => editor.setSnap(snap.checked);
  $('[data-act="close-modal"]').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('[data-act="close-shortcuts"]').addEventListener('click', () => $('#shortcutsModal').classList.add('hidden'));
}

async function handle(act: string, editor: Editor, doc: Doc) {
  const name = () => $<HTMLInputElement>('#projectName').value || '未命名平面圖';
  switch (act) {
    case 'new':
      if (!confirm('新建會清空目前畫布，確定？')) return;
      doc.load(Doc.blank()); $<HTMLInputElement>('#projectName').value = doc.project.name; editor.resetView(); break;
    case 'save': doc.project.name = name(); await saveProject(doc.serialize()); flash('已儲存'); break;
    case 'open': await openModal(editor, doc); break;
    case 'undo': doc.undo(); break;
    case 'redo': doc.redo(); break;
    case 'export-png': exportPNG(doc, name()); break;
    case 'export-pdf': exportPDF(doc, name()); break;
    case 'export-glb':
      if (!doc.objects.length) { flash('尚無可匯出的 3D 內容'); break; }
      try { await editor.hooks.export3d?.(name()); flash('已匯出 3D 模型 (.glb)'); }
      catch (e) { console.error(e); flash('匯出 3D 失敗'); }
      break;
    case 'import-image': $<HTMLInputElement>('#imageInput').click(); break;
    case 'shortcuts': $('#shortcutsModal').classList.remove('hidden'); break;
  }
}

// Load an image as a traceable underlay: size it to fit, center it, drop it on
// the bottom 'underlay' layer at 60% opacity.
function importImage(editor: Editor, doc: Doc, src: string) {
  const probe = new Image();
  probe.onload = () => {
    // downscale big images so the data URL (stored in the project, autosaved) stays small
    const MAX_PX = 1600;
    const sc = Math.min(1, MAX_PX / Math.max(probe.naturalWidth, probe.naturalHeight));
    if (sc < 1) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(probe.naturalWidth * sc); cv.height = Math.round(probe.naturalHeight * sc);
      cv.getContext('2d')!.drawImage(probe, 0, 0, cv.width, cv.height);
      src = cv.toDataURL('image/jpeg', 0.85);
    }
    const s = 1000 / Math.max(probe.naturalWidth, probe.naturalHeight);   // fit longest side to ~10 m
    const w = Math.round(probe.naturalWidth * s), h = Math.round(probe.naturalHeight * s);
    const vp = editor.vp;
    const cx = vp.origin.x + vp.width / 2 / vp.scale, cy = vp.origin.y + vp.height / 2 / vp.scale;
    if (!doc.layer('underlay')) doc.project.layers.unshift({ id: 'underlay', name: '底圖', visible: true, locked: false, color: '#8b93a3' });
    doc.commit();
    const id = genId('img');
    doc.add({ id, kind: 'image', layer: 'underlay', x: cx - w / 2, y: cy - h / 2, w, h, src, opacity: 0.6 } as Obj);
    doc.select(id);
    editor.selectTool('select');
    flash('已匯入底圖 — 拖曳/縮放對位，鎖定「底圖」圖層後即可描圖');
  };
  probe.src = src;
}

// Auto-generate walls from an underlay image, then let room detection fill in rooms.
function autoWallsFromImage(editor: Editor, doc: Doc, o: Extract<Obj, { kind: 'image' }>) {
  const img = new Image();
  img.onload = () => {
    const { segments, w: iw, h: ih } = detectWallsFromImage(img);
    const grid = editor.gridSize || 10;
    const toWorld = (p: Vec) => ({ x: snap(o.x + (p.x / iw) * o.w, grid), y: snap(o.y + (p.y / ih) * o.h, grid) });
    const raw = segments
      .map(([a, b]) => [toWorld(a), toWorld(b)] as [Vec, Vec])
      .filter(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) >= grid * 2);

    // weld nearby endpoints into shared nodes so corners actually meet
    const nodes: Vec[] = [];
    const node = (p: Vec) => { for (const q of nodes) if (Math.hypot(p.x - q.x, p.y - q.y) <= grid * 1.5) return q; const n = { x: p.x, y: p.y }; nodes.push(n); return n; };
    const welded = raw.map(([a, b]) => [node(a), node(b)] as [Vec, Vec]).filter(([a, b]) => a !== b);

    // split walls where another wall's node lands mid-span (T-junctions), so rooms close
    const walls: [Vec, Vec][] = [];
    for (const [a, b] of welded) {
      const mids = nodes
        .filter(p => p !== a && p !== b && distToSegment(p, a, b) <= grid)
        .map(p => { const cs = closestOnSegment(p, a, b); p.x = cs.point.x; p.y = cs.point.y; return { p, t: cs.t }; })   // weld the node exactly onto the wall
        .filter(m => m.t > 0.02 && m.t < 0.98)
        .sort((x, y) => x.t - y.t);
      const seq = [a, ...mids.map(m => m.p), b];
      for (let i = 1; i < seq.length; i++) if (Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y) >= grid) walls.push([seq[i - 1], seq[i]]);
    }
    if (!walls.length) { flash('偵測不到牆體 — 請確認是清晰、線條分明的平面圖'); return; }
    doc.commit();
    for (const [a, b] of walls) doc.add({ id: genId('wall'), kind: 'wall', layer: layerForKind('wall'), a, b, thickness: 12 } as Obj);
    editor.selectTool('select');
    flash(`已從底圖生成 ${walls.length} 道牆（封閉區域會自動成為房間，可再手動調整）`);
  };
  img.src = o.src;
}

// ---- automatic room recognition from closed walls ----
type RoomObj = Extract<Obj, { kind: 'room' }>;
type WallObj = Extract<Obj, { kind: 'wall' }>;
const bboxOf = (poly: Vec[]) => {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const roomContains = (r: RoomObj, c: Vec) =>
  (r.poly && r.poly.length >= 3) ? pointInPolygon(c, r.poly) : pointInRect(c, r.x, r.y, r.w, r.h);

let reconcileTimer: number | undefined;
let reconciling = false;
let lastWallSig = ' ';
function wallSig(doc: Doc): string {
  return (doc.objects.filter(o => o.kind === 'wall') as WallObj[])
    .map(w => `${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(';');
}
// Debounced: whenever the walls change, re-derive the auto rooms.
function scheduleReconcile(doc: Doc) {
  if (reconciling) return;
  clearTimeout(reconcileTimer);
  reconcileTimer = window.setTimeout(() => {
    const sig = wallSig(doc);
    if (sig === lastWallSig) return;          // walls unchanged — nothing to do
    lastWallSig = sig;
    reconciling = true;
    try { reconcileAutoRooms(doc); } finally { reconciling = false; }
  }, 150);
}

// Match detected wall-enclosed regions to existing auto rooms: update ones that
// still hold, drop ones whose enclosure is gone, and add rooms for new closures.
// Manual rooms (drawn, renamed, or moved) are left untouched.
function reconcileAutoRooms(doc: Doc) {
  const walls = doc.objects.filter(o => o.kind === 'wall') as WallObj[];
  const detected = detectRoomPolygons(walls);
  const cents = detected.map(polygonCentroid);
  const rooms = () => doc.objects.filter(o => o.kind === 'room') as RoomObj[];
  const manual = rooms().filter(r => !r.auto);
  const consumed = new Set<number>();

  for (const ar of rooms().filter(r => r.auto)) {
    const arC = ar.poly && ar.poly.length >= 3 ? polygonCentroid(ar.poly) : { x: ar.x + ar.w / 2, y: ar.y + ar.h / 2 };
    let idx = -1;
    for (let i = 0; i < detected.length; i++) {
      if (consumed.has(i)) continue;
      if ((ar.poly && ar.poly.length >= 3 && pointInPolygon(cents[i], ar.poly)) || pointInPolygon(arC, detected[i])) { idx = i; break; }
    }
    if (idx < 0) { doc.remove(ar.id); continue; }                       // enclosure gone
    consumed.add(idx);
    const poly = detected[idx];
    if (JSON.stringify(ar.poly) !== JSON.stringify(poly)) doc.update(ar.id, { poly, ...bboxOf(poly) } as any);
  }

  for (let i = 0; i < detected.length; i++) {
    if (consumed.has(i)) continue;
    if (manual.some(r => roomContains(r, cents[i]))) continue;          // already a manual room here
    const poly = detected[i];
    doc.add({ id: genId('room'), kind: 'room', layer: layerForKind('room'), name: '房間', poly, auto: true, ...bboxOf(poly) } as any);
  }
}

async function openModal(editor: Editor, doc: Doc) {
  const modal = $('#modal'); const list = $('#projectList');
  list.innerHTML = '<div class="muted" style="padding:12px">載入中…</div>';
  modal.classList.remove('hidden');
  const projects = await listProjects();
  list.innerHTML = '';
  if (!projects.length) { list.innerHTML = '<div class="muted" style="padding:12px">尚無已儲存的專案</div>'; return; }
  for (const p of projects) {
    const row = document.createElement('div'); row.className = 'project-row';
    row.innerHTML = `<span class="pname">${p.name}</span><span class="pdate">${p.updatedAt ?? ''}</span>`;
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '刪除';
    del.onclick = async (e) => { e.stopPropagation(); if (confirm(`刪除「${p.name}」？`)) { await deleteProject(p.id); row.remove(); } };
    row.appendChild(del);
    row.onclick = async () => {
      const proj = await loadProject(p.id);
      if (proj) { doc.load(proj); $<HTMLInputElement>('#projectName').value = proj.name; editor.resetView(); }
      modal.classList.add('hidden');
    };
    list.appendChild(row);
  }
}

function flash(msg: string) {
  const el = $('#hint'); const prev = el.textContent; el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = prev; }, 1200);
}
