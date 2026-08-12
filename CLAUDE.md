# CLAUDE.md

## Overview

**室內設計 2D 平面圖繪圖軟體**。Canvas/TypeScript 的 2D 編輯器 ＋ three.js 3D 檢視，後端負責儲存、房間偵測、底圖牆體辨識與面積報表。

remote：`https://github.com/bruuucechang/interiordesign.git`。**全部開發直接在 `master`**，不開分支。

## Tech Stack

- **前端** `client/`：Canvas + TypeScript 2D 編輯器、three.js 3D，Vite :5180
- **後端** `server/`：Python + FastAPI，uvicorn :8791
- **資料庫**：PostgreSQL（`interior_design` 的 `floorplans` 表，方案存 JSONB）
- **桌面版**：PyInstaller 單一執行檔，內嵌 SQLite

後端依賴裝在 `.venv`——Homebrew Python 受 PEP 668 保護，不能全域裝。

## Build & Run

```bash
npm run setup:py     # 建 .venv 並安裝後端依賴（第一次才需要）
npm run dev          # server :8791 + client :5180
npm test             # 型別檢查 + codegen 新鮮度 + client tsx --test + server pytest
npm run codegen      # schema.ts → plan.schema.json → plan_schema.py
npm run backfill     # 把 DB 裡的存檔升到目前的 schemaVersion（預設 dry run）
npm run migrate      # SQLite → PostgreSQL 遷移
```

`npm test` 跑四關，任何一關紅就是紅。**型別檢查與 codegen 檢查掛在這裡不是裝飾**——這個 repo 沒有 CI，檢查只有掛在會被看到的地方才有用。`tsc` 之前只在 `npm run build` 裡跑，而且不涵蓋 `test/`。

**Docker**：`docker compose up --build` → http://localhost:**18791**（單一容器，FastAPI 同時發 API 與已建置前端，另加 postgres）。對外埠是 18791 不是 8791——8791 落在某些 Windows 機器 Hyper-V 的動態保留範圍（8712–8811）內，綁不上而且只給一個看不出原因的 permissions error。容器內仍是 8791。`docker-compose.dev.yml` 是熱重載開發模式 → :5180。arm64 與 amd64 都實際建置驗證過。

> Docker Desktop 裝在 `/Applications`（Homebrew cask 會卡 sudo，是手動從快取的 dmg 複製並清 quarantine）。CLI 在 `/Applications/Docker.app/Contents/Resources/bin`。

**桌面版打包**：`./build-desktop.sh`（macOS/Linux）或 `build-desktop.bat`（Windows）→ `dist/InteriorDesigner/`。PyInstaller **不能跨平台編譯**，要在每個目標平台各跑一次。進入點是 `server/desktop.py`：一個本機程序同時跑 API 與前端，存 SQLite 檔，開瀏覽器指過去——使用者不需要 Node、Python 或 PostgreSQL。瀏覽器就是視窗，這是為了維持單一執行檔刻意做的取捨（要原生外殼就得換 Tauri 或 Electron，是完全不同的建置）。

## 前後端分工

分界原則：**在滑鼠移動或每幀路徑上、或需要 Canvas/WebGL 的留在前端；其餘搬到後端。**

`plot.ts`／`exporter.ts`（PDF/PNG 出圖）在前端**不是例外**——它們要 Canvas（jsPDF 畫中文得先光柵化）。`report.py` 是純資料彙總所以在後端。同一條規則。

**前端 `client/src/`**
```
core/   geometry units hit snap viewport handles arrange transform wallEdit
        renderer view3d wallGeometry openings3d plot panorama perf
        exporter furniture3d materials textures3d resolution editor
model/  schema catalogue migrate ids doc
tools/  draw place select
ui/     ui.ts modals properties autosave feedback rooms-sync
net/    api.ts store.ts
data/   furniture electrical
```

`core/` 裡的純函式模組（`geometry` `units` `arrange` `transform` `wallEdit`
`wallGeometry` `openings3d` `snap`）**不碰 DOM、Canvas、document 或 doc**，所以能
直接測。改到它們就把測試一起改，不要為了省事把狀態塞回去。

