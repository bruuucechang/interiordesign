// 完整使用說明。
//
// 這裡是「所有功能講一遍」的那一份，跟 `tour.ts` 分工明確：
//
//   · **教學（tour）是招呼，只在這台電腦第一次開啟時自己跳出來一次。**
//     它指著真的介面講八件事，目的是讓人知道畫面上那幾塊是什麼。
//   · **說明（這一份）是查得到的東西，永遠不會自己跳出來。**
//     使用者要的時候按工具列的「?」，涵蓋每一個功能，可以從頭讀也可以找。
//
// 使用者的裁示是：**除了第一次開啟，任何時間都不要自己跳出來**，但完整說明必須
// 找得到。所以「?」從「再播一次教學」改成「打開說明」，重播教學變成說明裡的一顆
// 按鈕——一個入口通到全部，而不是兩顆看起來一樣的問號各通一半。
//
// 內文跟教學一樣**按語言各寫一份**，不逐句 `t()`：這些是整段的說明文字，一句一句
// 翻會把段落切碎，譯者也看不到上下文。

import { Editor } from '../core/editor';
import { Doc } from '../model/doc';
import { currentLang, t } from '../core/i18n';
import { startTour } from './tour';
import { Route, currentRoute, setRoute, renderSteps, clearStepsDismissed } from './onboarding';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

interface Section { title: string; body: string[] }

