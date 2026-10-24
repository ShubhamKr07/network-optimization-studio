// E4.1 — single palette shared by the map (route/marker colors) and the
// results panel's band-coverage bars, so a given band index always means
// the same color everywhere. Index-based, not tied to any model.
// Bundle 3 (T10) — colors live at :root as --band-0..4 (index.css); this
// array is CSS-var references, not literal hex, so --band-N stays the
// single source of truth for every consumer (SVG stroke/fill attrs and
// inline `style` both accept `var()` since they render in-document).
import { OVERFLOW_BAND } from "@/lib/bands";

export const BAND_COLORS = ["var(--band-0)", "var(--band-1)", "var(--band-2)", "var(--band-3)", "var(--band-4)"];

// jade-A1 — distinct color for OVERFLOW_BAND (lib/bands.ts), a lane/edge
// beyond the highest configured boundary. Kept as its own CSS-var reference
// (index.css) rather than a 6th BAND_COLORS entry, so BAND_COLORS stays
// exactly the 5-entry near→far ramp (0..4) and the overflow sentinel is
// handled explicitly below instead of silently clamping into it.
export const OVERFLOW_BAND_COLOR = "var(--band-overflow)";

// DU-1.2 (spec §5.1.1) — per-band stroke pattern, index-aligned with
// BAND_COLORS, so band identity never rests on colour alone (WCAG 1.4.1).
// Leaflet/SVG `dashArray` strings; undefined = solid. Overflow stays solid
// (its violet hue is already categorically distinct from the olive ramp).
export const BAND_DASH: readonly (string | undefined)[] = [undefined, "10 4", "6 4", "2 4", "8 3 2 3"];

export function getBandDash(index: number): string | undefined {
  if (index === OVERFLOW_BAND) return undefined;
  return BAND_DASH[Math.min(index, BAND_DASH.length - 1)];
}

export function getBandColor(index: number): string {
  if (index === OVERFLOW_BAND) return OVERFLOW_BAND_COLOR;
  return BAND_COLORS[Math.min(index, BAND_COLORS.length - 1)] ?? BAND_COLORS[0];
}
