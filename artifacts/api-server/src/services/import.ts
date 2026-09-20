import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import { TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION, applyWarehouseOverrides, applyCustomerOverrides, applyGoldCustomerOverrides, applyBrazilWarehouseOverrides, applyBrazilCustomerOverrides, applyMineOverrides, applyStationOverrides, applyRefineryOverrides, applyJadeWarehouseOverrides, applyJadeCustomerOverrides, applyPlantOverrides, applyChensWarehouseOverrides, applyChensCustomerOverrides } from "./templates.js";
import { TOTAL_DEMAND } from "../data/dataset.js";
import { BRAZIL_TOTAL_DEMAND } from "../data/brazilDataset.js";
import { JADE_PRODUCTS, JADE_PLANT_PRODUCT_CAPABILITIES } from "../data/jadeDataset.js";
import { buildPMedianIdSpaces, buildTransportIdSpaces, buildTwoEchelonIdSpaces, buildJadeIdSpaces, BRAZIL_DATASET, CHENS_DATASET } from "./precheck.js";
// T8 (Chen-bands-units bundle, Part E) — `fromDisplay` converts an imported
// v2 file's value (in whatever unit the file declares) to the model's
// canonical unit; `getManifest` (already used the same way by precheck.ts —
// no new import pattern here) is how this file learns each model's
// canonical unit without a hardcoded per-model table.
import { fromDisplay } from "@workspace/units";
import type { CanonicalUnit } from "@workspace/units";
import { getManifest } from "../registry/modelRegistry.js";

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

// jade-T7 — "plants" is a single-id entity (like warehouses/customers/
// mines/stations/refineries); "plantCapabilities" is a genuinely new
// composite-keyed (plantId,productId) MATRIX entity — see this file's
// header comment on `distances` for why composite-keyed entities don't fit
// the generic single-id loop, and PLANT_CAPABILITY_COLUMNS below for its own
// dedicated parsing function (parsePlantCapabilityRows).
export type ImportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries" | "plants" | "distances" | "laneCosts" | "legDistances" | "plantCapabilities";

// Entities that fit the generic single-id-row model below — everything
// EXCEPT the composite-keyed entities (distances, laneCosts, legDistances,
// plantCapabilities), which have their own dedicated parsing functions (see
// this file's header comment on `distances`, Task 30's laneCosts addition,
// B6.2's legDistances addition below, and jade-T7's plantCapabilities
// addition).
type SingleIdEntity = Exclude<ImportEntity, "distances" | "laneCosts" | "legDistances" | "plantCapabilities">;

// `distances`/`laneCosts`/`legDistances`/`plantCapabilities` are
// intentionally absent from COLUMNS/ENTITY_HAS_VALUE/VALID_STATUSES below —
// they don't fit the single-id row model those tables describe (composite
// key, no status column, no baseline "current override list" to diff
// unknown-ness against). Their column layouts are
// DISTANCES_COLUMNS/LANE_COST_COLUMNS/PLANT_CAPABILITY_COLUMNS just below,
// and they're each parsed by a wholly separate function
// (parseDistancesRows/parseLaneCostRows/parseLegDistanceRows/
// parsePlantCapabilityRows), not this file's generic per-row loop.
const DISTANCES_COLUMNS = ["template_version", "from_id", "to_id", "distance"];
// T8 — v2 header for the same entity: gains a `unit` column right after
// `template_version` (Part E, locked column order). A file matching this
// header is interpreted as v2 (unit-labeled); a file matching
// DISTANCES_COLUMNS above is interpreted as v1 (unitless, canonical) —
// both are accepted, never one superseding the other (backward compat).
const DISTANCES_COLUMNS_V2 = ["template_version", "unit", "from_id", "to_id", "distance"];
// The only two units this app knows about (`@workspace/units`'s
// `CanonicalUnit`). A v2 file's `unit` column must be one of these, on
// every row, uniformly — see checkUniformUnitAndVersion below.
const KNOWN_UNITS = new Set<string>(["km", "mi"]);
// Task 30 (B6.1 stage 4) — transport-coal's composite-keyed entity, the
// laneCostOverrides analogue of p-median-us's distanceOverrides. Named
// "cost" (not "distance"), matching stage 1-3's own established vocabulary
// decision for this model (transportLp.ts's laneCostOverrideSchema) even
// though the underlying values are the same kind of quantity.
const LANE_COST_COLUMNS = ["template_version", "from_id", "to_id", "cost"];
// T8 — v2 header for laneCosts, same shape/reasoning as DISTANCES_COLUMNS_V2
// above (keeps the "cost" value-column name, per-entity vocabulary).
const LANE_COST_COLUMNS_V2 = ["template_version", "unit", "from_id", "to_id", "cost"];
// B6.2 stage 4 — two-echelon-gold-au's composite-keyed entity. Same 4-column
// shape as DISTANCES_COLUMNS (this model's own vocabulary is "distance",
// not "cost" — B6.2 stage 1's naming decision) — reuses DISTANCES_COLUMNS
// directly rather than a duplicate constant with the identical header.
// jade-T7 — two-echelon-jade-us ALSO reuses the "legDistances" entity
// string + DISTANCES_COLUMNS header (parseAndValidateImport's dispatch below
// picks which id-space triple to resolve against based on `modelId`, the
// same disambiguation "customers" already needs).

// jade-T7 — plantCapabilities' own 4-column shape: a plant x product
// "can-make" toggle (`enabled`, a boolean, not a numeric distance/cost).
const PLANT_CAPABILITY_COLUMNS = ["template_version", "plant_id", "product_id", "enabled"];

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
  plants: "plant",
};

