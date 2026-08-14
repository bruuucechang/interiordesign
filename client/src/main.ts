import './style.css';
import { Doc } from './model/doc';
import { Editor } from './core/editor';
import { View3D } from './core/view3d';
import { PERF_ON } from './core/perf';
import { loadProject } from './net/api';
import { setSaveBaseline } from './ui/autosave';
import { notice } from './ui/feedback';
import { warmMaterial, onTexturesReady } from './core/textures3d';
import { loadFurnitureModel, onModelsReady } from './core/furniture3d';
import { floorMaterials, wallMaterials } from './core/materials';
import { FURNITURE } from './data/furniture';
import { bounds } from './core/hit';
import { FURNITURE_BY_ID } from './data/furniture';
import { fitOpeningToWall } from './tools/place';
import { initUI } from './ui/ui';
import { savePanorama, isInsidePlan } from './core/panorama';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLElement;
const pane2d = document.getElementById('pane2d') as HTMLElement;
const c3d = document.getElementById('view3d') as HTMLElement;
const viewModes = document.getElementById('viewModes') as HTMLElement;
const splitter = document.getElementById('splitter') as HTMLElement;
const wallRefBtns = document.getElementById('wallRef') as HTMLElement;
const stage = document.getElementById('stage') as HTMLElement;

const doc = new Doc();
const editor = new Editor(canvas, doc, hint);
initUI(editor, doc);

const view3d = new View3D(c3d);
// Place objects by clicking in the 3D view (when 3D is the main view): furniture
// drops on the floor point; a door/window snaps onto the wall under the cursor.
view3d.onFloorClick = (floor, sceneHit) => {
  if (mode === '2d') return;
  const t = editor.toolName;
  if (t === 'furniture') editor.placeFurnitureAt(floor.x, floor.y);
  else if (t === 'door' || t === 'window') editor.placeOpeningAt(t, sceneHit ?? floor);
};
view3d.onRotate90 = (deg) => editor.rotateSelection(deg);   // Q/E in 3D rotate the selected object 90°
editor.hooks.export3d = (name) => view3d.exportGLB(name);   // 匯出 3D → GLTFExporter

type Mode = '2d' | 'split' | '3d';
const MODE_KEY = 'interior_view_mode', SPLIT_KEY = 'interior_view_split';

/**
 * Which panes are on screen, and how wide the 2D one is in a split.
 *
 * Both are remembered. A designer who works split does so every time, and
 * having to re-drag the divider on every reload is the kind of small friction
 * that makes a tool feel borrowed.
 */
let mode: Mode = (localStorage.getItem(MODE_KEY) as Mode) || '2d';
let split = Number(localStorage.getItem(SPLIT_KEY)) || 55;   // 2D pane, percent

/**
 * Which pane the keyboard drives.
 *
 * Only meaningful in a split, where WASD means two different things: it pans
 * the plan and it flies the camera. Following the pointer is what every
 * multi-viewport CAD tool does, and it needs to be visible — hence the accent
 * outline, because a keypress that goes to the wrong pane looks like the key
 * did nothing.
 */
let focus: '2d' | '3d' = '2d';

// 匯出 360 全景：從 3D 相機所在位置拍。
//
// 在 2D 模式下按這個，拍到的是**原點**——3D 相機還停在建構時的 (0,0,0)，從來
// 沒有被定位過。那是平面圖的角落、地板高度，於是半個球在建築外面：實測產出的
// 是一張 4096×2048、除了一小塊地板以外全是天空的圖。而 (0,0,0) 落在平面範圍
// 內又低於天花板，所以座標檢查放行了。它擋得住「飛到室外」，擋不住「還沒進去過」。
editor.hooks.exportPano = (name) => {
  if (mode === '2d') {
    return '請先開啟 3D（分割或 3D 檢視）— 全景是從 3D 相機的位置拍的，還沒進去過就沒有位置可拍';
  }
  const pose = view3d.panoramaPose();
  const boxes = doc.objects.filter(o => o.kind !== 'image').map(bounds);
  if (!isInsidePlan(pose.position, boxes, doc.activeFloor.height)) {
    return '相機在室外 — 用 WASD 飛到室內再匯出';
  }
  savePanorama(view3d.capturePanorama(), pose.yaw, name);
  return '已匯出 360 全景（.jpg + 可直接開啟的 .html）';
};
let saved2D: { scale: number; origin: { x: number; y: number } } | null = null;

