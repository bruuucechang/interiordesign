# 室內設計繪圖 · Interior Designer

一個 **2D 室內平面圖繪圖軟體**：畫牆、房間、門窗，從家具庫拖放家具，尺寸標註，圖層管理，並可匯出 PNG / PDF。前端用**原生 Canvas + TypeScript** 手刻，後端是 **Node + `node:sqlite`** 的輕量專案存檔。

## 技術棧
- **前端**：原生 HTML5 Canvas + TypeScript + Vite（座標轉換、平移縮放、選取/縮放/旋轉、圖層皆自行實作）
- **後端**：Node + Express + `node:sqlite`（Node 內建，免裝原生模組）
- **匯出**：PNG（canvas）、PDF（jsPDF）
- 單位：公分（cm），格線吸附

## 需求
Node.js ≥ 22（本機 v25，`node:sqlite` 內建可用）

## 安裝與執行
```bash
cd ~/Documents/interior-designer
npm install
npm run dev      # 後端 :8791 + 前端 :5180
# 開 http://localhost:5180
```
後端離線時仍可用（存檔改用 localStorage）。

## 操作
| 功能 | 操作 |
|------|------|
| 平移畫布 | 按住 **空白鍵拖曳**，或**中鍵拖曳** |
| 縮放 | 滑鼠**滾輪** |
| 選取工具 | `V`／左側「選取」 |
| 畫牆 | `W`，連續點擊放置端點，`Esc` 結束 |
| 房間 | `R`，拖曳一個矩形 |
| 門／窗 | `D`／`N`，在牆上點擊（自動吸附到牆） |
| 尺寸標註 | `M`，拖曳量測兩點 |
| 家具 | 左側「家具庫」點選 → 在畫布點擊放置 |
| 選取後 | 拖曳移動、角落縮放、上方圓點旋轉、方向鍵微調、`Delete` 刪除 |
| 復原／重做 | `Ctrl/⌘+Z` ／ `Ctrl/⌘+Shift+Z` |

右側面板可調整選取物件的**屬性**與管理**圖層**（顯示/鎖定/上下排序）。

## 功能
- 牆（可調厚度、即時長度）、房間（可命名、顯示尺寸）、門（含開門弧線）、窗、尺寸標註
- 家具庫（客廳／臥室／廚房／衛浴／其他，共十餘件，皆為程式繪製的俯視圖示）
- 圖層：牆體／房間／門窗／家具／尺寸標註（顯示、鎖定、排序）
- 匯出 PNG／PDF；專案存檔（後端 SQLite + localStorage 自動暫存）

## 專案結構
```
interior-designer/
├─ client/                # Canvas 前端
│  └─ src/
│     ├─ model/           # 資料模型 (types, doc + 復原/重做)
│     ├─ core/            # viewport / renderer / hit / handles / editor / exporter
│     ├─ tools/           # select / wall・room・dimension / door・window・furniture
│     ├─ data/furniture   # 家具庫（尺寸 + 繪製）
│     ├─ ui/              # 工具列・家具庫・圖層・屬性・存開專案
│     └─ net/api          # 後端 CRUD（含離線降級）
└─ server/                # Express + node:sqlite（專案存檔）
```

## 之後可擴充
- 房間依牆體自動封閉／面積計算、牆體自動接合
- 家具尺寸/顏色編輯、匯入自訂家具、群組
- 白底列印主題、比例尺與圖框、多頁匯出
- 尺寸鏈、對齊輔助線、更多吸附（端點/中點/牆面）
