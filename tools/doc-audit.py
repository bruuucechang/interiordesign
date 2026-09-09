#!/usr/bin/env python3
"""文件腐爛偵測：規則檔與 docs/ 裡提到的路徑，現在還在不在。

    python3 tools/doc-audit.py

文件腐爛是必然的，差別只在「多久之後被發現」。2026-09-09 讓 Codex 把九個專案
讀過一遍，十四條屬實的發現裡有四條是這一類——文件寫的檔案／欄位已經不在了，
而沒有任何東西會說。這支把那個延遲壓到一個指令。

比對規則調校過三輪，每一條都對應一次誤報：

  · 跳過 glob（`.claude/rules/*.md` 不是一個檔）
  · 跳過沒有斜線又沒有副檔名的裸字（`services` 是名詞不是路徑）
  · 允許**後綴比對**——文件常寫簡稱（`api/client.ts` 指的是
    `frontend/src/api/client.ts`），那不算腐爛
  · 跳過不屬於這個 repo 的路徑（`~`、絕對路徑、`.claude/`、`.projctl/`）

**沉默不等於成功**：一個路徑都沒掃到一定是比對規則壞了，不是文件很乾淨，
所以那種情況 exit 2 並明說結果不可信。

剩下的誤報全是同一種：**文件正在講那個路徑「不存在」**——反面示範
（「不要用 `plugins/echarts.client.ts` 這樣做」）、搬走之前的舊位置、
還沒建起來的檔、別的 repo 的檔。正則分不出這件事，所以走 `doc-audit-allow.txt`。

那個檔**會自己過期**：例外裡的路徑哪天真的出現了、或是它在文件裡的那句話
被刪了，這支就報錯要人回來清。**一個永遠紅的檢查等於沒有檢查，而一個
永遠綠的例外清單等於沒有檢查的另一半**——例外一旦寫下就不再有人看它是否
還成立，於是它會慢慢把真的腐爛也蓋掉。
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# **只掃每個 session 都會載入的規則檔。**
#
# 刻意不掃 docs/ —— notebook 與各種 dev-analysis 是**檔案庫**，它們本來就在描述
# 過去的結構（News 的 dev-analysis.md 講的是 2026-08-07 移除的 Streamlit views/）。
# 把它們算進來的話，這支工具會為了「歷史文件描述歷史」而永遠是紅的，
# 而一個永遠紅的檢查等於沒有檢查。
#
# 這支要問的是：**現在每次都被讀進去的那份規則，還對得上程式碼嗎。**
DOCS = [p for p in (ROOT / "AGENTS.md", ROOT / "CLAUDE.md") if p.exists()]

PATH_RE = re.compile(r"`([^`\n]+)`")

ALLOW_FILE = ROOT / "tools" / "doc-audit-allow.txt"


def _allow():
    """讀例外清單：每行 `路徑  # 為什麼它不該存在`。理由是必填的。"""
    out = {}
    if not ALLOW_FILE.exists():
        return out
    for n, line in enumerate(ALLOW_FILE.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        path, _, why = line.partition("#")
        path, why = path.strip(), why.strip()
        if not why:
            raise SystemExit(
                f"{ALLOW_FILE.name}:{n} 只寫了路徑沒寫理由。\n"
                "沒有理由的例外，下一個人看到時無從判斷它還成不成立，"
                "而那正是例外清單開始蓋掉真腐爛的那一刻。"
            )
        out[path] = why
    return out


ALLOWED = _allow()

# 每一條都對應一次實測到的誤報，不要憑感覺放寬或收緊：
#   `lineWidth/2`                    算式，不是路徑
#   `<span></span>`                  HTML
#   `Docker.app/.../bin`             省略過的路徑
#   `%USERPROFILE%\.agent-quota\…`   Windows 環境變數
#   `bruuucechang/projctl`           GitHub repo 代稱
#   `backend/app/database.py:7`      file:line（要先剝掉 :7）
#   `.env` / `backend/ledger.db`     gitignore 的執行期產物
SKIP = re.compile(
    r"^(https?:|__|\$|-|#|%)"      # URL、樣板變數、指令、環境變數
    r"|\s|\*"                      # 空白、glob
    r"|[<>\\|]"                    # HTML、Windows 路徑分隔、管線
    r"|\.\.\."                      # 省略號
    r"|^[A-Za-z][A-Za-z0-9]*/\d+$"  # lineWidth/2 這種算式
)
EXT = (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".swift", ".sql", ".json", ".jsonc",
       ".md", ".sh", ".cmd", ".toml", ".ini", ".yml", ".yaml", ".plist", ".html", ".css",
       ".vue", ".mts", ".xcodeproj", ".txt", ".env")
EXTERNAL = ("~", "/", ".claude/", ".projctl/", ".codex/")

ALL = [
    str(p.relative_to(ROOT))
    for p in ROOT.rglob("*")
    if p.is_file()
    and not any(part in {".git", "node_modules", ".venv", "dist", "build", "__pycache__",
                         ".next", ".nuxt", "DerivedData"} for part in p.parts)
]

def _gitignored(paths):
    """一次問 git 哪些是被忽略的——執行期產物不存在是正常的，不是文件腐爛。"""
    if not paths:
        return set()
    try:
        import subprocess
        r = subprocess.run(["git", "-C", str(ROOT), "check-ignore", "--stdin"],
                           input="\n".join(paths), capture_output=True, text=True, timeout=20)
        return set(r.stdout.split("\n")) - {""}
    except Exception:
        return set()


# 先收集所有候選，一次問 git，避免每個路徑各開一支程序
_cands = set()
for _doc in DOCS:
    for _raw in PATH_RE.findall(_doc.read_text(encoding="utf-8", errors="ignore")):
        _s = re.sub(r":\d+(-\d+)?$", "", _raw.strip().rstrip("/"))
        if not SKIP.search(_s) and not _s.startswith(EXTERNAL):
            _cands.add(_s)
ignored = _gitignored(sorted(_cands))

missing, checked = [], 0
stale, seen_allowed = [], set()
for doc in DOCS:
    for raw in PATH_RE.findall(doc.read_text(encoding="utf-8", errors="ignore")):
        s = raw.strip().rstrip("/")
        s = re.sub(r":\d+(-\d+)?$", "", s)      # file:line / file:12-20
        if SKIP.search(s) or s.startswith(EXTERNAL):
            continue
        # 一定要看起來像這個 repo 裡的檔：有已知副檔名，或是一段存在的目錄路徑
        if not (s.endswith(EXT) or (ROOT / s).is_dir()):
            continue
        if s in ignored:                        # gitignore 的執行期產物不算腐爛
            continue
        checked += 1
        here = (ROOT / s).exists() or any(a == s or a.endswith("/" + s) for a in ALL)
        if s in ALLOWED:
            seen_allowed.add(s)
            if here:
                stale.append((s, ALLOWED[s], "它現在存在了"))
            continue
        if not here:
            missing.append((doc.name, s))

for a, why in ALLOWED.items():
    if a not in seen_allowed:
        stale.append((a, why, "文件裡已經沒有提到它了"))

if checked == 0:
    print("✗ 一個路徑都沒掃到 —— 比對規則八成壞了，這次結果不可信", file=sys.stderr)
    sys.exit(2)

if stale:
    print(f"✗ {ALLOW_FILE.relative_to(ROOT)} 有 {len(stale)} 條例外過期了 —— 例外要跟著文件走：")
    for a, why, cause in stale:
        print(f"    `{a}`（原本的理由：{why}）—— {cause}")
    print("  把它從例外清單移掉。留著的話它會蓋掉之後真的發生在這個路徑上的腐爛。")
    sys.exit(1)

if missing:
    for d, s in missing:
        print(f"✗ {d} 提到 `{s}`，但它不存在")
    print(f"\n掃了 {checked} 個路徑，{len(missing)} 個已經不在了。")
    sys.exit(1)

_ex = f"，另有 {len(ALLOWED)} 個記在例外清單" if ALLOWED else ""
print(f"{len(DOCS)} 份文件裡的 {checked} 個路徑都還在{_ex}。")
