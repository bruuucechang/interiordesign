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

export function fitTopbar(bar: HTMLElement) {
  bar.classList.remove(...LEVELS);
  for (const level of LEVELS) {
    if (bar.scrollWidth <= bar.clientWidth) return;
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
  for (const child of Array.from(bar.children)) ro.observe(child);
  // 切語言會換掉標籤的字，寬度跟著變。
  new MutationObserver(refit).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // 第一次量的時候字型與樣式可能還沒到齊，量到的是比較寬的樣子；收起來之後子元素
  // 只會變窄、不會再觸發放寬，於是 2000 寬的螢幕也一直沒有標籤。等它們到齊再量一次。
  window.addEventListener('load', refit);
  void document.fonts?.ready.then(refit);
  fitTopbar(bar);
}
