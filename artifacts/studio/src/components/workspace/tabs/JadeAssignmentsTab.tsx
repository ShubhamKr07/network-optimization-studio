import { useEffect, useMemo, useState } from "react";
import type { Dataset, SolveResult } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { bandLabel, bandRangeLabel, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { downloadEntityExport } from "@/lib/exportEntity";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";

// B2 (JADE Ch.9 Workspace Bundle, spec §5/§5a) — Chapter 9 JADE's own
// product-level Customer Assignments table. Deliberately a SEPARATE
// component from the shared `AssignmentsTab.tsx` (spec §5's explicit
// instruction — that component is used by transport-coal/two-echelon-gold-au
// too and must stay byte-identical for them): JADE's `details.assignments`
// is genuinely one row per (product, customer) pair (single-source per
// PRODUCT, not per customer overall — a customer can be served the same
// warehouse across multiple products, or in principle different warehouses
// per product), so aggregating down to one row per customer the way the
// shared tab does would silently hide the product axis this table exists to
// show. Columns are exactly Product/Customer/Assigned Warehouse/Distance/
// Distance Band — no Demand, no Flow (spec §5a).

// Mirrors solve.py's `details_assignments.append({...})` shape (jade
// two-echelon build, `warehouse_to_customer` leg) exactly.
interface JadeAssignmentDetail {
  customerId: string;
  warehouseId: string;
  productId: string;
  distanceMi: number;
  flow?: number;
}

function extractAssignments(result: SolveResult | null | undefined): JadeAssignmentDetail[] {
  if (!result) return [];
  const details = result.details as { assignments?: JadeAssignmentDetail[] } | undefined;
  return details?.assignments ?? [];
}

// Same snapshot shape as AssignmentsTab.tsx's own AssignmentsDisplayedInputs
// (kept as a separate local declaration per file, matching that precedent)
// — JADE only ever populates addedWarehouses/addedCustomers (never
// addedRefineries, a two-echelon-gold-au-only key). Deliberately NOT
// `localInputs` — must be the last-SAVED inputs snapshot the solved
// `result` reflects (the snapshot invariant every output tab in this
// codebase honors).
export interface JadeAssignmentsDisplayedInputs {
  addedWarehouses?: { id: string; city?: string; state?: string; displayCode?: string }[];
  addedCustomers?: { id: string; city?: string; state?: string; displayCode?: string }[];
}

interface JadeAssignmentsTabProps {
  /** Optional (safe default `null`) so this component compiles/renders
   * standalone before INT wires the real solved result. */
  result?: SolveResult | null;
  /** Optional — base dataset (products/warehouses/customers id->name/city/
   * state lookups). Absent renders raw ids. */
  dataset?: Dataset | null;
  /** Live `distanceBands` (spec §2's "presentation-band" lens — the SAME
   * live array the map/legend read, so this column's labels always agree
   * with the map's colors). Falls back to the shared `DEFAULT_DISTANCE_BANDS`
   * display fallback (mirrors OutputMapTab.tsx's own `effectiveBands`
   * pattern) when empty/absent. */
  bands?: number[];
  /** Mirrors ListModelsResponseItem.distanceUnit (JADE's own canonical unit
   * is always "mi", but this is still threaded rather than defaulted — Part
   * D's toggle applies here too, and `undefined`/`null` means the manifest
   * hasn't resolved yet, in which case every distance-bearing cell/filter
   * option shows a loading placeholder instead of a guessed unit). */
  distanceUnit?: CanonicalUnit | null;
  /** Optional — enables the Download CSV button (parity with the shared
   * AssignmentsTab's own button; A4's backend export branch serves the
   * matching product-level columns for this model). */
  scenarioId?: number;
  /** The saved-inputs snapshot that produced `result` — added-entity id ->
   * city/state/displayCode lookups. */
  displayedInputs?: JadeAssignmentsDisplayedInputs | null;
  /** workspace-fixups-2, T10 (item 2) — the snapshot-matched identity
   * projection (`buildEntityIdentityById`, T3). This table already resolves
   * a single-line "City - ST" label for every cell via `customerLabel`/
   * `warehouseLabel` below (never showing the id/displayCode alongside it) —
   * when `identityById` has an entry for a cell's id AND the table's
   * UNFILTERED row count exceeds 10 (the item-2 `>10` upgrade rule), that
   * cell upgrades to the shared stacked `EntityIdCell` (City,State + mono
   * displayId). Below the threshold, or when `identityById`/the entry is
   * absent, the cell keeps its pre-existing single-line string — so
   * `identityById` unset is byte-unchanged from before this task at any row
   * count (the no-regression contract). */
  identityById?: Record<string, EntityIdentity>;
}

function productLabel(productId: string, dataset: Dataset | null | undefined): string {
  const product = dataset?.products?.find(p => p.id === productId);
  return product?.name ?? productId;
}

function cityStateLabel(city: string | undefined, state: string | undefined): string | undefined {
  if (!city) return undefined;
  return state ? `${city} - ${state}` : city;
}

// Base entity -> dataset city/state; added entity -> city/state from its
// own persisted displayedInputs row (added entities never appear in the
// shared base dataset). Unknown/unresolvable id falls back to the raw id.
function warehouseLabel(
  id: string,
  dataset: Dataset | null | undefined,
  addedWarehouses: JadeAssignmentsDisplayedInputs["addedWarehouses"],
): string {
  const added = addedWarehouses?.find(w => w.id === id);
  if (added) return cityStateLabel(added.city, added.state) ?? added.displayCode ?? id;
  const base = dataset?.warehouses.find(w => w.id === id);
  return cityStateLabel(base?.city, base?.state) ?? id;
}

function customerLabel(
  id: string,
  dataset: Dataset | null | undefined,
  addedCustomers: JadeAssignmentsDisplayedInputs["addedCustomers"],
): string {
  const added = addedCustomers?.find(c => c.id === id);
  if (added) return cityStateLabel(added.city, added.state) ?? added.displayCode ?? id;
  const base = dataset?.customers.find(c => c.id === id);
  return cityStateLabel(base?.city, base?.state) ?? id;
}

interface JadeAssignmentRow {
  key: string;
  productId: string;
  productLabel: string;
  customerId: string;
  customerLabel: string;
  warehouseId: string;
  warehouseLabel: string;
  distance: number;
  band: string;
}

// workspace-fixups-2, T10 (item 2) — the `>10` upgrade: when `upgrade` is
// true (unfiltered row count > 10) AND `identityById` has an entry for this
// id, render the shared stacked cell (adds the mono displayId sub-label this
// table never showed before); otherwise render the pre-existing single-line
// string UNCHANGED (the no-regression fallback).
function renderJadeEntityCell(
  id: string,
  fallbackLabel: string,
  identityById: Record<string, EntityIdentity> | undefined,
  upgrade: boolean,
) {
  const identity = upgrade ? identityById?.[id] : undefined;
  if (identity) {
    return (
      <EntityIdCell
        entityId={id}
        displayId={identity.displayId}
        location={(identity.city || identity.state) ? { city: identity.city, state: identity.state } : undefined}
      />
    );
  }
  return fallbackLabel;
}

const PAGE_SIZE = 50;

function Pager({
  page,
  pageCount,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 mt-1 text-xs">
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page <= 1}
        onClick={onPrev}
        data-testid="button-jadeassignments-prev"
      >
        Prev
      </Button>
      <span className="font-mono text-[11px] text-muted-foreground" data-testid="jadeassignments-page-indicator">
        Page {page} of {pageCount}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page >= pageCount}
        onClick={onNext}
        data-testid="button-jadeassignments-next"
      >
        Next
      </Button>
    </div>
  );
}

