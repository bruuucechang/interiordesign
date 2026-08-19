# CLAUDE.md

> 2026-08-13～19 那段（描圖、素材、3D 品質）的來龍去脈在
> **[`docs/worklog.md`](docs/worklog.md)**——這份講「現在長怎樣」，那份講「怎麼走到這裡、哪幾次判斷錯了」。

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

**用 API 直接塞方案進去時，`data` 裡一定要有 `id`，而且要等於網址上的 id。**
`saveProject` 是拿 `p.id` 當寫入位址的，少了它 App 會在第一次 autosave 自己生一個
`proj_…`——於是使用者從 `?plan=xxx` 開圖、改完、存檔，東西跑到一個誰都不知道的新
id 去，兩邊都以為對方弄丟了。實際發生過。`scripts/trace-0199.mjs` 現在會寫 `id`。

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

### 實拍貼圖：28 種材質，27 種是 CC0 掃描圖

`client/public/textures/<id>/{color,normal,arm}.jpg`（color/normal **1024²**、
arm 512²），由 `scripts/fetch_textures.py` 抓，27 種共 8.6MB。兩個來源都是
**CC0 1.0**（公共領域、可商用、不需署名——選它們就是為了散佈時沒有東西要遵守）：

- **Poly Haven**（25 種）：全站都是實地掃描
- **ambientCG**（2 種）：只挑 `PBRPhotogrammetry`

只有 13 種在 `materials.ts` 裡有完整的程式生成器，那是掃描圖出現之前就寫好的；
後來加的 15 種走 `scanned()`，備援只是色票平鋪加雜訊。**那個備援不是要畫出材質**
——它只在掃描圖到之前顯示幾百毫秒，以及當作 2D 的色票來源。色票值是掃描圖自己
的平均色，由抓取腳本算出來寫進 manifest 再抄進 TS，所以平面圖跟 3D 不會各說各話。

**第一版整批用 ambientCG，結果很簡陋，原因不是解析度。** 那批挑到的十二個全部是
`creationMethod: PBRProcedural`——ambientCG **自己程式生成**的材質（站上 1412 個
是生成的、只有 351 個是實拍）。等於把這個專案的 procedural 換成別人的 procedural。
**挑 ambientCG 的資產一定要看 `creationMethod`。**

`terrazzo` 是刻意的例外：兩個站都沒有掃描過的磨石子（Poly Haven 的
`terrazzo_tiles` 渲出來是一片素褐色，看不到石粒），而 ambientCG 那個生成的
`Terrazzo005` 渲出來是對的。`carpet` 與 `wallpaper` 用 ambientCG 也是因為
Poly Haven 全站只有一個 `dirty_carpet` 和一個 `decrepit_wallpaper`。

四件容易做錯的：

- **`NormalGL` 不是 `NormalDX`**。three.js 用 OpenGL 慣例（綠色朝上）。拿錯的話
  每一個凹凸都會反過來，而且不會有錯誤，只是光打錯邊——錯得剛好夠像對的
- **ARM 一張圖餵三個插槽**。Poly Haven 出的 `arm` 是 AO 在 R、roughness 在 G、
  metalness 在 B，正好是 three.js 取樣的方式，所以 AO 是白拿的。ambientCG 那兩個
  在腳本裡手動打包成同一個排列，App 只要認識一種慣例
- **`aoMap` 預設讀第二組 UV**，而這些面只有一組。不設 `texture.channel = 0` 的話
  它安靜地什麼都不做——沒有警告、沒有錯誤，只是比檔案該有的樣子平
- **有 `roughnessMap` 時 `roughness` 是乘數不是值**。原本每種材質的 `roughness`
  常數是當絕對值調的，留著會把每張掃描圖依它宣告的霧面程度再壓暗一次
- **`dimensionX`／`dimensions` 是掃描圖的真實尺寸**（Poly Haven 給的是公釐），
  manifest 有存，它比 `tileCm` 誠實——後者是為了讓「畫出來的圖案」好看而挑的

**縮圖會騙人，一定要看渲染。** 站上的縮圖是打過光的球，明度完全不可信：
WoodFloor048 縮圖看起來是胡桃木、渲出來近乎全黑；Concrete034 看起來是灰色水泥
粉光、渲出來是白的；Carpet014 看起來有織紋、渲出來一片平；Fabric012 看起來是
灰亞麻、渲出來是深海軍藍；floor_tiles_02 看起來是白灰大理石、渲出來是髒的米黃。
**五個都是 `node bench/shot.mjs` 才抓到的。**

`paint`（乳膠漆）刻意**不用**掃描圖：兩個站的 plaster 都是粗糙粉光，貼到牆上在
室內尺度就是砂紙——跟前面那個混色 bug 一模一樣的結果。

載入是非同步的而 `surfaceMaterial()` 是同步的，規則是**呼叫端一定馬上拿到材質**：
掃描圖到了就給掃描圖，還沒到就給程式生成的，到了之後 `onTexturesReady` 讓 3D
重建。絕不阻塞，也絕不回傳沒有貼圖的材質。

