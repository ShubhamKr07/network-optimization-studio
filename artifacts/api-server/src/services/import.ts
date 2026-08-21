import Papa from "papaparse";
import { TEMPLATE_VERSION, applyWarehouseOverrides, applyCustomerOverrides, applyGoldCustomerOverrides, applyMineOverrides, applyStationOverrides, applyRefineryOverrides } from "./templates.js";
import { TOTAL_DEMAND } from "../data/dataset.js";
import { buildPMedianIdSpaces, buildTransportIdSpaces } from "./precheck.js";

export type ImportErrorClass = "format" | "syntax" | "logic";

export interface ImportError {
  errorClass: ImportErrorClass;
  line: number | null; // null for whole-file format errors (no single row to blame)
  message: string;
}

export interface ImportRowChange {
  id: string;
  line: number;
  before: { status: string; value: number | null };
  after: { status: string; value: number | null };
  // Populated only for the composite-keyed `distances` entity (B4.1) —
  // `(fromId, toId)` together identify a row, unlike every other entity's
  // single `id`. `.id` still carries a composite display string
  // (`${fromId}|${toId}`) so entity-agnostic UI rendering (ImportDialog)
  // doesn't need a special case; these give the apply route structured
  // access to the two halves without parsing that string back apart.
  fromId?: string;
  toId?: string;
  // B4.2 — add-mode for warehouses/customers. `changeType` distinguishes an
  // ADD (unrecognized id + valid new-entity data — writes into
  // scenario.inputs.addedWarehouses/addedCustomers on apply) from the
  // default "update" (writes into warehouseOverrides/customerOverrides, the
  // pre-existing behavior). `before` for an ADD row is always
  // `{status: "not_present", value: null}` — there is nothing to diff
  // against, the id didn't exist a moment ago. `city`/`state`/`lat`/`lng`
  // carry the extra structured data an ADD needs that has no home in
  // before/after's shape; kept as flat optional fields (same additive
  // pattern as fromId/toId above) rather than a new sibling type — see the
  // B4.2 report for the full justification.
  changeType?: "update" | "add";
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
}

export interface ImportPreview {
  errors: ImportError[];
  changes: ImportRowChange[];
  warnings: string[];
}

export type ImportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries" | "distances" | "laneCosts";

// Entities that fit the generic single-id-row model below — everything
// EXCEPT the two composite-keyed (fromId,toId) entities (distances,
// laneCosts), which have their own dedicated parsing functions (see this
// file's header comment on `distances` and Task 30's laneCosts addition
// below).
type SingleIdEntity = Exclude<ImportEntity, "distances" | "laneCosts">;

// `distances`/`laneCosts` are intentionally absent from COLUMNS/
// ENTITY_HAS_VALUE/VALID_STATUSES below — they don't fit the single-id row
// model those tables describe (composite key, no status column, no baseline
// "current override list" to diff unknown-ness against). Their column
// layouts are DISTANCES_COLUMNS/LANE_COST_COLUMNS just below, and they're
// each parsed by a wholly separate function (parseDistancesRows/
// parseLaneCostRows), not this file's generic per-row loop.
const DISTANCES_COLUMNS = ["template_version", "from_id", "to_id", "distance"];
// Task 30 (B6.1 stage 4) — transport-coal's composite-keyed entity, the
// laneCostOverrides analogue of p-median-us's distanceOverrides. Named
// "cost" (not "distance"), matching stage 1-3's own established vocabulary
// decision for this model (transportLp.ts's laneCostOverrideSchema) even
// though the underlying values are the same kind of quantity.
const LANE_COST_COLUMNS = ["template_version", "from_id", "to_id", "cost"];

// Singular display label per entity, used in a handful of free-text error
// messages below (id-collision, add-mode "lat/lng required"/"city and state
// required"). Previously these messages were inline `entity === "warehouses"
// ? "warehouse" : "customer"` ternaries — Task 30 (B6.1 stage 4) generalizes
// past the 2-way ternary once mines/stations also gain add-mode.
const ENTITY_SINGULAR_LABEL: Record<SingleIdEntity, string> = {
  warehouses: "warehouse",
  customers: "customer",
  mines: "mine",
  stations: "station",
  refineries: "refinery",
};

