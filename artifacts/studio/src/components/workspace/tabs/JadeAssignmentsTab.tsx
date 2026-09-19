import { useEffect, useMemo, useState } from "react";
import type { Dataset, SolveResult } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { bandLabel, bandRangeLabel, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { downloadEntityExport } from "@/lib/exportEntity";

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
  /** Mirrors ListModelsResponseItem.distanceUnit; defaults to "mi" (JADE's
   * only unit). */
  distanceUnit?: string;
  /** Optional — enables the Download CSV button (parity with the shared
   * AssignmentsTab's own button; A4's backend export branch serves the
   * matching product-level columns for this model). */
  scenarioId?: number;
  /** The saved-inputs snapshot that produced `result` — added-entity id ->
   * city/state/displayCode lookups. */
  displayedInputs?: JadeAssignmentsDisplayedInputs | null;
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
  distanceUnit = "mi",
  scenarioId,
  displayedInputs = null,
}: JadeAssignmentsTabProps) {
  const [page, setPage] = useState(1);

  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;

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
        accessor: r => bandRangeLabel(r.distance, effectiveBands, distanceUnit),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveBands.join(","), distanceUnit],
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
  }, [effectiveBands.join(","), distanceUnit]);

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
                <TableCell data-testid={`cell-jadeassignment-customer-${r.key}`}>{r.customerLabel}</TableCell>
                <TableCell data-testid={`cell-jadeassignment-warehouse-${r.key}`}>{r.warehouseLabel}</TableCell>
                <TableCell className="text-right font-mono" data-testid={`cell-jadeassignment-distance-${r.key}`}>
                  {r.distance.toFixed(1)} {distanceUnit}
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