**這件事讓兩個量測工具開始說謊，兩個都修了。** `coldstart.mjs` 原本包住
`requestIdleCallback` 計時，`warmMaterial` 一改成非同步就回報「預熱 0 塊、0ms」，
看起來像免費了——改成量 `longtask`（它量的是主執行緒被佔住這件事本身）。
`shot.mjs` 原本固定等 1600ms 就截圖，會截到程式生成的備援那一幀，圖照樣產出、
看起來也合理，只是拍的不是要驗的東西——改成先等該材質的三個檔案進
`performance.getEntriesByType('resource')`。順帶：`locator.screenshot` 會等元素
「穩定」，而貼圖到齊觸發的重建剛好讓它永遠等不到，改用 `page.screenshot` + clip。

**兩支量測工具的材質清單原本也是各抄一份的**，於是新增材質不會被渲圖看過、
「全部材質都用上」這個前提也會安靜變成假的。兩支都改成向 App 要
（`?perf=1` 下 `__app.floorMaterials/wallMaterials`），找不到就丟例外。

實測（28 種全用上）：預熱 0 次主執行緒佔用，82 個檔 8.6MB 在 1230ms 到齊；
第一次 build 沒預熱 456ms、預熱後 8ms。

### 程式蓋出來的家具：六個材質原型，五個貼掃描圖

17 件家具是實掃模型，其餘 18 件是程式蓋的，門也是。它們原本全是純色。做法不是
一件一件貼，而是**在材質原型上貼**——`furniture3d.ts` 的六個原型各對一張掃描圖，
所有建構程式自動跟著換：

| 原型 | 掃描圖 | 取顏色？ |
|---|---|---|
| `woodMat` | `veneer_oak` / `veneer_walnut`（1m 木皮） | ✔ 木頭的顏色就是木頭 |
| `stoneMat` | `granite` | ✔ 石材的顏色就是石材 |
| `fabricMat` | `weave`（麻布）／`carpet`（地毯） | ✘ 只取織紋 |
| `metalMat` | `metal_brushed` | ✘ 只取拉絲 |
| `ceramicMat` | 刻意不貼 | — |
| `glassMat` | 不需要 | — |

**顏色取不取是關鍵。** 沙發是海軍藍、植栽盆是綠的、家電是石墨灰——那些顏色是刻意
選的。布料和金屬只取 normal 與 roughness，取了顏色會把整個目錄漆成同一個米色。
木皮和石材相反，它們的顏色本來就該來自掃描圖。

**陶瓷刻意不貼。** 上釉的瓷器本來就是光滑無特徵的鏡面，而兩個圖庫裡每一張「陶瓷」
都是**磁磚**，帶著填縫和磨損。貼到馬桶上是在加不存在的髒污，比平白色更糟。

`applyScan(material, id, wCm, hCm, { colour })` 在 `textures3d.ts`。它不能走
`surfaceMaterial`：那個函式自己擁有材質，而這些建構程式已經帶著各自的 clearcoat 與
roughness 做好了，那正是漆面門看起來像漆面的原因。三件事：

- **`wCm`/`hCm` 是這個材質主要覆蓋的那一面**。Box 的每一面 UV 都是 0..1，不給
  repeat 的話一張木皮會同樣地被拉滿 244cm 的餐邊櫃和 40cm 的抽屜
- **取顏色時 `color` 要設成白色**。有 map 時它是乘數——留著原本的棕色會把棕色木皮
  乘成接近黑色，跟 `roughness` 在有 `roughnessMap` 時變成乘數是同一個陷阱
- 材質是所有 clone 共用的，所以貼圖晚到不需要重建場景

**木皮的名字不可信，要看貼圖本體。** `american_walnut_veneer` 和
`natural_walnut_veneer` 掃出來都是**灰色**的，`mocha_oak_veneer` 也是。可用的是
`walnut_veneer`（#8a6950，暖棕細直紋）。判斷方法不是縮圖也不是名字，是把 1k 的
Diffuse 抓下來直接看。

**拉絲金屬是 procedural 合理的少數情況**：它本來就是機械加工的規則紋理，而
ambientCG 的 135 個 Metal 只有 1 個是實拍。

### 家具與裝潢素材：197 件（170 件 CC0 模型 ＋ 27 件參數化）

`client/public/models/<catalogueId>/`（glTF ＋ .bin ＋ 貼圖，共 41MB），由
`scripts/fetch_models.py` 從 **Poly Haven** 抓，同樣 **CC0 1.0**。目錄 197 件裡 170 件有模型：Poly Haven 90 件（實掃）、Quaternius 55 件、Kenney Furniture Kit 25 件
（`scripts/fetch_kenney.py`，同樣 CC0）。程式蓋的家具建構程式已經沒有任何一個會被
用到——它們留著只當備援。

**風格是靠「同一類多抓幾件」做出來的，不是靠參數。** 一把椅子只能有一種樣子——
它就是被掃下來的那一把。所以要彩繪鄉村、工業、古典、中式、金屬這幾種調性，唯一
的辦法是每一類各抓一件實掃：`chair_painted`／`chair_country`／`chair_school`／
`chair_plastic`、`coffee_classic`／`coffee_industrial`、`cn_stool`／`cn_sofa`／
`cn_commode`、`rack_metal`／`stool_low`／`stool_tall`。目錄尺寸**直接用模型量到的
真實尺寸**（POSITION accessor 的 min/max），不是我估的——猜尺寸就是廚櫃渲成 54cm
的那個坑。

