// 貼右側的浮動面板（照度、空間健檢、B20 的屬性抽屜）共用的兩條規則。
//
// 一、同時只開一個。兩個都是 `position: fixed` 貼右邊，一起開的時候健檢整個蓋在
//     照度右半上，「最暗」「最亮」「建議」三欄看不到（docs/review-2026-10.md 的 U2）。
//     用事件而不是互相 import：誰開了就喊一聲，另一個自己收，兩支模組不必認識對方。
// 二、「縮放至全部」要把開著的面板扣掉，不然右邊的房間落在面板底下（U3）。

const OPENED = 'side-panel-open';

/** 開面板的那一刻呼叫：另一個面板聽到會自己收起來。 */
export function announcePanel(name: string) {
  window.dispatchEvent(new CustomEvent(OPENED, { detail: name }));
}

/** 別的面板打開時要做什麼（通常是把自己收起來）。 */
export function onOtherPanel(name: string, close: () => void) {
  window.addEventListener(OPENED, (e) => { if ((e as CustomEvent).detail !== name) close(); });
}

/** 畫布右邊被開著的面板蓋住了幾 px（沒有就是 0）。 */
export function panelInsetRight(canvas: HTMLElement): number {
  const c = canvas.getBoundingClientRect();
  let left = c.right;
  // #right 是屬性抽屜（B20）：浮在畫面上，收起來時帶 .closed。
  for (const el of document.querySelectorAll<HTMLElement>('.light-panel, .health-panel, #right')) {
    if (el.classList.contains('hidden') || el.classList.contains('closed')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.left >= c.right || r.right <= c.left) continue;
    left = Math.min(left, r.left);
  }
  return Math.max(0, c.right - Math.max(left, c.left));
}

/**
 * 把 `panelInsetRight` 寫進 `el` 的 `--panel-inset`，面板開關或視窗變寬窄時跟著更新。
 * 3D 底部的提示靠它置中於看得到的那段，不然 1920 寬開著照度面板時右半被切掉（U5）。
 */
export function watchPanelInset(el: HTMLElement) {
  const sync = () => {
    const inset = panelInsetRight(el);
    el.style.setProperty('--panel-inset', `${inset}px`);
    // 3D 那格扣掉面板與右下樓層鈕之後放不下提示：提示改一行、截斷，鍵帽收起來，
    // 不然分割拉到 70% 又開著抽屜時提示會被擠成一個字一行的直排（B20 第二輪審查）。
    if (el.id === 'view3d') el.classList.toggle('dock-cramped', el.clientWidth - inset - 82 < 300);
  };
  const mo = new MutationObserver(sync);
  for (const p of document.querySelectorAll<HTMLElement>('.light-panel, .health-panel, #right')) mo.observe(p, { attributes: true, attributeFilter: ['class', 'style'] });
  // 抽屜（#right）是滑進來的：拿掉 .closed 的那一刻它還在畫面外，要等動畫跑完再量一次。
  // 少了這行，抽屜開著時 --panel-inset 一直是 0，3D 提示被它蓋住（B20 審查）。
  document.getElementById('right')?.addEventListener('transitionend', sync);
  new ResizeObserver(sync).observe(el);
  sync();
}
