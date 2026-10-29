import { Editor } from '../core/editor';
import { openFeelSettings } from './controls-settings';
import { Doc, genId } from '../model/doc';
import { Obj, Project } from '../model/schema';
import { ELECTRICAL } from '../model/catalogue';
import { FURNITURE, FURNITURE_CATS, FurnitureItem } from '../data/furniture';
import { ELECTRICAL_SYMBOLS } from '../data/electrical';
import { snap } from '../core/geometry';

import { exportPNG, exportPDF } from '../core/exporter';

import { flash } from './feedback';
import { askRoute, renderSteps } from './onboarding';
import { startTour, maybeNudgeTour, dismissTourNudge } from './tour';
import { openHelp, wireHelp } from './help';
import { toggleHealth, wireHealth, scheduleHealth, SHOW_FACESTEPS } from './health-panel';
import { toggleLighting, wireLighting } from './lighting-panel';
import { panelInsetRight } from './side-panels';
import { wireTopbarFit } from './topbar-fit';
import { t, setLang, currentLang, Lang } from '../core/i18n';
import { DEFAULTS, defaultNote } from '../model/locale-defaults';
import { flushSave, markDirty, scheduleAutosave, startAutosave, syncPlanUrl } from './autosave';
import { setConflictHandler, setNotYoursHandler } from '../net/api';
import { scheduleReconcile } from './rooms-sync';
import { wireStartCard } from './start-card';
import { refreshProps } from './properties';
import { ViewGroup, VIEW_GROUPS, isGroupShown, isShown, setGroupShown, onViewFilterChange, viewGroup } from '../core/viewFilter';
import { dwgNotSupportedModal, dxfImportModal, plotModal, openModal } from './modals';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// 結構 = the drawing tools, the first tab of the catalogue.
const STRUCTURE_TOOLS = [
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

  // ⌘S / ⌘O / ⌘N / ⌘P go through the same `handle()` as the toolbar buttons —
  // one implementation, so a shortcut can never drift from the button it mirrors.
  // 衝突要看得見，不能靜靜覆蓋。
  //
  // 兩個人開同一份圖時，後寫的原本直接蓋掉前一個人——而且兩邊都不會知道。現在
  // 伺服器會擋下來，這裡負責把它變成一個人看得懂、而且有得選的東西：你的版本還
  // 完整地留在本機，所以「另存新檔」永遠是安全出口。
  setConflictHandler((id, storedAtIso) => {
    const when = storedAtIso ? storedAtIso.replace('T', ' ').slice(0, 19) : t('剛剛');
    const keep = confirm(t('這份圖在別的地方被存過了（{when}）。\n\n直接存下去會蓋掉那一版。\n\n按「確定」另存成新的一份（兩版都保住），\n按「取消」先不存 — 你的改動仍在本機，什麼都不會弄丟。').replace('{when}', when));
    if (!keep) { flash(t('已暫停儲存 — 你的改動還在，重新載入可以看到別人的版本')); return; }
    const copy = doc.serialize();
    copy.id = genId('proj');
    copy.name = `${copy.name}${t('（我的版本）')}`;
    doc.load(copy);
    $<HTMLInputElement>('#projectName').value = copy.name;
    markDirty();
    void flushSave(doc);
    flash(t('已另存為新的一份，原本那一份沒有被動到'));
  });

  // 這份圖屬於別人。跟衝突走同一個原則：你的改動一直在本機，所以「另存新檔」永遠是
  // 安全出口，不會有「選錯就沒了」的分支。
  setNotYoursHandler(() => {
    const keep = confirm(t('這份平面圖屬於另一個使用者（或另一個瀏覽器）。\n\n你的改動沒有被存進去，但完整地留在這台機器上。\n\n按「確定」另存成你自己的一份，按「取消」先不存。'));
    if (!keep) { flash(t('已暫停儲存 — 你的改動還在本機')); return; }
    const copy = doc.serialize();
    copy.id = genId('proj');
    copy.name = `${copy.name}${t('（我的版本）')}`;
    doc.load(copy);
    $<HTMLInputElement>('#projectName').value = copy.name;
    markDirty();
    void flushSave(doc);
    flash(t('已另存為你自己的一份'));
  });

  editor.hooks.command = (name) => { void handle(name === 'plot' ? 'plot-pdf' : name, editor, doc); };
  editor.hooks.toolChange = (name) => { markActiveTool(name); $('#hint').dispatchEvent(new Event('toolchange')); };
  editor.onCalibrated = (msg, ok) => { flash(msg); if (ok) renderSteps(editor, doc); };
  editor.hooks.zoom = (pct) => { $('#zoomLabel').textContent = pct + '%'; };
  markActiveTool('select');

  doc.onChange(() => {
    buildFloors(editor, doc); buildLayers(editor, doc);
    // don't rebuild the property panel while the user is typing in one of its
    // fields (it would replace the focused input); the edit is already applied.
    if (!$('#properties').contains(document.activeElement)) refreshProps(editor, doc);
    scheduleAutosave(doc); scheduleReconcile(doc); updateUndoRedo(doc); scheduleHealth(editor, doc);
    renderSteps(editor, doc);   // 進度是從文件推出來的，不是記住的
  });
  wireStartCard(editor, doc);   // B24：空白這層的開場卡、有東西就收起導覽提示、第一間房拉近
  startAutosave(doc);
  updateUndoRedo(doc);
  const nameInput = $<HTMLInputElement>('#projectName');
  nameInput.value = doc.project.name;
  nameInput.addEventListener('input', () => { doc.project.name = nameInput.value || '未命名平面圖'; scheduleAutosave(doc); });
  // 1280 寬時名稱欄只剩幾個字，「A1 單元・照 11」看不出是哪份（U7）。滑鼠移上去的那一刻
  // 才補 title：名稱有六個地方直接寫 .value，那不會發任何事件，追著同步一定會漏一個。
  nameInput.addEventListener('mouseenter', () => { nameInput.title = nameInput.value; });

  // 語言切換。整頁重載而不是即時重繪：面板、教學、家具目錄的字串散在十幾個模組裡，
  // 而重載一定正確——這是「做對」比「做順」重要的地方，切換語言不是每分鐘會做的事。
  const langSel = $<HTMLSelectElement>('#langSel');
  langSel.value = currentLang();
  langSel.onchange = () => { setLang(langSel.value as Lang); location.reload(); };

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

  // First run on this machine: teach, once.
  //
  // After `initUI` has built the catalog, floors, layers and the property panel,
  // because every step points at one of them — starting earlier would drop the
  // steps whose anchors did not exist yet, which is the quiet failure mode of
  // anything that decorates the DOM.
  //
  // A frame's delay so the first paint is the app, not an overlay on top of a
  // blank one; somebody who has never seen this should see the tool before
  // being told about it.
  // The route question is asked once, at the end of that first tour — never on
  // 新建, and never again. From then on it lives in 使用說明.
  //
  // B20: it no longer opens by itself. The first time this machine sees an empty
  // plan, a small note in the bottom-right corner offers it; 說明 → 導覽 always can.
  // Two seconds' grace so a `?plan=` link has loaded before "is it empty" is asked.
  // 網址帶 ?plan= 的不是空白方案，不提示（載入可能超過兩秒）。
  if (!new URLSearchParams(location.search).has('plan')) setTimeout(() => maybeNudgeTour(doc, () => askRoute(editor, doc)), 2000);

  // The hint strip speaks only while a tool is working (or a message is up): the
  // select tool's resting text is what was on screen all day saying nothing new.
  const hintEl = $('#hint');
  const restingHint = hintEl.textContent;
  const syncHint = () => hintEl.classList.toggle('idle',
    !hintEl.textContent || (editor.toolName === 'select' && hintEl.textContent === restingHint));
  new MutationObserver(syncHint).observe(hintEl, { childList: true, characterData: true, subtree: true });
  hintEl.addEventListener('toolchange', syncHint);
  syncHint();

  const projFileInput = $<HTMLInputElement>('#projectFileInput');
  projFileInput.addEventListener('change', () => {
    const file = projFileInput.files?.[0]; if (!file) return;
    importProjectFile(editor, doc, file);
    projFileInput.value = '';   // allow re-importing the same file
  });
}

