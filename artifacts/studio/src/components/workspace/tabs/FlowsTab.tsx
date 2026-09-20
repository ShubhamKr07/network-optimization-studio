import type { SolveResult } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";

interface FlowsTabProps {
  result: SolveResult | null;
  scenarioId: number;
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
        location={identity.city ? { city: identity.city, state: identity.state } : undefined}
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

export function FlowsTab({ result, scenarioId, locationById, identityById }: FlowsTabProps) {
  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="flows-empty">No solved result yet.</div>;
  }
  const rows = flowRows(result);
  // jade-T14 — JADE's plant->warehouse edges are per-product (one edge per
  // positive (plant,warehouse,product) flow), so `productId` is shown only
  // when at least one row actually carries it — additive, data-driven, never
  // gated on modelId. transport-coal/Ch10 rows have no `productId` at all, so
  // this column is absent for them exactly as before this task.
  const hasProduct = rows.some(r => r.productId != null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Flows</span>
        <button
          type="button"
          data-testid="button-download-flows-csv"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={() => downloadEntityExport(scenarioId, "flows", "csv")}
        >
          Download CSV
        </button>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr>
              <th className="text-left p-2">From</th>
              <th className="text-left p-2">To</th>
              {hasProduct && <th className="text-left p-2">Product</th>}
              <th className="text-right p-2">Distance (mi)</th>
              <th className="text-right p-2">Flow</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(e => {
              // Per-product plant->warehouse edges can share the same
              // (fromId,toId) pair across products — the productId must be
              // part of the row identity, not just an appended display
              // column, or two products' rows would collide on both `key`
              // and `data-testid`.
              const rowKey = e.productId != null ? `${e.fromId}-${e.toId}-${e.productId}` : `${e.fromId}-${e.toId}`;
              return (
                <tr key={rowKey} data-testid={`flow-row-${rowKey}`} className="border-b">
                  <td className="p-2">{resolveCell(e.fromId, locationById, identityById)}</td>
                  <td className="p-2">{resolveCell(e.toId, locationById, identityById)}</td>
                  {hasProduct && <td className="p-2">{e.productId ?? "—"}</td>}
                  <td className="p-2 text-right font-mono">{e.distance.toFixed(1)}</td>
                  <td className="p-2 text-right font-mono">{e.flow.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
