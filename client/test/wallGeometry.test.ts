import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallPieces, openingsOnWall, openingSpan, curvedWallBands } from '../src/core/wallGeometry';
import type { Wall, Opening } from '../src/core/wallGeometry';
import { quadPoints, wallControl } from '../src/core/geometry';

// A wall along the X axis, 500 cm long, 12 cm thick.
const wall = (over: Partial<Wall> = {}): Wall => ({
  id: 'w', kind: 'wall', layer: 'walls',
  a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, thickness: 12, ...over,
});

const door = (x: number, over: Partial<Opening> = {}): Opening => ({
  id: 'd' + x, kind: 'door', layer: 'openings',
  x, y: 0, width: 90, angle: 0, ...over,
});

const window_ = (x: number, over: Partial<Opening> = {}): Opening => ({
  id: 'n' + x, kind: 'window', layer: 'openings',
  x, y: 0, width: 120, angle: 0, ...over,
});

const H = 270;
const solidLength = (ps: { s0: number; s1: number; yLo: number; yHi: number }[]) =>
  ps.filter(p => p.yLo === 0 && p.yHi === H).reduce((n, p) => n + (p.s1 - p.s0), 0);

// ---------------------------------------------------------------- 預設高度

test('門從地板起算，窗有窗台', () => {
  assert.deepEqual(openingSpan(door(250)), { elev: 0, height: 210 });
  assert.deepEqual(openingSpan(window_(250)), { elev: 90, height: 100 });
});

test('物件自己寫了就用它的', () => {
  assert.deepEqual(openingSpan(door(250, { elevation: 5, height: 240 })), { elev: 5, height: 240 });
  assert.deepEqual(openingSpan(window_(250, { elevation: 60 })), { elev: 60, height: 100 });
});

// ---------------------------------------------------------------- 哪些開口算這道牆的

test('落在別的地方的開口不會被打進這道牆', () => {
  // 一份平面圖上每道牆都有門窗；不篩的話每一個都會穿透所有的牆。
  assert.equal(openingsOnWall(wall(), [door(250, { y: 400 })]).length, 0);
});

test('貼在牆面上的開口算數——編輯器是吸附到面不是中心線', () => {
  assert.equal(openingsOnWall(wall(), [door(250, { y: 6 })]).length, 1);
  assert.equal(openingsOnWall(wall(), [door(250, { y: 40 })]).length, 0);
});

test('超出兩端的開口不算', () => {
  assert.equal(openingsOnWall(wall(), [door(-80)]).length, 0);
  assert.equal(openingsOnWall(wall(), [door(600)]).length, 0);
});

test('回傳的跨距沿著牆長，而且依序排好', () => {
  const on = openingsOnWall(wall(), [door(400), door(100)]);
  assert.deepEqual(on.map(h => [h.s, h.e]), [[55, 145], [355, 445]]);
});

test('伸出牆頭的開口會被夾在牆的範圍內', () => {
  const on = openingsOnWall(wall(), [door(20)]);       // 中心 20、寬 90 → 會超出起點
  assert.equal(on[0].s, 0, '不能是負的');
  assert.equal(on[0].e, 65);
});

// ---------------------------------------------------------------- 實心分段

test('沒有開口就是一整塊', () => {
  assert.deepEqual(wallPieces(wall(), [], H), [{ s0: 0, s1: 500, yLo: 0, yHi: H }]);
});

test('一扇門把牆切成前段、楣樑、後段——門下面沒有窗台', () => {
  const ps = wallPieces(wall(), [door(250)], H);
  assert.deepEqual(ps, [
    { s0: 0, s1: 205, yLo: 0, yHi: H },       // 門前
    { s0: 205, s1: 295, yLo: 210, yHi: H },   // 門楣
    { s0: 295, s1: 500, yLo: 0, yHi: H },     // 門後
  ]);
});

test('窗戶多一塊窗台', () => {
  const ps = wallPieces(wall(), [window_(250)], H);
  assert.deepEqual(ps, [
    { s0: 0, s1: 190, yLo: 0, yHi: H },
    { s0: 190, s1: 310, yLo: 0, yHi: 90 },    // 窗台
    { s0: 190, s1: 310, yLo: 190, yHi: H },   // 窗楣
    { s0: 310, s1: 500, yLo: 0, yHi: H },
  ]);
});

test('實心長度加上開口寬度等於牆長', () => {
  const ps = wallPieces(wall(), [door(150), window_(380)], H);
  assert.equal(solidLength(ps) + 90 + 120, 500);
});

test('緊貼牆頭的門不會留下一塊零長度的前段', () => {
  const ps = wallPieces(wall(), [door(45)], H);
  assert.ok(ps.every(p => p.s1 - p.s0 > 0.5), JSON.stringify(ps));
  assert.equal(ps[0].s0, 0);
  assert.equal(ps[0].yLo, 210, '第一塊應該是門楣，不是門前的牆');
});

test('兩個重疊的開口合成一個洞，不會產生負長度的塊', () => {
  // 平面圖存得下這種東西，編輯器也不擋。
  const ps = wallPieces(wall(), [door(250), door(280)], H);
  assert.ok(ps.every(p => p.s1 > p.s0), JSON.stringify(ps));
  assert.ok(solidLength(ps) < 500);
});

test('門高到頂就不會有門楣', () => {
  const ps = wallPieces(wall(), [door(250, { height: H })], H);
  assert.equal(ps.filter(p => p.yLo > 0).length, 0);
  assert.deepEqual(ps.map(p => [p.s0, p.s1]), [[0, 205], [295, 500]]);
});

test('太短的牆不生成任何東西', () => {
  assert.deepEqual(wallPieces(wall({ b: { x: 0.5, y: 0 } }), [], H), []);
});

// ---------------------------------------------------------------- 曲線牆

test('沒有開口的曲線牆是一條連續的帶，不會被取樣點切碎', () => {
  const w = wall({ bulge: 60 });
  const pts = quadPoints(w.a, wallControl(w.a, w.b, 60), w.b, 48);
  const bands = curvedWallBands(pts, w, [], H);
  assert.equal(bands.length, 1);
  assert.deepEqual([bands[0].from, bands[0].to], [0, pts.length - 1]);
});

test('曲線牆上的開口在該處切出上下兩帶', () => {
  const w = wall({ bulge: 60 });
  const pts = quadPoints(w.a, wallControl(w.a, w.b, 60), w.b, 48);
  const mid = pts[Math.floor(pts.length / 2)];
  const bands = curvedWallBands(pts, w, [window_(mid.x, { y: mid.y })], H);
  const split = bands.filter(b => b.yHi === 90 || b.yLo === 190);
  assert.equal(split.length, 2, '窗台與窗楣各一帶');
  assert.ok(bands.length > split.length, '開口兩側仍要有整高的帶');
});

test('曲線牆也吃同一組預設高度', () => {
  // 這兩個分支曾經各自寫死一份 210/100 與 0/90。
  const w = wall({ bulge: 60 });
  const pts = quadPoints(w.a, wallControl(w.a, w.b, 60), w.b, 48);
  const mid = pts[Math.floor(pts.length / 2)];
  const bands = curvedWallBands(pts, w, [door(mid.x, { y: mid.y })], H);
  assert.ok(bands.some(b => b.yLo === 210), '門楣要從 210 起算');
  assert.ok(!bands.some(b => b.yHi === 0), '門不該有窗台');
});
