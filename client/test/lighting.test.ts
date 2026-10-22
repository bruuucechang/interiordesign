import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  luminaire, luminaires, roomLuminaires, sources, lux, grid, lightRoom, innerOutline, inside, isBlocked, beamExponent,
  MAINTENANCE, PLANES, REFLECTANCE,
} from '../src/core/lighting';
import type { Electrical, ElectricalId, Room, T5Size, Wall } from '../src/model/schema';
import type { Box } from '../src/core/clearance';
import { fitElectricalToWall } from '../src/tools/place';

const near = (a: number, b: number, tol: number) =>
  assert.ok(Math.abs(a - b) <= tol, `${a.toFixed(2)} ≉ ${b} ±${tol}`);

let n = 0;
const elec = (item: ElectricalId, x: number, y: number, more: Partial<Electrical> = {}): Electrical =>
  ({ id: `e${n++}`, kind: 'electrical', layer: 'electrical', item, x, y, angle: 0, ...more });

// The prototype faces a T5 by compass point; here it is the symbol's angle
// (its "up" is local -y): N 0°, E 90°, S 180°, W 270°.
const FACE = { N: 0, E: 90, S: 180, W: 270 } as const;
const t5 = (x: number, y: number, face: keyof typeof FACE, circuit: number, size: T5Size = 4) =>
  elec('batten', x, y, { angle: FACE[face], circuit, size });
const down = (x: number, y: number) => elec('downlight', x, y, { circuit: 3 });

// ------------------------------------------------- 原型「你的房間」（DEFAULTS.a）

const W = 365, D = 415, CEIL = 280;
const roomA: Room = { id: 'ra', kind: 'room', layer: 'rooms', x: 0, y: 0, w: W, h: D, name: '你的房間' };
const cabinet = (x: number, y: number, w: number, h: number): Box => ({ cx: x + w / 2, cy: y + h / 2, w, h, angle: 0 });
const cabinetsA = [cabinet(85, 0, 280, 60), cabinet(0, 95, 50, 320)];
const lightsA: Electrical[] = [
  t5(230, 60, 'S', 2), t5(365, 248, 'W', 1), t5(230, 415, 'N', 2), t5(50, 248, 'E', 1),
  down(65, 105), down(175, 105), down(285, 105),
  down(65, 378), down(175, 378), down(285, 378),
];
const A = lightRoom(roomA, CEIL, cabinetsA);
const opts = { height: PLANES.desk, rho: REFLECTANCE.medium, step: 5 };

test('你的房間全開：整間平均 317 ±5%（artifact 的數字）', () => {
  const g = grid(A, luminaires(lightsA, CEIL), opts);
  near(g.avg, 317, 16);
  // 演算法跟原型一樣，所以應該一位不差：把原型的 grid() 直接拿來跑是 316.77。
  // ±5% 藏得住 0.4% 的偏差——cos(90°) = 6e-17 讓貼牆的 T5 照亮自己那面牆線就是這個量級。
  near(g.avg, 316.77, 0.01);
});

test('你的房間只開崁燈：整間平均 130 ±5%', () => {
  const g = grid(A, luminaires(lightsA, CEIL, new Set([3])), opts);
  near(g.avg, 130, 7);
  near(g.avg, 128.95, 0.01);
});

test('櫃子裡的格點不算，櫃子表面的算', () => {
  const g = grid(A, luminaires(lightsA, CEIL), opts);
  const at = (x: number, y: number) => g.v[(y / 5) * g.nx + x / 5];
  assert.ok(Number.isNaN(at(200, 30)), '衣櫃裡面');
  assert.ok(!Number.isNaN(at(200, 60)), '衣櫃門面那一排');
  assert.ok(g.min > 0 && g.max > g.avg && g.uniformity > 0 && g.uniformity < 1);
});

// ------------------------------------------------------------------ 燈具

test('舊存檔的燈沒有新欄位：照目錄預設、在迴路 1', () => {
  const L = luminaire(elec('downlight', 0, 0, { elevation: 270 }), 280)!;
  assert.equal(L.lumens, 720);
  assert.equal(L.circuit, 1);
  assert.equal(L.z, 280, '崁燈在天花板，不管存的 elevation');
  near(L.exponent!, 1, 1e-9);
});