**models/ 不在 repo 裡，要的人自己抓。**

```bash
npm run assets        # Poly Haven 90 件 + Kenney 37 件，約 41MB，跑一次就好
```

41MB 進 git 的代價是每個 clone 都要付，而它不是每個人都需要——所以 `.gitignore`
擋掉整個 `client/public/models/`，只留 `scripts/fetch_*.py` 這個可重現的來源。
**貼圖（`client/public/textures`，10MB）留在 repo 裡**：牆、地板、每一個表面都要用，
沒有它整個場景就是素色，不存在「有需要的人」這種區分。

**沒抓的話會怎樣——說清楚，因為它不會報錯。** app 照常跑：`loadFurnitureModel`
每一件都回 false，改用這支檔案自己蓋的幾何，面板退回畫出來的圖例。但**那不是等價
的替代品**：只有早期那 ~55 件有手寫幾何（沙發、衣櫃、家電），後來以模型為前提加的
七十幾件退回去就是一個素方塊。整個目錄渲一張出來是三分之二的無特徵塊體——會動，
只是看起來沒設計過。所以 `manifest()` 找不到檔案時會在 console 印一行說明：這種
畫面很容易被當成「這個 app 就長這樣」，而不是「少跑一個指令」。

`bench/furniture.mjs` 的 manifest 對照也分兩種情況：整包沒有是「還沒下載」，
少了幾筆才是 bug（那是 `fetch_models.py` 曾經抹掉 Kenney 21 筆的那個坑）。

全部都是 1k 貼圖版、超過預算的會自動降到 512/384/256，已經是最省的一檔；
再小就要動到幾何。

### Poly Haven 抓乾了，所以第三個來源與參數化櫃體

**實掃這條路走到底了。** Poly Haven 的 `furniture` 分類 85 件用掉 77，剩下 8 件是
戶外的。更關鍵的是**全站沒有第二個衣櫃**——櫃體類 26 件用掉 22，剩咖啡推車、書、
時鐘、工具車。ambientCG 的 300 個模型裡家具 **0 件**。攝影測量是「誰剛好去掃了
什麼」，所以它給的是「每樣一件」，而面板要的是「同一樣好幾款」。

兩個補法，各補各的短板：

**一、參數化衣櫃（`wardrobeModel`）14 款。** 箱型家具的款式全在**正面**，而正面是
平的：對開／三門／四門、推拉、開放（有吊桿、摺衣、掛著的衣服）、鏡面、含頂櫃、
白／灰／橡木／胡桃。面板貼的是跟其他家具同一批實掃木皮，所以它們跟掃描模型站在
同一個房間裡不會像另一個 app。白與灰是**噴漆板不是木皮**——那種材質真的就是平的，
把木紋貼上去是無中生有。目錄裡標 `proc: true`，`bench/furniture.mjs` 才知道它們
沒有 manifest 條目是刻意的、不是那個「21 件安靜退回方塊」的 bug。

**二、Quaternius（CC0，`scripts/fetch_quaternius.py`）。** 它是成套的：Closet /
ShortCloset、BedDouble / BedTwin / Bed_King、十二款沙發。三個代價都寫在腳本開頭：
沒有貼圖（材質名是語意化的，`dressFlat()` 按名字掛實掃圖，跟 Kenney 同一套）、
只有 FBX/OBJ（trimesh 轉 GLB，不需要 Blender）、**模型尺寸不是真實尺寸**——衣櫃在
模型單位裡 2.98 高、雙人床 4.26 長，約兩倍。所以這個來源的目錄尺寸是**照真實家具
填的**，跟 Poly Haven「讀模型自己的包圍盒」正好相反。搞混就是 180cm 廚櫃渲成
54cm 那個坑的反面。

**下載走 Google Drive，會被限流。** 抓一整包通常中途就開始回
`Cannot retrieve the public link`，腳本可續傳，過一陣子再跑就補上。第一版寫成
一個檔失敗就 `break`，於是每次都停在同一個 `.mtl`，後面四十幾個 `.obj` 一次都
沒試過——看起來像整包被鎖死，其實是我自己不再問。

**抓取腳本會自己補 `furniture.ts` 的目錄列**（`sync_catalogue()`）。前兩批都栽在
同一件事：`.glb` 和 manifest 都到位，但目錄沒列，面板就是看不到，而那不會報錯，
只是一個「沒有」。同一輪寫出來，兩邊就不可能脫鉤。

### 「看起來不是粗略生成的」——只能用看的

`bench/shot-items.mjs` 把目錄分批拉近渲染（預設一批 24 件，相機貼著看）。
`bench/furniture.mjs` 那張全目錄圖適合看「有沒有東西不見了、比例有沒有錯得離譜」，
但每件只有幾十個像素，**看不出材質**。判斷「這件看起來像不像程式硬生出來的」沒有
別的辦法，只能拉近看每一件。

看下來結論很集中：**粗糙的就是 Kenney 那批。** 它們是平面著色的低多邊形，離遠看
是家電，離近看是玩具——而那正是使用者說的「粗略生成」。所以家電、衛浴、床這幾類
**沿用原本的 catalogue id 換成 Quaternius**（就地換掉，不是新增，這樣既有存檔裡的
物件不會失效）。Kenney 從 37 件降到 25 件，只留兩邊都沒有更好版本的那些。

