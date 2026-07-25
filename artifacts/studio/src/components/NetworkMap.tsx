import { useMemo, useState, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker, Pane, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { Dataset, SolveResult, Edge } from "@workspace/api-client-react";
import { assignBand } from "@/lib/bands";
import { BAND_COLORS as bandColors, getBandColor } from "@/lib/bandPalette";
import { getMapBoundsProps, type CountryBounds } from "@/lib/mapBounds";

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
  let stroke = "#64748B";
  let strokeWidth = "2";
  let dash = "";
  let extraCircle = "";

  if (status === "open" || status === "forced_open") {
    fill = highlighted ? "#15803D" : "#16A34A";
    stroke = highlighted ? "#15803D" : "#16A34A";
  } else if (status === "inactive") {
    stroke = "#DC2626";
    dash = 'stroke-dasharray="4"';
  }

  if (status === "forced_open") {
    extraCircle = `<circle cx="12" cy="12" r="10" fill="none" stroke="#2D6CDF" stroke-width="1.5" stroke-dasharray="3" />`;
  }

  const ringCircle = highlighted
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="#FCD34D" stroke-width="2" />`
    : "";
  // Multi-select ring uses a distinct violet stroke so it's visually
  // unambiguous from the amber single-select ring above, and can coexist
  // with it (a warehouse can be both single-selected and multi-selected).
  const multiSelectRing = multiSelected
    ? `<circle cx="12" cy="12" r="9" fill="none" stroke="#7C3AED" stroke-width="2.5" />`
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
  let stroke = "#64748B";
  let strokeWidth = "2";
  let dash = "";
  let extraCircle = "";

  if (status === "open" || status === "forced_open") {
    fill = highlighted ? "#15803D" : "#16A34A";
    stroke = highlighted ? "#15803D" : "#16A34A";
  } else if (status === "inactive") {
    stroke = "#DC2626";
    dash = 'stroke-dasharray="4"';
  }

  if (status === "forced_open") {
    extraCircle = `<circle cx="12" cy="12" r="10" fill="none" stroke="#2D6CDF" stroke-width="1.5" stroke-dasharray="3" />`;
  }

  const ringCircle = highlighted
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="#FCD34D" stroke-width="2" />`
    : "";
  // Multi-select ring uses a distinct violet stroke so it's visually
  // unambiguous from the amber single-select ring above, and can coexist
  // with it (a warehouse can be both single-selected and multi-selected).
  const multiSelectRing = multiSelected
    ? `<circle cx="12" cy="12" r="9" fill="none" stroke="#7C3AED" stroke-width="2.5" />`
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

function MapClickDeselect({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({ click: onDeselect });
  return null;
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
}

function CustomerPopup({ info, onClose }: { info: PopupInfo; onClose: () => void }) {
  const map = useMap();

  useEffect(() => {
    const color = getBandColor(info.band);

    const content = `
      <div style="font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;min-width:150px">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px">
          ${info.customerCity}, ${info.customerState}
        </div>
        <div style="margin-bottom:3px;color:#334155">
          <span style="color:#64748b">Warehouse:</span>
          <strong style="margin-left:4px">${info.warehouseCity}, ${info.warehouseState}</strong>
        </div>
        <div style="margin-bottom:3px;color:#334155">
          <span style="color:#64748b">Distance:</span>
          <strong style="margin-left:4px">${info.distanceMi.toLocaleString()} mi</strong>
        </div>
        <div style="display:flex;align-items:center;gap:5px;color:#334155">
          <span style="color:#64748b">Band:</span>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <strong>Band ${info.band + 1}</strong>
        </div>
      </div>
    `;

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
  }, [info.customerCity, info.warehouseCity, info.distanceMi, info.band]);

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
}

export function NetworkMap({
  dataset, warehouseStatuses, result, showRoutes, bands, countryBounds,
  multiSelectedWarehouseIds, multiSelectedCustomerIds,
  onToggleWarehouseMultiSelect, onToggleCustomerMultiSelect,
}: NetworkMapProps) {
  const mapBounds = getMapBoundsProps(countryBounds);
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
      band: assignBand(edge.distance, bands),
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
        center={mapBounds.center}
        zoom={4}
        minZoom={mapBounds.minZoom}
        maxBounds={mapBounds.maxBounds}
        maxBoundsViscosity={1.0}
        className="w-full flex-1 z-0"
        zoomControl={false}
        boxZoom={false}
      >
        <FitBounds bounds={mapBounds.maxBounds} />
        <MapClickDeselect onDeselect={handleDeselect} />

        {popupInfo && (
          <CustomerPopup
            info={popupInfo}
            onClose={() => setSelectedCustomerId(null)}
          />
        )}

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution="CartoDB"
        />

        {/* Route lines in a dedicated pane below customer circles (z-index 350) */}
        <Pane name="routePane" style={{ zIndex: 350 }}>
          {showRoutes &&
            result?.edges.map((edge) => {
              const customer = dataset.customers.find((c) => c.id === edge.toId);
              const warehouse = dataset.warehouses.find((w) => w.id === edge.fromId);
              if (!customer || !warehouse) return null;

              const focused = isCustomerFocused(edge.toId);
              const dimmed = anySelection && !focused;

              // Two-echelon models tag each edge with its leg so the map can
              // style mine->refinery and refinery->customer differently. When
              // leg is absent (every single-echelon model), fall back to the
              // existing band-color behavior completely unchanged.
              const legColor = edge.leg === "mine_to_refinery" ? "#16A34A"
                : edge.leg === "refinery_to_customer" ? "#DC2626"
                : getBandColor(assignBand(edge.distance, bands));

              return (
                <Polyline
                  key={`route-${edge.toId}`}
                  positions={[
                    [customer.lat, customer.lng],
                    [warehouse.lat, warehouse.lng],
                  ]}
                  pathOptions={{
                    color: legColor,
                    weight: focused && hasCustomerSelection ? 4 : 2,
                    opacity: dimmed ? 0.1 : focused && hasCustomerSelection ? 1 : 0.75,
                  }}
                />
              );
            })}
        </Pane>

        {dataset.customers.map((c) => {
          const assignment = assignmentMap.get(c.id);
          const assignmentBand = assignment ? assignBand(assignment.distance, bands) : 0;
          const focused = isCustomerFocused(c.id);
          const dimmed = anySelection && !focused;
          const isCustomerSelected = c.id === selectedCustomerId;
          const isWarehouseHighlighted = hasWarehouseFilter && focused;

          const fillColor = isCustomerSelected
            ? getBandColor(assignmentBand)
            : isWarehouseHighlighted
              ? getBandColor(assignmentBand)
              : "#94A3B8";

          return (
            <CircleMarker
              key={c.id}
              center={[c.lat, c.lng]}
              radius={scaleDemand(c.demand)}
              pathOptions={{
                fillColor,
                fillOpacity: dimmed ? 0.15 : 0.8,
                color: multiSelectedCustomerIds.includes(c.id)
                  ? "#7C3AED"
                  : isCustomerSelected
                    ? getBandColor(assignmentBand)
                    : isWarehouseHighlighted
                      ? getBandColor(assignmentBand)
                      : "#64748B",
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
                  {" · "}{c.demand.toLocaleString()} {assignment ? `· Band ${assignmentBand + 1}` : ""}
                </span>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {dataset.warehouses.map((w) => {
          const status = getStatus(w.id);
          const isOpen = status === "open" || status === "forced_open";
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
              {isOpen && (
                <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                  <span className="font-semibold text-xs">
                    {w.city}, {w.state}
                    {result && isOpen ? ` · ${warehouseCustomerIds && w.id === selectedWarehouseId ? warehouseCustomerIds.size : (result.edges.filter((e) => e.fromId === w.id).length)} customers` : ""}
                  </span>
                </Tooltip>
              )}
            </Marker>
          );
        })}
      </MapContainer>

      <div className="absolute bottom-4 right-4 bg-white border border-border p-2 rounded-md shadow flex flex-col gap-2 z-10 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24">
              <polygon points="12,2 22,20 2,20" fill="none" stroke="#64748B" strokeWidth="2" />
            </svg>
            <span className="text-muted-foreground">Potential</span>
          </div>
          <div className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="#2D6CDF" strokeWidth="1.5" strokeDasharray="3" />
              <polygon points="12,2 22,20 2,20" fill="#16A34A" stroke="#16A34A" strokeWidth="2" />
            </svg>
            <span className="text-muted-foreground">Forced Open</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-slate-400 border border-slate-500 opacity-70"></div>
            <span className="text-muted-foreground">Customer</span>
          </div>
        </div>
        {result && showRoutes && (
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            {bandColors.slice(0, bands.length).map((color, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-muted-foreground">Band {i + 1}</span>
              </div>
            ))}
          </div>
        )}
        {hintText && (
          <div className="text-[10px] text-muted-foreground pt-0.5 italic">
            {hintText}
          </div>
        )}
      </div>
    </div>
  );
}
