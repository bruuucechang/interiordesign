import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetObject, cloneWithOffset, alignMoves, distributeMoves } from '../src/core/arrange';
import type { Obj } from '../src/model/schema';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Obj =>
  ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12 });

const box = (id: string, x: number, y: number, w = 100, h = 60): Obj =>
  ({ id, kind: 'furniture', layer: 'furniture', item: 'sofa', label: '沙發', x, y, w, h, angle: 0 });

const room = (id: string, x: number, y: number, poly?: { x: number; y: number }[]): Obj =>
  ({ id, kind: 'room', layer: 'rooms', x, y, w: 200, h: 150, name: '房間',
     ...(poly ? { poly, auto: true } : {}) } as Obj);

let n = 0;
const ids = (kind: string) => `${kind}_${++n}`;

// ---------------------------------------------------------------- 位移

test('端點式物件（牆）兩端一起移動', () => {
  const w = offsetObject(wall('w', 0, 0, 100, 0), 10, 20) as any;
  assert.deepEqual(w.a, { x: 10, y: 20 });
  assert.deepEqual(w.b, { x: 110, y: 20 });
});

test('座標式物件（家具）移動', () => {
  const f = offsetObject(box('f', 50, 50), -10, 5) as any;
  assert.equal(f.x, 40);
  assert.equal(f.y, 55);
});

test('多邊形房間的輪廓與外框一起走', () => {
  // 只移外框的話，房間的線留在原地、標籤自己走掉。
  const r = offsetObject(room('r', 0, 0, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]), 5, 5) as any;
  assert.equal(r.x, 5);
  assert.deepEqual(r.poly, [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }]);
});

test('搬動自動偵測出來的房間會讓它脫離牆體', () => {
  const r = offsetObject(room('r', 0, 0, [{ x: 0, y: 0 }]), 1, 1) as any;
  assert.equal(r.auto, false);
});

test('沒有 poly 的房間不會被硬加一個', () => {
  const r = offsetObject(room('r', 0, 0), 5, 5) as any;
  assert.equal(r.poly, undefined);
  assert.equal(r.auto, undefined, '沒有 poly 就不該動 auto');
});

test('不會改到傳進來的物件', () => {
  const original = wall('w', 0, 0, 100, 0);
  offsetObject(original, 999, 999);
  assert.deepEqual((original as any).a, { x: 0, y: 0 });
});

// ---------------------------------------------------------------- 複製

test('複製出來的每個物件都有新的 id', () => {
  const src = [box('a', 0, 0), box('b', 0, 0)];
  const out = cloneWithOffset(src, 10, 10, ids);
  assert.equal(new Set(out.map(o => o.id)).size, 2);
  assert.ok(out.every(o => o.id !== 'a' && o.id !== 'b'));
});

test('複製會位移', () => {
  const [c] = cloneWithOffset([box('a', 0, 0)], 20, 30, ids) as any[];
  assert.deepEqual([c.x, c.y], [20, 30]);
});

test('同一群的物件複製後仍是同一群，但換成新的群組 id', () => {
  // 沿用舊 id 的話，移動複本會把原件一起拖走。
  const src = [{ ...box('a', 0, 0), group: 'g1' }, { ...box('b', 0, 0), group: 'g1' }] as Obj[];
  const out = cloneWithOffset(src, 10, 10, ids) as any[];
  assert.equal(out[0].group, out[1].group);
  assert.notEqual(out[0].group, 'g1');
});

test('兩個不同的群不會被複製成同一群', () => {
  const src = [{ ...box('a', 0, 0), group: 'g1' }, { ...box('b', 0, 0), group: 'g2' }] as Obj[];
  const out = cloneWithOffset(src, 0, 0, ids) as any[];
  assert.notEqual(out[0].group, out[1].group);
});

test('沒有群組的物件複製後仍然沒有', () => {
  const [c] = cloneWithOffset([box('a', 0, 0)], 0, 0, ids) as any[];
  assert.equal(c.group, undefined);
});

// ---------------------------------------------------------------- 對齊

const three = () => [box('a', 0, 0, 100, 40), box('b', 50, 100, 60, 40), box('c', 200, 300, 80, 40)];

test('少於兩個物件不對齊', () => {
  assert.deepEqual(alignMoves([box('a', 0, 0)], 'left'), []);
  assert.deepEqual(alignMoves([], 'left'), []);
});

