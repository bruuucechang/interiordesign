// Reads a soak's JSONL and says whether anything drifted.
//
// A soak that only prints numbers makes you eyeball 96 rows. What matters is
// the comparison between the start and the end: memory that climbs, frames
// that get slower, errors that appear late.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const DIR = join(resolve(import.meta.dirname, '..'), 'bench/results');
const file = process.argv[2] ?? join(DIR, readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort().pop());
const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
if (!rows.length) { console.log('還沒有資料'); process.exit(0); }

const mb = (n) => n ? (n / 1048576).toFixed(0) + 'MB' : '—';
console.log(file.split('/').pop(), `— ${rows.length} 個週期，共 ${rows.at(-1).elapsedMin} 分鐘\n`);
for (const r of rows) {
  const p = r.perf;
  console.log(
    String(r.elapsedMin).padStart(6) + 'min  ' +
    `2D p50 ${p.render2d.p50.toFixed(2)} p95 ${p.render2d.p95.toFixed(2)}  ` +
    `3D p50 ${p.render3d.p50.toFixed(2)}  ` +
    `build p50 ${p.build3d.p50.toFixed(1)} max ${p.build3d.max.toFixed(1)}  ` +
    `heap ${mb(r.heap)}  節點 ${r.nodes}` +
    (r.errors.length ? `  ⚠︎ ${r.errors.length}` : ''),
  );
}

// Compare windows, not endpoints.
//
// The first version compared the first row with the last and called a 52% jump
// in heap a leak. It was not: heap sawtooths between collections, so two
// arbitrary points on the wave say whatever the sampling happened to catch.
// What a leak actually looks like is the *floor* rising — the level memory
// returns to after a collection — so that is what gets compared, over the first
// and last quarter of the run. Frame times use the median of each window for
// the same reason.
const q = Math.max(1, Math.floor(rows.length / 4));
const head = rows.slice(0, q), tail = rows.slice(-q);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
// Only growth is a warning. The first version flagged any change over 25% in
// either direction, so a run that got 43% *faster* came back with a ⚠︎ next to
// it — and a report that warns about good news teaches you to skip the
// warnings, which is the one thing it must not do.
const drift = (pick, label, unit = 'ms', agg = med) => {
  const a = agg(head.map(pick).filter((v) => v != null));
  const b = agg(tail.map(pick).filter((v) => v != null));
  if (a == null || b == null || !a) return;
  const pct = ((b - a) / a * 100);
  const mark = pct > 25 ? '⚠︎' : pct < -25 ? '↓' : '·';
  console.log(`  ${mark} ${label}: ${a.toFixed(2)}${unit} → ${b.toFixed(2)}${unit}  (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`);
};
const lo = (xs) => Math.min(...xs);
console.log(`\n前 ${q} 個週期 → 後 ${q} 個週期`);
drift(r => r.perf.render2d.p50, '2D 每幀（中位數）');
drift(r => r.perf.render3d.p50, '3D 每幀（中位數）');
drift(r => r.perf.build3d.p50, '3D 重建（中位數）');
drift(r => r.heap / 1048576, 'JS heap 回收後底線', 'MB', lo);
drift(r => r.nodes, 'DOM 節點', ' 個', lo);
const errs = rows.flatMap(r => r.errors);
// One-off spikes are worth naming: a 500 ms build that happens once is a cold
// start, and one that happens every twentieth cycle is something else.
const spikes = rows.filter((r) => r.perf.build3d.max > 60).length;
if (spikes) {
  const worst = Math.max(...rows.map((r) => r.perf.build3d.max));
  console.log(`\n· 3D 重建尖峰 >60ms: ${spikes}/${rows.length} 個週期，最大 ${worst.toFixed(0)}ms`);
}

console.log(errs.length ? `\n⚠︎ 共 ${errs.length} 個錯誤：\n` + [...new Set(errs)].slice(0, 8).map(e => '  ' + e).join('\n') : '\n· 全程零錯誤');
