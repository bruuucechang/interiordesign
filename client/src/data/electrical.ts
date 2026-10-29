// Electrical symbols, drawn the way a Taiwanese 水電配置圖 draws them.
//
// Each symbol is drawn in world centimetres, centred on the origin, with the
// item's "up" pointing at -y. Wall-mounted symbols are rotated so that up faces
// into the room; ceiling symbols ignore rotation.
//
// The forms follow the conventional set: a circle with radiating legs for a
// socket, a circle with a switched arm for a switch, a cross-in-circle for a
// ceiling light, a filled dot for a downlight.

import { ElectricalId, Electrical } from '../model/schema';
import { T5_SIZES, T5_DEFAULT_SIZE } from '../model/catalogue';
import { linearLength } from '../core/linearLight';

const R = 11;   // cm — nominal symbol radius, so symbols read at 1:50

// `o` is the placed object when there is one (a batten is drawn at its own
// length); the palette and the placement preview draw without it.
type Draw = (ctx: CanvasRenderingContext2D, o?: Electrical) => void;

/**
 * The screen plan's quieter forms of the two lights a flat has dozens of (B25):
 * a downlight is a small ring instead of a filled dot, a batten an outlined
 * 3 cm strip instead of a filled 6 cm bar. The drawing set (plot), the lighting
 * overlay and the catalogue keep `ELECTRICAL_SYMBOLS`. The caller sets colour,
 * alpha (`QUIET_ALPHA`) and leaves the line width alone.
 */
export const QUIET_SYMBOLS: Partial<Record<ElectricalId, Draw>> = {
  downlight: ctx => { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.stroke(); },
  batten: (ctx, o) => {
    const half = T5_SIZES[o?.size ?? T5_DEFAULT_SIZE].length / 2;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.rect(-half, -3, half * 2, 3); ctx.stroke();
  },
};
export const QUIET_ALPHA: Partial<Record<ElectricalId, number>> = { downlight: 0.75, batten: 0.6 };

// B29: the linear lights and the downlight series, quiet forms drawn the same
// way — outlines at 1–1.5 cm, nothing filled, under the same alphas as the T5
// and the downlight they sit beside.
const lineHalf = (item: ElectricalId, o?: Electrical) => linearLength({ item, length: o?.length }) / 2;
const strip = (ctx: CanvasRenderingContext2D, half: number, y0: number, h: number) => {
  ctx.beginPath(); ctx.rect(-half, y0, half * 2, h); ctx.stroke();
};
const ring = (ctx: CanvasRenderingContext2D, r: number) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); };
Object.assign(QUIET_SYMBOLS, {
  // Ceiling runs straddle their point; wall runs sit on the lit side of the face they are fixed to.
  linearRecessed: (ctx, o) => { ctx.lineWidth = 1; strip(ctx, lineHalf('linearRecessed', o), -1.5, 3); },
  linearSurface: (ctx, o) => {
    const h = lineHalf('linearSurface', o);
    ctx.lineWidth = 1; strip(ctx, h, -2.5, 5);
    ctx.beginPath(); ctx.moveTo(-h, 0); ctx.lineTo(h, 0); ctx.stroke();
  },
  linearCove: (ctx, o) => {
    const h = lineHalf('linearCove', o);
    ctx.lineWidth = 1; strip(ctx, h, -3, 3);
    ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(-h, -8); ctx.lineTo(h, -8); ctx.stroke(); ctx.setLineDash([]);
  },
  linearWash: (ctx, o) => {
    const h = lineHalf('linearWash', o);
    ctx.lineWidth = 1; strip(ctx, h, -3, 3);
    for (let x = -h + 15; x < h; x += 30) { ctx.beginPath(); ctx.moveTo(x, -3); ctx.lineTo(x, -7); ctx.stroke(); }
  },
  linearShelf: (ctx, o) => { ctx.lineWidth = 1; ctx.setLineDash([3, 3]); strip(ctx, lineHalf('linearShelf', o), -2, 2); ctx.setLineDash([]); },
  dlFrameless: ctx => { ctx.lineWidth = 1.5; ring(ctx, 3.75); },
  dlDeep: ctx => { ctx.lineWidth = 1.5; ring(ctx, 4.75); ctx.lineWidth = 1; ring(ctx, 2); },
  dlAdjust: ctx => {
    ctx.lineWidth = 1.5; ring(ctx, 4.5);
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 8); ctx.stroke();
  },
  dlWash: ctx => {
    ctx.lineWidth = 1.5; ring(ctx, 4.5);
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 7.5, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
  },
  dlTwin: ctx => {
    ctx.lineWidth = 1; ctx.beginPath(); ctx.rect(-9, -4.5, 18, 9); ctx.stroke();
    for (const x of [-4.5, 4.5]) { ctx.beginPath(); ctx.arc(x, 0, 2.5, 0, Math.PI * 2); ctx.stroke(); }
  },
} satisfies Partial<Record<ElectricalId, Draw>>);
Object.assign(QUIET_ALPHA, {
  linearRecessed: 0.6, linearSurface: 0.6, linearCove: 0.6, linearWash: 0.6, linearShelf: 0.6,
  dlFrameless: 0.75, dlDeep: 0.75, dlAdjust: 0.75, dlWash: 0.75, dlTwin: 0.75,
});

