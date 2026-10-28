// 照度：平面圖上的熱圖與等照度線，加一個側面板。
//
// 開這個面板＝開這個圖層：熱圖只在面板開著時畫，因為熱圖上的每一個顏色都要對著
// 面板上的色階與數字讀，單獨開著一張沒有圖例的熱圖只是一張漂亮的圖。
//
// 面板跟空間健檢一樣不擋畫布，但**放在屬性面板的左邊而不是蓋住它**：照度最常做
// 的事是選一盞燈、改流明、看數字變，三樣東西要同時在畫面上。
//
// 數字放在面板裡，不放在圖上（design-rules 5.1）。游標讀數也是。

import { Editor } from '../core/editor';
import { Doc } from '../model/doc';
import { t } from '../core/i18n';
import { PLANES, REFLECTANCE, luminaires, roomLuminaires } from '../core/lighting';
import { roomZones, zoneStat, litBy, combos, verdict, MAX_COMBO_CIRCUITS, type Verdict } from '../core/lightzones';
import { lightingFindings } from '../core/lightcheck';
import { ignoredFor, HEALTH_IGNORED } from './health-panel';
import { announcePanel, onOtherPanel } from './side-panels';
import type { LuxGrid } from '../core/lighting';
import { LitRoom, LightView, lightFloor, floorSignature, circuitsOf, circuitColor, heatPixels, contour, CONTOURS, LUX_STOPS, LUX_MAX, sample } from '../core/lightmap';
import { bounds } from '../core/hit';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;


type PlaneKey = keyof typeof PLANES;
type RhoKey = keyof typeof REFLECTANCE;
const PLANE_LABEL: Record<PlaneKey, string> = { desk: '桌面 75', bed: '床面 55', floor: '地面 0' };
const RHO_LABEL: Record<RhoKey, string> = { light: '淺色', medium: '中間', dark: '深色' };

/**
 * 看圖的設定存 localStorage、不進存檔：「我現在只開迴路 1 看看」是在看，不是在
 * 改這張圖。存的是**關掉的**迴路，所以新加的迴路預設是開的。
 */
/** 迴路勾選改了就喊一聲（detail＝關掉的迴路）：3D 的燈跟著開關。 */
export const CIRCUITS_EVENT = 'lighting-circuits';
/** 現在關掉的迴路。 */
export const circuitsOff = (): number[] => [...off];

const VIEW_KEY = 'interior_lighting_view';
interface Saved { plane: PlaneKey; rho: RhoKey; off: number[] }
function readView(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    return {
      plane: v.plane in PLANES ? v.plane : 'desk',
      rho: v.rho in REFLECTANCE ? v.rho : 'medium',
      off: Array.isArray(v.off) ? v.off.filter((n: unknown) => typeof n === 'number') : [],
    };
  } catch { return { plane: 'desk', rho: 'medium', off: [] }; }
}
function writeView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ plane, rho, off: [...off] })); } catch { /* 記不住不該擋住使用 */ }
}

let { plane, rho, off: offList } = readView();
let off = new Set<number>(offList);
let open = false;

/**
 * 格點：停著 5 cm、正在拖 8 cm，跟原型一樣。
 *
 * 「正在拖」是從文件變動推出來的：上一次**影響照度的**變動離現在不到 COARSE_MS 就用粗格點，
 * 並排一次 SETTLE_MS 後的重畫換回細格點。拖曳工具不用知道照度的存在。
 */
const FINE = 5, COARSE = 8, COARSE_MS = 150, SETTLE_MS = 220;
let lastChange = 0;
let lightSig = '';
const signature = (doc: Doc) => floorSignature(doc.objects, doc.activeFloor.height, view(FINE));
let settle: number | undefined;

const cache = new Map<string, LuxGrid>();
/** 每盞燈對每間房的直射光，照格距分開存：拖曳中的 8 cm 與停下來的 5 cm 不互相清掉。 */
const parts = new Map<number, Map<string, Float32Array>>();
let lit: LitRoom[] = [];
/** 最近一次真的有重算時花的毫秒數（全部命中快取的那幾幀不算）——bench 讀這個。 */
let lastComputeMs = 0;
let litSig = '';
let cursor: { x: number; y: number } | null = null;

function view(step: number): LightView {
  return { height: PLANES[plane], rho: REFLECTANCE[rho], on: onSet(), step };
}
function onSet(): Set<number> | null {
  return off.size ? new Set([...allCircuits].filter(c => !off.has(c))) : null;
}
let allCircuits: number[] = [];

