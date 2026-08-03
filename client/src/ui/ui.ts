import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj, Project, layerForKind, ELECTRICAL } from '../model/types';
import { FURNITURE, FURNITURE_CATS } from '../data/furniture';
import { ELECTRICAL_SYMBOLS } from '../data/electrical';
import { snap } from '../core/geometry';

import { exportPNG, exportPDF } from '../core/exporter';
import { plotPDF, chooseSheet, planAreaMM, projectExtent, SCALES, PaperId, Orientation } from '../core/plot';
import { listProjects, loadProject, deleteProject, inspectDxf, importDxf } from '../net/api';
import { flash } from './feedback';
import { flushSave, markDirty, scheduleAutosave, startAutosave } from './autosave';
import { scheduleReconcile } from './rooms-sync';
import { refreshProps } from './properties';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// 常用 = the everyday drawing tools, shown as the first catalog section.
const COMMON_TOOLS = [
  { name: 'select', ic: '✋', label: '平移' },   // 拖曳物件移動；拖曳空白處平移視角
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
  const items: { label: string; act: string }[] = [
    { label: '📐 匯入 DXF 圖檔…', act: 'import-dxf' },
    { label: '💾 匯出專案檔（可再編輯）', act: 'export-project' },
    { label: '匯出 PNG', act: 'export-png' },
    { label: '匯出 PDF（快照）', act: 'export-pdf' },
    { label: '📐 匯出施工圖 PDF…', act: 'plot-pdf' },
    { label: '🌐 匯出 360 全景', act: 'export-pano' },
    { label: '📊 匯出面積報表 (Excel)', act: 'export-report' },
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
  document.querySelectorAll<HTMLElement>('.panel-title.collapsible').forEach(h => {
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

/**
 * DWG cannot be read here, and says so plainly.
 *
 * DWG is Autodesk's closed format. The one open implementation, LibreDWG, was
 * tested against this: it cannot read R2010 or R2018 at all, and an R2000 file
 * it did "convert" came back with every entity missing. An importer that
 * silently loses all the walls is worse than no importer, so this explains the
 * one-step conversion instead.
 */
function dwgNotSupportedModal() {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="modal-box">
      <div class="modal-head"><span>DWG 需要先轉成 DXF</span><button data-x>✕</button></div>
      <div class="plot-form">
        <p class="plot-note">DWG 是 Autodesk 的封閉格式，沒有可靠的開源讀取方式，
          所以這裡只吃 <b>DXF</b>。轉檔是一步的事，任選一種：</p>
        <ul class="dwg-ways">
          <li><b>AutoCAD／BricsCAD</b>：開啟後「另存新檔」選 DXF</li>
          <li><b>ODA File Converter</b>（免費，Autodesk 官方格式聯盟出品）：批次 DWG → DXF</li>
          <li><b>FreeCAD / LibreCAD</b>（免費開源）：開啟後匯出成 DXF</li>
          <li>線上轉檔服務 —— 但圖面若涉及業主資料，別上傳</li>
        </ul>
        <p class="plot-note">存成 <b>R2010 或更早</b>的 DXF 相容性最好。</p>
        <div class="plot-actions"><button data-x2>知道了</button></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-x]')!.addEventListener('click', close);
  wrap.querySelector('[data-x2]')!.addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
}

// DXF import. Two stages, because a real architectural drawing carries dozens
// of layers and importing all of them yields hundreds of nonsense walls: the
// file is inspected first, then only the ticked layers are converted.
async function dxfImportModal(editor: Editor, doc: Doc, file: string) {
  flash('正在讀取 DXF…');
  const info = await inspectDxf(file);
  if ('error' in info) { flash('無法讀取這個 DXF 檔'); return; }
  if (!info.layers.length) { flash('這個 DXF 沒有可匯入的線段'); return; }

  const wrap = document.createElement('div');
  wrap.className = 'modal';
  const unitRow = ['mm', 'cm', 'm', 'in', 'ft']
    .map(u => `<option value="${u}"${u === info.unit ? ' selected' : ''}>${u}</option>`).join('');
  wrap.innerHTML = `
    <div class="modal-box">
      <div class="modal-head"><span>匯入 DXF（${info.dxfversion}）</span><button data-x>✕</button></div>
      <div class="plot-form">
        <label>單位 <select data-unit>${unitRow}</select></label>
        <p class="plot-note${info.unitGuessed ? ' warn' : ''}" data-note></p>
        <div class="dxf-layers" data-layers></div>
        <div class="plot-actions"><button data-go>匯入勾選圖層</button></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const sel = <T extends HTMLElement>(q: string) => wrap.querySelector(q) as T;
  const unitEl = sel<HTMLSelectElement>('[data-unit]');
  const host = sel<HTMLDivElement>('[data-layers]');
  const note = sel<HTMLParagraphElement>('[data-note]');
  const close = () => wrap.remove();

  for (const l of info.layers) {
    const row = document.createElement('label');
    row.className = 'dxf-layer';
    row.innerHTML = `<input type="checkbox" value="${l.layer}"${l.suggested ? ' checked' : ''}>
      <span class="lname">${l.layer || '(未命名)'}</span>
      <span class="lmeta">${l.segments} 段</span>`;
    host.appendChild(row);
  }

  // The plan's real-world size is the fastest way to spot a wrong unit: a
  // 6 m flat read as metres comes out 600 m across.
  const refresh = () => {
    const cm = { mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 }[unitEl.value] ?? 1;
    const w = info.extent.w * cm / 100, h = info.extent.h * cm / 100;
    note.textContent = `${info.unitGuessed ? '⚠ 檔案未標示單位，以下為推測 — ' : ''}`
      + `依此單位，圖面約 ${w.toFixed(1)} × ${h.toFixed(1)} m`;
  };
  unitEl.onchange = refresh;
  refresh();

  sel<HTMLButtonElement>('[data-x]').onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  sel<HTMLButtonElement>('[data-go]').onclick = async () => {
    const layers = [...host.querySelectorAll<HTMLInputElement>('input:checked')].map(i => i.value);
    if (!layers.length) { flash('請至少勾選一個圖層'); return; }
    close();
    flash('正在轉換…');
    const walls = await importDxf(file, layers, unitEl.value);
    if (!walls) { flash('匯入失敗 — 後端未連線'); return; }
    if (!walls.length) { flash('勾選的圖層裡沒有可用的線段'); return; }
    doc.commit();
    for (const w of walls) {
      doc.add({
        id: genId('wall'), kind: 'wall', layer: layerForKind('wall'),
        a: w.a, b: w.b, thickness: w.thickness, ...(w.bulge ? { bulge: w.bulge } : {}),
      } as Obj);
    }
    editor.selectTool('select');
    editor.resetView();
    flash(`已從 DXF 匯入 ${walls.length} 道牆`);
  };
}

// Scaled-plot dialog. Opens pre-filled with the scale/paper that fits the plan,
// so the common case is just pressing 匯出; the selects are there for overriding.
function plotModal(doc: Doc, name: string) {
  const extent = projectExtent(doc.project);
  const auto = chooseSheet(extent.w, extent.h);

  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="modal-box">
      <div class="modal-head"><span>匯出施工圖 PDF</span><button data-x>✕</button></div>
      <div class="plot-form">
        <label>比例 <select data-scale>${SCALES.map(s => `<option value="${s}"${s === auto.scale ? ' selected' : ''}>1:${s}</option>`).join('')}</select></label>
        <label>紙張 <select data-paper>${['A4', 'A3'].map(p => `<option value="${p}"${p === auto.paper ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>方向 <select data-orient>
          <option value="landscape"${auto.orientation === 'landscape' ? ' selected' : ''}>橫式</option>
          <option value="portrait"${auto.orientation === 'portrait' ? ' selected' : ''}>直式</option>
        </select></label>
        <p class="plot-note" data-note></p>
        <div class="plot-actions"><button data-go>匯出</button></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const sel = <T extends HTMLElement>(q: string) => wrap.querySelector(q) as T;
  const scaleEl = sel<HTMLSelectElement>('[data-scale]');
  const paperEl = sel<HTMLSelectElement>('[data-paper]');
  const orientEl = sel<HTMLSelectElement>('[data-orient]');
  const note = sel<HTMLParagraphElement>('[data-note]');
  const close = () => wrap.remove();

  // Live feedback on whether the plan actually fits the chosen sheet — the one
  // thing a user can get wrong here.
  const refresh = () => {
    const scale = +scaleEl.value;
    const area = planAreaMM(paperEl.value as PaperId, orientEl.value as Orientation);
    const needW = extent.w * 10 / scale, needH = extent.h * 10 / scale;
    const fits = needW <= area.w && needH <= area.h;
    const pages = doc.project.floors.length;
    note.textContent = fits
      ? `圖面 ${(extent.w / 100).toFixed(1)} × ${(extent.h / 100).toFixed(1)} m，可完整容納。共 ${pages} 頁（每樓層一頁）。`
      : `⚠ 裝不下：需要 ${needW.toFixed(0)} × ${needH.toFixed(0)} mm，可用 ${area.w.toFixed(0)} × ${area.h.toFixed(0)} mm。圖面會被裁切。`;
    note.classList.toggle('warn', !fits);
  };
  [scaleEl, paperEl, orientEl].forEach(e => e.onchange = refresh);
  refresh();

  sel<HTMLButtonElement>('[data-x]').onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  sel<HTMLButtonElement>('[data-go]').onclick = () => {
    plotPDF(doc, name, {
      scale: +scaleEl.value,
      paper: paperEl.value as PaperId,
      orientation: orientEl.value as Orientation,
    });
    close();
    flash('已匯出施工圖 PDF');
  };
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

async function openModal(editor: Editor, doc: Doc) {
  const modal = $('#modal'); const list = $('#projectList');
  list.innerHTML = '<div class="muted" style="padding:12px">載入中…</div>';
  modal.classList.remove('hidden');
  const projects = await listProjects();
  list.innerHTML = '';
  // import-from-file entry, always available (works even with no saved projects / offline)
  const imp = document.createElement('button');
  imp.className = 'import-file'; imp.textContent = '⭱ 從檔案匯入專案檔…';
  imp.onclick = () => { modal.classList.add('hidden'); $<HTMLInputElement>('#projectFileInput').click(); };
  list.appendChild(imp);
  if (!projects.length) { const m = document.createElement('div'); m.className = 'muted'; m.style.padding = '12px'; m.textContent = '尚無已儲存的專案'; list.appendChild(m); return; }
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
