import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lighten, tintContext } from '../src/core/renderer';

// A stand-in for CanvasRenderingContext2D that only records what was set.
// tintContext only ever touches fillStyle/strokeStyle, so this is enough.
function fakeCtx() {
  return { fillStyle: '', strokeStyle: '', lineWidth: 0, calls: [] as string[],
           beginPath() { this.calls.push('beginPath'); },
           fill() { this.calls.push('fill:' + this.fillStyle); },
           stroke() { this.calls.push('stroke:' + this.strokeStyle); } } as any;
}

test('lighten moves a colour towards white', () => {
  assert.equal(lighten('#000000', 0), '#000000');
  assert.equal(lighten('#000000', 1), '#ffffff');
  assert.equal(lighten('#000000', 0.5), '#808080');
});

test('lighten leaves anything that is not a plain hex alone', () => {
  assert.equal(lighten('rgba(1,2,3,0.5)', 0.5), 'rgba(1,2,3,0.5)');
  assert.equal(lighten('#abc', 0.5), '#abc');
});

test('a body fill takes the chosen colour', () => {
  const raw = fakeCtx();
  const ctx = tintContext(raw, '#8a6a4a');
  ctx.fillStyle = '#3a4150';          // the catalogue's own body colour
  assert.equal(raw.fillStyle, '#8a6a4a');
});

test('an outline takes a lighter shade of it, so the drawing keeps its shape', () => {
  const raw = fakeCtx();
  const ctx = tintContext(raw, '#000000');
  ctx.strokeStyle = '#e0b45a';
  assert.equal(raw.strokeStyle, lighten('#000000', 0.45));
  assert.notEqual(raw.strokeStyle, '#000000');
});

test('alpha suffixes survive, which is what keeps detail lines subtle', () => {
  const raw = fakeCtx();
  const ctx = tintContext(raw, '#8a6a4a');
  ctx.strokeStyle = '#e0b45a88';       // a detail line in the catalogue
  assert.ok(raw.strokeStyle.endsWith('88'), `got ${raw.strokeStyle}`);
  ctx.fillStyle = '#3a415099';
  assert.equal(raw.fillStyle, '#8a6a4a99');
});

test('everything other than colour passes straight through', () => {
  const raw = fakeCtx();
  const ctx = tintContext(raw, '#8a6a4a');
  ctx.lineWidth = 4;
  assert.equal(raw.lineWidth, 4);
  // mirrors what every catalogue item does: set both colours, then draw
  ctx.fillStyle = '#3a4150'; ctx.strokeStyle = '#e0b45a';
  ctx.beginPath(); ctx.fill(); ctx.stroke();
  assert.deepEqual(raw.calls, ['beginPath', 'fill:#8a6a4a', 'stroke:' + lighten('#8a6a4a', 0.45)]);
});

test('a colour the drawing never sets is never invented', () => {
  // the tint only intercepts assignments; it does not paint on its own
  const raw = fakeCtx();
  const ctx = tintContext(raw, '#8a6a4a');
  ctx.beginPath(); ctx.fill();
  assert.deepEqual(raw.calls, ['beginPath', 'fill:']);
});

test('methods stay bound to the real context', () => {
  const raw = fakeCtx();
  const ctx = tintContext(raw, '#8a6a4a');
  const detached = ctx.fill;           // furniture code sometimes destructures
  ctx.fillStyle = '#3a4150';
  detached();
  assert.deepEqual(raw.calls, ['fill:#8a6a4a']);
});
