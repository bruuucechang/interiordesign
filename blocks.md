# 區塊計畫：interior-designer 照度分析與全屋優化

> 一個 session 做一塊。做完跑驗收 → 打勾 → 寫 HANDOFF → 關掉開新的。
> 規格在 `docs/lighting-spec.md`；原型是「臥室燈光配置」artifact。

## B1 燈具資料欄位與照度引擎  [完成]
- 目標：燈有流明、配光、色溫、迴路可存；新增 T5 層板燈；一個純函式算任一點的照度與整間統計
- 驗收：`npm test` 綠（含 codegen 新鮮度）；`client/test/lighting.test.ts` 用 artifact 的「你的房間」配置算出整間平均 317±16、只開崁燈 130±7（桌面高度、ρ=0.45）
- 碰：`client/src/model/schema.ts`、`catalogue.ts`、`migrate.ts`（只在要破壞舊檔時才加 STEP）、`client/src/core/lighting.ts`（新）、`client/test/lighting.test.ts`（新）、codegen 產物
- 不做：畫面（B2）、區域與檢查（B3）

## B2 2D 照度圖層與面板  [完成]
- 目標：平面圖上開關「照度」圖層看熱圖與 100／200／300 等亮線、游標讀數；側邊面板有迴路勾選、量測高度、牆面顏色、每個房間的整間數字；屬性面板可改燈的流明、色溫、迴路、T5 尺寸與方向；拖燈即時重算
- 驗收：`npm test` 綠；`bench/verify-lighting.mjs`（新）用 dev-browser --headless 放兩盞燈、拖一盞，截圖看熱圖跟著動，重算一次 < 50 ms
- 碰：`client/src/core/renderer.ts`、`client/src/ui/`（新增 lighting-panel.ts）、`properties.ts`、`tools/place.ts`（T5 貼牆朝向）、`index.html`、`style.css`
- 不做：區域分析、健檢規則（B3）

## B3 區域、檢查與開法比較  [完成]
- 目標：自動區域（床、書桌、櫃子前、門口）與達標判斷；五條檢查接進空間健檢；每種迴路組合的平均／最暗／床／書桌表
- 驗收：`npm test` 綠，`health.test.ts` 每條新規則都有「該抓到」與「不該抓到」；dev-browser 截圖面板
- 碰：`client/src/core/lighting.ts`、`client/src/core/health.ts`、`client/src/ui/health-panel.ts`、`lighting-panel.ts`、`locale-defaults.ts`
- 不做：購買清單（使用者沒選）

## B4 平面圖照 PDF 修正  [完成]
- 目標：以 `img0199-restored` 為底另存一份新方案，牆、柱、門窗、房間照 `平面配置圖1151022.pdf`（1/60）對齊；原方案不動
- 驗收：新方案的外框與各房間尺寸對得上 PDF 標的數字（1374、1227、480/286/347、433/596…，誤差 ≤ 5 cm），健檢沒有新增「牆端沒接上」「門窗不在牆上」；並排截圖 PDF 與 App
- 碰：資料庫新方案（API 寫入，`data.id` 要等於網址 id）、`scripts/`（如需一次性腳本）
- 不做：家具與燈（B5、B6）

## B5 兩間臥室照 artifact 佈置  [完成]
- 目標：新方案裡右下（你的房間）與右上（主臥）的床、櫃子、書桌、T5、崁燈、迴路照 artifact
- 驗收：App 算出的兩間整間平均與各區域平均跟 artifact 差在 ±5%；截圖
- 碰：資料庫新方案
- 不做：其他房間（B6）
- 結果：11 項裡 10 項在 ±3.4% 內；Bruce 門口 −17.9% 是門在 55 cm 凹口裡、原型的長方形畫不出來（對照組 +0.4%）。順手做了照度外框內縮到牆面。表與重跑指令在 notebook「兩間臥室照原型佈置（B5）」

