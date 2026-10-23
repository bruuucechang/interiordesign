// B6 驗收：plan1151022 每個房間的整間平均、各區域（含子區域）與照明健檢。
//
//   cd client && npx tsx ../scripts/report-b6.mts          # 方案 + furnish-b6.mjs 現在的配置（不寫入）
//   cd client && npx tsx ../scripts/report-b6.mts --db     # 只看資料庫裡存的那份
//
// 要 :8791 在跑。走面板用的同一條路（lightFloor → roomZones → zoneStat → lightingFindings），
// 看法固定：桌面 75、全部迴路開著、中間色牆面、5 cm 格點。
//
// 客廳、廚房、衛浴、陽台沒有床或書桌。流理台面與洗手台前 App 會自己生（B11，目標在
// locale-defaults.ts::LIGHTING）；玄關、走道、東側小廳、客廳、廚房是方案裡畫的子區域
// （B12，座標與目標在 furnish-b6.mjs 的 AREAS）。數字是 CNS 12112 住宅照度的一般值取
// 下限——**是假設**，理由寫在 docs/lighting-plan.md。
//
// 不過關（exit 1）的條件：B6 的房間任一個區域沒達標、或有任何健檢提醒
// （書桌加檯燈那一條除外）。B5 的兩間只印出來，不計。

import { AREAS, CEIL, allObjects, loadPlan } from './furnish-b6.mjs';
import { lightFloor } from '../client/src/core/lightmap';
import { roomZones, litBy, zoneStat, verdict } from '../client/src/core/lightzones';
import { lightingFindings } from '../client/src/core/lightcheck';
import { REFLECTANCE } from '../client/src/core/lighting';
import type { Obj } from '../client/src/model/schema';

const RHO = REFLECTANCE.medium, PLANE = 75, STEP = 5;

/** 整間平均的下限（桌面 75）。 */
const ROOM_NEED: Record<string, number> = {
  'Peter 房間': 150, '老爸房間': 150, '客廳＋廚房': 150,
  '衛浴 A': 100, '衛浴 B': 100, '陽台': 50,
  'Bruce 房間': 150, '老媽房間': 150,
};
const B5 = new Set(['Bruce 房間', '老媽房間']);

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
  const zones = roomZones(r.lr, objs, CEIL);
  // 子區域改了名、搬出房間或忘了存，面板就安靜地少一列——照 furnish-b6.mjs 點名。
  // 目標也要對：資料庫裡的 lux 被清掉會退回預設 100，拿較寬的標準判過。
  if (name === '客廳＋廚房') for (const [, label, , , , , lux] of AREAS) {
    const z = zones.find(z => z.type === 'area' && z.name === label);
    if (!z || z.need < lux) { fail++; console.log(`  ✗ 子區域「${label}」不見了或目標低於 ${lux}`); }
  }
  for (const z of zones) {
    const st = zoneStat(r.lr, l, z);
    const v = st ? verdict(st.avg, z.need) : null;
    // 書桌不夠是提示加檯燈，不算不過。
    const who = (objs.find(o => o.id === z.target) as any)?.label;
    console.log(`  區域 ${z.name}${who ? `（${who}）` : ''}：平均 ${f0(st?.avg)}、最暗 ${f0(st?.min)}（≥${z.need} ${z.type === 'desk' && v !== 'ok' ? '· 加檯燈' : bad(v !== 'ok')}）`);
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
for (const n of Object.keys(ROOM_NEED)) {
  if (!seen.has(n)) { fail++; console.log(`✗ 方案裡沒有房間「${n}」`); }
}
const loose = findings.filter(f => !f.room);
for (const f of loose) { fail++; console.log(`✗ （不屬於任何房間）[${f.rule}] ${f.title}：${f.detail}`); }
console.log(`\n${fail ? `✗ ${fail} 項不過` : '✓ B6 的六個空間全部達標、沒有健檢提醒'}`);
process.exit(fail ? 1 : 0);
