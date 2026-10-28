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

import { EN_PROPS } from './i18n-en-props';     // ui/properties.ts
import { EN_PANELS } from './i18n-en-panels';   // lighting / health / modals / settings / onboarding / tools

export type Lang = 'zh-Hant' | 'en';

const KEY = 'interior_lang';

/** Everything not in here falls through to the key itself, which is 繁中. */
const EN: Record<string, string> = {
  ...EN_PROPS, ...EN_PANELS,
  // B20 build-mode chrome
  '檔案': 'File', '檢視': 'View', '設定': 'Settings', '說明': 'Help',
  '開啟…': 'Open…', '匯入': 'Import', '底圖（照片或掃描）…': 'Underlay (photo or scan)…',
  'DXF 圖檔…': 'DXF drawing…', '專案檔…': 'Project file…', '專案檔（可再編輯）': 'Project file (editable)',
  'PNG 影像': 'PNG image', 'PDF（畫面快照）': 'PDF (snapshot)', '施工圖 PDF…': 'Construction PDF…',
  '360 全景': '360° panorama', '面積報表（Excel）': 'Area report (Excel)', '3D 模型': '3D model',
  '照度熱圖': 'Lighting heat map', '縮放': 'Zoom', '縮小': 'Zoom out', '放大': 'Zoom in', '回到 100%': 'Back to 100%',
  '縮放至全部 — 整張圖放進畫面（扣掉開著的面板）': 'Fit all — the whole plan in view (minus open panels)',
  '全螢幕': 'Full screen', '這個瀏覽器不讓網頁進入全螢幕': 'This browser will not let the page go full screen',
  '吸附格線與牆': 'Snap to grid and walls',
  '吸附 — 端點會黏到格線、其他牆的端點/中點/牆面。\n關掉才能放在任意位置；描底圖時通常關掉，自己畫時開著比較容易接得起來。':
    'Snap — ends stick to the grid and to other walls’ ends, midpoints and faces.\nTurn it off to place anywhere; usually off while tracing, on while drawing.',
  '操作靈敏度…': 'Control sensitivity…', '介面語言': 'Language',
  '只看平面圖': 'Plan only', '平面圖與 3D 並排': 'Plan and 3D side by side', '只看 3D': '3D only',
  '光線時段': 'Time of day', '復原（⌘Z）': 'Undo (⌘Z)', '重做（⌘⇧Z）': 'Redo (⌘⇧Z)',
  '導覽（一分鐘）': 'Tour (one minute)', '2D 平面': '2D plan', '拖曳調整比例，雙擊回到對半': 'Drag to resize; double-click for half and half',
  '收起（並取消選取）': 'Close (and deselect)',
  '你點的線是牆的哪一面': 'Which face of the wall you click',
  '量錯面，整間房子會差半個牆厚（12cm 的牆就是 6cm，四面牆下來一間房差 12cm）。\n現場量內緣就選「左緣／右緣」，量中心線才選「中心」。':
    'Pick the wrong face and the flat is out by half a wall (6 cm on a 12 cm wall, 12 cm per room).\nMeasured a face on site: Left or Right. Measured the centre line: Centre.',
  '中心線 — 你點的線是牆的正中間。\n從 CAD 圖描牆通常用這個。': 'Centre — the line you click is the middle of the wall.\nUsually right when tracing a CAD drawing.',
  '左緣 — 你點的線是牆的左面，牆往右長出厚度。\n拿捲尺貼著牆的這一面量出來的數字，選這個才對得上。': 'Left face — the line you click is the wall’s left face; the thickness grows to the right.\nPick this when the tape was held against this face.',
  '右緣 — 你點的線是牆的右面，牆往左長出厚度。\n拿捲尺貼著牆的另一面量的話選這個。': 'Right face — the line you click is the wall’s right face; the thickness grows to the left.\nPick this when the tape was held against the other face.',
  '結構': 'Structure', '燈與電': 'Lights & power', '插座': 'Sockets', '開關': 'Switches',
  '燈位與排風': 'Light points & fans', '樓梯': 'Stairs', '選取': 'Select',
  '選取與移動：拖曳物件移動，拖曳空白處平移畫面（Esc）': 'Select and move: drag a thing to move it, drag empty space to pan (Esc)',
  '風格': 'Style', '全部風格': 'All styles', '搜尋': 'Search', '件': 'items',
  '這個風格沒有符合的家具 — 把風格換回「全部風格」看看': 'Nothing in this style — try “All styles”',
  '沒有符合的家具 — 換個名字搜尋': 'Nothing matches — try another name',
  '安裝高度': 'Mounted at', '樓板高度': 'Floor level', '樓層名稱': 'Floor name', '刪除樓層': 'Delete floor',
  '項提醒': 'notes', '目前沒有提醒': 'nothing to note',
  '第一次用嗎？': 'First time here?',
  '一分鐘的導覽會指給你看：牆從哪裡畫、家具在哪裡、怎麼走進房子裡。之後也可以從「說明」叫出來。':
    'A one-minute tour shows where walls are drawn, where the furniture is, and how to walk inside. Help can bring it back later.',
  '不用了': 'No thanks', '看導覽': 'Take the tour',
  '行走：點畫面用滑鼠轉頭 · WASD 走 · Shift 跑 · 樓梯走上去就換層 · F 或兩次 Esc 離開':
    'Walking: click the view to look with the mouse · WASD to walk · Shift to run · walk up the stairs to change floor · F or Esc twice to leave',
  '點地板放下去 · 按住 Shift 連續放 · Q／E 轉 90° · Esc 放下手上的東西': 'Click the floor to place · hold Shift to keep placing · Q/E turn 90° · Esc to put it down',
  '點牆放上門窗 · 按住 Shift 連續放 · Esc 放下手上的東西': 'Click a wall to place it · hold Shift to keep placing · Esc to put it down',
  // B22
  '跟{name}重疊': 'Overlaps {name}', '別的家具': 'another piece', '不在任何房間裡': 'Not inside any room',
  '門窗要點在牆上——最近的牆在 {d} 外': 'Doors and windows go on a wall — the nearest is {d} away',
  '門窗要點在牆上——這層還沒有牆': 'Doors and windows go on a wall — this floor has none yet',
  '門窗要點在牆上——點一面牆': 'Doors and windows go on a wall — click one',
  '方案名稱': 'Plan name', '已儲存': 'Saved', '剛剛': 'just now', '（我的版本）': ' (my version)',
  '這份圖在別的地方被存過了（{when}）。\n\n直接存下去會蓋掉那一版。\n\n按「確定」另存成新的一份（兩版都保住），\n按「取消」先不存 — 你的改動仍在本機，什麼都不會弄丟。':
    'This plan was saved somewhere else ({when}).\n\nSaving now would overwrite that version.\n\nOK saves yours as a new copy (both versions kept),\nCancel holds off — your changes stay on this device, nothing is lost.',
  '這份平面圖屬於另一個使用者（或另一個瀏覽器）。\n\n你的改動沒有被存進去，但完整地留在這台機器上。\n\n按「確定」另存成你自己的一份，按「取消」先不存。':
    'This plan belongs to another user (or another browser).\n\nYour changes were not saved into it, but they are all still on this device.\n\nOK saves them as your own copy, Cancel holds off.',
  '存不上去 — 改動留在本機，連上線會自動送出': 'Could not save — changes stay on this device and go up once connected',
  '隱藏這個圖層': 'Hide this layer', '顯示這個圖層': 'Show this layer', '解鎖這個圖層': 'Unlock this layer',
  '鎖定這個圖層': 'Lock this layer', '往上一層': 'Move up', '往下一層': 'Move down',

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
  '照度': 'Lighting', '燈光': 'Light', '迴路': 'Circuit', '色溫': 'Colour temp.', '照向': 'Faces',
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
  '行走': 'Walk', '行走：在 3D 裡用人的高度走，牆會擋、門可以過（F）': 'Walk: at eye height in 3D, walls stop you, doors let you through (F)',
  '行走要在 3D 裡：先切到 3D 或分割': 'Walking happens in 3D: switch to 3D or split first',
  '點一下畫面開始用滑鼠轉頭，WASD 走、Shift 跑、F 或兩次 Esc 離開': 'Click the view to look with the mouse; WASD to walk, Shift to run, F or Esc twice to leave',
  '開燈': 'Lamps', '3D 開燈：燈具真的發光（黃昏、夜晚自動開）': 'Lamps in 3D: fittings really shine (on by itself at dusk and night)',
  '操作設定': 'Controls', '操作設定：轉視角、移動、滾輪的靈敏度': 'Controls: turn, move and wheel sensitivity',
  '轉視角': 'Turn', '移動速度': 'Move speed', '滾輪縮放': 'Wheel zoom', '行走轉頭': 'Walk look',
  '3D 裡拖曳滑鼠轉動視角的速度': 'How fast dragging turns the 3D view',
  '3D 裡 WASD 與方向鍵移動的速度': 'How fast WASD and the arrow keys move in 3D',
  '2D 與 3D 滾輪（觸控板捏放）縮放的幅度': 'How far the wheel (or a trackpad pinch) zooms in 2D and 3D',
  '行走模式裡移動滑鼠轉頭的速度（行走模式上線後生效）': 'How fast the mouse turns your head in walk mode (once walk mode ships)',
  '按住 Alt（Option）可以暫時關掉吸附': 'Hold Alt (Option) to turn snapping off for a moment',
  '關閉': 'Close', '回復預設': 'Reset to defaults',
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

  // 使用說明（完整說明面板）。內文本身按語言各寫一份，見 ui/help.ts——這裡只有外框。
  '使用說明': 'User guide',
  '重新播放新手教學': 'Replay the getting-started tour',
  '畫面上的繪圖步驟提示': 'On-screen drawing checklist',
  '新建會清空目前畫布，確定？': 'New clears the current drawing. Continue?',

  // 空間健檢
  '空間健檢': 'Space check', '指給我看': 'Show me', '接上': 'Join up',
  '忽略這一條': 'Ignore this', '把忽略過的': 'Bring back the', '條叫回來': 'ignored',
  '目前沒有提醒。': 'Nothing to flag.',
  '還沒有東西可以檢查——先畫幾道牆。': 'Nothing to check yet — draw a few walls first.',
};

