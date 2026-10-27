import { useMemo, useState } from "react";
import { formatDistanceDisplay } from "@/lib/formatDistanceDisplay";
import type { Dataset, Edge, Plant, SolveResult } from "@workspace/api-client-react";
import { assignBandOrOverflow, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { bandRangeLabelForDistance } from "@workspace/units";
import { bandsForLeg } from "@workspace/units";
import { bandRangeLabel } from "@workspace/units";
import { BandLabel } from "@/components/BandLabel";
import { formatCityState, plantIdCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
import { useExport } from "@/contexts/ExportContext";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu, type DownloadFormat } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import { downloadAs } from "@/lib/clientCsv";
import { toast } from "@/hooks/use-toast";
import { describeWriteError } from "@/lib/describeWriteError";
import {
  jadeFlowsCsv,
  jadeFlowsJson,
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
  bandIndex: number;
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
  bandIndex: number;
}

interface LegRow {
  key: string;
  distance: number;
  flow: number;
  band: string;
  bandIndex: number;
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
  /** DU-4.1 — the inbound-lane lens; Plant→Warehouse classifies against it.
   * Absent/empty = the customer-facing `bands`. */
  inboundBands?: number[];
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
  /** The snapshot-matched identity projection (`buildEntityIdentityById`). When it has
   * an entry for a cell's id the cell renders the shared stacked `EntityIdCell`
   * (City, ST + mono displayId) at any row count (DU-2.7, PR2-4); otherwise the
   * single-line label. */
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

export function JadeFlowsTab({
  result = null,
  dataset = null,
  bands = [],
  inboundBands,
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
  const downloadLeg = (leg: JadeFlowLeg, format: DownloadFormat, screenRows: JadeFlowScreenRow[]) => {
      const toDisplay = (d: number) => unit.toDisplay(d, distanceUnit!);
      void downloadAs(
        leg.fileBase,
        format,
        format === "json" ? jadeFlowsJson(leg, screenRows, toDisplay, resolvedUnitLabel!) : jadeFlowsCsv(leg, screenRows, toDisplay, resolvedUnitLabel!),
      ).catch(err =>
          toast({ title: "Export failed", description: describeWriteError(err, "Could not export the table."), variant: "destructive" }),
      );
  };
  const formatRowDistance = (raw: number): string =>
    canonicalResolved ? `${formatDistanceDisplay(unit.toDisplay(raw, distanceUnit))} ${resolvedUnitLabel}` : "—";

  // DU-4.2 — the client export `band` uses the same units the Distance column does.
  // Unresolved unit: no label (Download is disabled then, see downloadDisabledReason).
  const bandText = (d: number, set: number[]): string =>
    distanceUnit != null && resolvedUnitLabel != null ? bandRangeLabelForDistance(d, set, distanceUnit, resolvedUnitLabel) : "";
  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;
  const bandsKey = effectiveBands.join(",");
  const displayBands = canonicalResolved ? effectiveBands.map(b => unit.toDisplay(b, distanceUnit)) : effectiveBands;
  // DU-4.1 — Plant→Warehouse is the inbound leg: its band set is the one authority's choice.
  const effectiveInbound = bandsForLeg("plant_to_warehouse", {
    distanceBands: effectiveBands,
    inboundDistanceBands: inboundBands && inboundBands.length > 0 ? inboundBands : undefined,
  });
  const inboundKey = effectiveInbound.join(",");
  const displayInbound = canonicalResolved ? effectiveInbound.map(b => unit.toDisplay(b, distanceUnit)) : effectiveInbound;

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
      band: bandText(r.distance, effectiveInbound),
      bandIndex: assignBandOrOverflow(r.distance, effectiveInbound),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, inboundKey, plantsSignature, distanceUnit, resolvedUnitLabel]);

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
      band: bandText(r.distance, effectiveBands),
      bandIndex: assignBandOrOverflow(r.distance, effectiveBands),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, bandsKey, distanceUnit, resolvedUnitLabel]);

  // DU-2.2 — the `band` column's filter value AND cell are both the units
  // `bandRangeLabel` (index assigned in canonical space via `bandIndex`). The
  // row's own `band` string is NOT rendered here: it is the
  // client JADE-flows export column (DU-4.2: the same range text the cell shows). The descriptor closes over `effectiveBands` /
  // `distanceUnit`, so those are in this useMemo's deps; `filterResetKey`
  // clears ONLY that filter when the bands or the unit change.
  // One factory for both legs: the two entity columns differ per leg, the
  // Distance / Flow / Distance Band tail is identical bar the testid prefix and
  // the Flow header ("Flow" vs "Flows"). The Distance FILTER range is in the
  // DISPLAY unit (what the cell shows) and resets when the unit changes.
  function legColumns<R extends LegRow>(short: "pw" | "wc", flowHeader: string, entityCols: ColumnDef<R>[], tableDisplayBands: number[], tableBandsKey: string): ColumnDef<R>[] {
    return [
      ...entityCols,
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-${short}-distance-${r.key}`,
        value: r => (canonicalResolved ? unit.toDisplay(r.distance, distanceUnit) : null),
        cell: r => formatRowDistance(r.distance),
        filterResetKey: unit.pref,
      },
      {
        id: "flow",
        header: flowHeader,
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-${short}-flow-${r.key}`,
        value: r => r.flow,
        cell: r => r.flow.toLocaleString(),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-${short}-band-${r.key}`,
        value: r => (canonicalResolved ? bandRangeLabel(r.bandIndex, tableDisplayBands, resolvedUnitLabel!) : "—"),
        cell: r => (canonicalResolved ? <BandLabel index={r.bandIndex} bands={tableDisplayBands} unit={resolvedUnitLabel!} /> : "—"),
        filterResetKey: `${tableBandsKey}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ];
  }

  const pwColumns = useMemo<ColumnDef<PlantWarehouseRow>[]>(
    () =>
      legColumns<PlantWarehouseRow>("pw", "Flow", [
        {
          id: "plant",
          header: "Plant",
          kind: "enum",
          cellTestId: r => `cell-jade-flow-pw-plant-${r.key}`,
          value: r => r.plantLabel,
          cell: r => renderJadeEntityCell(r.plantId, r.plantLabel, identityById),
        },
        {
          id: "warehouse",
          header: "Warehouse",
          kind: "enum",
          cellTestId: r => `cell-jade-flow-pw-warehouse-${r.key}`,
          value: r => r.warehouseLabel,
          cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById),
        },
      ], displayInbound, inboundKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inboundKey, distanceUnit, unit.pref, identityById],
  );

  // SCU-2.P3.6 — Warehouse -> Customer, same factory (header "Flows"; the
  // band filter has its own filterResetKey, cleared independently of P->W's).
  const wcColumns = useMemo<ColumnDef<WarehouseCustomerRow>[]>(
    () =>
      legColumns<WarehouseCustomerRow>("wc", "Flows", [
        {
          id: "warehouse",
          header: "Warehouse",
          kind: "enum",
          cellTestId: r => `cell-jade-flow-wc-warehouse-${r.key}`,
          value: r => r.warehouseLabel,
          cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById),
        },
        {
          id: "customer",
          header: "Customer",
          kind: "text",
          filter: "text", // pinned: today's descriptor type
          cellTestId: r => `cell-jade-flow-wc-customer-${r.key}`,
          value: r => r.customerLabel,
          cell: r => renderJadeEntityCell(r.customerId, r.customerLabel, identityById),
        },
      ], displayBands, bandsKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bandsKey, distanceUnit, unit.pref, identityById],
  );

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="jade-flows-empty">
        No solved result yet.
      </div>
    );
  }

  function renderLeg<R extends LegRow>(
    short: "pw" | "wc",
    leg: JadeFlowLeg,
    hidden: boolean,
    rows: R[],
    columns: ColumnDef<R>[],
    rowTestIdSuffix: (r: R) => string,
    toScreen: (r: R) => JadeFlowScreenRow,
  ) {
    return (
      <div className="overflow-auto flex-1 p-2" hidden={hidden}>
        <DataTable<R>
          rows={rows}
          rowKey={r => r.key}
          columns={columns}
          testIds={{
            root: `jade-flows-${short}-table`,
            row: r => `jade-flow-${short}-row-${rowTestIdSuffix(r)}`,
            count: `text-jadeflows-${short}-count`,
            pagerPrev: `button-jade-flows-${short}-prev`,
            pagerNext: `button-jade-flows-${short}-next`,
            pageIndicator: `jade-flows-${short}-page-indicator`,
            filterTrigger: `button-filter-jade-flows-${short}`,
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId={`button-download-jade-flows-${short}`}
                itemTestIds={{ csv: `button-download-jade-flows-${short}-csv`, json: `button-download-jade-flows-${short}-json`, xlsx: `button-download-jade-flows-${short}-xlsx` }}
                disabledReason={downloadDisabledReason}
                onDownload={format => downloadLeg(leg, format, rows.map(toScreen))}
              />
            ),
            downloadAlign: "right",
          }}
        />
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

      {/* Both legs stay MOUNTED (the inactive one hidden) so each keeps its own
          filter state across a leg switch. */}
      {renderLeg("pw", PLANT_WAREHOUSE_LEG, innerTab !== "plant-warehouse", pwRows, pwColumns, r => `${r.plantId}-${r.warehouseId}`, r => ({ fromLabel: r.plantLabel, toLabel: r.warehouseLabel, distance: r.distance, flow: r.flow, band: r.band }))}
      {renderLeg("wc", WAREHOUSE_CUSTOMER_LEG, innerTab !== "warehouse-customer", wcRows, wcColumns, r => `${r.warehouseId}-${r.customerId}`, r => ({ fromLabel: r.warehouseLabel, toLabel: r.customerLabel, distance: r.distance, flow: r.flow, band: r.band }))}
    </div>
  );
}
