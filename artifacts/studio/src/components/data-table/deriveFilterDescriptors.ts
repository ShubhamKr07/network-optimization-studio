// SCU-2.P1 (spec B2.2 "Filter") — FilterMenu descriptors generated from a
// DataTable's columns. Precedence: explicit `filter` → kind number = range →
// kind enum = select → kind text = select when ≤ 20 distinct non-null values,
// else text. Filtering reads `value()`, never display text. null/NaN match
// only the "(empty)" select option — an internal token, `EMPTY_FILTER_VALUE`,
// that no real value can equal — and are excluded from ranges.

import { EMPTY_FILTER_VALUE } from "@/lib/useTableFilters";
import type { ColumnFilterDescriptor, ColumnFilterType } from "@/lib/useTableFilters";
import type { CellValue, ColumnDef } from "./types";

export const FILTER_ROW_THRESHOLD = 10;
export const SELECT_DISTINCT_MAX = 20;

function isEmpty(v: CellValue): boolean {
  return v === null || (typeof v === "number" && Number.isNaN(v));
}

function resolveType<T>(column: ColumnDef<T>, rows: T[]): ColumnFilterType {
  if (column.filter === "range") return "number";
  if (column.filter === "select" || column.filter === "text") return column.filter;
  if (column.kind === "number") return "number";
  if (column.kind === "enum") return "select";
  const distinct = new Set<string>();
  for (const row of rows) {
    const v = column.value(row);
    if (isEmpty(v)) continue;
    distinct.add(String(v));
    if (distinct.size > SELECT_DISTINCT_MAX) return "text";
  }
  return "select";
}

export function deriveFilterDescriptors<T>(columns: ColumnDef<T>[], rows: T[]): ColumnFilterDescriptor<T>[] {
  return columns
    .filter(c => c.filter !== false)
    .map(c => {
      const type = resolveType(c, rows);
      const label = c.filterLabel ?? (typeof c.header === "string" ? c.header : c.id);
      const accessor = (row: T): string | number | undefined => {
        const v = c.value(row);
        if (isEmpty(v)) return type === "select" ? EMPTY_FILTER_VALUE : undefined;
        return v as string | number;
      };
      return { key: c.id, label, type, accessor };
    });
}
