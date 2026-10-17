// SCU-2.P1 (spec B2.2 "Paging") — replaces the four local `PAGE_SIZE = 50`
// pagers (DistancesTab, JadeDistancesTab, DeliveryCostsTab,
// JadeAssignmentsTab). Pure client paging over already-filtered rows. The
// page size is fixed at 50 by the spec; there is deliberately no override.
//
// Reset rule (B2.2): a change of `resetKey` returns to page 1. DataTable
// builds it with `pageResetKey`: the canonical filter state + the SORTED key
// set of ALL effective rows (not just the filtered ones). So any filter
// change, and any add/delete — even of a row the filter hides — resets;
// editing a cell (same keys) or reordering rows does not, even when the edit
// moves a row in or out of the filter (the page then only clamps).
// A page beyond the end clamps to the last page (derived, no effect).
// `setPage(page, forResetKey)` pre-claims the key the table is ABOUT to have
// (a focus jump clears the filters in the same tick), so the reset rule
// adopts that page instead of undoing the jump.

import { useState } from "react";
import type { FilterState, FilterValue } from "@/lib/useTableFilters";

export const PAGE_SIZE = 50;

export interface PagedRows<T> {
  /** 1-based, always within [1, pageCount]. */
  page: number;
  /** ≥ 1 (an empty list has one empty page). */
  pageCount: number;
  pageRows: T[];
  /** Spec: pager rendered only when filtered rows > 50. */
  showPager: boolean;
  setPage: (page: number, forResetKey?: string) => void;
}

const SEP = "\u0000";

function canonicalFilterValue(v: FilterValue): unknown {
  if (v.type === "select") return { type: "select", values: [...v.values].sort() };
  if (v.type === "number") return { type: "number", min: v.min ?? null, max: v.max ?? null };
  return { type: "text", value: v.value };
}

/** Order-insensitive identity of (filter state, effective row-key set). */
export function pageResetKey<T>(rows: T[], rowKey: (row: T) => string, filterState: FilterState): string {
  const filters = Object.keys(filterState)
    .sort()
    .map(k => [k, canonicalFilterValue(filterState[k])]);
  return JSON.stringify(filters) + SEP + rows.map(rowKey).sort().join(SEP);
}

export function usePagedRows<T>(rows: T[], resetKey: string): PagedRows<T> {
  const [state, setState] = useState<{ page: number; key: string; claim?: string }>({ page: 1, key: resetKey });
  // Render-phase state adjustment (React-sanctioned) — no effect, no flash of the old page.
  if (state.key !== resetKey) {
    setState(state.claim === resetKey ? { page: state.page, key: resetKey } : { page: 1, key: resetKey });
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const raw = state.key === resetKey || state.claim === resetKey ? state.page : 1;
  const page = Math.min(Math.max(1, raw), pageCount);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const setPage = (next: number, forResetKey?: string) =>
    setState(prev => ({ page: Math.max(1, Math.floor(next)), key: prev.key, claim: forResetKey }));
  return { page, pageCount, pageRows, showPager: rows.length > PAGE_SIZE, setPage };
}
