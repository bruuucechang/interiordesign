// 頂列放不放得下文字標籤，用量的，不用猜斷點。
//
// `style.css` 的 1700px 斷點是在照度鈕與健檢計數加進來之前量的：之後頂列長到
// 1977px，1920 寬的螢幕上縮放控制只剩半個「－」（docs/review-2026-10.md 的 U1）。
// 每加一顆按鈕就要回頭重量一次的斷點，遲早會再過期——所以改成頂列自己量：
// 先全部展開，放不下就收標籤（`.tight`），還放不下再收裝飾（`.tighter`）。
//
// CSS 的兩個斷點留著，它們讓窄螢幕第一次畫出來就是對的，不會閃一下；這裡只負責
// 斷點以上、量出來放不下的那一段。
//
// 健檢計數、存檔狀態的字會變寬，所以觀察的是每一個子元素的大小，不只是頂列本身。
// 每次都從全部展開重新量，結果只跟內容有關，不會因為自己改了 class 又觸發自己而來回跳。

const LEVELS = ['tight', 'tighter'] as const;

// B20：頂列分左中右三區，左右兩區平分剩下的寬度，所以要量的是兩側各自放不放得下。
// 不能用 scrollWidth：右區靠右對齊，放不下時是往**左**溢出，scrollWidth 量不到
// （verify-b8 抓到的：撐到溢出了 .tight 也不會上）。改成把子元素的寬加起來比。
function contentWidth(zone: HTMLElement) {
  const kids = Array.from(zone.children) as HTMLElement[];
  const gap = parseFloat(getComputedStyle(zone).columnGap) || 0;
  const shown = kids.filter(k => k.getBoundingClientRect().width > 0);
  return shown.reduce((w, k) => {
    const cs = getComputedStyle(k);
    return w + k.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
  }, 0) + gap * Math.max(0, shown.length - 1);
}
const overflows = (bar: HTMLElement) =>
  bar.scrollWidth > bar.clientWidth + 1
  || Array.from(bar.querySelectorAll<HTMLElement>('.tb-left, .tb-right')).some(z => contentWidth(z) > z.clientWidth + 1);

export function fitTopbar(bar: HTMLElement) {
  bar.classList.remove(...LEVELS);
  for (const level of LEVELS) {
    if (!overflows(bar)) return;
    bar.classList.add(level);
  }
}

export function wireTopbarFit() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  let queued = false;
  const refit = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fitTopbar(bar); });
  };
  const ro = new ResizeObserver(refit);
  ro.observe(bar);
  for (const child of Array.from(bar.querySelectorAll('.tb-left > *, .tb-center, .tb-right > *'))) ro.observe(child);
  // 頂列裡加減了東西（按鈕出現、消失）也重量一次：那不一定會讓既有的元素變大小。
  // 選單裡的變動（縮放百分比每格都改字）不影響頂列寬度，略過——不然捲一格滾輪就重量三次。
  const inMenu = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest('.menu-pop');
  new MutationObserver(rs => { if (!rs.every(r => inMenu(r.target))) refit(); }).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });   // 不看 class：fitTopbar 自己改 class，看了會每一幀量一次
  // 切語言會換掉標籤的字，寬度跟著變。
  new MutationObserver(refit).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // 第一次量的時候字型與樣式可能還沒到齊，量到的是比較寬的樣子；收起來之後子元素
  // 只會變窄、不會再觸發放寬，於是 2000 寬的螢幕也一直沒有標籤。等它們到齊再量一次。
  window.addEventListener('load', refit);
  void document.fonts?.ready.then(refit);
  fitTopbar(bar);
}
