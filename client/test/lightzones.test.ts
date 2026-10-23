import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomZones, zoneStat, litBy, combos, pillowPoint, verdict } from '../src/core/lightzones';
import { lightRoom, luminaires, roomLuminaires, REFLECTANCE } from '../src/core/lighting';
import { fullHeightBoxes } from '../src/core/lightmap';
import type { Electrical, ElectricalId, Furniture, Obj, T5Size } from '../src/model/schema';

// 區域與開法比較。答案是原型（docs/lighting-prototype.html）的 zones／zoneStat／
// renderCombos 直接拿 DEFAULTS 跑出來的數字；演算法一樣、格點一樣，所以應該一位不差。

const near = (a: number | null | undefined, b: number, tol = 0.01) =>
  assert.ok(a != null && Math.abs(a - b) <= tol, `${a?.toFixed(2)} ≉ ${b} ±${tol}`);

let n = 0;
const elec = (item: ElectricalId, x: number, y: number, more: Partial<Electrical> = {}): Electrical =>
  ({ id: `e${n++}`, kind: 'electrical', layer: 'electrical', item, x, y, angle: 0, ...more });
const FACE = { N: 0, E: 90, S: 180, W: 270 } as const;
const t5 = (x: number, y: number, face: keyof typeof FACE, circuit: number, size: T5Size = 4) =>
  elec('batten', x, y, { angle: FACE[face], circuit, size });
const down = (x: number, y: number) => elec('downlight', x, y, { circuit: 3 });
const furn = (id: string, item: string, label: string, x: number, y: number, w: number, h: number, angle = 0, height?: number): Furniture =>
  ({ id, kind: 'furniture', layer: 'furniture', item, label, x, y, w, h, angle, ...(height ? { height } : {}) });
/** 原型的床是 x,y,w,h 的外框、床頭在離牆最近那一側；這裡是床本身的 w×h 加旋轉。床頭朝東＝90°。 */
const bedEast = (id: string, x: number, y: number, w: number, h: number) =>
  furn(id, 'bed_double', '床', x + w / 2 - h / 2, y + h / 2 - w / 2, h, w, 90);
const door = (id: string, x: number, y: number, width: number, angle: number): Obj =>
  ({ id, kind: 'door', layer: 'doors', x, y, width, angle });
const CEIL = 280;

const roomA: Obj[] = [
  { id: 'ra', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 365, h: 415, name: '你的房間' },
  furn('fa1', 'wardrobe', '衣櫃', 85, 0, 280, 60, 0, 280),
  furn('fa2', 'wardrobe', '櫃子', 0, 95, 50, 320, 0, 280),
  bedEast('fa3', 175, 135, 190, 175),
  furn('fa4', 'desk', '書桌', 122, 362, 243, 53),
  door('da', 42.5, 0, 85, 0),
  t5(230, 60, 'S', 2), t5(365, 248, 'W', 1), t5(230, 415, 'N', 2), t5(50, 248, 'E', 1),
  down(65, 105), down(175, 105), down(285, 105), down(65, 378), down(175, 378), down(285, 378),
];

const roomB: Obj[] = [
  { id: 'rb', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 348, h: 596, name: '上方房間' },
  furn('fb1', 'wardrobe', '櫃子', 0, 98, 46, 364, 0, 280),
  furn('fb2', 'wardrobe', '衣櫃', 105, 532, 243, 64, 0, 280),
  bedEast('fb3', 160, 193, 188, 181),
  door('db1', 0, 536, 88, 90), door('db2', 348, 481.5, 77, 90),
  t5(226, 73, 'S', 2), t5(348, 284, 'W', 1), t5(226, 532, 'N', 2), t5(46, 284, 'E', 1),
  down(166, 130), down(286, 130), down(166, 284), down(166, 455), down(286, 455),
];

function analyse(objs: Obj[]) {
  const lr = lightRoom(objs[0] as any, CEIL, fullHeightBoxes(objs, CEIL));
  const lums = roomLuminaires(lr, luminaires(objs, CEIL));
  const zones = roomZones(lr, objs, CEIL);
  const lit = litBy(lr, lums, REFLECTANCE.medium);
  return { lr, lums, zones, stat: (name: string) => zoneStat(lr, lit, zones.find(z => z.name === name)!) };
}