const SECTIONS_ZH: Section[] = [
  {
    title: '一、這個軟體在做什麼',
    body: [
      '畫一張室內平面圖，並且同時長出它的 3D。左邊是平面圖，右邊是同一份圖的立體樣子——不是另外做的模型，是同一份資料的兩種畫法，左邊改一筆右邊立刻跟著變。',
      '畫完可以出圖（PNG、PDF、施工圖 PDF）、可以出面積報表（Excel），也可以把整份專案匯出成一個檔案交給別人。',
    ],
  },
  {
    title: '二、開始一張新圖的三種方式',
    body: [
      '**有平面圖的照片或掃描檔**：工具列的「底圖」匯入，然後沿著它描。最快，也最常用。',
      '**手上什麼都沒有**：直接選左邊的「直線牆」開始畫。畫的時候可以直接輸入精確長度，不必靠滑鼠瞄。',
      '**有 CAD 檔（.dxf）**：從「匯出／匯入」旁的匯入 DXF 進來，會列出圖層讓你勾選要哪幾層變成牆。**.dwg 不支援**，要先在 CAD 軟體另存成 .dxf。',
    ],
  },
  {
    title: '三、匯入底圖之後，先校正比例（最重要的一步）',
    body: [
      '匯入的圖片，軟體不知道它是多大的房子，只能先假設最長邊約 10 公尺。那是猜的。',
      '所以匯入後會自動切到「校正」工具：**在底圖上找一段標了尺寸的線，沿著它拉一條，然後輸入那一段的實際公分數**。整張圖的比例就對了。',
      '**跳過這一步不會有任何錯誤訊息。** 描出來的圖看起來完全正常、每個房間的比例也都對，只是所有尺寸都是錯的，而且後面沒有任何地方會發現。',
      '底圖匯入時會自動鎖定，描圖時不會被誤拖。要調它的位置、大小或透明度，先到右邊「圖層」把「底圖」解鎖。',
    ],
  },
  {
    title: '四、畫牆',
    body: [
      '選左邊的「直線牆」，在圖上點一下放起點，再點一下放下一個點，會一直接下去。**按 Esc 結束這一段。**',
      '**不用滑鼠也能畫**：放好起點之後直接打長度數字，Tab 切到角度，Enter 放置，Backspace 修改。要精確尺寸時比拖滑鼠準得多。',
      '**「中心／左緣／右緣」是這個工具最容易搞錯的地方。** 牆有厚度，圖上一道牆其實是兩條線。從 CAD 圖描要選「中心」；拿捲尺貼著牆量的選「左緣」或「右緣」。選錯的話整間房子會一致地差半個牆厚——12 公分的牆，一間房就差 12 公分，而且因為是一致的偏差，看起來完全正常。',
      '端點會自動貼合既有牆的端點，接近水平／垂直／45° 時會自動對齊。按住 Shift 強制對齊。',
      '另外還有「曲線牆」（點起點、點終點，再移動滑鼠拉出弧度）、「樑」與「隔間線」。隔間線不是牆，但它一樣會把空間圍成房間、算進面積。',
    ],
  },
  {
    title: '五、門與窗',
    body: [
      '選「門」或「窗」，在牆上點一下就嵌進去了，會自動吸附到最近的那道牆並對齊牆的方向。',
      '放好之後點選它，右邊可以改寬度、高度、離地高度，門還可以改樣式、鉸鏈在哪一邊、往哪邊開。',
    ],
  },
  {
    title: '六、家具',
    body: [
      '左邊面板下半部有 251 件家具，三種找法互相獨立：上面的搜尋框（打名字）、風格標籤（單選，再按一次同一顆回到全部）、以及每個分類標題可以摺疊。',
      '點一件家具，游標會帶著它的預覽，在圖上點一下放下。**靠近牆（60 公分內）時會自動轉成背對牆並貼上去**——沙發不會臉朝牆。吊燈、地毯這類沒有正面的東西不套用。',
      '放好之後點選它，右邊可以改尺寸、角度、材質顏色。吊燈與吊扇會自動掛到天花板高度。',
      '多選（框選或按住 Shift 點）之後可以用 Ctrl+G 組成群組，之後移動、旋轉、複製都會整組一起動。',
    ],
  },
  {
    title: '七、房間與面積',
    body: [
      '牆一旦圍成封閉的區域，軟體會**自動**在裡面產生一個房間並算面積，不需要你去畫。牆改了它就跟著改。',
      '也可以自己用「房間」工具拉一個矩形。手動畫的房間不會被自動偵測動到。',
      '點選房間可以改名字與地板材質。「匯出面積報表」會把每個房間的面積整理成 Excel。',
    ],
  },
  {
    title: '八、樓層與圖層',
    body: [
      '右上角是樓層：可以新增樓層、雙擊改名、改樓高。每一層有自己的物件，切換樓層只會看到那一層的。',
      '下面是圖層（牆、家具、電氣、尺寸、底圖…）：每一層可以單獨隱藏或鎖定。鎖定的圖層點不到也拖不動，描底圖時很有用。',
    ],
  },
  {
    title: '九、3D 檢視',
    body: [
      '工具列中間可以切「2D／並排／3D」。並排最常用：左邊改一筆，右邊立刻看到。',
      '3D 裡拖曳滑鼠轉視角、滾輪縮放、**WASD 往視線方向走**、Shift 與空白鍵上下升降、方向鍵沿畫面平移。',
      '右邊的「時段」下拉可以換日照方向與光線顏色。',
      '如果這台電腦沒有 3D 繪圖能力（很舊的機器、關掉硬體加速、遠端桌面），3D 那一格會顯示說明，**平面圖不受影響**，照樣可以畫、可以出圖。',
    ],
  },
  {
    title: '十、出圖與匯出',
    body: [
      '工具列的「匯出」裡有五樣：',
      '**PNG** — 目前畫面的圖片。**PDF** — 同一張圖的 PDF。',
      '**施工圖 PDF** — 帶圖框、比例尺與尺寸標註的正式圖。',
      '**面積報表（.xlsx）** — 每個房間的面積表。',
      '**專案檔（.floorplan.json）** — 整份專案打包成一個檔案，可以寄給別人，對方用「匯入專案檔」打開，跟你看到的一模一樣。要備份或交件用這個。',
    ],
  },
  {
    title: '十一、存檔',
    body: [
      '**不用記得存檔。** 每一次改動都會自動儲存，狀態顯示在工具列右邊：「儲存中…」「已儲存 ✓」。',
      '「新建」會清空目前畫布開一張新的（會先問一次）。「開啟」列出所有存過的圖。',
      '刪掉的專案會進回收桶，30 天內都救得回來。',
    ],
  },
  {
    title: '十二、卡住的時候',
    body: [
      '**按錯了** — Ctrl+Z 復原，Ctrl+Shift+Z 重做，工具列也有這兩顆按鈕。',
      '**點不到某個東西** — 它可能在鎖定或隱藏的圖層上，到右邊「圖層」看看。',
      '**想脫離目前的工具** — 按 Esc 回到「選取」。',
      '**畫面跑掉了** — 點工具列的縮放百分比回到 100% 並置中。',
      '**尺寸怪怪的** — 多半是底圖沒有校正比例，或是畫牆時基準線選錯（見第三、四節）。',
    ],
  },
];

