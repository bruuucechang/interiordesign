import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// api.ts reads fetch/localStorage on call rather than at load, so plain globals
// installed before the import are enough.
(globalThis as any).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
};

let reply: { status: number; body: unknown } = { status: 200, body: { polygons: [] } };
(globalThis as any).fetch = async () => ({
  ok: reply.status < 400,
  status: reply.status,
  json: async () => reply.body,
  text: async () => JSON.stringify(reply.body),
});

const { detectRooms, dimensionChain, importDxf, detectWalls, listProjects, syncPending } = await import('../src/net/api');

const WALLS = [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }];

beforeEach(() => { reply = { status: 200, body: { polygons: [] } }; });

// 這一整組是浸泡測試第一次跑就抓到的：後端回了 200 但 body 不是預期的形狀，
// detectRooms 回 undefined，呼叫端 detected.map(...) 直接丟 TypeError。那是個
// async 函式裡的 unhandled rejection——畫面上完全看不出來。

test('正常回應就把多邊形交出去', async () => {
  reply = { status: 200, body: { polygons: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]] } };
  const got = await detectRooms(WALLS as any);
  assert.equal(got?.length, 1);
});

test('真的沒有房間，回的是空陣列不是 null', async () => {
  // 這個區別是整個函式的重點：null 代表「問不到」，空陣列代表「問到了，沒有」。
  const got = await detectRooms(WALLS as any);
  assert.deepEqual(got, []);
});

test('200 但 body 缺 polygons，要當成問不到', async () => {
  reply = { status: 200, body: {} };
  assert.equal(await detectRooms(WALLS as any), null);
});

test('polygons 不是陣列也一樣', async () => {
  // FastAPI 的錯誤 body、反向代理插進來的頁面、API 改版，都長這樣。
  for (const body of [{ polygons: null }, { polygons: 'nope' }, { detail: '找不到' }, {}, null]) {
    reply = { status: 200, body };
    assert.equal(await detectRooms(WALLS as any), null, JSON.stringify(body));
  }
});

test('連不上回 null', async () => {
  const saved = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => { throw new Error('offline'); };
  assert.equal(await detectRooms(WALLS as any), null);
  (globalThis as any).fetch = saved;
});

test('回傳值永遠是「陣列或 null」，不會是 undefined', async () => {
  // 呼叫端只擋 null。放 undefined 出去就等於讓它爆炸。
  for (const body of [{ polygons: [] }, {}, { polygons: 7 }, null]) {
    reply = { status: 200, body };
    const got = await detectRooms(WALLS as any);
    assert.ok(got === null || Array.isArray(got), JSON.stringify(body) + ' → ' + String(got));
    assert.notEqual(got, undefined);
  }
});

// ---------------------------------------------------------------- 其餘四個讀取端
//
// 同一個形狀在 api.ts 裡出現五次。全部宣告 `Promise<X | null>`，全部都能回
// undefined——TypeScript 抓不到，因為 j<T>() 被宣告成一定回 T，`d.walls` 就算
// body 裡根本沒有 walls 也能通過型別檢查。

const BAD_BODIES = [{}, null, { polygons: null }, { walls: 'nope' }, { detail: '錯誤' }];

test('dimensionChain：形狀不對回 null 不回 undefined', async () => {
  reply = { status: 200, body: { dimensions: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, text: '1' }] } };
  assert.equal((await dimensionChain({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, []))?.length, 1);
  for (const body of BAD_BODIES) {
    reply = { status: 200, body };
    assert.equal(await dimensionChain({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, []), null, JSON.stringify(body));
  }
});

test('importDxf：形狀不對回 null 不回 undefined', async () => {
  reply = { status: 200, body: { walls: [] } };
  assert.deepEqual(await importDxf('a.dxf', ['0'], 'mm'), []);
  for (const body of BAD_BODIES) {
    reply = { status: 200, body };
    assert.equal(await importDxf('a.dxf', ['0'], 'mm'), null, JSON.stringify(body));
  }
});

test('detectWalls：沒有 segments 就不是答案', async () => {
  reply = { status: 200, body: { segments: [], w: 10, h: 10 } };
  assert.equal((await detectWalls('data:,'))?.w, 10);
  for (const body of BAD_BODIES) {
    reply = { status: 200, body };
    assert.equal(await detectWalls('data:,'), null, JSON.stringify(body));
  }
});

test('listProjects：後端形狀不對時退回本機清單，不是丟例外', async () => {
  // 這裡的正確行為不是 null——使用者本機還有東西，清單不能變空。
  reply = { status: 200, body: {} };
  const got = await listProjects();
  assert.ok(Array.isArray(got), '一定要是陣列，畫面直接 map 它');
});

test('syncPending：後端形狀不對要當成離線，而不是每 20 秒丟一次例外', async () => {
  // 這一個掛在 autosave 心跳上。原本會每一拍都丟 unhandled rejection，
  // 而且畫面上的儲存狀態還顯示「已儲存 ✓」——離線編輯永遠推不上去。
  for (const body of BAD_BODIES) {
    reply = { status: 200, body };
    const r = await syncPending();
    assert.deepEqual(r, { pushed: 0, deleted: 0 }, JSON.stringify(body));
  }
});