## B6 全屋排燈  [完成]
- 目標：客廳＋廚房、其他兩間臥室、兩間衛浴、陽台都排燈，各區域達標、沒有紅色檢查
- 驗收：每個房間的分析面板全綠或只剩「書桌加檯燈」這類提醒；寫一份每間的配置與數字摘要進 `docs/lighting-plan.md`
- 碰：資料庫新方案、`docs/lighting-plan.md`（新）
- 不做：購買清單、估價
- 結果：六個空間全部達標、面板零提醒（照 PDF 放 18 件家具、53 盞燈）。客廳／廚房／衛浴／陽台的目標是自己定的 CNS 下限（假設，寫在 lighting-plan.md）；流理台靠牆面 T5 檯面燈才到 300。B5 兩間的提醒（Bruce 崁燈離枕頭 28°）沒動，等使用者決定

## B7 軟體盤點  [完成]
- 目標：實際操作 App（畫牆、放家具、3D、存檔、出圖、照度）＋讀待辦與已知限制，列出介面、效能、程式結構的問題清單，每條附重現方式與建議
- 驗收：`docs/review-2026-10.md`（新）有清單；**交給使用者勾選要做哪些**，勾完把選中的寫成 B8 之後的區塊
- 碰：只讀、`docs/review-2026-10.md`
- 不做：任何修改（等使用者勾）
- 結果：清單 `docs/review-2026-10.md`；2026-10-23 使用者勾選結果寫在該檔最後一節，選中的拆成 B8～B13

## B8 介面擋路修正（U1～U4）  [完成]
- 目標：1920 寬頂列不溢出；照度面板與健檢面板同時只開一個；縮放至全部扣掉開著的面板；第一次存檔後網址補上 `?plan=<id>`
- 驗收：`npm test` 綠；新 bench 掃 1280～2000 寬確認 `scrollWidth === innerWidth`、兩面板不重疊、縮放至全部後所有牆在可見畫布內、存檔後 F5 回到同一份方案（dev-browser --headless 截圖）
- 碰：`client/src/style.css`、`client/src/ui/ui.ts`、`lighting-panel.ts`、`health-panel.ts`、`core/viewport.ts`、`ui/autosave.ts`、`bench/`
- 不做：外觀小修（B9）
- 結果：`node bench/verify-b8.mjs` 全過（U1 兩語言 × 12 寬＋頂列撐寬 400px、U2／U3 三寬、U4 存檔→F5→新建）；頂列改成自己量（`ui/topbar-fit.ts`），1920 中文放不下標籤（實量 2005px）會自動收；縮放控制多一顆「縮放至全部」

## B9 外觀小修（U5～U8）  [完成]
- 目標：3D 底部鍵帽與提示不重疊、開面板時提示置中於可見區；房名標籤不蓋住燈；方案名稱滑鼠移上去看全名；懸空牆端畫**封口細線**（使用者選的）
- 驗收：`npm test` 綠；dev-browser 截圖四處各一張
- 碰：`client/src/core/renderer.ts`、`view3d.ts`（只動提示排版）、`ui/ui.ts`、`style.css`
- 不做：其他牆端樣式
- 結果（2026-10-23）：`node bench/verify-b9.mjs` 全過，截圖在 `bench/results/b9-*.png`。
  U5 提示與鍵帽放進同一個 `.dock3d` 上下排，`--panel-inset` 讓它置中於照度面板左邊；
  U6 房間與底圖一律先畫、房名接著畫、其餘物件最後畫（以前只有開熱圖時這樣排）；
  U7 滑鼠移上去才補 `title`；U8 `wallEndCaps()`（`geometry.ts`）——轉角、T 字、柱子不畫。
  另外碰了 `geometry.ts`、`main.ts`、`ui/side-panels.ts`、`index.html`。
  headless 直接以 3D 開方案會停在空白方案（swiftshader 把主執行緒塞滿），驗收改成 2D 載入後切 3D。

