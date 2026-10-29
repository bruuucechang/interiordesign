// B29 (docs/spec-luxury.md §2): the LED linear lights and the downlight series.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLinear, linearLength, linearOutput, fittingLength } from '../src/core/linearLight';
import { luminaire, sources, lux } from '../src/core/lighting';
import { lightParts, CEILING_GAP } from '../src/core/lights3d';
import { emitters, LINE_SPOTS } from '../src/core/lightEmit';
import { electricalEnds, hitTest } from '../src/core/hit';
import { ELECTRICAL, ELECTRICAL_BY_ID, LINEAR_LIGHTS, LIGHT_DEFAULTS, T5_SIZES, isLightItem, isWallLight, belowCeiling } from '../src/model/catalogue';
import { ELECTRICAL_SYMBOLS, QUIET_SYMBOLS, QUIET_ALPHA } from '../src/data/electrical';
import type { Electrical, ElectricalId, Obj } from '../src/model/schema';
import { lightingFindings } from '../src/core/lightcheck';

const LINEAR: ElectricalId[] = ['linearRecessed', 'linearSurface', 'linearCove', 'linearWash', 'linearShelf'];
const DOWN: ElectricalId[] = ['dlFrameless', 'dlDeep', 'dlAdjust', 'dlWash', 'dlTwin'];
const C = 280;
const el = (item: ElectricalId, over: Partial<Electrical> = {}): Electrical => ({
  id: 'e', kind: 'electrical', layer: 'electrical', item, x: 100, y: 200, angle: 0, ...over,
});

test('the ten new fittings are luminaires in the 燈具 category, in their own palette rows', () => {
  for (const id of LINEAR) {
    assert.equal(ELECTRICAL_BY_ID[id].cat, '燈具', id);
    assert.equal(ELECTRICAL_BY_ID[id].series, '鋁擠燈', id);
    assert.ok(isLinear(id) && isLightItem(id), id);
  }
  for (const id of DOWN) {
    assert.equal(ELECTRICAL_BY_ID[id].cat, '燈具', id);
    assert.equal(ELECTRICAL_BY_ID[id].series, '崁燈系列', id);
    assert.ok(!isLinear(id) && isLightItem(id), id);
    assert.equal(LIGHT_DEFAULTS[id]!.dist.type, 'down', id);
  }
  // The old ones keep their row and their kind.
  assert.ok(!isLinear('batten') && !isLinear('downlight') && !isLinear('socket'));
  assert.ok(isLightItem('batten') && isLightItem('downlight') && !isLightItem('socket') && !isLightItem('exhaust'));
  assert.equal(ELECTRICAL.filter(e => e.series).length, 10);
});

test('wall-mounted ones are the cove, wash and shelf strips (and the T5 and wall light as before)', () => {
  for (const id of ['linearCove', 'linearWash', 'linearShelf', 'batten', 'wallLight']) assert.ok(isWallLight(id), id);
  for (const id of ['linearRecessed', 'linearSurface', 'downlight', ...DOWN]) assert.ok(!isWallLight(id), id);
  assert.equal(belowCeiling('batten'), 15);
  assert.equal(belowCeiling('linearCove'), 15);
  assert.equal(belowCeiling('linearWash'), 5);
  assert.equal(belowCeiling('linearShelf'), undefined);
  assert.equal(belowCeiling('downlight'), undefined);
});

test('linearLength: the stored length, held inside the catalogue bounds; the default when unset', () => {
  assert.equal(linearLength({ item: 'linearRecessed', length: 250 }), 250);
  assert.equal(linearLength({ item: 'linearRecessed' }), 120);
  assert.equal(linearLength({ item: 'linearCove' }), 240);
  assert.equal(linearLength({ item: 'linearShelf' }), 60);
  assert.equal(linearLength({ item: 'linearRecessed', length: 5 }), 30);       // min
  assert.equal(linearLength({ item: 'linearRecessed', length: 30 }), 30);
  assert.equal(linearLength({ item: 'linearRecessed', length: 900 }), 600);    // max
  assert.equal(linearLength({ item: 'linearRecessed', length: 600 }), 600);
  assert.equal(linearLength({ item: 'linearShelf', length: 300 }), 240);
  assert.equal(linearLength({ item: 'linearRecessed', length: NaN }), 120);
  assert.equal(linearLength({ item: 'downlight', length: 200 }), 0);
  assert.equal(linearLength({ item: 'batten' }), 0);
});

