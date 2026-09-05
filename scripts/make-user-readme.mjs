// Writes the note that ships next to the executable.
//
//   node scripts/make-user-readme.mjs dist/InteriorDesigner
//
// Generated rather than copied from the repo for two reasons: the filename is
// Chinese, and `copy` in a .bat obeys the console code page, so shipping it as
// a checked-in file was a mojibake waiting to happen. Node also lets us write
// a BOM and CRLF, which is what Notepad on an older Windows needs to not show
// the whole thing as one line.
//
// The audience is somebody who does not know what a folder is. So:
//
//   · no jargon, no "simply", no steps that assume a previous step worked
//   · the two frightening moments are named **before** they happen, because a
//     person who has already decided the file is a virus does not read on
//   · it says what is normal, not just what to do — "a black window opens" is
//     the single most likely reason this gets abandoned, and it is not an error
//
// It deliberately does not explain what the app does. They asked for it; the
// in-app tour covers the rest.

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error(`用法：node scripts/make-user-readme.mjs <輸出資料夾>（找不到 ${dir}）`);
  process.exit(1);
}

const TEXT = `室內設計繪圖 —— 怎麼打開

──────────────────────────────────────────
第 1 步：打開程式
──────────────────────────────────────────

桌面上會有一個圖示，名字是

    室內設計繪圖

用滑鼠左鍵在它上面連點兩下。

（找不到的話，按鍵盤左下角的「開始」，
　直接打「室內設計」四個字，它就會出現。）


──────────────────────────────────────────
第 2 步：會跳出一個藍色畫面，這是正常的
──────────────────────────────────────────

畫面上會寫「Windows 已保護您的電腦」。

這不是病毒警告。這個程式沒有去跟微軟買認證，
所以 Windows 對它不熟，不是它有問題。

    1. 點畫面上的「其他資訊」
    2. 下面會多出一顆「仍要執行」，點它

只有第一次要做這個動作，之後就不會再問了。


──────────────────────────────────────────
第 3 步：會跳出一個黑色的視窗，不要關掉它
──────────────────────────────────────────

那個黑色視窗就是程式本身。它會一直開著，這是對的。

    ★ 關掉黑色視窗 = 關掉這個程式 ★

先不要管它，把它放在旁邊就好。


──────────────────────────────────────────
第 4 步：等幾秒，網頁會自己打開
──────────────────────────────────────────

畫圖的畫面會出現在你平常上網的瀏覽器裡。

如果等了超過半分鐘還是沒有出現：
看黑色視窗裡最上面那一行，長得像

    InteriorDesigner 執行中： http://127.0.0.1:8791/

把 http:// 開頭那一段整個抄到瀏覽器的網址列，按 Enter。


──────────────────────────────────────────
第一次進去會有教學
──────────────────────────────────────────

畫面會一步一步告訴你每個按鈕是做什麼的。
不想看的話，點「跳過」就好，之後想再看一次也可以。


──────────────────────────────────────────
要結束的時候
──────────────────────────────────────────

把那個黑色視窗關掉就結束了。
瀏覽器的分頁可以直接關掉，沒有關係。


──────────────────────────────────────────
你畫的圖存在哪裡
──────────────────────────────────────────

存在你自己的電腦裡，不會傳到網路上，
別人看不到，也不需要帳號密碼。

存放的位置寫在黑色視窗的第二行。


──────────────────────────────────────────
如果防毒軟體把它擋掉或刪掉
──────────────────────────────────────────

原因跟第 2 步一樣：沒有買認證的程式，
防毒軟體有時候會直接當成可疑的。

這種情況沒辦法自己點過去，請找給你這個程式的人幫忙。
`;

const out = join(dir, '使用說明.txt');
writeFileSync(out, '﻿' + TEXT.replace(/\n/g, '\r\n'), 'utf8');
console.log(`寫出 ${out}`);