test('個別改的流明與光束角蓋過預設', () => {
  const L = luminaire(elec('spotlight', 0, 0, { lumens: 900, beam: 60 }), 280)!;
  assert.equal(L.lumens, 900);
  near(L.exponent!, beamExponent(60), 1e-9);
});

test('插座、開關、排風扇不發光', () => {
  for (const id of ['socket', 'switch1', 'exhaust'] as const) assert.equal(luminaire(elec(id, 0, 0), 280), null);
});

test('T5 尺寸決定長度與流明；沒寫尺寸是 4 尺、在天花板下 15 cm', () => {
  const two = luminaire(elec('batten', 0, 0, { size: 2 }), 280)!;
  assert.equal(two.lumens, 1000);
  assert.equal(two.tube!.length, 61.2);
  const dflt = luminaire(elec('batten', 0, 0), 280)!;
  assert.equal(dflt.tube!.length, 119.4);
  assert.equal(dflt.z, 265);
});

test('T5 朝它的「上方」照：angle 180 照南、牆後面是黑的', () => {
  const L = luminaire(t5(200, 100, 'S', 1), 280)!;
  near(L.tube!.face[0], 0, 1e-9); near(L.tube!.face[1], 1, 1e-9);
  const src = sources([L]);
  assert.ok(lux(src, 200, 200, 75, 0) > 0, '照到的那一側');
  assert.equal(lux(src, 200, 20, 75, 0), 0, '背面');
});

test('用放置工具貼牆的 T5 照向游標那側（房間），牆後是黑的——牆不管往哪個方向畫', () => {
  for (const wall of [{ a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }, { a: { x: 400, y: 0 }, b: { x: 0, y: 0 } }]) {
    for (const side of [1, -1]) {
      const fit = fitElectricalToWall({ x: 200, y: 30 * side }, [wall])!;
      const src = sources([luminaire(elec('batten', fit.pos.x, fit.pos.y, { angle: fit.angle }), 280)!]);
      assert.ok(lux(src, 200, 150 * side, 75, 0) > 10, `游標那側 (${side})`);
      assert.equal(lux(src, 200, -150 * side, 75, 0), 0, `牆後 (${side})`);
    }
  }
});

test('T5 不會高過天花板：存的高度是照別的天花板寫的也一樣', () => {
  assert.equal(luminaire(elec('batten', 0, 0, { elevation: 265 }), 240)!.z, 225);
  assert.equal(luminaire(elec('batten', 0, 0, { elevation: 200 }), 280)!.z, 200, '刻意裝低的照舊');
});

test('每間房只算自己的燈：共用牆上的 T5 歸它照的那一間', () => {
  const left = lightRoom({ id: 'l', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 300, h: 300, name: 'l' }, 280);
  const right = lightRoom({ id: 'r', kind: 'room', layer: 'rooms', x: 300, y: 0, w: 300, h: 300, name: 'r' }, 280);
  const lums = luminaires([
    elec('downlight', 150, 150), elec('ceilingLight', 450, 150),
    elec('batten', 300, 150, { angle: FACE.W }),   // 共用牆上、照西＝照左邊那間
  ], 280);
  assert.deepEqual(roomLuminaires(left, lums).map(L => L.x), [150, 300]);
  assert.deepEqual(roomLuminaires(right, lums).map(L => L.x), [450]);
});

test('吊燈掛在自己的高度', () => {
  assert.equal(luminaire(elec('pendant', 0, 0, { elevation: 210 }), 280)!.z, 210);
});

// ------------------------------------------------------------------ 光學

test('窄光束的 cosⁿ 光源：落在大地板上的總光通量 ≈ 流明 × 維護係數', () => {
  const src = sources([luminaire(elec('spotlight', 0, 0), 280)!]);   // 600 lm、36°
  let flux = 0;
  const step = 5;
  for (let y = -500; y <= 500; y += step) for (let x = -500; x <= 500; x += step)
    flux += lux(src, x, y, 0, 0) * (step / 100) ** 2;
  near(flux, 600 * MAINTENANCE, 600 * MAINTENANCE * 0.02);
});

