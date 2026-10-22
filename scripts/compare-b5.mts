// B5 驗收：plan1151022 兩間臥室，App 算的整間平均與各區域平均 vs 原型算的。
//
//   cd client && npx tsx ../scripts/compare-b5.mts          # 要 :8791 在跑
//
// 原型那一邊不是抄的：直接從 docs/lighting-prototype.html 切出它的
// 光學（sources／indirect／lux／grid／zoneStat）與區域（zones）那兩段原始碼來跑，
// 餵的是 scripts/furnish-b5.mjs 的 LAYOUT（原型格式、PDF 尺寸、天花板 300）。
// App 那一邊從 API 讀方案，走面板用的同一條路（lightFloor → roomZones → zoneStat）。
//
// 兩邊的差別只該來自：App 的房間外框沿牆中心線（多一圈半牆厚、Bruce 房多一個門的凹口），
// 原型是室內淨尺寸的長方形。超過 ±5% 就是 B3 說的「再回來做內縮」。
//
// 另外印一欄「原型原值」：原型 DEFAULTS（原本那兩間、天花板 280）的數字，給人看
// 換成 PDF 尺寸與 300 天花板之後變了多少；那一欄不是驗收對象。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LAYOUT, CEIL } from './furnish-b5.mjs';
import { lightFloor } from '../client/src/core/lightmap';
import { roomZones, litBy, zoneStat } from '../client/src/core/lightzones';
import { lightingFindings } from '../client/src/core/lightcheck';
import { REFLECTANCE } from '../client/src/core/lighting';
import type { Obj } from '../client/src/model/schema';

const HTML = fileURLToPath(new URL('../docs/lighting-prototype.html', import.meta.url));
const API = 'http://127.0.0.1:8791/api';
const RHO = REFLECTANCE.medium, PLANE = 75, STEP = 5;

// ---- 原型 ------------------------------------------------------------------
function prototypeEngine() {
  const src = readFileSync(HTML, 'utf8');
  const cut = (a: string, b: string) => {
    const i = src.indexOf(a), j = src.indexOf(b, i);
    if (i < 0 || j < 0) throw new Error(`原型裡找不到 ${a} … ${b}`);
    return src.slice(i, j);
  };
  const body = cut('const MF', 'const clone') + cut('// ---------- 光學', '// ---------- 繪圖');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return { grid, zones, zoneStat, sources, indirect, DEFAULTS };`)();
}
const P = prototypeEngine();
const ALL_ON = { 1: 1, 2: 1, 3: 1 };

function protoNumbers(r: any) {
  const g = P.grid(r, ALL_ON, PLANE, RHO, STEP);
  const src = P.sources(r, ALL_ON), ind = P.indirect(r, ALL_ON, RHO);
  const zones = P.zones(r).map((z: any) => ({ type: z.type, name: z.name, avg: P.zoneStat(r, src, ind, z, z.hgt)?.avg ?? null }));
  return { avg: g.avg, min: g.mn, zones };
}

// ---- App -------------------------------------------------------------------
const res = await fetch(`${API}/projects/plan1151022`, { headers: { 'X-Owner': 'own_orsxp52fbvey' } });
if (!res.ok) throw new Error(`GET plan1151022 → ${res.status}`);
const plan = (await res.json()).data;
const floor = plan.floors.find((f: any) => f.id === plan.activeFloorId) ?? plan.floors[0];
const objs: Obj[] = floor.objects;
const lit = lightFloor(objs, CEIL, { height: PLANE, rho: RHO, on: null, step: STEP });

const TYPE: Record<string, string> = { bed: 'bed', desk: 'desk', cab: 'cabinet', door: 'door' };
const pct = (a: number, b: number) => (a / b - 1) * 100;
let worst = 0;
const rows: string[] = [];

for (const [key, room] of Object.entries(LAYOUT) as [keyof typeof LAYOUT, any][]) {
  const lr = lit.find(l => l.room.name === room.name);
  if (!lr) throw new Error(`方案裡沒有房間「${room.name}」`);
  const app = { avg: lr.grid.avg, zones: roomZones(lr.lr, objs, CEIL) };
  const l = litBy(lr.lr, lr.lums, RHO);
  const proto = protoNumbers(room);
  const orig = protoNumbers(P.DEFAULTS[key === 'bruce' ? 'a' : 'b']);

  const line = (name: string, a: number | null, p: number | null, o: number | null) => {
    const d = a != null && p != null ? pct(a, p) : NaN;
    if (Number.isFinite(d)) worst = Math.max(worst, Math.abs(d));
    rows.push(`| ${room.name} | ${name} | ${a?.toFixed(1) ?? '–'} | ${p?.toFixed(1) ?? '–'} | ${Number.isFinite(d) ? (d >= 0 ? '+' : '') + d.toFixed(1) + '%' : '–'} | ${o?.toFixed(1) ?? '–'} |`);
  };
  line('整間平均（桌面 75）', app.avg, proto.avg, orig.avg);
  // 區域按種類配對，同種類照順序（原型與 App 的順序都是 床、書桌、櫃子、門）。
  const used = new Set<number>();
  for (const pz of proto.zones) {
    const i = app.zones.findIndex((z, k) => !used.has(k) && z.type === TYPE[pz.type]);
    if (i < 0) { line(`${pz.name}（App 沒有）`, null, pz.avg, null); continue; }
    used.add(i);
    const oz = orig.zones.find((z: any) => z.name === pz.name || (z.type === pz.type && pz.type !== 'door'));
    line(`${app.zones[i].name}`, zoneStat(lr.lr, l, app.zones[i])?.avg ?? null, pz.avg, oz?.avg ?? null);
  }
  app.zones.forEach((z, k) => { if (!used.has(k)) line(`${z.name}（原型沒有）`, zoneStat(lr.lr, l, z)?.avg ?? null, null, null); });
}

console.log('| 房間 | 項目 | App | 原型（同配置） | 差 | 原型原值（DEFAULTS，280） |');
console.log('|---|---|---:|---:|---:|---:|');
console.log(rows.join('\n'));
console.log(`\n最大偏差 ${worst.toFixed(1)}%（驗收 ±5%）`);

// 兩間的照明健檢：指到 b5_* 物件、或指名是這兩間的。
const roomIds = new Set(lit.filter(l => Object.values(LAYOUT).some((r: any) => r.name === l.room.name)).map(l => l.room.id));
const fs = lightingFindings(objs, CEIL).filter(f => f.targets.some(t => t.startsWith('b5_') || roomIds.has(t)) || (f.room && roomIds.has(f.room)));
console.log(`\n照明健檢（兩間）：${fs.length} 條`);
for (const f of fs) console.log(`  [${f.rule}] ${f.title}：${f.detail}`);
process.exit(worst <= 5 ? 0 : 1);
