// B6 驗收：plan1151022 每個房間的整間平均、自動區域、B6 自訂的達標區域與照明健檢。
//
//   cd client && npx tsx ../scripts/report-b6.mts          # 方案 + furnish-b6.mjs 現在的配置（不寫入）
//   cd client && npx tsx ../scripts/report-b6.mts --db     # 只看資料庫裡存的那份
//
// 要 :8791 在跑。走面板用的同一條路（lightFloor → roomZones → zoneStat → lightingFindings），
// 看法固定：桌面 75、全部迴路開著、中間色牆面、5 cm 格點。
//
// 客廳、廚房、衛浴、陽台沒有床或書桌，App 只會生出門口與櫃子前的區域，所以 B6 另外定了
// 幾個「達標區域」（AREAS），數字是 CNS 12112 住宅照度的一般值取下限——**是假設**，
// 理由寫在 docs/lighting-plan.md。
//
// 不過關（exit 1）的條件：B6 的房間任一個自動區域或達標區域沒達標、或有任何健檢提醒
// （書桌加檯燈那一條除外）。B5 的兩間只印出來，不計。

import { CEIL, allObjects, loadPlan } from './furnish-b6.mjs';
import { lightFloor } from '../client/src/core/lightmap';
import { roomZones, litBy, zoneStat, verdict } from '../client/src/core/lightzones';
import { lightingFindings } from '../client/src/core/lightcheck';
import { REFLECTANCE, inside, isBlocked, lux } from '../client/src/core/lighting';
import type { Obj } from '../client/src/model/schema';

const RHO = REFLECTANCE.medium, PLANE = 75, STEP = 5;

/** 整間平均的下限（桌面 75）。 */
const ROOM_NEED: Record<string, number> = {
  'Peter 房間': 150, '老爸房間': 150, '客廳＋廚房': 150,
  '衛浴 A': 100, '衛浴 B': 100, '陽台': 50,
  'Bruce 房間': 150, '老媽房間': 150,
};
const B5 = new Set(['Bruce 房間', '老媽房間']);

/** B6 自訂的達標區域：[房間, 名稱, x0, x1, y0, y1, 量測高度, 平均要 ≥] */
const AREAS: [string, string, number, number, number, number, number, number][] = [
  ['客廳＋廚房', '玄關', 62, 225, 597, 747, PLANE, 100],
  ['客廳＋廚房', '走道（臥室門前）', 290, 792, 600, 760, PLANE, 100],
  ['客廳＋廚房', '客廳', 290, 814, 762, 1036, PLANE, 150],
  ['客廳＋廚房', '流理台面（西段）', 244, 294, 1072, 1167, 85, 300],
  ['客廳＋廚房', '流理台面（南段）', 244, 551, 1167, 1226, 85, 300],
  ['衛浴 A', '洗手台前 60', 1254, 1314, 365, 518, PLANE, 200],
  ['衛浴 B', '洗手台前 60', 1044, 1104, 671, 731, PLANE, 200],
];

const db = process.argv.includes('--db');
const { floor } = await loadPlan();
const objs: Obj[] = db ? floor.objects : [...floor.objects.filter((o: Obj) => !o.id.startsWith('b6_')), ...allObjects()];
const lit = lightFloor(objs, CEIL, { height: PLANE, rho: RHO, on: null, step: STEP });
const findings = lightingFindings(objs, CEIL);
const f0 = (v: number | null | undefined) => v == null ? '–' : Math.round(v).toString();

let fail = 0;
console.log(db ? '（資料庫裡存的那份）' : '（方案 + furnish-b6.mjs 現在的配置，未寫入）');
for (const r of lit) {
  const name = r.room.name ?? '';
  const b5 = B5.has(name);
  const bad = (cond: boolean) => { if (cond && !b5) fail++; return cond ? '✗' : '✓'; };
  const need = ROOM_NEED[name];
  // 房間改了名，門檻與達標區域就會安靜地對不上——不認得的名字直接算不過。
  if (need == null) { fail++; console.log(`\n✗ 不認得的房間「${name}」`); continue; }
  const lm = r.lums.length, lumens = Math.round(r.lumens);
  console.log(`\n## ${name}${b5 ? '（B5，只列出）' : ''}`);
  console.log(`  燈 ${lm} 盞、${lumens} lm、${r.area.toFixed(1)} m²｜整間平均 ${f0(r.grid.avg)}（≥${need} ${bad(r.grid.avg < need)}）`
    + `｜最暗 ${f0(r.grid.min)}｜均勻度 ${r.grid.uniformity.toFixed(2)}`);
  if (!lm) { if (!b5) fail++; console.log('  ✗ 沒有燈'); continue; }
  const l = litBy(r.lr, r.lums, RHO);
  for (const z of roomZones(r.lr, objs, CEIL)) {
    const st = zoneStat(r.lr, l, z);
    const v = st ? verdict(st.avg, z.need) : null;
    // 書桌不夠是提示加檯燈，不算不過。
    const who = (objs.find(o => o.id === z.target) as any)?.label;
    console.log(`  區域 ${z.name}${who ? `（${who}）` : ''}：平均 ${f0(st?.avg)}、最暗 ${f0(st?.min)}（≥${z.need} ${z.type === 'desk' && v !== 'ok' ? '· 加檯燈' : bad(v !== 'ok')}）`);
  }
  for (const [room, label, x0, x1, y0, y1, h, n] of AREAS) {
    if (room !== name) continue;
    let sum = 0, cnt = 0, mn = Infinity;
    for (let y = y0 + STEP / 2; y < y1; y += STEP) for (let x = x0 + STEP / 2; x < x1; x += STEP) {
      if (!inside(r.lr.poly, x, y) || isBlocked(r.lr, x, y)) continue;
      const e = lux(l.src, x, y, h, l.ind);
      sum += e; cnt++; mn = Math.min(mn, e);
    }
    const avg = cnt ? sum / cnt : 0;
    console.log(`  達標 ${label}（高 ${h}）：平均 ${f0(avg)}、最暗 ${f0(cnt ? mn : null)}（≥${n} ${bad(avg < n)}）`);
  }
  const fs = findings.filter(f => f.room === r.room.id);
  for (const f of fs) {
    const lamp = f.rule === 'light-zone' && /桌面/.test(f.title);
    // 健檢把燈分給「第一間照到它的」房間，指到 b6_* 的提醒就算落在 B5 那兩間也要算。
    const mine = !b5 || f.targets.some(t => t.startsWith('b6_'));
    if (!lamp && mine) fail++;
    console.log(`  ${lamp || !mine ? '·' : '✗'} [${f.rule}] ${f.title}：${f.detail}`);
  }
}
// 少了一間房，迴圈根本走不到它；照名字點名一次。
const seen = new Set(lit.map(r => r.room.name));
for (const n of new Set([...Object.keys(ROOM_NEED), ...AREAS.map(a => a[0])])) {
  if (!seen.has(n)) { fail++; console.log(`✗ 方案裡沒有房間「${n}」`); }
}
const loose = findings.filter(f => !f.room);
for (const f of loose) { fail++; console.log(`✗ （不屬於任何房間）[${f.rule}] ${f.title}：${f.detail}`); }
console.log(`\n${fail ? `✗ ${fail} 項不過` : '✓ B6 的六個空間全部達標、沒有健檢提醒'}`);
process.exit(fail ? 1 : 0);
