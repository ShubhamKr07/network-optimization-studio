import { useMemo } from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import { warehouseStatusPresentation, type WhStatus } from "./statusPresentation";
import { demandTone, makeQuintileRadius, type DemandTone, type MapWarehouse, type MapCustomer, type MapEntity } from "./types";

export interface EntityMarkersToggles {
  warehouses: boolean;
  customers: boolean;
  showInactive: boolean;
  /** T3 (Bundle 2.2, A2) — "Size customers by demand". Optional, default
   * `true` (today's quintile-scale behavior, unchanged) so every existing
   * caller/test literal that doesn't set this field keeps working. `false`
   * -> every demand-bearing marker (p-median/two-echelon customers,
   * transport-coal stations — this component has no per-model branching,
   * it's whatever's passed as `customers`) renders at a fixed radius
   * (`FIXED_CUSTOMER_RADIUS`) instead of the quintile scale. */
  sizeByDemand?: boolean;
}

/** A2 (Bundle 2.2) — the fixed OFF-state customer/station marker radius,
 * per the plan's Global Constraints (`FIXED_CUSTOMER_RADIUS = 6` px).
 * Exported so InputMapTab/MapLegend/tests share one literal. */
export const FIXED_CUSTOMER_RADIUS = 6;

export interface EntityMarkersProps {
  warehouses: MapWarehouse[];
  customers: MapCustomer[];
  toggles: EntityMarkersToggles;
  onLeftClick: (entity: MapEntity, e: L.LeafletMouseEvent) => void;
  onRightClick: (entity: MapEntity, e: L.LeafletMouseEvent) => void;
  onDragEnd: (entity: MapEntity, latlng: { lat: number; lng: number }) => void;
  draggableIds: Set<string>;
  /** Unused since R1's fast-follow (types.ts's demandTone is green for every
   * model now) — kept only so existing/future call sites that still pass a
   * modelId don't need to be touched. */
  modelId?: string;
}

// ── Pure SVG-string builders ────────────────────────────────────────────
// Exported directly (not just used internally) so their "always a string,
// never a React element" contract can be unit-tested without a DOM —
// L.divIcon's `html` option requires a raw string; a React element there
// silently stringifies to "[object Object]" instead of throwing.
//
// Bundle 3 (T10) — book-cover map-entity tokens (index.css's --map-*), not
// the old R3-era --accent-*/--demand-* pair. outline (Potential) uses the
// default ink stroke; filled (Fixed-Open, i.e. actually open) uses the
// warehouse-open green for both fill and stroke; dashed (Inactive) uses the
// inactive gray. All three are already COMPLETE colors (bare hex/HSL — see
// index.css's raw-token block), so they're consumed unwrapped as
// `var(--token)`, never re-wrapped in `hsl(...)`.
export function warehouseTriangleSvg(marker: "outline" | "filled" | "dashed"): string {
  const filled = marker === "filled";
  const dashed = marker === "dashed";
  const stroke = dashed ? "var(--map-inactive)" : filled ? "var(--map-warehouse-open)" : "var(--map-warehouse)";
  const fill = filled ? "var(--map-warehouse-open)" : "none";
  const dashAttr = dashed ? ' stroke-dasharray="4"' : "";
  return `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="12,2 22,20 2,20" fill="${fill}" stroke="${stroke}" stroke-width="2"${dashAttr} /></svg>`;
}

// Bundle 3 (T10) — demand bubbles are always the map-customer green/stroke
// pair now, regardless of `tone`: under book-cover, supply (ink warehouse
// triangles) vs demand (green customer bubbles) is already visually
// distinct, retiring the old --demand-*/--accent-* tone split. This is the
// exact pair NetworkMap's own customer markers and MapLegend's demand-bubble
// swatches use, so all three can never drift apart. `tone` stays a real
// parameter (unused for color) so existing call sites (MapLegend.tsx) don't
// need a signature change.
export function customerBubbleSvg(radiusPx: number, _tone: DemandTone = "blue"): string {
  const size = Math.ceil(radiusPx * 2) + 4;
  const center = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${center}" cy="${center}" r="${radiusPx}" fill="var(--map-customer)" fill-opacity="0.55" stroke="var(--map-customer-stroke)" stroke-width="1.5" /></svg>`;
}

