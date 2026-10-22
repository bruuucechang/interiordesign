// Checks a plan against the dimensions printed on 平面配置圖 1151022.
//
//   node scripts/check-pdf1151022.mjs                 # 讀資料庫裡的 plan1151022（經 API）
//   node scripts/check-pdf1151022.mjs /tmp/p.json     # 讀檔案
//
// Every number on that sheet is face to face (the 480 is Peter 房's clear width,
// not centre to centre), so each check finds the two walls by their centre line
// and measures between the faces that look into the span. Exit 1 if any is off
// by more than TOL — the B4 acceptance (blocks.md).
//
// The two ends that are not wall faces on the sheet either are kept as the
// sheet has them: 1374 starts at x = 0 and 1227 at y = 0, which is how
// trace-pdf1151022.mjs defines its origin.

import { readFileSync } from 'node:fs';

const TOL = 5;
const src = process.argv[2];
const plan = src
  ? JSON.parse(readFileSync(src, 'utf8'))
  : await (await fetch('http://127.0.0.1:8791/api/projects/plan1151022', {
    headers: { 'X-Owner': 'own_orsxp52fbvey' },
  })).json().then((r) => r.data ?? r);
const walls = plan.floors[0].objects.filter((o) => o.kind === 'wall' && !o.bulge);

// A wall running along `axis` ('V' = constant x) whose centre is within 1 cm of
// `c` and which covers `at` along its length. Returns its two faces.
function faces(axis, c, at) {
  const w = walls.find((w) => {
    const [p, q] = axis === 'V' ? [w.a.x, w.b.x] : [w.a.y, w.b.y];
    const [s, t] = axis === 'V' ? [w.a.y, w.b.y] : [w.a.x, w.b.x];
    return Math.abs(p - c) < 1 && Math.abs(q - c) < 1
      && at >= Math.min(s, t) - 1 && at <= Math.max(s, t) + 1;
  });
  if (!w) throw new Error(`找不到 ${axis} ${c} 經過 ${at} 的牆`);
  const mid = axis === 'V' ? w.a.x : w.a.y;
  return [mid - w.thickness / 2, mid + w.thickness / 2];
}
// Face of wall A that looks toward wall B, to face of B that looks toward A.
const clear = (axis, ca, cb, at) => {
  const [, aHi] = faces(axis, ca, at);
  const [bLo] = faces(axis, cb, at);
  return bLo - aHi;
};

// A column's extent along its centre line is the line's own length.
const col = (cx, y0) => {
  const w = walls.find((w) => Math.abs(w.a.x - cx) < 1 && Math.abs(Math.min(w.a.y, w.b.y) - y0) < 1);
  if (!w) throw new Error(`柱子不見了（x ${cx}，上緣 ${y0}）`);
  return [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)];
};

// [label, printed, measured]
const CHECKS = [
  ['總寬（0 → 衛浴 A 東牆內面）', 1374, faces('V', 1381.9, 300)[0] - 0],
  ['總深（0 → Bruce 房南牆內面）', 1227, faces('H', 1234.45, 1000)[0] - 0],
  ['Peter 房淨寬', 480, clear('V', 2.7, 497.7, 300)],
  ['老爸房淨寬（到東北柱）', 286, faces('V', 823.7, 130)[0] - faces('V', 497.7, 300)[1]],
  ['老媽房淨寬', 347, clear('V', 848.7, 1211, 300)],
  ['衛浴 A 淨寬', 156, clear('V', 1211, 1381.9, 300)],
  ['0 → 衛浴 A 南牆北面', 596, faces('H', 602.9, 1300)[0] - 0],
  ['衛浴 A 淨深', 433, clear('H', 155.1, 602.9, 1300)],
  ['衛浴 B 淨深', 169, clear('H', 602.9, 786.5, 1100)],
  ['Bruce 房淨深', 433, clear('H', 786.5, 1234.45, 1100)],
  ['Peter 房西側（柱頂 → 大門牆北面）', 678, faces('H', 754.5, 100)[0] - col(15.65, 69.6)[0]],
  ['玄關（隔間南面 → 大門牆北面）', 150, clear('H', 592, 754.5, 100)],
  ['底寬（廚房西牆內面 → Bruce 房東牆內面）', 994, faces('V', 1245.2, 1000)[0] - faces('V', 234.55, 1000)[1]],
  ['廚房', 307, clear('V', 234.55, 558.7, 1100)],
  ['陽台', 277, clear('V', 558.7, 850.3, 1100)],
  ['Bruce 房淨寬', 380, clear('V', 850.3, 1245.2, 1000)],
  ['廚房西側（柱底 → 南牆內面）', 424, faces('H', 1234.45, 400)[0] - col(256.5, 709.9)[1]],
];

let bad = 0;
for (const [label, want, got] of CHECKS) {
  const d = got - want;
  const ok = Math.abs(d) <= TOL;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(30)} 圖 ${String(want).padStart(5)}  量 ${got.toFixed(1).padStart(7)}  差 ${d >= 0 ? '+' : ''}${d.toFixed(1)}`);
}
console.log(bad ? `${bad} 項超過 ±${TOL} cm` : `全部 ${CHECKS.length} 項在 ±${TOL} cm 內`);
process.exit(bad ? 1 : 0);