// T11 — mints a stable opaque uid for a brand-new added warehouse/customer/
// refinery/mine/station, server-side, matching the frontend's own `newUid`
// (studio/src/lib/entityId.ts) prefix convention exactly (`aw-`/`ac-`/
// `am-`/`as-`) so ids minted by either side of the app are indistinguishable.
// Refineries reuse the "aw-" prefix, not a separate one: `WarehousesTab.tsx`
// is reused as-is for entity="refineries" (B6.2) and calls `newUid("wh")`
// unconditionally — there is no distinct refinery uid kind on the frontend
// to mirror. Mines/stations (Step A) DO get their own distinct kinds —
// `MinesTab.tsx`/`StationsTab.tsx` were migrated to `newUid("mn"/"st")` as
// part of this same pass, unlike refineries' pre-existing reuse. jade-T7 —
// plants joins with its own "ap-" prefix (this model's own added-plant
// entity, no frontend precedent to mirror yet — T11-equivalent frontend
// wiring for JADE is a later task).
function mintAddedEntityUid(entity: "warehouses" | "customers" | "refineries" | "mines" | "stations" | "plants"): string {
  const prefix = entity === "customers" ? "ac" : entity === "mines" ? "am" : entity === "stations" ? "as" : entity === "plants" ? "ap" : "aw";
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
// T11 (Input Map v2) — every entity below now gains a `display_code`
// column right after `id`, another breaking format change, following the
// same precedent as B4.2/Task 30 above: T3 switched added-entity `id` to
// an opaque server-minted uid (`aw-<uuid>`/`ac-<uuid>`/`am-<uuid>`/
// `as-<uuid>`), so a CSV can no longer use the `id` cell as a human-typed
// label the way it used to — displayCode takes over that role (see
// addedWarehouseSchema/addedCustomerSchema in pMedian.ts,
// addedRefinerySchema/addedCustomerSchema in twoEchelon.ts, and
// addedMineSchema/addedStationSchema in transportLp.ts). `id` stays the
// stable join key: a non-blank `id` cell matches an existing base or added
// entity for UPDATE; a blank `id` cell (this task's ADD trigger, replacing
// the old "unrecognized non-blank id" trigger) mints a fresh uid
// server-side — see `usesUidIdentityModel` below. Refineries gained lat/lng
// too (they had none at all before — add-mode never existed for them until
// T11's two-echelon pass). Step A (this pass) — mines/stations join last:
// the frontend (MinesTab.tsx/StationsTab.tsx) was migrated to
// newUid/nextDisplayCode first, so this CSV change now matches what those
// forms already produce, closing the frontend/backend identity-model fork
// that existed while Step A was still pending.
// jade-T7 — plants gains the same 7-column shape as mines (no value column),
// minus even the value column mines has: plants have NEITHER a value NOR a
// status column at all (see templates.ts's applyPlantOverrides header
// comment — the only per-plant lever is plantCapabilities, a separate
// composite-keyed entity, below).
const COLUMNS: Record<SingleIdEntity, string[]> = {
  warehouses: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "capacity", "status"],
  customers: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "demand", "status"],
  mines: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "capacity"],
  stations: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "demand"],
  // Refineries have status but no value column at all (two-echelon-gold-au
  // has no per-refinery capacity concept) — the only entity with a status
  // column and no value column.
  refineries: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "status"],
  plants: ["template_version", "id", "display_code", "city", "state", "lat", "lng"],
};

// Which entities carry lat/lng columns (see COLUMNS' comment above) — used
// to compute the value/status column offsets below, and to know which
// entities may run the add-mode branch at all. Task 30 — mines/stations join
// warehouses/customers here. T11 — refineries joins too (it never had
// add-mode at all before this pass).
const ENTITY_HAS_LATLNG: Record<SingleIdEntity, boolean> = {
  warehouses: true,
  customers: true,
  mines: true,
  stations: true,
  refineries: true,
  plants: true,
};

// T11 — which entities carry the display_code column (see COLUMNS' comment
// above): now every entity in this table. Used both to compute the
// city/state/lat/lng/value/status column offsets below and to select which
// identity model a row uses (`usesUidIdentityModel`) — with every entity
// now `true`, the pre-T11 "unrecognized non-blank id = add" model
// (`usesUidIdentityModel === false`) was confirmed unreachable and removed
// (followup to T11); re-add it if a future entity needs add-mode without a
// displayCode concept.
const ENTITY_HAS_DISPLAY_CODE: Record<SingleIdEntity, boolean> = {
  warehouses: true,
  customers: true,
  mines: true,
  stations: true,
  refineries: true,
  plants: true,
};

// Whether this entity's rows carry a capacity/demand value column at all.
// Refineries is the one entity with none. distances/laneCosts aren't here at
// all — each has its own value-shaped column but no capacity/demand-style
// value semantics (see this file's header comment): they're parsed by their
// own dedicated functions, never by the generic per-row loop below that
// consults this table.
// jade-T7 — plants gets `false` too (no value column at all, see COLUMNS'
// comment above). Note: "customers" stays globally `true` here even though
// JADE's own customerOverrideSchema has no scalar `demand` field — the
// PHYSICAL CSV column layout (COLUMNS.customers) is unchanged for every
// model sharing this entity name, so the column-position math below must
// stay unchanged too; JADE's real distinction (demand edits never persist)
// lives at the routes/scenarios.ts merge layer, not here (see
// applyJadeCustomerOverrides' header comment in templates.ts).
const ENTITY_HAS_VALUE: Record<SingleIdEntity, boolean> = {
  warehouses: true,
  customers: true,
  mines: true,
  stations: true,
  refineries: false,
  plants: false,
};

