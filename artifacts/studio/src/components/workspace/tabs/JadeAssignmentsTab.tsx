import { useMemo } from "react";
import { formatDistanceDisplay } from "@/lib/formatDistanceDisplay";
import type { Dataset, SolveResult } from "@workspace/api-client-react";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import { assignBandOrOverflow, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { bandRangeLabel } from "@workspace/units";
import { BandLabel } from "@/components/BandLabel";
import { useExport } from "@/contexts/ExportContext";
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
  bandIndex: number;
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

// SCU-2.P3.3 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: the
// local PAGE_SIZE/Pager are replaced by the shell's (same literals); filter
// menu > 10 rows with today's descriptor keys/types; Download ▾ CSV/JSON.
// Behaviour change (spec B2.2): a filter change now returns to page 1 (today
// the page was only clamped).
export function JadeAssignmentsTab({
  result = null,
  dataset = null,
  bands = [],
  distanceUnit,
  scenarioId,
  displayedInputs = null,
  identityById,
}: JadeAssignmentsTabProps) {
  const unit = useDisplayUnit();
  const { download, disabledReasonFor } = useExport();
  const canonicalResolved = distanceUnit != null;
  const resolvedUnitLabel = canonicalResolved ? unit.effectiveUnit(distanceUnit) : null;
  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;
  const bandsKey = effectiveBands.join(",");

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
      bandIndex: assignBandOrOverflow(a.distanceMi, effectiveBands),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, displayedInputs, bandsKey]);

  // workspace-fixups-2 T10 — the `>10` identity upgrade reads the UNFILTERED count.
  const upgrade = rows.length > 10;

  const columns = useMemo<ColumnDef<JadeAssignmentRow>[]>(() => {
    // `bandRangeLabel` takes display-unit boundaries; the band INDEX was assigned in canonical space.
    const displayBands = canonicalResolved ? effectiveBands.map(b => unit.toDisplay(b, distanceUnit)) : effectiveBands;
    return [
      { id: "product", header: "Product", kind: "enum", cellTestId: r => `cell-jadeassignment-product-${r.key}`, value: r => r.productLabel, cell: r => r.productLabel },
      {
        id: "customer",
        header: "Customer",
        kind: "text",
        filter: "text", // pinned: today's descriptor type
        cellTestId: r => `cell-jadeassignment-customer-${r.key}`,
        value: r => r.customerLabel,
        cell: r => renderJadeEntityCell(r.customerId, r.customerLabel, identityById, upgrade),
      },
      {
        id: "warehouse",
        header: "Assigned Warehouse",
        filterLabel: "Warehouse",
        kind: "text",
        filter: "select", // pinned: today's descriptor type, even above 20 warehouses
        cellTestId: r => `cell-jadeassignment-warehouse-${r.key}`,
        value: r => r.warehouseLabel,
        cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, upgrade),
      },
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jadeassignment-distance-${r.key}`,
        // Filter range is in the DISPLAY unit — the number the student reads in the cell.
        value: r => (canonicalResolved ? unit.toDisplay(r.distance, distanceUnit) : null),
        filterResetKey: unit.pref,
        cell: r => (canonicalResolved ? `${formatDistanceDisplay(unit.toDisplay(r.distance, distanceUnit))} ${resolvedUnitLabel}` : "—"),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jadeassignment-band-${r.key}`,
        // DU-2.2 — filter value and cell both read the one range label (index assigned in canonical space).
        value: r => (canonicalResolved ? bandRangeLabel(r.bandIndex, displayBands, resolvedUnitLabel!) : "—"),
        cell: r => (canonicalResolved ? <BandLabel index={r.bandIndex} bands={displayBands} unit={resolvedUnitLabel!} /> : "—"),
        // Workspace fixups T7 item 5 — a bands/unit change clears ONLY this filter.
        filterResetKey: `${bandsKey}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandsKey, distanceUnit, unit.pref, identityById, upgrade]);

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="jade-assignments-empty">
        No solved result yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-assignments-tab">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<JadeAssignmentRow>
          rows={rows}
          rowKey={r => r.key}
          columns={columns}
          testIds={{
            row: r => `row-jadeassignment-${r.key}`,
            count: "text-jadeassignments-count",
            pagerPrev: "button-jadeassignments-prev",
            pagerNext: "button-jadeassignments-next",
            pageIndicator: "jadeassignments-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-jadeassignments"
                itemTestIds={{ csv: "button-download-jadeassignments-csv", json: "button-download-jadeassignments-json", xlsx: "button-download-jadeassignments-xlsx" }}
                onDownload={format => download("assignments", format)}
                disabledReason={disabledReasonFor("assignments")}
              />
            ),
            // SCU-2.P3 (user decision 2026-10-17) — output tables keep Download on the right (B1.4).
            downloadAlign: "right",
          }}
        />
      </div>
    </div>
  );
}
