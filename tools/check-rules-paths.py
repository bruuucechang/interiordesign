#!/usr/bin/env python3
""".claude/rules/*.md 的每條 paths: 都要命中真實檔案。

命中 0 個的 glob ＝ 那份規則永遠不會被載入，而它看起來跟正常的一模一樣。
這是最安靜的失效方式之一，所以做成紅燈。
"""
import glob
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RULES = ROOT / ".claude" / "rules"


def expand(pattern):
    """展開 {a,b} —— Python 的 glob 不支援，但規則檔裡會用。"""
    pats = [pattern]
    while any("{" in x for x in pats):
        out = []
        for x in pats:
            m = re.search(r"\{([^}]*)\}", x)
            out += ([x[:m.start()] + o + x[m.end():] for o in m.group(1).split(",")]
                    if m else [x])
        pats = out
    return pats


def main():
    if not RULES.is_dir():
        print("沒有 .claude/rules/，跳過")
        return 0
    files = sorted(RULES.glob("*.md"))
    if not files:
        print("✗ .claude/rules/ 存在但一份規則都沒有 —— 掃到 0 個目標，結果不可信",
              file=sys.stderr)
        return 2
    dead, total = [], 0
    for f in files:
        text = f.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---", text, re.S)
        if not m:
            dead.append(f"{f.name}：沒有 frontmatter，這份規則永遠不會被載入")
            continue
        paths = re.findall(r'^\s*-\s*"(.+)"\s*$', m.group(1), re.M)
        if not paths:
            dead.append(f"{f.name}：frontmatter 裡沒有 paths:")
            continue
        for p in paths:
            total += 1
            hits = sum(len(glob.glob(str(ROOT / x), recursive=True)) for x in expand(p))
            if hits == 0:
                dead.append(f"{f.name}：`{p}` 命中 0 個檔")
    if dead:
        print(f"✗ {len(files)} 份規則的 {total} 條 paths: 裡，有 {len(dead)} 條有問題：",
              file=sys.stderr)
        for d in dead:
            print("    " + d, file=sys.stderr)
        return 1
    print(f"{len(files)} 份規則的 {total} 條 paths: 都命中真實檔案。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