const VALID_STATUSES: Record<SingleIdEntity, string[]> = {
  warehouses: ["active", "forced_open", "inactive"],
  customers: ["active", "excluded"],
  // Mines/stations/plants have no status column (no open/close concept) —
  // never consulted because the per-row status validation is gated on
  // entityHasStatus.
  mines: [],
  stations: [],
  refineries: ["active", "forced_open", "inactive"],
  plants: [],
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
// T11 — two-echelon-gold-au's added-refinery ref, joining the two above.
// No capacity field (twoEchelon.ts's addedRefinerySchema has none).
interface AddedRefineryRef { id: string; displayCode?: string; status?: "active" | "forced_open" | "inactive"; }
// T11 (Step A) — transport-coal's added-mine/station refs. No status field
// on either (mines/stations have no open/close concept at all, matching
// MineOverride/StationOverride above).
interface AddedMineRef { id: string; displayCode?: string; capacity?: number | null; }
interface AddedStationRef { id: string; displayCode?: string; demand?: number; }
// jade-T7 — two-echelon-jade-us' added-plant ref. No value/status field at
// all (plants have neither concept, see templates.ts's applyPlantOverrides
// header comment).
interface AddedPlantRef { id: string; displayCode?: string; }
// jade-T7 — plantProductCapability's element shape, needed for
// plantCapabilities' baseline diff (parsePlantCapabilityRows).
interface CapabilityOverrideRef { plantId: string; productId: string; enabled: boolean; }

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
  // role addedWarehouses/addedCustomers play for the p-median-us pair. T11
  // (Step A) — upgraded from AddedEntityRef to AddedMineRef/AddedStationRef
  // (displayCode + capacity/demand), same reason addedWarehouses/
  // addedCustomers/addedRefineries were upgraded above.
  laneCostOverrides?: LaneCostOverride[];
  addedMines?: AddedMineRef[];
  addedStations?: AddedStationRef[];
  // B6.2 stage 4 — two-echelon-gold-au's own added-entity id space, needed
  // for legDistances' reference-integrity check (via precheck.ts's
  // buildTwoEchelonIdSpaces). `distanceOverrides`/`addedCustomers` above are
  // ALREADY reused directly for this model — both share p-median-us's exact
  // field name/shape (a deliberate B6.2 stage 1 naming choice) — only
  // addedRefineries is genuinely new here. T11 — upgraded from
  // AddedEntityRef to AddedRefineryRef (displayCode + status), same reason
  // addedWarehouses/addedCustomers were upgraded above.
  addedRefineries?: AddedRefineryRef[];
  // jade-T7 — two-echelon-jade-us' own added-entity id space, needed for
  // legDistances' reference-integrity check (via precheck.ts's
  // buildJadeIdSpaces) and plantCapabilities' plant-id-space check.
  // `distanceOverrides`/`addedWarehouses`/`addedCustomers` above are ALREADY
  // reused directly for this model (a deliberate jade-T5 naming choice
  // mirroring B6.2's own) — only addedPlants/plantProductCapability are
  // genuinely new here.
  addedPlants?: AddedPlantRef[];
  plantProductCapability?: CapabilityOverrideRef[];
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
  const header = rows[0]?.map(h => h.trim()) ?? [];

  // T8 (Part E) — distances/laneCosts/legDistances now accept EITHER the v1
  // (unitless, canonical-implied) header or the v2 (unit-labeled) header —
  // v1 is never rejected/superseded, only v2 is newly recognized alongside
  // it. `hasUnitColumn` selects which shape the composite-key parse*
  // functions below treat this file as. Every other entity keeps the
  // single-shape check unchanged.
  const isDistanceLikeEntity = entity === "distances" || entity === "laneCosts" || entity === "legDistances";
  let hasUnitColumn = false;
  if (isDistanceLikeEntity) {
    // B6.2 stage 4 / jade-T7 — legDistances reuses distances'/laneCosts'
    // identical v1+v2 headers (see DISTANCES_COLUMNS's own header comment);
    // laneCosts alone uses the `cost`-named columns.
    const v1Columns = entity === "laneCosts" ? LANE_COST_COLUMNS : DISTANCES_COLUMNS;
    const v2Columns = entity === "laneCosts" ? LANE_COST_COLUMNS_V2 : DISTANCES_COLUMNS_V2;
    const matchesV1 = header.length === v1Columns.length && v1Columns.every((c, i) => header[i] === c);
    const matchesV2 = header.length === v2Columns.length && v2Columns.every((c, i) => header[i] === c);
    if (!matchesV1 && !matchesV2) {
      errors.push({
        errorClass: "format",
        line: 1,
        message: `Expected columns "${v1Columns.join(",")}" or "${v2Columns.join(",")}", got "${header.join(",")}". Rows must be keyed by id, not city — city names are not unique.`,
      });
      return { errors, changes, warnings };
    }
    hasUnitColumn = matchesV2;
  } else {
    const expectedColumns =
      // jade-T7 — plantCapabilities' own 4-column shape (plant_id/
      // product_id/enabled, not from_id/to_id/distance).
      entity === "plantCapabilities" ? PLANT_CAPABILITY_COLUMNS
      // `isDistanceLikeEntity` (a plain boolean, not a type guard) already
      // excluded distances/laneCosts/legDistances above, so `entity` here is
      // really a SingleIdEntity — TS just can't see that through the
      // boolean flag the way the original single-ternary-chain narrowing
      // could.
      : COLUMNS[entity as SingleIdEntity];
    const headerMatches = header.length === expectedColumns.length && expectedColumns.every((c, i) => header[i] === c);
    if (!headerMatches) {
      errors.push({
        errorClass: "format",
        line: 1,
        message: `Expected columns "${expectedColumns.join(",")}", got "${header.join(",")}". Rows must be keyed by id, not city — city names are not unique.`,
      });
      return { errors, changes, warnings };
    }
  }

  // T8 — this scenario's model's canonical distance unit (Part E: "storage
  // is always canonical"). Looked up from the model registry (the same
  // source `routes/scenarios.ts`'s export handler already reads
  // `manifest.distanceUnit` from — precheck.ts's CHENS_DATASET already
  // imports `getManifest` the same way) rather than a hardcoded per-model
  // table, so a future model's manifest is the single source of truth.
  // Defaults to "mi" matching every existing caller's implicit assumption
  // (and modelRegistry's own `?? "mi"` default at the public boundary).
  const canonicalUnit: CanonicalUnit = (getManifest(modelId)?.distanceUnit as CanonicalUnit | undefined) ?? "mi";

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
    // T9 — p-median-brazil shares p-median-us's distances entity/shape but
    // resolves reference integrity against its own warehouse/region id
    // space, not p-median-us's (buildPMedianIdSpaces' own dataset param).
    // C4.4 — chens-cosmetics-cn shares p-median-us's distances entity/shape
    // (a flat DistanceMap of warehouse->customer pairs) but resolves reference
    // integrity against its OWN 25-warehouse/197-customer id space, not
    // p-median-us's, same disambiguation p-median-brazil already needs.
    const distancesDataset = modelId === "p-median-brazil" ? BRAZIL_DATASET : modelId === "chens-cosmetics-cn" ? CHENS_DATASET : undefined;
    const { warehouseIdSpace, customerIdSpace } = buildPMedianIdSpaces(currentOverrides, distancesDataset);
    const distanceResult = parseDistancesRows(rows.slice(1), currentOverrides.distanceOverrides ?? [], warehouseIdSpace, customerIdSpace, hasUnitColumn, canonicalUnit);
    return { errors: distanceResult.errors, changes: distanceResult.changes, warnings: [] };
  }

  // Task 30 (B6.1 stage 4) — laneCosts is transport-coal's composite-keyed
  // entity, the exact same shape/reasoning as distances above (see its
  // header comment) — "unknown" here means reference-integrity against
  // buildTransportIdSpaces (base mines/stations + this scenario's added
  // ones), the same rule precheckTransportInputs enforces at solve time.
  if (entity === "laneCosts") {
    const { mineIdSpace, stationIdSpace } = buildTransportIdSpaces(currentOverrides);
    const laneCostResult = parseLaneCostRows(rows.slice(1), currentOverrides.laneCostOverrides ?? [], mineIdSpace, stationIdSpace, hasUnitColumn, canonicalUnit);
    return { errors: laneCostResult.errors, changes: laneCostResult.changes, warnings: [] };
  }

  // B6.2 stage 4 — legDistances is two-echelon-gold-au's composite-keyed
  // entity, structurally different from distances/laneCosts above: THREE id
  // spaces (mine/refinery/customer), not two — "unknown" means a pair that
  // doesn't cleanly resolve as EITHER a mine->refinery leg OR a refinery->
  // customer leg, the same rule precheckTwoEchelonInputs/merge_inputs.py's
  // build_merged_two_echelon_dataset both enforce.
  if (entity === "legDistances") {
    // jade-T7 — two-echelon-jade-us ALSO uses the "legDistances" entity
    // string (see this file's header comment on DISTANCES_COLUMNS), but
    // resolves against its own THREE id spaces (plant/warehouse/customer,
    // the warehouse sitting in the middle of both legs) instead of two-
    // echelon-gold-au's (mine/refinery/customer). parseLegDistanceRows
    // doesn't care about role NAMES, only which of the three spaces each
    // side belongs to — plant->warehouse is structurally identical to
    // mine->refinery, warehouse->customer to refinery->customer, so the
    // exact same function is reused unchanged.
    if (modelId === "two-echelon-jade-us") {
      const { plantIdSpace, warehouseIdSpace, customerIdSpace } = buildJadeIdSpaces(currentOverrides);
      const jadeLegDistanceResult = parseLegDistanceRows(rows.slice(1), currentOverrides.distanceOverrides ?? [], plantIdSpace, warehouseIdSpace, customerIdSpace, hasUnitColumn, canonicalUnit);
      return { errors: jadeLegDistanceResult.errors, changes: jadeLegDistanceResult.changes, warnings: [] };
    }
    const { mineIdSpace, refineryIdSpace, customerIdSpace } = buildTwoEchelonIdSpaces(currentOverrides);
    const legDistanceResult = parseLegDistanceRows(rows.slice(1), currentOverrides.distanceOverrides ?? [], mineIdSpace, refineryIdSpace, customerIdSpace, hasUnitColumn, canonicalUnit);
    return { errors: legDistanceResult.errors, changes: legDistanceResult.changes, warnings: [] };
  }

  // jade-T7 — plantCapabilities is a genuinely different shape from every
  // composite-keyed entity above: a FULL MATRIX (every plant x every
  // product), not a sparse "only the overridden pairs" export, and its value
  // is a boolean (`enabled`), not a numeric distance/cost. "Unknown" means a
  // plant_id/product_id that doesn't resolve against this scenario's plant
  // id space (base + added) / the dataset's 4 canonical product ids.
  if (entity === "plantCapabilities") {
    const { plantIdSpace } = buildJadeIdSpaces(currentOverrides);
    const productIdSpace = new Set(JADE_PRODUCTS.map(p => p.id));
    const baseCapacityByPair = new Map(JADE_PLANT_PRODUCT_CAPABILITIES.map(c => [`${c.plantId}|${c.productId}`, c.capacity]));
    const capabilityResult = parsePlantCapabilityRows(rows.slice(1), currentOverrides.plantProductCapability ?? [], plantIdSpace, productIdSpace, baseCapacityByPair);
    return { errors: capabilityResult.errors, changes: capabilityResult.changes, warnings: [] };
  }

  // Mines/stations store overrides as sparse dicts (mineCapacities/
  // stationDemands); convert to the array shape the apply* functions take,
  // same direction Studio's tables do internally. Deliberately built from
  // ONLY the base dataset (via the apply* functions' first param), never
  // including addedMines/addedStations — mines/stations keep the pre-T11
  // "a CSV row whose id matches a previously-added mine/station is rejected
  // as a collision" behavior unchanged (see the old-identity-model branch
  // below); only warehouses/customers gain real update-of-added support.
  // T9 — "warehouses"/"customers" is shared by p-median-us AND
  // p-median-brazil (same schema, different base dataset — B6.3/B2-T1);
  // modelId disambiguates which baseline to validate against, same role
  // modelId already plays for "customers" vs two-echelon-gold-au below.
  // T8 — every distances/laneCosts/legDistances/plantCapabilities branch
  // above already returned, so `entity` here is genuinely a SingleIdEntity;
  // re-derive `expectedColumns` (the header-check block's own copy went out
  // of scope once that check moved into its own `else` branch) for the
  // per-row column-count check further down.
  const expectedColumns = COLUMNS[entity as SingleIdEntity];
  const baseline =
    entity === "warehouses" ? (
        modelId === "p-median-brazil"
          ? applyBrazilWarehouseOverrides(currentOverrides.warehouseOverrides ?? [])
          : modelId === "two-echelon-jade-us"
          ? applyJadeWarehouseOverrides(currentOverrides.warehouseOverrides ?? [])
          : modelId === "chens-cosmetics-cn"
          ? applyChensWarehouseOverrides(currentOverrides.warehouseOverrides ?? [])
          : applyWarehouseOverrides(currentOverrides.warehouseOverrides ?? [])
      )
    : entity === "customers" ? (
        modelId === "two-echelon-gold-au"
          ? applyGoldCustomerOverrides(currentOverrides.customerOverrides ?? [])
          : modelId === "p-median-brazil"
          ? applyBrazilCustomerOverrides(currentOverrides.customerOverrides ?? [])
          : modelId === "two-echelon-jade-us"
          ? applyJadeCustomerOverrides(currentOverrides.customerOverrides ?? [])
          : modelId === "chens-cosmetics-cn"
          ? applyChensCustomerOverrides(currentOverrides.customerOverrides ?? [])
          : applyCustomerOverrides(currentOverrides.customerOverrides ?? [])
      )
    : entity === "mines" ? applyMineOverrides(Object.entries(currentOverrides.mineCapacities ?? {}).map(([id, capacity]) => ({ id, capacity })))
    : entity === "refineries" ? applyRefineryOverrides(currentOverrides.refineryOverrides ?? [])
    // jade-T7 — plants has no "overrides" concept at all (see
    // templates.ts's applyPlantOverrides header comment) — its baseline is
    // just the base dataset, called with no args (mirroring every other
    // baseline call site here, which never passes addedX either — see
    // ENTITY_HAS_DISPLAY_CODE's own comment: added entities are matched via
    // `addedById` below, never through `baseline`).
    : entity === "plants" ? applyPlantOverrides()
    : applyStationOverrides(Object.entries(currentOverrides.stationDemands ?? {}).map(([id, demand]) => ({ id, demand })));
  const baselineById = new Map(baseline.map(r => [r.id, r] as const));
  // Mines/stations/plants carry no status column, so status parsing/
  // validation is skipped for them (only warehouses/customers/refineries
  // validate status).
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

  // B4.2 — add-mode for warehouses/customers/refineries/mines/stations.
  // "customers" is shared with two-echelon-gold-au, which now has its own
  // real `addedCustomers` field (twoEchelon.ts, B6.2+T11) — add-mode is
  // enabled for both models' customers, matching what their schemas
  // actually support. T9 — p-median-brazil joins too (reuses p-median-us's
  // addedCustomerSchema verbatim, B6.3/B2-T1).
  // Task 30 (B6.1 stage 4) — mines/stations join the add-mode set
  // (transportLp.ts's addedMineSchema/addedStationSchema both exist and are
  // transport-coal's only model, so no cross-model ambiguity to guard
  // against the way customers needs).
  // T11 — refineries joins too: `addedRefinerySchema` (twoEchelon.ts) now
  // exists and WarehousesTab.tsx (reused for entity="refineries") already
  // mints uid+displayCode client-side — CSV add-mode brings the backend in
  // line with what the frontend already does.
  // jade-T7 — plants joins the add-mode set (addedPlantSchema, jadeInputs.ts,
  // needs only id/city/state/lat/lng/displayCode — all satisfiable by this
  // generic CSV format). "customers" deliberately does NOT gain
  // two-echelon-jade-us here: jadeInputs.ts's addedCustomerSchema requires a
  // REQUIRED-COMPLETE per-product `demands` map (all 4 canonical product
  // ids), which this single-value-column CSV format has no room to supply —
  // add-mode for JADE customers stays disabled (a blank id row 422s as
  // "Unknown id"), matching this model's own precheck.ts header comment on
  // why per-product demand editing isn't a CSV concern in this pass.
  const canAdd = entity === "warehouses"
    || (entity === "customers" && (modelId === "p-median-us" || modelId === "p-median-brazil" || modelId === "two-echelon-gold-au" || modelId === "chens-cosmetics-cn"))
    || entity === "mines" || entity === "stations" || entity === "refineries" || entity === "plants";
  // T11 — whether this row uses the uid+displayCode identity model (a blank
  // `id` cell means "add a new one", the server mints a fresh opaque uid,
  // and an already-added entity can be matched by uid for a real UPDATE).
  // Step A brought mines/stations onto this model too (their frontend forms
  // — MinesTab.tsx/StationsTab.tsx — were migrated to newUid/
  // nextDisplayCode in the same pass), so every entity in ENTITY_HAS_
  // DISPLAY_CODE is now `true` here — see that table's own comment on the
  // pre-T11 model this replaced.
  const usesUidIdentityModel = entityHasDisplayCode;
  // T11 — added-entity lookup by real uid, so a CSV row whose id matches an
  // already-added entity is recognized as an UPDATE instead of the old
  // "unrecognized id, reject as duplicate" model.
  const addedById: Map<string, AddedWarehouseRef | AddedCustomerRef | AddedRefineryRef | AddedMineRef | AddedStationRef | AddedPlantRef> =
    entity === "warehouses" ? new Map((currentOverrides.addedWarehouses ?? []).map(a => [a.id, a] as const))
    : entity === "customers" ? new Map((currentOverrides.addedCustomers ?? []).map(a => [a.id, a] as const))
    : entity === "refineries" ? new Map((currentOverrides.addedRefineries ?? []).map(a => [a.id, a] as const))
    : entity === "mines" ? new Map((currentOverrides.addedMines ?? []).map(a => [a.id, a] as const))
    : entity === "stations" ? new Map((currentOverrides.addedStations ?? []).map(a => [a.id, a] as const))
    : entity === "plants" ? new Map((currentOverrides.addedPlants ?? []).map(a => [a.id, a] as const))
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
    let addedRow: AddedWarehouseRef | AddedCustomerRef | AddedRefineryRef | AddedMineRef | AddedStationRef | AddedPlantRef | undefined;

    // T11 — uid+displayCode identity model. `usesUidIdentityModel` (=
    // `entityHasDisplayCode`) is `true` for every entity in `SingleIdEntity`
    // (see ENTITY_HAS_DISPLAY_CODE's own comment), so this is the only path
    // reached in practice; the pre-T11 "unrecognized non-blank id = add"
    // model this replaced (and its `idSpace`-collision check) was removed as
    // confirmed-dead code by a followup to T11 — see git history if a future
    // entity genuinely needs add-mode without a displayCode concept.
    if (usesUidIdentityModel) {
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
    // NOT added here. T11 (Step A) — isUpdateAdded can now be true for
    // stations too (usesUidIdentityModel is true for it), so this check
    // correctly guards both isAdd and isUpdateAdded rows.
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
        id: usesUidIdentityModel ? mintAddedEntityUid(entity as "warehouses" | "customers" | "refineries" | "mines" | "stations" | "plants") : id,
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
        : entity === "customers"
        ? ((addedRow as AddedCustomerRef).demand ?? null)
        : entity === "mines"
        ? ((addedRow as AddedMineRef).capacity ?? null)
        : entity === "stations"
        ? ((addedRow as AddedStationRef).demand ?? null)
        : null; // refineries/plants — no value/capacity concept at all
      const beforeStatus = entity === "warehouses"
        ? ((addedRow as AddedWarehouseRef).status ?? "active")
        : entity === "refineries"
        ? ((addedRow as AddedRefineryRef).status ?? "active")
        : "active"; // customers/mines/stations/plants — none of these added-entity schemas has a status field

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
      ? (baselineRow as unknown as { capacity: number | null }).capacity
      : (baselineRow as unknown as { demand: number }).demand;
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
  // T9 — p-median-brazil compares against its own ~114M total region demand
  // (BRAZIL_TOTAL_DEMAND), not p-median-us's 200-customer total.
  if (errors.length === 0 && entity === "warehouses") {
    const totalDemand = modelId === "p-median-brazil" ? BRAZIL_TOTAL_DEMAND : TOTAL_DEMAND;
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
      if (totalCapacityForP < totalDemand) {
        warnings.push(
          `Total capacity of the ${pValue} highest-capacity active warehouses (${totalCapacityForP.toLocaleString()}) ` +
          `is less than total customer demand (${totalDemand.toLocaleString()}).`,
        );
      }
    }
  }

  return { errors, changes, warnings };
}