**貼圖也查了創建方式，不是只看好不好看。** ambientCG 的 API 有 `creationMethod`：
`terrazzo` 用的 Terrazzo005 是 **PBRProcedural**，換成 Poly Haven 的
`terrazzo_tiles` 實掃。剩下唯一一張 procedural 是 `metal_brushed`——ambientCG
全站 2000 個材質只有 352 個實拍，其中 **Metal 只有 1 個**（MetalWalkway014，是
一塊格柵走道板，不能拿來當家電面板）。拉絲金屬本來就是機械加工的規則紋理，
這是 procedural 合理的少數情況，但它是**唯一**一張，而且理由寫在這裡。

**還是有東西沒辦法變好看，說清楚比較實在**：冰箱、浴缸、浴櫃即使換成 Quaternius
也還是素的。CC0 圖庫沒有任何一件實掃的家電或衛浴——沒有人拿浴缸去做攝影測量。

### 「全部貼皮」是可以驗的，所以就去驗

`bench/verify-textures.mjs` 把目錄裡**每一件都實際建出來**（該載模型的載模型、該
程式蓋的蓋出來），走訪每一個 mesh 的每一個材質，列出沒有 `map`／`normalMap`／
`roughnessMap` 的那些，連材質名字一起印。「都貼好了」我講錯過三次，每次成因都
一樣：抽樣看幾件、看起來有紋理就宣布完成。

**第一次跑出 22 件，其中有一部分是我量錯的。** `applyScan` 是非同步的——圖還沒
載到就先把材質排進佇列、之後補上——所以在物件剛建好的那一刻問「有沒有貼圖」是
**錯的時間點**。加了 `scansPending()` 等它歸零之後，真正的漏是 17 件、四個成因：

| 成因 | 件數 | 解法 |
|---|---|---|
| Kenney 有些 mesh 根本沒有具名材質（glTF 給 `_defaultMat`） | 6 | `FLAT_ARCHETYPES` 加一條 `/./` 保底，套 `beige` 的表面 |
| 燈罩、葉片、塑料原本只設 roughness 沒給圖 | 4 | 燈罩→`linen`、葉片→`rattan`、塑料→`beige` |
| 參數化衣櫃的噴漆板與鏡面 | 6 | 噴漆取 `beige` 的表面**不取顏色**（白櫃跟灰櫃要維持各自的顏色）；鏡面命名後列入 EXEMPT |
| 踢腳凹槽、書背 | 2 | 同樣取 `beige`／`linen` 的表面 |

**還有兩個是稽核擴大到 Quaternius 之後才冒出來的，兩個都很陰險：**

- **名字可能不在材質上。** Kenney 的 glTF 帶材質名，但 Quaternius 走 OBJ →
  trimesh → GLB，那條路上材質名掉了，語意留在 **node** 上。`dressFlat` 只看
  `m.name`，於是這整個來源一件都對不上——沒有錯誤、沒有警告，只是全部維持純色。
  修法是名字空的時候接手 node 的名字。
- **`/light/` 把 `LightOrange` 當成了燈。** Quaternius 用顏色命名材質，而燈具那條
  原型刻意不貼圖，所以那兩張地毯永遠是純色。`\blight\b` 一個詞界解決。

順帶一提，前一批那 10 件 Quaternius **從來沒被稽核過**——它們在 manifest 裡但還
沒有目錄列，而稽核是照目錄跑的。這也是為什麼抓取腳本現在會自己補目錄列。

**有些材質沒有貼圖是對的**，所以稽核有一份 EXEMPT，逐條寫理由：玻璃與鏡面真的
沒有紋理、上釉陶瓷（兩個圖庫的 ceramic 掃描全是「磁磚」含填縫與磨損，貼上去是
憑空加髒污）、自體發光的燈罩。**不在 EXEMPT 又沒有 map 的就是漏掉的**——這條線
畫出來，「全部」才有意義。

### 風格分類 7 種：日式與北歐靠材料成立

風格從 5 種加到 **7 種**（現代 75／古典 37／鄉村 30／工業 17／北歐 10／中式 9／日式 7）。

實掃圖庫沒有和室家具——沒有人去掃榻榻米地台或障子。但**這兩個風格的辨識度幾乎
全在材料**：藺草編、障子的紙與細木格、藤編櫃門，而材料正好是掃得到的。所以新增
的 13 件是程式蓋、貼實掃圖：`tatami_mat`、`riet_01`（蘆葦編）、`rough_linen`
三張新抓的圖撐起整個分類。障子的紙用 `transmission` 做半透，不是把白色調亮。

北歐另外把三件既有的重新歸類：木扶手皮椅、挪威式旋轉躺椅與它的腳凳——從渲圖看
就是中世紀現代，之前一律掃進「現代」。

### 左側面板：搜尋 ＋ 風格 ＋ 摺疊

197 件塞不進一條清單，光客廳就 48 顆按鈕。三個控制項**刻意互相獨立**：搜尋是名稱
子字串、風格**單選**、摺疊是每個分類各自記。一旦互相卡住，一個空面板就有三種可能
原因，使用者只能猜。

