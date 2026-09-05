// The first-run tour: bubbles that point at the real interface.
//
// Written for somebody who has never used a drawing tool. That is not the same
// as somebody in a hurry — the difference is that a beginner does not know what
// the *nouns* are, so every step names one thing, says what it is for, and
// points at where it lives. No step assumes the previous one was understood.
//
// Three things this must survive, because a tour that breaks is worse than none:
//
//   · **A target that is not there.** The toolbar collapses its labels under
//     1700px and hides the wordmark under 1180; a plan with no underlay has no
//     underlay controls. A step whose anchor is missing is skipped, not shown
//     pointing at nothing.
//   · **Being left half-way.** Escape, the skip button, and clicking outside all
//     end it, and ending it is always recorded — nobody should meet the same
//     tour twice because they closed it the first time.
//   · **The window changing size underneath it.** The bubble is repositioned on
//     resize and scroll rather than placed once.

const SEEN = 'interior_tour_seen';

interface Step {
  /** What to point at. Missing targets are skipped rather than shown empty. */
  target: string | null;
  title: string;
  body: string;
}

/**
 * The steps, in the order a beginner needs them.
 *
 * Ordered by "what do I have to know before the next sentence makes sense",
 * not by where things sit on screen. The underlay comes before the wall tool
 * because tracing is the common case; the reference line comes straight after
 * drawing because it is the one concept here that silently ruins a whole plan.
 */
const STEPS: Step[] = [
  {
    target: null,
    title: '這個工具做一件事',
    body: '把一張平面圖畫出來，並且同時長出 3D。\n\n'
      + '左邊是你畫圖的地方，右邊會即時變成立體的房子。\n'
      + '整段教學隨時可以按「跳過」，之後從工具列的「?」再叫出來。',
  },
  {
    target: '#pane2d',
    title: '這裡是平面圖',
    body: '所有的牆、門窗、家具都畫在這一格。\n\n'
      + '滑鼠滾輪縮放，拖曳空白處移動畫面。',
  },
  {
    target: '#left',
    title: '工具和家具都在左邊',
    body: '上面是畫圖工具——最常用的是「直線牆」。\n'
      + '下面是 251 件家具，可以搜尋、依風格篩選。\n\n'
      + '點一個工具，再到中間的圖上點。',
  },
  {
    target: '[data-act="import-image"]',
    title: '有平面圖的照片嗎？從這裡匯入',
    body: '手上有圖檔或照片的話，匯入它，然後沿著它描——比從零開始畫快得多。\n\n'
      + '匯入之後會**先請你校正比例**：在圖上標了尺寸的地方拉一條線、輸入實際公分。\n'
      + '不做這一步的話，描出來的圖看起來完全正常，但每一個尺寸都是錯的。',
  },
  {
    target: '#wallRef',
    title: '你點的線，是牆的哪一面？',
    body: '牆有厚度，所以圖上一道牆其實有兩條線。\n\n'
      + '拿捲尺貼著牆量的人選「左緣／右緣」；從 CAD 圖描的人選「中心」。\n'
      + '選錯的話整間房子會差半個牆厚——12 公分的牆，一間房就差 12 公分。',
  },
  {
    target: '#right',
    title: '選了東西，就在這裡改精確數字',
    body: '點選任何一道牆或一件家具，這裡會出現它的長寬高、位置、材質。\n\n'
      + '也可以切換單位：公分／公尺／英寸／英尺。\n\n'
      + '不想用滑鼠？畫牆時直接打數字，Tab 切角度，Enter 放置。',
  },
  {
    target: '#viewModes',
    title: '2D、並排、3D',
    body: '並排最常用：左邊改一筆，右邊立刻看到結果。\n\n'
      + '在 3D 裡用 WASD 走動、方向鍵平移畫面、拖曳轉視角。',
  },
  {
    target: '#saveStatus',
    title: '不用記得存檔',
    body: '每一次改動都會自動存，狀態顯示在這裡。\n\n'
      + '沒連上伺服器也能繼續畫，改動留在這台電腦上，連上就自動送出。\n'
      + '刪掉的專案會進回收桶，30 天內都救得回來。',
  },
];

let idx = 0;
let steps: Step[] = [];
let root: HTMLElement | null = null;

export const tourSeen = () => localStorage.getItem(SEEN) === '1';

function markSeen() {
  try { localStorage.setItem(SEEN, '1'); } catch { /* 記不住也不該擋住使用 */ }
}

