import Papa from "papaparse";
import { TEMPLATE_VERSION, applyWarehouseOverrides, applyCustomerOverrides } from "./templates.js";
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

const COLUMNS: Record<"warehouses" | "customers", string[]> = {
  warehouses: ["template_version", "id", "city", "state", "capacity", "status"],
  customers: ["template_version", "id", "city", "state", "demand", "status"],
};

const VALID_STATUSES: Record<"warehouses" | "customers", string[]> = {
  warehouses: ["active", "forced_open", "inactive"],
  customers: ["active", "excluded"],
};

interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }
interface CustomerOverride { id: string; demand?: number | null; status: "active" | "excluded"; }

export function parseAndValidateImport(
  entity: "warehouses" | "customers",
  csvText: string,
  currentOverrides: { warehouseOverrides?: WarehouseOverride[]; customerOverrides?: CustomerOverride[] },
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

  const baseline = entity === "warehouses"
    ? applyWarehouseOverrides(currentOverrides.warehouseOverrides ?? [])
    : applyCustomerOverrides(currentOverrides.customerOverrides ?? []);
  const baselineById = new Map(baseline.map(r => [r.id, r] as const));
  const validStatuses = VALID_STATUSES[entity];
  const valueLabel = entity === "warehouses" ? "capacity" : "demand";

  const seenIds = new Set<string>();
  const dataRows = rows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // 1-indexed, +1 for header row
    const cols = dataRows[i];

    if (cols.length !== expectedColumns.length) {
      errors.push({ errorClass: "syntax", line, message: `Expected ${expectedColumns.length} columns, got ${cols.length}` });
      continue;
    }

    const [tvStr, id, , , valueStr, status] = cols;

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

    if (!validStatuses.includes(status)) {
      errors.push({ errorClass: "logic", line, message: `Invalid status "${status}" (expected one of ${validStatuses.join(", ")})` });
      continue;
    }

    const beforeValue = entity === "warehouses" ? (baselineRow as { capacity: number | null }).capacity : (baselineRow as { demand: number }).demand;

    if (baselineRow.status !== status || beforeValue !== value) {
      changes.push({
        id,
        line,
        before: { status: baselineRow.status, value: beforeValue },
        after: { status, value },
      });
    }
  }

  // Cross-field warning (non-blocking): total capacity of the p highest-
  // capacity active warehouses vs total customer demand.
  if (errors.length === 0 && entity === "warehouses") {
    const changeByIdMap = new Map(changes.map(c => [c.id, c]));
    const warehouseBaseline = baseline as Array<{ id: string; status: "active" | "forced_open" | "inactive"; capacity: number | null }>;
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
