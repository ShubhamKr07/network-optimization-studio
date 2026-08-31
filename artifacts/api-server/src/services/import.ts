import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import { TEMPLATE_VERSION, applyWarehouseOverrides, applyCustomerOverrides, applyGoldCustomerOverrides, applyMineOverrides, applyStationOverrides, applyRefineryOverrides } from "./templates.js";
import { TOTAL_DEMAND } from "../data/dataset.js";
import { buildPMedianIdSpaces, buildTransportIdSpaces, buildTwoEchelonIdSpaces } from "./precheck.js";

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
  // ADD (blank id + valid new-entity data, T11 — writes into
  // scenario.inputs.addedWarehouses/addedCustomers on apply) from the
  // default "update" (writes into warehouseOverrides/customerOverrides, the
  // pre-existing behavior) and T11's "update_added" (an id that matches an
  // already-added entity's stable uid — writes into
  // addedWarehouses/addedCustomers directly, never warehouseOverrides/
  // customerOverrides, since an added entity's own record is authoritative
  // for its fields, not the sparse override arrays — see templates.ts's
  // applyWarehouseOverrides/applyCustomerOverrides). `before` for an ADD row
  // is always `{status: "not_present", value: null}` — there is nothing to
  // diff against, the id didn't exist a moment ago. `city`/`state`/`lat`/
  // `lng` carry the extra structured data an ADD needs that has no home in
  // before/after's shape; kept as flat optional fields (same additive
  // pattern as fromId/toId above) rather than a new sibling type — see the
  // B4.2 report for the full justification.
  changeType?: "update" | "add" | "update_added";
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
  // T11 — the added entity's human-facing label (warehouses/customers
  // only). Populated on ADD rows (from the CSV's own display_code cell,
  // when non-blank) and on update_added rows (from the already-added
  // entity's own stored displayCode) so callers can prefer a readable label
  // over the raw opaque uid in `.id` when surfacing this change to a
  // student — undefined is a legitimate value (displayCode itself is
  // optional; see addedWarehouseSchema/addedCustomerSchema).
  displayCode?: string;
}

export interface ImportPreview {
  errors: ImportError[];
  changes: ImportRowChange[];
  warnings: string[];
}

export type ImportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries" | "distances" | "laneCosts" | "legDistances";

// Entities that fit the generic single-id-row model below — everything
// EXCEPT the three composite-keyed (fromId,toId) entities (distances,
// laneCosts, legDistances), which have their own dedicated parsing
// functions (see this file's header comment on `distances`, Task 30's
// laneCosts addition, and B6.2's legDistances addition below).
type SingleIdEntity = Exclude<ImportEntity, "distances" | "laneCosts" | "legDistances">;

// `distances`/`laneCosts`/`legDistances` are intentionally absent from
// COLUMNS/ENTITY_HAS_VALUE/VALID_STATUSES below — they don't fit the
// single-id row model those tables describe (composite key, no status
// column, no baseline "current override list" to diff unknown-ness
// against). Their column layouts are DISTANCES_COLUMNS/LANE_COST_COLUMNS
// just below, and they're each parsed by a wholly separate function
// (parseDistancesRows/parseLaneCostRows/parseLegDistanceRows), not this
// file's generic per-row loop.
const DISTANCES_COLUMNS = ["template_version", "from_id", "to_id", "distance"];
// Task 30 (B6.1 stage 4) — transport-coal's composite-keyed entity, the
// laneCostOverrides analogue of p-median-us's distanceOverrides. Named
// "cost" (not "distance"), matching stage 1-3's own established vocabulary
// decision for this model (transportLp.ts's laneCostOverrideSchema) even
// though the underlying values are the same kind of quantity.
const LANE_COST_COLUMNS = ["template_version", "from_id", "to_id", "cost"];
// B6.2 stage 4 — two-echelon-gold-au's composite-keyed entity. Same 4-column
// shape as DISTANCES_COLUMNS (this model's own vocabulary is "distance",
// not "cost" — B6.2 stage 1's naming decision) — reuses DISTANCES_COLUMNS
// directly rather than a duplicate constant with the identical header.

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