**風格是單選的。** 一開始做成可複選的聯集，實際用起來是反效果：現代 75 件加古典
37 件不會幫你找到東西，只是把兩堆調性不同的家具倒在一起，而按第二顆鍵的意思幾乎
一定是「改看這個」而不是「兩個都要」。再按一次同一顆等於回到全部。

摺疊與風格都存 localStorage——每次重載都把八個分類全部展開，等於沒有這個功能。

**風格標籤是看圖判的，不是按檔名。** 檔名兩個方向都會騙：`modern_coffee_table_02`
真的是現代，但 `sofa_01` `sofa_02` `sofa_03` 分別是雕花長椅、絨面切斯特菲爾德、
捲臂皮沙發——三個世紀擠在三個連號裡。第一版按檔名分，127 件有 79 件掉進「現代」，
連拱形雕花立鏡、六臂銅吊燈、搖椅都在裡面。**會騙人的篩選比沒有篩選更糟**，所以
重做了一張縮圖對照表逐件重判，27 件改掉。

`bench/verify-palette.mjs` 驗的是**組合**：搜尋 ∩ 風格、選第二個風格會取代第一個、摺疊不改變
誰被篩掉、重載後兩個狀態都還在。它抓到一個看不出來的 bug：`wireTopbar()` 在
`buildCatalog()` 之後對所有 `.panel-title.collapsible` 重設 `onclick`，把家具面板
那個會存狀態、會重跑篩選的處理器整個蓋掉——外觀完全正常，只是狀態不再被記住。

`bench/thumbs.mjs` 補預覽圖：Poly Haven 與 Kenney 都附，Quaternius 沒有。它是一頁
乾淨的 three.js（`alpha: true`、正交等角、3 倍超取樣），**不是走 App**——走 App 的話
每個圖示背後都會有地板、牆和天空。

**為什麼要第二個來源。** Poly Haven 是攝影測量，而冰箱、爐具、衛浴、洗衣機、以及
不是雕花古董的床，根本沒有人去掃。那些類別在任何 CC0 圖庫都找不到掃描圖，替代
方案是原本那個手工方塊。

**櫃體後來全部搬回 Poly Haven。** 衣櫃、電視櫃、高櫃、收納櫃、鞋櫃、開放層架原本
用 Kenney，但**平鋪的材質貼在低多邊形上永遠長不成烘焙貼圖的樣子**：前者每一格都
一樣，後者每一平方公分都不同——把 Kenney 的衣櫃跟 Poly Haven 的實木長桌並排渲一張
就一目了然，一邊是均勻的淺米色配均勻細紋，一邊有深淺變化、磨損與包漿。這不是貼圖
不夠好，是兩種東西。Kenney 現在只留「圖庫真的沒有實掃版本」的家電與衛浴。

**它們長得不一樣，這是真的代價——不過大半可以補。** Kenney 的模型**完全沒有貼圖**：
每個材質只有一個純色、`roughnessFactor: 1`、`metallicFactor: 0`、沒有法線。所以它們
在面板裡看起來像沒貼皮，因為**本來就沒有**。

但它們的材質名字是語意化的（`wood` `woodDark` `metal` `metalLight` `metalDark`
`carpet` `carpetWhite` `glass` `lamp`），正好對得上程式家具那六個原型。
`furniture3d.ts` 的 `dressKenney()` 按名字套上對應的掃描圖與 PBR 參數。兩個重點：

- **只有木質取掃描圖的顏色，其餘不取。** 第一版全部不取，理由是 Kenney 的調色盤就是
  設計本身——白冰箱、粉紅床包確實是這樣，但櫃體就完全錯了：一張法線貼在純色平面上
  只是很淡的起伏，所以衣櫃、電視櫃、收納櫃看起來還是沒貼皮，而使用者回報的正是這幾件。
  **木頭是顏色本身就是材質的那個例外**。實測 `wood`／`woodDark` 共 46 個材質現在都有
  colour map
- **roughness／metalness 要在 `applyScan` 之後設**。`applyScan` 在掛上 roughnessMap
  時會把 `roughness` 設成 1（有 map 時它是乘數），所以先設就會被蓋掉——冰箱固定在
  roughness 1，貼什麼都是霧面塑膠。實測從 1.00 變成金屬 0.33／木頭 0.62／玻璃 0.05
- 對不到名字的 `_defaultMat`(6) 與 `plant`(1) 刻意不動：那是白瓷與葉子
- 木紋是**照真實比例**貼的（一張 100cm 木皮鋪在 120cm 的櫃子上），所以看起來偏淡是
  對的——`oak_veneer_02` 本來就是淺色細紋

它們的 UV 是真的（一個 60cm 櫃子上跨數十個單位），所以 `applyScan` 多了一個
`repeat` 選項直接給平鋪次數，不從公分推。**這是把兩者放進同一個畫面渲出來比較過才決定的**，不是猜的。判斷是：一個
比例正確的素面衣櫃勝過帶鏡條的程式方塊，一個看起來像馬桶的馬桶勝過四個圓柱。