test('linearOutput: flux and power are per metre times the length', () => {
  assert.deepEqual(linearOutput('linearRecessed', 100), { lumens: 800, watts: 10 });
  assert.deepEqual(linearOutput('linearRecessed', 250), { lumens: 2000, watts: 25 });
  assert.deepEqual(linearOutput('linearSurface', 120), { lumens: 1200, watts: 14.4 });
  assert.deepEqual(linearOutput('linearShelf', 60), { lumens: 240, watts: 3 });
  assert.deepEqual(linearOutput('linearWash', 33), { lumens: 297, watts: 4 });
  assert.deepEqual(linearOutput('linearCove', 0), { lumens: 0, watts: 0 });
  assert.deepEqual(linearOutput('downlight', 100), { lumens: 0, watts: 0 });
  // Twice the run, twice the light.
  for (const id of LINEAR) {
    const a = linearOutput(id, 100).lumens, b = linearOutput(id, 200).lumens;
    assert.equal(b, 2 * a, id);
    assert.equal(a, LINEAR_LIGHTS[id]!.lmPerM, id);
  }
});

test('fittingLength: a T5 by its size, a linear light by its length, anything else 0', () => {
  assert.equal(fittingLength({ item: 'batten', size: 2 }), T5_SIZES[2].length);
  assert.equal(fittingLength({ item: 'batten' }), T5_SIZES[4].length);
  assert.equal(fittingLength({ item: 'linearWash', length: 210 }), 210);
  assert.equal(fittingLength({ item: 'dlTwin' }), 0);
});

test('a ceiling linear light is a downward line at the ceiling; its flux follows its length', () => {
  const L = luminaire(el('linearRecessed', { length: 300, angle: 90 }), C)!;
  assert.equal(L.z, C);
  assert.equal(L.lumens, 2400);
  assert.equal(L.watts, 30);
  assert.equal(L.tube, undefined);
  assert.equal(L.line!.length, 300);
  assert.ok(Math.abs(L.line!.axis[0]) < 1e-9 && Math.abs(L.line!.axis[1] - 1) < 1e-9);
  assert.ok(L.exponent! > 1);   // 110°, narrower than Lambertian
  // A typed flux overrides the length's.
  assert.equal(luminaire(el('linearRecessed', { length: 300, lumens: 999 }), C)!.lumens, 999);
});

test('the line is split into point sources along its length that carry its flux between them', () => {
  const L = luminaire(el('linearSurface', { length: 200 }), C)!;
  const src = sources([L]);
  assert.equal(src.length, 16);
  const xs = src.map(s => s.x);
  assert.ok(Math.min(...xs) > 0 && Math.max(...xs) < 200 && Math.min(...xs) < 10 && Math.max(...xs) > 190);
  assert.ok(src.every(s => s.y === 200 && s.z === C && s.n[2] === -1));
  const one = sources([{ ...L, line: undefined }])[0];
  const sumI = src.reduce((a, s) => a + s.I, 0);
  assert.ok(Math.abs(sumI - one.I) < 1e-9);
  // Far away a line looks like a point of the same flux; along its length it spreads the light more evenly than a point would.
  const far = lux(src, 100, 200 + 3000, 0, 0), farPt = lux([one], 100, 200 + 3000, 0, 0);
  assert.ok(Math.abs(far - farPt) / farPt < 0.02, `${far} vs ${farPt}`);
  const even = (s: typeof src) => lux(s, 200, 200, 75, 0) / lux(s, 100, 200, 75, 0);
  assert.ok(even(src) > even([one]) + 0.05, `${even(src)} vs ${even([one])}`);
});

test('wall strips are tubes as long as they are; a cove and a wash hang under the ceiling, a shelf strip at its height', () => {
  const cove = luminaire(el('linearCove', { length: 360 }), C)!;
  assert.equal(cove.tube!.length, 360);
  assert.equal(cove.lumens, 2880);
  assert.equal(cove.z, C - 15);
  assert.equal(luminaire(el('linearWash'), 300)!.z, 295);
  assert.equal(luminaire(el('linearWash', { elevation: 200 }), 300)!.z, 200);
  assert.equal(luminaire(el('linearWash', { elevation: 400 }), 300)!.z, 295);  // never above the ceiling
  const shelf = luminaire(el('linearShelf', { elevation: 120 }), C)!;
  assert.equal(shelf.z, 120);
  assert.equal(luminaire(el('linearShelf'), C)!.z, 180);
  assert.equal(shelf.lumens, 240);
});

