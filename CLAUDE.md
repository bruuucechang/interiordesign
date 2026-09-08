# CLAUDE.md

> 三份文件分工：這份講**現在長怎樣**、
> **[`docs/design-rules.md`](docs/design-rules.md)** 講**畫出來的東西要符合什麼**
> （設計一間房子的規則，含每一條「誰在守」）、
> **[`docs/worklog.md`](docs/worklog.md)** 講**怎麼走到這裡、哪幾次判斷錯了**。
>
> 動到牆體、柱子、家具擺放、尺寸或畫面呈現之前先讀 `design-rules.md`——那裡面每一條
> 都是使用者踩過之後講的，而且標了現在有沒有程式在守。

## 更深的紀錄在 `docs/notebook.md`（1 節、500 行）

這個檔案只留**每個 session 都需要的東西**：架構約束、建置指令、踩過的坑、使用者裁示。
量測、推導與功能規格都搬到 `docs/notebook.md` 了（**一字未改**），需要時再讀那一份——
它不會進 context，所以放在那裡的成本是零。

| 要動什麼 | 先讀 `docs/notebook.md` 的哪一區 |
|---|---|
| **效能、浸泡測試、記憶體、載入時間** | 量測與浸泡測試（499 行：怎麼跑、量到什麼、哪些數字現在還算數） |

> **新的量測與推導寫進 `docs/notebook.md`，不要再往這個檔案疊。**
> 只有「每次都要遵守的約束」「踩過的坑」「使用者裁示」才留在 `CLAUDE.md`。

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

