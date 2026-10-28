import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomUse, shownRoomName, isDefaultRoomName } from '../src/core/roomUse';
import { FURNITURE } from '../src/data/furniture';
import type { Obj } from '../src/model/schema';
import { fitFurnitureToWall } from '../src/tools/place';

// Real catalogue entries, looked up by name, so a renamed or recategorised
// item breaks the test instead of a made-up one passing it.
const idOf = (name: string, cat?: string) => {
  const it = FURNITURE.find(f => f.name === name && (!cat || f.cat === cat));
  assert.ok(it, `no catalogue item named ${name}`);
  return it!.id;
};
const room = (name = '房間', x = 0, y = 0, w = 400, h = 400) =>
  ({ id: 'r', kind: 'room', layer: 'rooms', x, y, w, h, name } as Extract<Obj, { kind: 'room' }>);
let n = 0;
const put = (name: string, x = 100, y = 100, w = 50, h = 50, cat?: string): Obj =>
  ({ id: 'f' + n++, kind: 'furniture', layer: 'furniture', item: idOf(name, cat), x, y, w, h, angle: 0, label: '' } as Obj);
const elec = (item: string, x = 200, y = 200, angle = 0): Obj =>
  ({ id: 'e' + n++, kind: 'electrical', layer: 'electrical', item, x, y, angle } as Obj);
const read = (objs: Obj[], r = room()) => roomUse(r, [r, ...objs]);

test('a bed makes a bedroom that lacks a light and a wardrobe', () => {
  assert.deepEqual(read([put('雙人床')]), { use: '臥室', missing: ['燈', '衣櫃'] });
});

test('a bedside table is not a bed', () => {
  for (const name of ['床頭櫃', '彩繪床頭櫃', '北歐床頭櫃', '木床頭櫃', '床頭櫃 I', '床頭櫃 II']) {
    assert.equal(read([put(name)]).use, null, name);
  }
});

test('every kind of bed in the catalogue is a bed', () => {
  for (const name of ['雙人床', '單人床', '古典床', '鐵床架', '加大雙人床', '上下舖', '木框雙人床', '雙人床（布質）', '嬰兒床', '榻榻米地台', '布團台']) {
    assert.equal(read([put(name)]).use, '臥室', name);
  }
});

test('a light, from the catalogue or the electrical plan, clears 缺燈', () => {
  assert.deepEqual(read([put('雙人床'), put('對開衣櫃', 0, 300), put('吸頂燈', 200, 200)]).missing, []);
  assert.deepEqual(read([put('雙人床'), put('對開衣櫃', 0, 300), elec('downlight')]).missing, []);
  assert.deepEqual(read([put('雙人床'), put('對開衣櫃', 0, 300), elec('batten', 200, 0, 180)]).missing, []);   // on the top wall, facing in
});

test('a ceiling fan is not a light, and neither is an exhaust fan', () => {
  assert.deepEqual(read([put('雙人床'), put('對開衣櫃', 0, 300), put('吊扇', 200, 200, 50, 50)]).missing, ['燈']);
  assert.deepEqual(read([put('馬桶'), elec('exhaust')]).missing, ['燈']);
});

test('a wall light just outside the room, facing away, does not light it', () => {
  // On the top wall (y = 0) facing up and out: it lights the room next door.
  assert.deepEqual(read([put('雙人床'), put('對開衣櫃', 0, 300), elec('wallLight', 200, 0, 0)]).missing, ['燈']);
});

test('things in another room do not count', () => {
  assert.deepEqual(read([put('雙人床'), put('對開衣櫃', 600, 100), elec('downlight', 700, 100)]).missing, ['燈', '衣櫃']);
});

test('bathroom first: a toilet and a bed is a bathroom', () => {
  assert.deepEqual(read([put('雙人床'), put('馬桶', 300, 300)]), { use: '浴室', missing: ['燈', '排風扇'] });
});

test('a kitchen with a stove wants a range hood; one with only a sink does not', () => {
  assert.deepEqual(read([put('爐具')]), { use: '廚房', missing: ['燈', '抽油煙機'] });
  assert.deepEqual(read([put('水槽')]), { use: '廚房', missing: ['燈'] });
  assert.deepEqual(read([put('雙口爐'), put('抽油煙機', 200, 100), elec('ceilingLight')]).missing, []);
});

test('study wants a chair, dining room wants dining chairs, living room only a light', () => {
  assert.deepEqual(read([put('L型書桌')]), { use: '書房', missing: ['燈', '椅子'] });
  assert.deepEqual(read([put('書桌', 100, 100, 50, 50, '書房'), put('辦公椅', 200, 200)]).missing, ['燈']);
  assert.deepEqual(read([put('圓餐桌')]), { use: '餐廳', missing: ['燈', '餐椅'] });
  assert.deepEqual(read([put('木餐桌'), put('木餐椅', 200, 200)]).missing, ['燈']);
  assert.deepEqual(read([put('L型沙發')]), { use: '客廳', missing: ['燈'] });
});