export function JadeAssignmentsTab({
  result = null,
  dataset = null,
  bands = [],
  distanceUnit,
  scenarioId,
  displayedInputs = null,
  identityById,
}: JadeAssignmentsTabProps) {
  const [page, setPage] = useState(1);
  const unit = useDisplayUnit();
  const canonicalResolved = distanceUnit != null;
  const resolvedUnitLabel = canonicalResolved ? unit.effectiveUnit(distanceUnit) : null;
  // `bandRangeLabel` (lib/bands.ts) has no unit-conversion awareness of its
  // own — it just prints whatever numbers/unit it's handed. Converting BOTH
  // the boundaries and the distance to the display unit before calling it
  // (rather than passing canonical numbers under a display-unit label) keeps
  // the printed range numerically correct; scaling every input by the same
  // factor preserves the same band classification.
  const formatRowDistance = (raw: number): string =>
    canonicalResolved ? `${unit.toDisplay(raw, distanceUnit).toFixed(1)} ${resolvedUnitLabel}` : "—";

  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;
  const displayBands = canonicalResolved ? effectiveBands.map(b => unit.toDisplay(b, distanceUnit)) : effectiveBands;

  const rows: JadeAssignmentRow[] = useMemo(() => {
    return extractAssignments(result).map(a => ({
      key: `${a.productId}|${a.customerId}`,
      productId: a.productId,
      productLabel: productLabel(a.productId, dataset),
      customerId: a.customerId,
      customerLabel: customerLabel(a.customerId, dataset, displayedInputs?.addedCustomers),
      warehouseId: a.warehouseId,
      warehouseLabel: warehouseLabel(a.warehouseId, dataset, displayedInputs?.addedWarehouses),
      distance: a.distanceMi,
      band: bandLabel(a.distanceMi, effectiveBands),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, displayedInputs, effectiveBands.join(",")]);

  const filterDescriptors: ColumnFilterDescriptor<JadeAssignmentRow>[] = useMemo(
    () => [
      { key: "product", label: "Product", type: "select", accessor: r => r.productLabel },
      { key: "customer", label: "Customer", type: "text", accessor: r => r.customerLabel },
      { key: "warehouse", label: "Warehouse", type: "select", accessor: r => r.warehouseLabel },
      { key: "distance", label: "Distance", type: "number", accessor: r => r.distance },
      {
        key: "band",
        label: "Distance Band",
        type: "select",
        accessor: r =>
          canonicalResolved
            ? bandRangeLabel(unit.toDisplay(r.distance, distanceUnit), displayBands, resolvedUnitLabel!)
            : "—",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveBands.join(","), distanceUnit, unit.pref],
  );

  const tableFilters = useTableFilters(rows, filterDescriptors);
  const { filteredRows, totalCount, filteredCount, setFilter } = tableFilters;

  // Workspace fixups bundle (T7, item 5) — when the live distance-band
  // boundaries or the distance unit change, a previously-selected band range
  // (e.g. "≤ 250 mi") can no longer match any current option (e.g.
  // "≤ 300 mi"), which would silently zero out the table with an orphaned
  // active-filter badge. Clear ONLY the `band` filter key on that change,
  // leaving every other active column filter intact (spec §5's stale-
  // selection policy).
  useEffect(() => {
    setFilter("band", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBands.join(","), distanceUnit, unit.pref]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function setFilteredPage(next: number) {
    setPage(Math.max(1, Math.min(pageCount, next)));
  }

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="jade-assignments-empty">
        No solved result yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-assignments-tab">
      <div className="flex items-center justify-between gap-2 p-2 border-b flex-shrink-0 flex-wrap">
        <span className="text-sm font-medium">Customer Assignments</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="text-jadeassignments-count">
            {filteredCount} of {totalCount}
          </span>
          {totalCount > 10 && <FilterMenu descriptors={filterDescriptors} tableFilters={tableFilters} />}
          {scenarioId != null && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid="button-download-jadeassignments-csv"
              onClick={() => downloadEntityExport(scenarioId, "assignments", "csv")}
            >
              Download CSV
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-auto flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Assigned Warehouse</TableHead>
              <TableHead className="text-right">Distance</TableHead>
              <TableHead>Distance Band</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.map(r => (
              <TableRow key={r.key} data-testid={`row-jadeassignment-${r.key}`}>
                <TableCell data-testid={`cell-jadeassignment-product-${r.key}`}>{r.productLabel}</TableCell>
                <TableCell data-testid={`cell-jadeassignment-customer-${r.key}`}>
                  {renderJadeEntityCell(r.customerId, r.customerLabel, identityById, rows.length > 10)}
                </TableCell>
                <TableCell data-testid={`cell-jadeassignment-warehouse-${r.key}`}>
                  {renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, rows.length > 10)}
                </TableCell>
                <TableCell className="text-right font-mono" data-testid={`cell-jadeassignment-distance-${r.key}`}>
                  {formatRowDistance(r.distance)}
                </TableCell>
                <TableCell data-testid={`cell-jadeassignment-band-${r.key}`}>{r.band}</TableCell>
              </TableRow>
            ))}
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-3">
                  No rows match the current filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {filteredRows.length > PAGE_SIZE && (
        <Pager
          page={currentPage}
          pageCount={pageCount}
          onPrev={() => setFilteredPage(currentPage - 1)}
          onNext={() => setFilteredPage(currentPage + 1)}
        />
      )}
    </div>
  );
}
