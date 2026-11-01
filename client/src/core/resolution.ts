// Adaptive render resolution for the 3D view.
//
// A maximised window on a Retina display asks the GPU for ~4.8 M pixels a frame,
// and ambient occlusion runs over every one of them. Measured on a MacBook Air
// under load:
//
//     0.5 MP -> 60 fps      2.7 MP -> 32 fps
//     1.7 MP -> 42 fps      4.8 MP -> 18 fps
//
// squarely fill-bound, with the frame times landing on 16.7 / 33.3 / 50 ms — the
// GPU missing whole vsync intervals. A fixed pixel ratio can only be wrong
// somewhere: 2 is unusable on a large window, 1 throws away sharpness a discrete
// GPU could easily afford. So spend what the machine actually delivers.
//
// The catch is that vsync hides headroom. A machine coasting at 30% load and one
// at 95% both report 16.7 ms, so "frames are fast, climb" has nothing to go on —
// the only way to find out whether a higher ratio fits is to try it. What keeps
// that from turning into a flicker every few seconds is memory: once a ratio has
// been measured as too slow it becomes the ceiling and is not tried again, so the
// search runs at most once per window size and then settles for good.
//
// Kept apart from view3d.ts so the decision is a pure function over numbers, with
// no WebGL context to stand up before it can be tested.

/** Ratios worth using, ascending. 1 is the floor — below it the view goes soft. */
export const RATIO_STEPS = [1, 1.25, 1.5, 2] as const;

/** Longer than this and we are below ~50 fps: give a step of resolution back. */
export const TOO_SLOW_MS = 20;

/** At or under this, the frame met vsync on a 60 Hz display — we are keeping up. */
export const KEEPING_UP_MS = 17.5;

/** Windows of keeping up before probing the next ratio up. */
export const CLIMB_AFTER = 4;

export interface ResolutionState {
  /** Pixel ratio in use. */
  ratio: number;
  /** Consecutive sample windows that kept up. */
  goodWindows: number;
  /**
   * Lowest ratio measured as too slow here, or Infinity if none is. Never climb
   * to it again — this is what makes the search converge instead of flickering.
   * Reset it when the workload changes (see `onWorkloadChange`).
   */
  ceiling: number;
}

export const initialState = (maxRatio: number): ResolutionState =>
  ({ ratio: Math.min(...RATIO_STEPS.filter(r => r <= maxRatio), maxRatio), goodWindows: 0, ceiling: Infinity });

export const startAt = (ratio: number): ResolutionState =>
  ({ ratio, goodWindows: 0, ceiling: Infinity });

/**
 * Forget what was too slow. Call when the canvas is resized: a ratio that could
 * not hold at the old size may be comfortable at the new one, and vice versa.
 */
export const onWorkloadChange = (s: ResolutionState): ResolutionState =>
  ({ ratio: s.ratio, goodWindows: 0, ceiling: Infinity });

/**
 * Decide the pixel ratio for the next sample window.
 *
 * Dropping is immediate — a user dragging the camera feels every slow frame.
 * Climbing is a deliberate probe: only after `CLIMB_AFTER` windows of keeping up,
 * and never back to a ratio already known to be too slow.
 */
export function nextResolution(
  state: ResolutionState,
  medianFrameMs: number,
  maxRatio: number,
): ResolutionState {
  const steps = RATIO_STEPS.filter(r => r <= maxRatio);
  if (steps.length === 0) return { ratio: maxRatio, goodWindows: 0, ceiling: state.ceiling };

  const i = steps.indexOf(state.ratio as (typeof RATIO_STEPS)[number]);
  const at = i < 0 ? steps.length - 1 : i;   // an unlisted ratio counts as the top
  const here = steps[at];

  if (medianFrameMs > TOO_SLOW_MS) {
    // This ratio does not hold. Remember that, whether or not there is room below.
    const ceiling = Math.min(state.ceiling, here);
    return at > 0
      ? { ratio: steps[at - 1], goodWindows: 0, ceiling }
      : { ratio: here, goodWindows: 0, ceiling };
  }

  if (medianFrameMs <= KEEPING_UP_MS && at < steps.length - 1 && steps[at + 1] < state.ceiling) {
    const good = state.goodWindows + 1;
    return good >= CLIMB_AFTER
      ? { ratio: steps[at + 1], goodWindows: 0, ceiling: state.ceiling }
      : { ratio: here, goodWindows: good, ceiling: state.ceiling };
  }

  return { ratio: here, goodWindows: 0, ceiling: state.ceiling };
}