// B4.2 — warehouses/customers gain lat/lng columns (positioned after state,
// before the value column), a binding column-format decision this task made:
// B1.1's addedWarehouses/addedCustomers Zod schema requires real coordinates
// for a brand-new entity, which the pre-B4.2 6-column format had no room
// for. This is a breaking format change (old exported templates no longer
// header-match) — deliberate, not an oversight; B4.3 updates the template
// generator to match.
// Task 30 (B6.1 stage 4) — mines/stations get the SAME breaking lat/lng
// addition, for the same reason: addedMineSchema/addedStationSchema
// (transportLp.ts) both require real coordinates for a brand-new mine/
// station, which the pre-Task-30 5-column format had no room for.
// refineries stays untouched — add-mode remains out of scope for it (no
// analogous "add a refinery" concept was requested).
const COLUMNS: Record<SingleIdEntity, string[]> = {
  warehouses: ["template_version", "id", "city", "state", "lat", "lng", "capacity", "status"],
  customers: ["template_version", "id", "city", "state", "lat", "lng", "demand", "status"],
  mines: ["template_version", "id", "city", "state", "lat", "lng", "capacity"],
  stations: ["template_version", "id", "city", "state", "lat", "lng", "demand"],
  // Refineries have status but no value column at all (two-echelon-gold-au
  // has no per-refinery capacity concept) — the only entity with a status
  // column and no value column.
  refineries: ["template_version", "id", "city", "state", "status"],
};

// Which entities carry lat/lng columns (see COLUMNS' comment above) — used
// to compute the value/status column offsets below, and to know which
// entities may run the add-mode branch at all. Task 30 — mines/stations join
// warehouses/customers here (refineries still doesn't; add-mode stays out of
// scope for it).
const ENTITY_HAS_LATLNG: Record<SingleIdEntity, boolean> = {
  warehouses: true,
  customers: true,
  mines: true,
  stations: true,
  refineries: false,
};

// Whether this entity's rows carry a capacity/demand value column at all.
// Refineries is the one entity with none. distances/laneCosts aren't here at
// all — each has its own value-shaped column but no capacity/demand-style
// value semantics (see this file's header comment): they're parsed by their
// own dedicated functions, never by the generic per-row loop below that
// consults this table.
const ENTITY_HAS_VALUE: Record<SingleIdEntity, boolean> = {
  warehouses: true,
  customers: true,
  mines: true,
  stations: true,
  refineries: false,
};

const VALID_STATUSES: Record<SingleIdEntity, string[]> = {
  warehouses: ["active", "forced_open", "inactive"],
  customers: ["active", "excluded"],
  // Mines/stations have no status column (no open/close concept) — never
  // consulted because the per-row status validation is gated on entityHasStatus.
  mines: [],
  stations: [],
  refineries: ["active", "forced_open", "inactive"],
};

interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }
interface CustomerOverride { id: string; demand?: number | null; status: "active" | "excluded"; }
interface MineOverride { id: string; capacity?: number | null; }
interface StationOverride { id: string; demand?: number | null; }
interface RefineryOverride { id: string; status: "active" | "forced_open" | "inactive"; }
interface DistanceOverride { fromId: string; toId: string; distance: number; }
// Task 30 (B6.1 stage 4) — laneCostOverrides' element shape (transportLp.ts's
// laneCostOverrideSchema), mirroring DistanceOverride's role above.
interface LaneCostOverride { fromId: string; toId: string; cost: number; }
interface AddedEntityRef { id: string; }

export interface ImportCurrentOverrides {
  warehouseOverrides?: WarehouseOverride[];
  customerOverrides?: CustomerOverride[];
  mineCapacities?: Record<string, number>;
  stationDemands?: Record<string, number>;
  refineryOverrides?: RefineryOverride[];
  // B4.1 (distances entity) — a scenario's existing distanceOverrides
  // (composite-keyed diff baseline) plus its addedWarehouses/addedCustomers
  // (reference-integrity id spaces, via precheck.ts's buildPMedianIdSpaces).
  // distances is p-median-us only for this phase, so these are the only
  // entity family that reads them.
  distanceOverrides?: DistanceOverride[];
  addedWarehouses?: AddedEntityRef[];
  addedCustomers?: AddedEntityRef[];
  // Task 30 (B6.1 stage 4) — transport-coal's analogues of the above,
  // needed for mines/stations add-mode's id-space/collision check (via
  // buildTransportIdSpaces) and laneCosts' reference-integrity check, same
  // role addedWarehouses/addedCustomers play for the p-median-us pair.
  laneCostOverrides?: LaneCostOverride[];
  addedMines?: AddedEntityRef[];
  addedStations?: AddedEntityRef[];
}