function compute(doc: Doc): LitRoom[] {
  const ceiling = doc.activeFloor.height;
  allCircuits = circuitsOf(doc.objects, ceiling).map(c => c.circuit);
  const step = performance.now() - lastChange < COARSE_MS ? COARSE : FINE;
  const before = cache.size, keys = new Set(cache.keys());
  const t0 = performance.now();
  if (!parts.has(step)) parts.set(step, new Map());
  const out = lightFloor(doc.objects, ceiling, view(step), cache, parts.get(step));
  const ms = performance.now() - t0;
  // 有新的格點才算一次重算；全部命中快取的幀是 0.1 ms 的查表，量它沒有意義。
  if ([...cache.keys()].some(k => !keys.has(k)) || cache.size !== before) lastComputeMs = ms;
  return out;
}

// ---------------------------------------------------------------- 畫

const tiles = new Map<LuxGrid, HTMLCanvasElement>();

function heatTile(g: LuxGrid): HTMLCanvasElement {
  let cv = tiles.get(g);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = g.nx; cv.height = g.ny;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(g.nx, g.ny);
  img.data.set(heatPixels(g));
  c.putImageData(img, 0, 0);
  tiles.set(g, cv);
  return cv;
}

function drawHeat(editor: Editor, doc: Doc, ctx: CanvasRenderingContext2D) {
  lit = compute(doc);
  // 快取被換掉的格點，它的貼圖也跟著丟。
  const live = new Set(lit.map(r => r.grid));
  for (const g of tiles.keys()) if (!live.has(g)) tiles.delete(g);

  const line = 1 / editor.vp.scale;
  for (const r of lit) {
    const g = r.grid;
    ctx.save();
    // 每個格點是它周圍 step × step 的顏色，所以貼圖往左上退半格，再沿房間外框裁掉。
    ctx.beginPath();
    r.lr.poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath(); ctx.clip();
    ctx.globalAlpha = 0.92;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(heatTile(g), g.x0 - g.step / 2, g.y0 - g.step / 2, g.nx * g.step, g.ny * g.step);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#0e1218'; ctx.lineWidth = 1.2 * line; ctx.setLineDash([5 * line, 4 * line]);
    CONTOURS.forEach((lv, k) => {
      const seg = contour(g, lv);
      if (!seg.length) return;
      ctx.globalAlpha = [0.55, 0.7, 0.9][k];
      ctx.beginPath();
      for (let i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]); }
      ctx.stroke();
    });
    ctx.restore();
  }

  if (performance.now() - lastChange < COARSE_MS) {
    clearTimeout(settle);
    settle = window.setTimeout(() => editor.render(), SETTLE_MS);
  }
  // Everything the two lists print, so a rename, a resize or a light added in
  // a corridor (no room, but it still counts on its circuit) repaints them.
  const sig = lit.map(r => [r.room.id, r.room.name, r.area.toFixed(2), r.grid.avg.toFixed(2), r.lumens, r.lums.length].join(':')).join('|')
    + '#' + circuitsOf(doc.objects, doc.activeFloor.height).map(c => `${c.circuit}:${c.count}`).join(',');
  if (sig !== litSig) { litSig = sig; paintRooms(editor, doc); paintCircuits(editor, doc); scheduleAnalysis(editor, doc); }
  paintCursor();
}

// ---------------------------------------------------------------- 面板

const fmt = (n: number) => Math.round(n).toLocaleString();

function paintCircuits(editor: Editor, doc: Doc) {
  const host = $('#lightCircuits');
  host.innerHTML = '';
  const list = circuitsOf(doc.objects, doc.activeFloor.height);
  if (!list.length) {
    const m = document.createElement('div'); m.className = 'lp-muted';
    m.textContent = t('這層樓還沒有燈。從左邊「水電」的燈具放幾盞，熱圖就會出現。');
    host.appendChild(m);
    return;
  }
  for (const { circuit, count } of list) {
    const lab = document.createElement('label'); lab.className = 'lp-circ';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !off.has(circuit);
    cb.onchange = () => {
      if (cb.checked) off.delete(circuit); else off.add(circuit);
      lightSig = signature(doc);   // a view change, not an edit: keep the fine grid
      writeView(); editor.render();
      window.dispatchEvent(new CustomEvent(CIRCUITS_EVENT, { detail: [...off] }));
    };
    const chip = document.createElement('span'); chip.className = 'lp-chip'; chip.style.background = circuitColor(circuit);
    const txt = document.createElement('span'); txt.textContent = `${t('迴路')} ${circuit}（${count} ${t('盞')}）`;
    lab.append(cb, chip, txt);
    host.appendChild(lab);
  }
}

