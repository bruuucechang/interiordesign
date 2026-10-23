// 貼右側的兩個浮動面板（照度、空間健檢）共用的兩條規則。
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
  for (const el of document.querySelectorAll<HTMLElement>('.light-panel, .health-panel')) {
    if (el.classList.contains('hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.left >= c.right || r.right <= c.left) continue;
    left = Math.min(left, r.left);
  }
  return Math.max(0, c.right - Math.max(left, c.left));
}
