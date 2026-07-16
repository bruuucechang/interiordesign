import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj, Vec, layerForKind } from '../model/types';
import { FURNITURE, FURNITURE_CATS } from '../data/furniture';
import { fmtLen, fmtArea, dist, polygonArea, polygonCentroid, pointInPolygon, pointInRect } from '../core/geometry';
import { detectRoomPolygons } from '../core/rooms';
import { exportPNG, exportPDF } from '../core/exporter';
import { listProjects, loadProject, saveProject, deleteProject } from '../net/api';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const TOOLS = [
  { name: 'select', ic: '⬚', label: '選取' },
  { name: 'wall', ic: '▬', label: '牆' },
  { name: 'room', ic: '▢', label: '房間' },
  { name: 'door', ic: '🚪', label: '門' },
  { name: 'window', ic: '🪟', label: '窗' },
  { name: 'dimension', ic: '↔', label: '尺寸' },
];

export function initUI(editor: Editor, doc: Doc) {
  buildTools(editor);
  buildFurniture(editor);
  buildLayers(editor, doc);
  refreshProps(editor, doc);
  wireTopbar(editor, doc);

  editor.hooks.toolChange = (name) => markActiveTool(name);
  editor.hooks.zoom = (pct) => { $('#zoomLabel').textContent = pct + '%'; };
  markActiveTool('select');

  doc.onChange(() => { buildLayers(editor, doc); refreshProps(editor, doc); scheduleAutosave(doc); scheduleReconcile(doc); });
  const nameInput = $<HTMLInputElement>('#projectName');
  nameInput.value = doc.project.name;
  nameInput.addEventListener('input', () => { doc.project.name = nameInput.value || '未命名平面圖'; scheduleAutosave(doc); });
}

// ---- tools palette ----
function buildTools(editor: Editor) {
  const host = $('#tools'); host.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool-btn'; b.dataset.tool = t.name;
    b.innerHTML = `<span class="ic">${t.ic}</span>${t.label}`;
    b.onclick = () => editor.selectTool(t.name);
    host.appendChild(b);
  }
}
function markActiveTool(name: string) {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tool === name));
  if (name !== 'furniture') document.querySelectorAll('.furn-btn').forEach(b => b.classList.remove('active'));
}

// ---- furniture palette ----
function buildFurniture(editor: Editor) {
  const host = $('#furniture'); host.innerHTML = '';
  for (const cat of FURNITURE_CATS) {
    const title = document.createElement('div');
    title.className = 'muted'; title.style.cssText = 'grid-column:1/3;font-size:11px;margin:4px 0 0;';
    title.textContent = cat; host.appendChild(title);
    for (const item of FURNITURE.filter(f => f.cat === cat)) {
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
      host.appendChild(b);
    }
  }
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
function refreshProps(editor: Editor, doc: Doc) {
  const host = $('#properties'); host.innerHTML = '';
  const o = doc.selected;
  if (!o) { host.innerHTML = '<div class="muted">未選取物件</div>'; return; }

  const num = (label: string, value: number, set: (v: number) => void, step = 1) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'number'; inp.value = String(Math.round(value)); inp.step = String(step);
    inp.addEventListener('focus', () => doc.commit());
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!isNaN(v)) set(v); });
    row.append(l, inp); host.appendChild(row);
  };
  const txt = (label: string, value: string, set: (v: string) => void) => {
    const row = document.createElement('div'); row.className = 'prop';
    const l = document.createElement('label'); l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = value;
    inp.addEventListener('focus', () => doc.commit());
    inp.addEventListener('input', () => set(inp.value));
    row.append(l, inp); host.appendChild(row);
  };
  const info = (label: string, value: string) => {
    const row = document.createElement('div'); row.className = 'prop';
    row.innerHTML = `<label>${label}</label><span>${value}</span>`; host.appendChild(row);
  };

  const up = (patch: Partial<Obj>) => doc.update(o.id, patch);
  info('類型', kindLabel(o.kind));
  switch (o.kind) {
    case 'furniture':
      info('名稱', o.label);
      num('寬 (cm)', o.w, v => up({ w: Math.max(5, v) } as any));
      num('高 (cm)', o.h, v => up({ h: Math.max(5, v) } as any));
      num('旋轉 (°)', o.angle, v => up({ angle: v } as any));
      num('X (cm)', o.x, v => up({ x: v } as any));
      num('Y (cm)', o.y, v => up({ y: v } as any));
      break;
    case 'room':
      txt('名稱', o.name, v => up({ name: v, auto: false } as any));   // renaming adopts an auto room as a normal one
      if (o.poly && o.poly.length >= 3) {
        info('面積', fmtArea(polygonArea(o.poly)));
      } else {
        num('寬 (cm)', o.w, v => up({ w: Math.max(10, v) } as any));
        num('高 (cm)', o.h, v => up({ h: Math.max(10, v) } as any));
        info('面積', fmtArea(o.w * o.h));
      }
      break;
    case 'wall':
      info('長度', fmtLen(dist(o.a, o.b)));
      num('厚度 (cm)', o.thickness, v => up({ thickness: Math.max(2, v) } as any));
      break;
    case 'door': case 'window':
      num('寬度 (cm)', o.width, v => up({ width: Math.max(10, v) } as any));
      num('角度 (°)', o.angle, v => up({ angle: v } as any));
      break;
    case 'dimension':
      info('長度', fmtLen(dist(o.a, o.b)));
      num('偏移 (cm)', o.offset, v => up({ offset: v } as any));
      break;
  }
  const del = document.createElement('button'); del.className = 'btn-danger'; del.textContent = '刪除物件';
  del.onclick = () => { doc.commit(); doc.remove(o.id); };
  host.appendChild(del);
}

function kindLabel(k: string) {
  return ({ wall: '牆', room: '房間', door: '門', window: '窗', furniture: '家具', dimension: '尺寸標註' } as Record<string, string>)[k] ?? k;
}

// ---- top bar ----
let autosaveTimer: number | undefined;
function scheduleAutosave(doc: Doc) {
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => saveProject(doc.serialize()), 800);
}

function wireTopbar(editor: Editor, doc: Doc) {
  document.querySelectorAll('#topbar [data-act]').forEach(btn => {
    (btn as HTMLElement).onclick = () => handle((btn as HTMLElement).dataset.act!, editor, doc);
  });
  const snap = $<HTMLInputElement>('#snapToggle');
  snap.onchange = () => editor.setSnap(snap.checked);
  $('[data-act="close-modal"]').addEventListener('click', () => $('#modal').classList.add('hidden'));
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
  }
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