const SECTIONS_EN: Section[] = [
  {
    title: '1. What this tool does',
    body: [
      'It draws an interior floor plan and grows the 3D of it at the same time. The left pane is the plan, the right pane is the same plan in three dimensions — not a separate model, the same data drawn two ways. Change something on the left and the right follows immediately.',
      'When it is drawn you can export images (PNG, PDF), a dimensioned construction PDF, an area schedule (Excel), or the whole project as one file to hand to somebody else.',
    ],
  },
  {
    title: '2. Three ways to start a plan',
    body: [
      '**You have a photo or a scan of a floor plan**: import it with Underlay in the toolbar and trace over it. Fastest, and the usual case.',
      '**You have nothing**: pick Wall on the left and start drawing. You can type exact lengths instead of aiming with the mouse.',
      '**You have a CAD file (.dxf)**: import it and pick which layers become walls. **.dwg is not supported** — save it as .dxf from your CAD software first.',
    ],
  },
  {
    title: '3. After importing an underlay, set the scale first',
    body: [
      'The software cannot know how big the imported picture is, so it assumes the longest side is about 10 m. That is a guess.',
      'So it switches straight to the Calibrate tool: **find something on the drawing that carries a dimension, draw a line along it, and type that real length in centimetres.** The whole drawing is then to scale.',
      '**Skipping this produces no error of any kind.** The traced plan looks completely normal, every room is in proportion, and every single measurement in it is wrong — and nothing later in the app notices.',
      'The underlay is locked on import so tracing cannot drag it. To move, resize or fade it, unlock the Underlay layer on the right first.',
    ],
  },
  {
    title: '4. Drawing walls',
    body: [
      'Pick Wall on the left, click to place the start, click again for the next point — it keeps chaining. **Press Esc to end the run.**',
      '**You can draw without the mouse**: after the start point, type the length, Tab for the angle, Enter to place, Backspace to correct. Much more precise than dragging.',
      '**Centre / Left face / Right face is the easiest thing here to get wrong.** A wall has thickness, so on a drawing it is really two lines. Tracing a CAD drawing: pick Centre. Measuring on site with a tape against one face: pick Left or Right. Get it wrong and the whole flat is consistently out by half a wall thickness — and because it is consistent, it looks entirely normal.',
      'Endpoints snap to existing wall ends, and near-horizontal, near-vertical and 45° runs align themselves. Hold Shift to force alignment.',
      'There are also curved walls (click start, click end, then move to set the arc), beams, and partition lines. A partition is not a wall, but it still closes a region and counts towards areas.',
    ],
  },
  {
    title: '5. Doors and windows',
    body: [
      'Pick Door or Window and click on a wall — it snaps into the nearest wall and takes its direction.',
      'Select it afterwards and the right-hand panel sets width, height and sill height; doors also set style, which side the hinge is on and which way they open.',
    ],
  },
  {
    title: '6. Furniture',
    body: [
      'The lower half of the left panel holds 251 pieces. Three independent ways to find one: the search box (by name), the style tags (single choice — press the same one again for everything), and the collapsible category headings.',
      'Click a piece and the cursor carries a preview; click on the plan to drop it. **Within 60 cm of a wall it turns to face away from the wall and backs onto it** — sofas do not end up facing the wall. Ceiling items and rugs are left alone, since they have no front.',
      'Select a placed piece to change its size, angle and finish. Pendant lights and ceiling fans mount at ceiling height automatically.',
      'Select several (rubber-band or Shift-click) and Ctrl+G groups them, so moving, rotating and copying treat them as one.',
    ],
  },
  {
    title: '7. Rooms and areas',
    body: [
      'As soon as walls enclose a region, a room and its area appear **automatically** — you do not draw them. Change the walls and they follow.',
      'You can also drag a rectangle with the Room tool. Rooms you draw yourself are never touched by the automatic detection.',
      'Select a room to rename it or change its floor finish. Export area schedule turns all of them into an Excel sheet.',
    ],
  },
  {
    title: '8. Floors and layers',
    body: [
      'Top right is the storey list: add storeys, double-click to rename, set the height. Each storey holds its own objects.',
      'Below it are layers (walls, furniture, electrical, dimensions, underlay …). Each can be hidden or locked on its own; a locked layer cannot be clicked or dragged, which is what makes tracing workable.',
    ],
  },
  {
    title: '9. The 3D view',
    body: [
      'The middle of the toolbar switches 2D / Split / 3D. Split is the usual one.',
      'In 3D: drag to turn, scroll to zoom, **WASD walks in the direction you are looking**, Shift and Space go down and up, the arrow keys slide the view.',
      'The time-of-day dropdown changes the sun direction and light colour.',
      'On a machine with no 3D capability (an old laptop, hardware acceleration off, a remote desktop) the 3D pane explains itself and **the plan is unaffected** — drawing and exporting work exactly the same.',
    ],
  },
  {
    title: '10. Exporting',
    body: [
      'Five things under Export:',
      '**PNG** — a picture of the current plan. **PDF** — the same as a PDF.',
      '**Construction PDF** — a formal sheet with a title block, scale bar and dimensions.',
      '**Area schedule (.xlsx)** — every room and its area.',
      '**Project file (.floorplan.json)** — the whole project as one file. Send it to somebody and they open it with Import project file and see exactly what you see. This is what to use for backups and hand-offs.',
    ],
  },
  {
    title: '11. Saving',
    body: [
      '**You do not have to remember to save.** Every change is stored automatically; the indicator on the right of the toolbar shows Saving… / Saved ✓.',
      'New clears the canvas for a fresh plan (it asks first). Open lists everything you have saved.',
      'Deleted projects go to a bin and can be restored for 30 days.',
    ],
  },
  {
    title: '12. When you are stuck',
    body: [
      '**Wrong move** — Ctrl+Z undoes, Ctrl+Shift+Z redoes; both are in the toolbar too.',
      '**Cannot click something** — it is probably on a locked or hidden layer. Check the Layers list.',
      '**Want out of the current tool** — Esc returns to Select.',
      '**Lost the view** — click the zoom percentage in the toolbar to reset to 100% and centre.',
      '**Dimensions look wrong** — almost always an uncalibrated underlay, or the wrong wall reference face (sections 3 and 4).',
    ],
  },
];

