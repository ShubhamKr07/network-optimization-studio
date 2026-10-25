import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { EntityMarkers, markerEnvelope, type EntityMarkersToggles } from "@/components/workspace/map/EntityMarkers";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { InvalidateOnResize } from "@/components/workspace/map/InvalidateOnResize";
import L from "leaflet";
import { MapActionMenu, actionsInContext, type EntityActionKey } from "@/components/workspace/map/MapActionMenu";
import { MapDetailsCard } from "@/components/workspace/map/MapDetailsCard";
import { MapAnchorBridge } from "@/components/workspace/map/MapAnchorBridge";
import type { Point, Size } from "@/components/workspace/map/placeCard";
import { MoveConfirmDialog } from "@/components/workspace/map/dialogs/MoveConfirmDialog";
import { JADE_WAREHOUSE_ROLE, PLANT_ROLE, type MapEntity } from "@/components/workspace/map/types";
import { MapEventsBridge, GhostFollower, AddEntityMenu, LayerCheckbox, type OverlayAnchor } from "@/components/workspace/map/mapControls";
import { SuperEntityDialog } from "./SuperEntityDialog";
import { LOC_TABLE, addLocation, copyLocation, demandOf, editLocation, moveLocation, nextFreeId, superMapRows, type LocKind, type LocationDraft } from "@/lib/superNetwork";
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

