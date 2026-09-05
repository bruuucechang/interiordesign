import { Editor } from '../core/editor';
import { Doc, genId } from '../model/doc';
import { Obj } from '../model/schema';
import { layerForKind } from '../model/catalogue';
import { plotPDF, chooseSheet, planAreaMM, projectExtent, SCALES, PaperId, Orientation } from '../core/plot';
import { listProjects, loadProject, deleteProject, listDeleted, restoreProject, inspectDxf, importDxf } from '../net/api';
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
  // `⭱` (U+2B71) rendered as a stack of horizontal bars — the same wrong-glyph
  // fallback its neighbour `⭳` (U+2B73) got on the export button. Same block,
  // same missing coverage; drawn instead.
  imp.className = 'import-file';
  imp.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 16V5m0 0 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>'
    + '<span>從檔案匯入專案檔…</span>';
  imp.onclick = () => { modal.classList.add('hidden'); $<HTMLInputElement>('#projectFileInput').click(); };
  list.appendChild(imp);
  if (!projects.length) { const m = document.createElement('div'); m.className = 'muted'; m.style.padding = '12px'; m.textContent = '尚無已儲存的專案'; list.appendChild(m); return; }

  // 219 plans in one flat list is 9,300px of scrolling in a 611px box — fifteen
  // screens to find one drawing, and most of the names are `s`, `m`, `c` from
  // testing. A substring match on the name plus date buckets turns that into
  // two keystrokes. Both are cheap and neither hides anything: an empty query
  // shows every row, in the order the server returned them.
  const rows: { meta: typeof projects[number]; el: HTMLElement; hay: string }[] = [];

  const search = document.createElement('input');
  search.type = 'search'; search.className = 'proj-search'; search.placeholder = '搜尋專案名稱…';
  search.autocomplete = 'off';
  const count = document.createElement('div'); count.className = 'proj-count';
  list.append(search, count);

  // Buckets by day rather than a formatted date on every row: what you want
  // when reopening is almost always "the one I had this morning".
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const bucketOf = (iso?: string): string => {
    if (!iso) return '尚未上傳';
    // `updatedAt` is the database's local time with no zone marker (see the
    // note in CLAUDE.md) — fine to bucket by, never to compare across zones.
    const t = Date.parse(iso.replace(' ', 'T'));
    if (Number.isNaN(t)) return '尚未上傳';
    const days = Math.round((today - startOfDay(new Date(t))) / 86400000);
    return days <= 0 ? '今天' : days === 1 ? '昨天' : days <= 7 ? '這一週' : days <= 30 ? '這個月' : '更早';
  };
  const ORDER = ['尚未上傳', '今天', '昨天', '這一週', '這個月', '更早'];
  const heads = new Map<string, HTMLElement>();
  for (const name of ORDER) {
    const h = document.createElement('div'); h.className = 'proj-group'; h.textContent = name;
    heads.set(name, h); list.appendChild(h);
    for (const p of projects.filter(q => bucketOf(q.updatedAt) === name)) {
      const row = document.createElement('div'); row.className = 'project-row';
      // textContent, not innerHTML: the name is whatever was typed into the
      // project field and it used to be interpolated into a template string.
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = p.name;
      const dt = document.createElement('span'); dt.className = 'pdate'; dt.textContent = p.updatedAt ?? '';
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '刪除';
      del.onclick = async (e) => {
        e.stopPropagation();
        // Say what is about to go. Sixteen rows shared one name until today, and
        // the only thing separating them was content — so the confirm has to
        // carry the content, not just the name again.
        const full = await loadProject(p.id);
        const n = full ? (full.floors ?? []).reduce((a, f) => a + (f.objects?.length ?? 0), 0) : null;
        const detail = n === null ? '' : `\n\n這份有 ${n} 個物件，上次編輯 ${p.updatedAt ?? '不明'}。`;
        if (!confirm(`把「${p.name}」移到回收桶？${detail}\n\n30 天內都可以從「回收桶」還原。`)) return;
        await deleteProject(p.id); row.remove(); apply();
      };
      row.append(nm, dt, del);
      row.onclick = async () => {
        const proj = await loadProject(p.id);
        if (proj) { doc.load(proj); $<HTMLInputElement>('#projectName').value = proj.name; editor.resetView(); }
        modal.classList.add('hidden');
      };
      list.appendChild(row);
      rows.push({ meta: p, el: row, hay: (p.name ?? '').toLowerCase() });
    }
  }

  function apply() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const hit = !q || r.hay.includes(q);
      r.el.style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    // A heading with nothing under it reads as an empty category rather than as
    // a category that this search did not match.
    for (const [name, h] of heads) {
      const any = rows.some(r => r.el.style.display !== 'none' && bucketOf(r.meta.updatedAt) === name);
      h.style.display = any ? '' : 'none';
    }
    count.textContent = q ? `符合 ${shown} / ${rows.length}` : `共 ${rows.length} 份`;
  }
  search.oninput = apply;
  apply();
  search.focus();

  await renderBin(editor, doc, list, modal);
}

/**
 * The bin, at the bottom of the open dialog.
 *
 * Not a separate screen: a recycle bin nobody finds is the same as not having
 * one, and the moment somebody needs it is the moment they are already in this
 * dialog looking for the thing they cannot see.
 */
async function renderBin(editor: Editor, doc: Doc, list: HTMLElement, modal: HTMLElement) {
  const binned = await listDeleted();
  if (!binned.length) return;

  const head = document.createElement('div');
  head.className = 'proj-group'; head.style.marginTop = '14px';
  head.textContent = `回收桶（${binned.length}）· 30 天後自動清除`;
  list.appendChild(head);

  for (const p of binned) {
    const row = document.createElement('div'); row.className = 'project-row binned';
    const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = p.name;
    const dt = document.createElement('span'); dt.className = 'pdate';
    dt.textContent = p.deletedAtIso ? `刪除於 ${p.deletedAtIso.slice(0, 10)}` : '已刪除';
    const back = document.createElement('button'); back.className = 'restore'; back.textContent = '還原';
    back.onclick = async (e) => {
      e.stopPropagation();
      if (await restoreProject(p.id)) { modal.classList.add('hidden'); await openModal(editor, doc); }
      else flash('還原失敗 — 伺服器沒有回應');
    };
    row.append(nm, dt, back);
    list.appendChild(row);
  }
}