// ---- the catalogue: one row of categories, the second row opens on demand ----
//
// It was a left column with three hundred pictures stacked in it; finding a bed
// meant scrolling past four screens of sofas. Now it works the way a build mode
// does: the bottom row is the categories, and picking one opens a second row
// with that category's sub-groups and pictures — one category at a time.
//
// Every button is built once, up front, and only *moved* between the shelf and
// nowhere. The preview images and pictogram canvases are the expensive part, and
// switching tabs or typing in the search must not pay for them again.
//
// Search and the style filter stay independent of each other and of the tab:
// search looks through every piece of furniture whatever tab is open, the style
// filter narrows whatever is showing. If they gated each other an empty shelf
// would have three possible causes and the user would have to guess which.
interface ShelfGroup { label: string; els: HTMLElement[] }
interface Tab { id: string; label: string; icon: string; groups: ShelfGroup[]; extra?: HTMLElement; furniture: boolean }

const TAB_ICON: Record<string, string> = {
  select: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.3 15.6a1.6 1.6 0 0 1 2.4-2.1L8 15"/>',
  structure: '<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/>',
  room: '<path d="M4 18v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5M4 15h16M6 18v2M18 18v2M7 11V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3"/>',
  lights: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  stairs: '<path d="M3 21h5v-5h5v-5h5V6h3"/>',
};
const svg = (d: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

function buildCatalog(editor: Editor) {
  const bar = $('#catalog'), shelf = $('#catalogShelf');
  bar.innerHTML = ''; shelf.innerHTML = '';
  const LS_STYLE = 'furnStyle';
  const styleSel = new Set<string>(JSON.parse(localStorage.getItem(LS_STYLE) || '[]'));
  let query = '';
  let open: string | null = null;
  const sub = new Map<string, number>();          // which sub-group each tab shows (-1 = all)
  const itemOf = new Map<HTMLElement, FurnitureItem>();
  const nameOf = new Map<HTMLElement, string>();

  const clearPicked = () => {
    document.querySelectorAll('.furn-btn').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tool-btn').forEach(x => x.classList.remove('active'));
  };
  const furnButton = (item: FurnitureItem) => {
    const b = document.createElement('button');
    b.className = 'furn-btn'; b.dataset.furn = item.id; b.title = item.name;
    const cv = document.createElement('canvas');
    const maxW = 60, maxH = 46; const s = Math.min(maxW / item.w, maxH / item.h);
    cv.width = maxW; cv.height = maxH;
    const ctx = cv.getContext('2d')!;
    ctx.translate((maxW - item.w * s) / 2, (maxH - item.h * s) / 2); ctx.scale(s, s);
    item.draw(ctx, item.w, item.h);
    b.appendChild(cv);
    // The model's own preview picture where there is one: a top-down pictogram
    // cannot tell a 太師椅 from a 餐椅. Swapped in on load, so the drawn one is
    // the fallback and nothing is missing while it arrives. Items built in code
    // (`proc`) have no thumb.png, and asking anyway put 27 red 404s in the
    // console on every load. Not lazy: a lazy image in a hidden shelf never asks.
    if (!item.proc) {
      const img = new Image();
      img.alt = ''; img.decoding = 'async';
      img.src = new URL(`models/${item.id}/thumb.png`, document.baseURI).href;
      img.onload = () => { if (cv.parentNode === b) b.replaceChild(img, cv); };
    }
    const n = document.createElement('span'); n.className = 'fname'; n.textContent = item.name;
    b.appendChild(n);
    b.onclick = () => {
      editor.currentFurniture = item.id;
      editor.selectTool('furniture');
      clearPicked(); b.classList.add('active');
    };
    itemOf.set(b, item); nameOf.set(b, item.name);
    return b;
  };
  const elecButton = (spec: typeof ELECTRICAL[number]) => {
    const b = document.createElement('button');
    b.className = 'furn-btn'; b.dataset.elec = spec.id;
    b.title = `${spec.name}　${t('安裝高度')} ${spec.elevation} cm`;
    const cv = document.createElement('canvas');
    cv.width = 60; cv.height = 46;
    const ctx = cv.getContext('2d')!;
    ctx.translate(30, 28); ctx.scale(0.85, 0.85);
    ctx.strokeStyle = '#ffd166'; ctx.fillStyle = '#ffd166';
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    ELECTRICAL_SYMBOLS[spec.id](ctx);
    const n = document.createElement('span'); n.className = 'fname'; n.textContent = spec.name;
    b.append(cv, n);
    b.onclick = () => {
      editor.currentElectrical = spec.id;
      editor.selectTool('electrical');
      clearPicked(); b.classList.add('active');
    };
    nameOf.set(b, spec.name);
    return b;
  };
  const toolButton = (tool: typeof STRUCTURE_TOOLS[number]) => {
    const b = document.createElement('button');
    b.className = 'tool-btn'; b.dataset.tool = tool.name;
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = tool.ic;
    const n = document.createElement('span'); n.className = 'fname'; n.textContent = t(tool.label);
    b.append(ic, n);
    b.onclick = () => editor.selectTool(tool.name);
    return b;
  };

  // 牆基準 lives with the wall tools: it is a question about the wall you are
  // about to draw, and it is only worth looking at while drawing one.
  // The markup ships in index.html (main.ts wires its buttons before this runs);
  // it is only moved onto the shelf while 結構 is open.
  const wallRef = $('.wallref-box');
  wallRef.remove();

  const furnTab = (cat: string, label = cat, icon = TAB_ICON.room): Tab => ({
    id: cat, label, icon, furniture: true,
    groups: [{ label: cat, els: FURNITURE.filter(f => f.cat === cat).map(furnButton) }],
  });
  const ROOMS = FURNITURE_CATS.filter(c => c !== '燈具' && c !== '常用');
  const tabs: Tab[] = [
    { id: 'structure', label: '結構', icon: TAB_ICON.structure, furniture: false, extra: wallRef,
      groups: [{ label: '結構', els: STRUCTURE_TOOLS.map(toolButton) }] },
    ...ROOMS.map(c => furnTab(c)),
    { id: 'lights', label: '燈與電', icon: TAB_ICON.lights, furniture: true, groups: [
      { label: '燈具', els: FURNITURE.filter(f => f.cat === '燈具').map(furnButton) },
      ...['插座', '開關', '燈具'].map(c => ({
        label: c === '燈具' ? '燈位與排風' : c,
        els: ELECTRICAL.filter(e => e.cat === c).map(elecButton),
      })),
    ] },
    furnTab('常用', '樓梯', TAB_ICON.stairs),
  ].filter(tb => tb.groups.some(g => g.els.length));
  for (const tb of tabs) sub.set(tb.id, -1);

  const passes = (el: HTMLElement) => {
    const item = itemOf.get(el);
    if (styleSel.size && (!item || !item.style || !styleSel.has(item.style))) return false;
    if (!query) return true;
    const name = (nameOf.get(el) ?? '').toLowerCase();
    return name.includes(query) || !!item?.id.includes(query);
  };

  // first row
  const pick = document.createElement('button');
  pick.className = 'cat-tab tool-btn'; pick.dataset.tool = 'select';
  pick.innerHTML = `${svg(TAB_ICON.select)}<span>${t('選取')}</span>`;
  pick.title = t('選取與移動：拖曳物件移動，拖曳空白處平移畫面（Esc）');
  pick.onclick = () => editor.selectTool('select');
  // The tabs live in their own strip so a long language can never push the search
  // and style filter off the end: the strip first drops its icons (`.tight`,
  // measured), and past that it scrolls sideways rather than overflowing.
  const list = document.createElement('div'); list.className = 'cat-list';
  bar.append(list);
  list.append(pick, sep());
  const tabEls = new Map<string, HTMLButtonElement>();
  for (const tb of tabs) {
    if (tb.id === 'lights' || (tb.id === ROOMS[0])) list.appendChild(sep());
    const b = document.createElement('button');
    b.className = 'cat-tab'; b.dataset.cat = tb.id;
    b.innerHTML = `${svg(tb.icon)}<span>${t(tb.label)}</span>` + (tb.furniture ? '<span class="cat-n"></span>' : '');
    b.onclick = () => { if (query) { query = ''; search.value = ''; } open = open === tb.id ? null : tb.id; render(); };
    tabEls.set(tb.id, b); list.appendChild(b);
  }
  // 窄視窗、長語言時分類列會捲；捲軸藏起來了，所以直向滾輪轉成橫向（跟第二排一樣）。
  list.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { list.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  const fit = () => { bar.classList.remove('tight'); if (list.scrollWidth > list.clientWidth + 1) bar.classList.add('tight'); };
  new ResizeObserver(fit).observe(bar);
  void document.fonts?.ready.then(fit);
  const find = document.createElement('div'); find.className = 'cat-find';
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = t('搜尋家具…'); search.className = 'furn-search';
  search.setAttribute('aria-label', t('搜尋家具…'));
  const style = document.createElement('select'); style.className = 'style-select';
  style.title = t('風格'); style.setAttribute('aria-label', t('風格'));
  // 單選：使用者選第二個風格的意思幾乎一定是「改看這個」，不是「兩個都要」。
  for (const st of ['', '現代', '北歐', '日式', '古典', '鄉村', '工業', '中式']) {
    const o = document.createElement('option'); o.value = st; o.textContent = st ? t(st) : t('全部風格');
    style.appendChild(o);
  }
  style.value = [...styleSel][0] ?? '';
  style.onchange = () => { styleSel.clear(); if (style.value) styleSel.add(style.value); render(); };
  search.oninput = () => { query = search.value.trim().toLowerCase(); render(); };
  find.append(search, style);
  bar.appendChild(find);

  function sep() { const s = document.createElement('span'); s.className = 'cat-sep'; return s; }

  /** Second row: the open tab's sub-groups and pictures, or the search results. */
  function render() {
    localStorage.setItem(LS_STYLE, JSON.stringify([...styleSel]));
    style.classList.toggle('on', styleSel.size > 0);
    for (const tb of tabs) {
      const n = tabEls.get(tb.id)!.querySelector('.cat-n');
      if (n) n.textContent = String(tb.groups.reduce((k, g) => k + g.els.filter(e => !itemOf.has(e) || passes(e)).length, 0));
      tabEls.get(tb.id)!.classList.toggle('open', !query && open === tb.id);
    }
    if (!query && !open) { shelf.classList.add('hidden'); shelf.replaceChildren(); return; }
    shelf.classList.remove('hidden');
    const subs = document.createElement('div'); subs.className = 'cat-subs';
    const strip = document.createElement('div'); strip.className = 'cat-strip';
    // A vertical wheel scrolls the row sideways — the only direction it goes.
    strip.addEventListener('wheel', e => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    let shown: HTMLElement[] = [];
    if (query) {
      const all = tabs.filter(tb => tb.furniture).flatMap(tb => tb.groups.flatMap(g => g.els));
      shown = all.filter(passes);
      const h = document.createElement('span'); h.className = 'shelf-title';
      h.textContent = `${t('搜尋')}「${search.value.trim()}」 · ${shown.length} ${t('件')}`;
      subs.appendChild(h);
    } else {
      const tb = tabs.find(x => x.id === open)!;
      const k = sub.get(tb.id)!;
      if (tb.groups.length > 1) {
        const chip = (label: string, i: number) => {
          const c = document.createElement('button'); c.className = 'chip' + (k === i ? ' on' : '');
          c.textContent = t(label); c.onclick = () => { sub.set(tb.id, i); render(); };
          subs.appendChild(c);
        };
        chip('全部', -1);
        tb.groups.forEach((g, i) => chip(g.label, i));
      }
      shown = (k < 0 ? tb.groups : [tb.groups[k]]).flatMap(g => g.els).filter(e => !itemOf.has(e) || passes(e));
    }
    strip.append(...shown);
    if (!shown.length) {
      const e = document.createElement('div'); e.className = 'shelf-empty';
      e.textContent = styleSel.size
        ? t('這個風格沒有符合的家具 — 把風格換回「全部風格」看看')
        : t('沒有符合的家具 — 換個名字搜尋');
      strip.appendChild(e);
    }
    if (!query && open === 'structure') strip.appendChild(wallRef);
    // A row of sub-groups only where there is more than one; the open tab already names the shelf.
    if (subs.childElementCount) shelf.replaceChildren(subs, strip); else shelf.replaceChildren(strip);
  }
  render();
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

// ---- floors: small buttons in the bottom-right corner of the stage ----
function buildFloors(editor: Editor, doc: Doc) {
  const host = $('#floors'); host.innerHTML = '';
  for (const f of [...doc.floors].reverse()) {   // highest level on top
    const active = f.id === doc.project.activeFloorId;
    const b = document.createElement('button');
    b.className = 'floor-btn' + (active ? ' active' : '');
    b.dataset.floor = f.id;
    b.setAttribute('aria-pressed', String(active));
    b.append(document.createTextNode(f.name));
    b.title = `${f.name} · ${t('樓板高度')} ${(f.elevation / 100).toFixed(1)} m — ${t('點擊切換樓層，雙擊重新命名')}`;
    b.onclick = () => doc.setActiveFloor(f.id);
    b.ondblclick = () => { const n = prompt(t('樓層名稱'), f.name); if (n) doc.renameFloor(f.id, n); };
    if (active && doc.floors.length > 1) {
      const del = iconButton('close', t('刪除樓層'));
      del.className = 'floor-del';
      del.onclick = (e) => { e.stopPropagation(); if (confirm(`${t('刪除樓層')}「${f.name}」？`)) doc.removeFloor(f.id); };
      b.appendChild(del);
    }
    host.appendChild(b);
  }
  const add = document.createElement('button'); add.className = 'floor-btn floor-add';
  add.textContent = '＋'; add.title = t('新增樓層'); add.setAttribute('aria-label', t('新增樓層'));
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
  title = t(title);
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
    // 顏色不是唯一的編碼。
    //
    // 原本圖層只靠**文字顏色**區分，於是色覺不同的人拿到的是七行灰字；而深色底
    // 上的彩色細字本來就是對比最差的組合。改成名字用一般前景色、顏色另外給一個
    // 有邊框的色塊——顏色仍然在，但它不再是唯一在講話的東西。
    const swatch = document.createElement('span');
    swatch.className = 'layer-swatch';
    swatch.style.background = l.color;
    swatch.setAttribute('aria-hidden', 'true');
    // Translated at draw time, not at creation. A default layer shows in the
    // reader's language; one the user renamed is not in any dictionary, so `t`
    // hands it straight back and their name survives.
    const name = document.createElement('span'); name.className = 'name'; name.textContent = t(l.name);
    const up = iconButton('up', '往上一層'); up.onclick = () => doc.moveLayer(l.id, 1);
    const dn = iconButton('down', '往下一層'); dn.onclick = () => doc.moveLayer(l.id, -1);
    row.append(eye, lock, swatch, name, up, dn);
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
    catch { flash(t('檔案毀損或不是有效的 JSON')); return; }
    // accept both the current floors model and older single-list projects (doc.load → normalize migrates them)
    const ok = proj && typeof proj === 'object' &&
      (Array.isArray((proj as any).floors) || Array.isArray((proj as any).objects) || Array.isArray(proj.layers));
    if (!ok) { flash(t('這不是室內設計專案檔')); return; }
    doc.load(proj);
    $<HTMLInputElement>('#projectName').value = doc.project.name;
    syncPlanUrl(null);   // 還沒存進後端；第一次存檔成功時才補上
    editor.resetView();
    flash(t('已從檔案開啟，可繼續編輯'));   // the change emit re-enters auto-save, persisting it to the backend
  };
  reader.onerror = () => flash(t('讀取檔案失敗'));
  reader.readAsText(file);
}

// ---- the four top-bar menus (檔案／檢視／設定／說明) ----
//
// Static markup in index.html, opened by un-hiding the pop. Once one is open,
// sliding the pointer onto the next menu button opens that one instead — the
// way a desktop menu bar behaves. A pick closes it; the zoom buttons, the snap
// box and the language list do not, because you usually press zoom twice.
function wireMenus() {
  const menus = Array.from(document.querySelectorAll<HTMLElement>('#topbar .menu'));
  let current: HTMLElement | null = null;
  const parts = (m: HTMLElement) => ({
    btn: m.querySelector(':scope > .menu-btn') as HTMLElement,
    pop: m.querySelector(':scope > .menu-pop') as HTMLElement,
  });
  const close = () => {
    if (!current) return;
    const { btn, pop } = parts(current);
    current.classList.remove('open'); pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
    current = null;
  };
  const open = (m: HTMLElement) => {
    close();
    const { btn, pop } = parts(m);
    m.classList.add('open'); pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    current = m;
  };
  for (const m of menus) {
    const { btn, pop } = parts(m);
    btn.onclick = (e) => { e.stopPropagation(); current === m ? close() : open(m); };
    btn.addEventListener('mouseenter', () => { if (current && current !== m) open(m); });
    pop.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button[data-act]')) close(); });
  }
  document.addEventListener('pointerdown', (e) => { if (current && !current.contains(e.target as Node)) close(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) { close(); e.stopPropagation(); } }, true);
}

// 頂列「顯示」(B28): the ticks follow the stored setting; unticking drops what
// it hides from the selection, so nothing invisible is left to drag or delete.
// The redraw (2D and 3D) is main.ts's, on the same change.
function wireShowMenu(doc: Doc) {
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('#showMenu input[data-show]'));
  const sync = () => {
    for (const b of boxes) b.checked = isGroupShown(b.dataset.show as ViewGroup);
    $('#showMenu > .menu-btn').classList.toggle('filtered', boxes.some(b => !b.checked));
  };
  for (const b of boxes) b.onchange = () => setGroupShown(b.dataset.show as ViewGroup, b.checked);
  doc.selectable = isShown;
  // Placing, pasting or duplicating something that is hidden would add it unseen
  // (and selected); its group comes back on instead, and says so.
  doc.onAdd = (o) => {
    const g = viewGroup(o);
    if (!g || isGroupShown(g)) return;
    setGroupShown(g, true);
    flash(`${t('已重新顯示')}${t(VIEW_GROUPS.find(x => x.id === g)!.name)}`);
  };
  onViewFilterChange(() => {
    sync();
    const sel = doc.selectedObjects;
    if (sel.some(o => !isShown(o))) doc.selectMany(sel.filter(isShown).map(o => o.id));
  });
  sync();
}

// ---- the properties drawer ----
//
// Out only while there is something in it: a selection, the layers list (檢視 →
// 圖層), or — when nothing is selected — the underlay and wall-face controls the
// properties panel shows on its own. Those last two do not push the drawer out by
// themselves; a small handle at the top right says they are there.
let layersOpen = false;
let drawerPinned = false;
function syncDrawer(doc: Doc) {
  const right = $('#right'), props = $('#properties'), peek = $('#drawerPeek');
  const selected = doc.selectedIds.length > 0;
  // The wall-face list does not put a handle up (B27, it is reached from 空間健檢)
  // but still shows when the drawer has been asked out for it.
  const extras = !selected && Array.from(props.children).some(c => !c.classList.contains('muted') && !c.classList.contains('facesteps'));
  const faces = !selected && !!props.querySelector('.facesteps')?.children.length;
  if (!extras && !faces) drawerPinned = false;
  const showProps = selected || ((extras || faces) && drawerPinned);
  const isOpen = showProps || layersOpen;
  right.classList.toggle('closed', !isOpen);
  right.classList.toggle('only-layers', !showProps && layersOpen);
  $('#layersBox').classList.toggle('hidden', !layersOpen);
  document.body.classList.toggle('drawer-open', isOpen);
  document.querySelector('[data-act="layers"]')?.classList.toggle('active', layersOpen);
  peek.classList.toggle('hidden', isOpen || !extras);
  if (extras && !isOpen) {
    // The handle names what it opens — not the wall-face list, which 空間健檢 carries (B27).
    const names = Array.from(props.querySelectorAll('.panel-title, .facestep-head')).filter(e => !e.closest('.facesteps'))
      .map(e => (e.textContent ?? '').trim()).filter(Boolean);
    peek.textContent = `‹ ${names[0] ?? t('屬性')}`;
    peek.title = names.join('、');
  }
}
function wireDrawer(editor: Editor, doc: Doc) {
  const sync = () => syncDrawer(doc);
  new MutationObserver(sync).observe($('#properties'), { childList: true });
  $('#drawerPeek').onclick = () => { drawerPinned = true; sync(); };
  window.addEventListener(SHOW_FACESTEPS, () => { if (doc.selectedIds.length) doc.select(null); drawerPinned = true; sync(); });
  $('[data-act="close-drawer"]').onclick = () => {
    drawerPinned = false; layersOpen = false;
    if (doc.selectedIds.length) doc.select(null);
    sync();
  };
  $('[data-act="close-layers"]').onclick = () => { layersOpen = false; sync(); };
  // The light and health panels sit above the catalogue, whatever height it has.
  const bar = $('#catalogBar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--catalog-h', `${bar.offsetHeight}px`)).observe(bar);
  sync();
}

function wireTopbar(editor: Editor, doc: Doc) {
  document.querySelectorAll('#topbar [data-act]').forEach(btn => {
    (btn as HTMLElement).onclick = () => handle((btn as HTMLElement).dataset.act!, editor, doc);
  });
  wireMenus();
  wireShowMenu(doc);
  wireDrawer(editor, doc);
  wireHelp();
  wireHealth(editor, doc);
  wireLighting(editor, doc);
  wireTopbarFit();
  $('#zoomOut').onclick = () => editor.zoomBy(1 / 1.1);
  $('#zoomIn').onclick = () => editor.zoomBy(1.1);
  $('#zoomLabel').onclick = () => editor.resetView();
  $('#zoomFit').onclick = () => editor.fitAll(panelInsetRight($('#canvas')));
  const snap = $<HTMLInputElement>('#snapToggle');
  snap.onchange = () => editor.setSnap(snap.checked);
  $('[data-act="close-modal"]').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('[data-act="close-shortcuts"]').addEventListener('click', () => $('#shortcutsModal').classList.add('hidden'));
}

async function handle(act: string, editor: Editor, doc: Doc) {
  const name = () => $<HTMLInputElement>('#projectName').value || '未命名平面圖';
  switch (act) {
    case 'new':
      // A blank sheet, and nothing else. This used to follow the clear with the
      // 從底圖描／純手繪 dialog — you press 新建 because you want to draw, and
      // what arrives is a question. That, the checklist strip it turned on, and
      // a first-run tour that never recorded itself are the three things the
      // user meant by 「instruction 有時候會在奇怪時機跳出來」.
      //
      // The confirm stays: it guards against losing work, which is not the same
      // as teaching. The route choice moved into 使用說明 (the `?` button).
      if (!confirm(t('新建會清空目前畫布，確定？'))) return;
      doc.load(Doc.blank()); $<HTMLInputElement>('#projectName').value = doc.project.name; editor.resetView();
      syncPlanUrl(null);
      renderSteps(editor, doc);
      maybeNudgeTour(doc, () => askRoute(editor, doc));
      break;
    case 'save': {
      // `flushSave` returns whether the stored copy is now up to date, and this
      // used to throw that away and say 已儲存 either way. Exactly the failure
      // 9.2.1 exists to stop, through a different door — and the correct
      // pattern was already three lines below, in export-report.
      doc.project.name = name(); markDirty();
      flash(await flushSave(doc) ? t('已儲存') : t('存不上去 — 改動留在本機，連上線會自動送出'));
      break;
    }
    case 'open': await openModal(editor, doc); break;
    case 'export-project': exportProjectFile(doc, name()); flash(t('已匯出專案檔（.floorplan.json）')); break;
    case 'import-project': $<HTMLInputElement>('#projectFileInput').click(); break;
    case 'import-dxf': $<HTMLInputElement>('#dxfInput').click(); break;
    case 'undo': doc.undo(); break;
    case 'redo': doc.redo(); break;
    // These two said nothing at all, either way. A download that silently does
    // not happen is indistinguishable from one the browser put somewhere the
    // user has not looked yet.
    case 'export-png':
      try { exportPNG(doc, name()); flash(t('已匯出 PNG')); }
      catch (e) { console.error(e); flash(t('匯出 PNG 失敗')); }
      break;
    case 'export-pdf':
      try { exportPDF(doc, name()); flash(t('已匯出 PDF')); }
      catch (e) { console.error(e); flash(t('匯出 PDF 失敗')); }
      break;
    case 'plot-pdf':
      if (!doc.project.floors.some(f => f.objects.some(o => o.kind !== 'image'))) { flash(t('尚無可出圖的內容')); break; }
      plotModal(doc, name());
      break;
    case 'export-report':
      // The report is built from the stored copy, so make sure what is on
      // screen has actually reached the database first.
      doc.project.name = name(); markDirty();
      if (!await flushSave(doc)) { flash(t('無法匯出報表 — 後端未連線')); break; }
      // Ask for it before announcing it. `location.href` to an endpoint that
      // answers 422 leaves the user on the same page with a cheerful 已匯出 and
      // no file — and the backend does answer 422 here, on purpose, when it
      // cannot parse the stored plan.
      flash(t('正在產生報表…'));
      try {
        const r = await fetch(`/api/projects/${doc.project.id}/report.xlsx`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement('a');
        a.href = url; a.download = `${name() || 'report'}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        flash(t('已匯出面積報表 (.xlsx)'));
      } catch (e) {
        console.error(e);
        flash(t('報表產生失敗 — 後端無法解析這份存檔'));
      }
      break;
    case 'export-pano':
      if (!doc.objects.length) { flash(t('尚無可拍攝的 3D 內容')); break; }
      flash(t('正在算全景…'));
      // Yield so the message paints before the capture blocks the main thread.
      // setTimeout, not requestAnimationFrame: rAF is suspended while the tab is
      // in the background, which would hang the export instead of delaying it.
      await new Promise(r => setTimeout(r, 32));
      try { flash(editor.hooks.exportPano?.(name()) ?? ''); }
      catch (e) { console.error(e); flash(t('匯出全景失敗')); }
      break;
    case 'export-glb':
      if (!doc.objects.length) { flash(t('尚無可匯出的 3D 內容')); break; }
      try { await editor.hooks.export3d?.(name()); flash(t('已匯出 3D 模型 (.glb)')); }
      catch (e) { console.error(e); flash(t('匯出 3D 失敗')); }
      break;
    case 'import-image': $<HTMLInputElement>('#imageInput').click(); break;
    case 'health': toggleHealth(editor, doc); break;
    case 'lighting': toggleLighting(editor, doc); break;
    case 'help': openHelp(editor, doc); break;
    case 'tour': dismissTourNudge(); startTour(); break;
    case 'layers': layersOpen = !layersOpen; syncDrawer(doc); break;
    case 'fullscreen':
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => flash(t('這個瀏覽器不讓網頁進入全螢幕')));
      break;
    case 'shortcuts': $('#shortcutsModal').classList.remove('hidden'); break;
    case 'feel': openFeelSettings(); break;
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
    // Locked on arrival. Tracing means dragging across the image for minutes at
    // a time, and an unlocked underlay is picked up by the first drag that
    // starts a few pixels off a wall — after which every line traced since is
    // against a background that has moved. It used to arrive unlocked with a
    // note asking the user to remember to lock it.
    // Committed *before* the layer is touched, so locking the underlay and
    // placing the picture are one step: undoing an import that you did not mean
    // to make should not leave a locked layer behind for a second press.
    doc.commit();
    if (!doc.layer('underlay')) doc.project.layers.unshift({ id: 'underlay', name: '底圖', visible: true, locked: true, color: '#8b93a3' });
    else doc.setLayerLocked('underlay', true);
    const id = genId('img');
    doc.add({ id, kind: 'image', layer: 'underlay', x: cx - w / 2, y: cy - h / 2, w, h, src, opacity: 0.6 } as Obj);
    // **The size it came in at is a guess, not a measurement** — the longest
    // side was fitted to about 10 m. Go straight to calibration rather than
    // offering it: a plan traced at the guessed scale is self-consistent and
    // entirely wrong, and nothing later in the app will notice.
    doc.select(null);
    editor.selectTool('calibrate');
    flash(t('底圖已匯入並鎖定 — 接著沿圖上標有尺寸的一段拉一條線來校正比例'));
  };
  probe.src = src;
}