`materials.ts` 是半純的：材質定義會畫進 canvas context，但**種子亂數、法線編碼、
人字拼的鋪法、平鋪次數都是純的**，那幾支是會安靜出錯的部分。three.js 綁定在
`textures3d.ts`。

**後端 `server/app/`**
```
routers/       HTTP 路由：projects reports compute dxf
schemas.py     request/response body（手寫）
plan_schema.py 存檔的形狀（codegen 產物，勿改）
plan.py        透過 plan_schema 讀存檔的那一層
rooms.py       房間偵測
detect.py      底圖牆體辨識（OpenCV）
report.py      面積報表（openpyxl）
dxf.py         DXF 匯入（ezdxf）
dimensions.py  尺寸標註
db.py main.py
```

**新東西放哪**：新 API 進對應的 `routers/*.py`；它的 request body 進 `schemas.py`；實際運算另開一支平級模組（像 `rooms.py`）。`main.py` 只放 app 建立、middleware、lifespan、靜態掛載。**不要加 `services/` 層**——那五支運算模組本來就是純函式，再包一層只是轉發。

## 存檔 schema：單一真相來源

`client/src/model/schema.ts` 是唯一真相，`npm run codegen` 把它變成 `schema/plan.schema.json` 再變成 `server/app/plan_schema.py`。兩個產物都 commit 進 repo，讀的人不需要工具鏈。

- **`schema.ts` 只放型別**。常數、catalogue、函式放 `catalogue.ts`——產生器只吃型別，值會被靜默丟掉。
- **後端不用 dict 存取讀存檔**。`report.py`／`dimensions.py` 走產出的 model，改 schema 忘了改後端會在 `npm test` 當場爆。
- `plan.Obj` 是手寫的 union（產生器把它 inline 進 `Floor.objects` 所以沒有名字）。`test_plan.py` 有一條測試把它釘在產出的型別上，加 kind 忘了同步會紅。

**寫寬鬆、讀嚴格。** PUT 用產出的 model 驗但**失敗照存只記 log**（`interior.plan` logger）——前端擁有 schema、本來就可能跑在前面，擋下來會弄丟使用者看得到的成果。讀取端相反：報表解析不了直接 422，因為空報表看起來像個答案。這個 bug 真的發生過。

### 版本與遷移

`Project.schemaVersion`（整數，現在是 1）。**遷移邏輯只有一份，在 `client/src/model/migrate.ts`**：

- `STEPS[v]` 把存檔從 v 升到 v+1，版本閘控、只跑一次
- `repair()` 每次載入都跑，處理「損壞」而不是「舊版本」——新增的預設圖層、指向已刪樓層的 `activeFloorId`
- 遷移步驟裡的歷史常數要**凍結**（例如 `LEGACY_CEILING_H = 270`），不要引用現在的值。遷移描述的是資料當時的意思。

改 schema 改到會 break 舊檔的流程：加一個 STEP → `SCHEMA_VERSION` +1 → `npm run codegen` → `pg_dump` 備份 → `npm run backfill`（先看 dry run）→ `npm run backfill -- --apply`。

回填腳本（`server/scripts/backfill_schema_version.py`）**不重寫遷移**，它把存檔餵給 `scripts/migrate-plans.ts` 跑同一份 TypeScript。它刻意不動 `updated_at`——遷移不是使用者在編輯，而專案列表是照這個排序的。

桌面版的 SQLite 檔回填腳本碰不到，靠前端載入時遷移，下次存檔寫回去。

## 離線鏡像不是快取

`client/src/net/store.ts` 是規則、`api.ts` 是流量。localStorage 每筆存 `savedAt`，**較新者勝**。

成立的前提是：**存檔成功時，鏡像記的是伺服器的時間不是瀏覽器的**，所以「本機比較新」精確等於「這次寫入沒送到」。刪除寫 tombstone，連線時由 `syncPending()` 補送——沒有 tombstone 的話，下次同步會把伺服器上那份當成別處新建的而復活。

`syncPending()` 從鏡像重播而不是從記憶體，所以上個 session 沒送出去的東西也會補送。掛在啟動時與 autosave 的 20 秒心跳。