## B10 3D 看得到燈＋實機量 3D 切換（S1、P1）  [完成]
- 目標：3D 畫出燈具外形（崁燈圓片、吸頂燈、T5 細長條、壁燈、吊燈），自發光材質，不加真的光源；在這台 Mac 的 Chrome 實量切 3D 的時間，> 200 ms 才另開優化區塊
- 驗收：`npm test` 綠；plan1151022 切 3D 截圖看得到天花板的燈；P1 的實量數字與重跑指令寫進 notebook
- 碰：`client/src/core/view3d.ts`、新增 `client/src/core/lights3d.ts`（純函式產幾何）＋測試
- 不做：即時光源、陰影、光照渲染

## B11 自動區域＋方案燈調整（S2、D4、D1＋D3）  [完成]
- 目標：流理台、洗手台等依家具自動生前方區域與達標值（目標值照 `docs/lighting-plan.md`「達標標準」放進 catalogue，使用者確認照 B6 定的）；plan1151022 挪開 Bruce 房離枕頭 28° 的崁燈、兩盞離櫃子 18 cm 的崁燈，挪完全屋仍達標
- 驗收：`npm test` 綠（新區域有「該生出」「不該生出」測試）；`node bench/verify-b6.mjs` 全屋達標、照明提醒只剩「書桌加檯燈」；改方案前先 `pg_dump` 那一列備份
- 碰：`client/src/core/lighting.ts`、`catalogue.ts`、`locale-defaults.ts`、資料庫 plan1151022、`docs/lighting-plan.md`
- 不做：子區域（B12）、家具位置（使用者裁示照 PDF 不動）、Bruce 書桌檯燈（D2 沒選）
- 結果（2026-10-23）：`roomZones()` 多了 `counter`（流理台面，量在檯面高度，≥300）與 `vanity`（洗手台前 60 cm，≥200），
  在 plan1151022 量到流理台 642／518、洗手台 221／216，跟 B6 腳本手定的一致，所以從 `report-b6.mts` 的 AREAS 拿掉。
  la5、la8 往東挪到離櫃 40 cm，la7 挪到偏離枕頭 36°（要 ≥40° 得連 la6 一起動，沒做）；備份在
  `~/Backups/interior-designer/plan1151022-before-b11-20261023T090055.sql`。B5 兩間仍有「30～40° 有點近」與「T5 在床頭後上方」的提醒（本來就有、不在 D1／D3）

## B12 房間內的子區域（S3）  [完成]
- 目標：可以在房間裡畫子區域（只算照度、不算面積），照度面板逐塊列；plan1151022 的「客廳＋廚房」切出玄關、走道、東側小廳、客廳、廚房
- 驗收：`npm test` 綠（schema 新欄位有遷移或選填、codegen 新鮮）；面板截圖逐塊有數字
- 碰：`client/src/model/schema.ts`、codegen 產物、`core/lighting.ts`、`ui/lighting-panel.ts`、繪圖工具、資料庫 plan1151022
- 不做：面積報表改算子區域
- 結果（2026-10-23）：新物件種類 `area`（矩形＋名稱＋選填 `lux`，沒填用 `LIGHTING.areaLux` 100），選填所以不用 STEP；
  照度面板「＋ 畫子區域」拖一個矩形，`roomZones()` 把中心在房間裡的子區域排在最前面、量在桌面高。只有外框點得到
  （裡面的家具、燈照樣點得到），不出圖、3D 不出現、面積報表不算。plan1151022 的「客廳＋廚房」切了五塊（座標在
  `furnish-b6.mjs` 的 `AREAS`）：玄關 170、走道 210、東側小廳 172、客廳 232、廚房 413，全部達標；`report-b6.mts`
  的 AREAS 拿掉、改讀方案。備份 `~/Backups/interior-designer/plan1151022-before-b12-20261023T091931.sql`。
  驗收 `node bench/verify-b12.mjs`。`verify-b10` 的「室內視角天花板」在負載 14 時紅過一次、重跑就過（固定等 4 秒）

