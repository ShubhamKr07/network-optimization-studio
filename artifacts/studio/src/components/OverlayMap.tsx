import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker } from "react-leaflet";
import L from "leaflet";
import type { Dataset, SolveResult } from "@workspace/api-client-react";

const createTriangleIcon = (isOpen: boolean) => {
  const fill = isOpen ? "#16A34A" : "none";
  const stroke = isOpen ? "#16A34A" : "#64748B";

  const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <polygon points="12,2 22,20 2,20" fill="${fill}" stroke="${stroke}" stroke-width="2" />
  </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

interface OverlayMapProps {
  dataset: Dataset;
  beforeResult: SolveResult;
  afterResult: SolveResult;
  mode: "before" | "after" | "overlay";
}

export function OverlayMap({ dataset, beforeResult, afterResult, mode }: OverlayMapProps) {
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

  const currentResult = mode === "before" ? beforeResult : afterResult;
  
  // Overlay mode calculations
  const beforeRoutes = new Set(beforeResult.assignments.map(a => `${a.customerId}-${a.warehouseId}`));
  const afterRoutes = new Set(afterResult.assignments.map(a => `${a.customerId}-${a.warehouseId}`));

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-white border rounded-lg overflow-hidden shadow-sm">
      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        className="w-full flex-1 z-0"
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution="CartoDB"
        />

        {mode === "overlay" ? (
          <>
            {/* Unchanged routes */}
            {afterResult.assignments.filter(a => beforeRoutes.has(`${a.customerId}-${a.warehouseId}`)).map((assignment, i) => {
              const customer = dataset.customers.find((c) => c.id === assignment.customerId);
              const warehouse = dataset.warehouses.find((w) => w.id === assignment.warehouseId);
              if (!customer || !warehouse) return null;
              return (
                <Polyline
                  key={`unchanged-${i}`}
                  positions={[[customer.lat, customer.lng], [warehouse.lat, warehouse.lng]]}
                  color="#E2E8F0"
                  weight={1}
                  opacity={0.5}
                />
              );
            })}
            {/* Removed routes */}
            {beforeResult.assignments.filter(a => !afterRoutes.has(`${a.customerId}-${a.warehouseId}`)).map((assignment, i) => {
              const customer = dataset.customers.find((c) => c.id === assignment.customerId);
              const warehouse = dataset.warehouses.find((w) => w.id === assignment.warehouseId);
              if (!customer || !warehouse) return null;
              return (
                <Polyline
                  key={`removed-${i}`}
                  positions={[[customer.lat, customer.lng], [warehouse.lat, warehouse.lng]]}
                  color="#94A3B8"
                  weight={1.5}
                  dashArray="4"
                  opacity={0.7}
                />
              );
            })}
            {/* New routes */}
            {afterResult.assignments.filter(a => !beforeRoutes.has(`${a.customerId}-${a.warehouseId}`)).map((assignment, i) => {
              const customer = dataset.customers.find((c) => c.id === assignment.customerId);
              const warehouse = dataset.warehouses.find((w) => w.id === assignment.warehouseId);
              if (!customer || !warehouse) return null;
              return (
                <Polyline
                  key={`new-${i}`}
                  positions={[[customer.lat, customer.lng], [warehouse.lat, warehouse.lng]]}
                  color="#2D6CDF"
                  weight={2}
                  opacity={0.9}
                />
              );
            })}
          </>
        ) : (
          currentResult.assignments.map((assignment, i) => {
            const customer = dataset.customers.find((c) => c.id === assignment.customerId);
            const warehouse = dataset.warehouses.find((w) => w.id === assignment.warehouseId);
            if (!customer || !warehouse) return null;

            return (
              <Polyline
                key={`route-${i}`}
                positions={[[customer.lat, customer.lng], [warehouse.lat, warehouse.lng]]}
                color="#16A34A"
                weight={1.5}
                opacity={0.5}
              />
            );
          })
        )}

        {dataset.customers.map((c) => (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lng]}
            radius={scaleDemand(c.demand)}
            fillColor="#94A3B8"
            fillOpacity={0.7}
            stroke={true}
            color="#64748B"
            weight={1}
          />
        ))}

        {dataset.warehouses.map((w) => {
          let isOpen = false;
          if (mode === "overlay") {
             isOpen = afterResult.openWarehouseIds.includes(w.id) || beforeResult.openWarehouseIds.includes(w.id);
          } else {
             isOpen = currentResult.openWarehouseIds.includes(w.id);
          }
          
          return (
            <Marker key={w.id} position={[w.lat, w.lng]} icon={createTriangleIcon(isOpen)}>
              {isOpen && (
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

      {mode === "overlay" && (
        <div className="absolute bottom-4 right-4 bg-white border border-border p-2 rounded-md shadow flex flex-col gap-2 z-10 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-[#2D6CDF]"></div>
              <span className="text-muted-foreground">New routes</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 border-b border-dashed border-[#94A3B8]"></div>
              <span className="text-muted-foreground">Removed</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-[#E2E8F0]"></div>
              <span className="text-muted-foreground">Unchanged</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