test('你的房間：五個區域、名字與原型一樣', () => {
  const { zones } = analyse(roomA);
  assert.deepEqual(zones.map(z => z.name), ['床（床面）', '書桌桌面', '衣櫃前', '櫃子前', '門口']);
  assert.deepEqual(zones.map(z => z.need), [100, 300, 100, 100, 100]);
  assert.deepEqual(zones.map(z => z.height), [55, 75, 75, 75, 75]);
});

test('你的房間：各區域平均跟原型一位不差', () => {
  const { stat } = analyse(roomA);
  near(stat('床（床面）')?.avg, 322.99); near(stat('床（床面）')?.min, 272.88);
  near(stat('書桌桌面')?.avg, 331.47);
  near(stat('衣櫃前')?.avg, 318.26);
  near(stat('櫃子前')?.avg, 315.28);
  near(stat('門口')?.avg, 202.28); near(stat('門口')?.min, 164.64);
});

test('上方房間：兩扇門各有門口，數字跟原型一樣', () => {
  const { zones, stat } = analyse(roomB);
  assert.deepEqual(zones.map(z => z.name), ['床（床面）', '櫃子前', '衣櫃前', '門口 1', '門口 2']);
  // 床轉了 90°，取樣從床自己的角落起算；188 不是 10 的倍數，樣本點跟原型（從世界
  // 座標的左上角起算）錯開 2 cm。差 0.13%，是格點的差，不是演算法的差。
  near(stat('床（床面）')?.avg, 279.15, 279.15 * 0.005);
  near(stat('櫃子前')?.avg, 247.29);
  near(stat('衣櫃前')?.avg, 250.84);
  near(stat('門口 1')?.avg, 139.29);
  near(stat('門口 2')?.avg, 247.05);
});

test('櫃前區域選的是開向房間的最長面，不是貼牆那面', () => {
  const { zones } = analyse(roomA);
  const wardrobe = zones.find(z => z.name === '衣櫃前')!.box;
  assert.deepEqual([wardrobe.cx, wardrobe.cy, wardrobe.w, wardrobe.h], [225, 85, 280, 50]);
  const side = zones.find(z => z.name === '櫃子前')!.box;
  assert.deepEqual([side.cx, side.cy, side.w, side.h], [75, 255, 50, 320]);
});

test('沒做到頂的櫃子沒有櫃前區域；房間外的家具不算', () => {
  const objs: Obj[] = [roomA[0], furn('low', 'wardrobe', '矮櫃', 85, 0, 280, 60, 0, 90), furn('out', 'desk', '書桌', 500, 0, 100, 50)];
  const lr = lightRoom(objs[0] as any, CEIL, []);
  assert.deepEqual(roomZones(lr, objs, CEIL), []);
});

test('旋轉的床：枕頭在床頭那一端，不管床轉幾度', () => {
  const up = pillowPoint(furn('b', 'bed_double', '', 0, 0, 150, 200, 0));
  near(up.x, 75); near(up.y, 25); near(up.toHead.y, -1);
  const east = pillowPoint(furn('b', 'bed_double', '', 0, 0, 150, 200, 90));
  near(east.x, 75 + 75); near(east.y, 100); near(east.toHead.x, 1);
});

test('開法比較：每種迴路組合一列，全開跟原型一樣', () => {
  const { lr, lums, zones } = analyse(roomA);
  const rows = combos(lr, lums, zones, REFLECTANCE.medium);
  assert.deepEqual(rows.map(r => r.circuits.join('+')), ['1', '2', '1+2', '3', '1+3', '2+3', '1+2+3']);
  const all = rows[6], only3 = rows[3];
  near(all.avg, 314.7, 0.05); near(all.min, 161.6, 0.05); near(all.bed, 323.0, 0.05); near(all.desk, 331.5, 0.05);
  near(only3.avg, 128.3, 0.05); near(only3.bed, 121.0, 0.05); near(only3.desk, 133.6, 0.05);
  assert.equal(all.lumens, 4 * 2000 + 6 * 720);
});

test('開法比較：沒有書桌那一欄是 null', () => {
  const { lr, lums, zones } = analyse(roomB);
  const rows = combos(lr, lums, zones, REFLECTANCE.medium);
  assert.equal(rows.length, 7);
  assert.equal(rows[6].desk, null);
  near(rows[6].bed, 279.2, 279.2 * 0.005);
});

test('達標判斷：夠／略暗（七成以上）／偏暗', () => {
  assert.equal(verdict(100, 100), 'ok');
  assert.equal(verdict(70, 100), 'dim');
  assert.equal(verdict(69, 100), 'dark');
});