## B13 報表 T5 分尺寸＋屬性面板型別整理（S4、S5）  [完成]
- 目標：面積報表電氣統計 T5 依尺寸分行；`properties.ts` 的 `as any` 換成依 kind 收窄的型別
- 驗收：`npm test` 綠；`grep -c "as any" client/src/ui/properties.ts` 降到個位數；匯出 plan1151022 的 Excel 看到 T5 分尺寸
- 碰：`server/app/report.py`＋測試、`client/src/ui/properties.ts`
- 不做：S7 英文翻譯、S8 牆厚上限（使用者沒選）；S6 拆 view3d 在 B14
- 結果（2026-10-23）：報表的 T5 計數 key 帶尺寸（「T5 4 尺」，沒填 `size` 算 4 尺，`report.py::T5_DEFAULT_SIZE` 對齊 catalogue），
  列名是「<label> N 尺」、label 空的用「T5」——一般放置的 label 是「T5 層板燈」，plan1151022 是腳本建的沒有 label，
  所以它的 Excel 是 T5 2 尺 ×1、3 尺 ×4、4 尺 ×14；`server/tests/test_report.py` 新測試先紅後綠，另一條測試把預設值釘在 catalogue.ts 上。
  `properties.ts` 的 `as any` 60 → 0：`up(of, patch)` 帶收窄過的物件，patch 型別是 `Partial<該 kind>`——
  故意在牆上寫 `lux`、T5 寫 7 尺，tsc 兩個都抓到（以前的 `Partial<Obj>` 牆寫 `lux` 會放行）。
  `node bench/verify-b13.mjs` 選牆／門／家具／子區域／T5 各改一個欄位全過，截圖 `bench/results/b13-*.png`；verify-b6、b12 不回歸。

## B14 拆 3D 程式（S6）  [完成]
- 目標：`view3d.ts`（1,068 行）、`furniture3d.ts`（999 行）照既有判準拆——「錯了不會有錯誤訊息」的運算抽成純函式並補測試，場景／相機／渲染迴圈留在原處；使用者 2026-10-23 說「3d程式可拆」
- 驗收：`npm test` 綠且新抽出的模組有測試；照 `.claude/rules/layering.md`「重構 3D 之後怎麼證明沒改壞」比對拆前拆後 plan1151022 的 3D 截圖一致；兩檔各降到 800 行以下
- 碰：`client/src/core/view3d.ts`、`furniture3d.ts`、新抽出的 `client/src/core/*.ts`＋測試
- 順便補：B10 審查留下的缺口——`view3d.ts::lightMesh()` 把 LightPart 轉成網格（`rotation.y = -angle`、scale 軸向）沒有測試，拆的時候抽成不需要 GL 的函式並補測試
- 不做：改 3D 的外觀或行為（只搬不改）；要在 B10（3D 畫燈）合併之後才做，避免兩塊同時改 view3d
- 結果（2026-10-23）：`view3d.ts` 1,109 → 757 行、`furniture3d.ts` 999 → 205 行，只搬不改。
  純函式（不 import three）：`view3dMath.ts`（太陽、直牆切盒與轉角延伸、曲牆掃掠、娃娃屋剖切與中線死區、取景、飛行軸、
  燈具零件的縮放與轉向）、`furnitureFit.ts`（材質名對應掃描、依佔地縮放、快取鍵）——`client/test/view3dMath.test.ts`、
  `furnitureFit.test.ts` 共 30 條，燈的負號與縮放的 min 故意改壞會紅 3 條。依職責搬出：`keys3d.ts`、`surfaces3d.ts`、
  `ghosts3d.ts`、`furnitureBuilders.ts`。轉角延伸改用 `geometry.ts` 既有的 `wallEndCounts`（原本就是同一套）。
  畫面：`node bench/verify-b14.mjs shoot before|after` ＋ `compare`，plan1151022 三視角平均差 0.0009／0.0066／0.0024，
  同一版重截兩次的雜訊底是 0.001／0.007／0.002。截圖要先等模型與掃描貼圖到齊（腳本裡做了），不然同一版自己就差到 10。
  搬出去的鍵盤與放置預覽：`node bench/verify-b14.mjs interact` 全過（按住 W 要數畫格不能數毫秒：swiftshader 一幀約 10 秒，
  master 上照舊寫法量也是 0 cm，不是回歸）。`npm test` client 536／server 142 綠；verify-b10 `--runs 0`、b12、b13 不回歸。

