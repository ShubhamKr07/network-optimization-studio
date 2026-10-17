import { useMemo } from "react";
import type { Edge, SolveResult } from "@workspace/api-client-react";
import { useExport } from "@/contexts/ExportContext";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { entityFilterText } from "@/lib/formatLocation";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";

interface FlowsTabProps {
  result: SolveResult | null;
  scenarioId: number;
  /** chen-bands-units, Part D — the active model's CANONICAL distance unit
   * (manifest ModelInfo.distanceUnit). This table previously hardcoded the
   * Distance column header with a bare mi suffix unconditionally —
   * `undefined`/`null` (the caller hasn't threaded a resolved unit through
   * yet) renders a loading placeholder instead, never a guessed unit. */
  distanceUnit?: CanonicalUnit | null;
  /** JADE-only — id -> {city, state} (base dataset ∪ added entities), built
   * by Workspace.tsx's `jadeLocationMapFromInputs`. When present, both the
   * From and To cells show "City, ST" as the primary label with the raw id
   * as a mono sub-label (mirrors JadeDistancesTab.tsx). Absent for every
   * other model (undefined) -> unchanged id-only rendering. */
  locationById?: Record<string, { city: string; state: string }>;
  /** workspace-fixups-2, T10 (item 2) — the snapshot-matched identity
   * projection (`buildEntityIdentityById`, T3), covering BOTH base dataset
   * rows AND scenario-added rows (any entity family, e.g. added customers,
   * which `locationById` may or may not cover depending on the caller) keyed
   * by canonical id. Takes PRECEDENCE over `locationById` when an entry
   * exists (the compatibility resolver — see `resolveCell`). Optional/
   * `undefined` for every pre-existing call site until INT wires it, so this
   * component's output is byte-unchanged for any caller that never passes
   * it. Already a "rich" table (shows both id and location whenever
   * `locationById` has an entry, at any row count) — no `>10` gate applied. */
  identityById?: Record<string, EntityIdentity>;
}

// JADE-only "City, ST" primary + id mono sub-label, mirroring
// JadeDistancesTab.tsx's From/To cell. Falls back to the raw id (unchanged)
// when `locationById` is absent or has no entry for this id. Left UNTOUCHED
// by workspace-fixups-2/T10 — `resolveCell` below delegates here as the
// no-regression fallback when `identityById` has no entry.
function idCell(id: string, locationById: Record<string, { city: string; state: string }> | undefined) {
  const loc = locationById?.[id];
  if (!loc) return id;
  return (
    <div className="flex flex-col">
      <span>{loc.city}, {loc.state}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{id}</span>
    </div>
  );
}

// workspace-fixups-2, T10 (item 2) — compatibility resolver: prefer the new
// `identityById` entry (which also supplies a real `displayId` for an added
// entity, unlike the raw id `idCell` always shows); else delegate to the
// pre-existing, UNTOUCHED `idCell` function so `identityById` unset renders
// byte-identical output to before this task.
function resolveCell(
  id: string,
  locationById: Record<string, { city: string; state: string }> | undefined,
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
  return idCell(id, locationById);
}

// C6.1 — the transport-coal/two-echelon equivalent of Customer Assignments.
// Mirrors templates.ts's buildFlowRows filter exactly (exclude
// facility->demand edges — those belong to AssignmentsTab) so the
// on-screen table and the CSV export never disagree.
//
// jade-T14 — semantic-leg classification, extended for Chapter 9 JADE's
// `warehouse_to_customer` leg alongside Ch10's `refinery_to_customer`
// (previously this only excluded the Ch10 string, which would have silently
// let JADE's warehouse_to_customer edges leak into Flows too). Single-
// echelon models (no `leg` field at all) are unaffected — `e.leg` is
// undefined for them, which is never in this set.
const FACILITY_TO_DEMAND_LEGS = new Set<string>(["refinery_to_customer", "warehouse_to_customer"]);

function flowRows(result: SolveResult) {
  return result.edges.filter(e => !(e.leg != null && FACILITY_TO_DEMAND_LEGS.has(e.leg)));
}

// Per-product plant->warehouse edges can share the same (fromId,toId) pair
// across products — the productId must be part of the row identity, or two
// products' rows would collide on both `key` and `data-testid`.
function flowRowKey(e: Edge): string {
  return e.productId != null ? `${e.fromId}-${e.toId}-${e.productId}` : `${e.fromId}-${e.toId}`;
}

// SCU-2.P3.4 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: filter
// menu > 10 rows, pager > 50, number columns centred, Download ▾ CSV/JSON
// (server `flows`).
export function FlowsTab({ result, scenarioId, locationById, identityById, distanceUnit }: FlowsTabProps) {
  const unit = useDisplayUnit();
  const { download, disabledReasonFor } = useExport();
  const canonicalResolved = distanceUnit != null;
  const distanceHeaderLabel = canonicalResolved ? `Distance (${unit.effectiveUnit(distanceUnit)})` : "Distance";
  const rows = useMemo(() => (result ? flowRows(result) : []), [result]);
  // jade-T14 — Product column only when at least one row carries a productId
  // (data-driven, never gated on modelId).
  const hasProduct = rows.some(r => r.productId != null);

  const columns = useMemo<ColumnDef<Edge>[]>(() => {
    const cols: ColumnDef<Edge>[] = [
      { id: "from", header: "From", kind: "text", value: e => entityFilterText(e.fromId, e.fromId, locationById, identityById), cell: e => resolveCell(e.fromId, locationById, identityById) },
      { id: "to", header: "To", kind: "text", value: e => entityFilterText(e.toId, e.toId, locationById, identityById), cell: e => resolveCell(e.toId, locationById, identityById) },
    ];
    if (hasProduct) cols.push({ id: "product", header: "Product", kind: "enum", value: e => e.productId ?? null, cell: e => e.productId ?? "—" });
    cols.push(
      {
        id: "distance",
        header: distanceHeaderLabel,
        kind: "number",
        cellClassName: "font-mono",
        value: e => (canonicalResolved ? unit.toDisplay(e.distance, distanceUnit) : null),
        filterResetKey: unit.pref,
        cell: e => (canonicalResolved ? unit.toDisplay(e.distance, distanceUnit).toFixed(1) : "—"),
      },
      { id: "flow", header: "Flow", kind: "number", cellClassName: "font-mono", value: e => e.flow, cell: e => e.flow.toLocaleString() },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationById, identityById, hasProduct, distanceHeaderLabel, canonicalResolved, distanceUnit, unit.pref]);

  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="flows-empty">No solved result yet.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<Edge>
          rows={rows}
          rowKey={flowRowKey}
          columns={columns}
          testIds={{
            row: e => `flow-row-${flowRowKey(e)}`,
            pager: "flows-pager",
            pagerPrev: "button-flows-prev",
            pagerNext: "button-flows-next",
            pageIndicator: "flows-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-flows"
                itemTestIds={{ csv: "button-download-flows-csv", json: "button-download-flows-json" }}
                onDownload={format => download("flows", format)}
                disabledReason={disabledReasonFor("flows")}
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
