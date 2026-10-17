// SCU-2.P1 (spec B2.1/B2.2) — the one rendering shell every Workspace table
// is migrated onto in P3/P4. The adapter supplies effective rows, columns and
// a literal testid map; the shell owns filter → clamp → slice 50, the filter
// menu (> 10 rows), the pager (> 50 filtered rows), focus jumps and layout.
// It renders real <table>/<thead>/<th>/<tr>/<td> (e2e reads `thead th` text),
// puts `cell()` output directly in the <td> (no wrapper element), and never
// adds a column of its own.

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters } from "@/lib/useTableFilters";
import { cn } from "@/lib/utils";
import { deriveFilterDescriptors, FILTER_ROW_THRESHOLD } from "./deriveFilterDescriptors";
import { PAGE_SIZE, pageResetKey, usePagedRows } from "./usePagedRows";
import { TablePager } from "./TablePager";
import type { ColumnDef, DataTableProps, DataTableSection } from "./types";

const KEY_SEP = "\u0000";

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
}: DataTableProps<T>) {
  // Pipeline (B2.2, fixed order): effective rows (adapter) → filter → clamp page → slice 50.
  const descriptors = useMemo(() => deriveFilterDescriptors(columns, rows), [columns, rows]);
  const tableFilters = useTableFilters(rows, descriptors);
  const { filteredRows, filterState, setFilter, clearAll } = tableFilters;
  // Reset key = canonical filter state + sorted key set of ALL effective rows
  // (pageResetKey): any filter change or add/delete resets to page 1; a cell
  // edit or a reorder does not.
  const resetKey = useMemo(() => pageResetKey(rows, rowKey, filterState), [rows, rowKey, filterState]);
  // The key the table will have once a focus jump has cleared every filter.
  const clearedKey = useMemo(() => pageResetKey(rows, rowKey, {}), [rows, rowKey]);
  const paged = usePagedRows(filteredRows, resetKey);

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

  // Focus jump (today's behaviour, DistancesTab.tsx:459-467): clear every filter,
  // go to the page of the first matching row in the now-unfiltered list, then
  // scroll that row into view once its page has rendered.
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingScrollKey = useRef<string | null>(null);
  const consumedToken = useRef<string | number | null>(null);
  // Re-runs on `rows` so a focus whose row arrives later is retried — but only
  // while its token is unconsumed (one jump per token).
  useEffect(() => {
    if (!focus || consumedToken.current === focus.token) return;
    const idx = rows.findIndex(focus.matches);
    if (idx < 0) return;
    consumedToken.current = focus.token;
    clearAll();
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
            {cols.map(c => (
              <TableHead
                key={c.id}
                className={cn("h-auto px-3 py-1.5 whitespace-nowrap", c.kind === "number" && "text-center")}
                data-testid={c.headerTestId}
              >
                {c.header}
              </TableHead>
            ))}
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
                {tableFilters.filteredCount} of {tableFilters.totalCount}
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
