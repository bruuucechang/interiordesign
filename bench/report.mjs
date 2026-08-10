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

const first = rows[0], last = rows.at(-1);
const drift = (a, b, label, unit = 'ms') => {
  if (!a || !b) return;
  const pct = ((b - a) / a * 100);
  const bad = Math.abs(pct) > 25;
  console.log(`  ${bad ? '⚠︎' : '·'} ${label}: ${a.toFixed(2)}${unit} → ${b.toFixed(2)}${unit}  (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`);
};
console.log('\n第一個週期 → 最後一個週期');
drift(first.perf.render2d.p50, last.perf.render2d.p50, '2D 每幀');
drift(first.perf.render3d.p50, last.perf.render3d.p50, '3D 每幀');
drift(first.perf.build3d.p50, last.perf.build3d.p50, '3D 重建');
drift(first.heap / 1048576, last.heap / 1048576, 'JS heap', 'MB');
drift(first.nodes, last.nodes, 'DOM 節點', ' 個');
const errs = rows.flatMap(r => r.errors);
console.log(errs.length ? `\n⚠︎ 共 ${errs.length} 個錯誤：\n` + [...new Set(errs)].slice(0, 8).map(e => '  ' + e).join('\n') : '\n· 全程零錯誤');