const DICTS: Record<Lang, Record<string, string>> = { 'zh-Hant': {}, en: EN };

/**
 * Which language to open in, first time on this machine.
 *
 * Order: what the user chose > what the launcher asked for > the browser.
 *
 * **The middle one exists for the desktop build.** `navigator.language` is the
 * *browser's* language, not the person's, and those come apart constantly:
 * plenty of Chinese-reading people run an English-language Chrome because that
 * is what the machine shipped with. The standalone build is handed to one
 * specific person by somebody who knows what they read, so its launcher opens
 * `/?lang=zh-Hant` and says so outright instead of guessing from the browser.
 *
 * It is only a **default**: a saved choice always wins, and the answer is
 * written to storage on first sight, so switching to English with the toolbar
 * toggle sticks and a later launch does not undo it.
 *
 * The stakes are lopsided, which is why this is not left to the browser. The
 * English side of this app is knowingly incomplete — furniture and material
 * names, the shortcut sheet, and the hint strip are still Chinese — so guessing
 * English wrong hands somebody a half-translated interface, while guessing
 * Chinese wrong costs one click on a toggle that is always visible.
 */
/**
 * The three inputs, injected so this can be tested.
 *
 * `navigator` and `location` are read-only globals under Node, so a test cannot
 * assign to them — and this is precisely the decision that has to be tested,
 * because getting it wrong is invisible on the machine that builds the app and
 * only shows up on the recipient's.
 */
export interface LangInputs {
  saved: string | null;
  /** The `lang` query parameter, if any. */
  asked: string | null;
  /** `navigator.language`. */
  browser: string;
}

const asLang = (v: string | null): Lang | null => (v === 'en' || v === 'zh-Hant' ? v : null);

/** Pure: which language, given what we know. Exported for the tests. */
export function chooseLang({ saved, asked, browser }: LangInputs): Lang {
  return asLang(saved)
    ?? asLang(asked)
    // Anything Chinese stays Chinese; everybody else gets English rather than a
    // language they cannot read.
    ?? (/^zh/i.test(browser || '') ? 'zh-Hant' : 'en');
}

function detect(): Lang {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage off */ }
  let asked: string | null = null;
  try { asked = new URLSearchParams(location.search).get('lang'); } catch { /* no URL */ }
  const picked = chooseLang({ saved, asked, browser: navigator.language || '' });
  // Remembered, so the choice survives a reload without the parameter — opening
  // the app from a bookmark must not silently switch languages.
  if (!asLang(saved)) { try { localStorage.setItem(KEY, picked); } catch { /* not fatal */ } }
  return picked;
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