export function parseAndValidateImport(
  entity: ImportEntity,
  csvText: string,
  currentOverrides: ImportCurrentOverrides,
  pValue: number,
  // "customers" is a shared entity name between p-median-us (200-row
  // dataset) and two-echelon-gold-au (10-row dataset) — modelId disambiguates
  // which baseline to validate against. Defaults to p-median-us so existing
  // callers/tests that never passed this don't need to change.
  modelId: string = "p-median-us",
): ImportPreview {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const warnings: string[] = [];

  // format: bad encoding — an already-mangled file decodes with U+FFFD replacement chars.
  if (csvText.includes("�")) {
    errors.push({ errorClass: "format", line: null, message: "File contains invalid/undecodable characters (bad encoding)." });
    return { errors, changes, warnings };
  }

  const trimmed = csvText.trim();
  if (trimmed === "") {
    errors.push({ errorClass: "format", line: null, message: "File is empty." });
    return { errors, changes, warnings };
  }

  const parsed = Papa.parse<string[]>(trimmed, { skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      errors.push({ errorClass: "syntax", line: e.row != null ? e.row + 2 : null, message: e.message });
    }
    return { errors, changes, warnings };
  }

  const rows = parsed.data;
  const expectedColumns =
    entity === "distances" ? DISTANCES_COLUMNS
    : entity === "laneCosts" ? LANE_COST_COLUMNS
    : COLUMNS[entity];
  const header = rows[0]?.map(h => h.trim()) ?? [];
  const headerMatches = header.length === expectedColumns.length && expectedColumns.every((c, i) => header[i] === c);
  if (!headerMatches) {
    errors.push({
      errorClass: "format",
      line: 1,
      message: `Expected columns "${expectedColumns.join(",")}", got "${header.join(",")}". Rows must be keyed by id, not city — city names are not unique.`,
    });
    return { errors, changes, warnings };
  }

  // distances is composite-keyed (from_id,to_id) and has no baseline
  // "current override list" to diff unknown-ness against (a scenario's
  // distanceOverrides normally starts empty) — it does not fit the
  // single-id row model the rest of this function implements below, so it
  // gets its own function rather than being forced through COLUMNS/
  // ENTITY_HAS_VALUE/VALID_STATUSES/the Map<id,row> baseline logic.
  // "Unknown" for a distances row means reference-integrity against the id
  // spaces (base dataset + this scenario's added entities) — the same rule
  // B2.1's precheck.ts enforces at solve time, via its shared
  // buildPMedianIdSpaces helper (not re-implemented differently here).
  if (entity === "distances") {
    const { warehouseIdSpace, customerIdSpace } = buildPMedianIdSpaces(currentOverrides);
    const distanceResult = parseDistancesRows(rows.slice(1), currentOverrides.distanceOverrides ?? [], warehouseIdSpace, customerIdSpace);
    return { errors: distanceResult.errors, changes: distanceResult.changes, warnings: [] };
  }

  // Task 30 (B6.1 stage 4) — laneCosts is transport-coal's composite-keyed
  // entity, the exact same shape/reasoning as distances above (see its
  // header comment) — "unknown" here means reference-integrity against
  // buildTransportIdSpaces (base mines/stations + this scenario's added
  // ones), the same rule precheckTransportInputs enforces at solve time.
  if (entity === "laneCosts") {
    const { mineIdSpace, stationIdSpace } = buildTransportIdSpaces(currentOverrides);
    const laneCostResult = parseLaneCostRows(rows.slice(1), currentOverrides.laneCostOverrides ?? [], mineIdSpace, stationIdSpace);
    return { errors: laneCostResult.errors, changes: laneCostResult.changes, warnings: [] };
  }

  // Mines/stations store overrides as sparse dicts (mineCapacities/
  // stationDemands); convert to the array shape the apply* functions take,
  // same direction Studio's tables do internally. Deliberately built from
  // ONLY the base dataset (via the apply* functions' first param), never
  // including addedMines/addedStations — same "baseline excludes added
  // entities" rule warehouses/customers already establish just below (see
  // the id_collision branch's own comment): a CSV row whose id matches a
  // previously-added mine/station is rejected as a collision, not silently
  // treated as an update to it.
  const baseline =
    entity === "warehouses" ? applyWarehouseOverrides(currentOverrides.warehouseOverrides ?? [])
    : entity === "customers" ? (
        modelId === "two-echelon-gold-au"
          ? applyGoldCustomerOverrides(currentOverrides.customerOverrides ?? [])
          : applyCustomerOverrides(currentOverrides.customerOverrides ?? [])
      )
    : entity === "mines" ? applyMineOverrides(Object.entries(currentOverrides.mineCapacities ?? {}).map(([id, capacity]) => ({ id, capacity })))
    : entity === "refineries" ? applyRefineryOverrides(currentOverrides.refineryOverrides ?? [])
    : applyStationOverrides(Object.entries(currentOverrides.stationDemands ?? {}).map(([id, demand]) => ({ id, demand })));
  const baselineById = new Map(baseline.map(r => [r.id, r] as const));
  // Mines/stations carry no status column, so status parsing/validation is
  // skipped for them (only warehouses/customers/refineries validate status).
  const entityHasStatus = entity === "warehouses" || entity === "customers" || entity === "refineries";
  const entityHasValue = ENTITY_HAS_VALUE[entity];
  const validStatuses = VALID_STATUSES[entity];
  const valueLabel = entity === "warehouses" || entity === "mines" ? "capacity" : "demand";
  // Value/status column positions shift by 2 for warehouses/customers (the
  // lat,lng columns inserted between state and value/status). Value (when
  // present) sits right after lat/lng; status (when present) follows the
  // value column, or takes its slot if there's no value column (refineries).
  const entityHasLatLng = ENTITY_HAS_LATLNG[entity];
  const latLngOffset = entityHasLatLng ? 2 : 0;
  const valueColIdx = 4 + latLngOffset;
  const statusColIdx = entityHasValue ? 5 + latLngOffset : 4 + latLngOffset;

  // B4.2 — add-mode for warehouses/customers. "customers" is shared with
  // two-echelon-gold-au, whose schema (twoEchelonInputsSchema) has no
  // addedCustomers field at all — add-mode there would silently vanish on
  // re-validation, so it's restricted to p-median-us, matching every other
  // scenario-local network-edit feature's (B1.1-B4.1) established model
  // boundary.
  // Task 30 (B6.1 stage 4) — mines/stations join the add-mode set
  // (transportLp.ts's addedMineSchema/addedStationSchema both exist and are
  // transport-coal's only model, so no cross-model ambiguity to guard
  // against the way customers needs). refineries stays out of scope — no
  // addedRefineries field exists anywhere.
  const canAdd = entity === "warehouses" || (entity === "customers" && modelId === "p-median-us") || entity === "mines" || entity === "stations";
  // Base dataset ids ∪ this scenario's already-added entity ids — the same
  // id-space precheck.ts's own reference-integrity check and B4.1's
  // distances parsing use. Doubles here as the "unknown against base" check
  // (the ADD/UPDATE branch point) and the "already added, this would be a
  // duplicate add" collision check.
  const idSpace = canAdd
    ? (entity === "warehouses" ? buildPMedianIdSpaces(currentOverrides).warehouseIdSpace
      : entity === "customers" ? buildPMedianIdSpaces(currentOverrides).customerIdSpace
      : entity === "mines" ? buildTransportIdSpaces(currentOverrides).mineIdSpace
      : buildTransportIdSpaces(currentOverrides).stationIdSpace)
    : new Set<string>();

  const seenIds = new Set<string>();
  const dataRows = rows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== expectedColumns.length) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${expectedColumns.length} columns, got ${cols.length}` });
      continue;
    }

    const [tvStr, id] = cols;

    if (Number(tvStr) !== TEMPLATE_VERSION) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${TEMPLATE_VERSION}` });
      continue;
    }

    if (!id) {
      errors.push({ errorClass: "logic", line, message: `Unknown id "${id}"` });
      continue;
    }

    const baselineRow = baselineById.get(id);
    let isAdd = false;
    if (!baselineRow) {
      if (!canAdd) {
        errors.push({ errorClass: "logic", line, message: `Unknown id "${id}"` });
        continue;
      }
      // Recommended-and-implemented collision decision (see B4.2 report):
      // an "add" row whose id already exists as a previously-added entity is
      // rejected outright, not silently downgraded to an update — a silent
      // fallback could surprise a student who believed they were adding
      // something genuinely new. (A collision against the BASE dataset
      // can't reach this branch at all — such an id always resolves via
      // baselineById above and is handled as a plain update instead.)
      if (idSpace.has(id)) {
        errors.push({
          errorClass: "logic",
          line,
          message: `Id "${id}" already exists as a previously-added ${ENTITY_SINGULAR_LABEL[entity]} in this scenario — cannot add a duplicate`,
        });
        continue;
      }
      isAdd = true;
    }

    if (seenIds.has(id)) {
      errors.push({ errorClass: "logic", line, message: `Duplicate id "${id}"` });
      continue;
    }
    seenIds.add(id);

    // ADD rows need real coordinates — an existing base-dataset entity's
    // coordinates are already fixed by the dataset, so lat/lng may be
    // blank/ignored on UPDATE rows (this task's binding column-format
    // decision), but a row claiming a brand-new id has nothing to fall
    // back to. Checked before value/status so a row that's simultaneously
    // missing coordinates AND has some other issue reports the
    // coordinates problem first (the more fundamental one for an add).
    let lat = 0;
    let lng = 0;
    if (isAdd) {
      const latStr = cols[4];
      const lngStr = cols[5];
      const parsedLat = Number(latStr);
      const parsedLng = Number(lngStr);
      if (latStr.trim() === "" || lngStr.trim() === "" || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        errors.push({
          errorClass: "logic",
          line,
          message: `lat/lng are required to add a new ${ENTITY_SINGULAR_LABEL[entity]} (unrecognized id "${id}")`,
        });
        continue;
      }
      lat = parsedLat;
      lng = parsedLng;
    }

    const valueStr = entityHasValue ? cols[valueColIdx] : "";
    const status = entityHasStatus ? cols[statusColIdx] : "active";

    let value: number | null = null;
    if (entityHasValue && valueStr !== "") {
      const parsedValue = Number(valueStr);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        errors.push({ errorClass: "logic", line, message: `${valueLabel} must be a non-negative number, got "${valueStr}"` });
        continue;
      }
      value = parsedValue;
    }

    // addedCustomerSchema (B1.1) requires a plain, non-nullable demand —
    // unlike customerOverrideSchema, which allows a blank/null demand on an
    // UPDATE row. A brand-new customer can't be added with no demand at all.
    // Task 30 (B6.1 stage 4) — addedStationSchema has the identical
    // requirement (transportLp.ts: `demand: z.number().nonnegative()`, no
    // `.optional()`), so stations joins this check. addedMineSchema's
    // capacity stays nullable/optional — a blank capacity on an added mine
    // is a deliberate, valid "unconstrained" state (matches solve.py's
    // get_base_capacity None-means-unconstrained convention), so mines is
    // NOT added here.
    if (isAdd && (entity === "customers" || entity === "stations") && value === null) {
      errors.push({ errorClass: "logic", line, message: `demand is required to add a new ${ENTITY_SINGULAR_LABEL[entity]} (unrecognized id "${id}")` });
      continue;
    }

    if (entityHasStatus && !validStatuses.includes(status)) {
      errors.push({ errorClass: "logic", line, message: `Invalid status "${status}" (expected one of ${validStatuses.join(", ")})` });
      continue;
    }

    // addedCustomerSchema has no status field at all — v1 has no way to add
    // a customer and mark it excluded in the same breath (see precheck.ts's
    // header comment). Reject rather than silently dropping the student's
    // explicit "excluded" choice.
    if (isAdd && entity === "customers" && status !== "active") {
      errors.push({
        errorClass: "logic",
        line,
        message: `newly added customers must have status "active" (add-and-exclude is not supported)`,
      });
      continue;
    }

    if (isAdd) {
      const city = cols[2];
      const state = cols[3];
      if (!city.trim() || !state.trim()) {
        errors.push({
          errorClass: "logic",
          line,
          message: `city and state are required to add a new ${ENTITY_SINGULAR_LABEL[entity]} (unrecognized id "${id}")`,
        });
        continue;
      }
      changes.push({
        id,
        line,
        before: { status: "not_present", value: null },
        after: { status, value },
        changeType: "add",
        city,
        state,
        lat,
        lng,
      });
      continue;
    }

    const beforeValue = !entityHasValue ? null
      : entity === "warehouses" || entity === "mines"
      ? (baselineRow as { capacity: number | null }).capacity
      : (baselineRow as { demand: number }).demand;
    const beforeStatus = entityHasStatus ? (baselineRow as unknown as { status: string }).status : "active";

    if (beforeStatus !== status || beforeValue !== value) {
      changes.push({
        id,
        line,
        before: { status: beforeStatus, value: beforeValue },
        after: { status, value },
      });
    }
  }

  // Cross-field warning (non-blocking): total capacity of the p highest-
  // capacity active warehouses vs total customer demand. P-median-only —
  // transport-coal has no P and no aggregate capacity-vs-demand check here.
  if (errors.length === 0 && entity === "warehouses") {
    const changeByIdMap = new Map(changes.map(c => [c.id, c]));
    const warehouseBaseline = baseline as unknown as Array<{ id: string; status: "active" | "forced_open" | "inactive"; capacity: number | null }>;
    const merged = [
      ...warehouseBaseline.map(row => {
        const change = changeByIdMap.get(row.id);
        return change && change.changeType !== "add" ? { ...row, status: change.after.status as typeof row.status, capacity: change.after.value } : row;
      }),
      // B4.2 — a newly-added warehouse isn't in warehouseBaseline (only the
      // 26 base ids are) but still counts toward "the p highest-capacity
      // active warehouses" once it exists.
      ...changes
        .filter(c => c.changeType === "add")
        .map(c => ({ id: c.id, status: c.after.status as "active" | "forced_open" | "inactive", capacity: c.after.value })),
    ];
    const activeCapacities = merged
      .filter(r => r.status !== "inactive")
      .map(r => r.capacity)
      .filter((c): c is number => c != null)
      .sort((a, b) => b - a);
    if (activeCapacities.length >= pValue) {
      const totalCapacityForP = activeCapacities.slice(0, pValue).reduce((s, c) => s + c, 0);
      if (totalCapacityForP < TOTAL_DEMAND) {
        warnings.push(
          `Total capacity of the ${pValue} highest-capacity active warehouses (${totalCapacityForP.toLocaleString()}) ` +
          `is less than total customer demand (${TOTAL_DEMAND.toLocaleString()}).`,
        );
      }
    }
  }

  return { errors, changes, warnings };
}