## B15 切 3D 壓到 200 ms 內（P1 後續）  [完成]
- 緣由：B10 實量這台 Mac 的 Chrome（GPU）切 3D 中位數 362 ms、再切一次 234 ms，超過 P1 的 200 ms 門檻；其中 `view3d.build()` 本身只佔 19 ms，下一格的陰影重畫與重新上傳沒分開量（`docs/notebook.md`「切 3D 的實機時間」）
- 目標：先錄 Chrome performance trace 找出建場景以外那 200～300 ms 是哪一段（後製 shader 編譯、貼圖上傳、版面重排），再對那一段下手；第二次以後的切換優先
- 驗收：機器安靜時跑 `node bench/verify-b10.mjs http://localhost:5181 --runs 7`，「再切一次」中位數 ≤ 200 ms；改前改後各量一次寫進 notebook；`npm test` 綠；B10 的 3D 截圖不變
- 碰：`client/src/core/view3d.ts`、`client/src/main.ts`（切檢視的流程）
- 不做：降畫質（拿掉 GTAO、降解析度）來換速度——要先問；要在 B14 拆完 view3d 之後才做，避免兩塊同時改
- 結果（2026-10-23）：再切一次 **160 → 28 ms**（負載 6～8，7 次中位數），沒降畫質。先在 WebGL 呼叫上掛計時找出那 140 ms：
  每次重建都**重編 6 個 shader 程式**（約 75 ms，卡在讀編譯結果）、**重傳 14 張牆／地板貼圖**（45～80 ms），建場景本身 9 ms、陰影 2 ms。
  兩個原因，兩個改法：(1) `clearStatic()` 在新場景畫出來之前就 dispose 舊材質，three.js 的程式與貼圖按參考次數管理，
  先歸零就被刪掉，下一格同樣的材質只好重編——改成退休清單，畫完下一格才釋放（`view3d.ts::releaseRetired`）；
  (2) `Texture.clone()` 會把**共用來源**的版本號加一，每個 clone 都讓同一張圖重傳——`textures3d.ts::tiled()` clone 後把版本號還原。
  驗收：verify-b10 新增「再切一次 ≤ 200 ms」檢查；`client/test/textures3d.test.ts` 3 條（把版本號改回會加一，紅 1 條）；
  B14 三視角截圖改前改後平均差 0.001／0.007／0.0023（雜訊內）；同一頁來回切四次每次截圖逐像素相同、貼圖／幾何／程式數持平（沒有洩漏）；
  `npm test` client 539／server 142 綠；verify-b10 `--runs 0`、verify-b14 interact 不回歸。
  **沒動的**：第一次切 3D 仍是 266 ms，其中約 270 ms 是第一次編 23 個 shader（冷啟動，不是重建）；要壓得在 2D 閒置時先編好，留給之後決定

