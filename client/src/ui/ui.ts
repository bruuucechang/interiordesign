import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj, Project } from '../model/schema';
import { ELECTRICAL } from '../model/catalogue';
import { FURNITURE, FURNITURE_CATS, FurnitureItem } from '../data/furniture';
import { ELECTRICAL_SYMBOLS } from '../data/electrical';
import { snap } from '../core/geometry';

import { exportPNG, exportPDF } from '../core/exporter';

import { flash } from './feedback';
import { flushSave, markDirty, scheduleAutosave, startAutosave } from './autosave';
import { scheduleReconcile } from './rooms-sync';
import { refreshProps } from './properties';
import { dwgNotSupportedModal, dxfImportModal, plotModal, openModal } from './modals';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// 常用 = the everyday drawing tools, shown as the first catalog section.
const COMMON_TOOLS = [
  { name: 'select', ic: '✋', label: '平移' },   // 拖曳物件移動；拖曳空白處平移視角
  { name: 'wall', ic: '▬', label: '直線牆' },
  { name: 'wallCurve', ic: '◠', label: '曲線牆' },
  { name: 'beam', ic: '═', label: '樑' },
  { name: 'partition', ic: '┄', label: '隔間線' },
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
  startAutosave(doc);
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

  const dxfInput = $<HTMLInputElement>('#dxfInput');
  dxfInput.addEventListener('change', () => {
    const file = dxfInput.files?.[0]; if (!file) return;
    dxfInput.value = '';
    if (/\.dwg$/i.test(file.name)) { dwgNotSupportedModal(); return; }
    const reader = new FileReader();
    reader.onload = () => { dxfImportModal(editor, doc, reader.result as string); };
    reader.readAsDataURL(file);   // the backend accepts a data URL directly
  });

  const projFileInput = $<HTMLInputElement>('#projectFileInput');
  projFileInput.addEventListener('change', () => {
    const file = projFileInput.files?.[0]; if (!file) return;
    importProjectFile(editor, doc, file);
    projFileInput.value = '';   // allow re-importing the same file
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

  // ---- furniture: search, style filter, collapsible rooms ----
  //
  // A flat list stopped working somewhere past a hundred pieces: 客廳 alone is
  // 48 buttons, so finding one is scrolling past four screens of pictures. The
  // three controls are deliberately independent — search is a name substring,
  // the chips pick one style, the fold is per-room — because the moment they
  // gate each other, an empty panel has three possible causes and the user has
  // to guess which one they tripped.
  //
  // Fold state persists. A palette that re-opens all eight rooms every reload
  // undoes the tidying every time, which is the same as not having it.
  const LS_FOLD = 'furnFold', LS_STYLE = 'furnStyle';
  const folded = new Set<string>(JSON.parse(localStorage.getItem(LS_FOLD) || '[]'));
  const styleSel = new Set<string>(JSON.parse(localStorage.getItem(LS_STYLE) || '[]'));
  let query = '';

  const bar = document.createElement('div'); bar.className = 'furn-filter';
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = '搜尋家具…'; search.className = 'furn-search';
  bar.appendChild(search);
  const chips = document.createElement('div'); chips.className = 'furn-chips';
  const STYLES = ['現代', '北歐', '日式', '古典', '鄉村', '工業', '中式'];
  const chipEls = new Map<string, HTMLButtonElement>();
  const allChip = document.createElement('button');
  allChip.className = 'chip'; allChip.textContent = '全部';
  chips.appendChild(allChip);
  for (const st of STYLES) {
    const c = document.createElement('button');
    c.className = 'chip'; c.textContent = st;
    // 單選。複選的聯集在這裡是反效果：現代 75 件加古典 37 件不會幫你找到東西，
    // 只是把兩堆風格不同的家具倒在一起——而使用者按第二個鍵的意思幾乎一定是
    // 「改看這個」，不是「兩個都要」。再按一次同一顆等於回到全部。
    c.onclick = () => {
      const only = styleSel.size === 1 && styleSel.has(st);
      styleSel.clear();
      if (!only) styleSel.add(st);
      apply();
    };
    chipEls.set(st, c); chips.appendChild(c);
  }
  allChip.onclick = () => { styleSel.clear(); apply(); };
  bar.appendChild(chips);
  host.appendChild(bar);
  search.oninput = () => { query = search.value.trim().toLowerCase(); apply(); };

  const sections: { head: HTMLElement; grid: HTMLElement; cat: string; btns: { el: HTMLElement; item: FurnitureItem }[] }[] = [];
  /** Re-run the filter over the buttons that already exist. Nothing is rebuilt:
   *  the pictogram canvases and the 141 preview images are the expensive part,
   *  and typing must not pay for them on every keystroke. */
  function apply() {
    allChip.classList.toggle('on', styleSel.size === 0);
    for (const [st, c] of chipEls) c.classList.toggle('on', styleSel.has(st));
    localStorage.setItem(LS_STYLE, JSON.stringify([...styleSel]));
    for (const s of sections) {
      let shown = 0;
      for (const { el, item } of s.btns) {
        const ok = (!query || item.name.toLowerCase().includes(query) || item.id.includes(query))
          && (!styleSel.size || (item.style ? styleSel.has(item.style) : false));
        el.style.display = ok ? '' : 'none';
        if (ok) shown++;
      }
      // A section with nothing left in it goes away entirely — leaving the
      // heading behind reads as "客廳 has no sofas" rather than "your filter
      // excluded them".
      s.head.style.display = shown ? '' : 'none';
      s.grid.style.display = shown && !folded.has(s.cat) ? '' : 'none';
      const n = s.head.querySelector('.furn-count');
      if (n) n.textContent = String(shown);
    }
  }

  for (const cat of FURNITURE_CATS) {
    const items = FURNITURE.filter(f => f.cat === cat);
    if (!items.length) continue;
    const head = document.createElement('div');
    head.className = 'panel-title collapsible furn-head';
    if (folded.has(cat)) head.classList.add('collapsed');
    head.innerHTML = `<span>${cat}</span><span class="furn-count">${items.length}</span>`;
    host.appendChild(head);
    const grid = document.createElement('div'); grid.className = 'furniture-grid';
    const btns: { el: HTMLElement; item: FurnitureItem }[] = [];
    head.onclick = () => {
      folded.has(cat) ? folded.delete(cat) : folded.add(cat);
      head.classList.toggle('collapsed', folded.has(cat));
      localStorage.setItem(LS_FOLD, JSON.stringify([...folded]));
      apply();
    };
    sections.push({ head, grid, cat, btns });
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
      // The palette shows the model's own preview picture where there is one.
      // A top-down pictogram cannot tell a 太師椅 from a 餐椅 or a 吊燈 from a
      // 吸頂燈 — they are the same rounded rectangle — and with 72 items that is
      // most of the panel. Both libraries already ship a render per model, so
      // this costs a file rather than a browser-side render pass.
      //
      // Swapped in on load rather than used directly: the drawn one is the
      // fallback for anything with no model, and building it first means no
      // gap while the picture arrives and nothing to undo if it never does.
      const img = new Image();
      // 不用 loading="lazy"：面板是一條長清單，懶載入下離開視窗的那些永遠不會
      // 發出請求，onload 也就永遠不觸發——實測 72 個按鈕換上 0 張。72 張小圖總共
      // 約 1MB，一次載完比較單純。
      img.alt = ''; img.decoding = 'async';
      img.src = new URL(`models/${item.id}/thumb.png`, document.baseURI).href;
      img.onload = () => { if (cv.parentNode === b) b.replaceChild(img, cv); };
      b.appendChild(document.createTextNode(item.name));
      b.onclick = () => {
        editor.currentFurniture = item.id;
        editor.selectTool('furniture');
        document.querySelectorAll('.furn-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.querySelectorAll('.tool-btn').forEach(x => x.classList.remove('active'));
      };
      btns.push({ el: b, item });
      grid.appendChild(b);
    }
    host.appendChild(grid);
  }
  apply();

  // 水電 — the electrical schedule a Taiwanese handover needs
  for (const cat of ['插座', '開關', '燈具']) {
    const items = ELECTRICAL.filter(e => e.cat === cat);
    if (!items.length) continue;
    title(cat);
    const grid = document.createElement('div'); grid.className = 'furniture-grid';
    for (const spec of items) {
      const b = document.createElement('button');
      b.className = 'furn-btn'; b.dataset.elec = spec.id;
      b.title = `${spec.name}　安裝高度 ${spec.elevation} cm`;
      const cv = document.createElement('canvas');
      cv.width = 60; cv.height = 34;
      const ctx = cv.getContext('2d')!;
      ctx.translate(30, 22); ctx.scale(0.85, 0.85);
      ctx.strokeStyle = '#ffd166'; ctx.fillStyle = '#ffd166';
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      ELECTRICAL_SYMBOLS[spec.id](ctx);
      b.appendChild(cv);
      b.appendChild(document.createTextNode(spec.name));
      b.onclick = () => {
        editor.currentElectrical = spec.id;
        editor.selectTool('electrical');
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
  if (name !== 'furniture' && name !== 'electrical') document.querySelectorAll('.furn-btn').forEach(b => b.classList.remove('active'));
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
    const del = iconButton('close', '刪除樓層');
    del.onclick = (e) => { e.stopPropagation(); if (doc.floors.length > 1 && confirm(`刪除樓層「${f.name}」？`)) doc.removeFloor(f.id); };
    row.append(name, elev, del);
    host.appendChild(row);
  }
  const add = document.createElement('button'); add.className = 'add-floor';
  add.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${PANEL_ICON.plus}</svg><span>新增樓層</span>`;
  add.onclick = () => doc.addFloor();
  host.appendChild(add);
}

// ---- layers ----
/**
 * The panel icons, drawn rather than typed — same reason as the topbar's.
 *
 * Visible/hidden and locked/unlocked are **one shape in two states**, not two
 * shapes. It was 👁 against 🚫 and 🔒 against 🔓: a toggle whose two positions
 * are different pictures makes you read the picture to work out which way it is
 * set, instead of seeing it. The eye keeps its outline and gains a slash; the
 * padlock keeps its body and its shackle swings open.
 */
const PANEL_ICON: Record<string, string> = {
  eyeOn: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 20 20 4"/>',
  lockOn: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  lockOff: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
/** A button whose whole content is one of the icons above. */
export function iconButton(icon: keyof typeof PANEL_ICON, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.title = title; b.setAttribute('aria-label', title);
  b.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${PANEL_ICON[icon]}</svg>`;
  return b;
}

function buildLayers(editor: Editor, doc: Doc) {
  const host = $('#layers'); host.innerHTML = '';
  // display top-of-stack first
  const layers = [...doc.project.layers].reverse();
  for (const l of layers) {
    const row = document.createElement('div'); row.className = 'layer-row';
    const eye = iconButton(l.visible ? 'eyeOn' : 'eyeOff', l.visible ? '隱藏這個圖層' : '顯示這個圖層');
    eye.className = l.visible ? 'on' : '';
    eye.onclick = () => { doc.toggleLayerVisible(l.id); };
    const lock = iconButton(l.locked ? 'lockOn' : 'lockOff', l.locked ? '解鎖這個圖層' : '鎖定這個圖層');
    lock.className = l.locked ? '' : 'on';
    lock.onclick = () => { doc.toggleLayerLock(l.id); };
    const name = document.createElement('span'); name.className = 'name'; name.textContent = l.name;
    name.style.color = l.color;
    const up = iconButton('up', '往上一層'); up.onclick = () => doc.moveLayer(l.id, 1);
    const dn = iconButton('down', '往下一層'); dn.onclick = () => doc.moveLayer(l.id, -1);
    row.append(eye, lock, name, up, dn);
    host.appendChild(row);
  }
}

function exportProjectFile(doc: Doc, name: string) {
  const json = JSON.stringify(doc.serialize(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const safe = (name || 'floorplan').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'floorplan';
  const a = document.createElement('a');
  a.href = url; a.download = `${safe}.floorplan.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function importProjectFile(editor: Editor, doc: Doc, file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    let proj: Project;
    try { proj = JSON.parse(String(reader.result)) as Project; }
    catch { flash('檔案毀損或不是有效的 JSON'); return; }
    // accept both the current floors model and older single-list projects (doc.load → normalize migrates them)
    const ok = proj && typeof proj === 'object' &&
      (Array.isArray((proj as any).floors) || Array.isArray((proj as any).objects) || Array.isArray(proj.layers));
    if (!ok) { flash('這不是室內設計專案檔'); return; }
    doc.load(proj);
    $<HTMLInputElement>('#projectName').value = doc.project.name;
    editor.resetView();
    flash('已從檔案開啟，可繼續編輯');   // the change emit re-enters auto-save, persisting it to the backend
  };
  reader.onerror = () => flash('讀取檔案失敗');
  reader.readAsText(file);
}

// Collapsible 匯出 menu: its items are built only while open and removed on
// close (dynamic rendering — no idle DOM), keeping the topbar light.
function wireExportMenu(editor: Editor, doc: Doc) {
  const wrap = $('#exportMenu'), toggle = $('#exportToggle');
  // Icons are drawn, not typed, for the same reason the toggle's are: an emoji
  // is a font lookup that can miss. Two other things were wrong here and both
  // were the kind you stop seeing after a week — `匯出 PNG` and `匯出 PDF` had
  // no icon at all, so they sat 20px left of everything else, and 📐 was on
  // both `匯入 DXF` and `匯出施工圖 PDF`, which are not the same thing.
  const ic = (d: string, extra = '') =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
  const ICONS: Record<string, string> = {
    'import-dxf': ic('<path d="M12 21V10m0 0 4 4m-4-4-4 4"/><path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/>'),
    'export-project': ic('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>'),
    'export-png': ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3 16 5-4 4 3 3-2 6 5"/>'),
    'export-pdf': ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5"/><path d="M9 17h6"/>'),
    'plot-pdf': ic('<path d="M3 20 20 3v17z"/><path d="M13 15h3M9.5 18.5h3"/>'),
    'export-pano': ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>'),
    'export-report': ic('<path d="M3 21h18"/><rect x="5" y="11" width="4" height="7"/><rect x="10" y="6" width="4" height="12"/><rect x="15" y="14" width="4" height="4"/>'),
    'export-glb': ic('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  };
  // `匯入 DXF` used to live in here — an import, in a menu labelled 匯出.
  // It keeps its place in the list because that is where the muscle memory is,
  // but it is now under its own heading and separated, so the menu no longer
  // claims it is an export.
  const items: { label: string; act: string; group?: string }[] = [
    { label: '匯入 DXF 圖檔…', act: 'import-dxf', group: '匯入' },
    { label: '專案檔（可再編輯）', act: 'export-project', group: '匯出' },
    { label: 'PNG 影像', act: 'export-png' },
    { label: 'PDF（畫面快照）', act: 'export-pdf' },
    { label: '施工圖 PDF…', act: 'plot-pdf' },
    { label: '360 全景', act: 'export-pano' },
    { label: '面積報表（Excel）', act: 'export-report' },
    { label: '3D 模型', act: 'export-glb' },
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
      if (it.group) {
        const h = document.createElement('div'); h.className = 'menu-group'; h.textContent = it.group;
        pop.appendChild(h);
      }
      const b = document.createElement('button');
      // innerHTML, not textContent: the icon is markup. Both halves are literals
      // from ICONS and `items` above — nothing here comes from a plan or a file.
      b.innerHTML = (ICONS[it.act] ?? '') + `<span>${it.label}</span>`;
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
  // `:not(.furn-head)` — 家具面板的分類標題自己有處理器（要存摺疊狀態、要重跑
  // 篩選）。這一行是在 buildCatalog 之後跑的，少了排除條件就會把它整個蓋掉：
  // 外觀完全正常（class 照樣 toggle、CSS 照樣把下一個 div 收起來），只是狀態
  // 不再被記住、篩選也不再更新。是 bench/verify-palette.mjs 抓到的。
  document.querySelectorAll<HTMLElement>('.panel-title.collapsible:not(.furn-head)').forEach(h => {
    h.onclick = () => h.classList.toggle('collapsed');   // fold/unfold the section below
  });
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
    case 'save': doc.project.name = name(); markDirty(); await flushSave(doc); flash('已儲存'); break;
    case 'open': await openModal(editor, doc); break;
    case 'export-project': exportProjectFile(doc, name()); flash('已匯出專案檔（.floorplan.json）'); break;
    case 'import-project': $<HTMLInputElement>('#projectFileInput').click(); break;
    case 'import-dxf': $<HTMLInputElement>('#dxfInput').click(); break;
    case 'undo': doc.undo(); break;
    case 'redo': doc.redo(); break;
    case 'export-png': exportPNG(doc, name()); break;
    case 'export-pdf': exportPDF(doc, name()); break;
    case 'plot-pdf':
      if (!doc.project.floors.some(f => f.objects.some(o => o.kind !== 'image'))) { flash('尚無可出圖的內容'); break; }
      plotModal(doc, name());
      break;
    case 'export-report':
      // The report is built from the stored copy, so make sure what is on
      // screen has actually reached the database first.
      doc.project.name = name(); markDirty();
      if (!await flushSave(doc)) { flash('無法匯出報表 — 後端未連線'); break; }
      window.location.href = `/api/projects/${doc.project.id}/report.xlsx`;
      flash('已匯出面積報表 (.xlsx)');
      break;
    case 'export-pano':
      if (!doc.objects.length) { flash('尚無可拍攝的 3D 內容'); break; }
      flash('正在算全景…');
      // Yield so the message paints before the capture blocks the main thread.
      // setTimeout, not requestAnimationFrame: rAF is suspended while the tab is
      // in the background, which would hang the export instead of delaying it.
      await new Promise(r => setTimeout(r, 32));
      try { flash(editor.hooks.exportPano?.(name()) ?? ''); }
      catch (e) { console.error(e); flash('匯出全景失敗'); }
      break;
    case 'export-glb':
      if (!doc.objects.length) { flash('尚無可匯出的 3D 內容'); break; }
      try { await editor.hooks.export3d?.(name()); flash('已匯出 3D 模型 (.glb)'); }
      catch (e) { console.error(e); flash('匯出 3D 失敗'); }
      break;
    case 'import-image': $<HTMLInputElement>('#imageInput').click(); break;
    case 'shortcuts': $('#shortcutsModal').classList.remove('hidden'); break;
  }
}

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
