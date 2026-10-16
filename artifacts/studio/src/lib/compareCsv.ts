import { csvCell } from "@/lib/clientCsv";

// SCU-1.3 (spec B1.3) — Solution Summary compare CSV. `rows` is the compare
// table's OWN row model (CostSummaryTab.tsx), never DOM text: same rows, same
// order. Raw values; `null` (row absent for that scenario) -> empty cell.
export interface CompareCsvRow {
  csvLabel: string;
  cells: Array<{ raw: number | string | null }>;
}

export function buildCompareCsv(rows: CompareCsvRow[], scenarios: Array<{ name: string }>): string {
  const lines = [
    ["metric", ...scenarios.map(s => s.name)],
    ...rows.map(r => [r.csvLabel, ...r.cells.map(c => (c.raw == null ? "" : String(c.raw)))]),
  ];
  return lines.map(line => line.map(csvCell).join(",")).join("\n");
}