// T4 (Bundle 2) — `status` is optional now: a role with `hasStatus: false`
// (transport-coal mines) never populates MapWarehouse.status at all. There
// is no meaningful "status" to color-code in that case, so it always
// renders the plain outline triangle (same shape as p-median-us's own
// "Potential" default) and carries no `status-*` class — a caller/test can
// tell "no status" apart from "active status" by the class's absence.
function warehouseIcon(status: WhStatus | undefined): L.DivIcon {
  const marker = status ? warehouseStatusPresentation[status].marker : "outline";
  const statusClass = status ? ` status-${status}` : "";
  return L.divIcon({
    html: warehouseTriangleSvg(marker),
    className: `wh-marker${statusClass} marker-${marker}`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function customerIcon(radius: number, excluded: boolean, tone: DemandTone): L.DivIcon {
  const size = Math.ceil(radius * 2) + 4;
  return L.divIcon({
    html: customerBubbleSvg(radius, tone),
    className: `cs-marker${excluded ? " cs-excluded" : ""}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Renders a Marker per warehouse/customer as an SVG divIcon — triangle
// style keyed off the shared statusPresentation, bubble radius off the
// shared R2 quintile scale (computed here, from this component's own full
// `customers` population — base + added + EXCLUDED, exactly what this prop
// already carries — so it never drifts from what's actually on the map).
// Inactive warehouses are skipped unless toggles.showInactive; an excluded
// customer still renders (dimmed via the cs-excluded class, still clickable,
// still sized by its own quintile bucket — not hidden or fixed-size) since
// the student can Edit it to un-exclude.
export function EntityMarkers({
  warehouses,
  customers,
  toggles,
  onLeftClick,
  onRightClick,
  onDragEnd,
  draggableIds,
  modelId = "p-median-us",
}: EntityMarkersProps) {
  const tone = demandTone(modelId);
  const scale = useMemo(() => makeQuintileRadius(customers.map((c) => c.demand)), [customers]);
  // T3 (Bundle 2.2, A2) — default true keeps today's behavior for every
  // existing `toggles` literal that doesn't set this field.
  const sizeByDemand = toggles.sizeByDemand ?? true;

  function bindEventHandlers(entity: MapEntity) {
    return {
      click: (e: L.LeafletMouseEvent) => onLeftClick(entity, e),
      contextmenu: (e: L.LeafletMouseEvent) => {
        // Marker's own contextmenu must not also bubble into the map's
        // empty-space "add here" contextmenu handler (T8 wires that on the
        // map container itself).
        L.DomEvent.stopPropagation(e);
        onRightClick(entity, e);
      },
      dragend: (e: L.DragEndEvent) => {
        const latlng = (e.target as L.Marker).getLatLng();
        onDragEnd(entity, { lat: latlng.lat, lng: latlng.lng });
      },
    };
  }

  return (
    <>
      {toggles.warehouses &&
        warehouses.map((wh) => {
          if (wh.status === "inactive" && !toggles.showInactive) return null;
          const entity: MapEntity = { kind: "wh", entity: wh };
          return (
            <Marker
              key={wh.id}
              position={[wh.lat, wh.lng]}
              icon={warehouseIcon(wh.status)}
              draggable={draggableIds.has(wh.id)}
              eventHandlers={bindEventHandlers(entity)}
              // Warehouses are the primary interaction target (facility-location
              // choices) — a customer's demand-radius bubble can be large enough
              // to overlap a warehouse triangle at default zoom, and Leaflet hit-
              // tests markers by paint order (last-drawn wins) with no z-index of
              // its own otherwise. This offset keeps every warehouse above every
              // customer regardless of render order, without touching customers'
              // own (default 0) zIndexOffset.
              zIndexOffset={1000}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <span className="font-semibold text-xs">{wh.displayCode}</span>
              </Tooltip>
            </Marker>
          );
        })}
      {toggles.customers &&
        customers.map((cs) => {
          const entity: MapEntity = { kind: "cs", entity: cs };
          const radius = sizeByDemand ? scale.radiusOf(cs.demand) : FIXED_CUSTOMER_RADIUS;
          return (
            <Marker
              key={cs.id}
              position={[cs.lat, cs.lng]}
              icon={customerIcon(radius, cs.excluded, tone)}
              draggable={draggableIds.has(cs.id)}
              eventHandlers={bindEventHandlers(entity)}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                <span className="font-semibold text-xs">{cs.displayCode}</span>
              </Tooltip>
            </Marker>
          );
        })}
    </>
  );
}
