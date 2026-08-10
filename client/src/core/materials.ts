// The material library: what a surface is made of, drawn rather than downloaded.
//
// Procedural for three reasons that all still hold. There is no asset pipeline
// and no CDN, so an image would have to be committed as a data URI and would
// dominate the bundle. A drawn texture tiles at whatever size the surface needs
// without resampling. And nothing here carries a licence.
//
// Two things the first version got wrong and this one fixes:
//
//   * it used Math.random(), so the wood grain was different on every reload
//     and no test could say anything about it. Everything here takes a seeded
//     generator, so a material is a pure function of its id.
//   * it produced a colour map only. A floor with no normal map is a photograph
//     of a floor lying flat under the light — grout lines and plank seams do not
//     catch anything, and the room reads as printed rather than built. Each
//     material may also draw a height field, which becomes a normal map.
//
// Everything in this file is canvas drawing and arithmetic; the three.js side
// is in textures3d.ts. That split is what lets the parts that can be silently
// wrong — the normal encoding above all — be tested without a GL context.

/** One repeat of a texture, in centimetres of real surface. */
export type Category = 'floor' | 'wall';

export interface MaterialDef {
  id: string;
  /** Shown in the properties panel. */
  label: string;
  category: Category;
  /** How many centimetres of surface one repeat covers. Drives `repeat`. */
  tileCm: number;
  roughness: number;
  metalness: number;
  /** Representative colour, for the 2D plan and for swatches. */
  swatch: string;
  /** Draws the colour map into a size×size context. */
  albedo(c: CanvasRenderingContext2D, size: number, rnd: () => number): void;
  /** Draws a greyscale height field; lighter is nearer the eye. Optional. */
  height?(c: CanvasRenderingContext2D, size: number, rnd: () => number): void;
  /** Bump strength for the normal map. Larger is more pronounced. */
  bump?: number;
  /**
   * The plan-view hatch, drawn into a `size × size` context in black on
   * transparent. The renderer tints and fades it.
   *
   * A separate drawing from `albedo` on purpose: a floor plan is line work, and
   * pasting a photographic wood texture onto it makes it a picture of a floor
   * rather than a drawing of one. What a plan needs is the conventional hatch —
   * enough to tell tile from timber at a glance, faint enough to draw
   * dimensions over.
   */
  hatch?(c: CanvasRenderingContext2D, size: number): void;
  /** Centimetres one hatch repeat covers. Defaults to `tileCm`. */
  hatchCm?: number;
}

/** Parallel lines at `deg`, spaced `gap` px. The workhorse of plan hatching. */
export function hatchLines(c: CanvasRenderingContext2D, size: number, deg: number, gap: number, w = 1) {
  c.save();
  c.translate(size / 2, size / 2);
  c.rotate(deg * Math.PI / 180);
  c.strokeStyle = '#000'; c.lineWidth = w;
  const r = size;   // over-length so the rotation still covers the corners
  for (let x = -r; x <= r; x += gap) { c.beginPath(); c.moveTo(x, -r); c.lineTo(x, r); c.stroke(); }
  c.restore();
}

/** A rectangular grid, optionally offset every other row (brick bond). */
export function hatchGrid(c: CanvasRenderingContext2D, size: number, cols: number, rows: number, offset: boolean, w = 1) {
  c.strokeStyle = '#000'; c.lineWidth = w;
  const cw = size / cols, ch = size / rows;
  for (let j = 0; j <= rows; j++) { c.beginPath(); c.moveTo(0, j * ch); c.lineTo(size, j * ch); c.stroke(); }
  for (let j = 0; j < rows; j++) {
    const off = offset && j % 2 ? cw / 2 : 0;
    for (let i = 0; i <= cols; i++) {
      const x = i * cw + off;
      c.beginPath(); c.moveTo(x, j * ch); c.lineTo(x, (j + 1) * ch); c.stroke();
    }
  }
}

