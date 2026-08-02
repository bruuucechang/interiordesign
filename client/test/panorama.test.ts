import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsidePlan, panoramaViewerHTML, PANO_WIDTH, PANO_HEIGHT } from '../src/core/panorama';

// A 10 x 8 m plan, in cm, laid out from the origin.
const PLAN = [{ x: 0, y: 0, w: 1000, h: 800 }];

test('a camera inside the plan is accepted', () => {
  assert.ok(isInsidePlan({ x: 500, z: 400 }, PLAN));
  assert.ok(isInsidePlan({ x: 0, z: 0 }, PLAN));          // exactly on the corner counts
  assert.ok(isInsidePlan({ x: 1000, z: 800 }, PLAN));
});

test('the default framing — outside and away — is rejected', () => {
  // view3d frames a new plan at cx + span * 0.7, which for a 10 m span puts the
  // camera 2 m beyond the far wall. This is the case the guard exists for.
  const cx = 500, span = 1000;
  assert.ok(!isInsidePlan({ x: cx + span * 0.7, z: 400 }, PLAN));
});

test('being outside on either plan axis is enough to reject', () => {
  assert.ok(!isInsidePlan({ x: -1, z: 400 }, PLAN));
  assert.ok(!isInsidePlan({ x: 1001, z: 400 }, PLAN));
  assert.ok(!isInsidePlan({ x: 500, z: -1 }, PLAN));
  assert.ok(!isInsidePlan({ x: 500, z: 801 }, PLAN));
});

test('height is deliberately not checked — looking down from above still works', () => {
  // isInsidePlan takes no Y at all; a camera high above the walls is fine.
  assert.ok(isInsidePlan({ x: 500, z: 400 }, PLAN));
});

test('the union of several objects defines the boundary', () => {
  const boxes = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 900, y: 700, w: 100, h: 100 }];
  assert.ok(isInsidePlan({ x: 500, z: 400 }, boxes));     // between them, inside the union box
  assert.ok(!isInsidePlan({ x: 1100, z: 400 }, boxes));
});

test('an empty plan is never rejected', () => {
  assert.ok(isInsidePlan({ x: 9999, z: 9999 }, []));
});

test('the viewer is one self-contained file with the image inlined', () => {
  const html = panoramaViewerHTML('data:image/jpeg;base64,AAAA', '客廳', 1.25);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('data:image/jpeg;base64,AAAA'));
  assert.ok(html.includes('let yaw=1.25'), 'initial yaw is baked in');
  // no external fetches — it must work opened straight from the filesystem
  assert.ok(!/<script[^>]+src=/.test(html), 'no external script');
  assert.ok(!/<link[^>]+href=/.test(html), 'no external stylesheet');
});

test('the viewer escapes the project name into its title', () => {
  const html = panoramaViewerHTML('data:,', '<img onerror=alert(1)>', 0);
  assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img onerror'));
});

test('panorama dimensions are a 2:1 equirectangular frame', () => {
  assert.equal(PANO_WIDTH, PANO_HEIGHT * 2);
});