test('寬光束是朗伯：正下方照度 = Φ/π × cos²/d² × 維護係數', () => {
  const src = sources([luminaire(elec('downlight', 0, 0), 280)!]);
  near(lux(src, 0, 0, 80, 0), 720 / Math.PI / 4 * MAINTENANCE, 1e-9);   // 2 m 正下方
});

test('多邊形房間：L 形缺角那塊不取樣', () => {
  const poly = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
  const room: Room = { id: 'l', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 200, h: 200, name: 'L', poly };
  const r = lightRoom(room, 280);
  assert.ok(inside(poly, 50, 150) && inside(poly, 150, 50) && inside(poly, 100, 150), '牆線上也算');
  assert.ok(!inside(poly, 150, 150));
  const g = grid(r, luminaires([elec('ceilingLight', 100, 100)], 280), { ...opts, step: 10 });
  assert.ok(Number.isNaN(g.v[15 * g.nx + 15]));
  assert.ok(!Number.isNaN(g.v[5 * g.nx + 5]));
});

test('轉過的櫃子照它自己的方向擋', () => {
  const r = lightRoom({ id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 400, name: 'r' }, 280,
    [{ cx: 200, cy: 200, w: 200, h: 20, angle: 90 }]);
  assert.ok(isBlocked(r, 200, 280), '轉 90° 之後沿 y 方向長');
  assert.ok(!isBlocked(r, 280, 200));
});

// 房間外框沿牆中心線，原型量的是室內淨尺寸：照度要算的是後者（B5）。
const wall = (ax: number, ay: number, bx: number, by: number, thickness: number): Wall =>
  ({ id: `w${n++}`, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });
const pts = (p: { x: number; y: number }[]) => p.map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]);

test('外框內縮到牆面：四面牆各縮半個牆厚', () => {
  const poly = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const walls = [wall(0, 0, 400, 0, 15), wall(400, 0, 400, 300, 15), wall(400, 300, 0, 300, 24), wall(0, 300, 0, 0, 10)];
  assert.deepEqual(pts(innerOutline(poly, walls)), [[5, 7.5], [392.5, 7.5], [392.5, 288], [5, 288]]);
  // 反方向繞也一樣往裡縮
  assert.deepEqual(pts(innerOutline([...poly].reverse(), walls)), [[5, 288], [392.5, 288], [392.5, 7.5], [5, 7.5]]);
});

test('外框內縮：沒有牆的那一邊（兩間打通）不動，同一直線換厚度的地方是一個台階', () => {
  const poly = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const walls = [wall(0, 0, 200, 0, 10), wall(200, 0, 400, 0, 20), wall(400, 0, 400, 300, 15)];
  assert.deepEqual(pts(innerOutline(poly, walls)), [[0, 5], [200, 5], [200, 10], [392.5, 10], [392.5, 300], [0, 300]]);
});

test('外框內縮：柱子留下的尖刺先拿掉，曲線牆的弦不動', () => {
  // 偵測器在柱子那裡會留一段「出去又折回來」的邊
  const poly = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 250, y: 200 }, { x: 250, y: 190 }, { x: 250, y: 200 }, { x: 0, y: 200 }];
  const walls = [wall(0, 0, 300, 0, 10), wall(300, 0, 300, 200, 10), wall(300, 200, 0, 200, 10), wall(0, 200, 0, 0, 10)];
  assert.deepEqual(pts(innerOutline(poly, walls)), [[5, 5], [295, 5], [295, 195], [250, 195], [5, 195]]);
  const arc = { ...wall(0, 0, 300, 0, 10), bulge: -8 };
  assert.deepEqual(pts(innerOutline(poly.slice(0, 3).concat([{ x: 0, y: 200 }]), [arc])), [[0, 0], [300, 0], [300, 200], [0, 200]]);
});

test('lightRoom 給了牆就用牆面，沒給就照舊', () => {
  const room: Room = { id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: 'r' };
  const walls = [wall(0, 0, 400, 0, 20)];
  assert.equal(lightRoom(room, 280).poly[0].y, 0);
  assert.equal(lightRoom(room, 280, [], walls).poly[0].y, 10);
});
