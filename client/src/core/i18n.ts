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


  // status & failures
  '這台機器無法使用 3D': 'This machine cannot run 3D',
  '3D 繪圖環境被系統收回了，正在等它回來 — 平面圖不受影響': '3D was reclaimed by the system; waiting for it back — the plan is unaffected',
  '3D 已恢復': '3D is back',
  '正在讀取 DXF…': 'Reading DXF…',
  '無法讀取這個 DXF 檔': 'Cannot read this DXF',
  '這個 DXF 沒有可匯入的線段': 'This DXF has no importable segments',
  '請至少勾選一個圖層': 'Tick at least one layer',
  '正在轉換…': 'Converting…',
  '匯入失敗 — 後端未連線': 'Import failed — no connection to the server',
  '勾選的圖層裡沒有可用的線段': 'No usable segments in the ticked layers',
  '已匯出施工圖 PDF': 'Construction PDF exported',
  '施工圖產生失敗 — 試試較小的紙張或比例': 'Could not build the sheet — try a smaller paper or scale',
  '尚無已儲存的專案': 'No saved projects yet',
  '還原失敗 — 伺服器沒有回應': 'Restore failed — no response from the server',
  '已恢復顯示': 'Shown again',
  '正在計算尺寸鏈…': 'Building the dimension chain…',
  '無法計算 — 後端未連線': 'Cannot compute — no connection to the server',
  '這道牆太短，沒有可標註的區段': 'This wall is too short to dimension',
  '正在辨識牆體…': 'Detecting walls…',
  '無法辨識牆體 — 後端未連線': 'Cannot detect walls — no connection to the server',
  '偵測不到牆體 — 請確認是清晰、線條分明的平面圖': 'No walls found — the drawing needs to be clean and line-based',
  '檔案毀損或不是有效的 JSON': 'The file is damaged or is not valid JSON',
  '這不是室內設計專案檔': 'This is not an Interior Designer project file',
  '已從檔案開啟，可繼續編輯': 'Opened from file — carry on editing',
  '讀取檔案失敗': 'Could not read the file',
  '已匯出專案檔（.floorplan.json）': 'Project file exported (.floorplan.json)',
  '已匯出 PNG': 'PNG exported', '匯出 PNG 失敗': 'PNG export failed',
  '已匯出 PDF': 'PDF exported', '匯出 PDF 失敗': 'PDF export failed',
  '尚無可出圖的內容': 'Nothing to plot yet',
  '無法匯出報表 — 後端未連線': 'Cannot export the report — no connection to the server',
  '正在產生報表…': 'Building the report…',
  '已匯出面積報表 (.xlsx)': 'Area report exported (.xlsx)',
  '報表產生失敗 — 後端無法解析這份存檔': 'Report failed — the server could not parse this plan',
  '尚無可拍攝的 3D 內容': 'Nothing in 3D to capture yet',
  '正在算全景…': 'Rendering the panorama…', '匯出全景失敗': 'Panorama export failed',
  '尚無可匯出的 3D 內容': 'Nothing in 3D to export yet',
  '已匯出 3D 模型 (.glb)': '3D model exported (.glb)', '匯出 3D 失敗': '3D export failed',
  '底圖已匯入並鎖定 — 接著沿圖上標有尺寸的一段拉一條線來校正比例':
    'Underlay imported and locked — now draw a line along a dimension on it to set the scale',
  '已暫停儲存 — 你的改動還在，重新載入可以看到別人的版本':
    'Saving paused — your changes are safe; reload to see the other version',
  '已另存為新的一份，原本那一份沒有被動到': 'Saved as a new copy; the original was left alone',
  '已暫停儲存 — 你的改動還在本機': 'Saving paused — your changes are still on this device',
  '已另存為你自己的一份': 'Saved as your own copy',

  // properties panel
  '材質': 'Finish', '恢復目錄預設': 'Reset to catalogue default',
  '樣式': 'Style', '開口朝向': 'Opening side',
  '刪除物件': 'Delete object', '刪除全部': 'Delete all',
  '解散群組 (⇧⌘G)': 'Ungroup (⇧⌘G)', '組成群組 (⌘G)': 'Group (⌘G)', '複製 (⌘D)': 'Duplicate (⌘D)',
  '只在平面上分割區域：計入面積報表，3D 不出現，不計價':
    'Splits the plan only: counted in the area report, absent from 3D, not costed',
  '從 a 端量這個距離把牆切成兩道': 'Split the wall at this distance from its a end',
  '請先輸入距離': 'Enter a distance first',
  '📏 自動標註這道牆': '📏 Dimension this wall',
  '沿牆產生連續尺寸鏈，在門窗與牆交會處斷開':
    'A running chain along the wall, broken at openings and junctions',
  '🪄 自動偵測牆體': '🪄 Detect walls',
  '從底圖自動生成牆體（適合清晰的平面線稿）':
    'Generate walls from the underlay (works on clean line drawings)',
  '校正比例': 'Set scale',
  '沿圖上標有尺寸的一段拉一條線，輸入它的實際長度':
    'Draw a line along something the drawing dimensions, then type its real length',
  '這幾處的牆面差不到 5 公分——平面圖上看不出來，3D 會露出一條牆的端面。選一面拉齊，或略過。':
    'These wall faces are less than 5 cm out — invisible in plan, a strip of wall end in 3D. Align one face, or skip.',
  '這份圖的牆面落差都不處理；之後可以從「重新顯示」叫回來':
    'Leave every face step on this plan; you can bring them back later',
  '這一處保持原狀': 'Leave this one as it is',
  '點擊切換樓層，雙擊重新命名': 'Click to switch floor, double-click to rename',
  '不再顯示': 'Do not show again',

  '牆面對齊': 'Wall faces', '落差': 'Out by', '全部略過': 'Skip all',
  '這一面': 'This side', '另一面': 'The other side',
  '重新顯示已略過的落差': 'Show skipped face steps again',

  // property fields — translated inside the field builders, so one change
  // covers every call site instead of a hundred
  '尺寸': 'Size', '位置': 'Position', '名稱': 'Name', '寬 (cm)': 'Width',
  '寬': 'Width', '深': 'Depth', '高度': 'Height', '厚度': 'Thickness',
  '長度': 'Length', '旋轉': 'Rotation', '離地板距離': 'Height off floor',
  '離地高度': 'Sill height', '牆長': 'Wall length', '左側牆長': 'Wall left',
  '右側牆長': 'Wall right', '面積': 'Area', '房間名稱': 'Room name',
  '透明度': 'Opacity', '自訂色': 'Custom colour', '樓層高度': 'Storey height',
  '地板': 'Floor', '牆面': 'Walls', '天花板': 'Ceiling', '顏色': 'Colour',
  '曲率': 'Curvature', '距離': 'Distance',

  // furniture categories (the panel's headings, not the 251 item names)
  '客廳': 'Living room', '臥室': 'Bedroom', '廚房': 'Kitchen', '浴室': 'Bathroom',
  '餐廳': 'Dining', '書房': 'Study', '陽台': 'Balcony', '玄關': 'Entrance',
  '燈具': 'Lighting', '裝飾': 'Decor', '收納': 'Storage', '電器': 'Appliances',
  '室內設計繪圖': 'Interior Designer',
  '分割於': 'Split at',

  // tour
  '跳過': 'Skip', '略過': 'Skip', '上一步': 'Back', '下一步': 'Next', '開始使用': 'Start',
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
  // <option> keeps its emoji and swaps only the word after it — option content
  // cannot be markup, so the emoji has to travel with the string.
  for (const el of Array.from(root.querySelectorAll<HTMLOptionElement>('[data-i18n-opt]'))) {
    const key = el.dataset.i18nOpt || '';
    if (!key) continue;
    const emoji = (el.textContent ?? '').replace(key, '').trim();
    el.textContent = `${emoji} ${t(key)}`.trim();
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    const key = el.dataset.i18nTitle || '';
    if (key) el.title = t(key);
  }
}