**要把它交給不會用 GitHub 的人，看 [`docs/handoff-windows.md`](docs/handoff-windows.md)**：
發安裝精靈而不是 zip（zip 在 Windows 上看起來就是資料夾，沒解壓縮過的人會在裡面
雙擊 exe，`_internal\` 不會跟著，死在找不到 Python DLL）、兩台 Windows worker 哪台
建得起來、以及 SmartScreen 為什麼只有買憑證能解。**要走 LINE 送的話，那個單一的
安裝精靈仍然要包一層 zip**——LINE 會把 `.exe` 靜默吃掉（對方聊天室裡連訊息都沒有），
而包單一自足的安裝檔跟壓整個 `dist` 資料夾是兩件事，理由寫在同一份文件的五之二。建置腳本的順序是
**venv → 素材 → 前端 → 打包**，素材必須在前端建置之前到位（Vite 是在 build 當下才把
`public/` 複製進 `dist/`），且前後各驗一次——少了模型不會報錯，只會安靜地少掉三分之二
的家具。

## 三條使用者反覆講的規則，現在都有程式在守


### 一、靠牆的家具要背對牆

放置一律 `angle: 0`，於是靠上牆放的沙發是對的，靠下牆、左牆、右牆放的沙發臉貼著
牆——四面裡的三面。`fitFurnitureToWall()`（`tools/place.ts`）在游標離牆 60cm 內時
把家具轉成背朝牆、並把背貼到牆面上，**預覽當下就轉好**：放下去才轉的話，使用者是
對著一個跟結果不一樣的鬼影瞄準。

方向的依據是模型自己：`furniture3d.ts` 的沙發把椅背放在 `-h/2`，圖例也把椅背畫在
上緣，所以「正面」是 local +y。背朝牆＝local +y 指向牆的內法線，而內法線就是
「從牆指向使用者點的那一側」——牆有兩面，點哪面就靠哪面。

天花板件與高度 ≤5cm 的地面覆蓋物不套用：吊燈沒有正面，地毯轉了看不出來但位置會被
推去貼牆。

### 二、一道牆的兩條線是它的厚度，不是兩道牆

後端量得出來，但**以前把量到的厚度丟掉**，前端一律 `thickness: 12`。於是圖上 24 公分
的牆生出 12 公分的、8 公分的隔間生出 12 公分的——後者直接畫到使用者的線外面。
`_merge_group()` 現在把兩個面的垂距一起回傳，前端照底圖比例換算成公分。

還有一個更根本的：合併門檻 `MAX_WALL_THICKNESS` 是**固定 18 像素**。使用者那張 CAD
圖的牆對相距 15–17px 剛好過關，同一張圖掃成兩倍解析度就會裂成兩道牆。改成
`max(18, 5% × 圖的長邊)`——平面圖通常橫跨幾公尺，600px 寬的圖約 1px = 1cm，而住宅
最厚的結構牆約 30cm，也就是 5%。代價是兩道很近的平行牆（管道間）會被併成一道；
取捨方向很明確，把一道牆看成兩道是每次描圖都會踩到的。

### 三、柱子是柱子

底圖上的柱子是一個實心黑塊，四邊各描一條線，辨識出來就是四道圍成小方框的牆——
2D 看得過去，3D 是一個空心方管，而且外緣比黑塊大一整個牆厚。`collapseColumns()`
在匯入時就地換成一道 `thickness` 等於短邊的牆，那本來就是一個實心長方體，不需要新
的物件種類。判斷條件收得很緊（兩邊都 ≤120cm、四角要對得上）——放寬會把一間小廁所
吃掉，那比留著四道牆糟得多。

**三條共用同一個原則：不要超出使用者畫的線。** `bench/verify-placement.mjs` 驗第一
條（四面牆各放一次、量角度與貼牆位置），`server/tests/test_detect.py` 驗第二條
（畫 12/20/28 像素的牆對，量回來要一致；只畫一面時回 0 而不是猜一個數字）。

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

### `<button>` 不繼承 font-family，於是工具列有兩個方框

使用者回報「匯出按鈕旁邊有兩個意義不明的方筐」。是缺字：`⭳ 匯出 ▾` 畫出來是
`□ 匯出 □`。

**根因不在那兩個字，在 CSS。** `body` 設了
`ui-sans-serif, system-ui, "PingFang TC", …`，但**表單元件不繼承 font-family**
——瀏覽器給它們平台預設值，在這台機器上是 Arial，而 Arial 沒有 `⭳`(U+2B73)、
`▾`(U+25BE)、`⌨`(U+2328)、`▥`(U+25A5) 的字符。同一個字元在旁邊兩像素的 `<div>`
裡是好的，在 `<button>` 裡就是方框。`button, input, select, textarea { font-family: inherit }`
一行修掉整類。

**但補了字型還是要用 SVG。** 補上之後 `▾ ⌨ ▥` 都畫得出來了，`⭳` 卻換成**一疊橫線**
——某個備援字型給了它一個完全不相干的字形。那比方框更糟：方框看得出來是壞的，
一疊橫線看起來像是故意的。工具列的圖示因此全部改成 inline SVG（`.icon`，1em、
`currentColor`），順帶把 `🖼️ 📐 ▥ 🧊` 幾個 emoji 一起換掉——收起文字之後，彩色
emoji 跟線條圖示混在一起看起來像壞掉。時段的 `<select>` 保留 emoji，因為 option
的內容不能是標籤。

**兩個判斷缺字的方法都會騙人，只有放大看真的元素算數：**

- **canvas `measureText` 比對 .notdef** 只抓到 `⭳`，漏掉另外三個——canvas 的
  備援清單跟 DOM 排版不是同一套
- **量字寬跟 `U+10FFFD` 比**同樣只抓到兩個，因為星際平面的缺字方框是**兩倍寬**，
  拿它當基準等於跟一個不同尺寸的東西比。要比就用 BMP 的 `U+FFFF`
- 有效的做法：把 `#topbar button` 的 `font-size` 臨時改成 34px 再截圖。**在真的
  元素上、用真的 CSS**，一眼就分得出哪個是方框、哪個是字形

### 工具列 21 項：標籤隨寬度收掉

量出來的（用 iframe 量，**不要動視窗**，見下一節）：帶標籤時 1680 就折成兩列、
1512（Air 自己的螢幕）兩列、1440 三列，**1180 以下縮放控制會折到列尾之外，完全
點不到**。

`.lbl` 包住每一顆按鈕的文字，`@media (max-width: 1700px)` 收掉，圖示留著、`title`
留著。1700 而不是 1512，因為第一次折行發生在 1680。1180 以下再收掉分隔線、
商標與存檔狀態（那是這列裡唯一「在說話」而不是「在做事」的東西）。結果是
**1920→960 全程一列、沒有任何控制點不到**。

**收起標籤之後，圖示必須自己分得出來。** 第一版的左緣／右緣是「方框＋很粗的左邊
框」與「方框＋很粗的右邊框」，在 16px 下是**兩個一模一樣的方框**——跟使用者一開始
抱怨的東西同一類。改成畫牆的兩個面、把基準那一面加粗，才分得出來。

### U+2B7x 那一區：不是方框，是**畫錯的字形**

`⭳`(U+2B73) 與 `⭱`(U+2B71) 在這台機器上都渲染成**一疊橫線**。這比方框難抓得多：
缺字方框看得出來是壞的，一疊橫線看起來像是某種選單圖示，而且**任何比對 .notdef
的偵測法都抓不到它**——它有字形，只是不是那個字。兩個都改成 inline SVG 了。

