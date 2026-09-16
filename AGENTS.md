# AGENTS.md
> 三份文件分工：這份講**現在長怎樣**、
> **[`docs/design-rules.md`](docs/design-rules.md)** 講**畫出來的東西要符合什麼**
> （設計一間房子的規則，含每一條「誰在守」）、
> **[`docs/worklog.md`](docs/worklog.md)** 講**怎麼走到這裡、哪幾次判斷錯了**。
>
> 動到牆體、柱子、家具擺放、尺寸或畫面呈現之前先讀 `design-rules.md`——那裡面每一條
> 都是使用者踩過之後講的，而且標了現在有沒有程式在守。

## 更深的紀錄在 `docs/notebook.md`（7 節、981 行）

這個檔案只留**每個 session 都需要的東西**：架構約束、建置指令、踩過的坑、使用者裁示。
量測、推導與功能規格都搬到 `docs/notebook.md` 了（**一字未改**），需要時再讀那一份——
它不會進 context，所以放在那裡的成本是零。

| 要動什麼 | 先讀 `docs/notebook.md` 的哪一區 |
|---|---|
| **效能、浸泡測試、記憶體、載入時間** | 量測與浸泡測試（499 行：怎麼跑、量到什麼、哪些數字現在還算數） |

> **新的量測與推導寫進 `docs/notebook.md`，不要再往這個檔案疊。**
> 只有「每次都要遵守的約束」「踩過的坑」「使用者裁示」才留在 `AGENTS.md`。

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

## DXF 匯入


`app/dxf.py` + ezdxf。兩階段：`/api/dxf/inspect` 列出圖層供勾選 → `/api/dxf/import` 轉成牆。

四個必須做對的地方：

1. **雙線牆合併成中心線並量出厚度**——不合併的話，房間偵測會把牆心夾層當成房間
2. **Y 軸翻轉**——DXF 是 Y-up
3. **座標平移到原點**——地籍座標可能落在 250000,130000
4. **單位**——`$INSUNITS` 常常是 0，猜錯差 1000 倍，所以對話框會顯示換算後的實際公尺數讓使用者確認

ARC 與 polyline bulge 轉成曲線牆。

## 搬出去的章節（2026-09-16）

下面這些內容**一個字都沒有改**，只是換了位置——放在這裡每次請求都要付 context 成本，
搬走之後只有真的需要時才載入。

**`.claude/rules/layering.md`**（動到對應檔案時自動載入）

- 前後端分工
- 重構 3D 之後怎麼證明沒改壞

**`docs/notebook.md`**（需要時用 Read 讀）

- 這些坑踩過了，別重犯
- DWG：確認不做
- 待辦與已知限制
- Codex 讀過一遍之後的發現（2026-09-09）

