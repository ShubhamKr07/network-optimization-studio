// E4.1 — single palette shared by the map (route/marker colors) and the
// results panel's band-coverage bars, so a given band index always means
// the same color everywhere. Index-based, not tied to any model.
// Bundle 3 (T10) — colors live at :root as --band-0..4 (index.css); this
// array is CSS-var references, not literal hex, so --band-N stays the
// single source of truth for every consumer (SVG stroke/fill attrs and
// inline `style` both accept `var()` since they render in-document).
export const BAND_COLORS = ["var(--band-0)", "var(--band-1)", "var(--band-2)", "var(--band-3)", "var(--band-4)"];

export function getBandColor(index: number): string {
  return BAND_COLORS[Math.min(index, BAND_COLORS.length - 1)] ?? BAND_COLORS[0];
}
