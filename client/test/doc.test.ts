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

// ---- 一次 commit 不等於一步歷史 ----
//
// 使用者回報「復原按鈕沒辦法用」。實測：畫一道牆之後單純點它四下（沒有拖動），
// 歷史就多出四筆內容一模一樣的紀錄，於是前四次按復原都是把畫面還原成它本來的
// 樣子——按鈕是亮的、歷史是滿的、畫面完全不動。這幾條把那件事釘住。

test('點選但沒有改到任何東西，不會產生一步歷史', () => {
  const d = new Doc();
  d.commit();
  d.add(sofa('a'));
  assert.equal(d.canUndo, true);
  // 四次「拿起來又放下」：SelectTool 每次點到物件都會 commit
  for (let i = 0; i < 4; i++) { d.commit(); d.emit(); }
  d.undo();
  assert.equal(d.objects.length, 0, '一次復原就該回到空的，不是第五次');
  assert.equal(d.canUndo, false);
});

test('一次拖曳只算一步，不管中間動了幾幀', () => {
  const d = new Doc();
  d.add(sofa('a'));
  d.commit();                                  // 按下把手
  for (let x = 1; x <= 10; x++) d.update('a', { x } as any);   // 十幀
  assert.equal((d.get('a') as any).x, 10);
  d.undo();
  assert.equal((d.get('a') as any).x, 0);
  assert.equal(d.canUndo, false);
});

test('改回原值不算一步', () => {
  const d = new Doc();
  d.add(sofa('a'));
  d.commit();
  d.update('a', { x: 50 } as any);
  d.undo();                                    // 回到 x=0
  assert.equal((d.get('a') as any).x, 0);
  d.commit();
  d.update('a', { x: 0 } as any);              // 設成本來就是的值
  assert.equal(d.canUndo, false, '值沒變就不該有東西可以復原');
});

test('底圖的圖檔資料不會被複製進每一筆歷史', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(200_000);
  const d = new Doc();
  d.commit();
  d.add({ id: 'i', kind: 'image', layer: 'underlay', x: 0, y: 0, w: 100, h: 100, src: big, opacity: 0.6 } as any);
  for (let i = 0; i < 20; i++) { d.commit(); d.add(sofa('s' + i)); }
  const bytes = (d as any).past.reduce((n: number, s: string) => n + s.length, 0);
  assert.ok(bytes < big.length, `歷史共 ${bytes} 字元，單一張底圖就 ${big.length}`);
  // 而且復原回去照樣拿得到原圖
  for (let i = 0; i < 20; i++) d.undo();
  assert.equal((d.get('i') as any).src, big);
});

test('undo 之後 redo 拿回來的底圖仍然是原圖', () => {
  const big = 'data:image/png;base64,' + 'B'.repeat(1000);
  const d = new Doc();
  d.commit();
  d.add({ id: 'i', kind: 'image', layer: 'underlay', x: 0, y: 0, w: 10, h: 10, src: big, opacity: 0.6 } as any);
  d.undo();
  assert.equal(d.objects.length, 0);
  d.redo();
  assert.equal((d.get('i') as any).src, big);
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

// ---- 圖層的顯示與鎖定也是一步歷史 ----
//
// 它們本來只 mutate 不 commit，而 `layers` 一直都在快照裡——於是兩件事同時成立：
// 隱藏一個圖層自己不可復原，但**別的東西**的復原會安靜地把顯示狀態改回去。對著
// 鍵盤的人看到的是：鎖了一個圖層、按 Ctrl+Z 想解鎖，結果不見的是剛剛畫的那道牆。

test('鎖定圖層是一步可以復原的動作', () => {
  const d = new Doc();
  d.add(sofa('a'));
  assert.equal(d.isLayerLocked('furniture'), false);
  d.toggleLayerLock('furniture');
  assert.equal(d.isLayerLocked('furniture'), true);
  d.undo();
  assert.equal(d.isLayerLocked('furniture'), false, '復原要解鎖，不是把沙發弄不見');
  assert.equal(d.objects.length, 1, '沙發不該被動到');
});

test('隱藏圖層是一步可以復原的動作', () => {
  const d = new Doc();
  d.toggleLayerVisible('walls');
  assert.equal(d.isLayerVisible('walls'), false);
  d.undo();
  assert.equal(d.isLayerVisible('walls'), true);
});

test('調整圖層順序也可以復原', () => {
  const d = new Doc();
  const before = d.project.layers.map(l => l.id).join(',');
  d.moveLayer(d.project.layers[1].id, -1);
  assert.notEqual(d.project.layers.map(l => l.id).join(','), before);
  d.undo();
  assert.equal(d.project.layers.map(l => l.id).join(','), before);
});

test('圖層沒有真的變的時候不會產生一步', () => {
  const d = new Doc();
  d.add(sofa('a'));
  d.setLayerLocked('furniture', false);   // 本來就是 false
  assert.equal(d.canUndo, false);
});
