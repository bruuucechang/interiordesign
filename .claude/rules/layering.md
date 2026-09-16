---
paths:
  - "client/**/*.ts"
  - "client/**/*.js"
  - "server/**/*.py"
  - "schema/**"
---

<!-- 2026-09-16 從 AGENTS.md 搬來，內容逐字未改。只有動到上面 paths: 列出的檔案時才會載入。 -->

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