**不要拿 Kenney 的尺寸當目錄預設。** 那套件做在固定格線上，衣櫃只有 56cm 寬、
廚櫃 43cm。目錄要放台灣住宅的實際尺寸，載入器本來就會把模型等比縮到物件的 w/h。
`fetch_kenney.py` 會從 glTF 的 POSITION accessor min/max 算出模型尺寸寫進 manifest，
那是給人看的參考，不是給目錄抄的。

**抓取腳本一律 merge manifest，不要從頭重建。** `fetch_models.py` 原本是
`manifest = {cid: one(...)}` 再整份寫出去，於是它把 `fetch_kenney.py` 併進去的 21 筆
**全部抹掉**。症狀從外面完全看不出來：`.glb` 還在磁碟上、面板的預覽圖也還在，只有
`loadFurnitureModel` 找不到 row 就回 `false`，那 21 件（衣櫃、冰箱、馬桶、浴缸、床…）
安靜地退回程式生成的方塊。**少一筆 row 跟「這件本來就沒有模型」長得一模一樣。**

同一件事的第二半：`fetch_kenney.py` 判斷「已存在」時只看檔案在不在，所以 manifest 被
別人洗掉之後它每一件都跳過，永遠補不回來。**「已存在」要包含 manifest 那一row。**

`bench/furniture.mjs` 現在會比對目錄與 manifest，缺任何一件就丟例外——這是唯一會在
外面看得出來的地方。

**貼圖預算只算貼圖，不算幾何。** 第一版量整個目錄的大小，結果大的那幾個是
*幾何*大——一盆植物 5.2MB 的 .bin。.bin 縮不了，於是迴圈永遠不合格、一路把那盆
植物的葉子貼圖壓到 160²（5KB），一點都沒省到。**不能縮的東西不可以算進要縮的
預算裡。** 幾何本身就爆掉的模型不收（見 `MODELS` 的註解）。

**Esc 是文件層級的動作，不是 2D 的工具快捷鍵。** 它原本寫在
`editor.ts` 的 keydown 裡、排在兩個守衛**後面**：`inputEnabled`（2D 不是主檢視時
為 false）與「焦點在 INPUT 就 return」。結果是 Esc 只在 2D 有用，在 3D 與分割完全
沒反應——而那正是你剛放完東西想脫身的地方。移到兩個守衛前面。在欄位裡按 Esc 只
離開欄位、選取留著（因為你在改一個數字而按 Esc，不代表你想連選取一起丟），再按
一次才取消。`bench/verify-esc.mjs` 驗這四種情況。

**吊燈與吊扇需要掛載高度。** 家具的 `elevation` 3D 一直支援、屬性面板也能改，但
目錄沒有預設值，所以吊燈放下去會躺在地板上，使用者得自己知道要去改「離地板距離」。
`FurnitureItem.mount`（`'ceiling'|'wall'`）表達意圖，實際高度由 `tools/place.ts`
從當層的天花板算——天花板屬於樓層不屬於燈，所以目錄不能存答案。實測 300cm 天花板
下：吊燈／吊扇 240cm、壁燈 150cm、盆栽 0cm。1k 下載後把貼圖
**重新編碼成 512**：好幾個模型一個材質就帶三四張 1k 圖，十七件原始下載是 20MB，
重編後 6.4MB，而在室內視角一張沙發只有 200px 高，看不出差別。

沒有模型的維持程式生成：冰箱、爐具、水槽、馬桶、浴缸、淋浴間、衣櫃、電視櫃、
地毯、廚櫃、高櫃。Poly Haven 沒有這些，而它們正好是會照圖描成特定尺寸的品項
——一個掃描來的 1980 年代櫃子比一個至少對得上平面圖的方塊糟。

**目錄的預設尺寸改成模型量到的真實尺寸**（Poly Haven 的 `dimensions` 是公釐的
[寬, 深, 高]）。從左邊面板拖出來的沙發是 158×66，不是誰打上去的 200×90。

三件容易做錯的：

- **glTF 是公尺、原點在作者留下的地方**。載入後要 ×100 換成公分、置中 x/z、把
  底部落到 y=0。少做任何一半，沙發就會埋進地板或偏離自己的footprint 40cm，而且
  不會有任何錯誤訊息，只是看起來像隨手擺的
- **縮放是逐軸填滿宣告的 w/h，不是等比**。原本取 `min()` 讓模型保持比例，理由是
  「壓扁的沙發比留空隙糟」——那在目錄尺寸**就是**模型尺寸時成立（照片測量的那批縮放
  倍率剛好 1），對 Kenney 那套做在固定格線上的就完全不成立。實測當時 94 件裡有 19 件比
  宣告的短超過 10cm，最糟是 180cm 的廚櫃渲成 **54cm**。在繪圖工具裡物件的 w/h 就是
  真相，拉把手就要拉得動，讓步的是比例
- **高度取兩個縮放的 `min`**，所以單軸拉伸不會把東西拉高：更長的廚具還是檯面高度
- **模型比例不對的就在目錄寫死 `height`**。Kenney 把廚房底櫃做成 43×48×45 的方塊，
  縮到 180×60 之後高度是 56cm 而不是 85。29 件標了真實高度，`tools/place.ts` 放置時
  一併帶上