test('外框縮到牆面之後，50 cm 厚牆上的門照樣有門口、牆心上的燈管照樣算進房間', () => {
  const W = (id: string, ax: number, ay: number, bx: number, by: number): Obj =>
    ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 50 });
  const walls = [W('w1', 0, 0, 400, 0), W('w2', 400, 0, 400, 300), W('w3', 400, 300, 0, 300), W('w4', 0, 300, 0, 0)];
  const room: Obj = { id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: 'r' };
  const objs = [room, ...walls, door('d', 200, 0, 90, 0), t5(200, 300, 'N', 1)];
  const lr = lightRoom(room as any, CEIL, [], walls as any);
  assert.equal(lr.poly[0].y, 25);
  assert.deepEqual(roomZones(lr, objs, CEIL).map(z => z.type), ['door']);
  assert.equal(roomLuminaires(lr, luminaires(objs, CEIL)).length, 1);
});

test('同一層有 60 cm 的柱子，12 cm 牆的房間也不會把隔壁管道間的門算成自己的', () => {
  const W = (id: string, ax: number, ay: number, bx: number, by: number, thickness: number): Obj =>
    ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });
  const walls = [W('w1', 0, 0, 300, 0, 12), W('w2', 300, 0, 300, 300, 12), W('w3', 300, 300, 0, 300, 12), W('w4', 0, 300, 0, 0, 12),
    W('duct', 330, 0, 330, 300, 12), W('col', 600, 0, 600, 60, 60)];
  const room: Obj = { id: 'a', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 300, h: 300, name: 'A' };
  // 管道間的門開在 x = 330 那道隔牆上，朝東開向 B
  const objs = [room, ...walls, door('dB', 330, 150, 60, 90)];
  const lr = lightRoom(room as any, CEIL, [], walls as any);
  assert.deepEqual(roomZones(lr, objs, CEIL).map(z => z.target), []);
});

test('流理台：檯面本身就是區域、量在檯面高度；嵌在流理台裡的水槽不另生一塊', () => {
  const objs: Obj[] = [
    { id: 'rk', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '廚房' },
    furn('ck', 'cabinet_kitchen', '流理台', 0, 240, 400, 60, 180),
    furn('sk', 'sink', '水槽', 50, 240, 80, 60, 180),
    furn('st', 'stove', '爐具', 250, 240, 80, 60, 180),
  ];
  const zones = roomZones(lightRoom(objs[0] as any, CEIL, []), objs, CEIL);
  assert.deepEqual(zones.map(z => [z.type, z.name, z.target, z.height, z.need]), [['counter', '流理台面', 'ck', 85, 300]]);
  assert.deepEqual([zones[0].box.cx, zones[0].box.cy, zones[0].box.w, zones[0].box.h], [200, 270, 400, 60]);
});

test('單獨擺的水槽、中島各自是流理台區域；高度照家具自己的', () => {
  const objs: Obj[] = [
    { id: 'rk', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '廚房' },
    furn('sk', 'sink', '水槽', 0, 0, 80, 50),
    furn('is', 'kitchen_island', '中島', 100, 100, 180, 90, 0, 95),
  ];
  const zones = roomZones(lightRoom(objs[0] as any, CEIL, []), objs, CEIL);
  assert.deepEqual(zones.map(z => [z.type, z.target, z.height]), [['counter', 'sk', 85], ['counter', 'is', 95]]);
});

test('洗手台：正面前方 60 cm、跟洗手台一樣寬，靠哪面牆都朝房間那一側', () => {
  // 背靠東牆（angle 90）：正面朝西。轉 90° 時 w×h 是家具本身的，外框中心不變。
  const objs: Obj[] = [
    { id: 'rb', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 200, h: 250, name: '衛浴' },
    furn('va', 'vanity', '洗手台', 200 - 30 - 76.5, 100 - 30 + 30, 153, 60, 90),
  ];
  const [z] = roomZones(lightRoom(objs[0] as any, CEIL, []), objs, CEIL);
  assert.equal(z.type, 'vanity'); assert.equal(z.name, '洗手台前'); assert.equal(z.need, 200); assert.equal(z.height, 75);
  near(z.box.cx, 200 - 60 - 30); near(z.box.cy, 130); assert.equal(z.box.w, 153); assert.equal(z.box.h, 60);
});

