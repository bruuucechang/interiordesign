import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextResolution, onWorkloadChange, startAt, initialState,
  RATIO_STEPS, TOO_SLOW_MS, KEEPING_UP_MS, CLIMB_AFTER,
} from '../src/core/resolution';

const SLOW = TOO_SLOW_MS + 5;    // ~40 fps
const VSYNC = 16.7;              // 60 fps — what a machine that is keeping up reports
const MARGINAL = KEEPING_UP_MS + 1;   // not slow enough to drop, not fast enough to probe

test('a slow window gives back one step immediately', () => {
  assert.equal(nextResolution(startAt(2), SLOW, 2).ratio, 1.5);
  assert.equal(nextResolution(startAt(1.5), SLOW, 2).ratio, 1.25);
  assert.equal(nextResolution(startAt(1.25), SLOW, 2).ratio, 1);
});

test('it never drops below 1 — softer than that is worse than slow', () => {
  assert.equal(nextResolution(startAt(1), SLOW * 4, 2).ratio, 1);
});

test('it never climbs above what the display asks for', () => {
  let s = initialState(1);
  for (let i = 0; i < 20; i++) s = nextResolution(s, VSYNC, 1);
  assert.equal(s.ratio, 1);
});

test('climbing needs sustained vsync, not one good window', () => {
  let s = startAt(1);
  for (let i = 1; i < CLIMB_AFTER; i++) {
    s = nextResolution(s, VSYNC, 2);
    assert.equal(s.ratio, 1, `climbed after only ${i} good window(s)`);
    assert.equal(s.goodWindows, i);
  }
  s = nextResolution(s, VSYNC, 2);
  assert.equal(s.ratio, 1.25);
  assert.equal(s.goodWindows, 0, 'the counter restarts at the new ratio');
});

test('hitting vsync counts as keeping up — otherwise it could never climb back', () => {
  // Regression guard: a threshold below 16.7 ms is unreachable on a 60 Hz display,
  // which would make the whole thing one-way.
  assert.ok(KEEPING_UP_MS >= VSYNC, 'KEEPING_UP_MS must be reachable under vsync');
  let s = startAt(1);
  for (let i = 0; i < CLIMB_AFTER; i++) s = nextResolution(s, VSYNC, 2);
  assert.equal(s.ratio, 1.25, 'stuck at the floor forever');
});

test('a marginal window neither drops nor counts towards climbing', () => {
  const s = nextResolution({ ratio: 1.25, goodWindows: 3, ceiling: Infinity }, MARGINAL, 2);
  assert.equal(s.ratio, 1.25);
  assert.equal(s.goodWindows, 0);
});

test('a ratio proven too slow is remembered and never tried again', () => {
  // The machine sustains 1.25 but not 1.5. Feed each ratio what it really costs.
  const costOf = (r: number) => (r <= 1.25 ? VSYNC : SLOW);
  let s = initialState(2);
  const seen: number[] = [];
  for (let i = 0; i < 80; i++) {
    s = nextResolution(s, costOf(s.ratio), 2);
    seen.push(s.ratio);
  }
  assert.equal(s.ratio, 1.25, 'did not settle on the best ratio it can hold');
  assert.equal(s.ceiling, 1.5, 'did not remember which ratio was too slow');
  // Once the ceiling is known it must stop probing entirely.
  const tail = seen.slice(40);
  assert.ok(tail.every(r => r === 1.25), `still oscillating: ${[...new Set(tail)].join(', ')}`);
});

test('the ceiling survives a drop through several steps', () => {
  let s = startAt(2);
  s = nextResolution(s, SLOW, 2);     // 2 is too slow -> 1.5
  assert.equal(s.ceiling, 2);
  s = nextResolution(s, SLOW, 2);     // 1.5 too -> 1.25
  assert.equal(s.ceiling, 1.5, 'the ceiling must tighten to the lowest failure');
  assert.equal(s.ratio, 1.25);
});

test('resizing forgets the ceiling — a smaller canvas may afford more', () => {
  let s = startAt(2);
  s = nextResolution(s, SLOW, 2);
  assert.equal(s.ceiling, 2);
  s = onWorkloadChange(s);
  assert.equal(s.ceiling, Infinity);
  assert.equal(s.ratio, 1.5, 'the ratio in use is kept, only the memory is cleared');
});

test('when the display changes under it, the ratio comes down to the new ceiling', () => {
  // Window dragged from a Retina screen to an ordinary one: max drops 2 -> 1,
  // and the frames are fine, so nothing else would prompt a change.
  const s = nextResolution({ ratio: 2, goodWindows: 0, ceiling: Infinity }, VSYNC, 1);
  assert.equal(s.ratio, 1, 'kept paying for pixels the display cannot show');
});

test('an unlisted starting ratio is treated as the top step', () => {
  assert.equal(nextResolution(startAt(1.75), SLOW, 2).ratio, 1.5);
});

test('the steps are ascending and start at 1', () => {
  assert.equal(RATIO_STEPS[0], 1);
  for (let i = 1; i < RATIO_STEPS.length; i++) {
    assert.ok(RATIO_STEPS[i] > RATIO_STEPS[i - 1]);
  }
});

test('a machine that can hold the top ratio climbs all the way there', () => {
  let s = initialState(2);
  for (let i = 0; i < 40; i++) s = nextResolution(s, VSYNC, 2);
  assert.equal(s.ratio, 2);
  assert.equal(s.ceiling, Infinity);
});