test('every new fitting lights the floor under or in front of it', () => {
  for (const id of [...LINEAR, ...DOWN]) {
    const L = luminaire(el(id, { x: 0, y: 0 }), C)!;
    assert.ok(L && L.lumens > 0, id);
    // In front of a wall strip is local -y (angle 0 → -y); under a ceiling light is the point itself.
    const e = lux(sources([L]), 0, L.tube ? -60 : 0, 75, 0);
    assert.ok(e > 1, `${id}: ${e} lx`);
  }
});

test('the downlight series counts its datasheet flux at the ceiling', () => {
  assert.equal(luminaire(el('dlFrameless'), C)!.lumens, 560);
  assert.equal(luminaire(el('dlTwin'), C)!.lumens, 1100);
  for (const id of DOWN) assert.equal(luminaire(el(id, { elevation: 100 }), C)!.z, C, id);
  // Narrower beam, higher exponent.
  assert.ok(luminaire(el('dlAdjust'), C)!.exponent! > luminaire(el('dlFrameless'), C)!.exponent!);
});

test('3D: every new fitting stays under the ceiling and has something that glows', () => {
  for (const id of [...LINEAR, ...DOWN]) {
    const parts = lightParts(el(id), C);
    assert.ok(parts.length > 0, id);
    assert.ok(parts.some(p => p.glow), id);
    for (const p of parts) assert.ok(p.z + p.h / 2 <= C - CEILING_GAP + 1e-9, `${id} pokes through`);
  }
});

test('3D: a linear light is as long as its run, along its angle', () => {
  for (const id of LINEAR) {
    const parts = lightParts(el(id, { length: 222, angle: 30 }), C);
    const glow = parts.find(p => p.glow)!;
    assert.equal(glow.shape, 'box', id);
    if (glow.shape !== 'box') continue;
    assert.ok(Math.abs(glow.w - 222) <= 1, `${id}: ${glow.w}`);
    assert.equal(glow.angle, 30, id);
  }
  // A recessed downlight is a disc in a ring; the twin's two heads sit either side of the middle, along its angle.
  const twin = lightParts(el('dlTwin', { angle: 90 }), C).filter(p => p.glow);
  assert.equal(twin.length, 2);
  assert.ok(twin.every(p => Math.abs(p.x - 100) < 1e-9) && Math.abs(Math.abs(twin[0].y - twin[1].y) - 9) < 1e-9);
});

test('3D emitters: one per fitting, a ceiling linear light spread along its run; pointing down or into the room', () => {
  const objs = [...LINEAR, ...DOWN].map((id, i) => el(id, { id: `e${i}` }));
  const em = emitters(objs, C);
  assert.equal(em.length, 10 + 2 * (LINE_SPOTS - 1));
  for (const e of em) assert.ok(e.candela > 0 && (e.dir[2] === -1 || e.dir[2] === 0));
  assert.equal(new Set(em.map(e => e.id)).size, em.length);
  // The three spots of a 300 cm run share its flux and spread along it.
  const run = emitters([el('linearRecessed', { length: 300, x: 0, y: 0 })], C);
  const one = emitters([el('dlFrameless', { x: 0, y: 0, lumens: 2400, beam: 110 })], C)[0];
  assert.ok(Math.abs(run.reduce((a, e) => a + e.candela, 0) - one.candela) < 1e-6);
  assert.deepEqual(run.map(e => Math.round(e.x)), [-100, 0, 100]);
});

test('2D: every fitting has a drawing-set symbol and a quiet one, with an alpha', () => {
  for (const id of [...LINEAR, ...DOWN]) {
    assert.equal(typeof ELECTRICAL_SYMBOLS[id], 'function', id);
    assert.equal(typeof QUIET_SYMBOLS[id], 'function', id);
    assert.ok(QUIET_ALPHA[id]! > 0 && QUIET_ALPHA[id]! <= 1, id);
  }
});

