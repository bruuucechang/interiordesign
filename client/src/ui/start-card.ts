// What an empty floor says, and what happens when its first room closes (B24).
//
// An empty plan used to be a dark grid and nothing else: the tools are along the
// bottom, the import is in a menu, and neither is where somebody looking at a
// blank sheet is looking. So the middle of the plan offers the two ways in —
// draw a wall, or bring in a photo of a floor plan to trace — and goes away the
// moment the floor has anything on it. Worked out from the document every time,
// never remembered: undo back to nothing and it comes back.
//
// The same listener answers the first-run note (B20) the moment the plan has
// something in it, and frames the first room a floor gets (core/firstRoomView).

import { Editor } from '../core/editor';
import { Doc } from '../model/doc';
import { Obj } from '../model/schema';
import { t } from '../core/i18n';
import { firstRoomView } from '../core/firstRoomView';
import { retireTourNudge } from './tour';
import { Vec } from '../model/schema';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function card(editor: Editor): HTMLElement {
  const box = document.createElement('div');
  box.id = 'startCard'; box.className = 'start-card';
  const h = document.createElement('b'); h.textContent = t('從這裡開始');
  const p = document.createElement('p'); p.textContent = t('先畫出房子的牆，或匯入平面圖照片照著描。');
  const acts = document.createElement('div'); acts.className = 'acts';
  const wall = document.createElement('button'); wall.className = 'primary'; wall.dataset.start = 'wall';
  wall.textContent = t('畫牆');
  wall.onclick = () => {
    // Open 結構 as well, so the tool now in hand is shown lit where it lives.
    const tab = document.querySelector<HTMLButtonElement>('[data-cat="structure"]');
    if (tab && !tab.classList.contains('open')) tab.click();
    editor.selectTool('wall');
  };
  const photo = document.createElement('button'); photo.dataset.start = 'photo';
  photo.textContent = t('匯入平面圖照片');
  photo.onclick = () => $<HTMLInputElement>('#imageInput').click();   // 檔案 → 匯入 → 底圖
  acts.append(wall, photo);
  box.append(h, p, acts);
  // The card sits on the plan: a wheel or pinch over it zooms the plan, as it
  // would anywhere else on it, instead of doing nothing (or zooming the page).
  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    document.getElementById('canvas')?.dispatchEvent(new WheelEvent('wheel', e));
  }, { passive: false });
  return box;
}

/** Show or drop the card to match the floor; also fades it while a tool is in hand. */
export function syncStartCard(editor: Editor, doc: Doc) {
  const pane = $('#pane2d');
  let box = document.getElementById('startCard');
  if (doc.objects.length) { box?.remove(); return; }
  if (!box) { box = card(editor); pane.appendChild(box); }
  // While drawing, the card sits right where the first click usually goes;
  // it stays visible but lets the click through to the plan.
  box.classList.toggle('passive', editor.toolName !== 'select');
}

const roomBox = (o: Extract<Obj, { kind: 'room' }>) => {
  if (o.poly && o.poly.length >= 3) {
    const xs = o.poly.map(p => p.x), ys = o.poly.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
};

/** Ease the 2D view to `to` over ~400 ms. */
function easeTo(editor: Editor, to: { scale: number; x: number; y: number }) {
  const vp = editor.vp;
  const from = { scale: vp.scale, x: vp.origin.x, y: vp.origin.y };
  // Interpolate the centre and the log of the scale, so the zoom feels even.
  const cx = (s: typeof from) => s.x + vp.width / 2 / s.scale, cy = (s: typeof from) => s.y + vp.height / 2 / s.scale;
  const c0 = { x: cx(from), y: cy(from) }, c1 = { x: cx(to), y: cy(to) };
  const t0 = performance.now(), dur = 400;
  let last = { scale: vp.scale, x: vp.origin.x, y: vp.origin.y };
  const step = (now: number) => {
    // Somebody else moved the view since the last frame (wheel, drag, fit):
    // theirs wins, the easing stops where it is.
    if (vp.scale !== last.scale || vp.origin.x !== last.x || vp.origin.y !== last.y) return;
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e);
    const c = { x: c0.x + (c1.x - c0.x) * e, y: c0.y + (c1.y - c0.y) * e };
    vp.scale = scale;
    vp.origin.x = c.x - vp.width / 2 / scale;
    vp.origin.y = c.y - vp.height / 2 / scale;
    last = { scale, x: vp.origin.x, y: vp.origin.y };
    editor.hooks.zoom?.(Math.round(scale / 0.4 * 100));
    editor.renderNow();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Is this the room the walls were drawn to close? Every wall and partition end
 * on the floor lies on or just outside it. A DXF import or a paste brings a
 * whole flat at once and its first detected room is one of many — framing that
 * one would push the rest of the building off screen (B24 review).
 */
function onlyRoomDrawn(doc: Doc, box: { x: number; y: number; w: number; h: number }) {
  const m = 50;
  const near = (p: Vec) => p.x >= box.x - m && p.x <= box.x + box.w + m && p.y >= box.y - m && p.y <= box.y + box.h + m;
  return doc.objects.every(o => (o.kind !== 'wall' && o.kind !== 'partition') || (near(o.a) && near(o.b)));
}

/**
 * Wire it up. Per floor, the first time it is seen with no room, it is armed;
 * the first room that appears there frames the view once and disarms it. A
 * floor first seen with rooms already (an opened plan) is never armed, and
 * loading a plan — even the same one again, floor ids and all — starts over.
 */
export function wireStartCard(editor: Editor, doc: Doc) {
  const hadRoom = new Map<string, boolean>();
  let project = doc.project;
  let emptyIn: typeof doc.project | null = null;   // the plan this floor was last seen empty in
  const check = () => {
    if (doc.project !== project) { project = doc.project; hadRoom.clear(); emptyIn = null; }
    syncStartCard(editor, doc);
    // The note goes the moment this plan stops being empty — not when a plan
    // that already had things in it is opened.
    if (!doc.objects.length) emptyIn = doc.project;
    else if (emptyIn === doc.project) { retireTourNudge(); emptyIn = null; }
    const floor = doc.activeFloor.id;
    const rooms = doc.objects.filter((o): o is Extract<Obj, { kind: 'room' }> => o.kind === 'room');
    const before = hadRoom.get(floor);
    hadRoom.set(floor, before || rooms.length > 0);
    if (before !== false || !rooms.length) return;
    const box = roomBox(rooms[0]);
    if (rooms.length > 1 || !onlyRoomDrawn(doc, box)) return;
    const to = firstRoomView(box, editor.vp);
    if (to) easeTo(editor, to);
  };
  doc.onChange(check);
  const prev = editor.hooks.toolChange;
  editor.hooks.toolChange = (n) => { prev?.(n); syncStartCard(editor, doc); };
  check();
}