## B16 靈敏度重調  [完成]
- 規格：`docs/spec-game-mode.md` 第一節（數字表在那裡）
- 目標：3D 轉視角、WASD、3D／2D 滾輪、2D 吸附、家具靠牆改成表上的值；Alt 暫停吸附；操作設定面板四條滑桿（localStorage）
- 驗收：`npm test` 綠；新測試釘 2D 滾輪縮放對 deltaY 成比例且每次事件封頂 ×1.1（改回固定 ×1.1 會紅）；headless 量按住 W 1 秒移動 250±30 cm
- 碰：`client/src/core/view3d.ts`、`view3dMath.ts`、`editor.ts`、`tools/draw.ts`、`tools/place.ts`、新 `ui/controls-settings.ts`
- 不做：介面重排（B20）
- 結果（2026-10-28）：新模組 `client/src/core/controlFeel.ts`（基準值、乘數存讀、2D 滾輪換算）＋ `ui/controls-settings.ts`（頂列滑桿圖示 → 四條滑桿、回復預設）。
  3D 轉速 0.5、阻尼 0.15、滾輪 0.5；WASD 固定 250 cm/s（`sceneFrame` 不再算速度）；**每幀 dt 封頂 0.1 s**——原本畫面卡一下按住 W 就一口氣飛出去
  （swiftshader 拿掉封頂實測 5 幀 21 m）。2D 滾輪 `exp(−deltaY·0.0008)`、每事件封頂 ×1.1：觸控板 40×2.5 px 一次滑動 ×1.083（舊版 ×45）、滑鼠 120 px 一格 ×1.10。
  牆端點吸附 14→10 px；按住 Alt 關掉格線、牆端點、家具靠牆；家具靠牆改量**背面到牆面的空隙 < 25 cm**（舊的量游標到牆中線 60 cm：淺層架離牆 40 cm 也被吸、深的床要插進牆裡才吸得到），轉角取空隙最小的那面。
  審查補：貼牆只認垂足落在牆身上（牆尾外的深床曾被轉成斜的）、曲線牆不貼（量弦會橫跨弧）；選取工具拖牆端點也改 10 px、Alt 也關掉角度鎖與拱高／尺寸的格線；
  飛行模式不加 Shift 加速（Shift 已經是下降，規格改寫，跑步留給行走模式）；「行走轉頭」滑桿標「上線後生效」；Windows 單按 Alt 不再把焦點交給瀏覽器選單（沒在 Windows 實測）。
  驗收：`npm test` client／server 全綠；`client/test/controlFeel.test.ts` 13 條，mutant「滾輪改回每事件 ×1.1」紅 3、「貼牆改回量中線」紅 2、「拿掉牆尾檢查」紅 1；
  `node bench/verify-b16.mjs` 8 項全過（mutant「拿掉 dt 封頂」紅 2），截圖 `bench/results/b16-settings.png`

