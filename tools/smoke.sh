#!/usr/bin/env bash
# 每一支工具、每一類檔案還在不在？（不驗結果，只驗「不會安靜地壞掉」）
#
# 存在的理由：工具與規則壞掉是**安靜的**。它不在測試裡、平常也沒人跑，
# 所以可以壞很久而沒有人知道。這支把「安靜」變成紅燈。
#
# 2026-09-16 產生，依這個專案當時實際有的東西量身寫的——加東西時要一起加檢查。
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0; n=0
check() { n=$((n+1)); if eval "$1" >/dev/null 2>&1; then printf '  ✓ %s\n' "$2"; else printf '  ✗ %s\n' "$2"; fail=$((fail+1)); fi; }

echo "冒煙測試 — interior-designer"
check "python3 tools/doc-audit.py" "tools/doc-audit.py 跑得起來且是綠的"
check "python3 -c 'import json;json.load(open(\"project-map.json\"))'" "project-map.json 是合法 JSON"
check "python3 -c 'import json;json.load(open(\"package.json\"))'" "package.json 是合法 JSON"
check "python3 -c 'import ast,glob,sys; fs=[f for f in glob.glob(\"scripts/**/*.py\",recursive=True) if \".venv\" not in f and \"__pycache__\" not in f]; sys.exit(2) if not fs else [ast.parse(open(f,encoding=\"utf-8\").read(),f) for f in fs]'" "scripts/ 的 5 支 .py 語法正確（掃到 0 支就 exit 2）"
check "python3 -c 'import ast,glob,sys; fs=[f for f in glob.glob(\"server/**/*.py\",recursive=True) if \".venv\" not in f and \"__pycache__\" not in f]; sys.exit(2) if not fs else [ast.parse(open(f,encoding=\"utf-8\").read(),f) for f in fs]'" "server/ 的 30 支 .py 語法正確（掃到 0 支就 exit 2）"
check "python3 -c 'import ast,glob,sys; fs=[f for f in glob.glob(\"tools/**/*.py\",recursive=True) if \".venv\" not in f and \"__pycache__\" not in f]; sys.exit(2) if not fs else [ast.parse(open(f,encoding=\"utf-8\").read(),f) for f in fs]'" "tools/ 的 3 支 .py 語法正確（掃到 0 支就 exit 2）"
check "python3 -c 'import glob,sys; fs=[f for f in glob.glob(\"**/*.ts\",recursive=True)+glob.glob(\"**/*.tsx\",recursive=True) if \"node_modules\" not in f]; sys.exit(0 if fs else 2)'" "82 個 .ts/.tsx 還在（掃到 0 個就 exit 2）"
check "python3 -c \"import re,pathlib,sys; sys.exit(1 if any(re.search(r'[\\$][A-Za-z_][A-Za-z0-9_]*(?=[^\\x00-\\x7F])', p.read_text(encoding='utf-8')) for p in pathlib.Path('tools').glob('*.sh')) else 0)\"" "tools/*.sh 裡沒有「錢字號變數緊接非 ASCII 字元」（本行刻意不寫那個符號——寫了就會觸發它自己）"
check "python3 tools/check-rules-paths.py" ".claude/rules/ 的 1 份規則，每條 paths: 都命中真實檔案"

# 沉默不等於成功：一支什麼都沒跑到的健檢，會印出一片空白然後回 0
if [ "$n" -lt 3 ]; then
  echo "✗ 只跑了 $n 項檢查 —— 這支腳本八成壞了，結果不可信"; exit 2
fi
if [ "$fail" -gt 0 ]; then echo "✗ $n 項裡有 $fail 項失敗"; exit 1; fi
echo "$n 項全過"
