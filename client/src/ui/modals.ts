import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj, layerForKind } from '../model/types';
import { plotPDF, chooseSheet, planAreaMM, projectExtent, SCALES, PaperId, Orientation } from '../core/plot';
import { listProjects, loadProject, deleteProject, inspectDxf, importDxf } from '../net/api';
import { flash } from './feedback';

// Every dialog the app puts up. They share only the .modal markup convention,
// but grouping them keeps ui.ts to wiring rather than markup.

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * DWG cannot be read here, and says so plainly.
 *
 * DWG is Autodesk's closed format. The one open implementation, LibreDWG, was
 * tested against this: it cannot read R2010 or R2018 at all, and an R2000 file
 * it did "convert" came back with every entity missing. An importer that
 * silently loses all the walls is worse than no importer, so this explains the
 * one-step conversion instead.
 */
export function dwgNotSupportedModal() {
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
export async function dxfImportModal(editor: Editor, doc: Doc, file: string) {
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
export function plotModal(doc: Doc, name: string) {
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

export async function openModal(editor: Editor, doc: Doc) {
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
