// Where the camera goes when the first room on a floor closes (B24).
//
// Starting from nothing, people draw a room at whatever zoom the blank sheet
// opened at, and it usually ends up a small box in a big dark pane — too small
// to place furniture into comfortably. So the first time a floor gets a room,
// and only then, the view eases in until the room fills about half of it.
// Never afterwards: a camera that keeps moving by itself is one you cannot
// trust to stay where you put it.

export interface Box { x: number; y: number; w: number; h: number }
export interface View { scale: number; origin: { x: number; y: number }; width: number; height: number }

/** Below this share of the pane, the room is "too small" and gets framed. */
export const SMALL_ROOM = 0.3;
/** The share of the pane the room fills afterwards (by area, roughly). */
export const FRAMED_ROOM = 0.5;

/**
 * The view that frames `room`, or null when it already fills enough of the pane
 * (or the pane has no size yet). The room is centred and scaled so its bounding
 * box covers about FRAMED_ROOM of the pane's area, never past what fits.
 */
export function firstRoomView(room: Box, v: View, minScale = 0.05, maxScale = 6): View['origin'] & { scale: number } | null {
  if (v.width <= 0 || v.height <= 0 || room.w <= 0 || room.h <= 0) return null;
  const share = (room.w * room.h * v.scale * v.scale) / (v.width * v.height);
  if (share >= SMALL_ROOM) return null;
  // Area share s² · w·h / (W·H) = FRAMED_ROOM, capped so the long side still fits with a margin.
  const byArea = Math.sqrt(FRAMED_ROOM * v.width * v.height / (room.w * room.h));
  const byFit = 0.9 * Math.min(v.width / room.w, v.height / room.h);
  const scale = Math.max(minScale, Math.min(maxScale, byArea, byFit));
  if (scale <= v.scale) return null;   // framing would zoom out — leave it
  return {
    scale,
    x: room.x + room.w / 2 - v.width / 2 / scale,
    y: room.y + room.h / 2 - v.height / 2 / scale,
  };
}
