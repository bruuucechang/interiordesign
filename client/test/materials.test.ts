import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rng, hash, heightToNormal, material, repeatFor, MATERIALS, floorMaterials, wallMaterials,
  herringbonePlanks, plankCells,
} from '../src/core/materials';

// ---------------------------------------------------------------- 亂數

test('同一個種子給出同一串數字', () => {
  // 舊版用 Math.random()，每次重新整理木紋都不一樣，也沒辦法斷言任何事。
  const a = rng(123), b = rng(123);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
});

test('不同種子不會給出同一串', () => {
  const a = rng(1), b = rng(2);
  assert.notEqual(a(), b());
});

test('永遠落在 [0,1)', () => {
  const r = rng(999);
  for (let i = 0; i < 5000; i++) { const v = r(); assert.ok(v >= 0 && v < 1, String(v)); }
});

test('分布大致均勻——不然木紋會全擠在一邊', () => {
  const r = rng(7); const buckets = new Array(10).fill(0);
  for (let i = 0; i < 100000; i++) buckets[Math.floor(r() * 10)]++;
  for (const b of buckets) assert.ok(b > 8000 && b < 12000, JSON.stringify(buckets));
});

test('字串雜湊穩定且會分開', () => {
  assert.equal(hash('wood'), hash('wood'));
  assert.notEqual(hash('wood'), hash('walnut'));
});

// ---------------------------------------------------------------- 高度轉法線

const size = 8;
const flat = (v = 128) => {
  const a = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) { a[i * 4] = v; a[i * 4 + 3] = 255; }
  return a;
};
const px = (a: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * size + x) * 4;
  return { x: a[i] / 255 * 2 - 1, y: a[i + 1] / 255 * 2 - 1, z: a[i + 2] / 255 * 2 - 1 };
};

test('平的高度場給出朝上的法線', () => {
  const n = heightToNormal(flat(), size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = px(n, x, y);
    assert.ok(Math.abs(v.x) < 0.01 && Math.abs(v.y) < 0.01, `(${x},${y}) ${JSON.stringify(v)}`);
    assert.ok(v.z > 0.99, 'z 要接近 1');
  }
});

test('法線是單位長度', () => {
  const h = flat();
  h[(3 * size + 3) * 4] = 255;
  const n = heightToNormal(h, size, 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = px(n, x, y);
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 0.02, `(${x},${y}) 長度 ${Math.hypot(v.x, v.y, v.z)}`);
  }
});

test('z 永遠是正的——負的等於表面朝內，整片會變黑', () => {
  const h = flat();
  for (let i = 0; i < size * size; i++) h[i * 4] = (i * 37) % 256;
  const n = heightToNormal(h, size, 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) assert.ok(px(n, x, y).z > 0);
});