// Show/hide the 3D placement ghosts as tools change in 3D: furniture ghosts on
// the floor; a door/window ghost snaps onto the wall the cursor hovers.
function updatePlacementPreview() {
  const t = mode === '2d' ? '' : editor.toolName;
  const it = t === 'furniture' ? FURNITURE_BY_ID[editor.currentFurniture] : null;
  view3d.setPlacementPreview(it ? { id: it.id, w: it.w, h: it.h } : null);
  if (t === 'door' || t === 'window') {
    const kind = t, width = kind === 'door' ? 90 : 120;
    view3d.onHover = (floor, sceneHit) => {
      const pt = sceneHit ?? floor;
      const fit = pt ? fitOpeningToWall(doc, pt, width, kind === 'window', 200) : null;
      view3d.setOpeningGhost(fit ? { kind, x: fit.pos.x, y: fit.pos.y, angle: fit.angle, width: fit.width } : null);
    };
  } else {
    view3d.onHover = null;
    view3d.setOpeningGhost(null);
  }
}
const _prevToolChange = editor.hooks.toolChange;
editor.hooks.toolChange = (name) => { _prevToolChange?.(name); updatePlacementPreview(); };

// fit the whole plan into the (small) 2D pane — used when 2D is the PiP preview
function fit2D() {
  const vp = editor.vp;
  const objs = doc.objects;
  if (!objs.length) { vp.centerOn(0, 0, 800, 600); editor.render(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) { const b = bounds(o); minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
  const pad = 80, bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
  vp.scale = Math.max(0.02, Math.min(2, Math.min(vp.width / bw, vp.height / bh)));
  vp.origin = { x: (minX + maxX) / 2 - vp.width / 2 / vp.scale, y: (minY + maxY) / 2 - vp.height / 2 / vp.scale };
  editor.render();
}

function applyMode() {
  const show2d = mode !== '3d', show3d = mode !== '2d', both = mode === 'split';

  pane2d.classList.toggle('hidden-pane', !show2d);
  c3d.classList.toggle('hidden-pane', !show3d);
  splitter.classList.toggle('hidden-pane', !both);
  pane2d.classList.toggle('solo', show2d && !both);
  c3d.classList.toggle('solo', show3d && !both);
  stage.classList.toggle('solo-mode', !both);
  if (both) {
    pane2d.style.flexBasis = split + '%';
    c3d.style.flexBasis = (100 - split) + '%';
  } else {
    pane2d.style.flexBasis = '';
    c3d.style.flexBasis = '';
  }

  // In a solo view the one pane on screen has the keyboard by definition.
  if (!both) focus = show2d ? '2d' : '3d';
  applyFocus();

  for (const b of viewModes.querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode);
  }
  localStorage.setItem(MODE_KEY, mode);

  updatePlacementPreview();

  // One frame later: the panes have to be laid out before either view can be
  // told how big it is, and both read their element's size to do it.
  requestAnimationFrame(() => {
    if (show2d) {
      editor.vp.resize();
      if (saved2D) { editor.vp.scale = saved2D.scale; editor.vp.origin = { ...saved2D.origin }; saved2D = null; }
      else fit2D();
      editor.renderNow();
    } else if (!saved2D) {
      saved2D = { scale: editor.vp.scale, origin: { ...editor.vp.origin } };
    }
    if (show3d) {
      view3d.resize();
      view3d.build(doc, true);   // reframe for the new pane size
      view3d.start();
    } else {
      view3d.stop();             // nothing to draw into a pane that is not laid out
    }
  });
}

/**
 * Point the keyboard at one pane.
 *
 * `editor.inputEnabled` gates the plan's WASD panning and `view3d.setFly` gates
 * the camera's; both listen on the window, so leaving both on in a split makes
 * every W both pan the plan and fly the camera. The mouse needs no such rule —
 * pointer events already go to whichever pane is under the cursor.
 */
function applyFocus() {
  const on2d = focus === '2d';
  editor.inputEnabled = on2d;
  view3d.setFly(!on2d);
  pane2d.classList.toggle('focused', on2d && mode === 'split');
  c3d.classList.toggle('focused', !on2d && mode === 'split');
  // The unfocused pane in a split still composites — it is a full-size view, and
  // dropping ambient occlusion on it would make the image visibly change every
  // time the pointer crossed the divider.
  view3d.setBudget(mode === 'split' && on2d ? 'shared' : 'full');
}

// 畫牆基準線。空白鍵在畫的途中也能切，所以按鈕狀態由 editor 反向通知，
// 不是按鈕自己記著——兩份狀態遲早會不一致，而不一致的那一刻畫出來的牆
// 位置是錯的，畫面上卻看不出來。
function paintWallRef(r: string) {
  for (const b of wallRefBtns.querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.ref === r);
  }
}
editor.hooks.wallRef = paintWallRef;
for (const b of wallRefBtns.querySelectorAll('button')) {
  b.addEventListener('click', () => editor.setWallRef((b as HTMLElement).dataset.ref as any));
}
paintWallRef(editor.wallRef);