// B4.1 — composite-key (from_id,to_id) parsing branch for the distances
// entity, deliberately separate from the generic single-id loop above (see
// this file's header comment). `dataRows` excludes the header row (already
// consumed/validated by the caller). No cross-field warning: the
// capacity-vs-demand warning above is warehouses-only and has no distances
// analogue.
function parseDistancesRows(
  dataRows: string[][],
  currentDistanceOverrides: DistanceOverride[],
  warehouseIdSpace: Set<string>,
  customerIdSpace: Set<string>,
): { errors: ImportError[]; changes: ImportRowChange[] } {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const currentByPairKey = new Map<string, number>(currentDistanceOverrides.map(o => [`${o.fromId}|${o.toId}`, o.distance]));
  const seenPairs = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== DISTANCES_COLUMNS.length) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${DISTANCES_COLUMNS.length} columns, got ${cols.length}` });
      continue;
    }

    const [tvStr, fromId, toId, distanceStr] = cols;

    if (Number(tvStr) !== TEMPLATE_VERSION) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${TEMPLATE_VERSION}` });
      continue;
    }

    // Direction matters (B1.3's fix, applied at solve time): from_id must
    // resolve as a warehouse, to_id must resolve as a customer — never
    // "whichever role happens to contain it". A backwards row (fromId is a
    // real customer id, toId is a real warehouse id) is caught here as a
    // plain unknown-from_id error, since customer/warehouse id namespaces
    // don't overlap in this dataset.
    if (!fromId || !warehouseIdSpace.has(fromId)) {
      errors.push({ errorClass: "logic", line, message: `Unknown from_id "${fromId}" — must reference a warehouse (base dataset or this scenario's added warehouses)` });
      continue;
    }
    if (!toId || !customerIdSpace.has(toId)) {
      errors.push({ errorClass: "logic", line, message: `Unknown to_id "${toId}" — must reference a customer (base dataset or this scenario's added customers)` });
      continue;
    }

    const pairKey = `${fromId}|${toId}`;
    if (seenPairs.has(pairKey)) {
      errors.push({ errorClass: "logic", line, message: `Duplicate (from_id,to_id) pair "${pairKey}"` });
      continue;
    }
    seenPairs.add(pairKey);

    const parsedDistance = Number(distanceStr);
    if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) {
      errors.push({ errorClass: "logic", line, message: `distance must be a positive number, got "${distanceStr}"` });
      continue;
    }

    // Unlike every other entity, distances has no meaningful "baseline of
    // existing rows" to diff against by default — a scenario's
    // distanceOverrides normally starts empty, so "before" is null (no
    // override yet) rather than looked up from a full base-dataset row.
    const beforeValue = currentByPairKey.get(pairKey) ?? null;
    if (beforeValue !== parsedDistance) {
      changes.push({
        id: pairKey,
        line,
        // No status concept for distances (no active/inactive) — "active"
        // is a constant placeholder so the shared before/after shape (used
        // by every other entity) doesn't need to fork for this one family.
        before: { status: "active", value: beforeValue },
        after: { status: "active", value: parsedDistance },
        fromId,
        toId,
      });
    }
  }

  return { errors, changes };
}

