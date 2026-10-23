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

## B11 自動區域＋方案燈調整（S2、D4、D1＋D3）  [未開始]
- 目標：流理台、洗手台等依家具自動生前方區域與達標值（目標值照 `docs/lighting-plan.md`「達標標準」放進 catalogue，使用者確認照 B6 定的）；plan1151022 挪開 Bruce 房離枕頭 28° 的崁燈、兩盞離櫃子 18 cm 的崁燈，挪完全屋仍達標
- 驗收：`npm test` 綠（新區域有「該生出」「不該生出」測試）；`node bench/verify-b6.mjs` 全屋達標、照明提醒只剩「書桌加檯燈」；改方案前先 `pg_dump` 那一列備份
- 碰：`client/src/core/lighting.ts`、`catalogue.ts`、`locale-defaults.ts`、資料庫 plan1151022、`docs/lighting-plan.md`
- 不做：子區域（B12）、家具位置（使用者裁示照 PDF 不動）、Bruce 書桌檯燈（D2 沒選）

## B12 房間內的子區域（S3）  [未開始]
- 目標：可以在房間裡畫子區域（只算照度、不算面積），照度面板逐塊列；plan1151022 的「客廳＋廚房」切出玄關、走道、東側小廳、客廳、廚房
- 驗收：`npm test` 綠（schema 新欄位有遷移或選填、codegen 新鮮）；面板截圖逐塊有數字
- 碰：`client/src/model/schema.ts`、codegen 產物、`core/lighting.ts`、`ui/lighting-panel.ts`、繪圖工具、資料庫 plan1151022
- 不做：面積報表改算子區域

## B13 報表 T5 分尺寸＋屬性面板型別整理（S4、S5）  [未開始]
- 目標：面積報表電氣統計 T5 依尺寸分行；`properties.ts` 的 `as any` 換成依 kind 收窄的型別
- 驗收：`npm test` 綠；`grep -c "as any" client/src/ui/properties.ts` 降到個位數；匯出 plan1151022 的 Excel 看到 T5 分尺寸
- 碰：`server/app/report.py`＋測試、`client/src/ui/properties.ts`
- 不做：S7 英文翻譯、S8 牆厚上限（使用者沒選）；S6 拆 view3d 在 B14

## B14 拆 3D 程式（S6）  [未開始]
- 目標：`view3d.ts`（1,068 行）、`furniture3d.ts`（999 行）照既有判準拆——「錯了不會有錯誤訊息」的運算抽成純函式並補測試，場景／相機／渲染迴圈留在原處；使用者 2026-10-23 說「3d程式可拆」
- 驗收：`npm test` 綠且新抽出的模組有測試；照 `.claude/rules/layering.md`「重構 3D 之後怎麼證明沒改壞」比對拆前拆後 plan1151022 的 3D 截圖一致；兩檔各降到 800 行以下
- 碰：`client/src/core/view3d.ts`、`furniture3d.ts`、新抽出的 `client/src/core/*.ts`＋測試
- 不做：改 3D 的外觀或行為（只搬不改）；要在 B10（3D 畫燈）合併之後才做，避免兩塊同時改 view3d

## B15 切 3D 壓到 200 ms 內（P1 後續）  [未開始]
- 緣由：B10 實量這台 Mac 的 Chrome（GPU）切 3D 中位數 362 ms、再切一次 234 ms，超過 P1 的 200 ms 門檻；其中建場景只佔 19 ms（`docs/notebook.md`「切 3D 的實機時間」）
- 目標：先錄 Chrome performance trace 找出建場景以外那 200～300 ms 是哪一段（後製 shader 編譯、貼圖上傳、版面重排），再對那一段下手；第二次以後的切換優先
- 驗收：機器安靜時跑 `node bench/verify-b10.mjs http://localhost:5181 --runs 7`，「再切一次」中位數 ≤ 200 ms；改前改後各量一次寫進 notebook；`npm test` 綠；B10 的 3D 截圖不變
- 碰：`client/src/core/view3d.ts`、`client/src/main.ts`（切檢視的流程）
- 不做：降畫質（拿掉 GTAO、降解析度）來換速度——要先問；要在 B14 拆完 view3d 之後才做，避免兩塊同時改
