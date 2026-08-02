import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSheet, drawAreaMM, planAreaMM, projectExtent, roomSchedule, scaleBarMetres, SCALES } from '../src/core/plot';
import { Project, Floor, Obj } from '../src/model/types';

const V = (x: number, y: number) => ({ x, y });
const wall = (id: string, a: [number, number], b: [number, number]): Obj =>
  ({ id, kind: 'wall', layer: 'walls', a: V(...a), b: V(...b), thickness: 12, bulge: 0 } as Obj);

function proj(floors: Partial<Floor>[]): Project {
  return {
    id: 'p', name: 'test', activeFloorId: 'f0', layers: [],
    floors: floors.map((f, i) => ({ id: `f${i}`, name: `${i + 1}F`, elevation: 0, height: 280, objects: [], ...f })),
  } as Project;
}

test('drawAreaMM leaves room for margins, title column and gutters', () => {
  const a4l = drawAreaMM('A4', 'landscape');
  assert.equal(a4l.w, 297 - 10 * 2 - 55 - 5 * 2);   // 212
  assert.equal(a4l.h, 210 - 10 * 2 - 5 * 2);        // 180
  // A3 is strictly roomier than A4 in the same orientation
  const a3l = drawAreaMM('A3', 'landscape');
  assert.ok(a3l.w > a4l.w && a3l.h > a4l.h);
});

test('chooseSheet picks the largest scale that fits', () => {
  // 2 x 1.5 m is tiny — the most detailed scale should win
  const s = chooseSheet(200, 150);
  assert.equal(s.scale, SCALES[0]);
});

test('chooseSheet drops to a coarser scale as the plan grows', () => {
  const small = chooseSheet(200, 150).scale;
  const big = chooseSheet(1510, 970).scale;    // the largest real plan, 15.1 x 9.7 m
  assert.ok(big > small, `expected a coarser scale for the bigger plan, got ${big} vs ${small}`);
});

test('chooseSheet fits the largest real plan, and the choice actually holds', () => {
  const w = 1510, h = 970;
  const s = chooseSheet(w, h);
  const plan = planAreaMM(s.paper, s.orientation);
  const need = { w: w * 10 / s.scale, h: h * 10 / s.scale };
  assert.ok(need.w <= plan.w + 1e-9, `${need.w} > ${plan.w}`);
  assert.ok(need.h <= plan.h + 1e-9, `${need.h} > ${plan.h}`);
});

test('chooseSheet prefers A4 when the plan fits on it at the same scale', () => {
  // 5.5 x 2.9 m — the median real plan
  const s = chooseSheet(550, 290);
  assert.equal(s.paper, 'A4');
});

test('planAreaMM reserves a band inside the drawing area for wall labels', () => {
  const d = drawAreaMM('A4', 'landscape'), p = planAreaMM('A4', 'landscape');
  assert.equal(p.w, d.w - 12);   // 6 mm each side
  assert.equal(p.h, d.h - 12);
});

test('the chosen scale leaves room for the wall labels, not just the geometry', () => {
  const w = 1035, h = 780;                    // a real saved plan
  const s = chooseSheet(w, h);
  const plan = planAreaMM(s.paper, s.orientation);
  assert.ok(w * 10 / s.scale <= plan.w + 1e-9);
  assert.ok(h * 10 / s.scale <= plan.h + 1e-9);
});

test('projectExtent unions every floor and ignores the underlay image', () => {
  const p = proj([
    { objects: [wall('w1', [0, 0], [400, 0])] },
    { objects: [wall('w2', [0, 0], [0, 300]), { id: 'i', kind: 'image', layer: 'underlay', x: -9000, y: -9000, w: 100, h: 100, src: '', opacity: 0.6 } as Obj] },
  ]);
  const e = projectExtent(p);
  assert.equal(e.x, 0);
  assert.equal(e.y, 0);
  assert.equal(e.w, 400);      // widest floor
  assert.equal(e.h, 300);      // tallest floor — image at -9000 must not stretch it
});

test('projectExtent falls back to a default box when nothing is drawn', () => {
  const e = projectExtent(proj([{}]));
  assert.ok(e.w > 0 && e.h > 0);
});

test('roomSchedule converts polygon area to m² and 坪', () => {
  const floor: Floor = {
    id: 'f', name: '1F', elevation: 0, height: 280,
    objects: [{ id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '客廳',
                poly: [V(0, 0), V(400, 0), V(400, 300), V(0, 300)] } as Obj],
  };
  const [row] = roomSchedule(floor);
  assert.equal(row.name, '客廳');
  assert.equal(row.m2, 12);                            // 4 m x 3 m
  assert.ok(Math.abs(row.ping - 12 / 3.30579) < 1e-9);
});

test('roomSchedule falls back to the bounding box without a polygon', () => {
  const floor: Floor = {
    id: 'f', name: '1F', elevation: 0, height: 280,
    objects: [{ id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 200, h: 100, name: '' } as Obj],
  };
  const [row] = roomSchedule(floor);
  assert.equal(row.m2, 2);
  assert.equal(row.name, '房間');                       // blank names get a default
});

test('scaleBarMetres returns a round length that fits on paper', () => {
  // at 1:50, 40 mm of paper is 2 m of world
  assert.equal(scaleBarMetres(50, 40), 2);
  // at 1:100, 40 mm is 4 m → the largest round step at or below is 2
  assert.equal(scaleBarMetres(100, 40), 2);
  // never returns something longer than the space allows
  for (const s of SCALES) {
    const m = scaleBarMetres(s, 30);
    assert.ok(m * 1000 / s <= 30 + 1e-9, `1:${s} bar ${m}m overflows 30mm`);
  }
});