test('靠左：全部貼到最左邊那個', () => {
  const moves = alignMoves(three(), 'left');
  const xs = moves.map(m => (m.obj as any).x);
  assert.ok(xs.every(x => x === 0), JSON.stringify(xs));
  assert.equal(moves.length, 2, '本來就在最左的那個不必動');
});

test('靠右：對齊的是右緣不是左緣', () => {
  // 三個寬度不同，所以只有右緣會一致。
  const moves = alignMoves(three(), 'right');
  const rights = moves.map(m => (m.obj as any).x + (m.obj as any).w);
  assert.ok(rights.every(r => r === 280), JSON.stringify(rights));
});

test('水平置中：中心線一致', () => {
  const moves = alignMoves(three(), 'hcenter');
  const cs = moves.map(m => (m.obj as any).x + (m.obj as any).w / 2);
  assert.ok(cs.every(c => Math.abs(c - 140) < 1e-9), JSON.stringify(cs));
});

test('靠上 / 靠下 / 垂直置中走的是另一個軸', () => {
  for (const [edge, pick, want] of [
    ['top', (o: any) => o.y, 0],
    ['bottom', (o: any) => o.y + o.h, 340],
    ['vcenter', (o: any) => o.y + o.h / 2, 170],
  ] as const) {
    const vs = alignMoves(three(), edge).map(m => pick(m.obj as any));
    assert.ok(vs.every(v => Math.abs(v - want) < 1e-9), edge + ': ' + JSON.stringify(vs));
  }
});

test('對齊不會動到另一個軸', () => {
  const moves = alignMoves(three(), 'left');
  for (const m of moves) {
    const before = three().find(o => o.id === m.id) as any;
    assert.equal((m.obj as any).y, before.y);
  }
});

test('已經對齊的選取不會產生任何一步', () => {
  const same = [box('a', 10, 0), box('b', 10, 100), box('c', 10, 200)];
  assert.deepEqual(alignMoves(same, 'left'), []);
});

test('牆也能對齊——它沒有 x，靠兩端的包圍盒', () => {
  const moves = alignMoves([wall('w', 100, 0, 200, 0), box('f', 0, 50)], 'left');
  const w = moves.find(m => m.id === 'w')!.obj as any;
  assert.deepEqual([w.a.x, w.b.x], [0, 100]);
});

// ---------------------------------------------------------------- 均分

test('少於三個物件不均分', () => {
  assert.deepEqual(distributeMoves([box('a', 0, 0), box('b', 100, 0)], 'h'), []);
});

test('水平均分：中心等距，兩端不動', () => {
  // 中心分別是 50、210、450 —— 刻意讓寬度不同，順序仍然明確。
  const objs = [box('a', 0, 0, 100, 40), box('b', 200, 0, 20, 40), box('c', 400, 0, 100, 40)];
  const moves = distributeMoves(objs, 'h');
  assert.equal(moves.length, 1, '只有中間那個要動');
  assert.equal(moves[0].id, 'b');
  assert.equal((moves[0].obj as any).x + 10, 250, '中心要落在 50 與 450 的正中間');
});

test('均分是按中心不是按間隙——寬度不同才看得出差別', () => {
  const objs = [box('a', 0, 0, 10, 40), box('b', 100, 0, 200, 40), box('c', 500, 0, 10, 40)];
  const m = distributeMoves(objs, 'h')[0].obj as any;
  assert.equal(m.x + m.w / 2, 255);       // (5 + 505) / 2
});

test('垂直均分走 y', () => {
  const objs = [box('a', 0, 0, 100, 40), box('b', 0, 10, 100, 40), box('c', 0, 400, 100, 40)];
  const m = distributeMoves(objs, 'v')[0].obj as any;
  assert.equal(m.y + m.h / 2, 220);
  assert.equal(m.x, 0, 'x 不該動');
});

test('順序亂給也一樣——是按位置排不是按選取順序', () => {
  const objs = [box('c', 400, 0, 100, 40), box('a', 0, 0, 100, 40), box('b', 200, 0, 20, 40)];
  const moves = distributeMoves(objs, 'h');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'b');
});

test('排序看的是中心，不是左緣', () => {
  // 一個窄物件擺在比較右的 x，中心卻更左——這正是我第一次把 fixture 寫錯的地方。
  const objs = [box('wide', 0, 0, 100, 40), box('narrow', 10, 0, 20, 40), box('far', 400, 0, 100, 40)];
  const moves = distributeMoves(objs, 'h');
  assert.equal(moves[0].id, 'wide', 'narrow 的中心是 20，比 wide 的 50 更左，所以它是端點');
});
