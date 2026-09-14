// jade-T13 — shared map leg palette. Two-echelon models (two-echelon-gold-au,
// two-echelon-jade-us) tag each result edge with a `leg` so the map can style
// each echelon differently. This module is the SINGLE place that classifies
// a leg string into a color — NetworkMap.tsx (and any future consumer) must
// call getLegColor() rather than re-implementing a per-leg or per-model
// ternary (the recurring bug class documented in
// docs/model-integration-precheck.md's Gate 1/6/6.5: a shared allowlist
// extended for one model but forgotten for a sibling).
//
// Colors are classified by SEMANTIC ROLE (source->facility "inbound" vs
// facility->demand "outbound"), not by literal leg string, per the design
// spec's §4 "All edge consumers must classify semantic legs rather than
// recognize only the Chapter-10 strings." JADE's plant_to_warehouse shares
// mine_to_refinery's color (both are the first/inbound leg of a two-echelon
// model) and warehouse_to_customer shares refinery_to_customer's color (both
// are the second/outbound leg) — this generalizes to a hypothetical 3rd
// two-echelon model with zero new color decisions, and keeps a single map
// render visually consistent regardless of which two-echelon model produced
// the result (only one model's edges are ever shown at a time).
const INBOUND_LEGS = new Set(["mine_to_refinery", "plant_to_warehouse"]);
const OUTBOUND_LEGS = new Set(["refinery_to_customer", "warehouse_to_customer"]);

// Gate 6 (unknown-leg neutral fallback): a leg value that is neither a known
// inbound nor outbound leg (e.g. a future/typo'd string) must render as this
// neutral gray rather than throwing or silently matching the wrong role.
// Reuses the existing --map-default-stroke token (already the "no special
// meaning" stroke color for a potential/unselected warehouse marker) instead
// of introducing a new CSS custom property for this standalone task.
export const NEUTRAL_LEG_COLOR = "var(--map-default-stroke)";

export const INBOUND_LEG_COLOR = "var(--map-warehouse-open)";
export const OUTBOUND_LEG_COLOR = "var(--danger)";

/**
 * Resolves an edge's `leg` to a route color.
 * - Absent/null/undefined leg (every single-echelon model) returns `undefined`
 *   so the caller falls back to its own distance-band coloring — this is NOT
 *   the "unknown leg" neutral case, it's the normal no-leg-concept case.
 * - A recognized leg (mine_to_refinery/plant_to_warehouse = inbound,
 *   refinery_to_customer/warehouse_to_customer = outbound) returns the
 *   role's color.
 * - Any other non-empty string (unknown/future leg value) returns the
 *   neutral fallback color rather than throwing.
 */
export function getLegColor(leg: string | null | undefined): string | undefined {
  if (leg == null || leg === "") return undefined;
  if (INBOUND_LEGS.has(leg)) return INBOUND_LEG_COLOR;
  if (OUTBOUND_LEGS.has(leg)) return OUTBOUND_LEG_COLOR;
  return NEUTRAL_LEG_COLOR;
}

/** Whether a leg is the first/"inbound" (source->facility) echelon. */
export function isInboundLeg(leg: string | null | undefined): boolean {
  return leg != null && INBOUND_LEGS.has(leg);
}

/** Whether a leg is the second/"outbound" (facility->demand) echelon. */
export function isOutboundLeg(leg: string | null | undefined): boolean {
  return leg != null && OUTBOUND_LEGS.has(leg);
}
