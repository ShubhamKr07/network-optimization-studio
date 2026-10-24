// SCU-2.P1 (spec B2.1/B2.2) — the one rendering shell every Workspace table
// is migrated onto in P3/P4. The adapter supplies effective rows, columns and
// a literal testid map; the shell owns filter → sort → clamp → slice 50, the filter
// menu (> 10 rows), the pager (> 50 filtered rows), focus jumps and layout.
// It renders real <table>/<thead>/<th>/<tr>/<td> (e2e reads `thead th` text),
// puts `cell()` output directly in the <td> (no wrapper element), and never
// adds a column of its own.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters } from "@/lib/useTableFilters";
import { cn } from "@/lib/utils";
import { deriveFilterDescriptors, FILTER_ROW_THRESHOLD } from "./deriveFilterDescriptors";
import { PAGE_SIZE, pageResetKey, usePagedRows } from "./usePagedRows";
import { TablePager } from "./TablePager";
import type { CellValue, ColumnDef, DataTableProps, DataTableSection } from "./types";

const KEY_SEP = "\u0000";

// QFX-4 — one sorted column at a time; dir 1 = ascending, -1 = descending.
type SortState = { id: string; dir: 1 | -1 };
const sortKey = (s: SortState | null) => (s ? `${s.id}:${s.dir}` : "");
const isBlank = (v: CellValue) => v === null || v === "" || Number.isNaN(v);

/** Blank/null last in BOTH directions; numbers numerically; strings natural and
 * case-insensitive. 0 = tie (the caller keeps input order). */
function compareCells(a: CellValue, b: CellValue, dir: 1 | -1): number {
  const blankA = isBlank(a);
  const blankB = isBlank(b);
  if (blankA || blankB) return Number(blankA) - Number(blankB);
  const c =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return dir * c;
}

/** Sorts decorated `{ row, originalIndex }` items, never the input array, so every
 * cell()/rowKey() callback still receives the adapter's own row (super tables carry
 * their original index inside it, `superTables.tsx` `Item`). With sections, a row's
 * section index sorts first: rows sort within their section, section order is
 * unchanged and paging still runs base-first. Ties keep input order (stable). */
function sortRows<T>(rows: T[], sort: SortState | null, columns: ColumnDef<T>[], sections?: DataTableSection<T>[]): T[] {
  if (!sort) return rows;
  const decorated = rows.map((row, originalIndex) => {
    const found = sections ? sections.findIndex(s => s.includes(row)) : 0;
    const sec = found < 0 ? (sections?.length ?? 0) : found;
    const cols = sections?.[sec]?.columns ?? columns;
    const col = cols.find(c => c.id === sort.id);
    return { row, originalIndex, sec, v: col ? col.value(row) : null };
  });
  decorated.sort((x, y) => x.sec - y.sec || compareCells(x.v, y.v, sort.dir) || x.originalIndex - y.originalIndex);
  return decorated.map(d => d.row);
}

