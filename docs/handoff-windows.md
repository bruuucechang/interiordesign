# 把這個軟體交給一個不會用 GitHub 的人（Windows）

> 這份講**怎麼產出與交付一份給別人用的 Windows 版**，以及交付路上每一個
> 會讓對方停下來的地方。
> 程式怎麼跑在 [`../CLAUDE.md`](../CLAUDE.md)、畫的東西要符合什麼在
> [`design-rules.md`](design-rules.md)。

收件者的設定是：**不會用 GitHub、不會裝 Docker、電腦不熟，而且旁邊沒有人可以問。**
所有判斷都是照這個對象做的。

---

## 一、結論先講：三個東西擋在中間，只有兩個我修得掉

| | 修得掉嗎 |
|---|---|
| 打包缺 3D 模型（安靜失敗） | ✔ 已修，而且加了閘門 |
| 拿到 zip 之後不知道要解壓縮 | ✔ 改發安裝精靈就沒有這一步 |
| **SmartScreen 藍色警告** | ✘ **只有花錢買憑證能解** |

第三個不是懶得修，是**技術上沒有別的辦法**。細節在第五節。

---

## 二、產出：在 Windows 機器上建

PyInstaller **不能跨平台編譯**——它凍結的是「跑這支腳本的那台機器」的直譯器與
二進位擴充模組。Mac 上建不出 Windows 版，沒有選項可以繞過。

這個 repo 的兩台 Windows worker 現況（2026-09-05 實測）：

| | Node | Python | 能不能建 |
|---|---|---|---|
| **desk**（DESKTOP-KR4TOIA） | v24.19.0 | Anaconda 3.12.7（64 位元） | ✔ |
| BRUCEVICTUS | v24.19.0 | 只有 Microsoft Store 空殼，`python` 回 Access is denied | ✘ 要先裝 Python |

**desk 的 PATH 上 `python` 是 3.8-32 位元**，numpy 2.5 沒有那個版本的 wheel。
所以 venv 要明確指定 Anaconda 那支，`build-desktop.bat` 看到 `.venv` 存在就會沿用：

```bat
cd /d E:\Project\interior-designer
"C:\Program Files\Anaconda3\python.exe" -m venv .venv
build-desktop.bat
```

### 素材不要在 Windows 上重抓，從 Mac 複製過去

`client/public/models/`（224 件、61MB）是 `.gitignore` 擋掉的，所以 clone 之後
不會有。可以讓建置腳本自己抓，但 `fetch_quaternius.py` 走 **Google Drive，會被
限流**（見 CLAUDE.md）。區網複製是確定性的：

```bash
cd ~/Projects/interior-designer/client/public && tar czf /tmp/models.tgz models
scp /tmp/models.tgz desk:"E:/Project/interior-designer/client/public/"
ssh desk 'cd /d E:\Project\interior-designer\client\public && tar xzf models.tgz && del models.tgz'
```

複製過去之後 `build-desktop.bat` 會驗到素材齊全，直接跳過下載那一步。

### 建置腳本現在會擋什麼

`scripts/check-assets.mjs` 在**建置後**與**打包後**各跑一次。理由是這個失敗
**完全安靜**：少了 `models/`，app 照常啟動、照常畫圖、不會有任何錯誤訊息，
只是 224 件家具裡只有約 55 件有手寫幾何，其餘全部渲成無特徵方塊。

收到的人不會回報這是 bug——那看起來就像這個 app 長這樣。

而且**作者自己永遠看不到**：這台 Mac 上 `models/` 一直都在，只有別人建才會壞。
磁碟上那份 8/3 的 `dist/` 就是這樣，一件模型都沒有，而它隨時可以被交出去。

---

## 三、交付：安裝精靈，不要發 zip

```bat
ISCC.exe packaging\installer.iss
```
→ `packaging\out\室內設計繪圖-安裝程式.exe`（單一檔案）