test('2D: a linear symbol is drawn to its length', () => {
  // A recording context: the widest rect any symbol draws.
  const widest = (draw: (c: CanvasRenderingContext2D, o?: Electrical) => void, o: Electrical) => {
    let w = 0;
    const noop = () => {};
    const ctx = new Proxy({}, {
      get: (_t, k) => k === 'rect' ? (_x: number, _y: number, rw: number) => { w = Math.max(w, rw); } : noop,
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    draw(ctx, o);
    return w;
  };
  for (const id of LINEAR) {
    const o = el(id, { length: 222 });
    assert.equal(widest(ELECTRICAL_SYMBOLS[id], o), 222, id);
    assert.equal(widest(QUIET_SYMBOLS[id]!, o), 222, id);
  }
});

test('a linear light is grabbed anywhere along its length, a point fitting only near its point', () => {
  const run = el('linearRecessed', { x: 0, y: 0, length: 400 });
  const [a, b] = electricalEnds(run);
  assert.deepEqual([a.x, b.x], [-200, 200]);
  const docOf = (o: Electrical) => ({ objects: [o], isLayerVisible: () => true, isLayerLocked: () => false }) as never;
  assert.equal(hitTest(docOf(run), { x: 190, y: 3 }, 0)?.id, run.id);
  assert.equal(hitTest(docOf(run), { x: 190, y: 20 }, 0), undefined);
  assert.equal(hitTest(docOf(el('dlDeep', { x: 0, y: 0 })), { x: 190, y: 3 }, 0), undefined);
});

// Review of PR #30: the health check saw a ceiling linear light only at its middle, and had nowhere to mount a shelf light.
test('health check: a linear run over a full-height wardrobe is flagged even when its middle is clear', () => {
  const objs = [...box600(), { id: 'c2', kind: 'furniture', layer: 'furniture', item: 'wardrobe', x: 6, y: 100, w: 100, h: 300, angle: 0, height: 280 },
    { id: 'l1', kind: 'electrical', layer: 'electrical', item: 'linearRecessed', x: 200, y: 250, angle: 0, length: 300 }] as Obj[];
  const f = lightingFindings(objs, 280).filter(f => f.rule === 'light-cabinet');
  assert.ok(f.some(f => f.id.startsWith('light-cab-above:l1:')), f.map(f => f.title).join(' | '));
  // Its very end 15 cm into the wardrobe still counts as over it, not merely near.
  const tip = objs.map(o => o.id === 'l1' ? { ...o, x: 391, length: 600 } : o) as Obj[];
  assert.ok(lightingFindings(tip, 280).some(f => f.id.startsWith('light-cab-above:l1:')));
  // Shortened so the whole run is clear of it, it is only "too near" at most.
  const short = objs.map(o => o.id === 'l1' ? { ...o, length: 60 } : o) as Obj[];
  assert.ok(!lightingFindings(short, 280).some(f => f.id.startsWith('light-cab-above:l1:')));
});

test('health check: a linear run passing over the pillow glares from its nearest point', () => {
  // Bed against the top wall, pillow end at y ≈ 6; the run's middle is far off at the foot, its end over the pillow.
  const bed = { id: 'b1', kind: 'furniture', layer: 'furniture', item: 'bed_double', x: 200, y: 6, w: 160, h: 200, angle: 0 };
  const run = (x: number) => ({ id: 'l1', kind: 'electrical', layer: 'electrical', item: 'linearRecessed', x, y: 40, angle: 0, length: 400 });
  // "light-pillow:" is the direct-glare finding (within glareDirect of straight up).
  const glare = (o: object) => lightingFindings([...box600(), bed, o] as Obj[], 280).filter(f => f.id.startsWith('light-pillow:') && f.targets.includes('l1'));
  assert.ok(glare(run(480)).length > 0, 'end over the pillow');
  assert.equal(glare({ ...run(480), length: 60 }).length, 0, 'a short run there is off to the side');
});

test('health check: a shelf light on the face of a low cabinet counts as mounted', () => {
  const cab = { id: 'c1', kind: 'furniture', layer: 'furniture', item: 'cabinet', x: 200, y: 6, w: 200, h: 40, angle: 0, height: 90 };
  const shelf = { id: 's1', kind: 'electrical', layer: 'electrical', item: 'linearShelf', x: 300, y: 46, angle: 180, length: 120, elevation: 80 };
  const mount = (objs: object[]) => lightingFindings([...box600(), ...objs] as Obj[], 280).filter(f => f.rule === 'light-mount');
  assert.equal(mount([cab, shelf]).length, 0);
  assert.equal(mount([shelf]).length, 1, 'with no cabinet behind it, it still is not');
  // Other wall strips still need a wall, a beam or a full-height cabinet.
  assert.equal(mount([cab, { ...shelf, item: 'linearWash' }]).length, 1);
});

function box600(): object[] {
  const W = (id: string, a: object, b: object) => ({ id, kind: 'wall', layer: 'walls', a, b, thickness: 12 });
  return [W('w1', { x: 0, y: 0 }, { x: 600, y: 0 }), W('w2', { x: 600, y: 0 }, { x: 600, y: 500 }),
    W('w3', { x: 600, y: 500 }, { x: 0, y: 500 }), W('w4', { x: 0, y: 500 }, { x: 0, y: 0 }),
    { id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 600, h: 500, name: '臥室', poly: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }] }];
}