export function SuperInputMap({ inputs, fitKey, onInputsChange, onRequestDelete, readOnly }: Extract<InputMapTabProps, { mode: "super" }>): ReactNode {
  const rows = useMemo(() => superMapRows(inputs), [inputs]);
  const [toggles, setToggles] = useState<EntityMarkersToggles>({ plants: true, warehouses: true, customers: true, showInactive: true, sizeByDemand: false });
  const points = useMemo<[number, number][]>(
    () => [...rows.plants, ...rows.warehouses, ...rows.customers].map(l => [l.lat, l.lng]), [rows]);
  const [menu, setMenu] = useState<({ entity: MapEntity } & OverlayAnchor) | null>(null);
  const [selected, setSelected] = useState<{ entity: MapEntity; containerSize: Size } | null>(null);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [addAt, setAddAt] = useState<({ lat: number; lng: number } & OverlayAnchor) | null>(null);
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; kind: LocKind; initial: LocationDraft; demand: Record<string, number> } | null>(null);
  const [armedMove, setArmedMove] = useState<MapEntity | null>(null);
  const [moveTo, setMoveTo] = useState<{ entity: MapEntity; lat: number; lng: number } | null>(null);
  const takenIds = useMemo(() => new Set([...rows.plants, ...rows.warehouses, ...rows.customers].map(l => l.id)), [rows]);
  const draggable = useMemo(() => (readOnly ? NO_DRAG : takenIds), [readOnly, takenIds]);
  const rowOf = (e: MapEntity) => inputs[LOC_TABLE[e.kind]].find(r => r.id === e.entity.id)!;

  // Same as the other maps: Escape cancels an armed Move from anywhere.
  useEffect(() => {
    if (!armedMove) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setArmedMove(null); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [armedMove]);

  function onMapClick(e: L.LeafletMouseEvent) {
    if (armedMove) { setMoveTo({ entity: armedMove, lat: e.latlng.lat, lng: e.latlng.lng }); setArmedMove(null); return; }
    setMenu(null); setAddAt(null); setSelected(null);
  }
  function onMapContextMenu(e: L.LeafletMouseEvent) {
    if (readOnly) return;
    setMenu(null); setSelected(null);
    setAddAt({ lat: e.latlng.lat, lng: e.latlng.lng, containerPoint: e.containerPoint });
  }
  function onMarkerRightClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    if (readOnly) return;
    setAddAt(null); setSelected(null);
    setMenu({ entity, containerPoint: e.containerPoint });
  }
  function startCreate(kind: LocKind) {
    if (!addAt) return;
    setDialog({ mode: "create", kind, demand: {}, initial: { id: nextFreeId(inputs, kind), lat: addAt.lat, lng: addAt.lng, ...(kind === "pl" ? {} : { status: "active" }) } });
    setAddAt(null);
  }
  function actOn(key: EntityActionKey, entity: MapEntity) {
    if (key === "edit") {
      const r = rowOf(entity);
      setDialog({ mode: "edit", kind: entity.kind,
        initial: { id: String(r.id), city: r.city as string | undefined, state: r.state as string | undefined, lat: Number(r.lat), lng: Number(r.lng), status: r.status as string | undefined },
        demand: entity.kind === "cs" ? demandOf(inputs, String(r.id)) : {} });
    } else if (key === "move") setArmedMove(entity);
    else if (key === "copy") onInputsChange(copyLocation(inputs, entity.kind, entity.entity.id));
    else onRequestDelete(LOC_TABLE[entity.kind], entity.entity.id);
    setMenu(null);
  }
  const flip = (k: "plants" | "warehouses" | "customers") => setToggles(t => ({ ...t, [k]: !(t[k] ?? true) }));
  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0" data-testid="super-map-toolbar">
        <span className="text-xs text-muted-foreground">Layers:</span>
        <LayerCheckbox testId="toggle-layer-plants" checked={toggles.plants ?? true} onToggle={() => flip("plants")}>Plants</LayerCheckbox>
        <LayerCheckbox testId="toggle-layer-warehouses" checked={toggles.warehouses} onToggle={() => flip("warehouses")}>Warehouses</LayerCheckbox>
        <LayerCheckbox testId="toggle-layer-customers" checked={toggles.customers} onToggle={() => flip("customers")}>Customers</LayerCheckbox>
      </div>
      {armedMove && (
        <div className="flex items-center gap-2 text-xs bg-warning-bg border border-warning-border rounded px-2 py-1" data-testid="armed-status-bar">
          <span>Click a map location to move {armedMove.entity.displayCode} — Esc to cancel</span>
          <Button size="sm" variant="outline" className="h-6 text-2xs" onClick={() => setArmedMove(null)} data-testid="button-armed-cancel">Cancel</Button>
        </div>
      )}
      <div className="flex-1 min-h-0 relative" ref={wrapperRef}>
        <MapContainer center={WORLD} zoom={2} className="h-full w-full" scrollWheelZoom>
          <InvalidateOnResize />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          <FitToPoints points={points} fitKey={fitKey} />
          <MapEventsBridge onClick={onMapClick} onContextMenu={onMapContextMenu} onMoveOrZoomStart={() => { setMenu(null); setAddAt(null); }} />
          <MapAnchorBridge latLng={selected ? [selected.entity.entity.lat, selected.entity.entity.lng] : null} onAnchor={setAnchor} />
          {armedMove && <GhostFollower tint="#2563eb" />}
          <EntityMarkers plants={rows.plants} warehouses={rows.warehouses} customers={rows.customers} toggles={toggles}
            selectedKey={selected ? `${selected.entity.kind}:${selected.entity.entity.id}` : undefined}
            onLeftClick={(entity) => { setMenu(null); setAddAt(null); setSelected({ entity, containerSize: { width: wrapperRef.current?.clientWidth ?? 0, height: wrapperRef.current?.clientHeight ?? 0 } }); }} onRightClick={onMarkerRightClick}
            onDragEnd={(entity, ll) => setMoveTo({ entity, lat: ll.lat, lng: ll.lng })} draggableIds={draggable} modelId="super-model" />
        </MapContainer>
        <MapLegend customers={rows.customers} showWarehouseLayer={toggles.warehouses} showCustomerLayer={toggles.customers}
          sizeByDemand={false} showPlantLayer={toggles.plants ?? true} />
        {selected && anchor && (
          <MapDetailsCard entity={selected.entity} anchor={anchor} containerSize={selected.containerSize}
            markerSize={markerEnvelope(selected.entity.kind, selected.entity.entity, { customers: rows.customers, sizeByDemand: false, selected: true })} onClose={() => setSelected(null)}
            actions={actionsInContext(selected.entity, { readOnly })} confirmDelete={false}
            onAction={key => { const entity = selected.entity; setSelected(null); actOn(key, entity); }} />
        )}
        {menu && (
          <MapActionMenu entity={menu.entity} containerPoint={menu.containerPoint} confirmDelete={false} onClose={() => setMenu(null)}
            onEdit={() => actOn("edit", menu.entity)} onMove={() => actOn("move", menu.entity)}
            onCopy={() => actOn("copy", menu.entity)} onDelete={() => actOn("delete", menu.entity)} />
        )}
        {addAt && <AddEntityMenu containerPoint={addAt.containerPoint} showPlantOption onAdd={startCreate} onClose={() => setAddAt(null)} />}
      </div>
      {dialog && (
        <SuperEntityDialog mode={dialog.mode} kind={dialog.kind} initial={dialog.initial} initialDemand={dialog.demand}
          products={inputs.products.map(p => ({ id: String(p.id), name: String(p.name) }))} takenIds={takenIds}
          onCancel={() => setDialog(null)}
          onSubmit={(row, demand) => {
            onInputsChange(dialog.mode === "create" ? addLocation(inputs, dialog.kind, row, demand) : editLocation(inputs, dialog.kind, row, demand));
            setDialog(null);
          }} />
      )}
      {moveTo && (
        <MoveConfirmDialog kind={moveTo.entity.kind}
          role={moveTo.entity.kind === "wh" ? JADE_WAREHOUSE_ROLE : moveTo.entity.kind === "pl" ? PLANT_ROLE : undefined}
          entity={{ id: moveTo.entity.entity.id, displayCode: moveTo.entity.entity.displayCode }}
          newLat={moveTo.lat} newLng={moveTo.lng} existingCodes={takenIds} preserveIdentity
          onCancel={() => setMoveTo(null)}
          onConfirm={next => { onInputsChange(moveLocation(inputs, moveTo.entity.kind, moveTo.entity.entity.id, next.lat, next.lng)); setMoveTo(null); }} />
      )}
    </div>
  );
}