**為什麼不能發 zip。** 打包出來的是一個資料夾：`InteriorDesigner.exe` 加一個
`_internal\`。而 Windows 把 zip 顯示得跟資料夾一模一樣，所以沒解壓縮過的人會
直接在裡面雙擊那個 exe——Windows 只把**那一個檔**解到暫存目錄，`_internal\`
不會跟著，程式當場死在找不到 Python DLL。

那個狀況對這個對象無法自救：畫面上沒有任何字告訴他少了什麼，而「先解壓縮再執行」
是一個他不知道存在的概念。安裝精靈沒有這個步驟可以跳過。

安裝精靈的兩個設定是刻意的，都是為了拿掉一個嚇人的時刻：

- **`PrivilegesRequired=lowest`**，裝在 `{localappdata}\Programs`。Program Files
  需要提權，而一個**未簽章的安裝程式**再跳一個 UAC 黃盾，正好是會讓人放棄的那一刻。
- **所有會問問題的頁面都關掉**。這裡沒有東西需要決定：沒有元件可選、安裝位置也
  不值得選。剩下的是一條進度條跟一顆完成鍵。

Inno 沒有附繁體中文語言檔（內建那組是歐洲語系加日文），所以字串直接在 `[Messages]`
覆寫，不去依賴一個要在建置時抓的第三方 `.isl`。

### 裝 Inno Setup 到 desk 的坑

`winget install JRSoftware.InnoSetup` 會回報「已成功安裝」，但 **ISCC.exe 全碟
都找不到**。SSH 過去是未提權的 session，寫 Program Files 的那一步靜默失敗了
——跟 `optimize.ps1` 那次是同一個坑。用 Inno 自己的 `/CURRENTUSER` 裝到使用者
目錄就好：

```powershell
Start-Process innosetup-6.7.3.exe -ArgumentList "/VERYSILENT","/CURRENTUSER","/SUPPRESSMSGBOXES","/NORESTART" -Wait
```

---

## 四、對方拿到之後會看到什麼

`使用說明.txt` 由 `scripts/make-user-readme.mjs` 產生，放在程式旁邊，並在「開始」
選單也放一個捷徑。它不是產品說明，是**四個步驟加兩個「這是正常的」**。

用 node 產生而不是放進 repo 再 copy，是因為檔名是中文而 `.bat` 的 `copy` 看
主控台代碼頁；順便寫了 BOM 與 CRLF，舊版記事本才不會把整份擠成一行。

裡面最要緊的兩句，都是**在事情發生之前**先講的：

1. **藍色的「Windows 已保護您的電腦」不是病毒警告**，要點「其他資訊」→「仍要執行」。
   一個已經認定這是病毒的人不會往下讀，所以這句必須在他看到那個畫面之前就出現。
2. **會跳出一個黑色視窗，那就是程式本身，不要關掉它。** 這是最可能讓人放棄的
   一步，而它根本不是錯誤。關掉黑色視窗＝關掉程式。

黑色視窗是 `desktop.spec` 的 `console=True`，那是刻意的——它同時是那個程式唯一的
停止方式，也是網址與存檔位置印出來的地方。改成無視窗的話，這個對象就沒有任何辦法
結束它了。

---

## 五、SmartScreen：只有花錢能解，別再找繞法

第一次執行任何未簽章的 exe，Windows 會擋一次藍色全螢幕：

> **Windows 已保護您的電腦**
> Microsoft Defender SmartScreen 已防止某個無法辨識的應用程式啟動。

預設只有一顆「不要執行」，**「仍要執行」藏在「其他資訊」底下**。這個設計就是為了
讓人不要點過去，所以它對這個對象特別致命。

**這跟程式的內容無關，跟寫得好不好也無關。** 判斷依據是這個檔案有沒有一張
Windows 信任的簽章，以及那張簽章累積了多少「聲譽」。沒有簽章的檔案，每一份、
每一次改版都會被擋。

真正的解法只有一條：**買程式碼簽章憑證**（Windows 從 2023 年起要求私鑰放在硬體
或雲端 HSM，所以不能只買一個檔案了）。

| | 大約 | 效果 |
|---|---|---|
| Azure Trusted Signing | 一個月十幾美元起 | 要通過身分驗證；個人身分需成立滿三年 |
| OV 憑證（DigiCert、Sectigo 等） | 一年兩三百美元起 | 要累積下載量才建立聲譽，**剛簽完仍可能被擋一陣子** |
| EV 憑證 | 更貴 | 通常立刻就有聲譽 |

**這是一個要花錢的決定，不是我可以自己做的。** 在決定之前，交付方式就是
「先講清楚會看到什麼，然後請他點過去」——這也是為什麼 `使用說明.txt` 的
第 2 步寫得比其他步驟長。

順帶一提，**防毒軟體有可能直接把未簽章的 PyInstaller 執行檔隔離或刪掉**，
成因跟 SmartScreen 一樣。那個情況對方沒辦法自己點過去，只能找人幫忙——
說明檔最後一段就是講這件事。

---

## 六、每次要重出一版時

```bash
# Mac：改完、測完、推上去
npm test && git push

# desk：拉、建、包
ssh desk 'cd /d E:\Project\interior-designer && git pull && build-desktop.bat'
ssh desk 'cd /d E:\Project\interior-designer && "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" packaging\installer.iss'

# 取回安裝程式
scp desk:"E:/Project/interior-designer/packaging/out/*.exe" ~/Desktop/
```

`AppId` 是固定的 GUID，所以新版會就地覆蓋舊版，不會在「安裝的應用程式」裡累積
好幾筆。改版號改 `installer.iss` 的 `AppVer`。

**收件者的圖不會被覆蓋。** SQLite 檔存在 `%APPDATA%\InteriorDesigner\`，
不在安裝目錄裡——`desktop.py` 的 `data_dir()` 刻意這樣分，理由寫在那支檔案裡
（安裝目錄在 macOS 上是唯讀的 .app、在 Windows 上可能落在 Program Files）。
