// Frame instrumentation, off unless asked for.
//
// This exists because two earlier attempts to fix "it feels slow" were wrong,
// both times because the number came from a machine that was busy with
// something else. The rule that came out of it — measure, don't guess — needs
// something to measure *with* that is always there and always the same.
//
// Enabled by `?perf=1` in the URL. When off, `mark()` returns 0 and `done()`
// does nothing, so the cost on a normal load is one comparison per frame.
//
// Kept out of view3d.ts and renderer.ts so both report through the same clock
// and the same buckets: the whole point is to see which of the two is eating
// the frame, and that is impossible if each keeps its own tally.

export type Channel = 'render2d' | 'render3d' | 'build3d';

export const PERF_ON = typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('perf');

interface Bucket {
  /** Times in ms, newest last. Capped — a soak run must not grow without bound. */
  times: number[];
  /** Everything ever counted, including what has rolled out of `times`. */
  count: number;
  /** Sum of everything ever counted, for a lifetime mean. */
  total: number;
}

const CAP = 600;

const buckets: Record<Channel, Bucket> = {
  render2d: { times: [], count: 0, total: 0 },
  render3d: { times: [], count: 0, total: 0 },
  build3d: { times: [], count: 0, total: 0 },
};

/** Start timing. Returns a token to hand back to `done`. */
export function mark(): number {
  return PERF_ON ? performance.now() : 0;
}

/** Stop timing something that started at `t0`. */
export function done(ch: Channel, t0: number): void {
  if (!PERF_ON) return;
  const dt = performance.now() - t0;
  const b = buckets[ch];
  b.count++;
  b.total += dt;
  b.times.push(dt);
  if (b.times.length > CAP) b.times.shift();
}

export interface Stats {
  count: number;
  /** Mean over the whole run, not just the window — a soak needs the drift. */
  meanAll: number;
  /** Over the last `CAP` samples. */
  p50: number;
  p95: number;
  max: number;
}

function stats(b: Bucket): Stats {
  const s = [...b.times].sort((x, y) => x - y);
  const at = (q: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0);
  return {
    count: b.count,
    meanAll: b.count ? b.total / b.count : 0,
    p50: at(0.5),
    p95: at(0.95),
    max: s.length ? s[s.length - 1] : 0,
  };
}

export function snapshot(): Record<Channel, Stats> {
  return { render2d: stats(buckets.render2d), render3d: stats(buckets.render3d), build3d: stats(buckets.build3d) };
}

export function reset(): void {
  for (const k of Object.keys(buckets) as Channel[]) {
    buckets[k] = { times: [], count: 0, total: 0 };
  }
}

// The soak driver reaches in through here rather than through the app's own
// objects, so instrumenting does not depend on what main.ts happens to export.
if (PERF_ON && typeof window !== 'undefined') {
  (window as any).__perf = { snapshot, reset };
}