/** Scattered dots — stone, terrazzo, concrete. */
export function hatchStipple(c: CanvasRenderingContext2D, size: number, n: number, seed: number, rad = 1.2) {
  const r = rng(seed);
  c.fillStyle = '#000';
  for (let i = 0; i < n; i++) {
    c.beginPath(); c.arc(r() * size, r() * size, rad * (0.5 + r()), 0, 6.29); c.fill();
  }
}

// ---------------------------------------------------------------- randomness

/**
 * A small deterministic generator (mulberry32).
 *
 * Seeded from the material id, so a floor looks the same on every load, on
 * every machine, and in every test. The previous textures used Math.random()
 * and quietly re-grained themselves on each refresh — harmless to look at,
 * impossible to assert anything about.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, so `rng(hash(id))` is reproducible. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- normals

/**
 * A tangent-space normal map from a greyscale height field.
 *
 * Both inputs and outputs are RGBA byte arrays of `size × size`. The height is
 * read from the red channel; the result encodes the surface normal as
 * `(n + 1) / 2` in RGB, which is the convention three.js expects.
 *
 * Sampling wraps, because these textures tile: computing the slope at the last
 * column against a clamped edge instead of against the first column leaves a
 * seam that is invisible on the texture and glaringly visible on a floor.
 *
 * The sign convention is the part worth stating, because getting it wrong
 * still produces a perfectly plausible-looking normal map — every bump simply
 * becomes a dent, and it reads as "the lighting is a bit odd" rather than as a
 * bug. Here a *brighter* neighbour to the right means the surface rises towards
 * +x, so the normal tilts towards −x: `nx = -(right - left)`. Y is flipped
 * again on top of that because image rows run downwards while the texture's V
 * axis runs up.
 */
export function heightToNormal(
  height: Uint8ClampedArray, size: number, strength = 1,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => {
    const xx = ((x % size) + size) % size;
    const yy = ((y % size) + size) % size;
    return height[(yy * size + xx) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // The unnormalised normal of the height field z = h(x, y).
      let nx = -dx, ny = dy, nz = 1 / 8;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- helpers

const shade = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: number) => {
  c.fillStyle = `rgba(0,0,0,${a})`;
  c.fillRect(x, y, w, h);
};

/** Fine speckle, so a flat fill does not read as plastic. */
function grain(c: CanvasRenderingContext2D, size: number, rnd: () => number, amount: number) {
  for (let i = 0; i < size * size * amount; i++) {
    const v = rnd();
    c.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.16})` : `rgba(0,0,0,${(0.5 - v) * 0.16})`;
    c.fillRect(rnd() * size, rnd() * size, 1, 1);
  }
}

/** Planks running along X, with seams. Shared by the wood floors. */
function planks(
  c: CanvasRenderingContext2D, size: number, rnd: () => number,
  tones: string[], count: number, grainAlpha: number,
) {
  const ph = size / count;
  for (let i = 0; i < count; i++) {
    const y = i * ph;
    c.fillStyle = tones[Math.floor(rnd() * tones.length)];
    c.fillRect(0, y, size, ph);
    // Stagger the butt joints; a floor whose planks all end in line is a deck.
    const joint = rnd() * size;
    shade(c, 0, y, size, 1.5, 0.30);                       // seam above
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, y + 1.5, size, 1);                        // light catch below it
    shade(c, joint, y, 1.5, ph, 0.22);                      // butt joint
    c.strokeStyle = `rgba(70,45,22,${grainAlpha})`;
    c.lineWidth = 1;
    for (let g = 0; g < 14; g++) {
      const gy = y + rnd() * ph;
      c.beginPath();
      c.moveTo(0, gy);
      c.bezierCurveTo(size * 0.3, gy + rnd() * 5 - 2.5, size * 0.6, gy + rnd() * 5 - 2.5, size, gy + rnd() * 3 - 1.5);
      c.stroke();
    }
  }
}

/** A regular grid of units with grout between them. Shared by tile/brick/stone. */
function grid(
  c: CanvasRenderingContext2D, size: number, rnd: () => number,
  cols: number, rows: number, offsetEveryOtherRow: boolean,
  face: (i: number, j: number) => string, groutColor: string, grout: number,
) {
  c.fillStyle = groutColor;
  c.fillRect(0, 0, size, size);
  const w = size / cols, h = size / rows;
  for (let j = 0; j < rows; j++) {
    const off = offsetEveryOtherRow && j % 2 ? w / 2 : 0;
    // Draw one extra unit and rely on the wrap: a half unit at the edge has to
    // come back at the other side or the offset rows leave a gap on the seam.
    for (let i = -1; i <= cols; i++) {
      const x = i * w + off, y = j * h;
      c.fillStyle = face(i, j);
      c.fillRect(x + grout / 2, y + grout / 2, w - grout, h - grout);
      c.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.05})`;
      c.fillRect(x + grout, y + grout, w - grout * 2, h - grout * 2);
    }
  }
}

