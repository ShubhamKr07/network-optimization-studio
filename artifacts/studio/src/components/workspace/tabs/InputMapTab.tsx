import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer, TileLayer, Marker, CircleMarker, Tooltip, useMapEvents } from "react-leaflet";
import type L from "leaflet";
import { Save } from "lucide-react";
import { getMapBoundsProps, type CountryBounds } from "@/lib/mapBounds";
import { Button } from "@/components/ui/button";
import { EntityMarkers, type EntityMarkersToggles } from "@/components/workspace/map/EntityMarkers";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { MapDetailsCard } from "@/components/workspace/map/MapDetailsCard";
import { MapActionMenu } from "@/components/workspace/map/MapActionMenu";
import { EditWarehouseDialog } from "@/components/workspace/map/dialogs/EditWarehouseDialog";
import { EditCustomerDialog } from "@/components/workspace/map/dialogs/EditCustomerDialog";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { MoveConfirmDialog } from "@/components/workspace/map/dialogs/MoveConfirmDialog";
import type { WhStatus } from "@/components/workspace/map/statusPresentation";
import { MINE_ROLE, STATION_ROLE, REFINERY_ROLE } from "@/components/workspace/map/types";
import type {
  MapWarehouse,
  MapCustomer,
  MapEntity,
  PMedianMapInputs,
  AddedWarehouseInput,
  AddedCustomerInput,
} from "@/components/workspace/map/types";
// T6 (Bundle 2) — reused verbatim from the *Tab files that already own
// these shapes (same precedent Workspace.tsx's own B6.2
// addedRefineriesFromInputs comment documents: reuse an existing *Tab type
// rather than inventing a third near-identical one), not re-declared here.
import type { AddedMine } from "@/components/workspace/tabs/MinesTab";
import type { AddedStation } from "@/components/workspace/tabs/StationsTab";
import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