function card(v: string, l: string) {
  const d = document.createElement('div'); d.className = 'lp-stat';
  const a = document.createElement('b'); a.textContent = v;
  const b = document.createElement('span'); b.textContent = t(l);
  d.append(a, b);
  return d;
}

function paintRooms(editor: Editor, doc: Doc) {
  const host = $('#lightRooms');
  host.innerHTML = '';
  const rooms = lit.filter(r => r.grid.nx * r.grid.ny > 0);
  if (!rooms.length) {
    const m = document.createElement('div'); m.className = 'lp-muted';
    m.textContent = t('沒有房間可以算。照度是一間一間算的——牆圍起來、出現房間之後才有數字。');
    host.appendChild(m);
    return;
  }
  // 有燈的房間排前面；沒燈的房間只剩反射光是 0，一排零沒有資訊。
  rooms.sort((a, b) => (b.lums.length ? 1 : 0) - (a.lums.length ? 1 : 0));
  for (const r of rooms) {
    const g = r.grid;
    const box = document.createElement('div'); box.className = 'lp-room';
    const head = document.createElement('div'); head.className = 'lp-room-head';
    const name = document.createElement('b'); name.textContent = r.room.name || t('房間');
    const meta = document.createElement('span'); meta.textContent = `${r.area.toFixed(1)} m² · ${r.lums.length} ${t('盞')}`;
    head.append(name, meta);
    box.appendChild(head);
    if (!r.lums.length) {
      const m = document.createElement('div'); m.className = 'lp-muted'; m.textContent = t('沒有開著的燈照到這間。');
      box.appendChild(m);
    } else {
      const cards = document.createElement('div'); cards.className = 'lp-stats';
      cards.append(
        card(fmt(g.avg), '平均 lux'), card(fmt(g.min), '最暗'), card(fmt(g.max), '最亮'),
        card(g.avg ? g.uniformity.toFixed(2) : '–', '均勻度（暗÷平均）'),
        card(Math.round(g.p100 * 100) + '%', '面積 ≥ 100 lux'), card(Math.round(g.p300 * 100) + '%', '面積 ≥ 300 lux'),
        card(fmt(r.lumens), '開著的流明'), card(r.area ? (r.watts / r.area).toFixed(1) : '–', '每 m² 瓦數'),
      );
      box.appendChild(cards);
    }
    // 區域、開法比較、提醒：比卡片重，拖曳時沿用上一次的、停下來才重算（跟原型的 120 ms 一樣）。
    let more = analysis.get(r.room.id);
    if (!more) { more = document.createElement('div'); more.className = 'lp-more'; analysis.set(r.room.id, more); }
    box.appendChild(more);
    box.onclick = () => {
      const b = bounds(r.room);
      editor.vp.centerOn(b.x + b.w / 2, b.y + b.h / 2, b.w * 1.4, b.h * 1.4);
      editor.render();
    };
    host.appendChild(box);
  }
}

// ---------------------------------------------------------------- 區域與開法比較

/** 每個房間一塊，跨 paintRooms 保留，所以拖曳中重畫卡片時不會閃掉。 */
const analysis = new Map<string, HTMLElement>();
let analysisTimer: number | undefined;
const ANALYSIS_MS = 150;

function scheduleAnalysis(editor: Editor, doc: Doc) {
  clearTimeout(analysisTimer);
  analysisTimer = window.setTimeout(() => paintAnalysis(editor, doc), ANALYSIS_MS);
}

const PILL: Record<Verdict, string> = { ok: '夠', dim: '略暗', dark: '偏暗' };

function table(head: string[], rows: (string | Node)[][], cls = ''): HTMLTableElement {
  const tb = document.createElement('table'); tb.className = 'lp-tbl ' + cls;
  const hr = tb.createTHead().insertRow();
  for (const h of head) { const th = document.createElement('th'); th.textContent = t(h); hr.appendChild(th); }
  const body = tb.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const c of row) { const td = tr.insertCell(); if (typeof c === 'string') td.textContent = c; else td.appendChild(c); }
  }
  return tb;
}

function sec(text: string) {
  const d = document.createElement('div'); d.className = 'lp-sub'; d.textContent = t(text);
  return d;
}