## B17 2D 熱圖加牆遮擋  [完成]
- 規格：同檔第二節「2D」
- 目標：每盞燈到量測點的連線碰到牆就擋，門窗開口透光、隔間線不擋；反射項照舊每房自己算
- 驗收：關起來的房間跟原型數字差 ≤ 1%（`lighting.test.ts` 原有數字照過）；新增「隔壁燈從門口透過來」「L 形轉角後變暗」兩條，各自 mutant 紅一次；熱圖重算仍 < 50 ms（verify-lighting）
- 碰：`client/src/core/lighting.ts`、`lightzones.ts`、`client/test/lighting.test.ts`
- 不做：3D（B18）
- 結果（2026-10-28）：`lighting.ts` 新增 `shadeSegs`（每道牆的中線切成段，門窗是洞：門當開著、窗是玻璃；曲線牆切 12 段；
  牆的 `height` 以上不擋）、`wallBetween`（光線只算嚴格穿過牆身的交點，貼牆的燈不擋自己；穿過洞的高度要在窗台與門楣之間）、
  `reaching`（自己的燈＋隔壁亮到 ≥ 1 lux 而且有 40 cm 粗格點直線看得到的燈——封死的隔壁不算，拖它不會讓這間重算）。
  `lightRoom(…, openings)` 有給 openings 才開遮擋（不給＝原型的每房模型，舊測試照舊）；直射用 `near`、反射照舊只算自己的燈；
  開法比較（迴路組合）只比自己的燈。`lightmap`／`lightcheck`／照度面板都改用新的。
  驗收：`npm test` 綠；`lighting.test.ts` 新增「關起來的你的房間開遮擋 = 316.77／128.95（±1%）」；`lightmap.test.ts` 新增沒牆照得過去、
  門口透光、門楣擋光、L 形轉角變暗四條；mutant「不擋」紅 3、「門不透光」紅 2、「不看門楣」紅 1。
  **審查退回一次**：A1 單元上拖一盞燈 146 ms（隔壁的燈幾乎整層都算進每一間）。改法：
  (1) `reaching` 改看房間的「入口」（`portals`：外框每 10 cm，貼牆處只有門窗洞算、沒貼牆處算開放邊），隔壁的燈要有一條直線到某個入口
  （門窗都算——第二輪審查量到只准穿門會讓老媽房間少算 8.5 lux，而換了下面的上界之後穿窗也算只多 4 盞，效能不需要它）；
  距離上界改用配光算（`reachBound`：往下照的 cosⁿ 在旁邊房間的地板上是 I·Δzⁿ⁺¹/dⁿ⁺³，不是 I/ρ²；平面高度算到 120 cm 的檯面），
  **丟掉的燈上界加總 < 1 lux**（不是每盞各自 < 1：四十盞 0.9 lux 不是零）；A1 每間每個高度「全部燈都算」與「只算 near」最大差 0.85 lux；
  (2) 每盞燈對每間房的直射格點分開快取（`directGrid`＋`lightFloor` 的 `parts`，面板照格距各存一份），拖一盞只重算它自己的那幾份；
  格點在不在地板上每間房只判一次（`floorMask`）。另修：曲線牆切 14 段跟 `server/app/rooms.py` 的 `ARC_SEG` 一致（12 段時弧牆會擋暗自己旁邊那條地板）、
  曲線牆上的門窗照弧長分到它跨過的每一段（原本只打在中心那一段）、牆的接點放 1e-9（斜牆接點會漏光）。
  `npx tsx ../bench/b17-drag.ts <A1 匯出>`（client 底下跑）：拖燈中位數 20.7、p90 26.9、最慢 40 ms（改前 104／132／154）；
  推一扇門整層重算 156 ms（原本的引擎 52 ms——門牆一動全部的遮擋都要重算，只在開著照度面板拖門時遇到）；整層第一次算 251 ms。
  補測試 6 條（只照到門口一角的隔壁燈、窗出窗入夠亮也算、很多盞暗燈加總、弧牆不擋自己、弧牆門整寬是洞、斜牆接點不漏），各自 mutant 紅過。
  `node bench/verify-lighting.mjs` 數字項全過（原型區域 ±5% 內），但腳本後段點「關閉照度」逾時——
  **乾淨的 master 上同樣逾時**，是之前就壞的，留給 B20 改介面時一起修。A1 單元空間健檢 19 → 22 則（轉角與門口外變暗多出的照度提醒）。

