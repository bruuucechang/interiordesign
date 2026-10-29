// The 3D view's real light sources: what each fitting emits, and which few of
// them are switched on in the scene at once (docs/spec-game-mode.md §2, B18).
//
// Pure: no three.js. view3d turns an Emitter into a THREE.SpotLight.
//
// Every fitting is a spot light with the physical inverse-square fall-off
// (three's `decay = 2`). The numbers are the 2D maths' (lighting.ts), so the 3D
// view and the heat map agree on which light is brighter:
//   · downward lights: peak candela Φ(n+1)/2π of their cosⁿ, pointing down, the
//     cone cut where cosⁿ has fallen to 5 % and softened all the way (penumbra 1)
//   · tubes and wall lights: one spot at the middle of the tube, aimed into the
//     room along the side it lights, peak 2Φ/π² — the 2D model's summed segments
//
// A scene cannot hold eighty lights (lights3d.ts says why), so `pickEmitters`
// chooses the ones that matter where you are: the room you are in, the rooms
// you can see into through a door, then the nearest. Walls stop light only
// through shadow maps, and those are rationed to the nearest few.

import type { Electrical, Obj, Opening, Wall } from '../model/schema';
import { luminaire, shadeSegs, wallBetween, ShadeSeg, MAINTENANCE } from './lighting';
export type { ShadeSeg };

export interface Emitter {
  id: string;
  /** Plan position (cm) and height above its storey's floor (cm). */
  x: number; y: number; z: number;
  /** Unit direction it points, in plan axes plus height: [x, y, up]. */
  dir: [number, number, number];
  /** Half-angle of the cone, radians. */
  cone: number;
  /** Peak intensity, candela, maintenance factor applied. */
  candela: number;
  /** sRGB 0–1 for its colour temperature. */
  color: [number, number, number];
  circuit: number;
}

/** A fitting with no stated colour temperature: warm white, the 3000 K of the T5 datasheet. */
export const DEFAULT_CCT = 3000;
/** The widest cone three's SpotLight can draw well (it degenerates at 90°). */
export const MAX_CONE = 85 * Math.PI / 180;

/**
 * sRGB 0–1 of a black body at `k` kelvin — Tanner Helland's fit, good to a few
 * percent from 1000 K to 40000 K, which is all a lamp needs.
 */
export function kelvinRGB(k: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(1, Math.max(0, v / 255));
  return [c(r), c(g), c(b)];
}

/** Half-angle where cosⁿ has dropped to 5 % of its peak, capped at `MAX_CONE`. */
export const coneOf = (n: number) => Math.min(MAX_CONE, Math.acos(Math.pow(0.05, 1 / Math.max(n, 1e-3))));

/** Spots a ceiling linear light becomes in 3D: few, because the scene holds only ACTIVE_LIGHTS at once. */
export const LINE_SPOTS = 3;

/** The emitters of a storey's fittings, skipping switched-off groups. */
export function emitters(objs: readonly Obj[], ceiling: number, off?: ReadonlySet<number>): Emitter[] {
  const out: Emitter[] = [];
  for (const o of objs) {
    if (o.kind !== 'electrical') continue;
    const L = luminaire(o, ceiling);
    if (!L || off?.has(L.circuit)) continue;
    const color = kelvinRGB((o as Electrical).cct ?? DEFAULT_CCT);
    if (L.tube) {
      out.push({
        id: L.id, x: L.x, y: L.y, z: L.z, dir: [L.tube.face[0], L.tube.face[1], 0], cone: MAX_CONE,
        candela: MAINTENANCE * 2 * L.lumens / (Math.PI * Math.PI), color, circuit: L.circuit,
      });
    } else {
      const n = L.exponent ?? 1;
      // A ceiling linear light (B29) is LINE_SPOTS spots spread along it, sharing its flux,
      // so a 6 m run lights the floor along its length, not only under its middle.
      const k = L.line ? LINE_SPOTS : 1;
      for (let i = 0; i < k; i++) {
        const t = L.line ? (i + 0.5) / k - 0.5 : 0, len = L.line?.length ?? 0, ax = L.line?.axis ?? [0, 0];
        out.push({
          id: k > 1 ? `${L.id}#${i}` : L.id, x: L.x + ax[0] * len * t, y: L.y + ax[1] * len * t, z: L.z, dir: [0, 0, -1], cone: coneOf(n),
          candela: MAINTENANCE * L.lumens / k * (n + 1) / (2 * Math.PI), color, circuit: L.circuit,
        });
      }
    }
  }
  return out;
}

/** Walls between a viewpoint and the lights, with their doors and windows open. */
export function sightLines(objs: readonly Obj[]): ShadeSeg[] {
  return shadeSegs(
    objs.filter((o): o is Wall => o.kind === 'wall'),
    objs.filter((o): o is Opening => o.kind === 'door' || o.kind === 'window'),
  );
}

/** Height of the patch under a lamp that `pickEmitters` checks you can see, cm. */
const LIT_SPOT_H = 100;

/** How many lights the scene holds at once, and how many of them cast shadows. */
export const ACTIVE_LIGHTS = 12;
export const SHADOW_LIGHTS = 6;

/**
 * The lights to switch on for a viewer at (x, y, eye height `h`): those whose
 * pool of light it can see (same room, or through a door or window), nearest
 * first; then, only while shadow-casting slots are left, the nearest of the
 * rest — they light the walls you can see from behind them, and their shadow
 * keeps them there. At most `max`.
 */
export function pickEmitters(list: readonly Emitter[], at: { x: number; y: number; h: number },
                             walls: readonly ShadeSeg[], max = ACTIVE_LIGHTS): Emitter[] {
  const d2 = (e: Emitter) => (e.x - at.x) ** 2 + (e.y - at.y) ** 2;
  // "Seen" = you can see the floor it lights (1 m up, under it), not the fitting itself:
  // a lamp just past a door hides behind the head but pours light through the opening.
  const scored = list.map(e => ({ e, seen: !wallBetween(walls, at.x, at.y, at.h, e.x, e.y, Math.min(e.z, LIT_SPOT_H)), d: d2(e) }));
  scored.sort((a, b) => a.d - b.d);
  // A lamp behind a wall is only allowed into a slot that casts shadows — the
  // shadow is what stops it at the wall. Without one it would shine straight
  // through into the room you are standing in.
  const seen = scored.filter(s => s.seen), hidden = scored.filter(s => !s.seen);
  const room = Math.max(0, Math.min(max, SHADOW_LIGHTS) - seen.length);
  return [...seen.slice(0, max), ...hidden.slice(0, room)].map(s => s.e);
}

/**
 * Real candela to three's units. The scene is in centimetres, so inverse-square
 * is 10⁴ weaker than in metres; and its sun is a stylised 2, not 100 000 lux.
 * GAIN sets how bright a lit room looks against that — chosen by eye at night
 * on plan1151022 (bench/verify-b18.mjs): 1/250 left the lamps' pools invisible
 * under the night fill; 1/80 with the fill cut to 30 % reads as a lit room.
 */
export const LUX_GAIN = 1 / 80;
export const threeIntensity = (candela: number) => candela * 1e4 * LUX_GAIN;
