import { useMemo, useState, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker, Pane, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { Dataset, WarehouseStatusEntry, SolveResult } from "@workspace/api-client-react";

delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const createTriangleIcon = (status: "potential" | "forced_open" | "inactive" | "open") => {
  let fill = "none";
  let stroke = "#64748B";
  let strokeWidth = "2";
  let dash = "";
  let extraCircle = "";

  if (status === "open" || status === "forced_open") {
    fill = "#16A34A";
    stroke = "#16A34A";
  } else if (status === "inactive") {
    stroke = "#DC2626";
    dash = 'stroke-dasharray="4"';
  }

  if (status === "forced_open") {
    extraCircle = `<circle cx="12" cy="12" r="10" fill="none" stroke="#2D6CDF" stroke-width="1.5" stroke-dasharray="3" />`;
  }

  const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    ${extraCircle}
    <polygon points="12,2 22,20 2,20" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" ${dash} />
  </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

const bandColors = ["#16A34A", "#84CC16", "#F59E0B", "#EF4444", "#DC2626"];
const getBandColor = (band: number) => bandColors[Math.min(band, bandColors.length - 1)] ?? "#16A34A";

function MapClickDeselect({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({ click: onDeselect });
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
}

export function NetworkMap({ dataset, warehouseStatuses, result, showRoutes }: NetworkMapProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

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

  const getStatus = (whId: string) => {
    const entry = warehouseStatuses.find((w) => w.warehouseId === whId);
    if (result && result.openWarehouseIds.includes(whId)) return "open";
    return entry ? entry.status : "potential";
  };

  const assignmentMap = useMemo(() => {
    if (!result) return new Map<string, (typeof result.assignments)[number]>();
    return new Map(result.assignments.map((a) => [a.customerId, a]));
  }, [result]);

  // Build popup info for the selected customer
  const popupInfo = useMemo<PopupInfo | null>(() => {
    if (!selectedCustomerId || !result) return null;
    const assignment = assignmentMap.get(selectedCustomerId);
    if (!assignment) return null;
    const customer = dataset.customers.find((c) => c.id === selectedCustomerId);
    const warehouse = dataset.warehouses.find((w) => w.id === assignment.warehouseId);
    if (!customer || !warehouse) return null;
    return {
      lat: customer.lat,
      lng: customer.lng,
      customerCity: customer.city,
      customerState: customer.state,
      warehouseCity: warehouse.city,
      warehouseState: warehouse.state,
      distanceMi: assignment.distanceMi,
      band: assignment.band,
    };
  }, [selectedCustomerId, result, assignmentMap, dataset]);

  const hasSelection = selectedCustomerId !== null && popupInfo !== null;

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-white border rounded-lg overflow-hidden shadow-sm">
      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        className="w-full flex-1 z-0"
        zoomControl={false}
      >
        <MapClickDeselect onDeselect={() => setSelectedCustomerId(null)} />

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
            result?.assignments.map((assignment) => {
              const customer = dataset.customers.find((c) => c.id === assignment.customerId);
              const warehouse = dataset.warehouses.find((w) => w.id === assignment.warehouseId);
              if (!customer || !warehouse) return null;

              const isSelected = assignment.customerId === selectedCustomerId;
              const dimmed = hasSelection && !isSelected;

              return (
                <Polyline
                  key={`route-${assignment.customerId}`}
                  positions={[
                    [customer.lat, customer.lng],
                    [warehouse.lat, warehouse.lng],
                  ]}
                  pathOptions={{
                    color: getBandColor(assignment.band),
                    weight: isSelected ? 4 : 2,
                    opacity: dimmed ? 0.12 : isSelected ? 1 : 0.75,
                  }}
                />
              );
            })}
        </Pane>

        {dataset.customers.map((c) => {
          const assignment = assignmentMap.get(c.id);
          const isSelected = c.id === selectedCustomerId;
          const dimmed = hasSelection && !isSelected;

          return (
            <CircleMarker
              key={c.id}
              center={[c.lat, c.lng]}
              radius={scaleDemand(c.demand)}
              pathOptions={{
                fillColor: isSelected ? getBandColor(assignment?.band ?? 0) : "#94A3B8",
                fillOpacity: dimmed ? 0.2 : 0.8,
                color: isSelected ? getBandColor(assignment?.band ?? 0) : "#64748B",
                weight: isSelected ? 2.5 : 1,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setSelectedCustomerId((prev) => (prev === c.id ? null : c.id));
                },
              }}
            />
          );
        })}

        {dataset.warehouses.map((w) => {
          const status = getStatus(w.id);
          return (
            <Marker key={w.id} position={[w.lat, w.lng]} icon={createTriangleIcon(status)}>
              {status === "open" && (
                <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                  <span className="font-semibold text-xs">
                    {w.city}, {w.state}
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
            {bandColors.slice(0, result.bandCoverage.length).map((color, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-muted-foreground">Band {i + 1}</span>
              </div>
            ))}
          </div>
        )}
        {showRoutes && result && (
          <div className="text-[10px] text-muted-foreground pt-0.5 italic">
            Click a customer dot to inspect its route
          </div>
        )}
      </div>
    </div>
  );
}
