// What a light fitting looks like in 3D, as plain numbers.
//
// Pure: no three.js, no DOM, no doc. Each fitting becomes a few primitives — a
// box or an upright cylinder — in plan coordinates plus a height, and view3d
// turns those into meshes. Kept apart so the placement (which way a T5 runs,
// how far a wall light stands off its wall, that nothing pokes through the
// ceiling) can be tested without a GL context.
//
// Shape only: the glowing parts are drawn with an unlit material. The light
// they give is ./lightEmit + ./lamps3d (B18): a pool of twelve spot lights
// that follows you round the plan — eighty would bring a low-end GPU to its
// knees (docs/review-2026-10.md S1).
//
// Positions and heights come from `luminaire()` in lighting.ts, the same
// resolution the illuminance maths uses, so a T5 is drawn where it is counted.

import type { Electrical } from '../model/schema';
import { luminaire } from './lighting';

/**
 * One primitive. (x, y) is the plan point of its centre, z the height (cm above
 * the floor) of its centre. `angle` (degrees) turns it in plan the way the
 * object's own angle does, so a box's `w` runs along the fitting's local x.
 */
export type LightPart =
  | { shape: 'box'; x: number; y: number; z: number; w: number; d: number; h: number; angle: number; glow: boolean }
  | { shape: 'cylinder'; x: number; y: number; z: number; r: number; h: number; glow: boolean };

/** Sizes (cm). Typical units, not a catalogue: the 2D symbol does not record them. */
export const LIGHT_SIZE = {
  /** 9 cm cut-out downlight: lens and trim ring. */
  downlight: { lens: 4.5, trim: 6, h: 0.6 },
  spotlight: { r: 4, h: 9 },
  ceilingLight: { r: 22, h: 7 },
  pendant: { r: 17, h: 14, cord: 0.4 },
  wallLight: { w: 20, d: 8, h: 12 },
  /** T5 batten section: width on the wall, depth off it. */
  batten: { h: 2.5, d: 3 },
  exhaust: { w: 25, h: 1 },
} as const;

/** Clears the ceiling plane so a flush fitting does not z-fight with it. */
export const CEILING_GAP = 0.3;

/**
 * The primitives of one fitting under a ceiling `ceiling` cm high, or [] for a
 * socket or switch (nothing to see at this scale).
 */
export function lightParts(e: Electrical, ceiling: number): LightPart[] {
  if (e.item === 'exhaust') {
    const s = LIGHT_SIZE.exhaust;
    return [{ shape: 'box', x: e.x, y: e.y, z: ceiling - CEILING_GAP - s.h / 2, w: s.w, d: s.w, h: s.h, angle: e.angle, glow: false }];
  }
  const L = luminaire(e, ceiling);
  if (!L) return [];
  const top = ceiling - CEILING_GAP;
  switch (e.item) {
    case 'downlight': {
      const s = LIGHT_SIZE.downlight;
      // The lens sits a hair below the trim so the two never share a depth.
      return [
        { shape: 'cylinder', x: L.x, y: L.y, z: top - s.h / 2, r: s.trim, h: s.h, glow: false },
        { shape: 'cylinder', x: L.x, y: L.y, z: top - s.h - 0.1, r: s.lens, h: 0.2, glow: true },
      ];
    }
    case 'spotlight': {
      const s = LIGHT_SIZE.spotlight;
      return [
        { shape: 'cylinder', x: L.x, y: L.y, z: top - s.h / 2, r: s.r, h: s.h, glow: false },
        { shape: 'cylinder', x: L.x, y: L.y, z: top - s.h - 0.1, r: s.r * 0.75, h: 0.2, glow: true },
      ];
    }
    case 'ceilingLight': {
      const s = LIGHT_SIZE.ceilingLight;
      return [{ shape: 'cylinder', x: L.x, y: L.y, z: top - s.h / 2, r: s.r, h: s.h, glow: true }];
    }
    case 'pendant': {
      const s = LIGHT_SIZE.pendant;
      // Never above the ceiling nor into the floor, whatever elevation it was saved with.
      const shadeTop = Math.min(Math.max(L.z + s.h / 2, s.h + 0.2), top);
      const cord = top - shadeTop;
      const parts: LightPart[] = [
        { shape: 'cylinder', x: L.x, y: L.y, z: shadeTop - s.h / 2, r: s.r, h: s.h, glow: false },
        { shape: 'cylinder', x: L.x, y: L.y, z: shadeTop - s.h - 0.1, r: s.r * 0.85, h: 0.2, glow: true },
      ];
      if (cord > 0) parts.push({ shape: 'cylinder', x: L.x, y: L.y, z: shadeTop + cord / 2, r: s.cord, h: cord, glow: false });
      return parts;
    }
  }
  if (!L.tube) return [];
  // A tube (T5 batten, wall light) is mounted on a wall or a cabinet face and
  // lights the side it faces, so its body stands off the mounting point
  // towards that side by half its depth — the symbol is drawn on the wall line.
  const isBatten = e.item === 'batten';
  const w = isBatten ? L.tube.length : LIGHT_SIZE.wallLight.w;
  const d = isBatten ? LIGHT_SIZE.batten.d : LIGHT_SIZE.wallLight.d;
  const h = isBatten ? LIGHT_SIZE.batten.h : LIGHT_SIZE.wallLight.h;
  const z = Math.max(h / 2, Math.min(L.z, top - h / 2));
  return [{
    shape: 'box', x: L.x + L.tube.face[0] * d / 2, y: L.y + L.tube.face[1] * d / 2, z,
    w, d, h, angle: e.angle, glow: true,
  }];
}