- **`inst.scale.y` 要用 `*=` 不是 `=`**。`buildFurniture` 已經縮過，`getModelHeight`
  量到的是縮過之後的高度，直接指派會把那個倍率丟掉。這件事一直看不出來，因為每個
  掃描模型的縮放倍率都是 1——`=` 與 `*=` 完全等價，直到 Kenney 那套進來，200cm 的
  衣櫃變成 83cm
- **模型要在真的要畫它的時候才載，不能只靠閒置預熱**。`warmFinishes` 走
  `requestIdleCallback`，而一個每幀都在渲染的 3D 檢視會把它餓死：35 件家具的平面
  圖，等到有人去看的時候 17 個模型只到了 8 個。現在 `buildFurniture` 自己會發起
  載入（冪等），預熱只是提前量

**放置預覽的鬼影也要跟著換。** 它是「每個品項建一次、換品項才重建」，所以模型晚
幾百毫秒到的話，預覽會一直停在程式生成的那版——然後放下去的瞬間形狀就變了，而
那正是預覽存在要防的事。`view3d.refreshGhost()` 在模型到齊時原地重建它。實測對照：
關掉時鬼影恆為 26 個 mesh（程式生成的沙發），開著時從 26 變成 1（實掃模型）。

**圖例不能讓 App 起不來。** `data/furniture.ts` 的 `rr()` 現在會把負的寬高與半徑
夾住：立鏡只有 3cm 深，內框畫在 `h - 6` 就是負數，`arcTo` 丟 IndexSizeError——而
面板是在建立時就把每個圖例畫一遍的，所以一個壞掉的圖例在 `__app` 被指派之前就讓
整個 App 掛掉。是 `bench/furniture.mjs` 的守衛（拿不到目錄就丟例外）先報出來的。

**左側面板顯示模型自己的預覽圖**，不是俯視圖例。俯視圖例分不出太師椅與餐椅、
吊燈與吸頂燈——它們都是同一個圓角矩形，而目錄裡大部分都是這種情況。兩個圖庫本來
就各附一張渲染圖（Poly Haven 的 `thumbnail_url`、Kenney zip 裡的 `Isometric/*_SE.png`），
抓取腳本一併存成 `client/public/models/<id>/thumb.png`（128px PNG 保留 alpha，因為
它們要疊在面板自己的底色上）。

程式圖例留著當**備援**：先畫 canvas，圖片 `onload` 才換掉。這樣沒有模型的品項不會
開天窗，圖片沒到也不用回頭補。

**不要對這些圖用 `loading="lazy"`。** 面板是一條長清單，懶載入下離開視窗的那些永遠
不會發出請求，`onload` 也就永遠不觸發——實測 72 個按鈕換上 **0 張**，而且因為根本
沒發請求，連 404 都沒有可以看的線索。

`bench/furniture.mjs` 把整個目錄擺成一個房間渲出來（`--close` 拉近看細節）。
它會等 `.gltf` 真的進 `performance.getEntriesByType('resource')` 才截圖，而且
品項清單向 App 要——理由跟 `shot.mjs` 一樣。

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

### `antialias: true` 對走 EffectComposer 的畫面沒有作用

`new THREE.WebGLRenderer({ antialias: true })` 只管**預設 framebuffer**。這個專案
每一幀都走 EffectComposer（RenderPass → GTAO → OutputPass），畫面進的是離屏 render
target，而它預設 `samples: 0`——所以旗標一直是開的，畫面卻完全沒有反鋸齒。

看起來不像「沒有 AA」，看起來像模型做壞了：門框與牆角是階梯狀的，門片上凸起的
鑲板在室內距離只有約一個像素寬，於是斷成一條虛線，像門上有一圈髒污。

**排除的過程值得記著**，因為前兩個猜測都錯：先以為是共平面 z-fighting（鑲板的背面
確實跟門片正面同深度，改掉了，但虛線還在），再以為是陰影或 GTAO 的抖動（兩個都關掉
重渲，虛線還在）。真正的驗證是把三個變因逐一關掉還在，才回頭去看 AA。

修法是給 composer 一個有多重取樣的 target：

```ts
this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4 }));
```

**不要順手加 `type: THREE.HalfFloatType`**：色調映射在最後的 OutputPass 才做，中間
那張不需要那個動態範圍，而在大視窗、pixelRatio 2 之下一張多重取樣的浮點 target 是
好幾百 MB 的 GPU 記憶體。

**MSAA 的 GPU 成本在這台機器上量不出來。** headless Chromium 是軟體光柵化，MSAA 在
那裡的代價病態地高，量出來 0 取樣比 4 取樣還慢——純雜訊。真正接住它的是機器自己的
回答：`adaptResolution` 本來就會在每幀超過 20ms 時降一階解析度，而多重取樣正好是讓
畫面更受填充率限制，那正是那個閥門在應對的事。

**「整個 3D」不只是畫面上那一塊，另外兩處各有各的反鋸齒：**

- **全景拍攝完全繞過 composer**。`capturePanorama()` 用 CubeCamera 直接渲，多重
  取樣的 target 根本不在這條路徑上；而且 cube target 也救不了——three 只替 2D
  target 配置多重取樣 framebuffer。原本 cube 面 1024 對 4096 寬的等距長方投影是
  **幾乎 1:1**（各是每度 11.4 px），鋸齒原封不動抄過去。改成 cube 面 2048 ＋
  mipmap ＋ trilinear，讓重投影自己把四個 texel 濾成一個像素。**只放大不開 mipmap
  沒有用**：LinearFilter 只會取最近的兩個 texel，多出來的解析度白花。實測那一區的
  Laplacian 變異數 176.9 → 95.0