// T8 (Part E) — a v2 file must carry ONE consistent `unit` + `template_version`
// across every row: "every row (incl. blank stubs) carries the same valid
// unit+version; mixed-version/mixed-unit rows -> format-class rejection."
// This is a whole-file check (a single format error), not a per-row one —
// otherwise a genuinely mixed file would produce N duplicate per-row logic
// errors instead of one clear diagnosis. Shared by all three composite-key
// v2 parsers below. Rows with too few columns are skipped here (the
// caller's own per-row column-count check reports those individually);
// this only scans well-formed rows for unit/version agreement.
function checkUniformUnitAndVersion(
  dataRows: string[][],
  versionColIdx: number,
  unitColIdx: number,
): { error: ImportError | null; unit: CanonicalUnit | null } {
  const units = new Set<string>();
  const versions = new Set<string>();
  for (const cols of dataRows) {
    if (cols.length <= unitColIdx || cols.length <= versionColIdx) continue;
    units.add(cols[unitColIdx].trim());
    versions.add(cols[versionColIdx].trim());
  }
  for (const u of units) {
    if (!KNOWN_UNITS.has(u)) {
      return { error: { errorClass: "format", line: null, message: `Unknown unit "${u}" — expected "km" or "mi".` }, unit: null };
    }
  }
  if (units.size > 1) {
    return { error: { errorClass: "format", line: null, message: `File mixes multiple units (${[...units].sort().join(", ")}) — every row must use the same unit.` }, unit: null };
  }
  if (versions.size > 1) {
    return { error: { errorClass: "format", line: null, message: `File mixes multiple template_version values (${[...versions].sort().join(", ")}) — every row must use the same version.` }, unit: null };
  }
  // Empty dataRows (header-only file) or every row too short to have a unit
  // cell: no disagreement to report, and the per-row loop below won't run
  // anyway (or will independently report each row's own column-count
  // problem) — the caller's `?? canonicalUnit` fallback handles the null.
  const [onlyUnit] = units;
  return { error: null, unit: (onlyUnit as CanonicalUnit | undefined) ?? null };
}

