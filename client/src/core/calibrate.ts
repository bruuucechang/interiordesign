// Telling the drawing how big it really is.
//
// An imported underlay arrives with no idea of its own scale — the importer
// guesses by fitting the longest side to about 10 m, which is a number, not a
// measurement. Trace over that and every wall is wrong by whatever the guess
// was out by, and **nothing looks wrong**: the plan is self-consistent, the
// rooms have sensible proportions, and the only symptom is that a 100 cm wall
// says 137.
//
// So the scale has to come from the drawing itself. Almost every floor plan
// carries at least one printed dimension; the user draws a line along it, types
// what it says, and the image is resized so that line really is that long.
//
// Pure: rect and two points in, new rect out. The tool applies it and owns undo.

import { Vec } from '../model/schema';

export interface Rect { x: number; y: number; w: number; h: number }

/** Why a calibration was refused, or null when it is usable. */
export type CalibrationError = 'too-short' | 'bad-length' | 'extreme';

/**
 * How short a drag is not a measurement.
 *
 * In world cm at the current — wrong — scale, so it cannot be a real distance;
 * it is only here to reject a click that did not mean to be a drag. A 2 px
 * twitch would otherwise divide by nearly zero and blow the image up to
 * kilometres, which is a far worse outcome than being told to try again.
 */
const MIN_DRAG = 1;

/**
 * Refuse a scale change beyond this factor.
 *
 * A plan is not out by 500×. That size of correction means the two numbers are
 * not describing the same thing — a line drawn across the whole page against a
 * dimension for one door, or centimetres typed where metres were meant. Doing
 * it anyway produces an underlay too big to find, and the user's next move is
 * to reload rather than to undo.
 */
const MAX_FACTOR = 200;

export interface Calibration {
  /** Multiply every world length by this to make the drag equal `realCm`. */
  factor: number;
  /** The underlay, resized. */
  rect: Rect;
}

/**
 * Resize `img` so the span `p0`→`p1` measures `realCm`.
 *
 * Scaled about the **middle of the drawn line**, not the image's corner or its
 * centre: the feature just measured is the one the user is looking at, and it
 * staying put is what makes the result legible. Anchoring anywhere else slides
 * the thing being checked out from under the cursor at the moment of checking.
 *
 * Aspect ratio is preserved. A floor plan photographed at an angle is not
 * something two numbers can fix, and stretching one axis to make a single
 * dimension right would quietly make every perpendicular one wrong.
 */
export function calibrate(
  img: Rect, p0: Vec, p1: Vec, realCm: number,
): Calibration | CalibrationError {
  const drawn = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!(drawn > MIN_DRAG)) return 'too-short';
  if (!Number.isFinite(realCm) || realCm <= 0) return 'bad-length';

  const factor = realCm / drawn;
  if (factor > MAX_FACTOR || factor < 1 / MAX_FACTOR) return 'extreme';

  // The anchor is in world coordinates; the rect grows around it.
  const ax = (p0.x + p1.x) / 2, ay = (p0.y + p1.y) / 2;
  return {
    factor,
    rect: {
      x: ax + (img.x - ax) * factor,
      y: ay + (img.y - ay) * factor,
      w: img.w * factor,
      h: img.h * factor,
    },
  };
}

/** What to tell the user when `calibrate` refused. */
export function calibrationMessage(e: CalibrationError): string {
  switch (e) {
    case 'too-short': return '這條線太短了 — 沿著圖上標了尺寸的那一段拉長一點';
    case 'bad-length': return '請輸入一個大於 0 的長度';
    case 'extreme': return `要縮放超過 ${MAX_FACTOR} 倍 — 檢查一下拉的線和輸入的數字是不是同一段`;
  }
}
