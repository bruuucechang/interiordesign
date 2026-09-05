// What a new, empty plan tells you to do.
//
// Two routes, and they are genuinely different pieces of work: trace an
// existing drawing, or draw from nothing. The dialog only asks which; the strip
// then carries the tracing route, because that route has a step that **cannot
// be skipped and gives no sign when it is** — a plan traced before the scale is
// calibrated is self-consistent, correctly proportioned, and every dimension in
// it is wrong. There is nothing later in the app that notices.
//
// The strip is not modal and remembers being dismissed. It is a reminder of an
// order of operations, not a wizard: any step can be done from the normal UI at
// any time, and closing it never blocks anything.

import { Editor } from '../core/editor';
import { Doc } from '../model/doc';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const DISMISSED = 'interior_steps_dismissed';

export type Route = 'trace' | 'scratch';

/** Which steps are done, worked out from the document rather than remembered. */
function progress(doc: Doc) {
  const img = doc.objects.find(o => o.kind === 'image');
  return {
    imported: !!img,
    // Calibration leaves no flag of its own. Rather than store one, ask the
    // question the flag would answer: the importer fits the longest side to
    // exactly 1000 cm, so a plan still sitting on that number to the pixel has
    // not been calibrated. Anything else has.
    calibrated: !!img && Math.abs(Math.max((img as any).w, (img as any).h) - 1000) > 0.5,
    locked: doc.isLayerLocked('underlay'),
    traced: doc.objects.some(o => o.kind === 'wall'),
  };
}

let route: Route | null = null;

export function stepsFor(doc: Doc): { label: string; done: boolean }[] {
  const p = progress(doc);
  if (route === 'scratch') {
    return [
      { label: '選左側「直線牆」開始畫', done: p.traced },
      { label: '要精確長度就直接打數字（Tab 切角度、Enter 放置）', done: false },
      { label: '工具列的「中心／左緣／右緣」＝你點的線是牆的哪一面', done: false },
    ];
  }
  return [
    { label: '匯入底圖', done: p.imported },
    { label: '校正比例（沿圖上標好的尺寸拉一條線）', done: p.calibrated },
    { label: '底圖鎖定，避免描圖時誤拖', done: p.locked },
    { label: '用「直線牆」沿著底圖描', done: p.traced },
  ];
}

export function renderSteps(editor: Editor, doc: Doc) {
  const pane = $('#pane2d');
  const old = document.getElementById('stepStrip');
  if (old) old.remove();
  if (!route) return;
  if (localStorage.getItem(DISMISSED) === '1') return;

  const steps = stepsFor(doc);
  // Gone once the last step is done — a checklist with everything ticked is
  // just something else covering the drawing.
  if (steps.every(s => s.done)) return;

  const box = document.createElement('div');
  box.id = 'stepStrip'; box.className = 'step-strip';
  const head = document.createElement('div'); head.className = 'step-head';
  head.textContent = route === 'trace' ? '從底圖描' : '純手繪';
  const close = document.createElement('button'); close.className = 'step-close';
  close.title = '不再顯示'; close.setAttribute('aria-label', '不再顯示');
  close.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  close.onclick = () => { localStorage.setItem(DISMISSED, '1'); box.remove(); };
  head.appendChild(close);
  box.appendChild(head);

  const first = steps.findIndex(s => !s.done);
  steps.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'step-row' + (s.done ? ' done' : i === first ? ' now' : '');
    const mark = document.createElement('span'); mark.className = 'step-mark';
    mark.textContent = s.done ? '✓' : i === first ? '●' : '○';
    const txt = document.createElement('span'); txt.textContent = s.label;
    row.append(mark, txt);
    box.appendChild(row);
  });

  pane.appendChild(box);
}

/** Ask which route this plan is. Resolves once one is chosen. */
export function askRoute(editor: Editor, doc: Doc) {
  const modal = $('#routeModal');
  modal.classList.remove('hidden');
  const pick = (r: Route) => {
    route = r;
    localStorage.removeItem(DISMISSED);
    modal.classList.add('hidden');
    if (r === 'trace') $<HTMLInputElement>('#imageInput').click();
    else editor.selectTool('wall');
    renderSteps(editor, doc);
  };
  $('[data-route="trace"]').onclick = () => pick('trace');
  $('[data-route="scratch"]').onclick = () => pick('scratch');
  $('[data-act="close-route"]').onclick = () => modal.classList.add('hidden');
}

export function currentRoute() { return route; }
export function setRoute(r: Route | null) { route = r; }