export function DataTable<T>({
  rows,
  rowKey,
  columns,
  testIds = {},
  rowClassName,
  toolbar,
  emptyState,
  noMatchText = "No rows match the current filter.",
  sections,
  focus,
  scrollClassName,
  footer,
  countNoun,
}: DataTableProps<T>) {
  // Pipeline (B2.2 + QFX-4, fixed order): effective rows (adapter) → filter → sort → clamp page → slice 50.
  const descriptors = useMemo(() => deriveFilterDescriptors(columns, rows), [columns, rows]);
  const tableFilters = useTableFilters(rows, descriptors);
  const { filteredRows, filterState, setFilter, clearAll } = tableFilters;
  // QFX-4 — component-local (resets on unmount); asc → desc → off, another column starts asc.
  const [sort, setSort] = useState<SortState | null>(null);
  const cycleSort = (id: string) =>
    setSort(s => (!s || s.id !== id ? { id, dir: 1 } : s.dir === 1 ? { id, dir: -1 } : null));
  // Reset key = canonical filter state + sorted key set of ALL effective rows
  // (pageResetKey) + the sort: any filter or sort change, or add/delete, resets to
  // page 1; a cell edit or a reorder does not.
  const resetKey = useMemo(
    () => pageResetKey(rows, rowKey, filterState) + KEY_SEP + sortKey(sort),
    [rows, rowKey, filterState, sort],
  );
  // QFX-R1 — the order is frozen between resetKey changes: editable cells commit per
  // keystroke, and re-sorting then would make the edited row jump while typing.
  const frozenOrder = useRef<{ key: string; rank: Map<string, number> } | null>(null);
  let sortedRows = filteredRows;
  if (!sort) frozenOrder.current = null; // a later sort must recompute, never reuse ranks from before the clear
  else {
    if (frozenOrder.current?.key !== resetKey) {
      sortedRows = sortRows(filteredRows, sort, columns, sections);
      frozenOrder.current = { key: resetKey, rank: new Map(sortedRows.map((r, i) => [rowKey(r), i])) };
    } else {
      const { rank } = frozenOrder.current;
      sortedRows = [...filteredRows].sort((a, b) => (rank.get(rowKey(a)) ?? rank.size) - (rank.get(rowKey(b)) ?? rank.size));
    }
  }
  // The key the table will have once a focus jump has cleared every filter and the sort.
  const clearedKey = useMemo(() => pageResetKey(rows, rowKey, {}) + KEY_SEP + sortKey(null), [rows, rowKey]);
  const paged = usePagedRows(sortedRows, resetKey);

  // Per-column filter reset: a changed `filterResetKey` clears only that column's filter.
  const resetSignature = columns.map(c => `${c.id}=${c.filterResetKey ?? ""}`).join(KEY_SEP);
  const lastReset = useRef<Record<string, string | number>>({});
  useEffect(() => {
    for (const c of columns) {
      if (c.filterResetKey === undefined) continue;
      const prev = lastReset.current[c.id];
      if (prev !== undefined && prev !== c.filterResetKey) setFilter(c.id, undefined);
      lastReset.current[c.id] = c.filterResetKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignature]);

  // Focus jump (today's behaviour, DistancesTab.tsx:459-467): clear every filter (and the QFX-4 sort),
  // go to the page of the first matching row in the now-unfiltered list, then
  // scroll that row into view once its page has rendered.
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingScrollKey = useRef<string | null>(null);
  const consumedToken = useRef<string | null>(null);
  // Re-runs on `rows` so a focus whose row arrives later is retried. A jump is
  // consumed per (token, target page): a late-loading base block that pushes
  // the target to another page re-aims it, while an unrelated add/delete that
  // leaves the target on its page does not re-fire or clear the user's filters.
  useEffect(() => {
    if (!focus) return;
    const idx = rows.findIndex(focus.matches);
    if (idx < 0) return;
    const consumed = `${focus.token}|${Math.floor(idx / PAGE_SIZE)}`;
    if (consumedToken.current === consumed) return;
    consumedToken.current = consumed;
    clearAll();
    setSort(null);
    paged.setPage(Math.floor(idx / PAGE_SIZE) + 1, clearedKey);
    pendingScrollKey.current = rowKey(rows[idx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.token, rows]);
  useEffect(() => {
    const key = pendingScrollKey.current;
    if (key === null || !rootRef.current) return;
    const el = Array.from(rootRef.current.querySelectorAll("tr[data-row-key]")).find(
      tr => tr.getAttribute("data-row-key") === key,
    );
    if (el) {
      el.scrollIntoView({ block: "center" });
      pendingScrollKey.current = null;
    } else if (paged.pageRows.some(r => rowKey(r) === key)) {
      // On the current page yet never rendered (row belongs to no section): give up.
      pendingScrollKey.current = null;
    }
  });

  const noMatch = rows.length > 0 && filteredRows.length === 0;
  // SCU-2.P3.7 (spec B2.2 exception) — no filterable column, no filter menu.
  const showFilter = rows.length > FILTER_ROW_THRESHOLD && descriptors.length > 0;

  const renderTable = (
    allCols: ColumnDef<T>[],
    bodyRows: T[],
    opts: { tableTestId?: string; rowTestId?: (row: T) => string; showNoMatch: boolean },
  ) => {
    const cols = allCols.filter(c => !c.hidden);
    return (
      <Table className="table-auto" data-testid={opts.tableTestId}>
        <TableHeader>
          <TableRow>
            {cols.map(c => {
              const sortable = c.sortable !== false;
              const dir = sort?.id === c.id ? sort.dir : 0;
              return (
                <TableHead
                  key={c.id}
                  className={cn("h-auto px-3 py-1.5 whitespace-nowrap", c.kind === "number" && "text-center")}
                  data-testid={c.headerTestId}
                  aria-sort={!sortable ? undefined : dir === 1 ? "ascending" : dir === -1 ? "descending" : "none"}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => cycleSort(c.id)}
                    >
                      {c.header}
                      {dir !== 0 && <span aria-hidden="true">{dir === 1 ? "▲" : "▼"}</span>}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {bodyRows.map(row => {
            const key = rowKey(row);
            return (
              <TableRow key={key} data-row-key={key} data-testid={opts.rowTestId?.(row)} className={rowClassName?.(row)}>
                {cols.map(c => (
                  <TableCell
                    key={c.id}
                    className={cn("px-3 py-1.5", c.kind === "number" && "text-center", c.cellClassName)}
                    data-testid={c.cellTestId?.(row)}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          {opts.showNoMatch && (
            <TableRow>
              <TableCell colSpan={cols.length} className="px-3 py-3 text-xs text-muted-foreground text-center" data-testid={testIds.noMatch}>
                {noMatchText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    );
  };

  const renderSections = (list: DataTableSection<T>[]) => {
    const firstSection = (row: T) => list.find(s => s.includes(row));
    const onPage = new Map<string, T[]>(list.map(s => [s.id, []]));
    for (const row of paged.pageRows) {
      const s = firstSection(row);
      if (s) onPage.get(s.id)!.push(row);
    }
    const owners = new Set(rows.map(r => firstSection(r)?.id));
    const noMatchSectionId = list.find(s => owners.has(s.id))?.id;
    return list.map(s => {
      const pageRows = onPage.get(s.id)!;
      const owned = owners.has(s.id);
      const showNoMatch = noMatch && s.id === noMatchSectionId;
      let content: ReactNode = null;
      if (!owned) content = s.emptyState ?? null;
      else if (pageRows.length > 0 || showNoMatch)
        content = (
          <div className={s.scrollClassName} data-testid={s.scrollTestId}>
            {renderTable(s.columns ?? columns, pageRows, {
              tableTestId: s.tableTestId,
              rowTestId: s.rowTestId ?? testIds.row,
              showNoMatch,
            })}
          </div>
        );
      if (content === null && !s.footer) return null;
      return (
        <div key={s.id} data-testid={s.testId} className="space-y-1">
          {s.title && <div className="px-1 text-xs font-medium text-muted-foreground">{s.title}</div>}
          {content}
          {s.footer}
        </div>
      );
    });
  };

  let body: ReactNode;
  if (rows.length === 0 && emptyState !== undefined) {
    body = <div data-testid={testIds.empty}>{emptyState}</div>;
  } else {
    body = (
      <>
        {sections ? (
          <div className="space-y-3">{renderSections(sections)}</div>
        ) : (
          <div className={scrollClassName} data-testid={testIds.scroll}>
            {renderTable(columns, paged.pageRows, { tableTestId: testIds.table, rowTestId: testIds.row, showNoMatch: noMatch })}
          </div>
        )}
        {paged.showPager && (
          <TablePager
            page={paged.page}
            pageCount={paged.pageCount}
            onPageChange={p => paged.setPage(p)}
            testIds={{ pager: testIds.pager, prev: testIds.pagerPrev, next: testIds.pagerNext, indicator: testIds.pageIndicator }}
          />
        )}
      </>
    );
  }

  const hasToolbar = Boolean(
    toolbar?.upload || toolbar?.download || toolbar?.add || toolbar?.extra || showFilter || testIds.count || testIds.toolbar,
  );

  return (
    <div ref={rootRef} data-testid={testIds.root}>
      {hasToolbar && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid={testIds.toolbar}>
          {toolbar?.upload}
          {toolbar?.downloadAlign !== "right" && toolbar?.download}
          {toolbar?.add}
          {toolbar?.extra}
          <div className="ml-auto flex items-center gap-2">
            {testIds.count && (
              <span className="text-xs text-muted-foreground" data-testid={testIds.count}>
                {countNoun && tableFilters.filteredCount === tableFilters.totalCount
                  ? `${tableFilters.filteredCount} ${countNoun}`
                  : `${tableFilters.filteredCount} of ${tableFilters.totalCount}${countNoun ? ` ${countNoun}` : ""}`}
              </span>
            )}
            {showFilter && <FilterMenu descriptors={descriptors} tableFilters={tableFilters} triggerTestId={testIds.filterTrigger} />}
            {toolbar?.downloadAlign === "right" && toolbar?.download}
          </div>
        </div>
      )}
      {body}
      {footer}
    </div>
  );
}
