import { formatCoord } from "@/lib/formatLocation";
import { demandHeader, type Chapter } from "@/lib/chapters";
import { useMemo, useState } from "react";
import type { AddedMine } from "@/components/workspace/tabs/MinesTab";
import type { AddedStation } from "@/components/workspace/tabs/StationsTab";
import { READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { warehouseStatusPresentation, type WhStatus } from "@/components/workspace/map/statusPresentation";
import {
  WAREHOUSE_ROLE,
  CUSTOMER_ROLE,
  PLANT_ROLE,
  MINE_ROLE,
  STATION_ROLE,
  REFINERY_ROLE,
  type AddedCustomerInput,
  type AddedPlantInput,
  type AddedWarehouseInput,
  type EntityRoleConfig,
} from "@/components/workspace/map/types";
import { lookupCity, nearestCity } from "@/lib/gazetteer";
import { FormattedNumberInput } from "@/components/data-table/FormattedNumberInput";
import { newUid, nextDisplayCode } from "@/lib/entityId";

const STATUS_OPTIONS: WhStatus[] = ["active", "forced_open", "inactive"];
const CUSTOMER_STATUS_OPTIONS = ["active", "excluded"] as const;

type CopyFrom =
  | AddedWarehouseInput
  | AddedCustomerInput
  | { capacity?: number | null; demand?: number };

function valueFromCopy(copyFrom: CopyFrom | undefined, key: "capacity" | "demand"): number | undefined {
  if (!copyFrom) return undefined;
  if (key === "capacity" && "capacity" in copyFrom && copyFrom.capacity != null) return copyFrom.capacity;
  if (key === "demand" && "demand" in copyFrom && copyFrom.demand != null) return copyFrom.demand;
  return undefined;
}

export interface MapCreateEntityDialogProps {
  /** SCU-2.P4.2 — omitted (or "map") = today's map flow, unchanged. */
  source?: "map";
  /** Rendering role — "wh" is a triangle marker (warehouse/mine/refinery),
   * "cs" is a demand bubble (customer/station), "pl" is a square marker
   * (plant, jade-T12 — Chapter 9 JADE). Which fields actually apply
   * (status, capacity vs demand, uid/display-code prefix) is `role`'s job,
   * not this. "pl" shares the "wh" branch below (geometry + role-gated
   * status/capacity, both of which PLANT_ROLE has none of) rather than
   * "cs" — a plant is a supply-role entity, not a demand bubble. */
  kind: "wh" | "cs" | "pl";
  /** T4 (Bundle 2, Step 0) — the entity's real role config. Defaults to
   * WAREHOUSE_ROLE ("wh") / CUSTOMER_ROLE ("cs") — today's exact
   * p-median-us behavior, unchanged for every existing call site that
   * doesn't pass this. */
  role?: EntityRoleConfig;
  /** Cleanup pass — mirrors EditWarehouseDialog's own `capacityMode` prop
   * exactly: p-median-us/brazil gate their Capacity field on it (only
   * `per_wh` shows it), transport-coal's mines have no capacityMode concept
   * and always show it (leave undefined), two-echelon's refineries pass
   * "none" to suppress it entirely (refineries have no capacity concept —
   * `addedRefinerySchema` has no capacity field, the value is stripped
   * server-side even if sent). Optional so this stays backward-compatible
   * with any test/caller that doesn't pass it. */
  capacityMode?: "none" | "uniform" | "per_wh";
  /** T8 (Bundle 2.2, A3) — model capability gate for a newly-created
   * customer's Active/Excluded control. A NEW entity is always "added" by
   * definition, so unlike EditCustomerDialog there is no base-vs-added
   * branch here: the control is gated on `role.supportsExclusion` (never
   * true for STATION_ROLE) AND this capability (p-median-us/two-echelon-
   * gold-au true, p-median-brazil false). Defaults false — hidden until the
   * caller explicitly opts in. Ignored for `kind==="wh"`. */
  supportsAddedCustomerExclusion?: boolean;
  lat: number;
  lng: number;
  existingCodes: Iterable<string>;
  copyFrom?: CopyFrom;
  medianDemand: number;
  onSubmit: (input: AddedWarehouseInput | AddedCustomerInput) => void;
  onCancel: () => void;
}

// T7 (Input Map v2) — dropped-pin / right-click / copy → new added entity.
// Reverse-geocodes once on open (T2's `nearestCity`), then lets the student
// correct the prefilled city/state before committing — the display code
// (T3's `nextDisplayCode`) is a DERIVED value recomputed from whatever
// city/state is on screen right now, never stored separately, so it can
// never disagree with the location shown. `id` is fixed via `useMemo` for
// the dialog's whole lifetime — regenerating it per keystroke would change
// the join key mid-edit, which the T3 uid contract forbids.
function MapCreateEntityDialog({
  kind,
  role = kind === "wh" ? WAREHOUSE_ROLE : kind === "pl" ? PLANT_ROLE : CUSTOMER_ROLE,
  capacityMode,
  supportsAddedCustomerExclusion = false,
  lat,
  lng,
  existingCodes,
  copyFrom,
  medianDemand,
  onSubmit,
  onCancel,
}: MapCreateEntityDialogProps) {
  const nearest = useMemo(() => nearestCity(lat, lng), [lat, lng]);
  const [city, setCity] = useState(nearest.city);
  const [state, setState] = useState(nearest.state);
  // DD-7 — the uid/display-code prefix comes from the role's `uidKind`, not
  // `kind`: a mine (kind="wh", so it renders as a triangle) still mints an
  // "am-"/"MN-..." id, never "aw-"/"WH-...".
  const id = useMemo(() => newUid(role.uidKind), [role.uidKind]);

  const copyCapacity = valueFromCopy(copyFrom, "capacity");
  const copyDemand = valueFromCopy(copyFrom, "demand");

  const [status, setStatus] = useState<WhStatus>("active");
  // T8 (Bundle 2.2, A3) — a SEPARATE state variable from the warehouse-role
  // `status` above (different vocabulary — WhStatus vs Active/Excluded — and
  // a warehouse-kind role never reads this one). A newly-created customer is
  // always an "added" entity, so this always defaults "active", never
  // derived from any existing entity.
  const [csStatus, setCsStatus] = useState<"active" | "excluded">("active");
  const [capacity, setCapacity] = useState<string>(copyCapacity != null ? String(copyCapacity) : "");
  const [demand, setDemand] = useState<string>(String(copyDemand ?? medianDemand));

  const displayCode = useMemo(
    () => nextDisplayCode(role.uidKind, state, city, existingCodes),
    [role.uidKind, state, city, existingCodes],
  );

  // Two-gate: role.supportsExclusion (never true for STATION_ROLE) AND the
  // model capability (a newly-created customer is always "added" — no
  // base-vs-added branch needed here, see this component's own prop
  // comment).
  const showCustomerExclusion = (role.supportsExclusion ?? false) && supportsAddedCustomerExclusion;

  // Mirrors EditWarehouseDialog's own `showValueField` gate exactly: a role
  // without a capacity value field (customers/stations never reach this —
  // they're kind==="cs") never shows it; a role that HAS one shows it only
  // when there's no capacityMode gate at all (mines — undefined) or the
  // caller's capacityMode says per_wh (p-median-us/brazil's per-warehouse
  // capacity). "none"/"uniform" both hide it — a uniform-capacity scenario
  // has no per-warehouse override to set, and two-echelon's refineries
  // always pass "none" (no capacity concept for that role at all).
  const showCapacity = role.valueField?.key === "capacity" && (capacityMode === undefined || capacityMode === "per_wh");

  const handleSubmit = () => {
    if (kind === "cs") {
      // T8 (Bundle 2.2, A3) — same "omit the key entirely" convention as the
      // wh/pl branch below: !showCustomerExclusion (STATION_ROLE, or a
      // customer on a model without supportsAddedCustomerExclusion) never
      // populates `status` at all.
      const input: AddedCustomerInput = {
        id,
        displayCode,
        city,
        state,
        lat,
        lng,
        demand: Number(demand) || 0,
        ...(showCustomerExclusion ? { status: csStatus } : {}),
      };
      onSubmit(input);
    } else {
      // kind === "wh" or "pl" (jade-T12) — role.hasStatus:false (e.g.
      // MINE_ROLE/PLANT_ROLE) and !showCapacity (e.g. REFINERY_ROLE with
      // capacityMode="none", or PLANT_ROLE which has no valueField at all)
      // both omit the key entirely from the emitted object, not just leave
      // it undefined, so it can never round-trip into a PATCH payload as a
      // stray no-op field. For PLANT_ROLE this yields exactly
      // `{id, displayCode, city, state, lat, lng}` — AddedPlant's shape.
      const input = {
        id,
        displayCode,
        city,
        state,
        lat,
        lng,
        ...(showCapacity ? { capacity: capacity === "" ? null : Number(capacity) } : {}),
        ...(role.hasStatus ? { status } : {}),
      };
      onSubmit(input as unknown as AddedWarehouseInput);
    }
  };

  const title = `New ${role.label}`;

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="create-entity-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {title}
            {copyFrom ? " (copy)" : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Latitude</span>
              <p className="font-mono" data-testid="create-entity-lat">{formatCoord(lat)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Longitude</span>
              <p className="font-mono" data-testid="create-entity-lng">{formatCoord(lng)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="create-entity-city" className="text-xs font-semibold text-foreground">
                City
              </Label>
              <Input
                id="create-entity-city"
                value={city}
                onChange={e => setCity(e.target.value)}
                data-testid="create-entity-city"
              />
            </div>
            <div>
              <Label htmlFor="create-entity-state" className="text-xs font-semibold text-foreground">
                State
              </Label>
              <Input
                id="create-entity-state"
                value={state}
                onChange={e => setState(e.target.value)}
                data-testid="create-entity-state"
              />
            </div>
          </div>

          <div>
            <span className="text-xs text-muted-foreground">Display code</span>
            <p data-testid="create-entity-display-code">{displayCode}</p>
          </div>

          {/* jade-T12 — flipped to key off "cs" (was `kind === "wh"`): "pl"
              now shares this branch with "wh" (both are role-gated
              status/capacity, correctly rendering nothing for PLANT_ROLE,
              which has neither). */}
          {kind !== "cs" ? (
            <>
              {role.hasStatus && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground">Status</Label>
                  <RadioGroup
                    value={status}
                    onValueChange={v => setStatus(v as WhStatus)}
                    data-testid="create-entity-status"
                  >
                    {STATUS_OPTIONS.map(option => (
                      <div key={option} className="flex items-center gap-2">
                        <RadioGroupItem
                          value={option}
                          id={`create-entity-status-${option}`}
                          data-testid={`create-entity-status-${option}`}
                        />
                        <Label htmlFor={`create-entity-status-${option}`} className="text-sm font-normal">
                          {warehouseStatusPresentation[option].label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}
              {showCapacity && (
                <div className="space-y-2">
                  <Label htmlFor="create-entity-capacity" className="text-xs font-semibold text-foreground">
                    Capacity
                  </Label>
                  <Input
                    id="create-entity-capacity"
                    type="number"
                    min={0}
                    value={capacity}
                    onChange={e => setCapacity(e.target.value)}
                    className="font-mono"
                    data-testid="create-entity-capacity"
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="create-entity-demand" className="text-xs font-semibold text-foreground">
                  Demand
                </Label>
                <Input
                  id="create-entity-demand"
                  type="number"
                  min={0}
                  value={demand}
                  onChange={e => setDemand(e.target.value)}
                  className="font-mono"
                  data-testid="create-entity-demand"
                />
              </div>
              {showCustomerExclusion && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground">Status</Label>
                  <RadioGroup
                    value={csStatus}
                    onValueChange={v => setCsStatus(v as "active" | "excluded")}
                    data-testid="create-entity-cs-status"
                  >
                    {CUSTOMER_STATUS_OPTIONS.map(option => (
                      <div key={option} className="flex items-center gap-2">
                        <RadioGroupItem
                          value={option}
                          id={`create-entity-cs-status-${option}`}
                          data-testid={`create-entity-cs-status-${option}`}
                        />
                        <Label htmlFor={`create-entity-cs-status-${option}`} className="text-sm font-normal">
                          {option === "active" ? "Active" : "Excluded"}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="create-entity-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} data-testid="create-entity-submit">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SCU-2.P4.2 (spec B2.8) — "+ Add {Entity}" from an input table. Same dialog
// shell and `create-entity-*` testids as the map flow, but:
//   - lat/lng are editable inputs (the map prefills them read-only), filled
//     from the gazetteer on City/State blur while they are still empty;
//   - the display code is editable (derived until the student types one);
//   - validation messages are the inline add forms' messages, verbatim;
//   - demand (customer, station, JADE per product) is a FormattedNumberInput
//     and an EMPTY demand blocks submit (B2.9 — no silent 0);
//   - submit emits a discriminated `CreateEntitySubmit` for six kinds.
// ---------------------------------------------------------------------------

export type CreateEntityKind = "warehouse" | "customer" | "plant" | "mine" | "station" | "refinery";

export type CreateEntitySubmit =
  | { kind: "warehouse"; entity: AddedWarehouseInput }
  | { kind: "refinery"; entity: AddedWarehouseInput }
  | { kind: "customer"; entity: AddedCustomerInput & { demands?: Record<string, number> } }
  | { kind: "plant"; entity: AddedPlantInput }
  | { kind: "mine"; entity: AddedMine }
  | { kind: "station"; entity: AddedStation };

interface TableCreateEntityDialogProps {
  source: "table";
  entityKind: CreateEntityKind;
  /** Warehouses: "per_wh" shows Capacity (as the inline form did). Ignored for other kinds. */
  capacityMode?: "none" | "uniform" | "per_wh";
  /** false → no State field and "City is required." (WarehousesTab/CustomersTab `hasStateColumn`). */
  hasStateColumn?: boolean;
  /** D30: whole-number scalar demand (max-coverage-us customers). Stations are always integer. */
  integerDemand?: boolean;
  /** Unit in the demand field labels (customer/station only); defaults to "units". */
  demandUnit?: Chapter["demandUnit"];
  /** JADE: one required demand field per product instead of the scalar demand. */
  products?: ReadonlyArray<{ id: string; name: string }>;
  /** Display codes already used by this entity's ADDED rows (collision check + derivation). */
  existingCodes: Iterable<string>;
  onCreate: (result: CreateEntitySubmit) => void;
  onCancel: () => void;
  /** History read-only (D2): every field and Add are disabled; Cancel stays enabled. */
  readOnly?: boolean;
}

export type CreateEntityDialogProps = MapCreateEntityDialogProps | TableCreateEntityDialogProps;

export function CreateEntityDialog(props: CreateEntityDialogProps) {
  return props.source === "table" ? <TableCreateEntityDialog {...props} /> : <MapCreateEntityDialog {...props} />;
}

const TABLE_ROLE: Record<CreateEntityKind, EntityRoleConfig> = {
  warehouse: WAREHOUSE_ROLE,
  refinery: REFINERY_ROLE,
  customer: CUSTOMER_ROLE,
  plant: PLANT_ROLE,
  mine: MINE_ROLE,
  station: STATION_ROLE,
};


const CAPACITY_ERROR: Partial<Record<CreateEntityKind, string>> = {
  warehouse: "Capacity must be a positive number, or left blank.",
  mine: "Capacity must be a positive number, or left blank for unconstrained.",
};

function TableCreateEntityDialog({
  entityKind,
  capacityMode,
  hasStateColumn = true,
  integerDemand = false,
  demandUnit = "units",
  products = [],
  existingCodes,
  onCreate,
  onCancel,
  readOnly = false,
}: TableCreateEntityDialogProps) {
  const role = TABLE_ROLE[entityKind];
  const id = useMemo(() => newUid(role.uidKind), [role.uidKind]);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  // The inline forms' "touched" rule (WarehousesTab T9): the first focus of
  // lat/lng clears it and stops later City/State blurs from auto-filling it.
  const [latTouched, setLatTouched] = useState(false);
  const [lngTouched, setLngTouched] = useState(false);
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const [status, setStatus] = useState<WhStatus>("active");
  const [capacity, setCapacity] = useState("");
  const [demand, setDemand] = useState<number | null>(null);
  const [demands, setDemands] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);

  const codes = useMemo(() => Array.from(existingCodes), [existingCodes]);
  const derivedCode = nextDisplayCode(role.uidKind, state.trim(), city.trim(), codes);
  const displayCode = typedCode ?? derivedCode;

  const showCapacity =
    entityKind === "mine" || (entityKind === "warehouse" && capacityMode === "per_wh");
  const showStatus = entityKind === "warehouse" || entityKind === "refinery";
  const isDemandKind = entityKind === "customer" || entityKind === "station";
  const perProduct = entityKind === "customer" && products.length > 0;

  function handleCityStateBlur() {
    const c = city.trim();
    const st = state.trim();
    if (!c || !st) return;
    const hit = lookupCity(c, st);
    if (!hit) return;
    if (!latTouched) setLat(String(hit.lat));
    if (!lngTouched) setLng(String(hit.lng));
  }

  function handleSubmit() {
    if (readOnly) return;
    const c = city.trim();
    const st = state.trim();
    if (!c || (hasStateColumn && !st)) {
      setError(hasStateColumn ? "City and state are both required." : "City is required.");
      return;
    }
    const code = displayCode.trim();
    if (typedCode !== null && code && codes.includes(code)) {
      setError(`Display code '${code}' is already in use by another ${role.label} in this scenario.`);
      return;
    }
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
      setError("Latitude and longitude must both be numbers.");
      return;
    }
    let cap: number | null = null;
    if (showCapacity && capacity.trim() !== "") {
      const parsed = parseFloat(capacity);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError(CAPACITY_ERROR[entityKind]!);
        return;
      }
      cap = parsed;
    }
    const base = { id, displayCode: code || undefined, city: c, state: st, lat: latN, lng: lngN };

    if (perProduct) {
      const out: Record<string, number> = {};
      for (const p of products) {
        const v = demands[p.id];
        if (v == null) {
          setError(`Demand for ${p.name} must be a number ≥ 0.`);
          return;
        }
        out[p.id] = v;
      }
      const total = Object.values(out).reduce((sum, v) => sum + v, 0);
      onCreate({ kind: "customer", entity: { ...base, demand: total, demands: out } });
      return;
    }
    if (isDemandKind && demand == null) {
      setError("Demand must be a number ≥ 0.");
      return;
    }
    switch (entityKind) {
      case "customer":
        onCreate({ kind: "customer", entity: { ...base, demand: demand! } });
        return;
      case "station":
        onCreate({ kind: "station", entity: { ...base, demand: demand! } });
        return;
      case "mine":
        onCreate({ kind: "mine", entity: { ...base, capacity: cap } });
        return;
      case "plant":
        onCreate({ kind: "plant", entity: base });
        return;
      case "warehouse":
        onCreate({ kind: "warehouse", entity: { ...base, ...(showCapacity ? { capacity: cap } : {}), status } });
        return;
      case "refinery":
        onCreate({ kind: "refinery", entity: { ...base, status } });
        return;
    }
  }

  const field = (testId: string, label: string, input: React.ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={testId} className="text-xs font-semibold text-foreground">
        {label}
      </Label>
      {input}
    </div>
  );

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="create-entity-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">{`New ${role.label}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            {field(
              "create-entity-city",
              "City",
              <Input id="create-entity-city" value={city} onChange={e => setCity(e.target.value)} onBlur={handleCityStateBlur} disabled={readOnly} title={readOnly ? READ_ONLY_TITLE : undefined} data-testid="create-entity-city" />,
            )}
            {hasStateColumn &&
              field(
                "create-entity-state",
                "State",
                <Input id="create-entity-state" value={state} onChange={e => setState(e.target.value)} onBlur={handleCityStateBlur} disabled={readOnly} title={readOnly ? READ_ONLY_TITLE : undefined} data-testid="create-entity-state" />,
              )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field(
              "create-entity-lat",
              "Latitude",
              <Input
                id="create-entity-lat"
                inputMode="decimal"
                value={lat}
                onFocus={() => {
                  if (!latTouched) {
                    setLatTouched(true);
                    setLat("");
                  }
                }}
                onChange={e => setLat(e.target.value)}
                className={`font-mono ${!latTouched && lat ? "bg-muted text-muted-foreground" : ""}`}
                disabled={readOnly}
                title={readOnly ? READ_ONLY_TITLE : undefined}
                data-testid="create-entity-lat"
              />,
            )}
            {field(
              "create-entity-lng",
              "Longitude",
              <Input
                id="create-entity-lng"
                inputMode="decimal"
                value={lng}
                onFocus={() => {
                  if (!lngTouched) {
                    setLngTouched(true);
                    setLng("");
                  }
                }}
                onChange={e => setLng(e.target.value)}
                className={`font-mono ${!lngTouched && lng ? "bg-muted text-muted-foreground" : ""}`}
                disabled={readOnly}
                title={readOnly ? READ_ONLY_TITLE : undefined}
                data-testid="create-entity-lng"
              />,
            )}
          </div>
          {field(
            "create-entity-display-code",
            "Display code",
            <Input
              id="create-entity-display-code"
              value={displayCode}
              onChange={e => setTypedCode(e.target.value)}
              disabled={readOnly}
              title={readOnly ? READ_ONLY_TITLE : undefined}
              data-testid="create-entity-display-code"
            />,
          )}

          {showStatus && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Status</Label>
              <RadioGroup value={status} onValueChange={v => setStatus(v as WhStatus)} disabled={readOnly} data-testid="create-entity-status">
                {STATUS_OPTIONS.map(option => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem value={option} id={`create-entity-status-${option}`} title={readOnly ? READ_ONLY_TITLE : undefined} data-testid={`create-entity-status-${option}`} />
                    <Label htmlFor={`create-entity-status-${option}`} className="text-sm font-normal">
                      {warehouseStatusPresentation[option].label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}
          {showCapacity &&
            field(
              "create-entity-capacity",
              "Capacity",
              <Input
                id="create-entity-capacity"
                type="number"
                min={0}
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                className="font-mono"
                disabled={readOnly}
                title={readOnly ? READ_ONLY_TITLE : undefined}
                data-testid="create-entity-capacity"
              />,
            )}
          {perProduct
            ? products.map(p =>
                field(
                  `create-entity-demand-${p.id}`,
                  `Demand — ${p.name} (${demandUnit})`,
                  <FormattedNumberInput
                    id={`create-entity-demand-${p.id}`}
                    value={demands[p.id] ?? null}
                    onChange={v => setDemands(prev => ({ ...prev, [p.id]: v }))}
                    className="font-mono"
                    disabled={readOnly}
                    title={readOnly ? READ_ONLY_TITLE : undefined}
                    data-testid={`create-entity-demand-${p.id}`}
                  />,
                ),
              )
            : isDemandKind &&
              field(
                "create-entity-demand",
                demandHeader(demandUnit),
                <FormattedNumberInput
                  id="create-entity-demand"
                  value={demand}
                  onChange={setDemand}
                  integer={entityKind === "station" || integerDemand}
                  className="font-mono"
                  disabled={readOnly}
                  title={readOnly ? READ_ONLY_TITLE : undefined}
                  data-testid="create-entity-demand"
                />,
              )}
          {error && (
            <p className="text-[11px] text-destructive" data-testid="create-entity-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="create-entity-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={readOnly}
            title={readOnly ? READ_ONLY_TITLE : undefined}
            data-testid="create-entity-submit"
          >
            Add {role.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