// ── Legacy (Task 4) pin shapes — unchanged from before this rewrite ────────
interface PinEntity {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

interface PinGroup {
  kind: string;
  entities: PinEntity[];
}

interface PlacementOption {
  key: string; // matches inputEntriesForModel()'s own entity id ("warehouses", "customers", "mines", "stations", "refineries")
  label: string;
}

// T6 (Bundle 2) — the `inputs` slice transport-coal's map mode edits.
// TransportLpInputs is NOT PMedianMapInputs-shaped: no warehouseOverrides/
// customerOverrides/capacityMode/distanceOverrides — mines/stations use
// sparse mineCapacities/stationDemands maps (base-entity capacity/demand
// overrides) and a laneCostOverrides array (transport's own name for
// distance-like arcs, see validation/inputs/transportLp.ts's own comment on
// why it's "cost" not "distance"). Mirrors PMedianMapInputs's shape/role
// exactly otherwise (an added-row array per rendering role + whatever
// override mechanism the model actually has), one level down.
export interface TransportMapInputs {
  addedMines: AddedMine[];
  addedStations: AddedStation[];
  laneCostOverrides: LaneCostOverride[];
  mineCapacities: Record<string, number>;
  stationDemands: Record<string, number>;
  [k: string]: unknown; // distanceBands, gap, timeLimitSec, capacityFactor, singleSource, capacityInactive, … passed through
}

// T7 (Bundle 2) — the `inputs` slice two-echelon-gold-au's map mode edits.
// TwoEchelonMapInputs is NOT PMedianMapInputs-shaped either: refineries use
// `refineryOverrides` (not `warehouseOverrides`), and there is no
// `capacityMode`/capacity concept at all for refineries (twoEchelon.ts's
// addedRefinerySchema comment: "No capacity field — this model's manifest
// already declares capacityModes: []"). `customerOverrides` and
// `distanceOverrides` DO share p-median-us's exact shape verbatim — the
// latter is a deliberate B6.2 stage-1 naming choice covering BOTH legs
// (mine->refinery, refinery->customer) in one flat array, resolved purely by
// which disjoint id-space fromId/toId fall into (see solve_two_echelon /
// twoEchelon.ts's own comment) — so this slice types them identically here,
// not re-declared. The fixed mine carries NO overridable state at all (never
// in `refineryOverrides`/`addedRefineries` — see TwoEchelonInputMap's own
// `mine` prop comment), so this slice has no field for it either.
export interface TwoEchelonMapInputs {
  addedRefineries: AddedWarehouseInput[];
  addedCustomers: AddedCustomerInput[];
  refineryOverrides: { id: string; status: WhStatus }[];
  customerOverrides: { id: string; demand?: number | null; status: "active" | "excluded" }[];
  distanceOverrides: { fromId: string; toId: string; distance: number; estimated?: boolean }[];
  [k: string]: unknown; // bomRatio, gap, timeLimitSec, distanceBands, … passed through
}

// T8 (Input Map v2) — discriminated union so p-median's real map surface
// (warehouses/customers/inputs/onInputsChange) isn't a mandatory prop shape
// for the other two callers, which still get the Task-4 pin-drop map
// ("legacy") or a placeholder (p-median-brazil has no per-row dataset
// endpoint, same boundary every other Brazil input tab already draws — see
// Workspace.tsx's own inputEntriesForModel comment).
export type InputMapTabProps =
  | {
      mode: "pmedian";
      /** Optional — GET /api/models (the source of countryBounds) can resolve
       * after this tab's first mount (E5.1/Round 3's own documented gap). */
      countryBounds?: CountryBounds;
      warehouses: MapWarehouse[];
      customers: MapCustomer[];
      inputs: PMedianMapInputs;
      onInputsChange: (next: PMedianMapInputs) => void;
      /** R4 — Save relocated into this tab's own `Layers:` row for
       * p-median-us (Workspace.tsx suppresses its own toolbar Save exactly
       * when this prop is wired — see that file's `saveInLayersRow`).
       * Optional/capability-gated on `onSave` being present, not on `mode`
       * alone, matching this codebase's standing "gate on the callback, not
       * the entity name" convention (CLAUDE.md's model-integration-precheck
       * Gate 1) — keeps every existing caller that doesn't pass these
       * (InputMapTabV2.test.tsx) compiling unchanged. */
      isDirty?: boolean;
      onSave?: () => void;
      saving?: boolean;
      /** T5 (Bundle 2, Step 1b) — the active model's `capabilities.demandEditable`.
       * Defaults true when absent (p-median-us's own behavior, unchanged).
       * false (p-median-brazil — textbook-fixed region demand) suppresses
       * editing a BASE customer's demand; an ADDED customer always stays
       * editable regardless (see handleEditSubmit's own comment below). */
      demandEditable?: boolean;
    }
  | {
      mode: "legacy";
      countryBounds?: CountryBounds;
      pins: PinGroup[];
      placementOptions: PlacementOption[];
      onPlacePoint: (lat: number, lng: number, kind: string) => void;
    }
  | {
      // T6 (Bundle 2) — transport-coal's full-v2 editor. A separate mode
      // from "pmedian" (not a third branch reusing PMedianMapInputs) because
      // TransportLpInputs genuinely isn't PMedianMapInputs-shaped — see
      // TransportMapInputs's own comment. R3 (status markers) and R7
      // (hide-closed) are N/A for this model (supportsFacilityStatus:false,
      // solve_transport has no facility open/close concept) — this mode
      // never renders that UI at all, rather than rendering it disabled.
      mode: "transport";
      countryBounds?: CountryBounds;
      mines: MapWarehouse[];
      stations: MapCustomer[];
      inputs: TransportMapInputs;
      onInputsChange: (next: TransportMapInputs) => void;
      /** R4 — Save relocated into this tab's own Layers row, same as
       * "pmedian" mode's onSave (see that variant's own comment). */
      isDirty?: boolean;
      onSave?: () => void;
      saving?: boolean;
    }
  | {
      // T7 (Bundle 2) — two-echelon-gold-au's full-v2 editor. Refineries
      // render in the "wh" (triangle) rendering role via REFINERY_ROLE
      // (hasStatus:true — R3 status paint/legend apply, unlike transport's
      // mines) and DD-7 mints their added-row uid via role.uidKind="wh" ->
      // "aw-", never a new "ar-" prefix. The fixed mine is READ-ONLY
      // context, deliberately NOT part of `refineries` — it's rendered by
      // this mode as a plain, non-interactive marker with zero edit
      // affordances (see this variant's own `mine` prop comment) rather than
      // unioned into the same array PMedianInputMap/TransportInputMap render
      // their triangle-role entities from.
      mode: "twoEchelon";
      countryBounds?: CountryBounds;
      /** The dataset's one fixed WarehouseCandidate.kind==="mine" row,
       * translated to MapWarehouse purely for its displayCode/city/state/
       * lat/lng — `status`/`isAdded`/`capacity` are never read for it, and it
       * is never draggable, never a valid armed-move/copy drop target, and
       * never opens an action menu (see TwoEchelonInputMap's render — it's
       * a bare react-leaflet `<Marker>` with no event handlers at all, kept
       * entirely outside EntityMarkers' interactive click-routing). Null
       * only if the dataset hasn't resolved a mine row yet (defensive —
       * two-echelon-gold-au's dataset always has exactly one). */
      mine: MapWarehouse | null;
      refineries: MapWarehouse[];
      customers: MapCustomer[];
      inputs: TwoEchelonMapInputs;
      onInputsChange: (next: TwoEchelonMapInputs) => void;
      /** R4 — Save relocated into this tab's own Layers row, same as
       * "pmedian"/"transport" mode's onSave (see those variants' own
       * comments). */
      isDirty?: boolean;
      onSave?: () => void;
      saving?: boolean;
    }
  | { mode: "placeholder" };

export function InputMapTab(props: InputMapTabProps): ReactNode {
  if (props.mode === "placeholder") return <PlaceholderInputMap />;
  if (props.mode === "legacy") return <LegacyInputMap {...props} />;
  if (props.mode === "transport") return <TransportInputMap {...props} />;
  if (props.mode === "twoEchelon") return <TwoEchelonInputMap {...props} />;
  return <PMedianInputMap {...props} />;
}

// p-median-brazil has no `GET /dataset` entry (openapi.yaml's `modelId`
// enum) — same message shape Workspace.tsx's own Warehouses/Customers
// placeholder branch already uses for this model.
function PlaceholderInputMap() {
  return (
    <span className="text-muted-foreground" data-testid="tab-content-placeholder">
      Input Map — not available for this model yet (no per-row dataset endpoint exists for p-median-brazil).
    </span>
  );
}

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Phase 3.2, Task 4 (unchanged) — pre-solve map: shows current base + added
// entities as pins, and lets a click drop a DRAFT marker with a
// Confirm/Cancel panel (rendered outside the Leaflet tree, in this
// component's own JSX, NOT inside a <Popup> nested in a <Marker> — a Popup
// there stays closed until the marker itself is clicked, real Leaflet
// behavior, which would make the controls invisible without an extra click
// nobody's told to make) before anything is actually added. Deliberately
// does not reuse NetworkMap.tsx, which is coupled to solve-result
// edges/bands/routes; this component only ever needs static pins + one
// click handler. transport-coal and two-echelon-gold-au both stay on this
// simpler flow (T8) — their Mines/Stations/Refineries/Customers tabs have no
// override-projection/edit-in-place concept the way p-median-us's map does.
function LegacyInputMap({
  countryBounds,
  pins,
  placementOptions,
  onPlacePoint,
}: Extract<InputMapTabProps, { mode: "legacy" }>) {
  const [activeKind, setActiveKind] = useState(placementOptions[0]?.key ?? "");
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const boundsProps = getMapBoundsProps(countryBounds);
  // Same fix NetworkMap.tsx/OutputMapTab.tsx already carry (E5.1/Round 3):
  // MapContainer only applies center/maxBounds/minZoom at construction —
  // keying on the resolved bounds forces a remount once the real
  // countryBounds lands, instead of getting stuck on the fallback.
  const mapKey = countryBounds ? `${countryBounds.sw.join(",")}_${countryBounds.ne.join(",")}` : "fallback";

  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-shrink-0" data-testid="input-map-placement-toggle">
        <span className="text-xs text-muted-foreground">Placing:</span>
        <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit">
          {placementOptions.map(opt => (
            <button
              key={opt.key}
              type="button"
              data-testid={`button-input-map-place-${opt.key}`}
              onClick={() => setActiveKind(opt.key)}
              className={`px-2 py-1 transition-colors whitespace-nowrap ${
                activeKind === opt.key ? "bg-primary text-white" : "bg-white text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {draft && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-300 rounded px-2 py-1" data-testid="input-map-draft-panel">
            <span>Lat: {draft.lat.toFixed(4)}, Lng: {draft.lng.toFixed(4)} — placing {placementOptions.find(o => o.key === activeKind)?.label}</span>
            <Button
              size="sm"
              className="h-6 text-[10px]"
              data-testid="button-input-map-confirm"
              onClick={() => { onPlacePoint(draft.lat, draft.lng, activeKind); setDraft(null); }}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              data-testid="button-input-map-cancel"
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <MapContainer key={mapKey} {...boundsProps} zoom={4} className="h-full w-full" scrollWheelZoom>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="CartoDB" />
          <ClickCapture onClick={(lat, lng) => setDraft({ lat, lng })} />
          {pins.map(group => group.entities.map(e => (
            <Marker key={`${group.kind}-${e.id}`} position={[e.lat, e.lng]} />
          )))}
          {/* Visually distinct from committed pins (dashed amber outline,
              CircleMarker rather than the default Marker icon) rather than
              a custom icon asset. No `data-testid` here — CircleMarkerProps
              doesn't extend any DOM-attribute interface (confirmed against
              @react-leaflet/core's own types), so an arbitrary data-* prop
              doesn't type-check; the draft panel's own
              `input-map-draft-panel` testid is what tests assert against. */}
          {draft && (
            <CircleMarker
              center={[draft.lat, draft.lng]}
              radius={8}
              pathOptions={{ color: "#f59e0b", dashArray: "4", fillOpacity: 0.3 }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

// ── p-median-us real map surface (T8) ───────────────────────────────────────

const EMPTY_ID_SET = new Set<string>();

type OverlayAnchor = { containerPoint: { x: number; y: number }; containerSize?: { width: number; height: number } };

// Bridges react-leaflet's imperative `useMapEvents` (must be a child of
// `MapContainer`) into plain callback props for the parent component.
function MapEventsBridge({
  onClick,
  onContextMenu,
  onMoveOrZoomStart,
}: {
  onClick: (e: L.LeafletMouseEvent) => void;
  onContextMenu: (e: L.LeafletMouseEvent) => void;
  onMoveOrZoomStart: () => void;
}) {
  useMapEvents({
    click: onClick,
    // Defensive only, not load-bearing: EntityMarkers already stops native
    // propagation on a marker's own contextmenu (see its own comment), and
    // Leaflet's Marker defaults to `bubblingMouseEvents: false` — a marker
    // right-click never reaches this handler in the first place.
    contextmenu: onContextMenu,
    movestart: onMoveOrZoomStart,
    zoomstart: onMoveOrZoomStart,
  });
  return null;
}

// Renders a dashed "ghost" circle that tracks the cursor while a Move/Copy
// is armed, and reports the next map click as the drop destination — the
// mousemove-handler half of the "ghost marker follows the cursor" state
// machine (T8's brief explicitly allows either a draggable-marker ghost or a
// mousemove handler; this is the latter).
function GhostFollower({ tint }: { tint: string }) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  useMapEvents({
    mousemove(e) {
      setPos(e.latlng);
    },
  });
  if (!pos) return null;
  return (
    <CircleMarker
      center={[pos.lat, pos.lng]}
      radius={8}
      pathOptions={{ color: tint, dashArray: "4", fillOpacity: 0.25 }}
    />
  );
}

// Right-click-on-empty-space menu — "Add warehouse here" / "Add customer
// here". Deliberately its own small component (not a reuse of
// MapActionMenu, which is entity-specific) since it has no MapEntity to
// operate on, only a raw lat/lng.
function AddEntityMenu({
  containerPoint,
  containerSize,
  onAdd,
  onClose,
}: OverlayAnchor & { onAdd: (kind: "wh" | "cs") => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  let left = containerPoint.x + 6;
  let top = containerPoint.y + 6;
  if (containerSize) {
    left = Math.max(4, Math.min(left, containerSize.width - 170));
    top = Math.max(4, Math.min(top, containerSize.height - 90));
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Add entity here"
      data-testid="map-add-menu"
      className="absolute bg-card border border-border shadow-md text-xs min-w-[150px] z-40"
      style={{ left, top }}
    >
      <button type="button" role="menuitem" data-testid="map-add-menu-wh" className="w-full text-left px-3 py-1.5 hover:bg-accent-100" onClick={() => onAdd("wh")}>
        Add warehouse here
      </button>
      <button type="button" role="menuitem" data-testid="map-add-menu-cs" className="w-full text-left px-3 py-1.5 hover:bg-accent-100" onClick={() => onAdd("cs")}>
        Add customer here
      </button>
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`px-2 py-1 rounded text-[10px] border transition-colors whitespace-nowrap ${
        active ? "bg-primary text-white border-primary" : "bg-white text-muted-foreground border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

// ── Pure PMedianMapInputs mutators — D7 identity contract: an added
// entity's `id` is the stable join key and NEVER changes, only
// displayCode/coords/status/capacity/demand do. Move/delete touch ONLY the
// added row + its own distanceOverrides; base-entity edits go through
// warehouseOverrides/customerOverrides instead, mirroring
// WarehouseTable.tsx/CustomerTable.tsx's own upsert-with-no-op-removal
// semantics exactly (an "active"+no-capacity/no-demand override is removed
// rather than stored, so the map's edit path can never diverge from what
// the Warehouses/Customers tabs would have produced for the same edit). ──

function purgeDistanceOverridesFor(overrides: PMedianMapInputs["distanceOverrides"], id: string) {
  return overrides.filter(o => o.fromId !== id && o.toId !== id);
}

function addedKeyFor(kind: "wh" | "cs"): "addedWarehouses" | "addedCustomers" {
  return kind === "wh" ? "addedWarehouses" : "addedCustomers";
}

function deleteAdded(inputs: PMedianMapInputs, kind: "wh" | "cs", id: string): PMedianMapInputs {
  const key = addedKeyFor(kind);
  const arr = inputs[key] as (AddedWarehouseInput | AddedCustomerInput)[];
  return {
    ...inputs,
    [key]: arr.filter(e => e.id !== id),
    distanceOverrides: purgeDistanceOverridesFor(inputs.distanceOverrides, id),
  } as PMedianMapInputs;
}

function moveAdded(
  inputs: PMedianMapInputs,
  kind: "wh" | "cs",
  id: string,
  next: { displayCode: string; city: string; state: string; lat: number; lng: number },
): PMedianMapInputs {
  const key = addedKeyFor(kind);
  const arr = inputs[key] as (AddedWarehouseInput | AddedCustomerInput)[];
  return {
    ...inputs,
    [key]: arr.map(e => (e.id === id ? { ...e, ...next } : e)),
    // The entity's own distances no longer describe its new location —
    // dropped so they re-estimate on Save (T1's normalizer), never touching
    // warehouseOverrides/customerOverrides.
    distanceOverrides: purgeDistanceOverridesFor(inputs.distanceOverrides, id),
  } as PMedianMapInputs;
}

function editAddedWarehouse(inputs: PMedianMapInputs, id: string, patch: { status: WhStatus; capacity?: number | null }): PMedianMapInputs {
  return {
    ...inputs,
    addedWarehouses: inputs.addedWarehouses.map(w => (w.id === id ? { ...w, ...patch } : w)),
  };
}

function editAddedCustomer(inputs: PMedianMapInputs, id: string, demand: number): PMedianMapInputs {
  return {
    ...inputs,
    addedCustomers: inputs.addedCustomers.map(c => (c.id === id ? { ...c, demand } : c)),
  };
}

// Mirrors WarehouseTable.tsx's `upsert` exactly (existing status/capacity
// carried forward, "active"+no-capacity removed rather than stored as a
// no-op override).
function editBaseWarehouseOverride(inputs: PMedianMapInputs, id: string, patch: { status: WhStatus; capacity?: number | null }): PMedianMapInputs {
  const existing = inputs.warehouseOverrides.find(o => o.id === id);
  const capacity = "capacity" in patch ? patch.capacity : existing?.capacity;
  const merged = { id, status: patch.status, capacity };
  const rest = inputs.warehouseOverrides.filter(o => o.id !== id);
  const isNoOp = merged.status === "active" && merged.capacity == null;
  return { ...inputs, warehouseOverrides: isNoOp ? rest : [...rest, merged] };
}

// Mirrors CustomerTable.tsx's `upsert` exactly — preserves the existing
// override's status (or "active" if none), never touched by a demand-only
// edit from this map's EditCustomerDialog (which has no status field).
function editBaseCustomerOverride(inputs: PMedianMapInputs, id: string, demand: number): PMedianMapInputs {
  const existing = inputs.customerOverrides.find(o => o.id === id);
  const merged = { id, status: existing?.status ?? "active", demand };
  const rest = inputs.customerOverrides.filter(o => o.id !== id);
  const isNoOp = merged.status === "active" && merged.demand == null;
  return { ...inputs, customerOverrides: isNoOp ? rest : [...rest, merged] };
}

function addWarehouseRow(inputs: PMedianMapInputs, row: AddedWarehouseInput): PMedianMapInputs {
  return { ...inputs, addedWarehouses: [...inputs.addedWarehouses, row] };
}

function addCustomerRow(inputs: PMedianMapInputs, row: AddedCustomerInput): PMedianMapInputs {
  return { ...inputs, addedCustomers: [...inputs.addedCustomers, row] };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

type CreateState = {
  kind: "wh" | "cs";
  lat: number;
  lng: number;
  copyFrom?: AddedWarehouseInput | AddedCustomerInput | { capacity?: number | null; demand?: number };
};

// T8 — the real p-median-us Input Map surface: base dataset rows with
// scenario overrides applied, unioned with scenario-local added rows
// (Workspace.tsx's projection — see its own pmedianMapWarehouses/
// pmedianMapCustomers comment), rendered via T4's EntityMarkers/MapLegend,
// T5's inspect card/action menu, T6's edit dialogs, T7's create/move
// dialogs. Every interaction produces a NEW `inputs` object and calls
// `onInputsChange` — nothing persists until the student clicks Save
// (Workspace.tsx's manual-Save-only toolbar, gated on isEditableInputTab
// including "input-map" for this model).
function PMedianInputMap({
  countryBounds,
  warehouses,
  customers,
  inputs,
  onInputsChange,
  isDirty,
  onSave,
  saving,
  demandEditable = true,
}: Extract<InputMapTabProps, { mode: "pmedian" }>) {
  const [toggles, setToggles] = useState<EntityMarkersToggles>({ warehouses: true, customers: true, showInactive: false });
  const [pinMode, setPinMode] = useState<{ key: "wh" | "cs" } | null>(null);
  const [selected, setSelected] = useState<({ entity: MapEntity } & OverlayAnchor) | null>(null);
  const [actionMenu, setActionMenu] = useState<
    ({ entity: MapEntity; openId: number; restoreFocusTo: HTMLElement | null } & OverlayAnchor) | null
  >(null);
  const actionMenuOpenIdRef = useRef(0);
  const [addMenu, setAddMenu] = useState<({ lat: number; lng: number } & OverlayAnchor) | null>(null);
  const [editEntity, setEditEntity] = useState<MapEntity | null>(null);
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [armed, setArmed] = useState<{ kind: "move" | "copy"; entity: MapEntity } | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ entity: MapEntity; newLat: number; newLng: number } | null>(null);
  const [livePreview, setLivePreview] = useState<{ id: string; demand: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const boundsProps = getMapBoundsProps(countryBounds);
  const mapKey = countryBounds ? `${countryBounds.sw.join(",")}_${countryBounds.ne.join(",")}` : "fallback";

  const existingCodes = useMemo(() => {
    const codes = new Set<string>();
    warehouses.forEach(w => codes.add(w.displayCode));
    customers.forEach(c => codes.add(c.displayCode));
    return codes;
  }, [warehouses, customers]);

  const medianDemand = useMemo(() => median(customers.map(c => c.demand)), [customers]);

  // D7 — draggable ONLY for added entities, and dragend routes through the
  // exact same MoveConfirmDialog the action-menu "Move" flow uses (never
  // commits a move silently) — the "one explicit state machine" the brief
  // requires, with native drag as a second entry point into it rather than
  // a second, competing code path.
  const draggableIds = useMemo(() => {
    const ids = new Set<string>();
    warehouses.forEach(w => { if (w.isAdded) ids.add(w.id); });
    customers.forEach(c => { if (c.isAdded) ids.add(c.id); });
    return ids;
  }, [warehouses, customers]);

  // Live-preview bubble resize while EditCustomerDialog is open — rendering
  // concern only, rolled back on Cancel (nothing is written to `inputs`
  // until Save).
  const displayCustomers = useMemo(
    () => (livePreview ? customers.map(c => (c.id === livePreview.id ? { ...c, demand: livePreview.demand } : c)) : customers),
    [customers, livePreview],
  );

  function getContainerSize() {
    const el = wrapperRef.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : undefined;
  }

  function closeOverlays() {
    setSelected(null);
    setActionMenu(null);
    setAddMenu(null);
  }

  // Escape cancels an armed Move/Copy from anywhere (not just while the
  // action menu that armed it is still open — it's already closed by then).
  useEffect(() => {
    if (!armed) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setArmed(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [armed]);

  // Tracks whatever was truly focused right before the most recent
  // mousedown, ANYWHERE in the document — captured in the capture phase, so
  // it always runs before (a) the browser's own default mousedown action
  // (Leaflet markers get `tabindex="0"` from the map's `keyboard: true`
  // default, so a real mousedown on one natively steals focus onto the
  // marker itself, same as clicking any other focusable element) and (b)
  // any bubble-phase listener, including MapActionMenu's own outside-click
  // handler. Reading `document.activeElement` directly inside the
  // `contextmenu` handler below would be too late — by then the native
  // focus-shift onto the clicked marker has already happened, so the menu
  // would "restore" focus back onto the marker it was opened from instead
  // of whatever the student had actually focused beforehand.
  const preMouseDownFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function onMouseDownCapture() {
      preMouseDownFocusRef.current = document.activeElement as HTMLElement | null;
    }
    document.addEventListener("mousedown", onMouseDownCapture, true);
    return () => document.removeEventListener("mousedown", onMouseDownCapture, true);
  }, []);

  function handleEntityLeftClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    setActionMenu(null);
    setAddMenu(null);
    setSelected({ entity, containerPoint: e.containerPoint, containerSize: getContainerSize() });
  }

  function handleEntityRightClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    const restoreFocusTo = preMouseDownFocusRef.current;
    setSelected(null);
    setAddMenu(null);
    actionMenuOpenIdRef.current += 1;
    setActionMenu({
      entity,
      containerPoint: e.containerPoint,
      containerSize: getContainerSize(),
      openId: actionMenuOpenIdRef.current,
      restoreFocusTo,
    });
  }

  function handleEntityDragEnd(entity: MapEntity, latlng: { lat: number; lng: number }) {
    setMoveConfirm({ entity, newLat: latlng.lat, newLng: latlng.lng });
  }

  function handleMapClick(e: L.LeafletMouseEvent) {
    if (armed) {
      const { kind, entity } = armed.entity;
      if (armed.kind === "move") {
        setMoveConfirm({ entity: armed.entity, newLat: e.latlng.lat, newLng: e.latlng.lng });
      } else {
        const copyFrom = kind === "wh" ? { capacity: (entity as MapWarehouse).capacity } : { demand: (entity as MapCustomer).demand };
        setCreateState({ kind, lat: e.latlng.lat, lng: e.latlng.lng, copyFrom });
      }
      setArmed(null);
      return;
    }
    if (pinMode) {
      setCreateState({ kind: pinMode.key, lat: e.latlng.lat, lng: e.latlng.lng });
      return;
    }
    closeOverlays();
  }

  function handleMapContextMenu(e: L.LeafletMouseEvent) {
    if (armed) {
      setArmed(null);
      return;
    }
    setSelected(null);
    setActionMenu(null);
    setAddMenu({ lat: e.latlng.lat, lng: e.latlng.lng, containerPoint: e.containerPoint, containerSize: getContainerSize() });
  }

  function handleMenuEdit() {
    if (!actionMenu) return;
    setEditEntity(actionMenu.entity);
    setActionMenu(null);
  }
  function handleMenuMove() {
    if (!actionMenu) return;
    setArmed({ kind: "move", entity: actionMenu.entity });
    setActionMenu(null);
  }
  function handleMenuCopy() {
    if (!actionMenu) return;
    setArmed({ kind: "copy", entity: actionMenu.entity });
    setActionMenu(null);
  }
  function handleMenuDelete() {
    if (!actionMenu) return;
    const { kind, entity } = actionMenu.entity;
    onInputsChange(deleteAdded(inputs, kind, entity.id));
    setActionMenu(null);
  }

  function handleEditSubmit(patch: { status: WhStatus; capacity?: number | null } | { demand: number }) {
    if (!editEntity) return;
    const { kind, entity } = editEntity;
    if (kind === "wh") {
      const p = patch as { status: WhStatus; capacity?: number | null };
      onInputsChange(entity.isAdded ? editAddedWarehouse(inputs, entity.id, p) : editBaseWarehouseOverride(inputs, entity.id, p));
    } else {
      const p = patch as { demand: number };
      onInputsChange(entity.isAdded ? editAddedCustomer(inputs, entity.id, p.demand) : editBaseCustomerOverride(inputs, entity.id, p.demand));
    }
    setEditEntity(null);
    setLivePreview(null);
  }

  function handleCreateSubmit(row: AddedWarehouseInput | AddedCustomerInput) {
    if (!createState) return;
    onInputsChange(createState.kind === "wh" ? addWarehouseRow(inputs, row as AddedWarehouseInput) : addCustomerRow(inputs, row as AddedCustomerInput));
    setCreateState(null);
  }

  function handleMoveConfirm(next: { displayCode: string; city: string; state: string; lat: number; lng: number }) {
    if (!moveConfirm) return;
    const { kind, entity } = moveConfirm.entity;
    onInputsChange(moveAdded(inputs, kind, entity.id, next));
    setMoveConfirm(null);
  }

  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0" data-testid="pmedian-map-toolbar">
        <span className="text-xs text-muted-foreground">Layers:</span>
        <ToggleChip testId="toggle-layer-warehouses" active={toggles.warehouses} onClick={() => setToggles(t => ({ ...t, warehouses: !t.warehouses }))}>
          Warehouses
        </ToggleChip>
        <ToggleChip testId="toggle-layer-customers" active={toggles.customers} onClick={() => setToggles(t => ({ ...t, customers: !t.customers }))}>
          Customers
        </ToggleChip>
        <ToggleChip testId="toggle-layer-show-inactive" active={toggles.showInactive} onClick={() => setToggles(t => ({ ...t, showInactive: !t.showInactive }))}>
          Show inactive
        </ToggleChip>
        <span className="text-xs text-muted-foreground ml-2">Add on map:</span>
        <ToggleChip testId="button-input-map-place-wh" active={pinMode?.key === "wh"} onClick={() => setPinMode(p => (p?.key === "wh" ? null : { key: "wh" }))}>
          + Warehouse
        </ToggleChip>
        <ToggleChip testId="button-input-map-place-cs" active={pinMode?.key === "cs"} onClick={() => setPinMode(p => (p?.key === "cs" ? null : { key: "cs" }))}>
          + Customer
        </ToggleChip>
        {armed && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-300 rounded px-2 py-1" data-testid="armed-status-bar">
            <span>
              Click a map location to {armed.kind === "move" ? "move" : "copy"} {armed.entity.entity.displayCode} — Esc to cancel
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setArmed(null)} data-testid="button-armed-cancel">
              Cancel
            </Button>
          </div>
        )}
        {/* R4 — Save relocated here (out of Workspace.tsx's own toolbar) for
            p-median-us's Input Map only; reuses the exact same
            `button-save`/`text-unsaved-changes` testids the toolbar Save
            used so no existing assertion needs to know WHERE Save lives,
            only that it's present and behaves the same. `ml-auto` pins it to
            the row's right edge regardless of how many layer/placement chips
            precede it. */}
        {onSave && (
          <div className="flex items-center gap-2 ml-auto">
            {isDirty && (
              <span className="text-xs text-muted-foreground" data-testid="text-unsaved-changes">
                Unsaved changes
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onSave}
              disabled={!isDirty || saving}
              data-testid="button-save"
              className={isDirty ? "border-primary text-primary hover:bg-primary/10" : ""}
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 relative" ref={wrapperRef}>
        <MapContainer key={mapKey} {...boundsProps} zoom={4} className="h-full w-full" scrollWheelZoom>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="CartoDB" />
          <MapEventsBridge onClick={handleMapClick} onContextMenu={handleMapContextMenu} onMoveOrZoomStart={closeOverlays} />
          {armed && <GhostFollower tint={armed.kind === "move" ? "#2563eb" : "#059669"} />}
          <EntityMarkers
            warehouses={warehouses}
            customers={displayCustomers}
            toggles={toggles}
            onLeftClick={handleEntityLeftClick}
            onRightClick={handleEntityRightClick}
            onDragEnd={handleEntityDragEnd}
            draggableIds={draggableIds.size > 0 ? draggableIds : EMPTY_ID_SET}
          />
        </MapContainer>
        {/* Wave-1 follow-up — real scenario customer population (base +
            added, T8's own `displayCustomers` — already includes the live
            EditCustomerDialog preview), not MapLegend's fallback demo
            population, so the legend's quintile-bucket labels match what's
            actually rendered on this map. */}
        <MapLegend customers={displayCustomers} />
        {selected && (
          <MapDetailsCard
            entity={selected.entity}
            containerPoint={selected.containerPoint}
            containerSize={selected.containerSize}
            onClose={() => setSelected(null)}
          />
        )}
        {actionMenu && (
          <MapActionMenu
            // Forces a full unmount/remount on every open (even a re-open
            // for the very same entity+position) so its mount effect always
            // re-focuses the first menu item and its unmount cleanup always
            // restores focus to THIS open's own restoreFocusTo — without
            // this, React can coalesce a "close old / open new" pair (e.g.
            // right-clicking a marker while another marker's menu is still
            // open) into a single props update on the SAME instance, and
            // the effect that captures/restores focus never re-runs.
            key={actionMenu.openId}
            entity={actionMenu.entity}
            containerPoint={actionMenu.containerPoint}
            containerSize={actionMenu.containerSize}
            restoreFocusTo={actionMenu.restoreFocusTo}
            onEdit={handleMenuEdit}
            onMove={handleMenuMove}
            onCopy={handleMenuCopy}
            onDelete={handleMenuDelete}
            onClose={() => setActionMenu(null)}
          />
        )}
        {addMenu && (
          <AddEntityMenu
            containerPoint={addMenu.containerPoint}
            containerSize={addMenu.containerSize}
            onAdd={kind => {
              setCreateState({ kind, lat: addMenu.lat, lng: addMenu.lng });
              setAddMenu(null);
            }}
            onClose={() => setAddMenu(null)}
          />
        )}
      </div>

      {editEntity && editEntity.kind === "wh" && (
        <EditWarehouseDialog
          entity={editEntity.entity}
          capacityMode={inputs.capacityMode}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditEntity(null)}
        />
      )}
      {editEntity && editEntity.kind === "cs" && (
        <EditCustomerDialog
          entity={editEntity.entity}
          // T5 — an ADDED customer is always editable regardless of the
          // model's demandEditable capability (a newly-added region has no
          // textbook demand to protect); only a BASE row is gated.
          demandEditable={demandEditable || editEntity.entity.isAdded}
          onSubmit={handleEditSubmit}
          onLivePreview={demand => setLivePreview({ id: editEntity.entity.id, demand })}
          onCancel={() => {
            setEditEntity(null);
            setLivePreview(null);
          }}
        />
      )}
      {createState && (
        <CreateEntityDialog
          kind={createState.kind}
          lat={createState.lat}
          lng={createState.lng}
          existingCodes={existingCodes}
          copyFrom={createState.copyFrom}
          medianDemand={medianDemand}
          onSubmit={handleCreateSubmit}
          onCancel={() => setCreateState(null)}
        />
      )}
      {moveConfirm && (
        <MoveConfirmDialog
          kind={moveConfirm.entity.kind}
          entity={{ id: moveConfirm.entity.entity.id, displayCode: moveConfirm.entity.entity.displayCode }}
          newLat={moveConfirm.newLat}
          newLng={moveConfirm.newLng}
          existingCodes={existingCodes}
          onConfirm={handleMoveConfirm}
          onCancel={() => setMoveConfirm(null)}
        />
      )}
    </div>
  );
}

// ── transport-coal real map surface (T6, Bundle 2) — TransportLpInputs is
// NOT PMedianMapInputs-shaped (no warehouseOverrides/customerOverrides/
// capacityMode/distanceOverrides; mines/stations use sparse
// mineCapacities/stationDemands maps and a laneCostOverrides array instead),
// so this mode gets its own small, closely-mirrored mutator set rather than
// being forced through "pmedian"'s — matching this codebase's established
// "close mirror, not shared abstraction" convention for transport-coal's
// network-edit machinery (see Workspace.tsx's
// deleteAddedTransportEntityAndOverrides comment). No `status`/`isNoOp`
// removal semantics here at all (unlike editBaseWarehouseOverride/
// editBaseCustomerOverride above): mines/stations have no status concept,
// and mineCapacities/stationDemands are plain sparse value maps — a blank
// edit simply deletes the key (MineTable.tsx/StationTable.tsx's own
// `upsert` does the exact same thing). ──

function purgeLaneCostOverridesFor(overrides: LaneCostOverride[], id: string): LaneCostOverride[] {
  return overrides.filter(o => o.fromId !== id && o.toId !== id);
}

function transportAddedKeyFor(kind: "wh" | "cs"): "addedMines" | "addedStations" {
  return kind === "wh" ? "addedMines" : "addedStations";
}

function deleteAddedTransport(inputs: TransportMapInputs, kind: "wh" | "cs", id: string): TransportMapInputs {
  const key = transportAddedKeyFor(kind);
  const arr = inputs[key] as (AddedMine | AddedStation)[];
  return {
    ...inputs,
    [key]: arr.filter(e => e.id !== id),
    laneCostOverrides: purgeLaneCostOverridesFor(inputs.laneCostOverrides, id),
  } as TransportMapInputs;
}

function moveAddedTransport(
  inputs: TransportMapInputs,
  kind: "wh" | "cs",
  id: string,
  next: { displayCode: string; city: string; state: string; lat: number; lng: number },
): TransportMapInputs {
  const key = transportAddedKeyFor(kind);
  const arr = inputs[key] as (AddedMine | AddedStation)[];
  return {
    ...inputs,
    [key]: arr.map(e => (e.id === id ? { ...e, ...next } : e)),
    laneCostOverrides: purgeLaneCostOverridesFor(inputs.laneCostOverrides, id),
  } as TransportMapInputs;
}

function editAddedMine(inputs: TransportMapInputs, id: string, patch: { capacity?: number | null }): TransportMapInputs {
  return { ...inputs, addedMines: inputs.addedMines.map(m => (m.id === id ? { ...m, ...patch } : m)) };
}

function editAddedStation(inputs: TransportMapInputs, id: string, demand: number): TransportMapInputs {
  return { ...inputs, addedStations: inputs.addedStations.map(s => (s.id === id ? { ...s, demand } : s)) };
}

// Mirrors MineTable.tsx's `upsert` exactly — a blank/null capacity deletes
// the key (unconstrained) rather than storing a no-op `0`.
function editBaseMineCapacity(inputs: TransportMapInputs, id: string, capacity: number | null | undefined): TransportMapInputs {
  const next = { ...inputs.mineCapacities };
  if (capacity == null) delete next[id];
  else next[id] = capacity;
  return { ...inputs, mineCapacities: next };
}

// Mirrors StationTable.tsx's `upsert` exactly.
function editBaseStationDemand(inputs: TransportMapInputs, id: string, demand: number): TransportMapInputs {
  return { ...inputs, stationDemands: { ...inputs.stationDemands, [id]: demand } };
}

function addMineRow(inputs: TransportMapInputs, row: AddedMine): TransportMapInputs {
  return { ...inputs, addedMines: [...inputs.addedMines, row] };
}

function addStationRow(inputs: TransportMapInputs, row: AddedStation): TransportMapInputs {
  return { ...inputs, addedStations: [...inputs.addedStations, row] };
}

// T6 — transport-coal's real Input Map surface: mines render in the "wh"
// (triangle) rendering role via MINE_ROLE, stations in the "cs" (bubble)
// role via STATION_ROLE (MapEntity.kind is a RENDERING role, not a
// per-model entity name — see types.ts's own EntityRoleConfig comment).
// Place/move/edit/delete/copy all mirror PMedianInputMap's exact state
// machine (MapEventsBridge/GhostFollower/AddEntityMenu/ToggleChip/
// CreateState/median are all reused unmodified from above); the only real
// differences are the data shape (TransportMapInputs, not PMedianMapInputs)
// and R3/R7 being N/A — no status legend, no "Show inactive" toggle (a mine
// is never inactive, so that control would be a meaningless no-op here).
function TransportInputMap({
  countryBounds,
  mines,
  stations,
  inputs,
  onInputsChange,
  isDirty,
  onSave,
  saving,
}: Extract<InputMapTabProps, { mode: "transport" }>) {
  const [toggles, setToggles] = useState<EntityMarkersToggles>({ warehouses: true, customers: true, showInactive: false });
  const [pinMode, setPinMode] = useState<{ key: "wh" | "cs" } | null>(null);
  const [selected, setSelected] = useState<({ entity: MapEntity } & OverlayAnchor) | null>(null);
  const [actionMenu, setActionMenu] = useState<
    ({ entity: MapEntity; openId: number; restoreFocusTo: HTMLElement | null } & OverlayAnchor) | null
  >(null);
  const actionMenuOpenIdRef = useRef(0);
  const [addMenu, setAddMenu] = useState<({ lat: number; lng: number } & OverlayAnchor) | null>(null);
  const [editEntity, setEditEntity] = useState<MapEntity | null>(null);
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [armed, setArmed] = useState<{ kind: "move" | "copy"; entity: MapEntity } | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ entity: MapEntity; newLat: number; newLng: number } | null>(null);
  const [livePreview, setLivePreview] = useState<{ id: string; demand: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const boundsProps = getMapBoundsProps(countryBounds);
  const mapKey = countryBounds ? `${countryBounds.sw.join(",")}_${countryBounds.ne.join(",")}` : "fallback";

  const existingCodes = useMemo(() => {
    const codes = new Set<string>();
    mines.forEach(m => codes.add(m.displayCode));
    stations.forEach(s => codes.add(s.displayCode));
    return codes;
  }, [mines, stations]);

  const medianDemand = useMemo(() => median(stations.map(s => s.demand)), [stations]);

  const draggableIds = useMemo(() => {
    const ids = new Set<string>();
    mines.forEach(m => { if (m.isAdded) ids.add(m.id); });
    stations.forEach(s => { if (s.isAdded) ids.add(s.id); });
    return ids;
  }, [mines, stations]);

  // Live-preview bubble resize while EditCustomerDialog is open, same as
  // PMedianInputMap's displayCustomers.
  const displayStations = useMemo(
    () => (livePreview ? stations.map(s => (s.id === livePreview.id ? { ...s, demand: livePreview.demand } : s)) : stations),
    [stations, livePreview],
  );

  function getContainerSize() {
    const el = wrapperRef.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : undefined;
  }

  function closeOverlays() {
    setSelected(null);
    setActionMenu(null);
    setAddMenu(null);
  }

  useEffect(() => {
    if (!armed) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setArmed(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [armed]);

  const preMouseDownFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function onMouseDownCapture() {
      preMouseDownFocusRef.current = document.activeElement as HTMLElement | null;
    }
    document.addEventListener("mousedown", onMouseDownCapture, true);
    return () => document.removeEventListener("mousedown", onMouseDownCapture, true);
  }, []);

  function handleEntityLeftClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    setActionMenu(null);
    setAddMenu(null);
    setSelected({ entity, containerPoint: e.containerPoint, containerSize: getContainerSize() });
  }

  function handleEntityRightClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    const restoreFocusTo = preMouseDownFocusRef.current;
    setSelected(null);
    setAddMenu(null);
    actionMenuOpenIdRef.current += 1;
    setActionMenu({
      entity,
      containerPoint: e.containerPoint,
      containerSize: getContainerSize(),
      openId: actionMenuOpenIdRef.current,
      restoreFocusTo,
    });
  }

  function handleEntityDragEnd(entity: MapEntity, latlng: { lat: number; lng: number }) {
    setMoveConfirm({ entity, newLat: latlng.lat, newLng: latlng.lng });
  }

  function handleMapClick(e: L.LeafletMouseEvent) {
    if (armed) {
      const { kind, entity } = armed.entity;
      if (armed.kind === "move") {
        setMoveConfirm({ entity: armed.entity, newLat: e.latlng.lat, newLng: e.latlng.lng });
      } else {
        const copyFrom = kind === "wh" ? { capacity: (entity as MapWarehouse).capacity } : { demand: (entity as MapCustomer).demand };
        setCreateState({ kind, lat: e.latlng.lat, lng: e.latlng.lng, copyFrom });
      }
      setArmed(null);
      return;
    }
    if (pinMode) {
      setCreateState({ kind: pinMode.key, lat: e.latlng.lat, lng: e.latlng.lng });
      return;
    }
    closeOverlays();
  }

  function handleMapContextMenu(e: L.LeafletMouseEvent) {
    if (armed) {
      setArmed(null);
      return;
    }
    setSelected(null);
    setActionMenu(null);
    setAddMenu({ lat: e.latlng.lat, lng: e.latlng.lng, containerPoint: e.containerPoint, containerSize: getContainerSize() });
  }

  function handleMenuEdit() {
    if (!actionMenu) return;
    setEditEntity(actionMenu.entity);
    setActionMenu(null);
  }
  function handleMenuMove() {
    if (!actionMenu) return;
    setArmed({ kind: "move", entity: actionMenu.entity });
    setActionMenu(null);
  }
  function handleMenuCopy() {
    if (!actionMenu) return;
    setArmed({ kind: "copy", entity: actionMenu.entity });
    setActionMenu(null);
  }
  function handleMenuDelete() {
    if (!actionMenu) return;
    const { kind, entity } = actionMenu.entity;
    onInputsChange(deleteAddedTransport(inputs, kind, entity.id));
    setActionMenu(null);
  }

  // Same union signature PMedianInputMap's handleEditSubmit takes —
  // EditWarehouseDialog always emits `{status, capacity?}` at the type
  // level even for a hasStatus:false role (MINE_ROLE), but never actually
  // POPULATES `.status` at runtime for one (see that dialog's own comment).
  // Only `.capacity` is ever read here, so no meaningless `status` field
  // enters a transport PATCH.
  function handleEditSubmit(patch: { status: WhStatus; capacity?: number | null } | { demand: number }) {
    if (!editEntity) return;
    const { kind, entity } = editEntity;
    if (kind === "wh") {
      const p = patch as { capacity?: number | null };
      onInputsChange(entity.isAdded ? editAddedMine(inputs, entity.id, p) : editBaseMineCapacity(inputs, entity.id, p.capacity));
    } else {
      const p = patch as { demand: number };
      onInputsChange(entity.isAdded ? editAddedStation(inputs, entity.id, p.demand) : editBaseStationDemand(inputs, entity.id, p.demand));
    }
    setEditEntity(null);
    setLivePreview(null);
  }

  function handleCreateSubmit(row: AddedWarehouseInput | AddedCustomerInput) {
    if (!createState) return;
    // CreateEntityDialog's onSubmit stays warehouse/customer-shaped at the
    // type level (see its own props comment) — cast to this model's real
    // AddedMine/AddedStation shape at this call site, same convention T4's
    // role config establishes for every non-p-median consumer.
    onInputsChange(
      createState.kind === "wh"
        ? addMineRow(inputs, row as unknown as AddedMine)
        : addStationRow(inputs, row as unknown as AddedStation),
    );
    setCreateState(null);
  }

  function handleMoveConfirm(next: { displayCode: string; city: string; state: string; lat: number; lng: number }) {
    if (!moveConfirm) return;
    const { kind, entity } = moveConfirm.entity;
    onInputsChange(moveAddedTransport(inputs, kind, entity.id, next));
    setMoveConfirm(null);
  }

  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0" data-testid="transport-map-toolbar">
        <span className="text-xs text-muted-foreground">Layers:</span>
        <ToggleChip testId="toggle-layer-mines" active={toggles.warehouses} onClick={() => setToggles(t => ({ ...t, warehouses: !t.warehouses }))}>
          Mines
        </ToggleChip>
        <ToggleChip testId="toggle-layer-stations" active={toggles.customers} onClick={() => setToggles(t => ({ ...t, customers: !t.customers }))}>
          Stations
        </ToggleChip>
        {/* R3/R7 N/A for transport-coal (supportsFacilityStatus:false) —
            deliberately no "Show inactive" toggle here: mines/stations have
            no status concept at all, so it would be a meaningless no-op
            control rather than a real gate (see this file's "transport" mode
            comment above). */}
        <span className="text-xs text-muted-foreground ml-2">Add on map:</span>
        <ToggleChip testId="button-input-map-place-wh" active={pinMode?.key === "wh"} onClick={() => setPinMode(p => (p?.key === "wh" ? null : { key: "wh" }))}>
          + Mine
        </ToggleChip>
        <ToggleChip testId="button-input-map-place-cs" active={pinMode?.key === "cs"} onClick={() => setPinMode(p => (p?.key === "cs" ? null : { key: "cs" }))}>
          + Station
        </ToggleChip>
        {armed && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-300 rounded px-2 py-1" data-testid="armed-status-bar">
            <span>
              Click a map location to {armed.kind === "move" ? "move" : "copy"} {armed.entity.entity.displayCode} — Esc to cancel
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setArmed(null)} data-testid="button-armed-cancel">
              Cancel
            </Button>
          </div>
        )}
        {/* R4 — Save relocated here, same as PMedianInputMap's Layers row
            (reuses the exact same button-save/text-unsaved-changes testids). */}
        {onSave && (
          <div className="flex items-center gap-2 ml-auto">
            {isDirty && (
              <span className="text-xs text-muted-foreground" data-testid="text-unsaved-changes">
                Unsaved changes
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onSave}
              disabled={!isDirty || saving}
              data-testid="button-save"
              className={isDirty ? "border-primary text-primary hover:bg-primary/10" : ""}
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 relative" ref={wrapperRef}>
        <MapContainer key={mapKey} {...boundsProps} zoom={4} className="h-full w-full" scrollWheelZoom>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="CartoDB" />
          <MapEventsBridge onClick={handleMapClick} onContextMenu={handleMapContextMenu} onMoveOrZoomStart={closeOverlays} />
          {armed && <GhostFollower tint={armed.kind === "move" ? "#2563eb" : "#059669"} />}
          <EntityMarkers
            warehouses={mines}
            customers={displayStations}
            toggles={toggles}
            onLeftClick={handleEntityLeftClick}
            onRightClick={handleEntityRightClick}
            onDragEnd={handleEntityDragEnd}
            draggableIds={draggableIds.size > 0 ? draggableIds : EMPTY_ID_SET}
          />
        </MapContainer>
        {/* R1/R2 — green station bubbles + quintile sizing come for free from
            types.ts's demandTone/makeQuintileRadius (shared, unmodified);
            showStatusLegend=false is R3's N/A gate for this model. */}
        <MapLegend customers={displayStations} showStatusLegend={false} />
        {selected && (
          <MapDetailsCard
            entity={selected.entity}
            containerPoint={selected.containerPoint}
            containerSize={selected.containerSize}
            onClose={() => setSelected(null)}
          />
        )}
        {actionMenu && (
          <MapActionMenu
            key={actionMenu.openId}
            entity={actionMenu.entity}
            containerPoint={actionMenu.containerPoint}
            containerSize={actionMenu.containerSize}
            restoreFocusTo={actionMenu.restoreFocusTo}
            onEdit={handleMenuEdit}
            onMove={handleMenuMove}
            onCopy={handleMenuCopy}
            onDelete={handleMenuDelete}
            onClose={() => setActionMenu(null)}
          />
        )}
        {addMenu && (
          <AddEntityMenu
            containerPoint={addMenu.containerPoint}
            containerSize={addMenu.containerSize}
            onAdd={kind => {
              setCreateState({ kind, lat: addMenu.lat, lng: addMenu.lng });
              setAddMenu(null);
            }}
            onClose={() => setAddMenu(null)}
          />
        )}
      </div>

      {editEntity && editEntity.kind === "wh" && (
        <EditWarehouseDialog
          entity={editEntity.entity}
          role={MINE_ROLE}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditEntity(null)}
        />
      )}
      {editEntity && editEntity.kind === "cs" && (
        <EditCustomerDialog
          entity={editEntity.entity}
          role={STATION_ROLE}
          onSubmit={handleEditSubmit}
          onLivePreview={demand => setLivePreview({ id: editEntity.entity.id, demand })}
          onCancel={() => {
            setEditEntity(null);
            setLivePreview(null);
          }}
        />
      )}
      {createState && (
        <CreateEntityDialog
          kind={createState.kind}
          role={createState.kind === "wh" ? MINE_ROLE : STATION_ROLE}
          lat={createState.lat}
          lng={createState.lng}
          existingCodes={existingCodes}
          copyFrom={createState.copyFrom}
          medianDemand={medianDemand}
          onSubmit={handleCreateSubmit}
          onCancel={() => setCreateState(null)}
        />
      )}
      {moveConfirm && (
        <MoveConfirmDialog
          kind={moveConfirm.entity.kind}
          role={moveConfirm.entity.kind === "wh" ? MINE_ROLE : STATION_ROLE}
          entity={{ id: moveConfirm.entity.entity.id, displayCode: moveConfirm.entity.entity.displayCode }}
          newLat={moveConfirm.newLat}
          newLng={moveConfirm.newLng}
          existingCodes={existingCodes}
          onConfirm={handleMoveConfirm}
          onCancel={() => setMoveConfirm(null)}
        />
      )}
    </div>
  );
}

// ── two-echelon-gold-au real map surface (T7, Bundle 2) — TwoEchelonMapInputs
// is NOT PMedianMapInputs-shaped (refineryOverrides not warehouseOverrides,
// no capacityMode/capacity concept at all for refineries — see
// TwoEchelonMapInputs's own comment), so this mode gets its own small,
// closely-mirrored mutator set, matching this codebase's established "close
// mirror, not shared abstraction" convention for each model's own
// network-edit machinery (see TransportInputMap's own comment on the same
// convention). Refineries DO carry a real status (unlike transport's mines,
// which have none at all), so these mutators mirror PMedianInputMap's
// editBaseWarehouseOverride/editAddedWarehouse exactly minus the capacity
// merge. ──

function purgeTwoEchelonDistanceOverridesFor(overrides: TwoEchelonMapInputs["distanceOverrides"], id: string) {
  return overrides.filter(o => o.fromId !== id && o.toId !== id);
}

function twoEchelonAddedKeyFor(kind: "wh" | "cs"): "addedRefineries" | "addedCustomers" {
  return kind === "wh" ? "addedRefineries" : "addedCustomers";
}

function deleteAddedTwoEchelon(inputs: TwoEchelonMapInputs, kind: "wh" | "cs", id: string): TwoEchelonMapInputs {
  const key = twoEchelonAddedKeyFor(kind);
  const arr = inputs[key] as (AddedWarehouseInput | AddedCustomerInput)[];
  return {
    ...inputs,
    [key]: arr.filter(e => e.id !== id),
    distanceOverrides: purgeTwoEchelonDistanceOverridesFor(inputs.distanceOverrides, id),
  } as TwoEchelonMapInputs;
}

function moveAddedTwoEchelon(
  inputs: TwoEchelonMapInputs,
  kind: "wh" | "cs",
  id: string,
  next: { displayCode: string; city: string; state: string; lat: number; lng: number },
): TwoEchelonMapInputs {
  const key = twoEchelonAddedKeyFor(kind);
  const arr = inputs[key] as (AddedWarehouseInput | AddedCustomerInput)[];
  return {
    ...inputs,
    [key]: arr.map(e => (e.id === id ? { ...e, ...next } : e)),
    // The entity's own distances no longer describe its new location —
    // dropped so they re-estimate on Save (T2's normalizer), never touching
    // refineryOverrides/customerOverrides.
    distanceOverrides: purgeTwoEchelonDistanceOverridesFor(inputs.distanceOverrides, id),
  } as TwoEchelonMapInputs;
}

function editAddedRefinery(inputs: TwoEchelonMapInputs, id: string, status: WhStatus): TwoEchelonMapInputs {
  return { ...inputs, addedRefineries: inputs.addedRefineries.map(r => (r.id === id ? { ...r, status } : r)) };
}

function editAddedTwoEchelonCustomer(inputs: TwoEchelonMapInputs, id: string, demand: number): TwoEchelonMapInputs {
  return { ...inputs, addedCustomers: inputs.addedCustomers.map(c => (c.id === id ? { ...c, demand } : c)) };
}

// Mirrors editBaseWarehouseOverride minus the capacity merge — refineries
// have no capacity concept at all (TwoEchelonMapInputs's own comment), so a
// "status==='active'" override is always a no-op, removed rather than
// stored, same as every other base-override upsert in this file.
function editBaseRefineryOverride(inputs: TwoEchelonMapInputs, id: string, status: WhStatus): TwoEchelonMapInputs {
  const rest = inputs.refineryOverrides.filter(o => o.id !== id);
  return { ...inputs, refineryOverrides: status === "active" ? rest : [...rest, { id, status }] };
}

// Mirrors editBaseCustomerOverride (PMedianInputMap) exactly —
// twoEchelonInputsSchema's customerOverrides shares p-median-us's exact
// {id, demand?, status} shape.
function editBaseTwoEchelonCustomerOverride(inputs: TwoEchelonMapInputs, id: string, demand: number): TwoEchelonMapInputs {
  const existing = inputs.customerOverrides.find(o => o.id === id);
  const merged = { id, status: existing?.status ?? "active", demand };
  const rest = inputs.customerOverrides.filter(o => o.id !== id);
  const isNoOp = merged.status === "active" && merged.demand == null;
  return { ...inputs, customerOverrides: isNoOp ? rest : [...rest, merged] };
}

function addRefineryRow(inputs: TwoEchelonMapInputs, row: AddedWarehouseInput): TwoEchelonMapInputs {
  return { ...inputs, addedRefineries: [...inputs.addedRefineries, row] };
}

function addTwoEchelonCustomerRow(inputs: TwoEchelonMapInputs, row: AddedCustomerInput): TwoEchelonMapInputs {
  return { ...inputs, addedCustomers: [...inputs.addedCustomers, row] };
}

// T7 — two-echelon-gold-au's real Input Map surface: refineries render in
// the "wh" (triangle) rendering role via REFINERY_ROLE, customers in the
// "cs" (bubble) role via the default CUSTOMER_ROLE (same as PMedianInputMap
// — two-echelon's customers have no divergent vocabulary worth a role
// override, unlike transport's stations). Place/move/edit/delete/copy all
// reuse the exact same MapEventsBridge/GhostFollower/AddEntityMenu/
// ToggleChip/CreateState/median machinery PMedianInputMap/TransportInputMap
// already established. `capacityMode="none"` is passed to EditWarehouseDialog
// (mirroring WarehousesTab's own entity="refineries" reuse, Workspace.tsx's
// `capacityMode="none"` prop there) to suppress REFINERY_ROLE's Capacity
// field in the EDIT dialog — refineries have no capacity concept at all.
//
// The mine is READ-ONLY context: it is NEVER part of `refineries` (so it's
// never in EntityMarkers' interactive array, never draggable, never an
// armed-move/copy target, never opens MapActionMenu/EditWarehouseDialog) —
// rendered instead as a single bare react-leaflet `<Marker>` with zero
// `eventHandlers`, entirely outside the click-routing state machine below.
function TwoEchelonInputMap({
  countryBounds,
  mine,
  refineries,
  customers,
  inputs,
  onInputsChange,
  isDirty,
  onSave,
  saving,
}: Extract<InputMapTabProps, { mode: "twoEchelon" }>) {
  const [toggles, setToggles] = useState<EntityMarkersToggles>({ warehouses: true, customers: true, showInactive: false });
  const [pinMode, setPinMode] = useState<{ key: "wh" | "cs" } | null>(null);
  const [selected, setSelected] = useState<({ entity: MapEntity } & OverlayAnchor) | null>(null);
  const [actionMenu, setActionMenu] = useState<
    ({ entity: MapEntity; openId: number; restoreFocusTo: HTMLElement | null } & OverlayAnchor) | null
  >(null);
  const actionMenuOpenIdRef = useRef(0);
  const [addMenu, setAddMenu] = useState<({ lat: number; lng: number } & OverlayAnchor) | null>(null);
  const [editEntity, setEditEntity] = useState<MapEntity | null>(null);
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [armed, setArmed] = useState<{ kind: "move" | "copy"; entity: MapEntity } | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{ entity: MapEntity; newLat: number; newLng: number } | null>(null);
  const [livePreview, setLivePreview] = useState<{ id: string; demand: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const boundsProps = getMapBoundsProps(countryBounds);
  const mapKey = countryBounds ? `${countryBounds.sw.join(",")}_${countryBounds.ne.join(",")}` : "fallback";

  const existingCodes = useMemo(() => {
    const codes = new Set<string>();
    refineries.forEach(r => codes.add(r.displayCode));
    customers.forEach(c => codes.add(c.displayCode));
    if (mine) codes.add(mine.displayCode);
    return codes;
  }, [refineries, customers, mine]);

  const medianDemand = useMemo(() => median(customers.map(c => c.demand)), [customers]);

  // The mine is never in `refineries` at all — draggableIds only ever
  // covers added refineries/customers, exactly like PMedianInputMap.
  const draggableIds = useMemo(() => {
    const ids = new Set<string>();
    refineries.forEach(r => { if (r.isAdded) ids.add(r.id); });
    customers.forEach(c => { if (c.isAdded) ids.add(c.id); });
    return ids;
  }, [refineries, customers]);

  // Live-preview bubble resize while EditCustomerDialog is open, same as
  // PMedianInputMap's displayCustomers.
  const displayCustomers = useMemo(
    () => (livePreview ? customers.map(c => (c.id === livePreview.id ? { ...c, demand: livePreview.demand } : c)) : customers),
    [customers, livePreview],
  );

  function getContainerSize() {
    const el = wrapperRef.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : undefined;
  }

  function closeOverlays() {
    setSelected(null);
    setActionMenu(null);
    setAddMenu(null);
  }

  useEffect(() => {
    if (!armed) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setArmed(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [armed]);

  const preMouseDownFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function onMouseDownCapture() {
      preMouseDownFocusRef.current = document.activeElement as HTMLElement | null;
    }
    document.addEventListener("mousedown", onMouseDownCapture, true);
    return () => document.removeEventListener("mousedown", onMouseDownCapture, true);
  }, []);

  function handleEntityLeftClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    setActionMenu(null);
    setAddMenu(null);
    setSelected({ entity, containerPoint: e.containerPoint, containerSize: getContainerSize() });
  }

  function handleEntityRightClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    const restoreFocusTo = preMouseDownFocusRef.current;
    setSelected(null);
    setAddMenu(null);
    actionMenuOpenIdRef.current += 1;
    setActionMenu({
      entity,
      containerPoint: e.containerPoint,
      containerSize: getContainerSize(),
      openId: actionMenuOpenIdRef.current,
      restoreFocusTo,
    });
  }

  function handleEntityDragEnd(entity: MapEntity, latlng: { lat: number; lng: number }) {
    setMoveConfirm({ entity, newLat: latlng.lat, newLng: latlng.lng });
  }

  function handleMapClick(e: L.LeafletMouseEvent) {
    if (armed) {
      const { kind, entity } = armed.entity;
      if (armed.kind === "move") {
        setMoveConfirm({ entity: armed.entity, newLat: e.latlng.lat, newLng: e.latlng.lng });
      } else {
        const copyFrom = kind === "wh" ? { capacity: (entity as MapWarehouse).capacity } : { demand: (entity as MapCustomer).demand };
        setCreateState({ kind, lat: e.latlng.lat, lng: e.latlng.lng, copyFrom });
      }
      setArmed(null);
      return;
    }
    if (pinMode) {
      setCreateState({ kind: pinMode.key, lat: e.latlng.lat, lng: e.latlng.lng });
      return;
    }
    closeOverlays();
  }

  function handleMapContextMenu(e: L.LeafletMouseEvent) {
    if (armed) {
      setArmed(null);
      return;
    }
    setSelected(null);
    setActionMenu(null);
    setAddMenu({ lat: e.latlng.lat, lng: e.latlng.lng, containerPoint: e.containerPoint, containerSize: getContainerSize() });
  }

  function handleMenuEdit() {
    if (!actionMenu) return;
    setEditEntity(actionMenu.entity);
    setActionMenu(null);
  }
  function handleMenuMove() {
    if (!actionMenu) return;
    setArmed({ kind: "move", entity: actionMenu.entity });
    setActionMenu(null);
  }
  function handleMenuCopy() {
    if (!actionMenu) return;
    setArmed({ kind: "copy", entity: actionMenu.entity });
    setActionMenu(null);
  }
  function handleMenuDelete() {
    if (!actionMenu) return;
    const { kind, entity } = actionMenu.entity;
    onInputsChange(deleteAddedTwoEchelon(inputs, kind, entity.id));
    setActionMenu(null);
  }

  // Same union signature PMedianInputMap's handleEditSubmit takes —
  // EditWarehouseDialog always emits `{status, capacity?}` at the type
  // level, but with `capacityMode="none"` passed below, `capacity` is never
  // populated at runtime (EditWarehouseDialog's own showValueField gate), so
  // it's never read here.
  function handleEditSubmit(patch: { status: WhStatus; capacity?: number | null } | { demand: number }) {
    if (!editEntity) return;
    const { kind, entity } = editEntity;
    if (kind === "wh") {
      const p = patch as { status: WhStatus };
      onInputsChange(entity.isAdded ? editAddedRefinery(inputs, entity.id, p.status) : editBaseRefineryOverride(inputs, entity.id, p.status));
    } else {
      const p = patch as { demand: number };
      onInputsChange(entity.isAdded ? editAddedTwoEchelonCustomer(inputs, entity.id, p.demand) : editBaseTwoEchelonCustomerOverride(inputs, entity.id, p.demand));
    }
    setEditEntity(null);
    setLivePreview(null);
  }

  function handleCreateSubmit(row: AddedWarehouseInput | AddedCustomerInput) {
    if (!createState) return;
    onInputsChange(
      createState.kind === "wh"
        ? addRefineryRow(inputs, row as AddedWarehouseInput)
        : addTwoEchelonCustomerRow(inputs, row as AddedCustomerInput),
    );
    setCreateState(null);
  }

  function handleMoveConfirm(next: { displayCode: string; city: string; state: string; lat: number; lng: number }) {
    if (!moveConfirm) return;
    const { kind, entity } = moveConfirm.entity;
    onInputsChange(moveAddedTwoEchelon(inputs, kind, entity.id, next));
    setMoveConfirm(null);
  }

  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0" data-testid="two-echelon-map-toolbar">
        <span className="text-xs text-muted-foreground">Layers:</span>
        <ToggleChip testId="toggle-layer-warehouses" active={toggles.warehouses} onClick={() => setToggles(t => ({ ...t, warehouses: !t.warehouses }))}>
          Refineries
        </ToggleChip>
        <ToggleChip testId="toggle-layer-customers" active={toggles.customers} onClick={() => setToggles(t => ({ ...t, customers: !t.customers }))}>
          Customers
        </ToggleChip>
        <ToggleChip testId="toggle-layer-show-inactive" active={toggles.showInactive} onClick={() => setToggles(t => ({ ...t, showInactive: !t.showInactive }))}>
          Show inactive
        </ToggleChip>
        <span className="text-xs text-muted-foreground ml-2">Add on map:</span>
        <ToggleChip testId="button-input-map-place-wh" active={pinMode?.key === "wh"} onClick={() => setPinMode(p => (p?.key === "wh" ? null : { key: "wh" }))}>
          + Refinery
        </ToggleChip>
        <ToggleChip testId="button-input-map-place-cs" active={pinMode?.key === "cs"} onClick={() => setPinMode(p => (p?.key === "cs" ? null : { key: "cs" }))}>
          + Customer
        </ToggleChip>
        {armed && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-300 rounded px-2 py-1" data-testid="armed-status-bar">
            <span>
              Click a map location to {armed.kind === "move" ? "move" : "copy"} {armed.entity.entity.displayCode} — Esc to cancel
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setArmed(null)} data-testid="button-armed-cancel">
              Cancel
            </Button>
          </div>
        )}
        {/* R4 — Save relocated here, same as PMedianInputMap/TransportInputMap's
            Layers row (reuses the exact same button-save/text-unsaved-changes
            testids). */}
        {onSave && (
          <div className="flex items-center gap-2 ml-auto">
            {isDirty && (
              <span className="text-xs text-muted-foreground" data-testid="text-unsaved-changes">
                Unsaved changes
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onSave}
              disabled={!isDirty || saving}
              data-testid="button-save"
              className={isDirty ? "border-primary text-primary hover:bg-primary/10" : ""}
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 relative" ref={wrapperRef}>
        <MapContainer key={mapKey} {...boundsProps} zoom={4} className="h-full w-full" scrollWheelZoom>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="CartoDB" />
          <MapEventsBridge onClick={handleMapClick} onContextMenu={handleMapContextMenu} onMoveOrZoomStart={closeOverlays} />
          {armed && <GhostFollower tint={armed.kind === "move" ? "#2563eb" : "#059669"} />}
          {/* T7 — the fixed mine: a plain, non-interactive marker (no
              `eventHandlers`, not draggable, not in the `refineries` array
              EntityMarkers renders from) — read-only context, never
              placeable/movable/editable/deletable, and never a valid
              armed-move/copy drop target since it never enters the
              interactive click-routing flow above at all. */}
          {mine && (
            <Marker position={[mine.lat, mine.lng]} zIndexOffset={900} data-testid="mine-marker-fixed">
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <span className="font-semibold text-xs">{mine.displayCode} (mine, fixed)</span>
              </Tooltip>
            </Marker>
          )}
          <EntityMarkers
            warehouses={refineries}
            customers={displayCustomers}
            toggles={toggles}
            onLeftClick={handleEntityLeftClick}
            onRightClick={handleEntityRightClick}
            onDragEnd={handleEntityDragEnd}
            draggableIds={draggableIds.size > 0 ? draggableIds : EMPTY_ID_SET}
          />
        </MapContainer>
        {/* R1/R2/R3 — green customer bubbles + quintile sizing + the status
            legend all come for free from types.ts's demandTone/
            makeQuintileRadius/MapLegend's default showStatusLegend=true —
            refineries DO carry a real status, unlike transport's mines. */}
        <MapLegend customers={displayCustomers} />
        {selected && (
          <MapDetailsCard
            entity={selected.entity}
            containerPoint={selected.containerPoint}
            containerSize={selected.containerSize}
            onClose={() => setSelected(null)}
          />
        )}
        {actionMenu && (
          <MapActionMenu
            key={actionMenu.openId}
            entity={actionMenu.entity}
            containerPoint={actionMenu.containerPoint}
            containerSize={actionMenu.containerSize}
            restoreFocusTo={actionMenu.restoreFocusTo}
            onEdit={handleMenuEdit}
            onMove={handleMenuMove}
            onCopy={handleMenuCopy}
            onDelete={handleMenuDelete}
            onClose={() => setActionMenu(null)}
          />
        )}
        {addMenu && (
          <AddEntityMenu
            containerPoint={addMenu.containerPoint}
            containerSize={addMenu.containerSize}
            onAdd={kind => {
              setCreateState({ kind, lat: addMenu.lat, lng: addMenu.lng });
              setAddMenu(null);
            }}
            onClose={() => setAddMenu(null)}
          />
        )}
      </div>

      {editEntity && editEntity.kind === "wh" && (
        <EditWarehouseDialog
          entity={editEntity.entity}
          role={REFINERY_ROLE}
          capacityMode="none"
          onSubmit={handleEditSubmit}
          onCancel={() => setEditEntity(null)}
        />
      )}
      {editEntity && editEntity.kind === "cs" && (
        <EditCustomerDialog
          entity={editEntity.entity}
          onSubmit={handleEditSubmit}
          onLivePreview={demand => setLivePreview({ id: editEntity.entity.id, demand })}
          onCancel={() => {
            setEditEntity(null);
            setLivePreview(null);
          }}
        />
      )}
      {createState && (
        <CreateEntityDialog
          kind={createState.kind}
          role={createState.kind === "wh" ? REFINERY_ROLE : undefined}
          lat={createState.lat}
          lng={createState.lng}
          existingCodes={existingCodes}
          copyFrom={createState.copyFrom}
          medianDemand={medianDemand}
          onSubmit={handleCreateSubmit}
          onCancel={() => setCreateState(null)}
        />
      )}
      {moveConfirm && (
        <MoveConfirmDialog
          kind={moveConfirm.entity.kind}
          role={moveConfirm.entity.kind === "wh" ? REFINERY_ROLE : undefined}
          entity={{ id: moveConfirm.entity.entity.id, displayCode: moveConfirm.entity.entity.displayCode }}
          newLat={moveConfirm.newLat}
          newLng={moveConfirm.newLng}
          existingCodes={existingCodes}
          onConfirm={handleMoveConfirm}
          onCancel={() => setMoveConfirm(null)}
        />
      )}
    </div>
  );
}
