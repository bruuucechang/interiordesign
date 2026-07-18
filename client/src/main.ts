import './style.css';
import { Doc } from './model/doc';
import { Editor } from './core/editor';
import { View3D } from './core/view3d';
import { bounds } from './core/hit';
import { initUI } from './ui/ui';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLElement;
const pane2d = document.getElementById('pane2d') as HTMLElement;
const c3d = document.getElementById('view3d') as HTMLElement;
const btnToggle = document.getElementById('btnToggle') as HTMLButtonElement;
const stage = document.getElementById('stage') as HTMLElement;
const pipSlot = document.getElementById('pipSlot') as HTMLElement;

const doc = new Doc();
const editor = new Editor(canvas, doc, hint);
initUI(editor, doc);

const view3d = new View3D(c3d);
// Place furniture by clicking the floor in the 3D view (when 3D is the main
// view and a furniture item is the active tool). Openings/walls stay 2D.
view3d.onFloorClick = (p) => {
  if (mode !== '3d' || editor.toolName !== 'furniture') return;
  editor.placeFurnitureAt(p.x, p.y);
};
editor.hooks.export3d = (name) => view3d.exportGLB(name);   // 匯出 3D → GLTFExporter
let mode: '2d' | '3d' = '2d';
let saved2D: { scale: number; origin: { x: number; y: number } } | null = null;

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
  const twoFull = mode === '2d';
  const fullEl = twoFull ? pane2d : c3d;
  const pipEl = twoFull ? c3d : pane2d;
  if (fullEl.parentElement !== stage) stage.appendChild(fullEl);      // main view fills the stage
  if (pipEl.parentElement !== pipSlot) pipSlot.appendChild(pipEl);    // preview goes to the sidebar (above 圖層/屬性)
  pane2d.className = 'pane ' + (twoFull ? 'full' : 'pip');
  c3d.className = 'pane view3d ' + (twoFull ? 'pip' : 'full');
  btnToggle.textContent = twoFull ? '🧊 切換 3D 檢視' : '📐 切換 2D 檢視';
  editor.inputEnabled = twoFull;      // 2D main → edit + WASD pans the 2D view
  view3d.setFly(!twoFull);            // 3D main → WASD flies the 3D camera

  requestAnimationFrame(() => {
    if (twoFull) {
      editor.vp.resize();
      if (saved2D) { editor.vp.scale = saved2D.scale; editor.vp.origin = { ...saved2D.origin }; saved2D = null; }
      editor.render();
    } else {
      if (!saved2D) saved2D = { scale: editor.vp.scale, origin: { ...editor.vp.origin } };
      editor.vp.resize();
      fit2D();
    }
    view3d.resize();
    view3d.build(doc, true);   // reframe for the new pane size
    view3d.start();            // keep the 3D view live in both modes
  });
}

btnToggle.onclick = () => { mode = mode === '2d' ? '3d' : '2d'; applyMode(); };

const timeSel = document.getElementById('timeOfDay') as HTMLSelectElement;
timeSel.onchange = () => view3d.setTimeOfDay(timeSel.value as any);

// live sync: any plan change rebuilds the (always-present) 3D view; if 2D is the
// PiP, keep it fitted too
let rebuildTimer: number | undefined;
doc.onChange(() => {
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => { view3d.build(doc, false); if (mode === '3d') fit2D(); }, 120);
});

window.addEventListener('resize', () => { view3d.resize(); if (mode === '3d') fit2D(); });

requestAnimationFrame(() => { editor.vp.resize(); editor.render(); applyMode(); });