/**
 * Where each plank of a herringbone goes, on a grid of `cells` square units.
 *
 * A plank is two units long and one wide, and the pattern has to cover every
 * unit exactly once *and* wrap, or the floor grows gaps and a seam. The rule is
 * `(i + j) mod 4`: 0 starts a horizontal plank, 2 starts a vertical one, and
 * 1 and 3 are the far halves of planks started elsewhere. It closes on itself
 * every 4 units, so any multiple of 4 tiles seamlessly.
 *
 * The first attempt rotated each cell about its own corner independently, which
 * produced a plausible-looking lattice of overlapping sticks with gaps between
 * them — recognisably "a wood floor", just not the one anyone laid.
 */
export function herringbonePlanks(cells: number): { i: number; j: number; horizontal: boolean }[] {
  const out: { i: number; j: number; horizontal: boolean }[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const s = ((i + j) % 4 + 4) % 4;
      if (s === 0) out.push({ i, j, horizontal: true });
      else if (s === 2) out.push({ i, j, horizontal: false });
    }
  }
  return out;
}

/** Which units a plank covers, wrapped into the grid. */
export function plankCells(p: { i: number; j: number; horizontal: boolean }, cells: number): [number, number][] {
  const w = (n: number) => ((n % cells) + cells) % cells;
  return p.horizontal
    ? [[w(p.i), w(p.j)], [w(p.i + 1), w(p.j)]]
    : [[w(p.i), w(p.j)], [w(p.i), w(p.j + 1)]];
}

