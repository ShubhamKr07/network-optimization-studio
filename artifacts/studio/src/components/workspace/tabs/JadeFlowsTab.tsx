import { useMemo, useState } from "react";
import type { Dataset, Edge, Plant, SolveResult } from "@workspace/api-client-react";
import { bandLabel, bandRangeLabel, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { formatCityState, plantIdCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
import { useExport } from "@/contexts/ExportContext";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import {
  downloadJadeFlows,
  PLANT_WAREHOUSE_LEG,
  WAREHOUSE_CUSTOMER_LEG,
  type JadeFlowLeg,
  type JadeFlowScreenRow,
} from "@/lib/jadeFlowsExport";

// B3 (JADE Ch.9 Workspace Bundle, spec §5b) — Chapter 9 JADE's Flows tab.
// JADE has TWO distinct facility->facility legs (plant_to_warehouse inbound,
// warehouse_to_customer outbound), each with different row semantics that
// don't share one flat table the way the shared `FlowsTab.tsx` does for
// transport-coal/two-echelon-gold-au (which each have exactly one such leg).
// New JADE-only component — mirrors `JadeAssignmentsTab.tsx`'s precedent
// (own component, shared `FlowsTab.tsx` left byte-identical for every other
// model, spec §5's explicit "no regression to shared tabs" instruction).
//
// Two inner tabs (segmented control), each its own physical table:
//   - Plant -> Warehouse: inbound edges are one row per positive
//     (plant, warehouse, product) flow at the envelope layer — this table
//     SUMS `flow` across `productId` per (fromId, toId) pair (unlike the
//     shared FlowsTab's per-product rows). No Product/Transport Cost
//     columns.
//   - Warehouse -> Customer: outbound edges, already one row per customer at
//     the envelope layer (single-source). Column header for the flow value
//     is EXACTLY "Flows" (plural — distinguishes it from the singular "Flow"
//     column on the Plant -> Warehouse side).
//
// All props are optional with safe defaults so this component typechecks
// and renders standalone before Workspace.tsx (INT) wires real values.

interface PlantWarehouseRow {
  key: string;
  plantId: string;
  warehouseId: string;
  plantLabel: string;
  warehouseLabel: string;
  distance: number;
  flow: number;
  band: string;
}

interface WarehouseCustomerRow {
  key: string;
  warehouseId: string;
  customerId: string;
  warehouseLabel: string;
  customerLabel: string;
  distance: number;
  flow: number;
  band: string;
}

type InnerTab = "plant-warehouse" | "warehouse-customer";

interface JadeFlowsTabProps {
  /** Optional (safe default `null`) so this component compiles/renders
   * standalone before INT wires the real solved result. */
  result?: SolveResult | null;
  /** Optional — base dataset (plants/warehouses/customers id->name/city/state
   * lookups). Absent renders raw ids. */
  dataset?: Dataset | null;
  /** Workspace fixups bundle (T6, item 2) — optional effective-plants lookup
   * for the P->W Plant column (`dataset.plants ∪ addedPlantsFromInputs(SOLVED
   * snapshot)`, wired by INT). Defaults to `undefined`, which falls back to
   * `dataset?.plants` — so this component still typechecks/renders standalone
   * and behaves unchanged for base-only plants before INT wires the real
   * union. */
  effectivePlants?: Plant[];
  /** Live `distanceBands` (spec §2's "presentation-band" lens — the SAME
   * live array the map/legend read, so this column's labels always agree
   * with the map's colors). Falls back to the shared `DEFAULT_DISTANCE_BANDS`
   * display fallback (mirrors `OutputMapTab.tsx`/`JadeAssignmentsTab.tsx`'s
   * own `effectiveBands` pattern) when empty/absent. */
  bands?: number[];
  /** Mirrors ListModelsResponseItem.distanceUnit (JADE's own canonical unit
   * is always "mi", but this is still threaded rather than defaulted — Part
   * D's toggle applies here too, and `undefined`/`null` means the manifest
   * hasn't resolved yet, in which case every distance-bearing cell/filter
   * option/CSV export shows a loading placeholder instead of a guessed
   * unit). */
  distanceUnit?: CanonicalUnit | null;
  /** Optional — reserved for a future server-backed export affordance on
   * this tab (parity with every other Jade output tab's props contract).
   * The per-leg CSVs below are client-side only and need no scenario
   * round-trip (spec §5c/OQ-2), so this is currently unused inside the
   * component. */
  scenarioId?: number;
  /** workspace-fixups-2, T10 (item 2) — the snapshot-matched identity
   * projection (`buildEntityIdentityById`, T3). Both inner tables already
   * resolve a single-line "City, ST" label per cell via `warehouseLabel`/
   * `customerLabel`/`resolvePlantLabel` below (never showing the id/
   * displayCode alongside it) — when `identityById` has an entry for a
   * cell's id AND that inner table's OWN unfiltered row count exceeds 10
   * (the item-2 `>10` upgrade rule, applied independently per inner table),
   * the cell upgrades to the shared stacked `EntityIdCell`. Below the
   * threshold, or when `identityById`/the entry is absent, the cell keeps
   * its pre-existing single-line string — `identityById` unset is
   * byte-unchanged from before this task at any row count. */
  identityById?: Record<string, EntityIdentity>;
}

function displayLabel(row: { name?: string; city?: string; state?: string } | undefined, id: string): string {
  if (!row) return id;
  if (row.name) return row.name;
  if (row.city) return formatCityState(row.city, row.state ?? "");
  return id;
}

// Workspace fixups bundle (T6, item 2) — resolves the P->W Plant column via
// the shared `plantIdCityState` helper ("<id> — City, State", `name` never
// shown) against the effective-plants list (`effectivePlants ?? dataset?.plants
// ?? []`, wired by the caller). Falls back to the raw id when the plant isn't
// found in that list at all (unresolved edge, matches every other id-fallback
// in this file).
function resolvePlantLabel(id: string, plants: Plant[]): string {
  const plant = plants.find(p => p.id === id);
  return plant ? plantIdCityState(plant) : id;
}

function warehouseLabel(id: string, dataset: Dataset | null | undefined): string {
  return displayLabel(dataset?.warehouses?.find(w => w.id === id), id);
}

function customerLabel(id: string, dataset: Dataset | null | undefined): string {
  return displayLabel(dataset?.customers?.find(c => c.id === id), id);
}

// Sums `flow` across `productId` per (fromId, toId) pair. Distance is
// identical across products for the same pair (same physical lane), so the
// first-seen edge's distance is kept.
function aggregatePlantToWarehouse(edges: Edge[]): { plantId: string; warehouseId: string; distance: number; flow: number }[] {
  const byPair = new Map<string, { plantId: string; warehouseId: string; distance: number; flow: number }>();
  for (const e of edges) {
    if (e.leg !== "plant_to_warehouse") continue;
    const key = `${e.fromId}|${e.toId}`;
    const existing = byPair.get(key);
    if (existing) {
      existing.flow += e.flow;
    } else {
      byPair.set(key, { plantId: e.fromId, warehouseId: e.toId, distance: e.distance, flow: e.flow });
    }
  }
  return [...byPair.values()];
}

// Already one row per customer at the envelope layer (single-source) — no
// aggregation needed, unlike the inbound leg.
function warehouseToCustomerEdges(edges: Edge[]): { warehouseId: string; customerId: string; distance: number; flow: number }[] {
  return edges
    .filter(e => e.leg === "warehouse_to_customer")
    .map(e => ({ warehouseId: e.fromId, customerId: e.toId, distance: e.distance, flow: e.flow }));
}

// workspace-fixups-2, T10 (item 2) — the `>10` upgrade, applied
// independently per inner table (the caller passes each table's own
// unfiltered row count as `upgrade`). When true AND `identityById` has an
// entry for this id, render the shared stacked cell; otherwise render the
// pre-existing single-line string UNCHANGED (the no-regression fallback).
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

export function JadeFlowsTab({
  result = null,
  dataset = null,
  bands = [],
  distanceUnit,
  effectivePlants,
  identityById,
}: JadeFlowsTabProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>("plant-warehouse");
  const unit = useDisplayUnit();
  const canonicalResolved = distanceUnit != null;
  const resolvedUnitLabel = canonicalResolved ? unit.effectiveUnit(distanceUnit) : null;

  // SCU-2.P3.5 — client-built downloads use the SAME guard as every server
  // export (history entry without a run, unit loading), plus this table's own
  // canonical-unit resolution.
  const { disabledReasonFor } = useExport();
  const downloadDisabledReason = disabledReasonFor("flows") ?? (canonicalResolved ? undefined : "Loading…");
  const downloadLeg = (leg: JadeFlowLeg, format: "csv" | "json", screenRows: JadeFlowScreenRow[]) =>
    downloadJadeFlows(leg, format, screenRows, d => unit.toDisplay(d, distanceUnit!), resolvedUnitLabel!);
  const formatRowDistance = (raw: number): string =>
    canonicalResolved ? `${unit.toDisplay(raw, distanceUnit).toFixed(1)} ${resolvedUnitLabel}` : "—";

  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;
  const displayBands = canonicalResolved ? effectiveBands.map(b => unit.toDisplay(b, distanceUnit)) : effectiveBands;

  // Workspace fixups bundle (T6, item 2) — the plant list used to resolve
  // the P->W Plant column. A signature over id+city+state (not just id) is
  // used as the `pwRows` memo dep below so a plant KEEPING its id but
  // gaining a changed City/State (e.g. stepping the result-history stepper
  // to a different solved snapshot) still refreshes the label — an id-only
  // signature would miss that.
  const plants = effectivePlants ?? dataset?.plants ?? [];
  const plantsSignature = plants.map(p => `${p.id}|${p.city}|${p.state}`).join(";");

  const pwRows: PlantWarehouseRow[] = useMemo(() => {
    if (!result) return [];
    return aggregatePlantToWarehouse(result.edges).map(r => ({
      key: `${r.plantId}|${r.warehouseId}`,
      plantId: r.plantId,
      warehouseId: r.warehouseId,
      plantLabel: resolvePlantLabel(r.plantId, plants),
      warehouseLabel: warehouseLabel(r.warehouseId, dataset),
      distance: r.distance,
      flow: r.flow,
      band: bandLabel(r.distance, effectiveBands),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, effectiveBands.join(","), plantsSignature]);

  const wcRows: WarehouseCustomerRow[] = useMemo(() => {
    if (!result) return [];
    return warehouseToCustomerEdges(result.edges).map(r => ({
      key: `${r.warehouseId}|${r.customerId}`,
      warehouseId: r.warehouseId,
      customerId: r.customerId,
      warehouseLabel: warehouseLabel(r.warehouseId, dataset),
      customerLabel: customerLabel(r.customerId, dataset),
      distance: r.distance,
      flow: r.flow,
      band: bandLabel(r.distance, effectiveBands),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, effectiveBands.join(",")]);

  // Workspace fixups bundle (T6, item 5) — the `band` descriptor's accessor
  // computes a unit-aware RANGE label (e.g. "≤ 250 mi") for filtering,
  // distinct from the table CELL which still reads the row's own
  // `bandLabel`-derived "Band N"/"Overflow" (unchanged above). The descriptor
  // is a closure over `effectiveBands`/`distanceUnit`, so those must be in
  // this useMemo's deps (an empty dep array would freeze the range options at
  // their first-render values and never update when bands/unit change).
  // SCU-2.P3.5 (spec B2.1/B2.2) — Plant -> Warehouse is a DataTable. Column
  // ids are today's descriptor keys (e2e selects filters by key); the `band`
  // FILTER value is the unit-aware range label while the CELL keeps the row's
  // "Band N"/"Overflow"; `filterResetKey` clears ONLY that filter when the
  // bands or the unit change (Workspace fixups T6 item 5).
  const pwUpgrade = pwRows.length > 10;
  const pwColumns = useMemo<ColumnDef<PlantWarehouseRow>[]>(
    () => [
      {
        id: "plant",
        header: "Plant",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-pw-plant-${r.key}`,
        value: r => r.plantLabel,
        cell: r => renderJadeEntityCell(r.plantId, r.plantLabel, identityById, pwUpgrade),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-pw-warehouse-${r.key}`,
        value: r => r.warehouseLabel,
        cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, pwUpgrade),
      },
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-pw-distance-${r.key}`,
        value: r => r.distance,
        cell: r => formatRowDistance(r.distance),
      },
      {
        id: "flow",
        header: "Flow",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-pw-flow-${r.key}`,
        value: r => r.flow,
        cell: r => r.flow.toLocaleString(),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-pw-band-${r.key}`,
        value: r =>
          canonicalResolved
            ? bandRangeLabel(unit.toDisplay(r.distance, distanceUnit), displayBands, resolvedUnitLabel!)
            : "—",
        cell: r => r.band,
        filterResetKey: `${effectiveBands.join(",")}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveBands.join(","), distanceUnit, unit.pref, identityById, pwUpgrade],
  );

  // SCU-2.P3.6 — Warehouse -> Customer is a DataTable, built like P->W above
  // (today's descriptor keys/labels: "Flows" for flow; band range filter with
  // its own filterResetKey, cleared independently of P->W's).
  const wcUpgrade = wcRows.length > 10;
  const wcColumns = useMemo<ColumnDef<WarehouseCustomerRow>[]>(
    () => [
      {
        id: "warehouse",
        header: "Warehouse",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-wc-warehouse-${r.key}`,
        value: r => r.warehouseLabel,
        cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, wcUpgrade),
      },
      {
        id: "customer",
        header: "Customer",
        kind: "text",
        filter: "text", // pinned: today's descriptor type
        cellTestId: r => `cell-jade-flow-wc-customer-${r.key}`,
        value: r => r.customerLabel,
        cell: r => renderJadeEntityCell(r.customerId, r.customerLabel, identityById, wcUpgrade),
      },
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-wc-distance-${r.key}`,
        value: r => r.distance,
        cell: r => formatRowDistance(r.distance),
      },
      {
        id: "flow",
        header: "Flows",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-wc-flow-${r.key}`,
        value: r => r.flow,
        cell: r => r.flow.toLocaleString(),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-wc-band-${r.key}`,
        value: r =>
          canonicalResolved
            ? bandRangeLabel(unit.toDisplay(r.distance, distanceUnit), displayBands, resolvedUnitLabel!)
            : "—",
        cell: r => r.band,
        filterResetKey: `${effectiveBands.join(",")}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveBands.join(","), distanceUnit, unit.pref, identityById, wcUpgrade],
  );

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="jade-flows-empty">
        No solved result yet.
      </div>
    );
  }

  const segmentedControl = (
    <div
      className="inline-flex rounded border border-border overflow-hidden"
      role="group"
      aria-label="Flows leg"
      data-testid="jade-flows-inner-tabs"
    >
      <button
        type="button"
        data-testid="button-jade-flows-inner-plant-warehouse"
        aria-pressed={innerTab === "plant-warehouse"}
        onClick={() => setInnerTab("plant-warehouse")}
        className={`text-xs px-3 py-1 transition-colors ${
          innerTab === "plant-warehouse" ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted"
        }`}
      >
        Plant → Warehouse
      </button>
      <button
        type="button"
        data-testid="button-jade-flows-inner-warehouse-customer"
        aria-pressed={innerTab === "warehouse-customer"}
        onClick={() => setInnerTab("warehouse-customer")}
        className={`text-xs px-3 py-1 transition-colors ${
          innerTab === "warehouse-customer" ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted"
        }`}
      >
        Warehouse → Customer
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-flows-tab">
      <div className="flex items-center justify-between gap-2 p-2 border-b flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          {segmentedControl}
        </div>
      </div>

      {/* SCU-2.P3.5 — Plant -> Warehouse stays MOUNTED while the other leg is
          shown (hidden), so its filter state survives a leg switch exactly as
          today's parent-held filter hooks did; hence its own trigger testid. */}
      <div className="overflow-auto flex-1 p-2" hidden={innerTab !== "plant-warehouse"}>
        <DataTable<PlantWarehouseRow>
            rows={pwRows}
            rowKey={r => r.key}
            columns={pwColumns}
            ctx={{ readOnly: true, demandEditable: false }}
            testIds={{
              root: "jade-flows-pw-table",
              row: r => `jade-flow-pw-row-${r.plantId}-${r.warehouseId}`,
              count: "text-jadeflows-pw-count",
              pagerPrev: "button-jade-flows-pw-prev",
              pagerNext: "button-jade-flows-pw-next",
              pageIndicator: "jade-flows-pw-page-indicator",
              filterTrigger: "button-filter-jade-flows-pw",
            }}
            toolbar={{
              download: (
                <DownloadMenu
                  testId="button-download-jade-flows-pw"
                  itemTestIds={{ csv: "button-download-jade-flows-pw-csv", json: "button-download-jade-flows-pw-json" }}
                  disabledReason={downloadDisabledReason}
                  onDownload={format =>
                    downloadLeg(
                      PLANT_WAREHOUSE_LEG,
                      format,
                      pwRows.map(r => ({ fromLabel: r.plantLabel, toLabel: r.warehouseLabel, distance: r.distance, flow: r.flow, band: r.band })),
                    )
                  }
                />
              ),
              downloadAlign: "right",
            }}
          />
      </div>
      {/* SCU-2.P3.6 — mounted alongside P->W (hidden when inactive) so each
          leg keeps its own filters across a leg switch. */}
      <div className="overflow-auto flex-1 p-2" hidden={innerTab !== "warehouse-customer"}>
        <DataTable<WarehouseCustomerRow>
          rows={wcRows}
          rowKey={r => r.key}
          columns={wcColumns}
          ctx={{ readOnly: true, demandEditable: false }}
          testIds={{
            root: "jade-flows-wc-table",
            row: r => `jade-flow-wc-row-${r.warehouseId}-${r.customerId}`,
            count: "text-jadeflows-wc-count",
            pagerPrev: "button-jade-flows-wc-prev",
            pagerNext: "button-jade-flows-wc-next",
            pageIndicator: "jade-flows-wc-page-indicator",
            filterTrigger: "button-filter-jade-flows-wc",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-jade-flows-wc"
                itemTestIds={{ csv: "button-download-jade-flows-wc-csv", json: "button-download-jade-flows-wc-json" }}
                disabledReason={downloadDisabledReason}
                onDownload={format =>
                  downloadLeg(
                    WAREHOUSE_CUSTOMER_LEG,
                    format,
                    wcRows.map(r => ({ fromLabel: r.warehouseLabel, toLabel: r.customerLabel, distance: r.distance, flow: r.flow, band: r.band })),
                  )
                }
              />
            ),
            downloadAlign: "right",
          }}
        />
      </div>
    </div>
  );
}