- 沒有時間戳的舊鏡像（第一版的格式）一律判定為比伺服器舊，維持原本行為。
- API 的 `updatedAt` 是資料庫給的時區、**沒有標記**（這台機器差 UTC 八小時），只能顯示不能比較。要比較用 `updatedAtIso`。
- 已知限制：依賴兩端的 wall clock。單人單機成立。

## 重構 3D 之後怎麼證明沒改壞

單元測試釘得住 `wallGeometry` 的分段座標，但釘不住「畫出來一不一樣」。做法是把
同一份平面圖在改動前後各截一張圖，用像素比：

```bash
git stash / git checkout <檔案>    # 切回舊版，重載頁面，截圖
# 還原新版，重載，再截一張
.venv/bin/python -c "
import cv2; a=cv2.imread('after.jpg'); b=cv2.imread('before.jpg')
d=cv2.absdiff(a,b); print(d.mean(), (d.max(axis=2)>8).mean()*100)"
```

拆 `wallGeometry` 那次量到平均絕對差 0.005／差異 >8 的像素 0.003%——那是 JPEG 雜訊的
量級。WebGL 截圖**不可能逐位元組相同**，所以別用雜湊比。

## 量測與浸泡測試

`bench/` 底下的東西都是 headless Chromium（Playwright）。**必須 headless**：
四宮格終端機會把 Chrome 完全遮住 → `visibilityState === 'hidden'` → rAF 一秒 0 次，
之前每一次想在真視窗裡量都不是 timeout 就是量到凍結的畫面。headless 沒有視窗可以
被遮，而且沒有 vsync——一幀有多長就是裡面有多少工作，那正是要降的量。

```bash
npm run build                      # bench 吃的是 client/dist，先建
node bench/soak.mjs --minutes 500   # 八小時浸泡，每 5 分鐘一筆 jsonl
node bench/report.mjs               # 判讀最新那份
node bench/drag.mjs --selected 8    # 一次拖曳花掉幾次全畫面重繪
node bench/shot.mjs [--wall]        # 每種材質各渲一張 3D 圖
node bench/shot2d.mjs               # 平面圖的材質填充並排
node bench/shot-split.mjs           # 三種檢視模式
node bench/verify-wall.mjs          # 端對端：基準線／對齊／分割
node bench/verify-partition.mjs     # 端對端：隔間線（**需要後端在 :8791**）
node bench/coldstart.mjs            # 第一次進 3D 的成本（含預熱前後對照）
```

`?perf=1` 才會開儀器（`core/perf.ts`）並把 `window.__app` 掛出來；一般載入什麼都不露。

**判讀浸泡結果時的兩個陷阱**，兩個我都踩過：

- **heap 要看「回收後的底線」，不是頭尾兩筆。** 它在回收之間本來就是鋸齒，拿兩個
  任意取樣點比較會報出 +52% 的假漏。`report.mjs` 比的是前四分之一與後四分之一的
  最小值
- **只有變差才該是警告。** 第一版對兩個方向都標 ⚠︎，於是「快了 43%」旁邊也有個
  警告符號——一份會對好消息示警的報告，會訓練你跳過所有警告

最近一次八小時（100 個週期）：2D 每幀中位數 0.8–1.4ms、heap 底線 24.8MB 零成長、
DOM 節點恆定、零錯誤。

**3D 重建那 8/100 個 >60ms 的尖峰追過了，結論分兩半。** 冷啟動查清楚並修掉了
（見下）。剩下的尖峰**沒有重現**：隔離量測下重建是 p50 2.7ms，加 16 件家具
（416 個 mesh）也只到 4.8ms、max 21ms。它們只在真實互動的競用下出現。沒診斷
清楚就不要動它。

### 貼圖生成：畫 canvas 不要逐格 fillRect

地毯原本的 albedo 逐格畫 512²×0.9 ≈ 236,000 次 `fillRect`，height 再 ×2.4 ≈
629,000 次——單一材質八十幾萬次呼叫、實測 **1022ms**。改成
`getImageData` → 直接寫像素 → `putImageData` 之後是 67ms。全部 13 種材質從
2785ms 降到 309ms。