## B18 3D 燈真的發光（距離衰減）  [完成]
- 規格：同檔第二節「3D」
- 目標：燈變光源、decay 2、流明換坎德拉、色溫換色；只亮所在房間＋門口連過去的房間，最近 4 盞投影子；黃昏／夜晚自動開、白天手動；迴路跟 2D 面板連動
- 驗收：夜晚 A1 截圖目視（燈下亮、往外暗、隔壁不亮）；換算函式有測試；verify-b10「再切一次 ≤ 200 ms」照過
- 碰：`client/src/core/view3d.ts`、新 `core/lights3dEmit.ts`（純函式）＋測試
- 不做：烘焙光照、全域光照
- 結果（2026-10-28）：純函式 `client/src/core/lightEmit.ts`（每盞燈 → 聚光燈：往下照的用 cosⁿ 的峰值 Φ(n+1)/2π、光錐切在 cosⁿ 剩 5%、上限 85°；
  T5／壁燈一盞放中間、朝它照的那面、峰值 2Φ/π²；色溫照 Tanner Helland 的黑體近似，沒填是 3000 K；乘維護係數 0.8，跟 2D 同一套數字），
  `lamps3d.ts` 管一個固定 12 盞的 SpotLight 池（前 6 盞投影子 512²，牆就是靠影子擋光）：只在開燈時加進場景（三的材質照燈數編譯，池子大小不變＝走動不重編；
  沒用到的燈調成 0 亮度、不設不可見——不可見的燈不算數，一樣會重編）。挑燈（`pickEmitters`）：看得到它照的那塊地板（燈下 1 m 高，不是燈本身，
  門楣擋住燈也看得到門口那片光）的優先、再照距離；在室內用相機位置、俯瞰用轉軸中心。`decay = 2`、場景單位是 cm 所以強度 ×10⁴，
  顯示增益 `LUX_GAIN = 1/80`、夜晚開燈時天空補光降到 30%（1/250 加原本的補光時開燈關燈看不出差別——截圖比過）。
  黃昏／夜晚自動開，頂列「開燈」鈕可以蓋過去（換時段就回到自動）；迴路跟照度面板的勾選連動（`CIRCUITS_EVENT`）。
  驗收：`npm test` 綠；`client/test/lightEmit.test.ts` 8 條（燈正下方 3D 的照度＝2D 的直射照度、T5 方向與峰值、光錐、迴路、色溫、挑燈看得到的優先、門口），
  mutant「峰值少乘 n+1」紅 1、「挑燈只看距離」紅 2；`node bench/verify-b18.mjs`（headless 用這台的 Metal；swiftshader 一幀超過 30 秒）6 項全過，
  截圖 `bench/results/b18-night-inside.png`（暖色、牆面往上漸暗）、`b18-night-overview.png`（中間幾間有光、被牆擋住）、`b18-night-off.png`；
  `node bench/verify-b10.mjs http://localhost:5181 --runs 7` 再切一次中位數 46 ms（正午不開燈，門檻 200）。
  **審查退回一次**（都修了，各補測試：`lightEmit.test.ts` 1 條、新 `lamps3d.test.ts` 3 條）：牆後的燈只准進投影子的位子（原本池子沒滿就拿牆後的燈補，
  第 7 盞以後沒影子、光直接穿牆）；燈全部刪掉或迴路全關時池子沒熄（挑出來是空的跟上次一樣是空的就跳過了）；人在哪一層改看相機那一層的地板
  （原本從 storeys[0] 起算，地下室會挑到 1F 的燈；站在 2F 屋裡用絕對高度判斷會被當成俯瞰）。
  **已知限制**：同時只亮 12 盞，俯瞰整間時遠處的房間是暗的；投影子的只有 6 盞，陰影圖 512²，牆邊可能有一點鋸齒（沒截圖確認）。

## B19 行走模式（含樓梯）  [未開始]
- 規格：同檔第三節
- 目標：3D 行走鈕／V；指標鎖定、滑鼠轉頭、WASD、Shift 跑；圓形角色撞牆沿牆滑、門開口可過；樓梯換層；2D 顯示位置
- 驗收：碰撞是純函式並有測試（直走撞牆停、斜走沿牆滑、穿門、窄門過不去、樓梯高度線性）；headless 在 A1 從客廳走進臥室（經門）截圖、對牆走 3 秒位置不穿過牆
- 碰：新 `core/walk.ts`（純函式）＋測試、`view3d.ts`、`keys3d.ts`、`main.ts`
- 不做：家具碰撞、跳、開門動畫

## B20 遊戲式建造介面  [未開始]
- 規格：同檔第四節
- 目標：頂列三區、底部型錄列（大分類→小分類）、屬性選到才出現、樓層鈕右下、語言統一、導覽不自動跳
- 驗收：1440×900、1280×800 截圖給使用者看；inspect-ui 掃不重疊；所有 `bench/verify-*.mjs` 跟著改並重跑通過；`npm test` 綠
- 碰：`client/index.html`、`style.css`、`client/src/ui/*`、`main.ts`、`bench/verify-*.mjs`
- 不做：家具名英文翻譯
