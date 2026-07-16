import { Vec } from '../model/types';

// Best-effort wall detection for a clean, mostly axis-aligned floor-plan image.
// Thresholds the picture (Otsu), finds long horizontal/vertical ink runs, and
// merges parallel-adjacent runs into single wall centrelines. Returns the wall
// segments in the processed pixel space plus its dimensions (caller maps to cm).
export function detectWallsFromImage(img: HTMLImageElement): { segments: [Vec, Vec][]; w: number; h: number } {
  const maxDim = 1000;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0, W, H);
  const data = cx.getImageData(0, 0, W, H).data;

  // luminance + Otsu threshold (separates dark ink from a light background)
  const lum = new Float32Array(W * H);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < W * H; i++) {
    const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = l; hist[Math.min(255, Math.round(l))]++;
  }
  const total = W * H;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  // Otsu — take the MIDPOINT of the max-variance plateau (a light bg with sparse
  // dark ink makes the variance flat between the two modes; the low end is wrong).
  let sumB = 0, wB = 0, maxVar = -1, tLo = 128, tHi = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (wF <= 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; tLo = tHi = t; }
    else if (v === maxVar) tHi = t;
  }
  const thr = Math.round((tLo + tHi) / 2);
  const ink = (x: number, y: number) => (lum[y * W + x] <= thr ? 1 : 0);   // dark pixels are ink

  const minLen = Math.max(24, Math.round(0.05 * Math.max(W, H)));   // ignore short marks (text, dims)
  const maxThick = 18;                                              // merge a wall's parallel faces; skip big blobs
  const segs: [Vec, Vec][] = [];

  const collect = (horizontal: boolean) => {
    const A = horizontal ? H : W;   // scan lines
    const B = horizontal ? W : H;   // along the line
    const runs: { a: number; s: number; e: number }[] = [];
    for (let a = 0; a < A; a++) {
      let b = 0;
      while (b < B) {
        if (horizontal ? ink(b, a) : ink(a, b)) {
          let e = b; while (e < B && (horizontal ? ink(e, a) : ink(a, e))) e++;
          if (e - b >= minLen) runs.push({ a, s: b, e: e - 1 });
          b = e;
        } else b++;
      }
    }
    const used = new Array(runs.length).fill(false);
    for (let i = 0; i < runs.length; i++) {
      if (used[i]) continue;
      let a0 = runs[i].a, a1 = runs[i].a, s = runs[i].s, e = runs[i].e; used[i] = true;
      for (let changed = true; changed;) {
        changed = false;
        for (let j = 0; j < runs.length; j++) {
          if (used[j]) continue;
          const r = runs[j];
          if (r.a >= a0 - 1 && r.a <= a1 + 1 && r.e >= s - 3 && r.s <= e + 3) {   // adjacent scan line + overlapping span
            a0 = Math.min(a0, r.a); a1 = Math.max(a1, r.a); s = Math.min(s, r.s); e = Math.max(e, r.e); used[j] = true; changed = true;
          }
        }
      }
      if (a1 - a0 <= maxThick && e - s >= minLen) {
        const c = (a0 + a1) / 2;
        segs.push(horizontal ? [{ x: s, y: c }, { x: e, y: c }] : [{ x: c, y: s }, { x: c, y: e }]);
      }
    }
  };
  collect(true);
  collect(false);
  return { segments: segs, w: W, h: H };
}