判缺字的三種方法，只有第三種可信：canvas `measureText` 比 .notdef（備援清單跟
DOM 排版不同）、字寬比 `U+10FFFD`（星際平面的方框是兩倍寬，基準本身就錯，要用
BMP 的 `U+FFFF`）、**把真的元素放大再截圖**。前兩種在這個 repo 裡各騙過我一次。

`⌘`(U+2318) 會被字寬法報成缺字，但放大看是好的——那是誤報，別再去修它。

### 鏡像的 key 與 `plan.id` 不一致 → 永遠「尚未上傳」

`loadProject` 以前用**網址的 id** 當鏡像的 key，`saveProject` 用 **`p.id`**。兩者
不同時（腳本指定 id 塞方案進去就會這樣），同一份圖在鏡像裡有兩筆，而其中一筆在
伺服器上沒有對應的列，於是：

1. 開啟清單永遠把它列成「尚未上傳」
2. `syncPending` 把它推到 `p.id`（**成功了**）再把結果存回原本那個 key（解不到
   任何東西），所以下一輪它還在

這台機器上有一筆這樣的（`img9720`，內容跟 `proj_msqbolza_4` 逐位元組相同），
每 20 秒把自己重寫一次。修法是**載入時以資料列的 id 為準**，把 `data.id` 改成
它真正來自的那一列——跟前面那條「用 API 塞方案一定要讓 `data.id` 等於網址的 id」
是同一個道理：`saveProject` 拿 `p.id` 當寫入位址，對不上就是存到沒有人在看的地方。

**修的時候差點只修一半**：改成用 `plan.id` 當 key 也能讓兩筆變一筆，但那一筆一樣
不在伺服器上，`listProjects` 照樣把它列成「尚未上傳」。是新加的那條測試把這件事
擋下來的，不是我看出來的。

### 「一次 commit」不等於「一步歷史」

使用者的朋友回報「復原按鈕沒辦法用」。按鈕是亮的、`canUndo` 是真的、點下去也真的
跑了 `doc.undo()`——**只是畫面完全不動**。

成因是 `commit()` 的語意。呼叫端說 `commit()` 的時機是「我**可能**要改東西了」：
`SelectTool.onDown` 每次點到物件就 commit（那一下可能只是選取）、屬性面板的欄位
`focus` 就 commit（可能只是看一眼）、色票按下去先 commit（可能選到同一個顏色）。
這些絕大多數以「什麼都沒變」收場，而每一個都被存成一步歷史。實測：畫一道牆之後
**單純點它四下**，歷史就多四筆內容一模一樣的紀錄，前四次復原都是把畫面還原成它
本來的樣子。

修法在 `model/doc.ts`，不在呼叫端：`commit()` 拍下的快照先**擱著**，等到下一次
`emit()` 時比對，真的變了才歸檔。順帶得到的性質是**一次拖曳只算一步**，不管中間
動了幾幀。`test/doc.test.ts` 有四條釘住這件事。

同一支檔案還把**底圖的 base64 從歷史裡拿掉**（用 id 內連，快照裡只留一個 token）。
描圖就是「匯入一張幾 MB 的照片，然後畫一百筆」，而上限正好是 100 筆——實測 30 筆
歷史從「30 × 底圖大小」降到底圖的 **6%**。

### 桌面版的埠位就是它的 origin，不能是隨機的

`free_port()` 本來是 `(8791, 0)`：慣用埠，綁不上就讓作業系統隨便給一個。而 8791
在 Windows 上正好落在 Hyper-V 動態保留的 8712–8811 裡（見上面 Docker 那一節），
所以在那種機器上**每次啟動都是不同的埠**。埠不同＝origin 不同＝localStorage 是空
的＝每次啟動都是第一次執行：教學再跳一次、語言再問一次、面板摺疊再忘一次。
使用者說的「instruction 有時候會在奇怪時機跳出來」就是這個，不是時機奇怪，是同一
個「第一次」一直重來。

兩個修法一起做：

- **`PORTS = (8791, 18791, 28791, 38791)`**，備援全部避開那個保留區間，所以
  綁不上 8791 的機器每次都會拿到**同一個**第二選擇
- **同一台機器再開一次會接到已經在跑的那一份**（`running_instance()` 打
  `/api/health` 並認名字），而不是起第二個伺服器佔第二個埠。所以 `/api/health`
  現在回 `{"ok": true, "app": "InteriorDesigner"}`——單純的 `{"ok": true}` 分不出
  「另一份自己」和「別的東西佔著這個埠」

