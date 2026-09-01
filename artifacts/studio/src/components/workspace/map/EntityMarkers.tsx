import { useMemo } from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import { warehouseStatusPresentation, type WhStatus } from "./statusPresentation";
import { demandTone, makeQuintileRadius, type DemandTone, type MapWarehouse, type MapCustomer, type MapEntity } from "./types";

export interface EntityMarkersToggles {
  warehouses: boolean;
  customers: boolean;
  showInactive: boolean;
}

export interface EntityMarkersProps {
  warehouses: MapWarehouse[];
  customers: MapCustomer[];
  toggles: EntityMarkersToggles;
  onLeftClick: (entity: MapEntity, e: L.LeafletMouseEvent) => void;
  onRightClick: (entity: MapEntity, e: L.LeafletMouseEvent) => void;
  onDragEnd: (entity: MapEntity, latlng: { lat: number; lng: number }) => void;
  draggableIds: Set<string>;
  /** R1: drives blue-vs-green customer bubbles (demandTone). Optional —
   * defaults to "p-median-us", the only model wired to this component today
   * (LegacyInputMap, the other models' Input Map, doesn't use EntityMarkers
   * at all), so every existing call site keeps its current (correct) green
   * behavior without needing to pass this explicitly. */
  modelId?: string;
}

// ── Pure SVG-string builders ────────────────────────────────────────────
// Exported directly (not just used internally) so their "always a string,
// never a React element" contract can be unit-tested without a DOM —
// L.divIcon's `html` option requires a raw string; a React element there
// silently stringifies to "[object Object]" instead of throwing.
//
// R3 bug fix: --accent-*/--demand-* (index.css) are already COMPLETE colors
// (relative-color `hsl(from ...)` output), not shadcn H-S-L channel triples
// — wrapping one again as `hsl(var(--accent-700))` is an invalid nested
// color. An invalid `fill` falls back to SVG's default black (which is why
// filled/Fixed-Open rendered — a black triangle looked "correct" enough to
// hide the bug); an invalid `stroke` falls back to `none` (why outline/
// dashed painted nothing at all). Fix: consume them unwrapped, `var(--token)`.
// `--muted-foreground` is a genuine shadcn channel token (H S% L%, declared
// as such everywhere else in index.css), so it stays wrapped in `hsl(...)`.
export function warehouseTriangleSvg(marker: "outline" | "filled" | "dashed"): string {
  const filled = marker === "filled";
  const dashed = marker === "dashed";
  const stroke = dashed ? "hsl(var(--muted-foreground))" : "var(--accent-700)";
  const fill = filled ? "var(--accent-700)" : "none";
  const dashAttr = dashed ? ' stroke-dasharray="4"' : "";
  return `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="12,2 22,20 2,20" fill="${fill}" stroke="${stroke}" stroke-width="2"${dashAttr} /></svg>`;
}

export function customerBubbleSvg(radiusPx: number, tone: DemandTone = "blue"): string {
  const size = Math.ceil(radiusPx * 2) + 4;
  const center = size / 2;
  const fillToken = tone === "green" ? "--demand-300" : "--accent-300";
  const strokeToken = tone === "green" ? "--demand-600" : "--accent-600";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${center}" cy="${center}" r="${radiusPx}" fill="var(${fillToken})" fill-opacity="0.55" stroke="var(${strokeToken})" stroke-width="1.5" /></svg>`;
}

function warehouseIcon(status: WhStatus): L.DivIcon {
  const { marker } = warehouseStatusPresentation[status];
  return L.divIcon({
    html: warehouseTriangleSvg(marker),
    className: `wh-marker status-${status} marker-${marker}`,
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
          return (
            <Marker
              key={cs.id}
              position={[cs.lat, cs.lng]}
              icon={customerIcon(scale.radiusOf(cs.demand), cs.excluded, tone)}
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