**改寫時把混色算法弄錯過一次**：舊版是「往白或黑混、alpha 最多 0.08」，在亮面
上一格只動約一階；寫成固定 ±20 階就強了十倍以上，每面乳膠漆牆都變成砂紙。
單元測試看不出來（貼圖照樣產生、照樣有紋理），只有 `bench/shot.mjs` 渲出來看
才知道。**改材質一定要重新渲圖看過。**

在這之上，`main.ts` 的 `warmFinishes()` 在載入後閒置時預先建好這份平面圖
**實際用到的**材質，一個 idle callback 一個。第一次 build 因此從 2639ms 變成
4ms——但**成本是被移走不是消失**，預熱本身仍是 309ms，拆成 13 塊、最大一塊
67ms。`coldstart.mjs` 會把這三個數字一起印，就是為了不讓「99% less」蓋掉它。

## 這些坑踩過了，別重犯

### 量效能之前先讓機器安靜下來

**效能沒有問題，別再查了。** 兩次深入量測都是這個結論：穩態頂到 vsync（58.7fps），Retina 全螢幕每幀 3.32ms，餘裕五倍。所謂「暖機慢」實測是**單一一幀 100～156ms**，第 2 幀起就穩定。`renderer.compile()` 試過反而更慢（188ms vs 115ms），因為貴的是 post-processing 的 GTAO shader，不是場景材質。

曾經**兩次把負載噪音誤判成效能問題**（一次是 GTAO，一次是「前 10～20 秒 10～26fps」）。成因都是量測當下機器上同時跑著多個 claude 程序。要量就先確認機器安靜、暖機後多輪交錯、看中位數。

真實資料規模：146 份存檔，**最大的只有 13 個物件**。物件數量不是效能維度。

### rAF 在背景分頁被暫停

`await new Promise(r => requestAnimationFrame(r))` 會直接卡死，量 FPS 也會量到 0。**一律用 `setTimeout`。** 這個坑在同一個 session 踩了三次。

### jsPDF

預設 `compress: false`——單張 A4 21.9MB，開壓縮後 89KB。**兩條匯出路徑都要記得開**：
`plot.ts` 一直有，`exporter.ts` 漏了，實測快照 PDF 是 20,864,540 bytes（同一張畫布
存成 PNG 只有 130KB），加上旗標後 48,529。

內建字型**不支援中文**，中文要畫成光柵再貼上（`plot.ts` 的 `textTile()`）。驗證方式是
看產出的 PDF 裡有沒有 `Tj`／`TJ` 文字指令——施工圖 PDF 一個都沒有，全部是影像物件，
所以中文不可能走到不支援它的字型那條路。

### 要看 PDF 產出長怎樣，不要靠瀏覽器