test('往右變高，法線就往 −x 傾——凸起是凸起不是凹陷', () => {
  // 這個正負號弄反，產出的法線圖一樣完全合理，只是每個凸起都變成凹陷，
  // 看起來像「打光有點怪」而不是像 bug。
  const h = flat(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[(y * size + x) * 4] = (x / (size - 1)) * 255;
  const n = heightToNormal(h, size, 2);
  assert.ok(px(n, 3, 3).x < -0.1, `往上的斜坡 nx 應該是負的，得到 ${px(n, 3, 3).x}`);
});

test('往下變高，法線就往另一邊傾', () => {
  const h = flat(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[(y * size + x) * 4] = (x / (size - 1)) * 255;
  const up = heightToNormal(h, size, 2);
  const flipped = flat(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) flipped[(y * size + x) * 4] = (1 - x / (size - 1)) * 255;
  const down = heightToNormal(flipped, size, 2);
  assert.ok(up[(3 * size + 3) * 4] < 128 && down[(3 * size + 3) * 4] > 128, '兩個方向要落在 128 的兩側');
});

test('x 與 y 是分開的兩軸，不會互相汙染', () => {
  const h = flat(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[(y * size + x) * 4] = (y / (size - 1)) * 255;
  const n = heightToNormal(h, size, 2);
  const v = px(n, 3, 3);
  assert.ok(Math.abs(v.x) < 0.02, `純 y 方向的斜坡不該有 nx，得到 ${v.x}`);
  assert.ok(Math.abs(v.y) > 0.1, '應該要有 ny');
});

test('取樣是繞回去的——貼圖會平鋪，邊緣不能有接縫', () => {
  // 邊緣夾住的話，最後一欄的斜率是跟自己算的，法線在那一欄突然變平。
  // 在貼圖上看不出來，鋪到地板上就是一條清楚的線。
  const h = flat(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[(y * size + x) * 4] = x % 2 ? 255 : 0;
  const n = heightToNormal(h, size, 2);
  // 同樣是「左右各差一格」的位置，中間與邊緣要得到同一個法線。
  assert.deepEqual(px(n, 0, 3), px(n, 2, 3));
  assert.deepEqual(px(n, size - 1, 3), px(n, 1, 3));
});

test('強度只放大傾斜，不改方向', () => {
  const h = flat(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[(y * size + x) * 4] = (x / (size - 1)) * 255;
  const weak = px(heightToNormal(h, size, 0.5), 3, 3);
  const strong = px(heightToNormal(h, size, 4), 3, 3);
  assert.ok(strong.x < weak.x, '越強越傾斜');
  assert.ok(Math.sign(strong.x) === Math.sign(weak.x), '方向不能變');
});

test('alpha 補滿——留 0 的話貼圖會是透明的', () => {
  const n = heightToNormal(flat(), size);
  for (let i = 0; i < size * size; i++) assert.equal(n[i * 4 + 3], 255);
});

// ---------------------------------------------------------------- 材質庫

test('每個材質的 id 都唯一', () => {
  assert.equal(new Set(MATERIALS.map(m => m.id)).size, MATERIALS.length);
});

test('地板與牆面各有數種，而且分得開', () => {
  assert.ok(floorMaterials().length >= 6);
  assert.ok(wallMaterials().length >= 4);
  assert.ok(floorMaterials().every(m => m.category === 'floor'));
  assert.ok(wallMaterials().every(m => m.category === 'wall'));
});

test('每個材質都有標籤、色票與合理的參數', () => {
  for (const m of MATERIALS) {
    assert.ok(m.label.length > 0, m.id);
    assert.match(m.swatch, /^#[0-9a-f]{6}$/i, m.id);
    assert.ok(m.tileCm > 0, m.id);
    assert.ok(m.roughness >= 0 && m.roughness <= 1, m.id);
    assert.ok(m.metalness >= 0 && m.metalness <= 1, m.id);
  }
});

test('查不到的 id 退回同類別的第一個，不會回 undefined', () => {
  assert.equal(material('沒這個', 'floor').category, 'floor');
  assert.equal(material(undefined, 'wall').category, 'wall');
});

test('拿牆面材質去查地板，不會把牆面材質給出去', () => {
  // 不擋的話，地板會鋪上文化石而且完全不報錯。
  assert.equal(material('brick', 'floor').category, 'floor');
  assert.equal(material('brick', 'wall').id, 'brick');
});

test('平鋪次數不會低於 1', () => {
  // 0 會讓貼圖被拉伸滿整個面：六米的地板變成四塊巨大的板子，
  // 看起來仍然像地板，只是尺度整個錯了。
  const m = material('tile', 'floor');
  assert.deepEqual(repeatFor(m, 10, 10), [1, 1]);
  assert.deepEqual(repeatFor(m, 0, 0), [1, 1]);
});

test('平鋪次數跟著面積走', () => {
  const m = material('tile', 'floor');   // tileCm 240
  assert.deepEqual(repeatFor(m, 480, 720), [2, 3]);
});

// ---------------------------------------------------------------- 人字拼

test('每一格恰好被一塊木條蓋住一次', () => {
  // 第一版是每格各自繞自己的角旋轉，畫出來是一堆互相重疊又留縫的木棍——
  // 認得出是「木地板」，只是沒有人這樣鋪。
  for (const cells of [4, 8, 12]) {
    const cover = new Map<string, number>();
    for (const p of herringbonePlanks(cells)) {
      for (const [i, j] of plankCells(p, cells)) {
        const k = `${i},${j}`;
        cover.set(k, (cover.get(k) ?? 0) + 1);
      }
    }
    assert.equal(cover.size, cells * cells, `${cells}: 有格子沒鋪到`);
    for (const [k, n] of cover) assert.equal(n, 1, `${cells}: ${k} 被蓋了 ${n} 次`);
  }
});

test('木條數量剛好是格數的一半', () => {
  for (const cells of [4, 8]) assert.equal(herringbonePlanks(cells).length, cells * cells / 2);
});

test('橫的直的都有——全同向就變成一般的直鋪', () => {
  const ps = herringbonePlanks(8);
  assert.ok(ps.some(p => p.horizontal));
  assert.ok(ps.some(p => !p.horizontal));
  const h = ps.filter(p => p.horizontal).length;
  assert.equal(h, ps.length / 2, '橫直應該各半');
});

test('沿著一列走，方向嚴格交替——這才是人字不是磚砌', () => {
  // 同一列上只有偶數格是起點（1 和 3 是別塊木條的後半），所以要沿實際的
  // 起點序列看，不是逐格看。
  const ps = herringbonePlanks(8);
  const row = ps.filter(p => p.j === 0).sort((a, b) => a.i - b.i);
  assert.equal(row.length, 4, JSON.stringify(row));
  for (let k = 1; k < row.length; k++) {
    assert.notEqual(row[k].horizontal, row[k - 1].horizontal,
      `第 ${k} 塊沒有換向: ${JSON.stringify(row)}`);
  }
});

test('往下一列，整個圖案會位移——不位移就變成格子而不是人字', () => {
  const ps = herringbonePlanks(8);
  const startsIn = (j: number) => ps.filter(p => p.j === j).map(p => p.i).sort((a, b) => a - b);
  assert.notDeepEqual(startsIn(0), startsIn(1));
});

// ---------------------------------------------------------------- 平面圖填充

test('每個材質都有平面圖的填充樣式', () => {
  // 沒有的話那個房間在平面圖上看不出鋪的是什麼，而且不會有任何提示。
  for (const m of MATERIALS) assert.ok(m.hatch, m.id);
});

test('填充的尺度是真實尺寸，而且合理', () => {
  for (const m of MATERIALS) {
    const cm = m.hatchCm ?? m.tileCm;
    assert.ok(cm >= 30 && cm <= 400, `${m.id}: ${cm}cm`);
  }
});

test('填充樣式畫出來確實有東西——空的等於沒填充', () => {
  // 用一個假的 2D context 記下有幾次描邊／填色。
  let ops = 0;
  const fake = new Proxy({} as any, {
    get: (_, k) => {
      if (k === 'stroke' || k === 'fill') return () => { ops++; };
      if (typeof k === 'string' && /^(save|restore|translate|rotate|beginPath|moveTo|lineTo|arc|fillRect)$/.test(k)) return () => {};
      return undefined;
    },
    set: () => true,
  });
  for (const m of MATERIALS) {
    ops = 0;
    m.hatch!(fake, 64);
    assert.ok(ops > 0, `${m.id} 沒有畫出任何東西`);
  }
});

test('不同材質的填充不會長得一模一樣', () => {
  // 全都用同一種斜線的話，平面圖上磁磚跟地毯分不出來。
  const sig = (m: typeof MATERIALS[number]) => {
    const calls: string[] = [];
    const fake = new Proxy({} as any, {
      get: (_, k) => (typeof k === 'string' && /^(stroke|fill|moveTo|lineTo|arc|fillRect|rotate)$/.test(k)
        ? (...a: unknown[]) => { calls.push(k + a.map(n => typeof n === 'number' ? n.toFixed(1) : '').join(',')); }
        : () => {}),
      set: () => true,
    });
    m.hatch!(fake, 64);
    return calls.join('|');
  };
  const seen = new Map<string, string>();
  for (const m of MATERIALS) {
    const s = sig(m);
    const prev = seen.get(s);
    // 木頭與胡桃木共用同一種板線是刻意的——製圖慣例上兩者都是木地板。
    if (prev && !(['wood', 'walnut'].includes(m.id) && ['wood', 'walnut'].includes(prev))) {
      assert.fail(`${m.id} 與 ${prev} 的填充完全相同`);
    }
    seen.set(s, m.id);
  }
});