// B4.1 — composite-key (from_id,to_id) parsing branch for the distances
// entity, deliberately separate from the generic single-id loop above (see
// this file's header comment). `dataRows` excludes the header row (already
// consumed/validated by the caller). No cross-field warning: the
// capacity-vs-demand warning above is warehouses-only and has no distances
// analogue.
// T8 — gained `hasUnitColumn`/`canonicalUnit`: when the caller detected a v2
// header, each row's `unit` cell (already validated uniform+known by
// checkUniformUnitAndVersion) converts its value to canonical via
// `fromDisplay`; a v1 file has no unit column at all and its value is
// interpreted as already canonical (Part E's locked import rule),
// unchanged from this function's pre-T8 behavior.
function parseDistancesRows(
  dataRows: string[][],
  currentDistanceOverrides: DistanceOverride[],
  warehouseIdSpace: Set<string>,
  customerIdSpace: Set<string>,
  hasUnitColumn: boolean,
  canonicalUnit: CanonicalUnit,
): { errors: ImportError[]; changes: ImportRowChange[] } {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const currentByPairKey = new Map<string, number>(currentDistanceOverrides.map(o => [`${o.fromId}|${o.toId}`, o.distance]));
  const seenPairs = new Set<string>();
  const expectedColumnCount = hasUnitColumn ? DISTANCES_COLUMNS_V2.length : DISTANCES_COLUMNS.length;
  const expectedVersion = hasUnitColumn ? DISTANCE_TEMPLATE_VERSION : TEMPLATE_VERSION;

  let fileUnit: CanonicalUnit = canonicalUnit;
  if (hasUnitColumn) {
    const uniformity = checkUniformUnitAndVersion(dataRows, 0, 1);
    if (uniformity.error) return { errors: [uniformity.error], changes: [] };
    fileUnit = uniformity.unit ?? canonicalUnit;
  }

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== expectedColumnCount) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${expectedColumnCount} columns, got ${cols.length}` });
      continue;
    }

    const tvStr = cols[0];
    const fromId = hasUnitColumn ? cols[2] : cols[1];
    const toId = hasUnitColumn ? cols[3] : cols[2];
    const distanceStr = hasUnitColumn ? cols[4] : cols[3];

    if (Number(tvStr) !== expectedVersion) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${expectedVersion}` });
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

    const parsedDistanceRaw = Number(distanceStr);
    if (!Number.isFinite(parsedDistanceRaw) || parsedDistanceRaw <= 0) {
      errors.push({ errorClass: "logic", line, message: `distance must be a positive number, got "${distanceStr}"` });
      continue;
    }
    // T8 — v1 has no unit column at all; its value IS the canonical value
    // (Part E's locked rule). v2 converts the file's declared unit to
    // canonical; `fromDisplay` is the identity when they already match.
    const parsedDistance = hasUnitColumn ? fromDisplay(parsedDistanceRaw, fileUnit, canonicalUnit) : parsedDistanceRaw;

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
// T8 — gained `hasUnitColumn`/`canonicalUnit`, same treatment as
// parseDistancesRows above.
function parseLaneCostRows(
  dataRows: string[][],
  currentLaneCostOverrides: LaneCostOverride[],
  mineIdSpace: Set<string>,
  stationIdSpace: Set<string>,
  hasUnitColumn: boolean,
  canonicalUnit: CanonicalUnit,
): { errors: ImportError[]; changes: ImportRowChange[] } {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const currentByPairKey = new Map<string, number>(currentLaneCostOverrides.map(o => [`${o.fromId}|${o.toId}`, o.cost]));
  const seenPairs = new Set<string>();
  const expectedColumnCount = hasUnitColumn ? LANE_COST_COLUMNS_V2.length : LANE_COST_COLUMNS.length;
  const expectedVersion = hasUnitColumn ? DISTANCE_TEMPLATE_VERSION : TEMPLATE_VERSION;

  let fileUnit: CanonicalUnit = canonicalUnit;
  if (hasUnitColumn) {
    const uniformity = checkUniformUnitAndVersion(dataRows, 0, 1);
    if (uniformity.error) return { errors: [uniformity.error], changes: [] };
    fileUnit = uniformity.unit ?? canonicalUnit;
  }

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== expectedColumnCount) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${expectedColumnCount} columns, got ${cols.length}` });
      continue;
    }

    const tvStr = cols[0];
    const fromId = hasUnitColumn ? cols[2] : cols[1];
    const toId = hasUnitColumn ? cols[3] : cols[2];
    const costStr = hasUnitColumn ? cols[4] : cols[3];

    if (Number(tvStr) !== expectedVersion) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${expectedVersion}` });
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

    const parsedCostRaw = Number(costStr);
    if (!Number.isFinite(parsedCostRaw) || parsedCostRaw <= 0) {
      errors.push({ errorClass: "logic", line, message: `cost must be a positive number, got "${costStr}"` });
      continue;
    }
    const parsedCost = hasUnitColumn ? fromDisplay(parsedCostRaw, fileUnit, canonicalUnit) : parsedCostRaw;

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
// T8 — gained `hasUnitColumn`/`canonicalUnit`, same treatment as
// parseDistancesRows above.
function parseLegDistanceRows(
  dataRows: string[][],
  currentDistanceOverrides: { fromId: string; toId: string; distance: number }[],
  mineIdSpace: Set<string>,
  refineryIdSpace: Set<string>,
  customerIdSpace: Set<string>,
  hasUnitColumn: boolean,
  canonicalUnit: CanonicalUnit,
): { errors: ImportError[]; changes: ImportRowChange[] } {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const currentByPairKey = new Map<string, number>(currentDistanceOverrides.map(o => [`${o.fromId}|${o.toId}`, o.distance]));
  const seenPairs = new Set<string>();
  const expectedColumnCount = hasUnitColumn ? DISTANCES_COLUMNS_V2.length : DISTANCES_COLUMNS.length;
  const expectedVersion = hasUnitColumn ? DISTANCE_TEMPLATE_VERSION : TEMPLATE_VERSION;

  let fileUnit: CanonicalUnit = canonicalUnit;
  if (hasUnitColumn) {
    const uniformity = checkUniformUnitAndVersion(dataRows, 0, 1);
    if (uniformity.error) return { errors: [uniformity.error], changes: [] };
    fileUnit = uniformity.unit ?? canonicalUnit;
  }

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== expectedColumnCount) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${expectedColumnCount} columns, got ${cols.length}` });
      continue;
    }

    const tvStr = cols[0];
    const fromId = hasUnitColumn ? cols[2] : cols[1];
    const toId = hasUnitColumn ? cols[3] : cols[2];
    const distanceStr = hasUnitColumn ? cols[4] : cols[3];

    if (Number(tvStr) !== expectedVersion) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${expectedVersion}` });
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

    const parsedDistanceRaw = Number(distanceStr);
    if (!Number.isFinite(parsedDistanceRaw) || parsedDistanceRaw <= 0) {
      errors.push({ errorClass: "logic", line, message: `distance must be a positive number, got "${distanceStr}"` });
      continue;
    }
    const parsedDistance = hasUnitColumn ? fromDisplay(parsedDistanceRaw, fileUnit, canonicalUnit) : parsedDistanceRaw;

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