function cleanup() {
  root?.remove();
  root = null;
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', place);
}

function end() { markSeen(); cleanup(); }

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); end(); return; }
  if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
}

function go(delta: number) {
  const next = idx + delta;
  if (next < 0) return;
  if (next >= steps.length) { end(); return; }
  idx = next;
  render();
}

/** Where the highlight and the bubble go for the current step. */
function place() {
  if (!root) return;
  const hole = root.querySelector('.tour-hole') as HTMLElement;
  const bubble = root.querySelector('.tour-bubble') as HTMLElement;
  const sel = steps[idx].target;
  const el = sel ? document.querySelector(sel) : null;

  if (!el) {
    // No anchor: centre the bubble and drop the cut-out. The dimming has to
    // come from the root instead — it is the hole's box-shadow that darkens the
    // page, so hiding the hole took the dimming with it and the opening step
    // appeared over an undimmed app, looking like a stray dialog.
    root!.classList.add('no-target');
    hole.style.display = 'none';
    bubble.style.left = `${(innerWidth - bubble.offsetWidth) / 2}px`;
    bubble.style.top = `${(innerHeight - bubble.offsetHeight) / 2}px`;
    return;
  }

  const r = el.getBoundingClientRect();
  const pad = 6;
  root!.classList.remove('no-target');
  hole.style.display = '';
  hole.style.left = `${r.left - pad}px`;
  hole.style.top = `${r.top - pad}px`;
  hole.style.width = `${r.width + pad * 2}px`;
  hole.style.height = `${r.height + pad * 2}px`;

  // Below the target if it fits, above if not, and always inside the viewport —
  // the toolbar is at the very top and the left panel is full height, so both
  // directions are needed.
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  let top = r.bottom + 14;
  if (top + bh > innerHeight - 8) top = Math.max(8, r.top - bh - 14);
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.max(8, Math.min(left, innerWidth - bw - 8));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function render() {
  if (!root) return;
  const s = steps[idx];
  const bubble = root.querySelector('.tour-bubble') as HTMLElement;
  bubble.innerHTML = '';

  const count = document.createElement('div');
  count.className = 'tour-count';
  count.textContent = `${idx + 1} / ${steps.length}`;
  const h = document.createElement('b');
  h.className = 'tour-title'; h.textContent = s.title;
  const p = document.createElement('div');
  p.className = 'tour-body';
  // The body carries paragraph breaks and one bold run; built as nodes rather
  // than innerHTML because these strings will be translated one day and a
  // translator should never be able to inject markup.
  for (const para of s.body.split('\n')) {
    const line = document.createElement('div');
    for (const [i, chunk] of para.split('**').entries()) {
      if (!chunk) continue;
      const node = i % 2 ? document.createElement('strong') : document.createElement('span');
      node.textContent = chunk;
      line.appendChild(node);
    }
    if (!para) line.style.height = '7px';
    p.appendChild(line);
  }

  const acts = document.createElement('div'); acts.className = 'tour-acts';
  const skip = document.createElement('button');
  skip.className = 'tour-skip'; skip.textContent = '跳過';
  skip.onclick = end;
  const prev = document.createElement('button');
  prev.className = 'tour-prev'; prev.textContent = '上一步';
  prev.disabled = idx === 0;
  prev.onclick = () => go(-1);
  const next = document.createElement('button');
  next.className = 'tour-next';
  next.textContent = idx === steps.length - 1 ? '開始使用' : '下一步';
  next.onclick = () => go(1);
  acts.append(skip, prev, next);

  bubble.append(count, h, p, acts);
  place();
  next.focus();
}

/** Run the tour. Safe to call when it is already open — it restarts. */
export function startTour() {
  cleanup();
  // Drop steps whose anchor is not on screen rather than pointing at nothing.
  steps = STEPS.filter(s => !s.target || document.querySelector(s.target));
  if (!steps.length) return;
  idx = 0;

  root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-hole"></div><div class="tour-bubble" role="dialog" aria-modal="true"></div>';
  // Clicking the dimmed area ends it. Anything that looks dismissible has to be
  // dismissible, or the next thing the user tries is the browser's back button.
  root.onclick = (e) => { if (e.target === root) end(); };
  document.body.appendChild(root);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  render();
}

/** First run on this machine? Then teach, once. */
export function maybeStartTour() {
  if (tourSeen()) return false;
  startTour();
  return true;
}
