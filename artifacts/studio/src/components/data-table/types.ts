// SCU-2.P1 (spec B2.1) — the public contract of the shared Workspace table
// shell. P3/P4 adapters are written against these types only; DataTable.tsx
// is the single renderer. Kept in its own file so an adapter module can
// import the types without importing React components.

import type { ReactNode } from "react";

/** Drives alignment (number → centred) and filter auto-derivation (B2.2). */
export type ColumnKind = "text" | "number" | "enum";

/** Explicit filter override. "range" maps to `useTableFilters`' "number". */
export type ColumnFilterKind = "text" | "select" | "range";

/** Raw value used for filtering and client export — never display text. */
export type CellValue = string | number | null;

export interface ColumnDef<T> {
  /** Stable id. Also the filter descriptor key, so FilterMenu emits
   * `filter-control-{id}`, `input-filter-{id}`, `checkbox-filter-{id}-{value}`. */
  id: string;
  header: ReactNode;
  /** FilterMenu label. Defaults to `header` when it is a string, else `id`. */
  filterLabel?: string;
  kind: ColumnKind;
  cell: (row: T) => ReactNode;
  value: (row: T) => CellValue;
  /** Overrides auto-derivation; `false` = this column is not filterable. */
  filter?: false | ColumnFilterKind;
  /** data-testid on this column's <td> for `row`. */
  cellTestId?: (row: T) => string;
  /** data-testid on this column's <th>. */
  headerTestId?: string;
  /** Extra classes on the <td> (e.g. "font-mono text-xs"); alignment and padding are the shell's. */
  cellClassName?: string;
  /** Filter-only column: never rendered (no <th>/<td>), still gets a filter descriptor
   * (e.g. CapabilityMatrix `state`, `CapabilityMatrixTab.tsx:65`). */
  hidden?: boolean;
  /** When this value changes, ONLY this column's active filter is cleared (e.g. the
   * JADE `band` filter when bands or the unit change, `JadeAssignmentsTab.tsx:277-280`). */
  filterResetKey?: string | number;
  /** QFX-4 — the header is a button cycling ascending → descending → off, ordering by
   * `value()`. Default true. Every empty-header (delete/action) column sets `false`
   * (`sortableEmptyHeaders.test.ts`). */
  sortable?: boolean;
}

/** Explicit literal testid mapping — nothing is auto-prefixed. Omitted = no attribute. */
export interface DataTableTestIds<T> {
  /** Outer wrapper <div> that holds toolbar + table(s) + pager. */
  root?: string;
  toolbar?: string;
  /** The <table> element (single-table mode; sections use `DataTableSection.tableTestId`). */
  table?: string;
  /** The scroll wrapper <div> around the <table> (single-table mode; sections use `scrollTestId`). */
  scroll?: string;
  /** Always-visible "{filtered} of {total}" counter in the toolbar (e.g. `text-jadeassignments-count`). Omitted = no counter. */
  count?: string;
  row?: (row: T) => string;
  pager?: string;
  pagerPrev?: string;
  pagerNext?: string;
  pageIndicator?: string;
  /** Defaults to FilterMenu's own `button-filter-menu-trigger`. */
  filterTrigger?: string;
  /** Element rendered when `rows` is empty. */
  empty?: string;
  /** The single full-width row rendered when the filter matches nothing. */
  noMatch?: string;
}

export interface DataTableToolbar {
  upload?: ReactNode;
  download?: ReactNode;
  add?: ReactNode;
  extra?: ReactNode;
  /** Where `download` renders: "left" (default, in slot order) or "right" (last,
   *  after the count and the filter trigger — output tables, user decision 2026-10-17). */
  downloadAlign?: "left" | "right";
}

/** Base + added rows rendered as titled groups under ONE toolbar, filter menu and pager. */
export interface DataTableSection<T> {
  id: string;
  title?: ReactNode;
  /** data-testid on the section wrapper <div>. */
  testId?: string;
  /** data-testid on this section's <table>. */
  tableTestId?: string;
  /** data-testid on this section's scroll wrapper <div>. */
  scrollTestId?: string;
  /** Classes for this section's scroll wrapper (base and added scroll independently today). */
  scrollClassName?: string;
  /** Row testid for this section; overrides `testIds.row`. */
  rowTestId?: (row: T) => string;
  /** A row renders in the FIRST section whose `includes` is true; a row matching none is not rendered. */
  includes: (row: T) => boolean;
  /** Section-specific columns (e.g. added rows carry a delete column). Defaults to the table's `columns`. */
  columns?: ColumnDef<T>[];
  /** Rendered after this section's table (e.g. an inline add-row form + its error text). Always rendered. */
  footer?: ReactNode;
  /** Rendered in place of this section's table when NO row in `rows` belongs to it. */
  emptyState?: ReactNode;
}

/** Focus jump (`DistancesTab.tsx:459-479`, `JadeDistancesTab.tsx:441-505`). A new
 * `token` clears every filter, moves to the page holding the first matching row
 * and scrolls that row into view. */
export interface DataTableFocus<T> {
  token: string | number;
  matches: (row: T) => boolean;
}

export interface DataTableProps<T> {
  /** Already-effective rows (base ⊕ saved overrides ⊕ current edits ⊕ added), base rows first. */
  rows: T[];
  /** Unique per row; composite keys allowed (e.g. `${fromId}|${toId}`). Keep it stable and cheap: `pageResetKey` calls it for every row and sorts all keys on each render. */
  rowKey: (row: T) => string;
  /** May be rebuilt each render; DataTable/FilterMenu must not key effects on this array's identity. */
  columns: ColumnDef<T>[];
  testIds?: DataTableTestIds<T>;
  rowClassName?: (row: T) => string | undefined;
  toolbar?: DataTableToolbar;
  /** Rendered INSTEAD of table(s)/pager when `rows` is empty (toolbar slots still render).
   * With `sections` and no top-level emptyState, each section's own emptyState renders instead. */
  emptyState?: ReactNode;
  /** Text of the full-width row shown when the filter matches nothing. Default "No rows match the current filter." */
  noMatchText?: ReactNode;
  sections?: DataTableSection<T>[];
  focus?: DataTableFocus<T> | null;
  /** Classes for the scroll wrapper around the table (single-table mode), e.g. "max-h-[55vh] overflow-y-auto". */
  scrollClassName?: string;
  /** Rendered inside the root after the pager (e.g. CostSummary's bands note). */
  footer?: ReactNode;
}