Chrome 的 PDF 檢視器是獨立程序，視窗被遮住時不合成，截圖只會拿到一片空白（同
[rAF 那一節](#在這台機器上驗-3d-一定要先確認-raf-有在跑) 的根源）。把檔案寫到磁碟後用
macOS 內建的 Quick Look 轉圖最快：

```bash
qlmanage -t -s 2000 -o <輸出目錄> plot.pdf     # 產出 plot.pdf.png
```

（我曾試著在頁面裡手刻 PDF 的 inflate ＋ PNG predictor 解碼去挖出內嵌影像，走到一半
就卡住，而且完全沒必要。）

### three.js

- tone mapping **只在輸出到畫布時套用**，render target 不會
- `transmission` 材質（玻璃）碰到**被它包住的幾何**會整片變黑。玻璃門原本是一整塊
  實心門扇外面套一個更深的玻璃盒，結果不是門變黑而是**整個 3D 檢視什麼都不畫**。
  盒子只相加不相減，要挖洞就得把門扇做成框料（見 `buildDoor3D` 的 glass 分支）。
  同一個材質在窗戶上沒事，因為那是薄片、沒有包住東西。

### 在這台機器上驗 3D 一定要先確認 rAF 有在跑

**四宮格終端機會把 Chrome 完全遮住 → `visibilityState === 'hidden'` → rAF 一秒 0 次。**
於是渲染迴圈整個凍結：WASD 的按鍵**有**進到 `pressed`（指示燈會亮，那是 DOM 事件），
但 `applyFly` 從來沒被呼叫；連切到 3D 時的自動框景也不會跑，相機一直停在 (0,0,0)。

這個坑會偽裝成程式錯誤。實測時先跑這一行，0 就別再往下推論：

```js
let n = 0; const t0 = performance.now();
(function tick(){ n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); })();
setTimeout(() => console.log(n, document.visibilityState), 1200);
```

**繞法**：全景拍攝、GLB 匯出這類「明確的繪製呼叫」不靠 rAF，凍結也照跑。把
view3d 實例臨時掛上 window、直接設 `camera.position` 再呼叫 `capturePanorama()`，
就能驗到室內全景——實測可行（四面牆、地板、家具、玻璃門透光都在）。要驗動畫、
轉場、手感則非請使用者把 Chrome 點到前景不可。

### OpenCV 5

`HoughLinesP` 回傳 `(N,4)`，不是舊版的 `(N,1,4)`。

### grep 要加 `-a`

`ui.ts` 曾有 NUL byte，讓 grep 靜默跳過整個檔案。已修，但養成習慣較保險。

## DXF 匯入

`app/dxf.py` + ezdxf。兩階段：`/api/dxf/inspect` 列出圖層供勾選 → `/api/dxf/import` 轉成牆。

四個必須做對的地方：

1. **雙線牆合併成中心線並量出厚度**——不合併的話，房間偵測會把牆心夾層當成房間
2. **Y 軸翻轉**——DXF 是 Y-up
3. **座標平移到原點**——地籍座標可能落在 250000,130000
4. **單位**——`$INSUNITS` 常常是 0，猜錯差 1000 倍，所以對話框會顯示換算後的實際公尺數讓使用者確認

ARC 與 polyline bulge 轉成曲線牆。

## DWG：確認不做

LibreDWG 0.13.3 實測：R2010/R2018 完全讀不了（READ ERROR 0x100），R2000「成功」轉出的 DXF 實體數是 0。已改成在使用者選 `.dwg` 時顯示轉檔指引。**不要再嘗試 LibreDWG。**

## 待辦與已知限制

- 進行中的模式：**把「錯了不會有錯誤訊息」的運算從有狀態的類別裡抽成純函式再測**。
  已抽出 `core/wallGeometry.ts`（牆體開口分段）、`core/openings3d.ts`（門窗模型）、
  `core/arrange.ts`（複製／對齊／均分）、`core/transform.ts`（拖曳把手的幾何）、
  `core/units.ts`（公分／公尺換算）、`core/materials.ts`（材質與法線）、
  `core/wallEdit.ts`（基準線／對齊／分割）。判準是失敗長什麼樣：**照樣跑完、
  看起來合理、沒有例外、結果是錯的**——對齊往反方向靠、複製出來的群組拖到原件、
  面積差 100 倍。純粹「行數多」不是理由
- **但純函式測不到接線。** 這一輪有兩個 bug 只有端對端抓得到：空白鍵根本沒傳到
  畫牆工具（被既有的「按住平移」吃掉），以及浸泡測試點的按鈕早就不存在了而它
  一直在「通過」。`bench/verify-*.mjs` 就是為這一類存在的
- `view3d.ts` 834 → 720、`editor.ts` 312 → 265、`select.ts` 221 → 195
- 仍無測試：`renderer.ts`、`furniture3d.ts`、`view3d.ts` 剩下的部分、ui 層。
  前三者剩下的是場景、相機、渲染迴圈與貼圖，沒有可以單獨測的東西，要驗只能實際看
- 目前 client 212 個測試、server 108 個
- 底圖牆體辨識：文字會殘留短碎片、虛線牆會斷成多段。**這兩者互相衝突**（修一個會惡化另一個），程式與測試中都已註明
- 電氣迴路連線是市場缺口，但使用者明確表示**不做估價，也暫不做迴路**
