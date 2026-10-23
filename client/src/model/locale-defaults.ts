// The numbers this app assumes when nobody has said otherwise.
//
// Every one of them is a **Taiwanese residential** figure. That was invisible
// while there was one user in Taiwan, and it is the kind of thing that is very
// hard to discover from the outside: a 12 cm wall and a 280 cm ceiling are not
// wrong anywhere, they are just not right everywhere, and a plan drawn on them
// looks entirely plausible until somebody builds it.
//
// Collected here so that:
//
//   · they can be *named* in the interface as defaults rather than presented as
//     facts — a beginner cannot tell the difference otherwise;
//   · a second region is a table, not a search through six files.
//
// Not a settings screen. Changing the region is not implemented; what is
// implemented is saying which region the numbers came from, which is the part
// that stops somebody trusting them by accident.

export interface LocaleDefaults {
  /** Where these came from, shown to the user. */
  region: string;
  /** Interior partition wall, cm. */
  wallThickness: number;
  /** Storey height floor-to-floor, cm. */
  floorHeight: number;
  /** Wall height in the 3D view, cm. */
  wallHeight: number;
  /** Door leaf width / height, cm. */
  doorWidth: number;
  doorHeight: number;
  /** Window width and sill height, cm. */
  windowWidth: number;
  windowSill: number;
}

export const TAIWAN_RESIDENTIAL: LocaleDefaults = {
  region: '台灣住宅',
  wallThickness: 12,
  floorHeight: 280,
  wallHeight: 270,
  doorWidth: 90,
  doorHeight: 210,
  windowWidth: 120,
  windowSill: 90,
};

/** The set in force. One entry today; the point is that it is named. */
export const DEFAULTS = TAIWAN_RESIDENTIAL;

/**
 * How much room a person needs around things, in cm.
 *
 * Same rule as the table above, and for the same reason: **these are defaults,
 * not facts.** 70 cm beside a bed is what you need to get out of it, make it and
 * clean under it — in a Taiwanese flat. It is not a law, it is not the same in
 * a wheelchair-accessible home, and it is not the same for somebody who has
 * decided a 60 cm gap on one side is the price of a bigger bed. `core/health.ts`
 * reads these; the panel names them as 「台灣住宅的預設值，可以直接改」.
 *
 * They come from ordinary interior-design ergonomics — the figures in any
 * planning reference — not from a code or a standard, because building
 * regulations here have very little to say about furniture inside a dwelling.
 * Saying that plainly matters: a number presented as a regulation, that is not
 * one, is worse than no number.
 */
export interface ClearanceDefaults {
  /** Beside a bed, at least one side. */
  bedSide: number;
  /** To pull a dining chair out and sit down. */
  diningPullOut: number;
  /** Each side of a WC pan. */
  toiletSide: number;
  /** In front of a washbasin. */
  basinFront: number;
  /** In front of an appliance, so its door opens and things go in. */
  applianceFront: number;
  /** In front of a hinged wardrobe. */
  wardrobeFront: number;
}

export const TAIWAN_CLEARANCE: ClearanceDefaults = {
  bedSide: 70,
  diningPullOut: 60,
  toiletSide: 20,
  basinFront: 60,
  applianceFront: 60,
  wardrobeFront: 60,
};

export const CLEARANCE = TAIWAN_CLEARANCE;

/**
 * 某些東西**本身**小於這個尺寸就不好用了——跟「周圍要留多少」是兩件事。
 *
 * 分開命名而不是塞進 `ClearanceDefaults`，因為它們回答的不是同一個問題：淨距問
 * 「這件家具旁邊夠不夠人走」，這裡問「這件家具自己夠不夠人用」。混在一起的話，
 * 之後要調其中一個的人會分不出他在調哪一種。
 */
export interface MinimumSizes {
  /** 乾濕分離的短邊。再小連轉身都受限。 */
  showerShortSide: number;
  /** 短邊的舒適值——不是門檻，只拿來在訊息裡講「建議多少」。 */
  showerComfortable: number;
}

export const TAIWAN_MIN_SIZES: MinimumSizes = {
  showerShortSide: 80,
  showerComfortable: 90,
};

export const MIN_SIZES = TAIWAN_MIN_SIZES;

/**
 * 照度分析用的數字：區域要多亮、區域多大、燈離枕頭與櫃子多近算太近。
 *
 * 跟上面兩張表同一條規則——**預設值不是事實**。100 lux 的床面、300 lux 的書桌是
 * 一般住宅照明的建議值（各國的居家照度建議落在同一個量級），不是法規；30°／40° 的
 * 枕頭範圍、25 cm 的櫃子距離是原型（docs/lighting-prototype.html）用的經驗值。
 * `core/lightzones.ts` 與 `core/lightcheck.ts` 讀這裡。
 */
export interface LightingDefaults {
  /** 各區域需要的平均照度（lux）。 */
  bedLux: number;
  deskLux: number;
  cabinetLux: number;
  doorLux: number;
  /** 流理台面（量在檯面高度）、洗手台前（桌面高）要多亮。CNS 12112 廚房工作面 300～500、
   *  浴室 100～200 取下限；洗手台前比整間高一級，因為要看清楚臉（docs/lighting-plan.md「達標標準」）。 */
  counterLux: number;
  vanityLux: number;
  /** 洗手台前算多深的一塊（cm）。 */
  vanityDepth: number;
  /** 做到頂的櫃子前、門內側，各算多深的一塊（cm）。 */
  cabinetDepth: number;
  doorDepth: number;
  /** 枕頭在床頭往內幾公分、躺下時眼睛離地多高（cm）。 */
  pillowInset: number;
  pillowHeight: number;
  /** 從枕頭往上看，偏離正上方小於這個角度會直視／眼角看得到（度）。 */
  glareDirect: number;
  glareNear: number;
  /** 崁燈離做到頂的櫃子小於這個距離，光多半打在櫃頂（cm）。 */
  downlightToCabinet: number;
  /** 整間最暗 ÷ 平均低於這個值就提醒。 */
  uniformity: number;
}

export const TAIWAN_LIGHTING: LightingDefaults = {
  bedLux: 100,
  deskLux: 300,
  cabinetLux: 100,
  doorLux: 100,
  counterLux: 300,
  vanityLux: 200,
  vanityDepth: 60,
  cabinetDepth: 50,
  doorDepth: 80,
  pillowInset: 25,
  pillowHeight: 60,
  glareDirect: 30,
  glareNear: 40,
  downlightToCabinet: 25,
  uniformity: 0.4,
};

export const LIGHTING = TAIWAN_LIGHTING;

/**
 * A note for a field that is showing one of these.
 *
 * Deliberately says the region *and* that it is only a starting value. "12" on
 * its own reads as a property of walls; "台灣住宅的預設值，可以改" reads as a
 * choice somebody made for you.
 */
export function defaultNote(label: string, value: number, unit = 'cm'): string {
  return `${label} ${value}${unit} 是「${DEFAULTS.region}」的預設值，可以直接改`;
}
