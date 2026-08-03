import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj, Project, ELECTRICAL } from '../model/types';
import { FURNITURE, FURNITURE_CATS } from '../data/furniture';
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
