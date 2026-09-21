import { useEffect, useMemo, useState } from "react";
import type { Dataset, Edge, Plant, SolveResult } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { bandLabel, bandRangeLabel, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { formatCityState, plantIdCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";

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
        location={identity.city ? { city: identity.city, state: identity.state } : undefined}
      />
    );
  }
  return fallbackLabel;
}

// Minimal client-side CSV writer — deliberately local, not a shared
// dependency. This is a client-side-only export of the ON-SCREEN columns for
// one leg, distinct from the server-backed combined `entity=flows` export
// (`downloadEntityExport`) the backend serves for both legs at once (spec
// §5c/OQ-2 — the two are independent by design).
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadClientCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const text = [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const pwDescriptors: ColumnFilterDescriptor<PlantWarehouseRow>[] = useMemo(
    () => [
      { key: "plant", label: "Plant", type: "select", accessor: r => r.plantLabel },
      { key: "warehouse", label: "Warehouse", type: "select", accessor: r => r.warehouseLabel },
      { key: "distance", label: "Distance", type: "number", accessor: r => r.distance },
      { key: "flow", label: "Flow", type: "number", accessor: r => r.flow },
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

  const wcDescriptors: ColumnFilterDescriptor<WarehouseCustomerRow>[] = useMemo(
    () => [
      { key: "warehouse", label: "Warehouse", type: "select", accessor: r => r.warehouseLabel },
      { key: "customer", label: "Customer", type: "text", accessor: r => r.customerLabel },
      { key: "distance", label: "Distance", type: "number", accessor: r => r.distance },
      { key: "flow", label: "Flows", type: "number", accessor: r => r.flow },
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

  // Both hooks are called unconditionally regardless of which inner tab is
  // active (Rules of Hooks) — only the active tab's table + FilterMenu are
  // rendered below.
  const pwFilters = useTableFilters(pwRows, pwDescriptors);
  const wcFilters = useTableFilters(wcRows, wcDescriptors);

  // Workspace fixups bundle (T6, item 5) — stale-selection policy: when the
  // band boundaries/unit change, an active "band" selection (e.g. "≤ 250 mi")
  // may no longer match any of the freshly-recomputed range options (the
  // FilterMenu derives its select options from `pwDescriptors`/`wcDescriptors`
  // above, which just changed too) — clear ONLY that table's own "band" key,
  // leaving every other active filter on that table intact. Each inner
  // table's clear is independent of the other (separate effects, separate
  // `useTableFilters` instances) — selecting a range on Plant -> Warehouse and
  // then editing bands must not touch Warehouse -> Customer's filters, and
  // vice versa. `setFilter` is a stable `useCallback` (empty deps in
  // `useTableFilters`), so it's intentionally omitted from these deps.
  useEffect(() => {
    pwFilters.setFilter("band", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBands.join(","), distanceUnit, unit.pref]);

  useEffect(() => {
    wcFilters.setFilter("band", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBands.join(","), distanceUnit, unit.pref]);

  function handleDownloadPw() {
    downloadClientCsv(
      "plant-to-warehouse-flows.csv",
      ["Plant", "Warehouse", "Distance", "Flow", "Distance Band"],
      pwRows.map(r => [r.plantLabel, r.warehouseLabel, formatRowDistance(r.distance), r.flow, r.band]),
    );
  }

  function handleDownloadWc() {
    downloadClientCsv(
      "warehouse-to-customer-flows.csv",
      ["Warehouse", "Customer", "Distance", "Flows", "Distance Band"],
      wcRows.map(r => [r.warehouseLabel, r.customerLabel, formatRowDistance(r.distance), r.flow, r.band]),
    );
  }

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
          <span className="text-sm font-medium">Flows</span>
          {segmentedControl}
        </div>
        {innerTab === "plant-warehouse" ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" data-testid="text-jadeflows-pw-count">
              {pwFilters.filteredCount} of {pwFilters.totalCount}
            </span>
            {pwFilters.totalCount > 10 && <FilterMenu descriptors={pwDescriptors} tableFilters={pwFilters} />}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid="button-download-jade-flows-pw-csv"
              onClick={handleDownloadPw}
            >
              Download CSV
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" data-testid="text-jadeflows-wc-count">
              {wcFilters.filteredCount} of {wcFilters.totalCount}
            </span>
            {wcFilters.totalCount > 10 && <FilterMenu descriptors={wcDescriptors} tableFilters={wcFilters} />}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid="button-download-jade-flows-wc-csv"
              onClick={handleDownloadWc}
            >
              Download CSV
            </Button>
          </div>
        )}
      </div>

      {innerTab === "plant-warehouse" ? (
        <div className="overflow-auto flex-1" data-testid="jade-flows-pw-table">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Plant</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-right">Flow</TableHead>
                <TableHead>Distance Band</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pwFilters.filteredRows.map(r => (
                <TableRow key={r.key} data-testid={`jade-flow-pw-row-${r.plantId}-${r.warehouseId}`}>
                  <TableCell data-testid={`cell-jade-flow-pw-plant-${r.key}`}>
                    {renderJadeEntityCell(r.plantId, r.plantLabel, identityById, pwRows.length > 10)}
                  </TableCell>
                  <TableCell data-testid={`cell-jade-flow-pw-warehouse-${r.key}`}>
                    {renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, pwRows.length > 10)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`cell-jade-flow-pw-distance-${r.key}`}>
                    {formatRowDistance(r.distance)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`cell-jade-flow-pw-flow-${r.key}`}>
                    {r.flow.toLocaleString()}
                  </TableCell>
                  <TableCell data-testid={`cell-jade-flow-pw-band-${r.key}`}>{r.band}</TableCell>
                </TableRow>
              ))}
              {pwFilters.filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-3">
                    No rows match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="overflow-auto flex-1" data-testid="jade-flows-wc-table">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Warehouse</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-right">Flows</TableHead>
                <TableHead>Distance Band</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wcFilters.filteredRows.map(r => (
                <TableRow key={r.key} data-testid={`jade-flow-wc-row-${r.warehouseId}-${r.customerId}`}>
                  <TableCell data-testid={`cell-jade-flow-wc-warehouse-${r.key}`}>
                    {renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, wcRows.length > 10)}
                  </TableCell>
                  <TableCell data-testid={`cell-jade-flow-wc-customer-${r.key}`}>
                    {renderJadeEntityCell(r.customerId, r.customerLabel, identityById, wcRows.length > 10)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`cell-jade-flow-wc-distance-${r.key}`}>
                    {formatRowDistance(r.distance)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`cell-jade-flow-wc-flow-${r.key}`}>
                    {r.flow.toLocaleString()}
                  </TableCell>
                  <TableCell data-testid={`cell-jade-flow-wc-band-${r.key}`}>{r.band}</TableCell>
                </TableRow>
              ))}
              {wcFilters.filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-3">
                    No rows match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
