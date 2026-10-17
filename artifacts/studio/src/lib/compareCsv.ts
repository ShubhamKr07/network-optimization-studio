import { csvText } from "@/lib/clientCsv";

// SCU-1.3 (spec B1.3) — Solution Summary compare CSV. `rows` is the compare
// table's OWN row model (CostSummaryTab.tsx), never DOM text: same rows, same
// order. Raw values; `null` (row absent for that scenario) -> empty cell.
export interface CompareCsvRow {
  /** `null` = omit this row from the CSV (e.g. a band row whose unit label is unresolved). */
  csvLabel: string | null;
  cells: Array<{ raw: number | string | null }>;
}

export function buildCompareCsv(rows: CompareCsvRow[], scenarios: Array<{ name: string }>): string {
  const lines = [
    ["metric", ...scenarios.map(s => s.name)],
    ...rows.filter(r => r.csvLabel != null).map(r => [r.csvLabel!, ...r.cells.map(c => (c.raw == null ? "" : String(c.raw)))]),
  ];
  return csvText(lines);
}

// SCU-2.P3.8 (spec B2.4) — the compare JSON download: the SAME row model as
// the CSV, as `{ entity, unit?, rows }`. One row per metric the CSV exports
// (a `csvLabel: null` row is omitted from both); `values` holds one entry per
// compared scenario in on-screen order, keyed by id (scenario names are not
// unique). `unit` is the active display unit (omitted while unresolved).
export interface CompareJsonDocument {
  entity: "costSummaryCompare";
  unit?: string;
  rows: Array<{ metric: string; values: Array<{ scenarioId: number; scenario: string; value: number | string | null }> }>;
}

export function buildCompareJson(
  rows: CompareCsvRow[],
  scenarios: Array<{ id: number; name: string }>,
  unit: string | null,
): CompareJsonDocument {
  return {
    entity: "costSummaryCompare",
    ...(unit != null ? { unit } : {}),
    rows: rows.flatMap(r => (r.csvLabel == null ? [] : [{
      metric: r.csvLabel,
      values: scenarios.map((s, i) => ({ scenarioId: s.id, scenario: s.name, value: r.cells[i].raw })),
    }])),
  };
}
