export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

const EDGE = 4;

/** DU-3.2 — card top-left near `anchor` (the MARKER's container point) inside `container`, never intersecting the
 *  marker's `markerSize` px square (centred on anchor) grown by `gap`. Preference: right-below, left-below,
 *  right-above, left-above; if none fits, the candidate with the least overlap, clamped to 4px. */
export function placeCard(anchor: Point, card: Size, container: Size, markerSize: number, gap = 24):
  { left: number; top: number; flippedX: boolean; flippedY: boolean } {
  const reach = markerSize / 2 + gap;
  const keep = { l: anchor.x - reach, t: anchor.y - reach, r: anchor.x + reach, b: anchor.y + reach };
  const maxLeft = container.width - card.width - EDGE;
  const maxTop = container.height - card.height - EDGE;
  const candidates = [
    { flippedX: false, flippedY: false },
    { flippedX: true, flippedY: false },
    { flippedX: false, flippedY: true },
    { flippedX: true, flippedY: true },
  ].map((c) => {
    const left = c.flippedX ? keep.l - card.width : keep.r;
    const top = c.flippedY ? keep.t - card.height : keep.b;
    const fits = left >= EDGE && left <= maxLeft && top >= EDGE && top <= maxTop;
    const cl = Math.max(EDGE, Math.min(left, maxLeft));
    const ct = Math.max(EDGE, Math.min(top, maxTop));
    const ox = Math.max(0, Math.min(cl + card.width, keep.r) - Math.max(cl, keep.l));
    const oy = Math.max(0, Math.min(ct + card.height, keep.b) - Math.max(ct, keep.t));
    return { ...c, left: cl, top: ct, fits, overlap: ox * oy };
  });
  const best = candidates.find((c) => c.fits) ?? candidates.reduce((a, b) => (b.overlap < a.overlap ? b : a));
  return { left: best.left, top: best.top, flippedX: best.flippedX, flippedY: best.flippedY };
}
