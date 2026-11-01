// 一次跑完 bench/verify-*.mjs，列總表；任何一支紅就 exit 1。
//
//   npm run verify:all                 # 要先 npm run dev（:5180 + :8791）
//   npm run verify:all -- b19 resflash # 只跑名字含這些字的
//
// 為什麼要這支（2026-11-01）：29 支驗收腳本一支一支跑，結果 9 支早就紅了沒人發現——
// A1 換成豪宅版之後數字全對不上、預設的方案被刪掉、房間自動辨識讓數網格的檢查失準。
// 沒有一次跑完的入口，每支只在寫它的那個 session 被跑過。
//
// 先 build（有幾支是對 client/dist 起自己的伺服器），再依序跑——它們都要 GPU，
// 並行跑會互相拖慢，量時間的那幾支就會誤報。
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIMIT_MS = 10 * 60 * 1000;
// 沒有可判斷的結論，不進總表（verify-flicker 本來在這裡，2026-11-01 移除：移動那一半量不出東西；
// 閃爍改由 verify-resflash 逐幀量）：
const SKIP = {};

const only = process.argv.slice(2);
const all = readdirSync(resolve(ROOT, 'bench')).filter(f => /^verify-.*\.mjs$/.test(f) && f !== 'verify-all.mjs').sort();
const picked = all.filter(f => !only.length || only.some(o => f.includes(o)));

for (const [url, what] of [['http://localhost:5180/', '前端（npm run dev）'], ['http://localhost:8791/api/health', '後端（npm run dev）']]) {
  const ok = await fetch(url).then(r => r.ok, () => false);
  if (!ok) { console.error(`${what} 沒開：${url}`); process.exit(2); }
}

console.log('build…');
const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
if (build.status !== 0) { console.error(build.stdout.slice(-2000), build.stderr.slice(-2000)); process.exit(1); }

const run = (file) => new Promise(done => {
  const t0 = Date.now();
  const p = spawn('node', [resolve(ROOT, 'bench', file)], { cwd: ROOT });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  const timer = setTimeout(() => { out += `\n逾時 ${LIMIT_MS / 60000} 分鐘，砍掉`; p.kill('SIGKILL'); }, LIMIT_MS);
  p.on('close', code => { clearTimeout(timer); done({ code, out, s: Math.round((Date.now() - t0) / 1000) }); });
});

const rows = [];
for (const f of picked) {
  const name = f.replace(/\.mjs$/, '');
  if (SKIP[name]) { rows.push([name, '略過', '', SKIP[name]]); continue; }
  process.stdout.write(`${name} … `);
  const r = await run(f);
  const bad = r.out.split('\n').filter(l => /^\s*[✖✘]/.test(l));
  const ok = r.code === 0;
  console.log(`${ok ? '✔' : '✖'} ${r.s}s`);
  rows.push([name, ok ? '✔' : '✖', `${r.s}s`, ok ? '' : (bad.slice(0, 3).join(' / ') || r.out.trim().split('\n').slice(-3).join(' / ')).slice(0, 300)]);
}

console.log('\n' + rows.map(r => r.join('  ')).join('\n'));
const failed = rows.filter(r => r[1] === '✖').length;
console.log(`\n${rows.length} 支：${rows.filter(r => r[1] === '✔').length} 過、${failed} 紅、${rows.filter(r => r[1] === '略過').length} 略過`);
process.exit(failed ? 1 : 0);
