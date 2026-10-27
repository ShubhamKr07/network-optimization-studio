import { useMemo, useState, type ReactNode } from "react";
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
import { groupAssignmentsByCustomer } from "@/lib/groupAssignments";

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
  /** The snapshot-matched identity projection (`buildEntityIdentityById`). When it has
   * an entry for a cell's id the cell renders the shared stacked `EntityIdCell`
   * (City, ST + mono displayId) at any row count (DU-2.7, PR2-4); otherwise the
   * single-line label. */
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

interface JadeAssignmentLine {
  productId: string;
  productLabel: string;
  warehouseId: string;
  warehouseLabel: string;
  distance: number;
  bandIndex: number;
}

// DU-4.4 — one row per customer. `warehouseId` null = split across warehouses.
interface JadeAssignmentRow {
  key: string;
  customerId: string;
  customerLabel: string;
  warehouseId: string | null;
  warehouseLabel: string;
  warehouseCount: number;
  lines: JadeAssignmentLine[];
  /** The single warehouse's distance/band; null when split. */
  distance: number | null;
  bandIndex: number | null;
}

// Q10 — in-row disclosure (no injected sub-rows: DataTable sort/filter/paging stay row-per-customer).
function SplitDisclosure({ row, renderLine }: { row: JadeAssignmentRow; renderLine: (l: JadeAssignmentLine) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="inline-flex min-h-6 items-center rounded px-1 text-xs underline"
        aria-expanded={open}
        aria-controls={`jadeassignment-lines-${row.key}`}
        data-testid={`button-jadeassignment-split-${row.key}`}
        onClick={() => setOpen(o => !o)}
      >
        Split ({row.warehouseCount} warehouses)
      </button>
      <ul id={`jadeassignment-lines-${row.key}`} hidden={!open} className="mt-1 space-y-0.5 text-xs" data-testid={`list-jadeassignment-lines-${row.key}`}>
        {row.lines.map(l => (
          <li key={l.productId} data-testid={`line-jadeassignment-${row.key}-${l.productId}`}>
            {renderLine(l)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// DU-2.7 (PR2-4) — when `identityById` has an entry for this id, render the shared
// stacked cell (City, ST + mono displayId) at ANY row count; otherwise the
// pre-existing single-line string (no-identity fallback).
function renderJadeEntityCell(
  id: string,
  fallbackLabel: string,
  identityById: Record<string, EntityIdentity> | undefined,
) {
  const identity = identityById?.[id];
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
    const whLabel = (id: string) => warehouseLabel(id, dataset, displayedInputs?.addedWarehouses);
    return groupAssignmentsByCustomer(extractAssignments(result), id => productLabel(id, dataset)).map(g => {
      const lines: JadeAssignmentLine[] = g.lines.map(l => ({
        productId: l.productId,
        productLabel: productLabel(l.productId, dataset),
        warehouseId: l.warehouseId,
        warehouseLabel: whLabel(l.warehouseId),
        distance: l.distance,
        bandIndex: assignBandOrOverflow(l.distance, effectiveBands),
      }));
      return {
        key: g.customerId,
        customerId: g.customerId,
        customerLabel: customerLabel(g.customerId, dataset, displayedInputs?.addedCustomers),
        warehouseId: g.warehouseId,
        warehouseLabel: g.warehouseId === null ? "Split" : whLabel(g.warehouseId),
        warehouseCount: g.warehouseCount,
        lines,
        distance: g.warehouseId === null ? null : lines[0].distance,
        bandIndex: g.warehouseId === null ? null : lines[0].bandIndex,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, displayedInputs, bandsKey]);

  const columns = useMemo<ColumnDef<JadeAssignmentRow>[]>(() => {
    // `bandRangeLabel` takes display-unit boundaries; the band INDEX was assigned in canonical space.
    const displayBands = canonicalResolved ? effectiveBands.map(b => unit.toDisplay(b, distanceUnit)) : effectiveBands;
    return [
      {
        id: "customer",
        header: "Customer",
        kind: "text",
        filter: "text", // pinned: today's descriptor type
        cellTestId: r => `cell-jadeassignment-customer-${r.key}`,
        value: r => r.customerLabel,
        cell: r => renderJadeEntityCell(r.customerId, r.customerLabel, identityById),
      },
      {
        id: "warehouse",
        header: "Assigned Warehouse",
        filterLabel: "Warehouse",
        kind: "text",
        filter: "select", // pinned: today's descriptor type, even above 20 warehouses
        cellTestId: r => `cell-jadeassignment-warehouse-${r.key}`,
        value: r => r.warehouseLabel,
        cell: r =>
          r.warehouseId === null ? (
            <SplitDisclosure
              row={r}
              renderLine={l => (
                <>
                  {l.productLabel} → {l.warehouseLabel} ·{" "}
                  {canonicalResolved ? `${formatDistanceDisplay(unit.toDisplay(l.distance, distanceUnit))} ${resolvedUnitLabel}` : "—"} ·{" "}
                  {canonicalResolved ? <BandLabel index={l.bandIndex} bands={displayBands} unit={resolvedUnitLabel!} /> : "—"}
                </>
              )}
            />
          ) : (
            renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById)
          ),
      },
      { id: "products", header: "Products", kind: "number", cellTestId: r => `cell-jadeassignment-products-${r.key}`, value: r => r.lines.length, cell: r => r.lines.length },
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jadeassignment-distance-${r.key}`,
        // Filter range is in the DISPLAY unit — the number the student reads in the cell.
        value: r => (canonicalResolved && r.distance !== null ? unit.toDisplay(r.distance, distanceUnit) : null),
        filterResetKey: unit.pref,
        cell: r => (canonicalResolved && r.distance !== null ? `${formatDistanceDisplay(unit.toDisplay(r.distance, distanceUnit))} ${resolvedUnitLabel}` : "—"),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jadeassignment-band-${r.key}`,
        // DU-2.2 — filter value and cell both read the one range label (index assigned in canonical space).
        value: r => (canonicalResolved && r.bandIndex !== null ? bandRangeLabel(r.bandIndex, displayBands, resolvedUnitLabel!) : "—"),
        cell: r => (canonicalResolved && r.bandIndex !== null ? <BandLabel index={r.bandIndex} bands={displayBands} unit={resolvedUnitLabel!} /> : "—"),
        // Workspace fixups T7 item 5 — a bands/unit change clears ONLY this filter.
        filterResetKey: `${bandsKey}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandsKey, distanceUnit, unit.pref, identityById]);

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
