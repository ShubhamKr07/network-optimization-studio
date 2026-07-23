// E4.1 — single palette shared by the map (route/marker colors) and the
// results panel's band-coverage bars, so a given band index always means
// the same color everywhere. Index-based, not tied to any model.
export const BAND_COLORS = ["#16A34A", "#84CC16", "#F59E0B", "#EF4444", "#DC2626"];

export function getBandColor(index: number): string {
  return BAND_COLORS[Math.min(index, BAND_COLORS.length - 1)] ?? BAND_COLORS[0];
}