// T11 — mints a stable opaque uid for a brand-new added warehouse/customer,
// server-side, matching the frontend's own `newUid` (studio/src/lib/
// entityId.ts) prefix convention exactly (`aw-`/`ac-`) so ids minted by
// either side of the app are indistinguishable.
function mintAddedEntityUid(entity: "warehouses" | "customers"): string {
  const prefix = entity === "warehouses" ? "aw" : "ac";
  return `${prefix}-${randomUUID()}`;
}

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
// T11 (Input Map v2) — warehouses/customers gain a `display_code` column
// right after `id`, another breaking format change, following the same
// precedent as B4.2/Task 30 above: T3 switched added-entity `id` to an
// opaque server-minted uid (`aw-<uuid>`/`ac-<uuid>`), so a CSV can no longer
// use the `id` cell as a human-typed label the way it used to — displayCode
// takes over that role (see addedWarehouseSchema/addedCustomerSchema's
// `displayCode` field, pMedian.ts). `id` stays the stable join key: a
// non-blank `id` cell matches an existing base or added entity for UPDATE; a
// blank `id` cell (this task's new ADD trigger, replacing the old
// "unrecognized non-blank id" trigger) mints a fresh uid server-side — see
// `usesUidIdentityModel` below. mines/stations/refineries are unaffected —
// out of this task's scope (no displayCode concept exists for them at all;
// they keep the pre-T11 "unrecognized non-blank id = add" model unchanged).
// This also affects two-echelon-gold-au's "customers" entity, which shares
// this same COLUMNS.customers layout (a base-override-only entity there,
// see ENTITY_HAS_DISPLAY_CODE below) — its display_code cell is simply
// always blank, since twoEchelonInputsSchema has no addedCustomers/
// displayCode concept and its own add-mode stays disabled (`canAdd` below
// is already gated to `modelId === "p-median-us"` for customers).
const COLUMNS: Record<SingleIdEntity, string[]> = {
  warehouses: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "capacity", "status"],
  customers: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "demand", "status"],
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