test('不該生出：馬桶、淋浴、爐具、冰箱沒有區域；房間外的洗手台、流理台不算', () => {
  const objs: Obj[] = [
    { id: 'rb', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 300, h: 300, name: '衛浴' },
    furn('to', 'toilet', '馬桶', 0, 0, 40, 70),
    furn('sh', 'shower', '淋浴間', 100, 0, 90, 90),
    furn('st', 'stove', '爐具', 0, 200, 80, 60),
    furn('fr', 'fridge', '冰箱', 200, 200, 80, 70),
    furn('vo', 'vanity', '洗手台', 400, 0, 80, 50),
    furn('co', 'cabinet_kitchen', '流理台', 400, 200, 180, 60),
  ];
  assert.deepEqual(roomZones(lightRoom(objs[0] as any, CEIL, []), objs, CEIL), []);
});

test('流理台高度：商店水槽櫃量在檯面 88 不是含龍頭的 121；有離地高度的加上去', () => {
  const objs: Obj[] = [
    { id: 'rk', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '廚房' },
    furn('cs', 'sh_cab_sink', '水槽櫃', 0, 0, 60, 61),
    furn('cs2', 'sh_cab_sink', '水槽櫃', 100, 0, 60, 61, 0, 121),
    { ...furn('up', 'cabinet_kitchen', '檯面', 200, 0, 100, 60), elevation: 10 },
  ];
  const zones = roomZones(lightRoom(objs[0] as any, CEIL, []), objs, CEIL);
  assert.deepEqual(zones.map(z => [z.target, z.height]), [['cs', 88], ['cs2', 88], ['up', 95]]);
});

test('重疊只留一塊：兩件一樣大的流理台疊在一起、洗臉盆放在浴櫃上', () => {
  const objs: Obj[] = [
    { id: 'rk', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '衛浴' },
    furn('a', 'cabinet_kitchen', '流理台', 0, 240, 180, 60),
    furn('b', 'cabinet_kitchen', '流理台', 0, 240, 180, 60),
    furn('vt', 'sh_vanity', '浴櫃', 200, 0, 90, 71),
    furn('wb', 'sh_washbasin', '洗臉盆', 217, 10, 56, 46),
  ];
  const zones = roomZones(lightRoom(objs[0] as any, CEIL, []), objs, CEIL);
  assert.deepEqual(zones.map(z => [z.type, z.target]), [['counter', 'a'], ['vanity', 'vt']]);
});

// 子區域（B12）：一個房間包了玄關、走道、廚房時，每塊各自一列，不被整間平均蓋掉。
const area = (id: string, name: string, x: number, y: number, w: number, h: number, lux?: number): Obj =>
  ({ id, kind: 'area', layer: 'rooms', x, y, w, h, name, ...(lux != null ? { lux } : {}) });

test('子區域：排在最前面、量在桌面、沒填目標用預設 100；中心在房間外的不算', () => {
  const objs: Obj[] = [
    { id: 'rz', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 600, h: 300, name: '客廳＋廚房' },
    door('dz', 300, 0, 90, 0),
    area('ab', '玄關', 0, 0, 150, 300),
    area('ac', '客廳', 300, 0, 300, 300, 150),
    area('ax', '隔壁', 700, 0, 100, 100),
  ];
  const zones = roomZones(lightRoom(objs[0] as any, CEIL, []), objs, CEIL);
  assert.deepEqual(zones.map(z => [z.type, z.name, z.target, z.height, z.need]),
    [['area', '玄關', 'ab', 75, 100], ['area', '客廳', 'ac', 75, 150], ['door', '門口', 'dz', 75, 100]]);
});

test('子區域：一盞燈只照得到一半時，暗的那塊自己是一列，整間平均蓋不掉它', () => {
  const objs: Obj[] = [
    { id: 'rz', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 600, h: 300, name: '客廳＋廚房' },
    area('aw', '西', 0, 0, 200, 300), area('ae', '東', 400, 0, 200, 300),
    down(500, 100), down(500, 200),
  ];
  const lr = lightRoom(objs[0] as any, CEIL, []);
  const zones = roomZones(lr, objs, CEIL);
  const lit = litBy(lr, roomLuminaires(lr, luminaires(objs, CEIL)), REFLECTANCE.medium);
  const [w, e] = zones.map(z => zoneStat(lr, lit, z)!.avg);
  assert.ok(e > w * 2, `東 ${e.toFixed(0)} 應遠亮於西 ${w.toFixed(0)}`);
  assert.equal(verdict(w, zones[0].need), 'dark');
});