for (const b of viewModes.querySelectorAll('button')) {
  b.addEventListener('click', () => {
    const next = (b as HTMLElement).dataset.mode as Mode;
    if (next === mode) return;
    mode = next;
    applyMode();
  });
}

// Follow the pointer, but only in a split — in a solo view the answer is fixed
// and reacting to the pointer leaving the window would take the keyboard away.
for (const [el, which] of [[pane2d, '2d'], [c3d, '3d']] as const) {
  el.addEventListener('pointerenter', () => {
    if (mode !== 'split' || focus === which) return;
    focus = which;
    applyFocus();
  });
}

// ---- the divider ----
//
// Resizing is a live drag rather than a ghost line because both views have to
// be re-laid-out anyway; showing where it will land and then moving it there is
// two different pictures of the same thing.
splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  splitter.setPointerCapture(e.pointerId);
  splitter.classList.add('dragging');
  stage.classList.add('resizing');

  const move = (ev: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    // Clamped so a pane can never be dragged away entirely — a 0%-wide canvas
    // is a WebGL context with no drawing buffer, and it does not come back.
    split = Math.max(20, Math.min(80, ((ev.clientX - r.left) / r.width) * 100));
    pane2d.style.flexBasis = split + '%';
    c3d.style.flexBasis = (100 - split) + '%';
    editor.vp.resize(); editor.renderNow();
    view3d.resize();
  };
  const up = () => {
    splitter.classList.remove('dragging');
    stage.classList.remove('resizing');
    localStorage.setItem(SPLIT_KEY, String(Math.round(split)));
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

splitter.addEventListener('dblclick', () => {
  split = 50;
  applyMode();
  localStorage.setItem(SPLIT_KEY, '50');
});

const timeSel = document.getElementById('timeOfDay') as HTMLSelectElement;
timeSel.onchange = () => view3d.setTimeOfDay(timeSel.value as any);

// live sync: any plan change rebuilds the (always-present) 3D view; if 2D is the
// PiP, keep it fitted too
let rebuildTimer: number | undefined;
doc.onChange(() => {
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => { if (mode !== '2d') view3d.build(doc, false); }, 120);
});

window.addEventListener('resize', () => {
  if (mode !== '3d') { editor.vp.resize(); editor.render(); }
  if (mode !== '2d') view3d.resize();
});

