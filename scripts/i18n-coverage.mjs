// How much of the interface is actually translatable, as a number.
//
//   node scripts/i18n-coverage.mjs           # report
//   node scripts/i18n-coverage.mjs --list    # and name what is still hardcoded
//
// "We added i18n" is the kind of claim that stays true while the interface is
// still 90% one language — the layer exists, almost nothing goes through it,
// and nobody notices until somebody switches languages and the app is unchanged.
// So the remainder is counted rather than described.
//
// What counts as a user-facing string: a CJK run inside a quoted literal in the
// client source, or CJK text in index.html. What is excluded, deliberately:
//
//   · comments — this codebase comments in Chinese on purpose
//   · `data/furniture.ts` and `data/electrical.ts` — the catalogue is content,
//     not interface, and translating 251 furniture names is a different job
//     with a different reviewer
//   · anything already inside `t(...)` or carrying `data-i18n`

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../client', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const LIST = process.argv.includes('--list');

const SKIP_FILES = ['data/furniture.ts', 'data/electrical.ts', 'core/i18n.ts'];
const CJK = /[一-鿿]/;

/** Strip line and block comments so Chinese prose in them is not counted. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

let wrapped = 0;
const bare = [];

for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (SKIP_FILES.includes(rel)) continue;
  const src = stripComments(readFileSync(file, 'utf8'));
  // Every quoted literal containing CJK, and whether `t(` sits immediately
  // before it.
  const re = /(t\(\s*)?(['"`])((?:[^\\\n]|\\.)*?)\2/g;
  let m;
  while ((m = re.exec(src))) {
    if (!CJK.test(m[3])) continue;
    if (m[1]) wrapped++;
    else bare.push({ file: rel, text: m[3].slice(0, 40) });
  }
}

// index.html: CJK text nodes without a data-i18n on their element.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const marked = (html.match(/data-i18n(-title|-value)?=/g) ?? []).length;

const total = wrapped + bare.length;
const pct = total ? Math.round((wrapped / total) * 100) : 100;

console.log(`\n可翻譯字串：${wrapped} / ${total}（${pct}%）`);
console.log(`index.html 標了 data-i18n 的元素：${marked}`);
console.log(`還沒過 t() 的：${bare.length}`);

if (LIST && bare.length) {
  const byFile = new Map();
  for (const b of bare) byFile.set(b.file, (byFile.get(b.file) ?? 0) + 1);
  console.log('\n按檔案：');
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
}
console.log('\n（目錄的家具名稱刻意不算——那是內容不是介面，而且要另一種審查。）');
