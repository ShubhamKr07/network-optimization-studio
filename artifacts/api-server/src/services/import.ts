import Papa from "papaparse";
import { TEMPLATE_VERSION, applyWarehouseOverrides, applyCustomerOverrides, applyMineOverrides, applyStationOverrides } from "./templates.js";
import { TOTAL_DEMAND } from "../data/dataset.js";

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
}

export interface ImportPreview {
  errors: ImportError[];
  changes: ImportRowChange[];
  warnings: string[];
}

export type ImportEntity = "warehouses" | "customers" | "mines" | "stations";

const COLUMNS: Record<ImportEntity, string[]> = {
  warehouses: ["template_version", "id", "city", "state", "capacity", "status"],
  customers: ["template_version", "id", "city", "state", "demand", "status"],
  mines: ["template_version", "id", "city", "state", "capacity"],
  stations: ["template_version", "id", "city", "state", "demand"],
};

const VALID_STATUSES: Record<ImportEntity, string[]> = {
  warehouses: ["active", "forced_open", "inactive"],
  customers: ["active", "excluded"],
  // Mines/stations have no status column (no open/close concept) — never
  // consulted because the per-row status validation is gated on entityHasStatus.
  mines: [],
  stations: [],
};

interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }
interface CustomerOverride { id: string; demand?: number | null; status: "active" | "excluded"; }
interface MineOverride { id: string; capacity?: number | null; }
interface StationOverride { id: string; demand?: number | null; }

export interface ImportCurrentOverrides {
  warehouseOverrides?: WarehouseOverride[];
  customerOverrides?: CustomerOverride[];
  mineCapacities?: Record<string, number>;
  stationDemands?: Record<string, number>;
}

export function parseAndValidateImport(
  entity: ImportEntity,
  csvText: string,
  currentOverrides: ImportCurrentOverrides,
  pValue: number,
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
  const expectedColumns = COLUMNS[entity];
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

  // Mines/stations store overrides as sparse dicts (mineCapacities/
  // stationDemands); convert to the array shape the apply* functions take,
  // same direction Studio's tables do internally.
  const baseline =
    entity === "warehouses" ? applyWarehouseOverrides(currentOverrides.warehouseOverrides ?? [])
    : entity === "customers" ? applyCustomerOverrides(currentOverrides.customerOverrides ?? [])
    : entity === "mines" ? applyMineOverrides(Object.entries(currentOverrides.mineCapacities ?? {}).map(([id, capacity]) => ({ id, capacity })))
    : applyStationOverrides(Object.entries(currentOverrides.stationDemands ?? {}).map(([id, demand]) => ({ id, demand })));
  const baselineById = new Map(baseline.map(r => [r.id, r] as const));
  // Mines/stations carry no status column, so status parsing/validation is
  // skipped for them (only warehouses/customers validate status).
  const entityHasStatus = entity === "warehouses" || entity === "customers";
  const validStatuses = VALID_STATUSES[entity];
  const valueLabel = entity === "warehouses" || entity === "mines" ? "capacity" : "demand";

  const seenIds = new Set<string>();
  const dataRows = rows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== expectedColumns.length) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${expectedColumns.length} columns, got ${cols.length}` });
      continue;
    }

    const [tvStr, id, , , valueStr] = cols;
    const status = entityHasStatus ? cols[5] : "active";

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
    if (valueStr !== "") {
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

    const beforeValue = entity === "warehouses" || entity === "mines"
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
