# 區塊計畫：interior-designer 照度分析與全屋優化

> 一個 session 做一塊。做完跑驗收 → 打勾 → 寫 HANDOFF → 關掉開新的。
> 規格在 `docs/lighting-spec.md`；原型是「臥室燈光配置」artifact。

## B1 燈具資料欄位與照度引擎  [完成]
- 目標：燈有流明、配光、色溫、迴路可存；新增 T5 層板燈；一個純函式算任一點的照度與整間統計
- 驗收：`npm test` 綠（含 codegen 新鮮度）；`client/test/lighting.test.ts` 用 artifact 的「你的房間」配置算出整間平均 317±16、只開崁燈 130±7（桌面高度、ρ=0.45）
- 碰：`client/src/model/schema.ts`、`catalogue.ts`、`migrate.ts`（只在要破壞舊檔時才加 STEP）、`client/src/core/lighting.ts`（新）、`client/test/lighting.test.ts`（新）、codegen 產物
- 不做：畫面（B2）、區域與檢查（B3）

## B2 2D 照度圖層與面板  [未開始]
- 目標：平面圖上開關「照度」圖層看熱圖與 100／200／300 等亮線、游標讀數；側邊面板有迴路勾選、量測高度、牆面顏色、每個房間的整間數字；屬性面板可改燈的流明、色溫、迴路、T5 尺寸與方向；拖燈即時重算
- 驗收：`npm test` 綠；`bench/verify-lighting.mjs`（新）用 dev-browser --headless 放兩盞燈、拖一盞，截圖看熱圖跟著動，重算一次 < 50 ms
- 碰：`client/src/core/renderer.ts`、`client/src/ui/`（新增 lighting-panel.ts）、`properties.ts`、`tools/place.ts`（T5 貼牆朝向）、`index.html`、`style.css`
- 不做：區域分析、健檢規則（B3）

## B3 區域、檢查與開法比較  [未開始]
- 目標：自動區域（床、書桌、櫃子前、門口）與達標判斷；五條檢查接進空間健檢；每種迴路組合的平均／最暗／床／書桌表
- 驗收：`npm test` 綠，`health.test.ts` 每條新規則都有「該抓到」與「不該抓到」；dev-browser 截圖面板
- 碰：`client/src/core/lighting.ts`、`client/src/core/health.ts`、`client/src/ui/health-panel.ts`、`lighting-panel.ts`、`locale-defaults.ts`
- 不做：購買清單（使用者沒選）

## B4 平面圖照 PDF 修正  [未開始]
- 目標：以 `img0199-restored` 為底另存一份新方案，牆、柱、門窗、房間照 `平面配置圖1151022.pdf`（1/60）對齊；原方案不動
- 驗收：新方案的外框與各房間尺寸對得上 PDF 標的數字（1374、1227、480/286/347、433/596…，誤差 ≤ 5 cm），健檢沒有新增「牆端沒接上」「門窗不在牆上」；並排截圖 PDF 與 App
- 碰：資料庫新方案（API 寫入，`data.id` 要等於網址 id）、`scripts/`（如需一次性腳本）
- 不做：家具與燈（B5、B6）

## B5 兩間臥室照 artifact 佈置  [未開始]
- 目標：新方案裡右下（你的房間）與右上（主臥）的床、櫃子、書桌、T5、崁燈、迴路照 artifact
- 驗收：App 算出的兩間整間平均與各區域平均跟 artifact 差在 ±5%；截圖
- 碰：資料庫新方案
- 不做：其他房間（B6）

## B6 全屋排燈  [未開始]
- 目標：客廳＋廚房、其他兩間臥室、兩間衛浴、陽台都排燈，各區域達標、沒有紅色檢查
- 驗收：每個房間的分析面板全綠或只剩「書桌加檯燈」這類提醒；寫一份每間的配置與數字摘要進 `docs/lighting-plan.md`
- 碰：資料庫新方案、`docs/lighting-plan.md`（新）
- 不做：購買清單、估價

## B7 軟體盤點  [未開始]
- 目標：實際操作 App（畫牆、放家具、3D、存檔、出圖、照度）＋讀待辦與已知限制，列出介面、效能、程式結構的問題清單，每條附重現方式與建議
- 驗收：`docs/review-2026-10.md`（新）有清單；**交給使用者勾選要做哪些**，勾完把選中的寫成 B8 之後的區塊
- 碰：只讀、`docs/review-2026-10.md`
- 不做：任何修改（等使用者勾）
