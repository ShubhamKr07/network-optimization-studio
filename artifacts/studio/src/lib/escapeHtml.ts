const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape for interpolation into an HTML string (Leaflet popup content is parsed as HTML). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => MAP[c]);
}
