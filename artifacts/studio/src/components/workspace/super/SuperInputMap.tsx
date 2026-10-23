import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { EntityMarkers, type EntityMarkersToggles } from "@/components/workspace/map/EntityMarkers";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { InvalidateOnResize } from "@/components/workspace/map/InvalidateOnResize";
import { LayerCheckbox } from "@/components/workspace/map/mapControls";
import { superMapRows } from "@/lib/superNetwork";
import type { InputMapTabProps } from "@/components/workspace/tabs/InputMapTab";

const WORLD: [number, number] = [20, 0];
const NO_DRAG = new Set<string>();

/** §6.1 fit rules. Runs on mount and when fitKey changes, never on point edits (points are read through a ref). */
export function FitToPoints({ points, fitKey }: { points: [number, number][]; fitKey: number }): null {
  const map = useMap();
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) map.setView(WORLD, 2);
    else if (pts.length === 1) map.setView(pts[0], 8);
    else map.fitBounds(pts, { padding: [40, 40], maxZoom: 10 });
  }, [map, fitKey]);
  return null;
}

export function SuperInputMap({ inputs, fitKey }: Extract<InputMapTabProps, { mode: "super" }>): ReactNode {
  const rows = useMemo(() => superMapRows(inputs), [inputs]);
  const [toggles, setToggles] = useState<EntityMarkersToggles>({ plants: true, warehouses: true, customers: true, showInactive: true, sizeByDemand: false });
  const points = useMemo<[number, number][]>(
    () => [...rows.plants, ...rows.warehouses, ...rows.customers].map(l => [l.lat, l.lng]), [rows]);
  const flip = (k: "plants" | "warehouses" | "customers") => setToggles(t => ({ ...t, [k]: !(t[k] ?? true) }));
  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0" data-testid="super-map-toolbar">
        <span className="text-xs text-muted-foreground">Layers:</span>
        <LayerCheckbox testId="toggle-layer-plants" checked={toggles.plants ?? true} onToggle={() => flip("plants")}>Plants</LayerCheckbox>
        <LayerCheckbox testId="toggle-layer-warehouses" checked={toggles.warehouses} onToggle={() => flip("warehouses")}>Warehouses</LayerCheckbox>
        <LayerCheckbox testId="toggle-layer-customers" checked={toggles.customers} onToggle={() => flip("customers")}>Customers</LayerCheckbox>
      </div>
      <div className="flex-1 min-h-0 relative">
        <MapContainer center={WORLD} zoom={2} className="h-full w-full" scrollWheelZoom>
          <InvalidateOnResize />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          <FitToPoints points={points} fitKey={fitKey} />
          <EntityMarkers plants={rows.plants} warehouses={rows.warehouses} customers={rows.customers} toggles={toggles}
            onLeftClick={() => {}} onRightClick={() => {}} onDragEnd={() => {}} draggableIds={NO_DRAG} modelId="super-model" />
        </MapContainer>
        <MapLegend customers={rows.customers} showWarehouseLayer={toggles.warehouses} showCustomerLayer={toggles.customers}
          sizeByDemand={false} showPlantLayer={toggles.plants ?? true} />
      </div>
    </div>
  );
}
