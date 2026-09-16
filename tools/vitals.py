#!/usr/bin/env python3
"""文件裡引用的數字，現在實際是多少。

數字不會自己更新，而底下的東西一直在動。文件寫數字就要附上產生那個數字的指令
（AGENTS.md 的規則），這支就是那個指令。

2026-09-16 產生。掃到 0 個目標時 exit 2，不允許把「什麼都沒掃到」印成通過。
"""
import glob
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP = ("node_modules", ".venv", ".git", "__pycache__", "dist/", ".build")


def count(pattern):
    return len([f for f in glob.glob(str(ROOT / pattern), recursive=True)
                if not any(s in f for s in SKIP)])


def lines(path):
    p = ROOT / path
    return p.read_text(encoding="utf-8").count("\n") + 1 if p.exists() else 0


rows = []
rows.append(("scripts/ 的 .py 支數", count("scripts/**/*.py")))
rows.append(("server/ 的 .py 支數", count("server/**/*.py")))
rows.append(("tools/ 的 .py 支數", count("tools/**/*.py")))
rows.append(("前端 .ts/.tsx 支數", count("**/*.ts") + count("**/*.tsx")))
rows.append(("tools/ 裡的檔數", count("tools/*")))
rows.append(("AGENTS.md 行數", lines("AGENTS.md")))
rows.append(("docs/notebook.md 行數", lines("docs/notebook.md")))
rows.append((".claude/rules/ 份數", count(".claude/rules/*.md")))

if not rows:
    print("✗ 一個指標都沒產生 \u2014\u2014 這支壞了", file=sys.stderr)
    sys.exit(2)

zero = [k for k, v in rows if isinstance(v, int) and v == 0]
print(f"# interior-designer vitals")
for k, v in rows:
    print(f"{k:<34} {v}")
if zero:
    print(f"\n✗ 這 {len(zero)} 個指標是 0，多半代表掃描路徑已經不對了："
          f" {', '.join(zero)}", file=sys.stderr)
    sys.exit(2)