function paintAnalysis(editor: Editor, doc: Doc) {
  if (!open) return;
  const ceiling = doc.activeFloor.height;
  const all = luminaires(doc.objects, ceiling);
  const v = view(FINE);
  const ignored = ignoredFor(doc.project.id);
  const findings = lightingFindings(doc.objects, ceiling).filter(f => !ignored.has(f.id));
  const live = new Set<string>();
  for (const r of lit) {
    live.add(r.room.id);
    const host = analysis.get(r.room.id);
    if (!host) continue;
    host.innerHTML = '';
    const roomLums = roomLuminaires(r.lr, all);
    if (!roomLums.length) continue;
    const zones = roomZones(r.lr, doc.objects, ceiling);

    // 區域：照現在的看法（開著的迴路、牆色），每一區用它自己的高度量。
    host.appendChild(sec('區域'));
    if (!zones.length) {
      const m = document.createElement('div'); m.className = 'lp-muted';
      m.textContent = t('房間裡沒有子區域、床、書桌、做到頂的櫃子或門，沒有區域可以分析。');
      host.appendChild(m);
    } else {
      const litNow = litBy(r.lr, r.lums, v.rho, r.near);
      const rows: (string | Node)[][] = [];
      const shown: typeof zones = [];
      for (const z of zones) {
        const st = zoneStat(r.lr, litNow, z);
        if (!st) continue;
        const pill = document.createElement('span'); const vd = verdict(st.avg, z.need);
        pill.className = 'lp-pill ' + vd; pill.textContent = t(PILL[vd]);
        rows.push([z.name, fmt(st.avg), fmt(st.min), `≥ ${z.need}`, pill]);
        shown.push(z);
      }
      const tb = table(['區域', '平均', '最暗', '建議', ''], rows, 'zones');
      tb.tBodies[0].querySelectorAll('tr').forEach((tr, i) => {
        tr.title = shown[i].tip;
        tr.onclick = (e) => { e.stopPropagation(); doc.selectMany([shown[i].target]); editor.render(); };
      });
      host.appendChild(tb);
    }

    // 開法比較：這間的每種迴路組合，桌面高度，不管面板上現在關了哪幾路。
    host.appendChild(sec('開法比較'));
    const rows = combos(r.lr, roomLums, zones, v.rho);
    if (!rows.length) {
      const m = document.createElement('div'); m.className = 'lp-muted';
      m.textContent = `${t('這間超過')} ${MAX_COMBO_CIRCUITS} ${t('個迴路，組合太多，不列表。')}`;
      host.appendChild(m);
    } else {
      const chips = (cs: number[]) => {
        const span = document.createElement('span'); span.className = 'lp-chips';
        for (const c of cs) {
          const ch = document.createElement('span'); ch.className = 'lp-chip'; ch.style.background = circuitColor(c);
          const n = document.createElement('span'); n.textContent = String(c);
          span.append(ch, n);
        }
        return span;
      };
      const opt = (n: number | null) => (n == null ? '–' : fmt(n));
      host.appendChild(table(['開哪幾路', '流明', '平均', '最暗', '床', '書桌'],
        rows.map(c => [chips(c.circuits), fmt(c.lumens), fmt(c.avg), fmt(c.min), opt(c.bed), opt(c.desk)]), 'combos'));
    }

    // 提醒：跟空間健檢同一份，只列這間的。
    const mine = new Set<string>([r.room.id, ...roomLums.map(L => L.id), ...zones.map(z => z.target)]);
    const fs = findings.filter(f => (f.room ? f.room === r.room.id : f.targets.some(id => mine.has(id))));
    host.appendChild(sec('提醒'));
    const ul = document.createElement('ul'); ul.className = 'lp-warns';
    if (!fs.length) {
      const li = document.createElement('li'); li.className = 'ok';
      li.textContent = t('沒有發現問題。');
      ul.appendChild(li);
    }
    for (const f of fs) {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = f.title;
      const d = document.createElement('span'); d.textContent = f.detail;
      li.append(b, d);
      li.onclick = (e) => { e.stopPropagation(); doc.selectMany(f.targets); editor.render(); };
      ul.appendChild(li);
    }
    host.appendChild(ul);
  }
  for (const id of [...analysis.keys()]) if (!live.has(id)) analysis.delete(id);
}

function paintCursor() {
  const el = document.getElementById('lightCursor');
  if (!el) return;
  if (!cursor) { el.textContent = t('把游標移到房間裡讀照度'); return; }
  for (const r of lit) {
    const v = sample(r.grid, cursor.x, cursor.y);
    if (!Number.isNaN(v)) { el.textContent = `${t('游標處')} ${fmt(v)} lux · ${r.room.name || t('房間')}`; return; }
  }
  el.textContent = t('游標不在任何房間裡');
}