requestAnimationFrame(() => { editor.vp.resize(); editor.render(); applyMode(); });

/**
 * Open a plan straight from the URL: `?plan=<id>`.
 *
 * Without it the only way in is the 開啟 dialog, which means a plan cannot be
 * linked to, bookmarked, or handed to someone — and on this machine, where the
 * browser window sits behind a full-screen terminal layout, "click 開啟 and
 * pick it from the list" is not a thing that can be done for you at all.
 *
 * A missing or unknown id is not an error: it leaves the blank plan up, the
 * same as opening the app normally. Silently opening nothing would be worse
 * than saying so, hence the message.
 */
async function openFromUrl() {
  const id = new URLSearchParams(location.search).get('plan');
  if (!id) return;
  const proj = await loadProject(id);
  if (!proj) { notice(`找不到方案「${id}」— 網址上的 plan 參數對不到任何一份存檔`); return; }
  doc.load(proj);
  const nameEl = document.getElementById('projectName') as HTMLInputElement | null;
  if (nameEl) nameEl.value = proj.name;
  setSaveBaseline(JSON.stringify(doc.serialize()));   // 剛載入的不算未存
  editor.resetView();
  editor.vp.resize();
  fit2D();
  if (mode !== '2d') { view3d.resize(); view3d.build(doc, true); }
}
void openFromUrl();

// With ?perf=1, hand the soak driver a way in. It needs to load a plan and read
// the 3D view without a backend, and reaching in through the DOM cannot do
// either. Gated on the same flag as the instrumentation, so a normal load
// exposes nothing.
/**
 * Pre-build the textures this plan actually uses, while nothing else is
 * happening.
 *
 * One material per idle callback rather than all of them in one: the point is
 * to move the cost off the moment the 3D view opens, and a single 500 ms block
 * of idle work would just move the stall to a different, less predictable
 * moment.
 */
function warmFinishes() {
  if (!('requestIdleCallback' in window)) return;
  const jobs: (() => void)[] = [];
  const seenFloor = new Set<string>(), seenWall = new Set<string>(), seenItem = new Set<string>();
  for (const o of doc.objects) {
    if (o.kind === 'room') {
      const id = o.floor ?? 'wood';
      if (!seenFloor.has(id)) { seenFloor.add(id); jobs.push(() => warmMaterial(id, 'floor')); }
    } else if (o.kind === 'wall' && !o.color) {
      const id = o.finish ?? 'paint';
      if (!seenWall.has(id)) { seenWall.add(id); jobs.push(() => warmMaterial(id, 'wall')); }
    } else if (o.kind === 'furniture') {
      if (!seenItem.has(o.item)) { seenItem.add(o.item); jobs.push(() => void loadFurnitureModel(o.item)); }
    }
  }
  const step = () => {
    const job = jobs.shift();
    if (!job) return;
    job();
    (window as any).requestIdleCallback(step, { timeout: 2000 });
  };
  (window as any).requestIdleCallback(step, { timeout: 2000 });
}
// A photographed material can land after the 3D view has already drawn the
// generated stand-in. Rebuilding is the only way the surfaces pick it up —
// materials were handed out per surface and each holds its own clone.
onTexturesReady(() => { if (mode !== '2d') view3d.build(doc, false); });
onModelsReady(() => { if (mode !== '2d') view3d.build(doc, false); });

doc.onChange(() => { clearTimeout(warmTimer); warmTimer = window.setTimeout(warmFinishes, 400); });
let warmTimer: number | undefined;
warmFinishes();

// `floorMaterials`/`wallMaterials` are here for bench/shot.mjs: it used to carry
// its own hardcoded list of ids, so every material added after it was written
// silently went unrendered — and the whole point of that harness is that a
// material is only verified by looking at it.
if (PERF_ON) (window as any).__app = { doc, editor, view3d, fit2D, warmFinishes, floorMaterials, wallMaterials, FURNITURE };
