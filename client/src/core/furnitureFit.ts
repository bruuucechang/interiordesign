// The arithmetic and matching behind furniture3d that three.js is not needed
// for: which surface a material name means, how a model is stretched onto its
// footprint, and the cache key. Each goes wrong without an error — a plain
// colour where a scan belonged, a cabinet 54 cm wide that says 180 — so they
// are kept where a test can reach them.

/**
 * Kenney's models ship with no textures at all: a flat base colour per material,
 * `roughnessFactor: 1`, `metallicFactor: 0`, no normal map. That is why half the
 * palette looked untextured next to the photogrammetry — it *was*.
 *
 * What they do ship is **semantic material names** — `wood`, `woodDark`, `metal`,
 * `metalLight`, `metalDark`, `carpet`, `glass`, `lamp` — so each one can be
 * matched to the same archetype the procedural furniture uses. Their UVs are
 * real (tens of units across a cabinet, so `repeat` is given directly rather
 * than derived from centimetres), which is what makes a tiling scan work here
 * at all.
 *
 * **Wood takes the scan's colour; nothing else does.** The first version took no
 * colour anywhere, on the reasoning that Kenney's palette is the design. For a
 * white fridge or a pink duvet that is right — repainting them beige would throw
 * the model away. For the cabinets it was plainly wrong: a normal map on a flat
 * tan face is a faint ripple and nothing more, so the wardrobe, the TV cabinet
 * and the storage cabinet still read as untextured, which is what they were
 * reported as. Wood is the one case where the colour *is* the material.
 *
 * Roughness and metalness are set **after** the scan, not before: `applyScan`
 * forces `roughness = 1` when it attaches a roughness map, because with a map
 * the value is a multiplier. Setting them first meant a fridge stayed at
 * roughness 1 — matte plastic — no matter what was attached to it.
 */
// Quaternius is the same situation and the same fix, with two differences worth
// keeping in mind. Its names are not prefixes — `DarkWood`, `Wood1`, `Wood2`
// only match anchored patterns by accident — so these are substring tests.
// And it names upholstery by the *object* rather than the material
// (`Comforter`, `PillowCover`, `Mattress`), which all want the same weave.
export const FLAT_ARCHETYPES: { re: RegExp; scan?: string; colour?: boolean; rough: number; metal: number; repeat: number }[] = [
  { re: /wood/i,                        scan: 'veneer_oak',    colour: true,  rough: 0.62, metal: 0,    repeat: 0.03 },
  { re: /metal|steel|chrome/i,          scan: 'metal_brushed', colour: false, rough: 0.33, metal: 0.85, repeat: 0.06 },
  { re: /carpet|rug/i,                  scan: 'weave',         colour: false, rough: 0.95, metal: 0,    repeat: 0.10 },
  { re: /comforter|pillow|mattress|cushion|fabric|cloth|sofa|couch/i,
                                        scan: 'weave',         colour: false, rough: 1,    metal: 0,    repeat: 0.08 },
  { re: /leather/i,                     scan: 'leather',       colour: false, rough: 0.45, metal: 0,    repeat: 0.04 },
  { re: /glass|mirror/i,                                                      rough: 0.05, metal: 0,    repeat: 1 },
  // `^light$` 是燈罩不是燈泡。Quaternius 把整個罩體叫 `Light`（立燈 60 面、
  // 水晶吊燈 240 面），拿它當發光體就會有五盞燈整片純色。真正不該貼圖的是
  // bulb/emissive 那條。順序也有意義：`LightMetal` 不會被 `^light$` 吃掉，
  // 會往下落到金屬。
  { re: /lamp|shade|^light$/i,          scan: 'linen',         colour: false, rough: 0.9,  metal: 0,    repeat: 0.05 },
  // `\b` 不是裝飾。Quaternius 用顏色命名材質，於是 `LightOrange` 撞上 /light/
  // 被當成燈具——燈具那條刻意不貼圖，所以那張地毯就永遠是純色的。
  { re: /bulb|emissive|glow/i,                                                rough: 0.35, metal: 0.15, repeat: 1 },
  { re: /plant|leaf|foliage/i,          scan: 'rattan',        colour: false, rough: 0.55, metal: 0,    repeat: 0.02 },
  { re: /plastic/i,                     scan: 'beige',         colour: false, rough: 0.4,  metal: 0,    repeat: 0.02 },
  // 保底。Kenney 的模型有幾個 mesh 根本沒有具名材質（glTF 給的是 `_defaultMat`），
  // 沒有這一條它們就永遠留白——實測是水槽、馬桶、洗衣機、抽油煙機、圓形淋浴間、
  // 抽屜邊几六件。噴漆表面是最不會說謊的預設：它只加極細的起伏，不加木紋也不加
  // 織紋，而那六件在現實裡確實都是烤漆或塑料面板。
  { re: /./,                            scan: 'beige',         colour: false, rough: 0.5,  metal: 0,    repeat: 0.02 },
];

export type FlatArchetype = (typeof FLAT_ARCHETYPES)[number];

/** The archetype for a material (or node) name. The last row catches any non-empty name; an empty one gets nothing. */
export function archetypeFor(name: string | undefined): FlatArchetype | undefined {
  return FLAT_ARCHETYPES.find((k) => k.re.test(name ?? ''));
}

/**
 * Scale a model's natural size onto the object's footprint: each plan axis
 * exactly, height by the smaller of the two so stretching never makes a piece
 * taller. The reasoning is on the call in furniture3d's buildFurniture.
 */
export function footprintScale(natural: { x: number; z: number }, w: number, h: number) {
  const kx = w / (natural.x || 1);
  const kz = h / (natural.z || 1);
  return { x: kx, y: Math.min(kx, kz), z: kz };
}

/**
 * One cache entry per item and whole-centimetre size. The `item|` prefix is
 * what loadFurnitureModel clears when a scan lands, so it has to stay first.
 */
export const modelKey = (item: string, w: number, h: number) => `${item}|${Math.round(w)}|${Math.round(h)}`;
