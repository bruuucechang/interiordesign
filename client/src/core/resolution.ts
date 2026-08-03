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
