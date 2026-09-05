import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doc, isBlankPlan } from '../src/model/doc';

const sofa = (id: string) => ({ id, kind: 'furniture', layer: 'furniture', item: 'sofa', x: 0, y: 0, w: 100, h: 50, angle: 0, label: '' }) as any;

test('a new doc has one floor and no objects', () => {
  const d = new Doc();
  assert.equal(d.floors.length, 1);
  assert.equal(d.objects.length, 0);
});

test('add() puts the object on the active floor', () => {
  const d = new Doc();
  d.add(sofa('a'));
  assert.equal(d.objects.length, 1);
  assert.equal(d.activeFloor.objects[0].id, 'a');
});

test('addFloor() creates a new empty active floor stacked above', () => {
  const d = new Doc();
  d.add(sofa('a'));
  d.addFloor();
  assert.equal(d.floors.length, 2);
  assert.equal(d.objects.length, 0);                       // the new floor is empty
  assert.ok(d.activeFloor.elevation > 0);                  // stacked above 1F
});

test('switching floors swaps which objects are visible', () => {
  const d = new Doc();
  const f1 = d.activeFloor.id;
  d.add(sofa('a'));
  d.addFloor();
  d.add(sofa('b'));
  d.setActiveFloor(f1);
  assert.equal(d.objects.length, 1);
  assert.equal(d.objects[0].id, 'a');
});

test('undo/redo restores the object list', () => {
  const d = new Doc();
  d.commit();
  d.add(sofa('a'));
  assert.equal(d.objects.length, 1);
  d.undo();
  assert.equal(d.objects.length, 0);
  d.redo();
  assert.equal(d.objects.length, 1);
});

test('undo reverts an addFloor and the edits after it (whole-stack snapshot)', () => {
  const d = new Doc();
  d.add(sofa('a'));
  d.commit();                 // snapshot: 1 floor with sofa a
  d.addFloor();               // commits internally, then adds 2F
  d.add(sofa('b'));           // on 2F
  assert.equal(d.floors.length, 2);
  d.undo();                   // back to before addFloor
  assert.equal(d.floors.length, 1);
  assert.equal(d.objects.length, 1);   // sofa a still on 1F
});

test('an old flat project migrates into a single floor', () => {
  const legacy = { id: 'p', name: 'x', layers: [], objects: [sofa('a'), sofa('b')] } as any;
  const d = new Doc(legacy);
  assert.equal(d.floors.length, 1);
  assert.equal(d.objects.length, 2);
  assert.equal((d.project as any).objects, undefined);     // legacy field removed
});

// ---- 空白專案不該被建立成一列 ----
//
// 219 份存檔裡有 150 份叫「未命名平面圖」，其中 13 份完全是空的、85 份只有一兩道牆。
// 來源就是「開啟 App 不帶 ?plan= 就會在第一次 autosave 建一列」——每看一眼工具、每跑
// 一次 bench、每重載一次都留下一份，而且彼此之間、以及跟真正的工作之間都分不出來。

test('剛開的空白專案算空白', () => {
  assert.equal(isBlankPlan(Doc.blank()), true);
});

test('畫了任何東西就不算空白', () => {
  const p = Doc.blank();
  p.floors[0].objects.push({ id: 'w', kind: 'wall', layer: 'walls',
    a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 12 } as any);
  assert.equal(isBlankPlan(p), false);
});

test('底圖也算東西', () => {
  // 匯入底圖之後還沒描任何一道牆，那份圖也已經存在了。
  const p = Doc.blank();
  p.floors[0].objects.push({ id: 'i', kind: 'image', layer: 'underlay',
    x: 0, y: 0, w: 100, h: 100, src: 'data:,', opacity: 0.6 } as any);
  assert.equal(isBlankPlan(p), false);
});

test('取了名字就不算空白，即使什麼都還沒畫', () => {
  // 打了專案名再去找底圖的人已經表達了「這份圖存在」，因為還沒畫而弄丟它是另一種錯。
  const p = Doc.blank();
  p.name = '王宅 3F';
  assert.equal(isBlankPlan(p), false);
});

test('名字前後的空白不算取名', () => {
  const p = Doc.blank();
  p.name = '  未命名平面圖  ';
  assert.equal(isBlankPlan(p), true);
});

test('第二層樓有東西也不算空白', () => {
  const p = Doc.blank();
  p.floors.push({ id: 'f2', name: '2F', elevation: 280, height: 280,
    objects: [{ id: 'w', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 12 } as any] });
  assert.equal(isBlankPlan(p), false);
});