function paintControls(editor: Editor, doc: Doc) {
  const seg = (host: HTMLElement, keys: string[], labels: Record<string, string>, cur: string, set: (k: string) => void) => {
    host.innerHTML = '';
    for (const k of keys) {
      const b = document.createElement('button'); b.className = 'mat-btn' + (k === cur ? ' active' : '');
      b.textContent = t(labels[k]);
      b.onclick = () => {
        set(k); writeView();
        lightSig = signature(doc);
        host.querySelectorAll('.mat-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
        editor.render();
      };
      host.appendChild(b);
    }
  };
  seg($('#lightPlane'), Object.keys(PLANES), PLANE_LABEL, plane, k => { plane = k as PlaneKey; });
  seg($('#lightRho'), Object.keys(REFLECTANCE), RHO_LABEL, rho, k => { rho = k as RhoKey; });

  const bar = $('#lightScale');
  bar.style.background = 'linear-gradient(90deg,' + LUX_STOPS.map(([l, h]) => `${h} ${l / LUX_MAX * 100}%`).join(',') + ')';
  const ticks = $('#lightTicks');
  ticks.innerHTML = '';
  for (const l of [0, 100, 200, 300, 450, 700]) {
    const s = document.createElement('span'); s.style.left = `${l / LUX_MAX * 100}%`; s.textContent = String(l);
    ticks.appendChild(s);
  }
}

// ---------------------------------------------------------------- 開關

function show(editor: Editor, doc: Doc) {
  open = true;
  litSig = '\u0000';   // never a real signature: an empty plan also signs as ''
  lightSig = signature(doc);
  editor.heat = (ctx) => drawHeat(editor, doc, ctx);
  paintControls(editor, doc);
  $('#lightPanel').classList.remove('hidden');
  $('[data-act="lighting"]').classList.add('active');
  announcePanel('lighting');
  editor.render();
}

function hide(editor: Editor) {
  open = false;
  editor.heat = undefined;
  cache.clear(); tiles.clear(); lit = [];
  clearTimeout(analysisTimer); analysis.clear();
  $('#lightPanel').classList.add('hidden');
  $('[data-act="lighting"]').classList.remove('active');
  editor.render();
}

export function toggleLighting(editor: Editor, doc: Doc) {
  if (open) hide(editor); else show(editor, doc);
}

export function wireLighting(editor: Editor, doc: Doc) {
  $('[data-act="close-lighting"]').addEventListener('click', () => hide(editor));
  $('[data-act="draw-area"]').addEventListener('click', () => editor.selectTool('area'));
  onOtherPanel('lighting', () => { if (open) hide(editor); });
  // Only a change that moves the light counts as "dragging": selecting a lamp
  // to edit it also fires onChange, and dropping to the coarse grid for that
  // made the whole map visibly blur on every click.
  doc.onChange(() => {
    if (!open) return;
    // 區域、提醒也看床、書桌、門這些不影響格點的東西；它們動了格點命中快取、卡片的
    // 簽章不變，所以這裡每次都排一次（防抖擋住拖曳中的連續觸發）。
    scheduleAnalysis(editor, doc);
    const next = signature(doc);
    if (next !== lightSig) { lightSig = next; lastChange = performance.now(); }
  });
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  canvas.addEventListener('pointermove', (e) => {
    if (!open) return;
    const r = canvas.getBoundingClientRect();
    cursor = editor.vp.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    paintCursor();
  });
  // 在空間健檢按「忽略」，這裡的提醒也要少一條。
  window.addEventListener(HEALTH_IGNORED, () => { if (open) scheduleAnalysis(editor, doc); });
  canvas.addEventListener('pointerleave', () => { cursor = null; if (open) paintCursor(); });
}

/** bench/verify-lighting.mjs 從這裡讀。 */
export const lightingProbe = {
  get open() { return open; },
  get rooms() { return lit.map(r => ({ id: r.room.id, avg: r.grid.avg, min: r.grid.min, max: r.grid.max, step: r.grid.step, lums: r.lums.length })); },
  get ms() { return lastComputeMs; },
  at(x: number, y: number) {
    for (const r of lit) { const v = sample(r.grid, x, y); if (!Number.isNaN(v)) return v; }
    return NaN;
  },
  peak(id: string) {
    const r = lit.find(x => x.room.id === id);
    if (!r) return null;
    const g = r.grid;
    let best = -1, at = 0;
    for (let k = 0; k < g.v.length; k++) if (g.v[k] > best) { best = g.v[k]; at = k; }
    return { x: g.x0 + (at % g.nx) * g.step, y: g.y0 + Math.floor(at / g.nx) * g.step, lux: best };
  },
};