// jade-T7 — composite-key (plant_id,product_id) parsing branch for the
// plantCapabilities entity, structurally different from every composite-key
// entity above: a full MATRIX (every plant x every product has a baseline
// row — see templates.ts's applyPlantCapabilityOverrides), not a sparse
// "only the overridden pairs" export, and its value is a BOOLEAN (`enabled`),
// not a numeric distance/cost. `fromId`/`toId` on the resulting
// ImportRowChange carry plantId/productId respectively (reusing the same
// composite-key fields distances/laneCosts/legDistances already use — no
// new field needed on ImportRowChange); `value` encodes the boolean as 1/0
// (mirrors the existing `value: number | null` shape rather than widening
// it). `dataRows` excludes the header row (already consumed/validated by
// the caller).
function parsePlantCapabilityRows(
  dataRows: string[][],
  currentCapabilityOverrides: CapabilityOverrideRef[],
  plantIdSpace: Set<string>,
  productIdSpace: Set<string>,
  baseCapacityByPair: Map<string, number>,
): { errors: ImportError[]; changes: ImportRowChange[] } {
  const errors: ImportError[] = [];
  const changes: ImportRowChange[] = [];
  const currentByPairKey = new Map<string, boolean>(
    currentCapabilityOverrides.map(o => [`${o.plantId}|${o.productId}`, o.enabled]),
  );
  const seenPairs = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== PLANT_CAPABILITY_COLUMNS.length) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${PLANT_CAPABILITY_COLUMNS.length} columns, got ${cols.length}` });
      continue;
    }

    const [tvStr, plantId, productId, enabledStr] = cols;

    if (Number(tvStr) !== TEMPLATE_VERSION) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${TEMPLATE_VERSION}` });
      continue;
    }

    if (!plantId || !plantIdSpace.has(plantId)) {
      errors.push({ errorClass: "logic", line, message: `Unknown plant_id "${plantId}" — must reference a plant (base dataset or this scenario's added plants)` });
      continue;
    }
    if (!productId || !productIdSpace.has(productId)) {
      errors.push({ errorClass: "logic", line, message: `Unknown product_id "${productId}"` });
      continue;
    }

    const pairKey = `${plantId}|${productId}`;
    if (seenPairs.has(pairKey)) {
      errors.push({ errorClass: "logic", line, message: `Duplicate (plant_id,product_id) pair "${pairKey}"` });
      continue;
    }
    seenPairs.add(pairKey);

    const normalized = enabledStr.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      errors.push({ errorClass: "logic", line, message: `enabled must be "true" or "false", got "${enabledStr}"` });
      continue;
    }
    const enabled = normalized === "true";

    const overrideValue = currentByPairKey.get(pairKey);
    const baseEnabled = (baseCapacityByPair.get(pairKey) ?? 0) > 0;
    const beforeEnabled = overrideValue !== undefined ? overrideValue : baseEnabled;

    if (beforeEnabled !== enabled) {
      changes.push({
        id: pairKey,
        line,
        before: { status: String(beforeEnabled), value: beforeEnabled ? 1 : 0 },
        after: { status: String(enabled), value: enabled ? 1 : 0 },
        fromId: plantId,
        toId: productId,
      });
    }
  }

  return { errors, changes };
}
