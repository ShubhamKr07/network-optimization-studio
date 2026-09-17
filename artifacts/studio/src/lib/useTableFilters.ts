// A3 (JADE Ch.9 Workspace Bundle, spec §10) — a generic, reusable table-filter
// hook. Row type is a generic `T` so any grid (Distances, Assignments, Flows,
// Plants, ...) can wire in its own row shape + column descriptors without a
// bespoke filter implementation per table. Pure: filtering happens entirely
// client-side, over whatever `rows` the caller already has in memory, BEFORE
// any pagination the caller applies on top of `filteredRows`.
//
// This hook does not render anything and does not decide when a filter UI
// should be shown — see `components/tables/FilterMenu.tsx` for the paired
// popover control and its own "caller decides visibility" contract.

import { useCallback, useMemo, useState } from "react";

export type ColumnFilterType = "text" | "select" | "number";

export interface ColumnFilterDescriptor<T> {
  /** Stable key identifying this filter — also the `filterState`/`setFilter` key. */
  key: string;
  /** Human-readable label shown in the FilterMenu control. */
  label: string;
  type: ColumnFilterType;
  /** Reads the raw comparison value off a row. `undefined` means "no value for
   * this row" — such rows never match a `select`/`number` filter once one is
   * active on that column, and are treated as an empty string for `text`. */
  accessor: (row: T) => string | number | undefined;
}

export interface TextFilterValue {
  type: "text";
  /** Case-insensitive substring match against `String(accessor(row))`. An
   * empty/whitespace-only value is treated as "no filter" (matches everything). */
  value: string;
}

export interface SelectFilterValue {
  type: "select";
  /** Selected accessor values, stringified (`String(v)`) — multi-select "OR"
   * semantics: a row matches if its accessor value is in this set. An empty
   * array is treated as "no filter" (matches everything). */
  values: string[];
}

export interface NumberFilterValue {
  type: "number";
  /** Inclusive lower bound. Omitted = no lower bound. */
  min?: number;
  /** Inclusive upper bound. Omitted = no upper bound. */
  max?: number;
}

export type FilterValue = TextFilterValue | SelectFilterValue | NumberFilterValue;

/** Keyed by `ColumnFilterDescriptor.key`. A key absent from this map means
 * that column currently has no active filter. */
export type FilterState = Record<string, FilterValue>;

export interface UseTableFiltersResult<T> {
  /** `rows` narrowed by every currently-active filter (AND across columns). */
  filteredRows: T[];
  filterState: FilterState;
  /** Set (or, passing `undefined`, clear) the filter for one column. */
  setFilter: (key: string, value: FilterValue | undefined) => void;
  /** Clear every active filter at once. */
  clearAll: () => void;
  /** `rows.length`, unfiltered. */
  totalCount: number;
  /** `filteredRows.length`. */
  filteredCount: number;
  /** For each `select`-type descriptor, the DISTINCT accessor values found
   * across the UNFILTERED `rows` (not narrowed by any currently-applied
   * filter, including that column's own) — so picking a value in column A
   * never removes options that would otherwise be visible in column B's
   * (or column A's own) list, and a column's own selection never shrinks its
   * own option list either. Insertion order (first-seen in `rows`). */
  distinctValuesByKey: Record<string, Array<string | number>>;
}

function matchesFilter<T>(row: T, descriptor: ColumnFilterDescriptor<T>, filter: FilterValue): boolean {
  const value = descriptor.accessor(row);

  if (filter.type === "text") {
    const needle = filter.value.trim().toLowerCase();
    if (needle === "") return true;
    const haystack = value === undefined ? "" : String(value).toLowerCase();
    return haystack.includes(needle);
  }

  if (filter.type === "select") {
    if (filter.values.length === 0) return true;
    if (value === undefined) return false;
    return filter.values.includes(String(value));
  }

  // "number"
  const hasMin = filter.min !== undefined;
  const hasMax = filter.max !== undefined;
  if (!hasMin && !hasMax) return true;
  const num = typeof value === "number" ? value : value !== undefined ? Number(value) : NaN;
  if (!Number.isFinite(num)) return false;
  if (hasMin && num < (filter.min as number)) return false;
  if (hasMax && num > (filter.max as number)) return false;
  return true;
}

export function useTableFilters<T>(
  rows: T[],
  descriptors: ColumnFilterDescriptor<T>[],
): UseTableFiltersResult<T> {
  const [filterState, setFilterState] = useState<FilterState>({});

  // Distinct values are always derived from the UNFILTERED `rows` array, per
  // the field's own contract above — deliberately NOT `filteredRows`.
  const distinctValuesByKey = useMemo(() => {
    const result: Record<string, Array<string | number>> = {};
    for (const descriptor of descriptors) {
      if (descriptor.type !== "select") continue;
      const seen = new Map<string, string | number>();
      for (const row of rows) {
        const value = descriptor.accessor(row);
        if (value === undefined) continue;
        const key = String(value);
        if (!seen.has(key)) seen.set(key, value);
      }
      result[descriptor.key] = Array.from(seen.values());
    }
    return result;
  }, [rows, descriptors]);

  const filteredRows = useMemo(() => {
    const activeEntries = descriptors
      .map(descriptor => ({ descriptor, filter: filterState[descriptor.key] }))
      .filter((entry): entry is { descriptor: ColumnFilterDescriptor<T>; filter: FilterValue } => entry.filter != null);
    if (activeEntries.length === 0) return rows;
    return rows.filter(row => activeEntries.every(({ descriptor, filter }) => matchesFilter(row, descriptor, filter)));
  }, [rows, descriptors, filterState]);

  const setFilter = useCallback((key: string, value: FilterValue | undefined) => {
    setFilterState(prev => {
      if (value === undefined) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const clearAll = useCallback(() => setFilterState({}), []);

  return {
    filteredRows,
    filterState,
    setFilter,
    clearAll,
    totalCount: rows.length,
    filteredCount: filteredRows.length,
    distinctValuesByKey,
  };
}