const circle = (ctx: CanvasRenderingContext2D, r = R) => {
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
};

/** A socket: a half-disc sitting on the wall line, with `n` prongs. */
function socket(ctx: CanvasRenderingContext2D, n: number, filled = false) {
  ctx.beginPath();
  ctx.arc(0, 0, R, Math.PI, 0);        // upper half only — the wall is the flat side
  ctx.closePath();
  if (filled) ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-R, 0); ctx.lineTo(R, 0); // the wall line itself
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -0.5 + i / (n - 1);
    const x = t * R * 0.9;
    ctx.beginPath(); ctx.moveTo(x, -R * 0.35); ctx.lineTo(x, -R * 1.5); ctx.stroke();
  }
}

/** A switch: a small circle with an arm, `n` arms for n-way. */
function switchSym(ctx: CanvasRenderingContext2D, n: number) {
  circle(ctx, R * 0.45); ctx.stroke();
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45);
    ctx.lineTo(Math.cos(a) * R * 1.6, Math.sin(a) * R * 1.6);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();   // wall line
}

export const ELECTRICAL_SYMBOLS: Record<ElectricalId, Draw> = {
  socket:      ctx => socket(ctx, 1),
  socket2:     ctx => socket(ctx, 2),
  socketWater: ctx => { socket(ctx, 2); circle(ctx, R * 1.35); ctx.stroke(); },   // ringed = weatherproof
  tv: ctx => {
    socket(ctx, 1);
    ctx.beginPath(); ctx.moveTo(-R * 0.5, -R * 1.5); ctx.lineTo(R * 0.5, -R * 1.5); ctx.stroke();
  },
  network: ctx => {
    socket(ctx, 1);
    ctx.beginPath();                                    // a small chevron = data
    ctx.moveTo(-R * 0.45, -R * 1.1); ctx.lineTo(0, -R * 1.6); ctx.lineTo(R * 0.45, -R * 1.1);
    ctx.stroke();
  },

  switch1: ctx => switchSym(ctx, 1),
  switch2: ctx => switchSym(ctx, 2),
  switch3: ctx => switchSym(ctx, 3),

  ceilingLight: ctx => {                                // circle with a cross
    circle(ctx); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-R, 0); ctx.lineTo(R, 0);
    ctx.moveTo(0, -R); ctx.lineTo(0, R);
    ctx.stroke();
  },
  downlight: ctx => { circle(ctx, R * 0.6); ctx.fill(); ctx.stroke(); },   // filled dot
  spotlight: ctx => {                                   // dot with a direction arrow
    circle(ctx, R * 0.5); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, R * 0.5); ctx.lineTo(0, R * 1.5);
    ctx.moveTo(-R * 0.3, R * 1.1); ctx.lineTo(0, R * 1.5); ctx.lineTo(R * 0.3, R * 1.1);
    ctx.stroke();
  },
  pendant: ctx => {                                     // circle hung from a stem
    ctx.beginPath(); ctx.moveTo(0, -R * 1.6); ctx.lineTo(0, -R * 0.7); ctx.stroke();
    circle(ctx, R * 0.7); ctx.stroke();
  },
  wallLight: ctx => {                                   // half circle against the wall
    ctx.beginPath(); ctx.arc(0, 0, R * 0.8, Math.PI, 0); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
  },
  batten: (ctx, o) => {                                 // the tube to scale, a tick on its lit side
    // Its point is the wall face it is fixed to, so the tube is drawn wholly on
    // the lit side of it rather than straddling the face and sinking into the wall.
    const half = T5_SIZES[o?.size ?? T5_DEFAULT_SIZE].length / 2;
    ctx.beginPath(); ctx.rect(-half, -6, half * 2, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, -R - 3); ctx.stroke();
  },
  // B29, the drawing set's forms: the run to scale and filled, like the T5.
  linearRecessed: (ctx, o) => {                         // a slot: filled strip between two lines
    const h = lineHalf('linearRecessed', o);
    ctx.beginPath(); ctx.rect(-h, -2, h * 2, 4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-h, -5); ctx.lineTo(h, -5); ctx.moveTo(-h, 5); ctx.lineTo(h, 5); ctx.stroke();
  },
  linearSurface: (ctx, o) => {                          // a filled bar
    const h = lineHalf('linearSurface', o);
    ctx.beginPath(); ctx.rect(-h, -3, h * 2, 6); ctx.fill(); ctx.stroke();
  },
  linearCove: (ctx, o) => {                             // the strip, and the cove edge dashed in front of it
    const h = lineHalf('linearCove', o);
    ctx.beginPath(); ctx.rect(-h, -5, h * 2, 5); ctx.fill(); ctx.stroke();
    ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.moveTo(-h, -12); ctx.lineTo(h, -12); ctx.stroke(); ctx.setLineDash([]);
  },
  linearWash: (ctx, o) => {                             // the strip with ticks on its lit side
    const h = lineHalf('linearWash', o);
    ctx.beginPath(); ctx.rect(-h, -5, h * 2, 5); ctx.fill(); ctx.stroke();
    for (let x = -h + 15; x < h; x += 30) { ctx.beginPath(); ctx.moveTo(x, -5); ctx.lineTo(x, -R); ctx.stroke(); }
  },
  linearShelf: (ctx, o) => {                            // a slim strip, dashed: inside a cabinet
    const h = lineHalf('linearShelf', o);
    ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.rect(-h, -3, h * 2, 3); ctx.stroke(); ctx.setLineDash([]);
  },
  dlFrameless: ctx => { circle(ctx, R * 0.4); ctx.fill(); ctx.stroke(); },
  dlDeep: ctx => { circle(ctx, R * 0.6); ctx.stroke(); circle(ctx, R * 0.3); ctx.fill(); },
  dlAdjust: ctx => {                                    // ring with a short aim arrow
    circle(ctx, R * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, R * 1.2);
    ctx.moveTo(-R * 0.25, R * 0.9); ctx.lineTo(0, R * 1.2); ctx.lineTo(R * 0.25, R * 0.9); ctx.stroke();
  },
  dlWash: ctx => {                                      // ring with an arc on the side it washes
    circle(ctx, R * 0.5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.9, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  },
  dlTwin: ctx => {                                      // a grille frame with two heads
    ctx.beginPath(); ctx.rect(-R, -R * 0.5, R * 2, R); ctx.stroke();
    for (const x of [-R * 0.5, R * 0.5]) { ctx.beginPath(); ctx.arc(x, 0, R * 0.3, 0, Math.PI * 2); ctx.fill(); }
  },
  exhaust: ctx => {                                     // circle with fan blades
    circle(ctx); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85);
      ctx.stroke();
    }
  },
};