// ── Ambient occlusion goes before sharpness ─────────────────────────────────
//
// Walking on a Retina screen used to settle at ratio 1 — half the display's
// sharpness, and the first thing anyone notices. GTAO is most of a frame's cost
// at high ratios: on the A1 plan at 1440×900×2, 16 samples ≈ 58 ms, 8 ≈ 46 ms,
// off ≈ 29 ms — about what ratio 1.25 with full AO costs. Losing contact
// shading is far less visible than losing half the pixels, so a slow window
// gives up AO samples first and resolution only once AO is already off; a fast
// one climbs resolution first and only then buys the samples back.
//
// AO levels have the same memory as ratios: one measured too slow becomes a
// ceiling and is not retried, so the search settles instead of oscillating.
//
// Only on and off. The sample count is a shader define, so 16 → 8 recompiles
// GTAO — a 65 ms frame in the middle of an orbit — for a saving that measured
// as noise next to switching the pass off. `enabled` costs nothing to flip.

/** GTAO samples, ascending; 0 is the pass switched off. */
export const AO_STEPS = [0, 16] as const;

export interface QualityState {
  res: ResolutionState;
  ao: number;
  /** Consecutive windows that kept up with resolution at its top. */
  aoGood: number;
  /** Lowest AO level measured as too slow here, or Infinity. */
  aoCeiling: number;
}

export const initialQuality = (maxRatio: number): QualityState =>
  ({ res: initialState(maxRatio), ao: AO_STEPS[AO_STEPS.length - 1], aoGood: 0, aoCeiling: Infinity });

/** Canvas resized: forget both ceilings (see `onWorkloadChange`). */
export const onQualityWorkloadChange = (q: QualityState): QualityState =>
  ({ res: onWorkloadChange(q.res), ao: q.ao, aoGood: 0, aoCeiling: Infinity });

/** Resolution can climb no further: top step for this display, or the next one is known too slow. */
function ratioAtTop(s: ResolutionState, maxRatio: number): boolean {
  const steps = RATIO_STEPS.filter(r => r <= maxRatio);
  const i = steps.indexOf(s.ratio as (typeof RATIO_STEPS)[number]);
  return i < 0 || i === steps.length - 1 || steps[i + 1] >= s.ceiling;
}

// ── Remembering where it settled ──
//
// Every page load used to start at ratio 1 and search upwards, and every step
// of that search is a resize — the composer reallocating its targets, 20–130 ms
// at 2× — so the first quarter-minute of every visit stuttered on the same
// machine that had found its level yesterday. Keep the settled state per canvas
// size and display, and start there.

/** How many unchanged sample windows count as settled (~6 s). */
export const SETTLED_AFTER = 8;

export const qualityKey = (w: number, h: number, dpr: number) => `${w}x${h}@${dpr}`;

/** A stored state, checked rather than trusted: it comes from localStorage. */
export function parseQuality(v: unknown, maxRatio: number): QualityState | null {
  const o = v as Partial<{ ratio: number; ceiling: number | null; ao: number; aoCeiling: number | null }> | null;
  if (!o || !RATIO_STEPS.includes(o.ratio as never) || o.ratio! > maxRatio || !AO_STEPS.includes(o.ao as never)) return null;
  const ceil = (x: unknown) => (typeof x === 'number' ? x : Infinity);   // JSON has no Infinity: stored as null
  return { res: { ratio: o.ratio!, goodWindows: 0, ceiling: ceil(o.ceiling) }, ao: o.ao!, aoGood: 0, aoCeiling: ceil(o.aoCeiling) };
}

export const storeQuality = (q: QualityState) => ({
  ratio: q.res.ratio, ceiling: Number.isFinite(q.res.ceiling) ? q.res.ceiling : null,
  ao: q.ao, aoCeiling: Number.isFinite(q.aoCeiling) ? q.aoCeiling : null,
});

export function nextQuality(q: QualityState, medianFrameMs: number, maxRatio: number): QualityState {
  const ai = Math.max(0, AO_STEPS.indexOf(q.ao as (typeof AO_STEPS)[number]));
  if (medianFrameMs > TOO_SLOW_MS) {
    if (ai > 0) {
      return { res: { ...q.res, goodWindows: 0 }, ao: AO_STEPS[ai - 1], aoGood: 0, aoCeiling: Math.min(q.aoCeiling, q.ao) };
    }
    return { ...q, res: nextResolution(q.res, medianFrameMs, maxRatio), aoGood: 0 };
  }
  if (!ratioAtTop(q.res, maxRatio)) return { ...q, res: nextResolution(q.res, medianFrameMs, maxRatio), aoGood: 0 };
  const up = AO_STEPS[ai + 1];
  if (medianFrameMs <= KEEPING_UP_MS && up !== undefined && up < q.aoCeiling) {
    const good = q.aoGood + 1;
    return good >= CLIMB_AFTER ? { ...q, ao: up, aoGood: 0 } : { ...q, aoGood: good };
  }
  return { ...q, aoGood: 0 };
}
