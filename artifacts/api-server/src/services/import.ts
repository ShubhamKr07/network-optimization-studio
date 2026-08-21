import Papa from "papaparse";
import { TEMPLATE_VERSION, applyWarehouseOverrides, applyCustomerOverrides, applyGoldCustomerOverrides, applyMineOverrides, applyStationOverrides, applyRefineryOverrides } from "./templates.js";
import { TOTAL_DEMAND } from "../data/dataset.js";
import { buildPMedianIdSpaces } from "./precheck.js";

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
}

export interface ImportPreview {
  errors: ImportError[];
  changes: ImportRowChange[];
  warnings: string[];
}

export type ImportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries" | "distances";

// `distances` is intentionally absent from COLUMNS/ENTITY_HAS_VALUE/
// VALID_STATUSES below — it doesn't fit the single-id row model those
// tables describe (composite key, no status column, no baseline "current
// override list" to diff unknown-ness against). Its column layout is
// DISTANCES_COLUMNS just below, and it's parsed by a wholly separate
// function (parseDistancesRows), not this file's generic per-row loop.
const DISTANCES_COLUMNS = ["template_version", "from_id", "to_id", "distance"];

const COLUMNS: Record<Exclude<ImportEntity, "distances">, string[]> = {
  warehouses: ["template_version", "id", "city", "state", "capacity", "status"],
  customers: ["template_version", "id", "city", "state", "demand", "status"],
  mines: ["template_version", "id", "city", "state", "capacity"],
  stations: ["template_version", "id", "city", "state", "demand"],
  // Refineries have status but no value column at all (two-echelon-gold-au
  // has no per-refinery capacity concept) — the only entity with a status
  // column and no value column.
  refineries: ["template_version", "id", "city", "state", "status"],
};

// Whether this entity's rows carry a capacity/demand value column at all.
// Refineries is the one entity with none. distances isn't here at all — it
// has a `distance` column but no capacity/demand-style value semantics (see
// this file's header comment): it's parsed by parseDistancesRows, never by
// the generic per-row loop below that consults this table.
const ENTITY_HAS_VALUE: Record<Exclude<ImportEntity, "distances">, boolean> = {
  warehouses: true,
  customers: true,
  mines: true,
  stations: true,
  refineries: false,
};

const VALID_STATUSES: Record<Exclude<ImportEntity, "distances">, string[]> = {
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
  const expectedColumns = entity === "distances" ? DISTANCES_COLUMNS : COLUMNS[entity];
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

  // Mines/stations store overrides as sparse dicts (mineCapacities/
  // stationDemands); convert to the array shape the apply* functions take,
  // same direction Studio's tables do internally.
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
  // Value column (when present) is always index 4; status (when present)
  // follows it at 5, or sits at 4 itself if there's no value column
  // (refineries).
  const statusColIdx = entityHasValue ? 5 : 4;

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
    const valueStr = entityHasValue ? cols[4] : "";
    const status = entityHasStatus ? cols[statusColIdx] : "active";

    if (Number(tvStr) !== TEMPLATE_VERSION) {
      errors.push({ errorClass: "logic", line, message: `template_version "${tvStr}" does not match expected ${TEMPLATE_VERSION}` });
      continue;
    }

    const baselineRow = id ? baselineById.get(id) : undefined;
    if (!id || !baselineRow) {
      errors.push({ errorClass: "logic", line, message: `Unknown id "${id}"` });
      continue;
    }

    if (seenIds.has(id)) {
      errors.push({ errorClass: "logic", line, message: `Duplicate id "${id}"` });
      continue;
    }
    seenIds.add(id);

    let value: number | null = null;
    if (entityHasValue && valueStr !== "") {
      const parsedValue = Number(valueStr);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        errors.push({ errorClass: "logic", line, message: `${valueLabel} must be a non-negative number, got "${valueStr}"` });
        continue;
      }
      value = parsedValue;
    }

    if (entityHasStatus && !validStatuses.includes(status)) {
      errors.push({ errorClass: "logic", line, message: `Invalid status "${status}" (expected one of ${validStatuses.join(", ")})` });
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
    const merged = warehouseBaseline.map(row => {
      const change = changeByIdMap.get(row.id);
      return change ? { ...row, status: change.after.status as typeof row.status, capacity: change.after.value } : row;
    });
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