test('a desk chair is not a desk', () => {
  assert.equal(read([put('書桌椅')]).use, null);
});

test('an empty room, or one with nothing that names it, reads as nothing', () => {
  assert.deepEqual(read([]), { use: null, missing: [] });
  assert.deepEqual(read([put('茶几'), elec('downlight')]), { use: null, missing: [] });
});

test('the reading shows only while the name is the default', () => {
  const reading = read([put('雙人床')]);
  assert.equal(shownRoomName(room('房間'), reading), '臥室');
  assert.equal(shownRoomName(room(''), reading), '臥室');
  assert.equal(shownRoomName(room('主臥'), reading), '主臥');
  assert.equal(shownRoomName(room('房間'), read([])), '房間');
  assert.equal(isDefaultRoomName(' 房間 '), true);
  assert.equal(isDefaultRoomName('小孩房間'), false);
});

test('roomUse does not touch the room', () => {
  const r = room();
  const before = JSON.stringify(r);
  roomUse(r, [r, put('雙人床')]);
  assert.equal(JSON.stringify(r), before);
});

test('a polygon room counts what is inside the polygon, not its bounding box', () => {
  // L-shape: the top-right quarter of the 400×400 box is outside it.
  const r = { ...room(), poly: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 0, y: 400 }] };
  assert.equal(roomUse(r, [r, put('雙人床', 280, 40, 80, 80)]).use, null);
  assert.equal(roomUse(r, [r, put('雙人床', 40, 280, 80, 80)]).use, '臥室');
});

test('a traced piece with no catalogue match is read by its label', () => {
  const traced = { id: 't', kind: 'furniture', layer: 'furniture', item: 'nope', x: 100, y: 100, w: 50, h: 50, angle: 0, label: '系統衣櫃' } as Obj;
  assert.deepEqual(read([put('單人床'), traced]).missing, ['燈']);
});

test('a wall-hung range hood whose centre sits on the wall line still belongs to the kitchen', () => {
  // Centre at y = -5: just past the room's edge, where a hood backed onto the top wall ends up.
  assert.deepEqual(read([put('爐具'), put('抽油煙機', 100, -30, 90, 50)]).missing, ['燈']);
  // …but a floor-standing piece out there is in the next room.
  assert.equal(read([put('雙人床', 100, -300, 160, 200)]).use, null);
});

test('a piece hung on a shared wall counts only for the room it faces', () => {
  // Two rooms sharing the wall at y = 400; hang things on the upper room's side with
  // the real wall-fit, and the lower room (just a bed) must not see them.
  for (const thickness of [8, 10, 12]) {
    const wall = { id: 'w', kind: 'wall', layer: 'walls', a: { x: 0, y: 400 }, b: { x: 400, y: 400 }, thickness } as Obj;
    const hang = (name: string, cursor: { x: number; y: number }) => {
      const it = FURNITURE.find(f => f.name === name && f.mount === 'wall')!;
      const fit = fitFurnitureToWall({ objects: [wall], isLayerVisible: () => true } as any, cursor, it)!;
      return { id: 'h' + n++, kind: 'furniture', layer: 'furniture', item: it.id, x: fit.pos.x - it.w / 2, y: fit.pos.y - it.h / 2, w: it.w, h: it.h, angle: fit.angle, label: '' } as Obj;
    };
    const upper = room('房間', 0, 0), lower = room('房間', 0, 400);
    const lamp = hang('壁燈', { x: 200, y: 370 }), hood = hang('抽油煙機', { x: 200, y: 360 });
    const things = [upper, lower, wall, put('雙人床', 100, 500, 160, 200), lamp, hood];
    assert.deepEqual(roomUse(lower, things), { use: '臥室', missing: ['燈', '衣櫃'] }, `wall ${thickness}`);
    assert.deepEqual(roomUse(upper, [upper, wall, put('爐具', 100, 100), lamp, hood]).missing, [], `wall ${thickness}`);
  }
});

test('a footstool, piano stool or lounge chair is not a chair to sit at a table', () => {
  for (const name of ['腳凳', '琴凳', '搖椅', '單椅', '溫徹斯特扶手椅', '玄關長凳']) {
    assert.deepEqual(read([put('木餐桌'), put(name, 200, 200)]).missing, ['燈', '餐椅'], name);
    assert.deepEqual(read([put('L型書桌'), put(name, 200, 200)]).missing, ['燈', '椅子'], name);
  }
  for (const name of ['餐椅', '吧檯椅', '大阪椅', '橡木椅', '高腳凳', '長凳']) {
    assert.deepEqual(read([put('木餐桌'), put(name, 200, 200)]).missing, ['燈'], name);
  }
});

test('a raised tatami platform is not a bed; the tatami bed platform is', () => {
  assert.equal(read([put('和室高地台')]).use, null);
  assert.equal(read([put('榻榻米地台')]).use, '臥室');
});