/** Build one paragraph, honouring `**bold**` runs. Nodes, not innerHTML. */
function para(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'help-p';
  for (const [i, chunk] of text.split('**').entries()) {
    if (!chunk) continue;
    const node = i % 2 ? document.createElement('strong') : document.createElement('span');
    node.textContent = chunk;
    p.appendChild(node);
  }
  return p;
}

let built = false;

function build(editor: Editor, doc: Doc) {
  const body = $('#helpBody');
  body.innerHTML = '';

  // Actions first: somebody who opened this because they are lost wants the
  // tour, not paragraph one.
  const acts = document.createElement('div'); acts.className = 'help-acts';

  const replay = document.createElement('button');
  replay.className = 'help-btn';
  replay.textContent = t('重新播放新手教學');
  replay.onclick = () => { close(); startTour(); };
  acts.appendChild(replay);

  const keys = document.createElement('button');
  keys.className = 'help-btn';
  keys.textContent = t('鍵盤快捷鍵');
  keys.onclick = () => { close(); $('#shortcutsModal').classList.remove('hidden'); };
  acts.appendChild(keys);
  body.appendChild(acts);

  // The step strip used to arrive with a modal nobody asked for. It is a useful
  // checklist for a first plan and a nuisance afterwards, so it lives here, off
  // by default, and the user turns it on when they want it.
  const strip = document.createElement('div'); strip.className = 'help-strip';
  const label = document.createElement('span');
  label.textContent = t('畫面上的繪圖步驟提示');
  strip.appendChild(label);
  const sel = document.createElement('select'); sel.className = 'help-select';
  const OPTS: { v: string; zh: string; en: string }[] = [
    { v: '', zh: '不顯示', en: 'Off' },
    { v: 'trace', zh: '從底圖描', en: 'Tracing a drawing' },
    { v: 'scratch', zh: '純手繪', en: 'Drawing from nothing' },
  ];
  for (const o of OPTS) {
    const op = document.createElement('option');
    op.value = o.v; op.textContent = currentLang() === 'en' ? o.en : o.zh;
    sel.appendChild(op);
  }
  sel.value = currentRoute() ?? '';
  sel.onchange = () => {
    setRoute((sel.value || null) as Route | null);
    if (sel.value) clearStepsDismissed();
    renderSteps(editor, doc);
  };
  strip.appendChild(sel);
  body.appendChild(strip);

  for (const s of (currentLang() === 'en' ? SECTIONS_EN : SECTIONS_ZH)) {
    const h = document.createElement('h3'); h.className = 'help-h'; h.textContent = s.title;
    body.appendChild(h);
    for (const line of s.body) body.appendChild(para(line));
  }
  built = true;
}

function close() { $('#helpModal').classList.add('hidden'); }

export function openHelp(editor: Editor, doc: Doc) {
  // Rebuilt only once: the language switch reloads the page, so the strings
  // cannot go stale underneath it.
  if (!built) build(editor, doc);
  else ($('#helpBody').querySelector('.help-select') as HTMLSelectElement).value = currentRoute() ?? '';
  $('#helpModal').classList.remove('hidden');
  $('#helpBody').scrollTop = 0;
}

export function wireHelp() {
  $('[data-act="close-help"]').addEventListener('click', close);
  // Escape closes it. A panel of prose with no visible way out is the thing
  // people reach for the browser's back button over.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#helpModal').classList.contains('hidden')) {
      e.stopPropagation(); e.preventDefault(); close();
    }
  }, true);
  $('#helpModal').addEventListener('click', (e) => { if (e.target === $('#helpModal')) close(); });
}