const mix = (a: string, b: string, t: number) => {
  const p = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const q = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${q(ar, br)},${q(ag, bg)},${q(ab, bb)})`;
};

// ---------------------------------------------------------------- the library

export const MATERIALS: MaterialDef[] = [
  {
    id: 'wood', label: '橡木地板', category: 'floor', tileCm: 240,
    roughness: 0.68, metalness: 0, swatch: '#b08454', bump: 1.6,
    albedo(c, s, r) {
      planks(c, s, r, ['#b98a54', '#a9784a', '#9a6b3f', '#b0895e', '#c0925f'], 5, 0.22);
      grain(c, s, r, 0.35);
    },
    height(c, s, r) {
      c.fillStyle = '#bbb'; c.fillRect(0, 0, s, s);
      const ph = s / 5;
      for (let i = 0; i < 5; i++) {
        c.fillStyle = '#202020'; c.fillRect(0, i * ph, s, 2);         // seams sit low
        c.fillStyle = '#303030'; c.fillRect(r() * s, i * ph, 2, ph);
      }
    },
    hatch(c, s) { hatchLines(c, s, 0, s / 6); },
    hatchCm: 180,
  },
  {
    id: 'walnut', label: '胡桃木地板', category: 'floor', tileCm: 240,
    roughness: 0.55, metalness: 0, swatch: '#6b4630', bump: 1.6,
    albedo(c, s, r) {
      planks(c, s, r, ['#6f4a33', '#5e3d2a', '#7a5238', '#67432e'], 5, 0.30);
      grain(c, s, r, 0.3);
    },
    height(c, s, r) {
      c.fillStyle = '#bbb'; c.fillRect(0, 0, s, s);
      const ph = s / 5;
      for (let i = 0; i < 5; i++) { c.fillStyle = '#1e1e1e'; c.fillRect(0, i * ph, s, 2); c.fillStyle = '#2c2c2c'; c.fillRect(r() * s, i * ph, 2, ph); }
    },
    hatch(c, s) { hatchLines(c, s, 0, s / 6); },
    hatchCm: 180,
  },
  {
    id: 'herringbone', label: '人字拼木', category: 'floor', tileCm: 160,
    roughness: 0.6, metalness: 0, swatch: '#a87a4c', bump: 1.5,
    albedo(c, s, r) {
      c.fillStyle = '#6f5030'; c.fillRect(0, 0, s, s);      // the gaps read as shadow
      const cells = 8, u = s / cells, gap = 1.2;
      const tones = ['#b0824f', '#a2764a', '#bb8d58', '#a97e4e'];
      for (const p of herringbonePlanks(cells)) {
        const w = p.horizontal ? u * 2 : u, h = p.horizontal ? u : u * 2;
        c.fillStyle = tones[Math.floor(r() * tones.length)];
        // Draw the wrapped copy too, so a plank crossing the edge comes back on
        // the other side instead of being clipped away.
        for (const [dx, dy] of [[0, 0], [-s, 0], [0, -s], [-s, -s]] as const) {
          c.fillRect(p.i * u + gap + dx, p.j * u + gap + dy, w - gap * 2, h - gap * 2);
        }
      }
      grain(c, s, r, 0.3);
    },
    height(c, s) {
      c.fillStyle = '#202020'; c.fillRect(0, 0, s, s);
      const cells = 8, u = s / cells, gap = 1.2;
      c.fillStyle = '#d8d8d8';
      for (const p of herringbonePlanks(cells)) {
        const w = p.horizontal ? u * 2 : u, h = p.horizontal ? u : u * 2;
        for (const [dx, dy] of [[0, 0], [-s, 0], [0, -s], [-s, -s]] as const) {
          c.fillRect(p.i * u + gap + dx, p.j * u + gap + dy, w - gap * 2, h - gap * 2);
        }
      }
    },
    hatch(c, s) { hatchLines(c, s, 45, s / 5); hatchLines(c, s, -45, s / 5); },
    hatchCm: 120,
  },
  {
    id: 'tile', label: '拋光石英磚', category: 'floor', tileCm: 240,
    roughness: 0.22, metalness: 0.02, swatch: '#dfe6ec', bump: 2.4,
    albedo(c, s, r) {
      grid(c, s, r, 4, 4, false, () => mix('#dfe6ec', '#c9d3dc', r() * 0.5), '#a9b4bf', 6);
      grain(c, s, r, 0.12);
    },
    height(c, s, r) {
      grid(c, s, r, 4, 4, false, () => '#e8e8e8', '#1a1a1a', 6);
    },
    hatch(c, s) { hatchGrid(c, s, 2, 2, false); },
    hatchCm: 120,
  },
  {
    id: 'marble', label: '大理石', category: 'floor', tileCm: 300,
    roughness: 0.16, metalness: 0.03, swatch: '#eceff2', bump: 0.8,
    albedo(c, s, r) {
      c.fillStyle = '#eef1f4'; c.fillRect(0, 0, s, s);
      for (let v = 0; v < 26; v++) {
        c.strokeStyle = `rgba(120,130,145,${0.05 + r() * 0.16})`;
        c.lineWidth = 0.6 + r() * 2.4;
        c.beginPath();
        let x = -10, y = r() * s;
        c.moveTo(x, y);
        while (x < s + 10) { x += 12 + r() * 26; y += (r() - 0.5) * 34; c.lineTo(x, y); }
        c.stroke();
      }
      grain(c, s, r, 0.1);
    },
    height(c, s, r) { c.fillStyle = '#808080'; c.fillRect(0, 0, s, s); grain(c, s, r, 0.5); },
    hatch(c, s) { hatchLines(c, s, 20, s / 2, 1.4); },
    hatchCm: 300,
  },
  {
    id: 'terrazzo', label: '磨石子', category: 'floor', tileCm: 200,
    roughness: 0.3, metalness: 0.02, swatch: '#e4e1da', bump: 0.8,
    albedo(c, s, r) {
      c.fillStyle = '#e6e3dc'; c.fillRect(0, 0, s, s);
      const cols = ['#8d8f93', '#b9a48b', '#6f7b6a', '#c9c2b4', '#a8524a'];
      for (let i = 0; i < 420; i++) {
        c.fillStyle = cols[Math.floor(r() * cols.length)];
        c.globalAlpha = 0.55 + r() * 0.4;
        c.beginPath();
        const x = r() * s, y = r() * s, rad = 1.2 + r() * 4.5;
        c.ellipse(x, y, rad, rad * (0.5 + r() * 0.7), r() * Math.PI, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    },
    hatch(c, s) { hatchStipple(c, s, 90, 11); },
    hatchCm: 120,
  },
  {
    id: 'carpet', label: '地毯', category: 'floor', tileCm: 120,
    roughness: 0.98, metalness: 0, swatch: '#8d8579', bump: 2.2,
    albedo(c, s, r) {
      c.fillStyle = '#8d8579'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < s * s * 0.9; i++) {
        const v = r();
        c.fillStyle = v > 0.5 ? `rgba(255,250,240,${(v - 0.5) * 0.5})` : `rgba(20,16,10,${(0.5 - v) * 0.5})`;
        c.fillRect(r() * s, r() * s, 1, 1 + r());
      }
    },
    height(c, s, r) { c.fillStyle = '#888'; c.fillRect(0, 0, s, s); grain(c, s, r, 2.4); },
    hatch(c, s) { hatchStipple(c, s, 260, 23, 0.7); },
    hatchCm: 60,
  },
  {
    id: 'concrete', label: '水泥粉光', category: 'floor', tileCm: 400,
    roughness: 0.85, metalness: 0, swatch: '#a8a8a4', bump: 0.9,
    albedo(c, s, r) {
      c.fillStyle = '#a9a9a5'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        c.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '60,60,60'},${0.02 + r() * 0.06})`;
        const x = r() * s, y = r() * s, rad = 8 + r() * 48;
        c.beginPath(); c.ellipse(x, y, rad, rad * (0.4 + r() * 0.8), r() * 3.14, 0, 6.29); c.fill();
      }
      grain(c, s, r, 0.7);
    },
    height(c, s, r) { c.fillStyle = '#888'; c.fillRect(0, 0, s, s); grain(c, s, r, 1.1); },
    hatch(c, s) { hatchStipple(c, s, 40, 31, 1.6); },
    hatchCm: 200,
  },

  // ---- walls ----
  {
    id: 'paint', label: '乳膠漆', category: 'wall', tileCm: 400,
    roughness: 0.94, metalness: 0, swatch: '#eceff4', bump: 0.35,
    albedo(c, s, r) { c.fillStyle = '#eceff4'; c.fillRect(0, 0, s, s); grain(c, s, r, 0.25); },
    height(c, s, r) { c.fillStyle = '#888'; c.fillRect(0, 0, s, s); grain(c, s, r, 0.8); },
    hatch(c, s) { hatchLines(c, s, 45, s / 3); },
    hatchCm: 200,
  },
  {
    id: 'plaster', label: '藝術塗料', category: 'wall', tileCm: 300,
    roughness: 0.9, metalness: 0, swatch: '#e3ddd2', bump: 1.4,
    albedo(c, s, r) {
      c.fillStyle = '#e4ded3'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 160; i++) {
        c.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '120,110,95'},${0.04 + r() * 0.10})`;
        c.save(); c.translate(r() * s, r() * s); c.rotate(r() * 3.14);
        c.fillRect(-14 - r() * 20, -3, 28 + r() * 40, 5 + r() * 5); c.restore();
      }
    },
    height(c, s, r) {
      c.fillStyle = '#888'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 160; i++) {
        c.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},0.16)`;
        c.save(); c.translate(r() * s, r() * s); c.rotate(r() * 3.14);
        c.fillRect(-14 - r() * 20, -3, 28 + r() * 40, 5 + r() * 5); c.restore();
      }
    },
    hatch(c, s) { hatchLines(c, s, 45, s / 4); hatchLines(c, s, -45, s / 4); },
    hatchCm: 200,
  },
  {
    // 3 across and 10 down over a 64 cm patch puts a brick at about 21 × 6 cm,
    // which is what one actually is. The first pass was 4 × 8 over 200 cm — a
    // 50 × 25 cm brick, which still reads as brickwork until you stand a door
    // next to it and the wall turns out to be three bricks tall.
    id: 'brick', label: '文化石', category: 'wall', tileCm: 64,
    roughness: 0.92, metalness: 0, swatch: '#b1705a', bump: 3.2,
    albedo(c, s, r) {
      grid(c, s, r, 3, 10, true, () => mix('#b8735c', '#8f5442', r()), '#d8d2c8', 4);
      grain(c, s, r, 0.5);
    },
    height(c, s, r) { grid(c, s, r, 3, 10, true, () => '#e0e0e0', '#141414', 4); },
    hatch(c, s) { hatchGrid(c, s, 2, 6, true); },
    hatchCm: 128,
  },
  {
    id: 'walltile', label: '壁磚', category: 'wall', tileCm: 120,
    roughness: 0.2, metalness: 0.02, swatch: '#e7eef2', bump: 2.6,
    albedo(c, s, r) { grid(c, s, r, 4, 8, true, () => mix('#eef4f7', '#d5e0e6', r() * 0.6), '#b6c0c7', 5); },
    height(c, s, r) { grid(c, s, r, 4, 8, true, () => '#e8e8e8', '#181818', 5); },
    hatch(c, s) { hatchGrid(c, s, 2, 4, true); },
    hatchCm: 120,
  },
  {
    id: 'wallpaper', label: '壁紙', category: 'wall', tileCm: 100,
    roughness: 0.86, metalness: 0, swatch: '#dfe3e0', bump: 0.9,
    albedo(c, s, r) {
      c.fillStyle = '#e1e5e2'; c.fillRect(0, 0, s, s);
      c.strokeStyle = 'rgba(150,160,155,0.35)'; c.lineWidth = 1;
      for (let x = 0; x < s; x += 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, s); c.stroke(); }
      grain(c, s, r, 0.3);
    },
    height(c, s) {
      c.fillStyle = '#888'; c.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 8) { c.fillStyle = '#b8b8b8'; c.fillRect(x, 0, 3, s); }
    },
    hatch(c, s) { hatchLines(c, s, 90, s / 5); },
    hatchCm: 100,
  },
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

/** Look one up. Unknown ids fall back to the first of their category. */
export function material(id: string | undefined, category: Category): MaterialDef {
  const m = id ? BY_ID.get(id) : undefined;
  if (m && m.category === category) return m;
  return MATERIALS.find((x) => x.category === category)!;
}

export const floorMaterials = () => MATERIALS.filter((m) => m.category === 'floor');
export const wallMaterials = () => MATERIALS.filter((m) => m.category === 'wall');

/**
 * How many times a material repeats across a surface of the given size (cm).
 *
 * Never below 1: a repeat of 0 leaves the texture stretched over the whole
 * surface, which on a 6 m floor turns four tiles into four enormous slabs and
 * still looks like a floor, just the wrong one.
 */
export function repeatFor(def: MaterialDef, wCm: number, hCm: number): [number, number] {
  return [
    Math.max(1, Math.round(wCm / def.tileCm)),
    Math.max(1, Math.round(hCm / def.tileCm)),
  ];
}
