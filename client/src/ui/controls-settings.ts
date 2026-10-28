// 操作設定：轉視角、移動速度、滾輪、行走時滑鼠轉頭四條靈敏度滑桿。
//
// 遊戲一定有這一頁——每個人的滑鼠 DPI、觸控板不一樣，固定一組數字一定有人覺得太快。
// 數字存在這個瀏覽器（localStorage，壞了照預設），聽眾（3D、2D）一改就收到。
// 基準值與換算在 core/controlFeel.ts。

import { FeelSettings, FEEL_DEFAULTS, FEEL_MIN, FEEL_MAX, loadFeel, saveFeel } from '../core/controlFeel';
import { t } from '../core/i18n';

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

let feel: FeelSettings = loadFeel(store());
const listeners: ((f: FeelSettings) => void)[] = [];

/** 現在的設定，並在每次改動時再叫一次。 */
export function onFeel(cb: (f: FeelSettings) => void) { listeners.push(cb); cb(feel); }

function set(next: FeelSettings) {
  feel = next;
  saveFeel(feel, store());
  for (const cb of listeners) cb(feel);
}

const ROWS: { key: keyof FeelSettings; label: string; tip: string }[] = [
  { key: 'rotate', label: '轉視角', tip: '3D 裡拖曳滑鼠轉動視角的速度' },
  { key: 'move', label: '移動速度', tip: '3D 裡 WASD 與方向鍵移動的速度' },
  { key: 'wheel', label: '滾輪縮放', tip: '2D 與 3D 滾輪（觸控板捏放）縮放的幅度' },
  { key: 'look', label: '行走轉頭', tip: '行走模式裡移動滑鼠轉頭的速度（行走模式上線後生效）' },
];

let box: HTMLElement | null = null;

function build(): HTMLElement {
  const m = document.createElement('div');
  m.id = 'feelModal';
  m.className = 'modal hidden';
  m.innerHTML = `<div class="modal-box feel-box">
    <div class="modal-head"><span>${t('操作設定')}</span><button data-feel="close" aria-label="${t('關閉')}">✕</button></div>
    <div class="feel-rows"></div>
    <div class="feel-foot"><span class="feel-note">${t('按住 Alt（Option）可以暫時關掉吸附')}</span><button data-feel="reset">${t('回復預設')}</button></div>
  </div>`;
  const rows = m.querySelector('.feel-rows')!;
  for (const r of ROWS) {
    const row = document.createElement('label');
    row.className = 'feel-row';
    row.title = t(r.tip);
    row.innerHTML = `<span class="feel-label">${t(r.label)}</span>
      <input type="range" min="${FEEL_MIN}" max="${FEEL_MAX}" step="0.05" data-key="${r.key}">
      <span class="feel-val"></span>`;
    rows.appendChild(row);
  }
  m.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.key) return;
    set({ ...feel, [el.dataset.key]: Number(el.value) });
    sync(m);
  });
  m.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-feel]')?.dataset.feel;
    if (act === 'close' || e.target === m) m.classList.add('hidden');
    if (act === 'reset') { set({ ...FEEL_DEFAULTS }); sync(m); }
  });
  document.body.appendChild(m);
  return m;
}

function sync(m: HTMLElement) {
  for (const el of Array.from(m.querySelectorAll<HTMLInputElement>('input[data-key]'))) {
    const v = feel[el.dataset.key as keyof FeelSettings];
    el.value = String(v);
    (el.nextElementSibling as HTMLElement).textContent = `×${v.toFixed(2)}`;
  }
}

export function openFeelSettings() {
  box ??= build();
  sync(box);
  box.classList.remove('hidden');
}