// Task 30 (B6.1 stage 4) — composite-key (from_id,to_id) parsing branch for
// the laneCosts entity, the exact same structure as parseDistancesRows
// above, field name aside (`cost` instead of `distance`). Direction matters
// the same way: from_id must resolve as a mine, to_id must resolve as a
// station — mirrors merge_inputs.py's build_merged_transport_dataset (a
// backwards pair is rejected even if the id is valid in the other role).
function parseLaneCostRows(
  dataRows: string[][],
  currentLaneCostOverrides: LaneCostOverride[],
  mineIdSpace: Set<string>,
  stationIdSpace: Set<string>,
): { errors: ImportError[]; changes: ImportRowChange[] } {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const currentByPairKey = new Map<string, number>(currentLaneCostOverrides.map(o => [`${o.fromId}|${o.toId}`, o.cost]));
  const seenPairs = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== LANE_COST_COLUMNS.length) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${LANE_COST_COLUMNS.length} columns, got ${cols.length}` });
      continue;
    }

    const [tvStr, fromId, toId, costStr] = cols;

    if (Number(tvStr) !== TEMPLATE_VERSION) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${TEMPLATE_VERSION}` });
      continue;
    }

    if (!fromId || !mineIdSpace.has(fromId)) {
      errors.push({ errorClass: "logic", line, message: `Unknown from_id "${fromId}" — must reference a mine (base dataset or this scenario's added mines)` });
      continue;
    }
    if (!toId || !stationIdSpace.has(toId)) {
      errors.push({ errorClass: "logic", line, message: `Unknown to_id "${toId}" — must reference a station (base dataset or this scenario's added stations)` });
      continue;
    }

    const pairKey = `${fromId}|${toId}`;
    if (seenPairs.has(pairKey)) {
      errors.push({ errorClass: "logic", line, message: `Duplicate (from_id,to_id) pair "${pairKey}"` });
      continue;
    }
    seenPairs.add(pairKey);

    const parsedCost = Number(costStr);
    if (!Number.isFinite(parsedCost) || parsedCost <= 0) {
      errors.push({ errorClass: "logic", line, message: `cost must be a positive number, got "${costStr}"` });
      continue;
    }

    const beforeValue = currentByPairKey.get(pairKey) ?? null;
    if (beforeValue !== parsedCost) {
      changes.push({
        id: pairKey,
        line,
        before: { status: "active", value: beforeValue },
        after: { status: "active", value: parsedCost },
        fromId,
        toId,
      });
    }
  }

  return { errors, changes };
}
