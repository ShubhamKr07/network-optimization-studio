import { useMemo, useState, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker, Pane, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { Dataset, SolveResult, Edge, Plant } from "@workspace/api-client-react";
import { assignBandOrOverflow, bandLabel } from "@/lib/bands";
import { getBandColor } from "@/lib/bandPalette";
import { getLegColor, isInboundLeg } from "@/lib/legPalette";
import { getMapBoundsProps, type CountryBounds } from "@/lib/mapBounds";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { plantSquareSvg } from "@/components/workspace/map/EntityMarkers";

// Local — WarehouseStatusEntry was removed from the generated API types when
// Scenario.inputs became opaque (D0.1); this is a purely local rendering
// concept now, translated from the new warehouseOverrides shape by the caller.
interface WarehouseStatusEntry {
  warehouseId: string;
  status: "potential" | "forced_open" | "inactive";
}

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const createTriangleIcon = (
  status: "potential" | "forced_open" | "inactive" | "open",
  highlighted = false,
  dimmed = false,
  multiSelected = false,
) => {
  let fill = "none";
  let stroke = "var(--map-default-stroke)";
  let strokeWidth = "2";
  let dash = "";
  let extraCircle = "";

  if (status === "open" || status === "forced_open") {
    fill = highlighted ? "var(--green-700)" : "var(--map-warehouse-open)";
    stroke = highlighted ? "var(--green-700)" : "var(--map-warehouse-open)";
  } else if (status === "inactive") {
    stroke = "var(--danger)";
    dash = 'stroke-dasharray="4"';
  }

  if (status === "forced_open") {
    extraCircle = `<circle cx="12" cy="12" r="10" fill="none" stroke="var(--map-ring-forced-open)" stroke-width="1.5" stroke-dasharray="3" />`;
  }

  const ringCircle = highlighted
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="var(--map-ring-select)" stroke-width="2" />`
    : "";
  // Multi-select ring uses a distinct violet stroke so it's visually
  // unambiguous from the amber single-select ring above, and can coexist
  // with it (a warehouse can be both single-selected and multi-selected).
  const multiSelectRing = multiSelected
    ? `<circle cx="12" cy="12" r="9" fill="none" stroke="var(--map-ring-multiselect)" stroke-width="2.5" />`
    : "";

  const opacity = dimmed ? 0.25 : 1;
  const size = highlighted ? 32 : 24;
  const anchor = highlighted ? 16 : 12;

  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" opacity="${opacity}">
    ${ringCircle}
    ${multiSelectRing}
    ${extraCircle}
    <polygon points="12,2 22,20 2,20" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" ${dash} />
  </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
};

// Sibling of createTriangleIcon — identical status/ring/multiSelect/opacity/
// size logic, only the shape differs: a 5-point star instead of a triangle.
// Used to render the single non-overridable mine in two-echelon-gold-au
// (WarehouseCandidate.kind === "mine"); every other model's rows have
// kind undefined and still render the triangle unchanged.
const createStarIcon = (
  status: "potential" | "forced_open" | "inactive" | "open",
  highlighted = false,
  dimmed = false,
  multiSelected = false,
) => {
  let fill = "none";
  let stroke = "var(--map-default-stroke)";
  let strokeWidth = "2";
  let dash = "";
  let extraCircle = "";

  if (status === "open" || status === "forced_open") {
    fill = highlighted ? "var(--green-700)" : "var(--map-warehouse-open)";
    stroke = highlighted ? "var(--green-700)" : "var(--map-warehouse-open)";
  } else if (status === "inactive") {
    stroke = "var(--danger)";
    dash = 'stroke-dasharray="4"';
  }

  if (status === "forced_open") {
    extraCircle = `<circle cx="12" cy="12" r="10" fill="none" stroke="var(--map-ring-forced-open)" stroke-width="1.5" stroke-dasharray="3" />`;
  }

  const ringCircle = highlighted
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="var(--map-ring-select)" stroke-width="2" />`
    : "";
  // Multi-select ring uses a distinct violet stroke so it's visually
  // unambiguous from the amber single-select ring above, and can coexist
  // with it (a warehouse can be both single-selected and multi-selected).
  const multiSelectRing = multiSelected
    ? `<circle cx="12" cy="12" r="9" fill="none" stroke="var(--map-ring-multiselect)" stroke-width="2.5" />`
    : "";

  const opacity = dimmed ? 0.25 : 1;
  const size = highlighted ? 32 : 24;
  const anchor = highlighted ? 16 : 12;

  // Standard 5-point star centered in the same 24x24 viewBox as the
  // triangle, outer radius ~10 / inner ~3.8 so it roughly matches the
  // triangle's visual weight (which spans y=2..20, x=2..22).
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" opacity="${opacity}">
    ${ringCircle}
    ${multiSelectRing}
    ${extraCircle}
    <path d="M12 2L14.2 8.9L21.5 8.9L15.6 13.2L17.9 20.1L12 15.8L6.1 20.1L8.4 13.2L2.5 8.9L9.8 8.9Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" ${dash} />
  </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
};

// jade-B1 (#2) — Output Map plant marker: reuses the input-map square symbol
// (EntityMarkers.plantSquareSvg) rather than a hand-drawn copy, so it can
// never visually drift from the Input Map's own plant icon. A plant has no
// status/selection vocabulary of its own (see EntityMarkers.tsx's own
// comment), so — unlike createTriangleIcon/createStarIcon — this takes no
// status/highlight arguments; it's a fixed icon.
function createPlantIcon(): L.DivIcon {
  return L.divIcon({
    html: plantSquareSvg(),
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function MapClickDeselect({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({ click: onDeselect });
  return null;
}

// jade-B1 (#2, spec §3 "Bounds constraint" + review R-plan-4) — union of
// marker coordinates, degenerate-guarded. Returns null (not a bounds box)
// when fewer than 2 finite [lat,lng] pairs are present, so callers can chain
// a fallback (rendered markers -> all effective entities -> manifest
// countryBounds) instead of ever computing a box from 0-1 points.
type LatLngTuple = [number, number];

function boundsFromCoords(coords: LatLngTuple[]): [LatLngTuple, LatLngTuple] | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let count = 0;
  for (const [lat, lng] of coords) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    count++;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  if (count < 2) return null;
  return [[minLat, minLng], [maxLat, maxLng]];
}

// Minimum padding (degrees) applied to every axis so a box degenerate on
// one axis (e.g. two markers sharing a latitude, or ultimately a single
// manifest fallback point) never yields a zero-area Leaflet maxBounds —
// "always PAD so a single point never yields degenerate bounds" (spec §3).
const MIN_BOUNDS_PAD_DEG = 1.5;

function padBounds([[minLat, minLng], [maxLat, maxLng]]: [LatLngTuple, LatLngTuple]): [LatLngTuple, LatLngTuple] {
  const latPad = Math.max((maxLat - minLat) * 0.1, MIN_BOUNDS_PAD_DEG);
  const lngPad = Math.max((maxLng - minLng) * 0.1, MIN_BOUNDS_PAD_DEG);
  return [[minLat - latPad, minLng - lngPad], [maxLat + latPad, maxLng + lngPad]];
}

// E5.1: fits the map to the model's manifest-derived bounds on mount (and
// whenever the bounds themselves change, e.g. switching lab/model) rather
// than guessing a fixed zoom level.
function FitBounds({ bounds }: { bounds: [[number, number], [number, number]] }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds);
  }, [map, bounds]);
  return null;
}

interface PopupInfo {
  lat: number;
  lng: number;
  customerCity: string;
  customerState: string;
  warehouseCity: string;
  warehouseState: string;
  distanceMi: number;
  band: number;
  // jade-B1 (#1 all-site overflow) — "Band N" / "Overflow" text, computed
  // via the shared bandLabel() so this popup can never hand-roll
  // `Band ${band + 1}` and disagree with the map's own overflow sentinel.
  bandLabelText: string;
}

// C4.11 — pure popup-markup builder, extracted so the distance unit is
// verifiable without driving Leaflet's imperative L.popup() through jsdom.
// `distanceUnit` comes from the active model's manifest (ModelInfo.distanceUnit)
// — defaults to "mi", Chen (chens-cosmetics-cn) passes "km".
export function buildCustomerPopupHtml(info: PopupInfo, distanceUnit = "mi"): string {
  const color = getBandColor(info.band);
  return `
      <div style="font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;min-width:150px">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px;border-bottom:1px solid var(--line);padding-bottom:4px">
          ${info.customerCity}, ${info.customerState}
        </div>
        <div style="margin-bottom:3px;color:var(--text-body)">
          <span style="color:var(--text-muted)">Warehouse:</span>
          <strong style="margin-left:4px">${info.warehouseCity}, ${info.warehouseState}</strong>
        </div>
        <div style="margin-bottom:3px;color:var(--text-body)">
          <span style="color:var(--text-muted)">Distance:</span>
          <strong style="margin-left:4px;font-family:var(--app-font-mono)">${info.distanceMi.toLocaleString()} ${distanceUnit}</strong>
        </div>
        <div style="display:flex;align-items:center;gap:5px;color:var(--text-body)">
          <span style="color:var(--text-muted)">Band:</span>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <strong style="font-family:var(--app-font-mono)">${info.bandLabelText}</strong>
        </div>
      </div>
    `;
}

function CustomerPopup({ info, onClose, distanceUnit = "mi" }: { info: PopupInfo; onClose: () => void; distanceUnit?: string }) {
  const map = useMap();

  useEffect(() => {
    const content = buildCustomerPopupHtml(info, distanceUnit);

    const popup = L.popup({
      closeButton: true,
      autoPan: false,
      offset: [0, -4],
    })
      .setLatLng([info.lat, info.lng])
      .setContent(content)
      .openOn(map);

    const handleClose = (e: L.PopupEvent) => {
      if (e.popup === popup) onClose();
    };
    map.on("popupclose", handleClose);

    return () => {
      map.off("popupclose", handleClose);
      map.closePopup(popup);
    };
  }, [info.customerCity, info.warehouseCity, info.distanceMi, info.band, distanceUnit, info.bandLabelText]);

  return null;
}

interface NetworkMapProps {
  dataset: Dataset;
  warehouseStatuses: WarehouseStatusEntry[];
  result: SolveResult | null;
  showRoutes: boolean;
  // E1.1: bands are presentation state — route/marker colors are
  // recomputed from these client-side, not from each edge's stored
  // `.band` (which reflects the bands at solve time and goes stale the
  // moment a student edits them without re-solving).
  bands: number[];
  // E5.1: the active model's manifest countryBounds — falls back to a
  // continental-US default when not yet loaded/available.
  countryBounds?: CountryBounds;
  // Multi-select (shift/ctrl-click) is lifted state, independent of this
  // component's own single-select filter/inspect state above — Studio.tsx
  // owns it so it can render a bulk-edit toolbar outside this component.
  multiSelectedWarehouseIds: string[];
  multiSelectedCustomerIds: string[];
  onToggleWarehouseMultiSelect: (id: string) => void;
  onToggleCustomerMultiSelect: (id: string) => void;
  // A3.1 (Output Map tab) — independent marker-visibility toggles. Deliberately
  // NOT dataset filtering: a route's endpoints are looked up via
  // dataset.warehouses.find()/dataset.customers.find() below, so emptying
  // either array to hide markers would also silently drop every route
  // touching that entity — exactly the "Lanes on, Warehouses off" combination
  // the Output Map tab's independently-toggleable layers require. These props
  // gate ONLY marker rendering; route/tooltip/popup lookups keep using the
  // full dataset regardless. Both default to true (undefined = on) so every
  // existing caller (Studio.tsx, tests) is unaffected without passing them.
  showWarehouseMarkers?: boolean;
  showCustomerMarkers?: boolean;
  // T6/R7 (Output Map only) — when true, renders only warehouses the solver
  // actually opened (getStatus resolves "open"/"forced_open"); every other
  // candidate's MARKER is omitted. Deliberately narrower than
  // showWarehouseMarkers: routes/tooltips/popups still resolve against the
  // full `dataset` regardless (an opened warehouse's route always finds its
  // endpoint), and closed warehouses never have routes in the first place
  // (the solver only ever emits edges from opened ones), so this can't
  // orphan a polyline the way filtering `dataset` itself would. Defaults to
  // false so every existing caller (Studio.tsx, Input Map, tests) renders
  // every candidate exactly as before.
  hideClosedWarehouses?: boolean;
  // B2.2-T4 (A4) — unit each edge's `distance` is reported in, sourced from
  // the active model's manifest (ModelInfo.distanceUnit) by the caller.
  // Optional/defaults to "mi" so every existing caller that hasn't threaded
  // it through yet (Studio.tsx, Workspace.tsx call sites owned by other
  // tasks, tests) keeps compiling and rendering unchanged.
  distanceUnit?: string;
  // jade-T13 — per-leg lane visibility (the notebook's inbound/outbound/
  // combined layer toggles generalize to "which legs are visible"). When
  // undefined (every existing caller/model), every route renders exactly as
  // before — this is additive-only. When provided, an edge renders only if
  // its `leg` is included; an edge with no `leg` (single-echelon models)
  // still renders unconditionally, since the leg concept doesn't apply to
  // it. Wiring the actual checkboxes into the Output Map tab is T15.5's job
  // (Workspace.tsx integration) — this prop is the seam it consumes.
  visibleLegs?: string[];
  // jade-B1 (#2) — Chapter 9 JADE's third map-entity kind (square marker,
  // supply role, no status/open-close decision — see spec §3 "Approach").
  // A SEPARATE prop, NOT a `kind: "plant"` warehouses variant: the generated
  // WarehouseCandidateKind permits only "mine" | "facility", so folding
  // plants into `dataset.warehouses` with a 3rd kind would force an
  // OpenAPI/codegen change for no benefit. Optional, default `[]` — every
  // non-JADE caller (and every existing test literal) renders exactly as
  // before. Authoritative for plant markers AND for resolving an inbound
  // (`plant_to_warehouse`) edge's `fromId` — the pre-existing
  // `dataset.warehouses`-fold lookup (Workspace.tsx's
  // jadePlantsAsWarehouseCandidates) remains only as a compatibility
  // fallback below, not the marker source.
  plants?: Plant[];
  // jade-B1 (#2) — independent layer-visibility toggle for plant markers,
  // mirroring showWarehouseMarkers/showCustomerMarkers. Deliberately NOT
  // folded into showWarehouseMarkers: a plant is never subject to
  // hideClosedWarehouses either (it's not a facility-location choice), so it
  // needs its own toggle, not the warehouse one. Default `true`.
  showPlantMarkers?: boolean;
}

export function NetworkMap({
  dataset, warehouseStatuses, result, showRoutes, bands, countryBounds,
  multiSelectedWarehouseIds, multiSelectedCustomerIds,
  onToggleWarehouseMultiSelect, onToggleCustomerMultiSelect,
  showWarehouseMarkers = true, showCustomerMarkers = true,
  hideClosedWarehouses = false, distanceUnit = "mi", visibleLegs,
  plants = [], showPlantMarkers = true,
}: NetworkMapProps) {
  const mapBounds = getMapBoundsProps(countryBounds);
  // react-leaflet's MapContainer only applies center/maxBounds/minZoom at
  // construction — they are NOT reactive props. GET /api/models (the source
  // of countryBounds) and GET /dataset are independent queries with no
  // guaranteed ordering; if dataset resolves first, NetworkMap's first mount
  // captures FALLBACK_BOUNDS (continental US) into an immutable Leaflet
  // maxBounds. FitBounds's imperative fitBounds() call below DOES fire once
  // the real bounds arrive, but with maxBoundsViscosity=1.0 the frozen US
  // maxBounds fights it and clamps the view back — the map effectively gets
  // stuck showing the US even for an Australia-bounded model. Keying the
  // MapContainer on the resolved bounds forces a full remount (fresh Leaflet
  // instance, correct init props) the moment the real countryBounds lands,
  // instead of trying to mutate a Leaflet option that was never designed to
  // be mutated after construction.
  //
  // jade-B1 (#2, spec §3 "Bounds constraint") — the effective bounds/mapKey
  // below now derive from the union of marker coordinates rather than
  // `countryBounds` alone (computed further down, once `getStatus` exists);
  // `mapBounds.maxBounds`/`.minZoom` from `countryBounds` remain the
  // degenerate-guard's LAST-resort fallback tier.
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);

  const { maxDemand, minDemand } = useMemo(() => {
    let max = 0;
    let min = Infinity;
    dataset.customers.forEach((c) => {
      if (c.demand > max) max = c.demand;
      if (c.demand < min) min = c.demand;
    });
    return { maxDemand: max, minDemand: min };
  }, [dataset.customers]);

  const scaleDemand = (demand: number) => {
    if (maxDemand === minDemand) return 5;
    return 3 + ((demand - minDemand) / (maxDemand - minDemand)) * 5;
  };

  const openWarehouseIds = (result?.details as { openWarehouseIds?: string[] } | undefined)?.openWarehouseIds;

  const getStatus = (whId: string) => {
    const entry = warehouseStatuses.find((w) => w.warehouseId === whId);
    if (result && openWarehouseIds?.includes(whId)) return "open";
    return entry ? entry.status : "potential";
  };

  // jade-B1 (#2, spec §3 "Bounds constraint" + review R-plan-4) — mirrors the
  // route-pane/marker-loop's own hideClosedWarehouses predicate exactly (a
  // mine is always visible; every other candidate only when open/forced_open
  // under hideClosedWarehouses), so the bounds union never disagrees with
  // what's actually rendered.
  const isWarehouseRenderedForBounds = (w: { id: string; kind?: string }) => {
    if (!hideClosedWarehouses) return true;
    if (w.kind === "mine") return true;
    const status = getStatus(w.id);
    return status === "open" || status === "forced_open";
  };

  // Tier 1: union of the coordinates actually being rendered right now
  // (respects every layer toggle + hideClosedWarehouses) — "every plant is
  // visible" (OQ-1) without a wider fitBounds() call being clamped back by
  // maxBoundsViscosity=1.0 (P2-6), since this same union also becomes
  // maxBounds itself below.
  const renderedCoords: LatLngTuple[] = [
    ...(showPlantMarkers ? plants.map((p): LatLngTuple => [p.lat, p.lng]) : []),
    ...(showWarehouseMarkers
      ? dataset.warehouses.filter(isWarehouseRenderedForBounds).map((w): LatLngTuple => [w.lat, w.lng])
      : []),
    ...(showCustomerMarkers ? dataset.customers.map((c): LatLngTuple => [c.lat, c.lng]) : []),
  ];
  // Tier 2 (degenerate-bounds guard, review R-plan-4): every effective
  // entity's coordinates regardless of toggle state — used only when Tier 1
  // has fewer than 2 valid coords (every layer off, or a single marker).
  const allEntityCoords: LatLngTuple[] = [
    ...plants.map((p): LatLngTuple => [p.lat, p.lng]),
    ...dataset.warehouses.map((w): LatLngTuple => [w.lat, w.lng]),
    ...dataset.customers.map((c): LatLngTuple => [c.lat, c.lng]),
  ];
  // Tier 3: the manifest's own countryBounds (or the continental-US
  // fallback), used only when even Tier 2 can't form a real box (e.g. a
  // dataset with a single total entity).
  const rawBounds = boundsFromCoords(renderedCoords) ?? boundsFromCoords(allEntityCoords) ?? mapBounds.maxBounds;
  const effectiveBounds = padBounds(rawBounds);
  const effectiveCenter: LatLngTuple = [
    (effectiveBounds[0][0] + effectiveBounds[1][0]) / 2,
    (effectiveBounds[0][1] + effectiveBounds[1][1]) / 2,
  ];
  // This union — not countryBounds alone — now drives maxBounds, FitBounds's
  // target, AND the remount key together (P2-6): react-leaflet's maxBounds
  // is construction-time-only, so a genuinely different box requires a full
  // MapContainer remount, exactly like the pre-existing countryBounds-keyed
  // remount this replaces/generalizes.
  const mapKey = `${effectiveBounds[0].join(",")}_${effectiveBounds[1].join(",")}`;

  // Edges: fromId=warehouseId, toId=customerId (Phase 3.5 G2.1 model-agnostic shape).
  const assignmentMap = useMemo(() => {
    if (!result) return new Map<string, Edge>();
    return new Map(result.edges.map((e) => [e.toId, e]));
  }, [result]);

  // Set of customer IDs assigned to the currently selected warehouse
  const warehouseCustomerIds = useMemo(() => {
    if (!selectedWarehouseId || !result) return null;
    const ids = new Set<string>();
    result.edges.forEach((e) => {
      if (e.fromId === selectedWarehouseId) ids.add(e.toId);
    });
    return ids;
  }, [selectedWarehouseId, result]);

  // jade-T13 — routes actually drawn on the map: result.edges, filtered by
  // visibleLegs (undefined = show all, unchanged for every existing model),
  // then coalesced by (leg,fromId,toId) summing flow. JADE's envelope emits
  // one inbound edge per positive (plant,warehouse,product) flow, so two
  // products shipped between the same plant->warehouse pair would otherwise
  // draw two overlapping polylines with a colliding React key — the
  // underlying result and the Flows grid stay per-product; this coalescing
  // is purely a map-rendering concern (spec §4). For every other model this
  // is a no-op (each (leg,fromId,toId) triple is already unique).
  const routeEdges = useMemo(() => {
    if (!result) return [];
    const grouped = new Map<string, Edge>();
    for (const edge of result.edges) {
      if (visibleLegs !== undefined && edge.leg != null && !visibleLegs.includes(edge.leg)) continue;
      const key = `${edge.leg ?? ""}|${edge.fromId}|${edge.toId}`;
      const existing = grouped.get(key);
      if (existing) {
        grouped.set(key, { ...existing, flow: existing.flow + edge.flow, productId: undefined });
      } else {
        grouped.set(key, edge);
      }
    }
    return Array.from(grouped.values());
  }, [result, visibleLegs]);

  // Build popup info for the selected customer
  const popupInfo = useMemo<PopupInfo | null>(() => {
    if (!selectedCustomerId || !result) return null;
    const edge = assignmentMap.get(selectedCustomerId);
    if (!edge) return null;
    const customer = dataset.customers.find((c) => c.id === selectedCustomerId);
    const warehouse = dataset.warehouses.find((w) => w.id === edge.fromId);
    if (!customer || !warehouse) return null;
    return {
      lat: customer.lat,
      lng: customer.lng,
      customerCity: (customer as unknown as { city?: string }).city ?? "",
      customerState: (customer as unknown as { state?: string }).state ?? "",
      warehouseCity: warehouse.city,
      warehouseState: warehouse.state,
      distanceMi: edge.distance,
      // jade-B1 (#1 all-site overflow) — assignBandOrOverflow so a
      // beyond-highest-boundary distance gets the OVERFLOW_BAND sentinel
      // (-1) here too, not folded into the last real band.
      band: assignBandOrOverflow(edge.distance, bands),
      bandLabelText: bandLabel(edge.distance, bands),
    };
  }, [selectedCustomerId, result, assignmentMap, dataset, bands]);

  const hasCustomerSelection = selectedCustomerId !== null && popupInfo !== null;
  const hasWarehouseFilter = selectedWarehouseId !== null && warehouseCustomerIds !== null;

  const handleDeselect = () => {
    setSelectedCustomerId(null);
    setSelectedWarehouseId(null);
  };

  const handleWarehouseClick = (whId: string, status: string, e: L.LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(e);
    if (e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
      // The mine (kind="mine", two-echelon only) is not an overridable entity,
      // so it is excluded from multi-select; it still renders as a marker.
      const wh = dataset.warehouses.find(w => w.id === whId);
      if (wh?.kind !== "mine") onToggleWarehouseMultiSelect(whId);
      return;
    }
    // Only filter by open/forced_open warehouses that have assignments
    if (status !== "open" && status !== "forced_open") return;
    setSelectedCustomerId(null);
    setSelectedWarehouseId((prev) => (prev === whId ? null : whId));
  };

  // Determine if a customer is "in focus" based on the active selection mode
  const isCustomerFocused = (customerId: string) => {
    if (hasWarehouseFilter) return warehouseCustomerIds!.has(customerId);
    if (hasCustomerSelection) return customerId === selectedCustomerId;
    return true;
  };

  const anySelection = hasCustomerSelection || hasWarehouseFilter;

  const hintText = (() => {
    if (hasWarehouseFilter) return "Click warehouse again or map background to reset";
    if (showRoutes && result) return "Click a warehouse ▲ to filter its customers · Click a customer dot to inspect its route";
    return null;
  })();

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-white border rounded-lg overflow-hidden shadow-sm">
      <MapContainer
        key={mapKey}
        center={effectiveCenter}
        zoom={4}
        minZoom={mapBounds.minZoom}
        maxBounds={effectiveBounds}
        maxBoundsViscosity={1.0}
        className="w-full flex-1 z-0"
        zoomControl={false}
        boxZoom={false}
      >
        <FitBounds bounds={effectiveBounds} />
        <MapClickDeselect onDeselect={handleDeselect} />

        {popupInfo && (
          <CustomerPopup
            info={popupInfo}
            onClose={() => setSelectedCustomerId(null)}
            distanceUnit={distanceUnit}
          />
        )}

        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />

        {/* Route lines in a dedicated pane below customer circles (z-index 350) */}
        <Pane name="routePane" style={{ zIndex: 350 }}>
          {showRoutes &&
            routeEdges.map((edge) => {
              // Two-echelon models' first/"inbound" leg (mine_to_refinery,
              // and jade-T13's plant_to_warehouse) has fromId=source,
              // toId=facility — BOTH warehouse-role entities in
              // dataset.warehouses, not dataset.customers. Every other edge
              // (every single-echelon model, and each model's own second/
              // "outbound" leg) is the usual fromId=warehouse, toId=customer
              // shape. Looking an inbound leg's toId up in dataset.customers
              // always fails (no such customer id), silently dropping the
              // route from the map — classify by semantic role
              // (isInboundLeg), never a per-model/per-leg-string ternary.
              const isInboundEdge = isInboundLeg(edge.leg);
              const toEntity = isInboundEdge
                ? dataset.warehouses.find((w) => w.id === edge.toId)
                : dataset.customers.find((c) => c.id === edge.toId);
              // jade-B1 (#2, spec §3 "Effective plants incl. scenario-added")
              // — an inbound edge's fromId is a plant for JADE. `plants` (the
              // new prop) is now authoritative; dataset.warehouses.find(...)
              // remains only as a compatibility fallback for callers that
              // still fold plants into dataset.warehouses (pre-INT
              // Workspace.tsx) or for every non-JADE two-echelon model (Ch10
              // mine_to_refinery), whose source entity genuinely does live in
              // dataset.warehouses and has no `plants` prop at all.
              const fromEntity = isInboundEdge
                ? (plants.find((p) => p.id === edge.fromId) ?? dataset.warehouses.find((w) => w.id === edge.fromId))
                : dataset.warehouses.find((w) => w.id === edge.fromId);
              if (!toEntity || !fromEntity) return null;

              // An inbound leg isn't tied to any one customer, so
              // customer-focus dimming (inspecting a specific customer's
              // route) doesn't apply to it — it stays fully visible.
              const focused = isInboundEdge || isCustomerFocused(edge.toId);
              const dimmed = !isInboundEdge && anySelection && !focused;

              // jade-B1 (#1 all-site overflow + JADE leg-vs-band coloring
              // resolution, spec §2) — the "Color lanes: Distance band"
              // toggle governs a two-echelon edge's color, using the SAME
              // empty-bands-array-means-off encoding OutputMapTab already
              // uses for every model's own "Plain" lane mode (colorByBand
              // false -> bands=[]): when bands is non-empty (colorByBand ON,
              // the default post-solve state), distance-band coloring wins
              // for EVERY edge, JADE/Ch10 included, via assignBandOrOverflow
              // so an out-of-range lane gets the distinct overflow color
              // instead of folding into the last band. When bands is empty
              // (colorByBand OFF), a two-echelon edge falls back to its leg
              // color (green inbound / red outbound) exactly as before; a
              // single-echelon edge (no leg) still resolves via
              // assignBandOrOverflow(distance, []), which returns band 0 —
              // unchanged "Plain" behavior.
              const bandColor = getBandColor(assignBandOrOverflow(edge.distance, bands));
              const legColor = getLegColor(edge.leg);
              const routeColor = legColor != null && bands.length === 0 ? legColor : bandColor;

              return (
                <Polyline
                  key={`route-${edge.leg ?? "none"}-${edge.fromId}-${edge.toId}`}
                  positions={[
                    [toEntity.lat, toEntity.lng],
                    [fromEntity.lat, fromEntity.lng],
                  ]}
                  pathOptions={{
                    color: routeColor,
                    weight: focused && hasCustomerSelection ? 4 : 2,
                    opacity: dimmed ? 0.1 : focused && hasCustomerSelection ? 1 : 0.75,
                  }}
                >
                  {/* B2.2-T4 (A4) — hover tooltip: cities + length in the
                      active model's own distance unit (never hardcoded
                      "mi"). Translucent + pointer-events-none so it never
                      blocks clicks/hover on the polyline itself or on
                      markers underneath it. Deliberately does not touch the
                      click-based CustomerPopup above. */}
                  <Tooltip
                    direction="center"
                    opacity={0.85}
                    className="pointer-events-none"
                    sticky
                  >
                    <span className="text-xs">
                      {fromEntity.city} → {toEntity.city}
                      <br />
                      <span className="font-mono">{edge.distance} {distanceUnit}</span>
                    </span>
                  </Tooltip>
                </Polyline>
              );
            })}
        </Pane>

        {showCustomerMarkers && dataset.customers.map((c) => {
          const assignment = assignmentMap.get(c.id);
          // jade-B1 (#1 all-site overflow) — assignBandOrOverflow so a
          // customer beyond the highest boundary highlights with the
          // distinct overflow color/label, not the last band's.
          const assignmentBand = assignment ? assignBandOrOverflow(assignment.distance, bands) : 0;
          const focused = isCustomerFocused(c.id);
          const dimmed = anySelection && !focused;
          const isCustomerSelected = c.id === selectedCustomerId;
          const isWarehouseHighlighted = hasWarehouseFilter && focused;

          const fillColor = isCustomerSelected
            ? getBandColor(assignmentBand)
            : isWarehouseHighlighted
              ? getBandColor(assignmentBand)
              : "var(--map-customer)";

          return (
            <CircleMarker
              key={c.id}
              center={[c.lat, c.lng]}
              radius={scaleDemand(c.demand)}
              pathOptions={{
                fillColor,
                fillOpacity: dimmed ? 0.15 : 0.8,
                color: multiSelectedCustomerIds.includes(c.id)
                  ? "var(--map-ring-multiselect)"
                  : isCustomerSelected
                    ? getBandColor(assignmentBand)
                    : isWarehouseHighlighted
                      ? getBandColor(assignmentBand)
                      : "var(--map-customer-stroke)",
                weight: multiSelectedCustomerIds.includes(c.id) ? 3 : isCustomerSelected ? 2.5 : isWarehouseHighlighted ? 1.5 : 1,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  if (e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
                    onToggleCustomerMultiSelect(c.id);
                    return;
                  }
                  setSelectedWarehouseId(null);
                  setSelectedCustomerId((prev) => (prev === c.id ? null : c.id));
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                <span className="font-semibold text-xs">
                  {(c as unknown as { city?: string }).city ?? c.id}, {(c as unknown as { state?: string }).state ?? ""}
                  {" · "}
                  <span className="font-mono">{c.demand.toLocaleString()} {assignment ? `· ${bandLabel(assignment.distance, bands)}` : ""}</span>
                </span>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {showWarehouseMarkers && dataset.warehouses.map((w) => {
          const status = getStatus(w.id);
          const isOpen = status === "open" || status === "forced_open";
          // R7 (Bundle 2, Task T4) — the fixed mine (two-echelon-gold-au,
          // kind==="mine") is never a facility-location choice, so it's
          // never in openWarehouseIds and isOpen is always false for it —
          // hideClosedWarehouses would otherwise hide it exactly like a
          // genuinely closed candidate, even though it's not one.
          if (hideClosedWarehouses && w.kind !== "mine" && !isOpen) return null;
          const isHighlighted = w.id === selectedWarehouseId;
          const isDimmed = hasWarehouseFilter && !isHighlighted && isOpen;

          return (
            <Marker
              key={w.id}
              position={[w.lat, w.lng]}
              icon={w.kind === "mine"
                ? createStarIcon(status, isHighlighted, isDimmed, multiSelectedWarehouseIds.includes(w.id))
                : createTriangleIcon(status, isHighlighted, isDimmed, multiSelectedWarehouseIds.includes(w.id))}
              eventHandlers={
                isOpen
                  ? {
                      click: (e) => handleWarehouseClick(w.id, status, e),
                    }
                  : undefined
              }
            >
              {/* Hover details for every warehouse-role marker (mine, refinery,
                  warehouse) regardless of status — previously gated on
                  isOpen, so a "potential" candidate (most markers, especially
                  pre-solve) or the fixed mine (never in openWarehouseIds,
                  since it's not a facility-location choice — so isOpen was
                  always false for it) showed nothing on hover at all. */}
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <span className="font-semibold text-xs">
                  {w.id} — {w.city}, {w.state}
                  {w.kind === "mine" && " (mine)"}
                  {result && isOpen ? (
                    <span className="font-mono"> · {warehouseCustomerIds && w.id === selectedWarehouseId ? warehouseCustomerIds.size : (result.edges.filter((e) => e.fromId === w.id).length)} customers</span>
                  ) : ""}
                </span>
              </Tooltip>
            </Marker>
          );
        })}

        {/* jade-B1 (#2) — plant markers: reuse the input-map square symbol,
            NEVER subject to hideClosedWarehouses (a plant is a fixed supply
            source, not a facility-location open/close decision). Gated only
            on the independent showPlantMarkers toggle. */}
        {showPlantMarkers && plants.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={createPlantIcon()}>
            <Tooltip direction="top" offset={[0, -10]} opacity={1}>
              <span className="font-semibold text-xs">
                {p.id} — {p.city}, {p.state}
              </span>
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>

      <MapLegend
        variant="output"
        corner="br"
        hasMine={dataset.warehouses.some((w) => w.kind === "mine")}
        showWarehouseLayer={showWarehouseMarkers}
        showCustomerLayer={showCustomerMarkers}
        result={result}
        showRoutes={showRoutes}
        bands={bands}
        hintText={hintText}
        distanceUnit={distanceUnit}
        hasPlants={plants.length > 0}
        showPlantLayer={showPlantMarkers}
      />
    </div>
  );
}