### SQLite 讀回來的時間沒有時區，而 naive 不是本地時間

`DateTime(timezone=True)` 在 SQLite 上寫進去的是它拿到的那組數字（這裡一律 UTC），
讀回來時區被拔掉。對 naive 值呼叫 `astimezone()` 會**假設它是本機時區**，整個時間
點就被平移了本機的偏移量——這台機器八小時。

於是 `save_project`（從記憶體裡的物件回答，帶時區、對的）跟 `get_project`
（從資料列讀回來，沒時區、被平移過）對同一列給出**差八小時、卻都標 `+00:00`** 的
兩個 `updatedAtIso`。兩個東西讀它：

- **並行守衛**。前端把上一次存檔拿回來的 iso 原封不動送回來，永遠對不上——桌面版
  只有一個人在寫，卻**第一次之後每次存檔都 409**，而每個 409 都彈出一個說「這份圖
  在別的地方被存過了」的對話框
- **離線鏡像的「較新者勝」**。伺服器的時間晚八小時，本機那份就永遠比較新；在 UTC
  以西的機器則相反，離線做的工作會被伺服器安靜地蓋掉

`db.py` 的 `as_utc()`：**naive 一律當成 UTC，aware 一律換算到 UTC**。第二半不能
省——PostgreSQL 的 timestamptz 回的是 session 時區的值，偏移是真的但不是零。
測試必須跑在 SQLite 上（`test_sqlite_backend.py`），Postgres 那邊整個 bug 不存在，
而交出去的正是 SQLite 那一半。

### `If-Unmodified-Since` 要送伺服器的時間，不能送鏡像的 `savedAt`

`savedAt` 在**開始存檔的那一刻**就被改成本機時間了——那是「本機比較新 ＝ 這次寫入
沒送到」成立的原因。拿它當並行守衛的憑據，等於送給伺服器一個這台瀏覽器自己捏的
時間。只要一次存檔中途被打斷（把視窗關掉就夠了），之後每一次重試都 409，永遠。

`Mirrored` 因此多一個 `basedOn`：**只從伺服器的回應寫入**，代表「我要取代的是哪一
版」。`putPlanFromServer()` 是唯一會設它的入口。舊的鏡像沒有這個欄位，於是不帶
標頭送出——那正是這個標頭存在之前的行為，也順便把既有卡住的那些治好。

### `flash` 還原的必須是「常駐的那句話」，不是「我來的時候螢幕上那句」

提示列只有一格文字，三個東西在寫它：工具自己的說明（常駐）、`notice`（常駐）、
`flash`（1.2 秒快閃）。`flash` 本來是「記下現在的字，1.2 秒後放回去」。

兩個快閃疊起來就壞了：匯出 360 全景先 flash「正在算全景…」，接著**把主執行緒卡住
八秒**去拍，拍完再 flash 結果——第二個 flash 記下的「現在的字」正是第一句，於是它
把「正在算全景…」放回去，而那句後面沒有任何計時器，就永遠留在畫面上。全景明明已經
存好了。下一次匯出再把這句錯的當成自己的基準，一路傳下去。

改成模組自己記一個 `resting`：**只有在沒有快閃在等的時候才擷取**，`notice` 與
`editor.setHint()`（透過 `hintChanged()`）會把它清掉。`test/feedback.test.ts` 五條。

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
- 目前 client 327 個測試、server 110 個
- 底圖牆體辨識：文字會殘留短碎片、虛線牆會斷成多段。**這兩者互相衝突**（修一個會惡化另一個），程式與測試中都已註明
- 電氣迴路連線是市場缺口，但使用者明確表示**不做估價，也暫不做迴路**
- **英文介面還有一大片沒翻**（2026-09-08 實測）。`data-i18n` 那層是好的，但下面
  這些是程式裡的中文字面值，切成英文照樣是中文：快捷鍵視窗**整份**、畫布下緣的
  提示列（各工具的 `hint`）、「新增樓層」、`pane-tag` 的「2D 平面」、單位切換鈕、
  WebGL 不可用的說明、新建路線卡片的內文、家具與電氣的 251 個品項名、材質色票名。
  品項名是刻意的（見 Sweet Home 那一節），其餘不是。commit `7191270` 說的
  「切成英文後介面框架零中文殘留」現在不成立了。交付對象用中文，所以這輪沒有動它
