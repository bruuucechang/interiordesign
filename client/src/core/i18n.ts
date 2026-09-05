// Interface language.
//
// Everything here was hardcoded Traditional Chinese, which is fine for the
// person who commissioned it and a wall for anybody else. This is the layer
// that makes the strings replaceable; `scripts/i18n-coverage.mjs` measures how
// much of the interface has actually been moved behind it, so "translated" is a
// number rather than a claim.
//
// Two decisions worth stating, because both look like shortcuts and are not:
//
//   · **The key is the Chinese string.** Not `topbar.save`. A missing key then
//     falls back to something a person can read instead of to `topbar.save`
//     appearing on a button, and a half-migrated interface stays usable
//     throughout — which matters when the migration is going to take a while.
//   · **`t()` returns a string, never markup.** Callers assign it to
//     `textContent`. A translation file is data, and data that can become an
//     element is an injection waiting for a contributor.

export type Lang = 'zh-Hant' | 'en';

const KEY = 'interior_lang';

/** Everything not in here falls through to the key itself, which is 繁中. */
const EN: Record<string, string> = {
  // topbar
  '新建': 'New', '儲存': 'Save', '開啟': 'Open', '底圖': 'Underlay',
  '復原': 'Undo', '重做': 'Redo', '匯出': 'Export',
  '分割': 'Split', '吸附': 'Snap', '中心': 'Centre', '左緣': 'Left face', '右緣': 'Right face',
  '早晨': 'Morning', '正午': 'Noon', '黃昏': 'Dusk', '夜晚': 'Night',
  '新建平面圖': 'New plan', '儲存中…': 'Saving…', '已儲存 ✓': 'Saved ✓',
  '離線・已暫存本機': 'Offline — kept on this device',
  '未命名平面圖': 'Untitled plan',

  // panels
  '樓層': 'Floors', '圖層': 'Layers', '屬性': 'Properties', '常用': 'Common',
  '未選取物件': 'Nothing selected', '＋ 新增樓層': '+ Add floor', '新增樓層': 'Add floor',
  '平移': 'Pan', '直線牆': 'Wall', '曲線牆': 'Curved wall', '樑': 'Beam',
  '隔間線': 'Partition', '門': 'Door', '窗': 'Window',
  '搜尋家具…': 'Search furniture…', '全部': 'All',
  '現代': 'Modern', '北歐': 'Nordic', '日式': 'Japanese', '古典': 'Classical',
  '鄉村': 'Country', '工業': 'Industrial', '中式': 'Chinese',
  '牆體': 'Walls', '房間': 'Rooms', '門窗': 'Openings', '家具': 'Furniture',
  '水電配置': 'Electrical', '尺寸標註': 'Dimensions',

  // dialogs
  '開啟專案': 'Open project', '搜尋專案名稱…': 'Search project names…',
  '從檔案匯入專案檔…': 'Import a project file…', '刪除': 'Delete', '還原': 'Restore',
  '鍵盤快捷鍵': 'Keyboard shortcuts', '從底圖描': 'Trace an underlay', '純手繪': 'Draw from scratch',
  '今天': 'Today', '昨天': 'Yesterday', '這一週': 'This week', '這個月': 'This month',
  '更早': 'Earlier', '尚未上傳': 'Not uploaded',

  // tour
  '跳過': 'Skip', '上一步': 'Back', '下一步': 'Next', '開始使用': 'Start',
  '新手教學': 'Getting started',
};

const DICTS: Record<Lang, Record<string, string>> = { 'zh-Hant': {}, en: EN };

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved === 'en' || saved === 'zh-Hant') return saved;
  } catch { /* storage off; fall through to the browser */ }
  // Anything Chinese stays Chinese; everybody else gets English rather than a
  // language they cannot read.
  return /^zh/i.test(navigator.language || '') ? 'zh-Hant' : 'en';
}

let lang: Lang = detect();

export const currentLang = () => lang;

/** Translate. Unknown keys come back as themselves, which is readable 繁中. */
export function t(s: string): string {
  return DICTS[lang][s] ?? s;
}

export function setLang(next: Lang) {
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* not fatal */ }
  document.documentElement.lang = next;
  applyStatic();
}

/**
 * Translate the markup that ships in index.html.
 *
 * Elements opt in with `data-i18n` (their text) and `data-i18n-title` (their
 * tooltip). The original Chinese stays in the HTML and is used as the key, so
 * the file is still readable and still correct with this layer switched off.
 */
export function applyStatic(root: ParentNode = document) {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.dataset.i18n || el.textContent?.trim() || '';
    if (key) el.textContent = t(key);
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    const key = el.dataset.i18nTitle || '';
    if (key) el.title = t(key);
  }
}