- **glTF 模型的貼圖預設 anisotropy 是 1**，而這個專案自己產的材質都是 8。不補的話
  邊櫃的木紋、層架的金屬框在掠角會閃爍，而旁邊的地板不會——房間大部分就是從掠角
  看的。在 `loadFurnitureModel` 裡一併設掉

### 3D 的牆角會缺一塊：牆的盒子停在中心線的端點

一道牆是一個 `BoxGeometry`，從 `a` 走到 `b`——那是**中心線**的兩個端點。所以兩道
牆交會時，兩條中心線交叉的那個 thickness×thickness 方塊，**沒有任何一道牆蓋到它的
外側四分之一**：兩道 15cm 的牆會在外角咬掉一塊 7.5×7.5cm。

畫面上看起來不像「缺一塊」，看起來像牆角有一條**淺色直帶**——那是缺口露出的牆端面，
受光方向跟兩個牆面都不同。

量法比看快：把牆體 mesh 的水平包圍盒取出來，直接測轉角那幾個點有沒有被覆蓋。
未修時 `(-5,-5)`、`(-7,-7)`、`(-2,-2)` 都是空的。

修法是**在有接到另一道牆的那一端多走半個厚度**。兩道牆會在轉角重疊——它們是同一種
材質，重疊看不出來，缺口看得出來。只在有接的那一端做：每一端都做的話，獨立的一道
牆會比它畫出來的長度多凸出 7.5cm。

**2D 平面圖從來沒有這個問題**，因為它用 `lineCap: 'square'` 描邊，那正好就是同樣的
半厚度外伸。3D 只是一直沒跟上。

（曲線牆走 `sweptWall` 那條路徑，還沒處理；它兩端接的是直牆，同一個缺口在那裡也
存在，只是弧的端面本來就斜、比較不明顯。）

### 柱子是一道厚牆，不是四道薄牆圍起來

原圖的黑塊＝柱子，使用者用四道牆包住它來表達。那在 2D 沒問題，但四道牆的中心線
沿著黑塊的邊，所以畫出來比黑塊**大一整個牆厚**（每邊 7.5cm），柱子會凸出它嵌著的
那道牆。牆角補了半厚度之後缺口沒了、變成完整長方體，這件事就更明顯。

量柱面相對相鄰牆面（正＝凸出）：

| | 四道牆 | 內圈填滿 | 中心線矩形（黑塊） |
|---|---|---|---|
| 柱1 左 | +8.9 | −6.1 | **+1.4** |
| 柱2 右／上 | +9.4 / +8.4 | −5.6 / −6.6 | **+1.9 / +0.9** |
| 柱3 右 | +9.4 | −5.6 | **+1.9** |
| 柱4 左 | +12.1 | −2.9 | **+4.6** |

**內圈是反過來的錯**：柱子縮進牆裡，變成另一種縫。對的是中心線圍出來的矩形，也就是
原圖量到的黑塊本身。

**不需要新的物件種類。** 一道 `thickness` 等於短邊、中心線沿長邊的牆，本來就是一個
實心長方體，而且 2D 填充、房間偵測、選取與編輯全部照舊。`scripts/solid-columns.mjs`
把既有方案裡的四道牆換成一道（預設乾跑，`--apply` 才寫）。

`check-0199.mjs` 用厚度分辨：這份圖的隔間牆是 11–21cm、柱子是 38–68cm。柱子兩端本來
就懸空（它是獨立的實心體），所以規則一不算它；但房間偵測要把它畫進去。

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

### 從施工圖描平面：座標一律取「牆的兩條面線的中點」

圖上一道牆是**兩條線**（它的兩個面，15cm 牆就是 15–17px）。掃描時很容易只抓到
其中一條就當成那道牆的座標——**而且整份圖會一致地錯半個牆厚**，所以每個房間的
尺寸都還是對的，看起來完全正常。`scripts/trace-0199.mjs` 第三版就是這樣，X 全部
偏 +7.0、Y 全部偏 −7.9，唯一露餡的地方是把結果疊回原圖才看得出來。

驗法：`X` 或 `Y` 陣列裡的每個值，去圖上量它兩側 ±7.5cm 有沒有墨。有才是中心線。

同一份圖上會冒充牆線的東西：**衣櫃前緣**（線對 50–65cm，是深度不是厚度）、
**木作吊頂的投影線**、**實心黑柱**（整塊都是墨，兩面當然都有）。所以哪些跨距真的
有牆這件事沒有自動化成功——`trace-0199.mjs` 的 `WALLS` 是手判的，這是刻意的。

反過來，使用者講的規則要變成會跑的檢查（`scripts/check-0199.mjs`）：
「牆不會無緣無故伸一根出來」＝每個端點都要碰到另一道牆；「牆會形成房間」＝
光柵化後 flood fill 出來的封閉區域數要等於房間數。這兩條第一次跑就各抓到一個
真的錯（弧牆用兩根斜牆接、陽台牆多伸 238cm），不是裝飾。

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