// T11 — which entities carry the display_code column (see COLUMNS' comment
// above): warehouses/customers only, regardless of modelId (two-echelon's
// "customers" entity shares the column layout even though it never
// populates it — see the comment above). Used both to compute the
// city/state/lat/lng/value/status column offsets below and to select which
// identity model a row uses (`usesUidIdentityModel`).
const ENTITY_HAS_DISPLAY_CODE: Record<SingleIdEntity, boolean> = {
  warehouses: true,
  customers: true,
  mines: false,
  stations: false,
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
// T11 — richer added-entity refs for warehouses/customers, needed to
// support CSV update-of-added-entity matching (diff a row against the
// added entity's own current capacity/status/demand — see
// templates.ts's AddedWarehouse/AddedCustomer, which these mirror) and
// displayCode-based collision checks/messages. Both are structurally
// compatible with precheck.ts's `PrecheckDatasetEntity` ({id: string}), so
// passing them through buildPMedianIdSpaces/buildActivePMedianIds still
// works unchanged.
interface AddedWarehouseRef { id: string; displayCode?: string; capacity?: number | null; status?: "active" | "forced_open" | "inactive"; }
interface AddedCustomerRef { id: string; displayCode?: string; demand?: number; }

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
  // T11 — upgraded from AddedEntityRef ({id: string}) to carry displayCode +
  // current capacity/status/demand, needed for CSV update-of-added matching
  // (see AddedWarehouseRef/AddedCustomerRef's own comment above).
  addedWarehouses?: AddedWarehouseRef[];
  addedCustomers?: AddedCustomerRef[];
  // Task 30 (B6.1 stage 4) — transport-coal's analogues of the above,
  // needed for mines/stations add-mode's id-space/collision check (via
  // buildTransportIdSpaces) and laneCosts' reference-integrity check, same
  // role addedWarehouses/addedCustomers play for the p-median-us pair.
  laneCostOverrides?: LaneCostOverride[];
  addedMines?: AddedEntityRef[];
  addedStations?: AddedEntityRef[];
  // B6.2 stage 4 — two-echelon-gold-au's own added-entity id space, needed
  // for legDistances' reference-integrity check (via precheck.ts's
  // buildTwoEchelonIdSpaces). `distanceOverrides`/`addedCustomers` above are
  // ALREADY reused directly for this model — both share p-median-us's exact
  // field name/shape (a deliberate B6.2 stage 1 naming choice) — only
  // addedRefineries is genuinely new here.
  addedRefineries?: AddedEntityRef[];
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
    // B6.2 stage 4 — legDistances reuses DISTANCES_COLUMNS' identical header
    // (this model's own vocabulary is "distance", not "cost").
    : entity === "legDistances" ? DISTANCES_COLUMNS
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

  // B6.2 stage 4 — legDistances is two-echelon-gold-au's composite-keyed
  // entity, structurally different from distances/laneCosts above: THREE id
  // spaces (mine/refinery/customer), not two — "unknown" means a pair that
  // doesn't cleanly resolve as EITHER a mine->refinery leg OR a refinery->
  // customer leg, the same rule precheckTwoEchelonInputs/merge_inputs.py's
  // build_merged_two_echelon_dataset both enforce.
  if (entity === "legDistances") {
    const { mineIdSpace, refineryIdSpace, customerIdSpace } = buildTwoEchelonIdSpaces(currentOverrides);
    const legDistanceResult = parseLegDistanceRows(rows.slice(1), currentOverrides.distanceOverrides ?? [], mineIdSpace, refineryIdSpace, customerIdSpace);
    return { errors: legDistanceResult.errors, changes: legDistanceResult.changes, warnings: [] };
  }

  // Mines/stations store overrides as sparse dicts (mineCapacities/
  // stationDemands); convert to the array shape the apply* functions take,
  // same direction Studio's tables do internally. Deliberately built from
  // ONLY the base dataset (via the apply* functions' first param), never
  // including addedMines/addedStations — mines/stations keep the pre-T11
  // "a CSV row whose id matches a previously-added mine/station is rejected
  // as a collision" behavior unchanged (see the old-identity-model branch
  // below); only warehouses/customers gain real update-of-added support.
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
  // Column positions, computed from two independent offsets: lat/lng
  // (warehouses/customers/mines/stations) and, as of T11, display_code
  // (warehouses/customers only — see COLUMNS' header comment). city/state
  // always sit right after id(+display_code); lat/lng (when present) follow
  // state; value (when present) follows lat/lng; status (when present)
  // follows value, or takes its slot if there's no value column
  // (refineries).
  const entityHasLatLng = ENTITY_HAS_LATLNG[entity];
  const entityHasDisplayCode = ENTITY_HAS_DISPLAY_CODE[entity];
  const displayCodeOffset = entityHasDisplayCode ? 1 : 0;
  const displayCodeColIdx = 2; // only meaningful when entityHasDisplayCode
  const cityColIdx = 2 + displayCodeOffset;
  const stateColIdx = 3 + displayCodeOffset;
  const latColIdx = 4 + displayCodeOffset; // only meaningful when entityHasLatLng
  const lngColIdx = 5 + displayCodeOffset; // only meaningful when entityHasLatLng
  const latLngOffset = entityHasLatLng ? 2 : 0;
  const valueColIdx = 4 + latLngOffset + displayCodeOffset;
  const statusColIdx = entityHasValue ? 5 + latLngOffset + displayCodeOffset : 4 + latLngOffset + displayCodeOffset;

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
  // T11 — whether this row uses the new uid+displayCode identity model
  // (warehouses/customers: a blank `id` cell means "add a new one", the
  // server mints a fresh opaque uid, and an already-added entity can be
  // matched by uid for a real UPDATE) vs. the pre-T11 model mines/stations
  // keep unchanged (an unrecognized non-blank `id` cell means "add a new
  // one", using the typed string as the literal id — out of this task's
  // scope, mines/stations have no displayCode concept at all).
  const usesUidIdentityModel = entityHasDisplayCode;
  // Base dataset ids ∪ this scenario's already-added entity ids — the same
  // id-space precheck.ts's own reference-integrity check and B4.1's
  // distances parsing use. Only still consulted by the OLD identity model
  // below (mines/stations) — warehouses/customers replaced this "duplicate
  // add" collision check with a displayCode-keyed one (existingDisplayCodes
  // below), since a human can no longer author a colliding uid at all.
  const idSpace = canAdd && !usesUidIdentityModel
    ? (entity === "mines" ? buildTransportIdSpaces(currentOverrides).mineIdSpace
      : buildTransportIdSpaces(currentOverrides).stationIdSpace)
    : new Set<string>();
  // T11 — added-entity lookup by real uid (warehouses/customers only), so a
  // CSV row whose id matches an already-added entity is recognized as an
  // UPDATE instead of the old "unrecognized id, reject as duplicate" model.
  const addedById: Map<string, AddedWarehouseRef | AddedCustomerRef> =
    entity === "warehouses" ? new Map((currentOverrides.addedWarehouses ?? []).map(a => [a.id, a] as const))
    : entity === "customers" ? new Map((currentOverrides.addedCustomers ?? []).map(a => [a.id, a] as const))
    : new Map();
  // T11 — existing added-entity displayCodes, for the ADD-row collision
  // check (displayCode-keyed now, not uid-keyed — mirrors WarehousesTab/
  // CustomersTab's own T9 collision rule exactly: `if (displayCode &&
  // addedWarehouses.some(w => w.displayCode === displayCode))`). A blank
  // displayCode never collides.
  const existingDisplayCodes = new Set(
    [...addedById.values()].map(a => a.displayCode).filter((c): c is string => !!c),
  );
  const seenDisplayCodesInFile = new Set<string>();

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
    const displayCodeCell = entityHasDisplayCode ? (cols[displayCodeColIdx] ?? "").trim() : "";

    if (Number(tvStr) !== TEMPLATE_VERSION) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${TEMPLATE_VERSION}` });
      continue;
    }

    let isAdd = false;
    let isUpdateAdded = false;
    let baselineRow: (typeof baseline)[number] | undefined;
    let addedRow: AddedWarehouseRef | AddedCustomerRef | undefined;

    if (usesUidIdentityModel) {
      // T11 — uid+displayCode identity model (warehouses/customers only).
      const idIsBlank = !id || id.trim() === "";
      if (idIsBlank) {
        if (!canAdd) {
          errors.push({ errorClass: "logic", line, message: `Unknown id "${id}"` });
          continue;
        }
        isAdd = true;
      } else if (baselineById.has(id)) {
        baselineRow = baselineById.get(id);
      } else if (addedById.has(id)) {
        isUpdateAdded = true;
        addedRow = addedById.get(id);
      } else {
        errors.push({
          errorClass: "logic",
          line,
          message: `Unknown id "${id}" — ids are opaque and minted by the server; leave the id column blank to add a new ${ENTITY_SINGULAR_LABEL[entity]}`,
        });
        continue;
      }
    } else {
      // Pre-T11 identity model (mines/stations, refineries, and any entity
      // with no add-mode at all) — unchanged.
      if (!id) {
        errors.push({ errorClass: "logic", line, message: `Unknown id "${id}"` });
        continue;
      }
      baselineRow = baselineById.get(id);
      if (!baselineRow) {
        if (!canAdd) {
          errors.push({ errorClass: "logic", line, message: `Unknown id "${id}"` });
          continue;
        }
        // Recommended-and-implemented collision decision (see B4.2 report):
        // an "add" row whose id already exists as a previously-added entity
        // is rejected outright, not silently downgraded to an update — a
        // silent fallback could surprise a student who believed they were
        // adding something genuinely new.
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
    }

    // In-file duplicate detection, by id. ADD rows under the uid identity
    // model are never duplicates of each other by id (every one gets a
    // fresh minted uid on apply) — their uniqueness is checked by
    // displayCode instead, just below.
    if (!(isAdd && usesUidIdentityModel)) {
      if (seenIds.has(id)) {
        errors.push({ errorClass: "logic", line, message: `Duplicate id "${id}"` });
        continue;
      }
      seenIds.add(id);
    }

    // T11 — displayCode collision check for ADD rows under the uid identity
    // model, replacing the old uid-collision check above (idSpace) — a
    // human can no longer author a colliding uid at all, since uids are
    // always minted server-side now.
    if (isAdd && usesUidIdentityModel && displayCodeCell) {
      if (existingDisplayCodes.has(displayCodeCell) || seenDisplayCodesInFile.has(displayCodeCell)) {
        errors.push({
          errorClass: "logic",
          line,
          message: `Display code "${displayCodeCell}" is already in use by another ${ENTITY_SINGULAR_LABEL[entity]} in this scenario`,
        });
        continue;
      }
      seenDisplayCodesInFile.add(displayCodeCell);
    }

    // ADD rows need real coordinates — an existing base-dataset or
    // already-added entity's coordinates are already fixed, so lat/lng may
    // be blank/ignored on UPDATE (and update_added) rows (this task's
    // binding column-format decision), but a row claiming a brand-new
    // entity has nothing to fall back to. Checked before value/status so a
    // row that's simultaneously missing coordinates AND has some other
    // issue reports the coordinates problem first (the more fundamental one
    // for an add).
    let lat = 0;
    let lng = 0;
    if (isAdd) {
      const latStr = cols[latColIdx];
      const lngStr = cols[lngColIdx];
      const parsedLat = Number(latStr);
      const parsedLng = Number(lngStr);
      if (latStr.trim() === "" || lngStr.trim() === "" || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        errors.push({
          errorClass: "logic",
          line,
          message: `lat/lng are required to add a new ${ENTITY_SINGULAR_LABEL[entity]}${displayCodeCell ? ` ("${displayCodeCell}")` : ""}`,
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
    // UPDATE row. A brand-new (or already-added) customer can't have no
    // demand at all.
    // Task 30 (B6.1 stage 4) — addedStationSchema has the identical
    // requirement (transportLp.ts: `demand: z.number().nonnegative()`, no
    // `.optional()`), so stations joins this check. addedMineSchema's
    // capacity stays nullable/optional — a blank capacity on an added mine
    // is a deliberate, valid "unconstrained" state (matches solve.py's
    // get_base_capacity None-means-unconstrained convention), so mines is
    // NOT added here. T11 — isUpdateAdded is only ever true for customers
    // (usesUidIdentityModel is false for stations), kept symmetric with the
    // isAdd check rather than special-cased.
    if ((isAdd || isUpdateAdded) && (entity === "customers" || entity === "stations") && value === null) {
      errors.push({ errorClass: "logic", line, message: `demand is required for a new/added ${ENTITY_SINGULAR_LABEL[entity]}${displayCodeCell ? ` ("${displayCodeCell}")` : ""}` });
      continue;
    }

    if (entityHasStatus && !validStatuses.includes(status)) {
      errors.push({ errorClass: "logic", line, message: `Invalid status "${status}" (expected one of ${validStatuses.join(", ")})` });
      continue;
    }

    // addedCustomerSchema has no status field at all — v1 has no way to add
    // (or update) a customer and mark it excluded in the same breath (see
    // precheck.ts's header comment). Reject rather than silently dropping
    // the student's explicit "excluded" choice.
    if ((isAdd || isUpdateAdded) && entity === "customers" && status !== "active") {
      errors.push({
        errorClass: "logic",
        line,
        message: `added customers must have status "active" (add-and-exclude is not supported)`,
      });
      continue;
    }

    if (isAdd) {
      const city = cols[cityColIdx];
      const state = cols[stateColIdx];
      if (!city.trim() || !state.trim()) {
        errors.push({
          errorClass: "logic",
          line,
          message: `city and state are required to add a new ${ENTITY_SINGULAR_LABEL[entity]}${displayCodeCell ? ` ("${displayCodeCell}")` : ""}`,
        });
        continue;
      }
      changes.push({
        // T11 — under the uid identity model the CSV's own `id` cell is
        // always blank (that's the ADD trigger); mint the real stable id
        // here rather than deferring to the apply route, so the preview
        // already reflects the id that will actually be persisted.
        id: usesUidIdentityModel ? mintAddedEntityUid(entity as "warehouses" | "customers") : id,
        line,
        before: { status: "not_present", value: null },
        after: { status, value },
        changeType: "add",
        city,
        state,
        lat,
        lng,
        ...(usesUidIdentityModel ? { displayCode: displayCodeCell || undefined } : {}),
      });
      continue;
    }

    if (isUpdateAdded) {
      // T11 — an update to an already-added entity writes into
      // addedWarehouses/addedCustomers directly on apply (see
      // routes/scenarios.ts's mergeUpdateAddedChanges), never
      // warehouseOverrides/customerOverrides — the added entity's own
      // record is authoritative for its fields (templates.ts's
      // applyWarehouseOverrides/applyCustomerOverrides never resolve an
      // added entity's data through the override arrays). Deliberately
      // scoped to value/status only, mirroring plain UPDATE rows below,
      // which likewise never touch city/state/lat/lng — moving an added
      // entity's coordinates stays the map's Move dialog's job (T7),
      // including its "clear this entity's own distanceOverrides for
      // re-estimation" side effect, which a CSV row has no way to trigger
      // correctly.
      const beforeValue = entity === "warehouses"
        ? ((addedRow as AddedWarehouseRef).capacity ?? null)
        : ((addedRow as AddedCustomerRef).demand ?? null);
      const beforeStatus = entity === "warehouses" ? ((addedRow as AddedWarehouseRef).status ?? "active") : "active";

      if (beforeStatus !== status || beforeValue !== value) {
        changes.push({
          id,
          line,
          before: { status: beforeStatus, value: beforeValue },
          after: { status, value },
          changeType: "update_added",
          displayCode: addedRow?.displayCode,
        });
      }
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

// B6.2 stage 4 — composite-key (from_id,to_id) parsing branch for the
// legDistances entity, structurally different from parseDistancesRows/
// parseLaneCostRows above: THREE id spaces (mine/refinery/customer), not
// two. A pair must resolve as EITHER a mine->refinery leg OR a refinery->
// customer leg — direction/leg is resolved purely by which id-space each
// side belongs to (mirrors merge_inputs.py's build_merged_two_echelon_
// dataset exactly, never a string-prefix convention). `dataRows` excludes
// the header row (already consumed/validated by the caller).
function parseLegDistanceRows(
  dataRows: string[][],
  currentDistanceOverrides: { fromId: string; toId: string; distance: number }[],
  mineIdSpace: Set<string>,
  refineryIdSpace: Set<string>,
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

    const isMineToRefinery = !!fromId && mineIdSpace.has(fromId) && !!toId && refineryIdSpace.has(toId);
    const isRefineryToCustomer = !!fromId && refineryIdSpace.has(fromId) && !!toId && customerIdSpace.has(toId);
    if (!isMineToRefinery && !isRefineryToCustomer) {
      errors.push({
        errorClass: "logic",
        line,
        message: `Pair (from_id "${fromId}", to_id "${toId}") does not resolve as a mine->refinery leg or a refinery->customer leg (base dataset or this scenario's added refineries/customers)`,
      });
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

    const beforeValue = currentByPairKey.get(pairKey) ?? null;
    if (beforeValue !== parsedDistance) {
      changes.push({
        id: pairKey,
        line,
        before: { status: "active", value: beforeValue },
        after: { status: "active", value: parsedDistance },
        fromId,
        toId,
      });
    }
  }

  return { errors, changes };
}
