// Electrical symbols, drawn the way a Taiwanese 水電配置圖 draws them.
//
// Each symbol is drawn in world centimetres, centred on the origin, with the
// item's "up" pointing at -y. Wall-mounted symbols are rotated so that up faces
// into the room; ceiling symbols ignore rotation.
//
// The forms follow the conventional set: a circle with radiating legs for a
// socket, a circle with a switched arm for a switch, a cross-in-circle for a
// ceiling light, a filled dot for a downlight.

import { ElectricalId } from '../model/schema';

const R = 11;   // cm — nominal symbol radius, so symbols read at 1:50

type Draw = (ctx: CanvasRenderingContext2D) => void;

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
