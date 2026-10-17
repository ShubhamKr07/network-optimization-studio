import { useMemo } from "react";
import type { Edge, Plant, PlantProductCapability, Product, SolveResult } from "@workspace/api-client-react";
import { useListModels } from "@workspace/api-client-react";
import { useExport } from "@/contexts/ExportContext";
import { plantIdCityState } from "@/lib/formatLocation";
import {
  bandDecimals, computeExclusiveBandCoverage, exclusiveBandLabels,
  frozenBandCoverageToExclusive, frozenBandShape, OVERFLOW_BAND,
} from "@/lib/bands";
import { isOutboundLeg } from "@/lib/legPalette";
import { type CanonicalUnit } from "@workspace/units";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { cellCapacity, isCellEnabled, type CapabilityOverride } from "@/lib/jadeCapability";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";

interface ServiceStatsTabProps {
  result: SolveResult | null;
  scenarioId: number;
  // Optional: callers that don't yet thread the active model id through
  // (pre-existing call sites) fall back to "mi" below, same as before this
  // change — this prop is additive, not a breaking requirement.
  modelId?: string;

  // B4 (JADE Ch.9 Workspace bundle, spec §6) — Plant Production section.
  // JADE-only (gated on the model manifest's `capabilities
  // .supportsPlantProductCapability`, never on `modelId` directly — the
  // established codebase convention, see jadeCapability.ts's own header
  // comment). All five props below are SNAPSHOT data — the same
  // `displayedInputs`/`dataset` snapshot every other output report reads
  // (spec §5's "solved-snapshot data contract"), never the editable
  // `localInputs` draft. They default to `undefined` (optional-props
  // pattern, Bundle 2.2) so this component compiles standalone and the
  // section stays hidden for every pre-existing call site until INT wires
  // it on the JADE branch.
  /** `dataset.plants ∪ displayedInputs.addedPlants` (spec §3's "effective
   * plants" — same union used for the output-map plant markers). */
  effectivePlants?: Plant[];
  /** `dataset.products` — the 4 canonical JADE products. */
  products?: Product[];
  /** `dataset.plantProductCapabilities` — the base 16-cell matrix. */
  baseCapabilities?: PlantProductCapability[];
  /** `displayedInputs.plantProductCapability` — sparse scenario-local
   * overrides. Defaults to `[]` (not gated — a JADE scenario with zero
   * overrides is a legitimate, common state, unlike the three props above
   * whose ABSENCE means "not wired yet"). */
  capabilityOverrides?: CapabilityOverride[];

  // B4 (spec §2 R2-3 / §6), generalized by SSC-T1 (spec §4a) — live
  // band-coverage recompute. The LIVE `distanceBands`
  // (`localInputs.distanceBands`, spec's "presentationBands" color/label
  // lens), NOT the frozen result snapshot's bands. Default `undefined` ->
  // the component keeps reading the frozen `result.metrics.bandCoverage`
  // exactly as before B4 — see the "Reads the solver's own
  // metrics.bandCoverage" note above. Model selection lives in the
  // CALLER (Workspace.tsx passes this for every distance-band model
  // except `max-coverage-us`, whose "coverage" is a distinct
  // min-distance concept, not a distance-band recompute) — this prop is
  // no longer gated on `supportsPlantProductCapability` internally.
  presentationBands?: number[];

  // workspace-fixups-2, T10 (item 2) — the snapshot-matched identity
  // projection (`buildEntityIdentityById`, T3). The Plant Production plant
  // cell already resolves a single-line "<id> — City, State" label via
  // `plantIdCityState` below (never a separate mono id sub-label) — when
  // `identityById` has an entry for a row's plant id AND the section's
  // UNFILTERED row count exceeds 10 (the item-2 `>10` upgrade rule), that
  // cell upgrades to the shared stacked `EntityIdCell`. Below the threshold,
  // or when `identityById`/the entry is absent, the cell keeps its
  // pre-existing single-line string — `identityById` unset is byte-unchanged
  // from before this task at any row count.
  identityById?: Record<string, EntityIdentity>;
}

interface PlantProductionRow {
  plantId: string;
  plantLabel: string;
  productId: string;
  productLabel: string;
  actual: number;
  enabled: boolean;
  capacity: number;
  /** `null` for a disabled cell -> rendered "—" (spec §6: "remaining only
   * where capacity applies, i.e. enabled cells"). */
  remaining: number | null;
}

// spec §6 — "the FULL effective plants × products grid, LEFT-JOINED to
// aggregated inbound production": enumerate every (effective plant,
// product) combination first, THEN join in whatever inbound flow exists
// for that pair. A combination with zero inbound flow still gets a row
// (Actual 0); a disabled combination still gets a row (capacity 0,
// remaining "—"). Nothing is ever dropped for being zero or disabled.
function buildPlantProductionRows(
  plants: Plant[],
  products: Product[],
  baseCapabilities: PlantProductCapability[],
  overrides: CapabilityOverride[],
  edges: Edge[],
): PlantProductionRow[] {
  // Actual production: sum of inbound (plant_to_warehouse) edges' `flow`,
  // grouped by (fromId=plant, productId). Outbound (warehouse_to_customer)
  // edges carry no productId and are irrelevant here — filtering on `leg`
  // alone would still work since only inbound edges have a productId to
  // key by, but the explicit leg check documents the intent (spec §6).
  const actualByKey = new Map<string, number>();
  for (const edge of edges) {
    if (edge.leg !== "plant_to_warehouse") continue;
    if (edge.productId == null) continue;
    const key = `${edge.fromId}|${edge.productId}`;
    actualByKey.set(key, (actualByKey.get(key) ?? 0) + edge.flow);
  }

  const rows: PlantProductionRow[] = [];
  for (const plant of plants) {
    for (const product of products) {
      const key = `${plant.id}|${product.id}`;
      const actual = actualByKey.get(key) ?? 0;
      const enabled = isCellEnabled(baseCapabilities, overrides, plant.id, product.id);
      const capacity = cellCapacity(baseCapabilities, plant.id, product.id, enabled);
      rows.push({
        plantId: plant.id,
        plantLabel: plantIdCityState(plant),
        productId: product.id,
        productLabel: product.name,
        actual,
        enabled,
        capacity,
        remaining: enabled ? capacity - actual : null,
      });
    }
  }
  return rows;
}

// workspace-fixups-2, T10 (item 2) — the `>10` upgrade: when `upgrade` is
// true (unfiltered Plant Production row count > 10) AND `identityById` has
// an entry for this plant id, render the shared stacked cell (adds the mono
// displayId sub-label this section never showed before, separate from the
// existing "<id> — City, State" single-line string); otherwise render the
// pre-existing label UNCHANGED (the no-regression fallback).
function renderPlantCell(
  plantId: string,
  fallbackLabel: string,
  identityById: Record<string, EntityIdentity> | undefined,
  upgrade: boolean,
) {
  const identity = upgrade ? identityById?.[plantId] : undefined;
  if (identity) {
    return (
      <EntityIdCell
        entityId={plantId}
        displayId={identity.displayId}
        location={(identity.city || identity.state) ? { city: identity.city, state: identity.state } : undefined}
      />
    );
  }
  return fallbackLabel;
}

// SCU-2.P3.9 (spec B2.1/B2.2) — Plant Production on DataTable. Column ids are
// today's descriptor keys (e2e clicks `checkbox-filter-plant-<label>`). The
// derived filters now also include a Remaining-capacity range (spec B2.2:
// descriptors come from every column; today it had none). Built per render
// because the Plant cell depends on `identityById` + the unfiltered count.
function plantProductionColumns(identityById: Record<string, EntityIdentity> | undefined, upgrade: boolean): ColumnDef<PlantProductionRow>[] {
  return [
    {
      id: "plant",
      header: "Plant",
      kind: "enum",
      cellClassName: "text-xs",
      value: r => r.plantLabel,
      cell: r => renderPlantCell(r.plantId, r.plantLabel, identityById, upgrade),
    },
    { id: "product", header: "Product", kind: "enum", cellClassName: "text-xs", value: r => r.productLabel, cell: r => r.productLabel },
    { id: "actual", header: "Actual production", kind: "number", cellClassName: "text-xs font-mono", value: r => r.actual, cell: r => r.actual.toLocaleString() },
    { id: "capacity", header: "Enabled capacity", kind: "number", cellClassName: "text-xs font-mono", value: r => r.capacity, cell: r => r.capacity.toLocaleString() },
    {
      id: "remaining",
      header: "Remaining capacity",
      kind: "number",
      cellClassName: "text-xs font-mono",
      value: r => r.remaining,
      cell: r => (r.remaining === null ? "—" : r.remaining.toLocaleString()),
    },
  ];
}

// By default reads the solver's own metrics.bandCoverage directly (a
// point-in-time snapshot of the actual solved result) — deliberately NOT
// the interactive client-recomputed-from-edges band display the Output
// Map / Reports tab use, which lets a student re-color/re-bucket
// post-solve without re-solving (E1.1).
//
// SSC-T1 (spec §4a), generalizing B4's original JADE-only exception:
// whenever the caller wires `presentationBands`, the coverage bars
// instead recompute client-side from the live bands over the model's
// OUTBOUND/demand-serving edges — `isOutboundLeg()` (refinery_to_customer
// / warehouse_to_customer) when any edge carries a `leg` (two-echelon
// models), else every edge (single-echelon models, which have no `leg`
// concept and thus no inbound leg to exclude). Never `plant_to_warehouse`
// / `mine_to_refinery` — mixing legs would double-count throughput.
// Model selection lives ENTIRELY in the caller: `bandCoverage` below
// branches on `useLiveCoverage` alone, never on a `modelId` check.
//
// CH4O-P1 — and the caller wires it for EVERY distance-band model,
// `max-coverage-us` included (`Workspace.tsx`'s single unconditional
// `presentationBands={activeBandLens}`), so Chapter 4's bars are LIVE too.
// The earlier Chen carve-out described here was removed at that call site by
// chen-bands-units (Part A/D, decision 1d) and this comment was left
// asserting the opposite; the live behaviour is covered by
// `Workspace.test.tsx`'s "Chen computes LIVE band coverage …" test. Do not
// re-add a carve-out here or at the call site on the strength of a comment.
export function ServiceStatsTab({
  result,
  scenarioId,
  modelId,
  effectivePlants,
  products,
  baseCapabilities,
  capabilityOverrides = [],
  presentationBands,
  identityById,
}: ServiceStatsTabProps) {
  const { download, disabledReasonFor } = useExport();
  // R9 — distanceUnit is sourced from the model manifest (G1.1) via
  // GET /api/models. chen-bands-units, T13, Step 3b — the `?? "mi"`
  // fallback is GONE: no distance value or unit label renders here until
  // the canonical unit is authoritative (no fallback, ever — a Chen (km)
  // value transiently rendered as "mi" is a correct number under a wrong
  // unit, which a student reads as fact). `canonicalUnit` is `null` while
  // `models`/`modelId` haven't resolved, gating the whole distance-bearing
  // section below via the early return further down.
  const { data: models } = useListModels();
  const activeModel = models?.find((m) => m.id === modelId) as
    | { distanceUnit?: CanonicalUnit; capabilities?: { supportsPlantProductCapability?: boolean } }
    | undefined;
  const canonicalUnit: CanonicalUnit | null = activeModel?.distanceUnit ?? null;
  const { effectiveUnit, toDisplay } = useDisplayUnit();
  const distanceUnit: CanonicalUnit | null = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  // Gate on the manifest capability, never on `modelId` directly (see
  // jadeCapability.ts's own header + the codebase-wide convention this
  // mirrors, e.g. `supportsFacilityStatus`/`supportsReferenceDistances`).
  const supportsPlantProductCapability = activeModel?.capabilities?.supportsPlantProductCapability ?? false;

  // Hooks must run unconditionally (before the `!result` early return
  // below) — Rules of Hooks. `result?.edges` safely defaults to `[]` when
  // there's no result yet; the Plant Production section itself is never
  // rendered in that case since the whole component early-returns first.
  const edges = result?.edges ?? [];

  const plantProductionRows = useMemo(() => {
    if (!effectivePlants || !products || !baseCapabilities) return [];
    return buildPlantProductionRows(effectivePlants, products, baseCapabilities, capabilityOverrides, edges);
  }, [effectivePlants, products, baseCapabilities, capabilityOverrides, edges]);

  const plantProductionUpgrade = plantProductionRows.length > 10;
  const plantProductionCols = useMemo(
    () => plantProductionColumns(identityById, plantProductionUpgrade),
    [identityById, plantProductionUpgrade],
  );

  const showPlantProduction =
    supportsPlantProductCapability && effectivePlants != null && products != null && baseCapabilities != null;

  // SSC-T1 (spec §4a) — live coverage recompute, generalized off the
  // original JADE-only gate. Model selection lives in the caller
  // (Workspace.tsx never passes this for max-coverage-us), so here the
  // gate is purely "is it wired".
  const useLiveCoverage = presentationBands != null && presentationBands.length > 0;
  // Per-model service-edge selection (spec §4a): if any edge carries a
  // `leg` (two-echelon models — gold-au/jade), keep only the
  // outbound/demand-serving leg (refinery_to_customer /
  // warehouse_to_customer) so an inbound mine/plant leg never
  // double-counts throughput. Single-echelon models (us/brazil/transport)
  // never tag `leg` at all, so every edge is already the service leg.
  const serviceEdges = useMemo(() => {
    const hasLegs = edges.some((e) => e.leg != null);
    return hasLegs ? edges.filter((e) => isOutboundLeg(e.leg)) : edges;
  }, [edges]);

  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="service-stats-empty">No solved result yet.</div>;
  }

  // chen-bands-units, T13, Step 3b — no distance value or unit label
  // renders, and nothing below is computed, until the canonical unit is
  // authoritative. No fallback, ever.
  if (canonicalUnit == null || distanceUnit == null) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="service-stats-unit-pending">
        Loading distance unit…
      </div>
    );
  }

  // chen-bands-units, Part A — Chen is now wired into the SAME live
  // `presentationBands` recompute as its five siblings; the deliberate
  // "stay frozen for Chen" guard that used to live here
  // (`&& !showCoverageKpis`) is deleted — CH4O-10 removed the KPI block
  // that guard referenced entirely (moved to Solution Summary), so this
  // only ever branches on `useLiveCoverage`. A model that hasn't wired
  // `presentationBands` (any pre-existing call site, or Chen before
  // Workspace.tsx wires it) is unaffected: `useLiveCoverage` is false and
  // this falls through to the frozen `result.metrics.bandCoverage` exactly
  // as before.
  // SCU-1.2 (spec B1.9) — EXCLUSIVE rows (one per boundary + overflow,
  // always). Live: classified from the outbound/service edges by the shared
  // assignBandOrOverflow. Frozen: the solved result's own bandCoverage,
  // converted per its stored shape (JADE is already exclusive — deviation 1).
  // Precision per model lives in bandDecimals (delivery 2 dp, others 0).
  const decimals = bandDecimals(modelId);
  const bandCoverage = useLiveCoverage
    ? computeExclusiveBandCoverage(serviceEdges, presentationBands as number[], decimals)
    : (frozenBandCoverageToExclusive(result.metrics.bandCoverage, decimals, frozenBandShape(modelId)) ?? []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-end p-2 border-b flex-shrink-0">
        {/* SCU-2.P3.9 (spec B2.4) — tab-level Download ▾ CSV/JSON (server
            `serviceStats`); outside DataTable: it exports the whole tab. */}
        <DownloadMenu
          testId="button-download-service-stats"
          itemTestIds={{ csv: "button-download-service-stats-csv", json: "button-download-service-stats-json" }}
          onDownload={format => download("serviceStats", format)}
          disabledReason={disabledReasonFor("serviceStats")}
        />
      </div>
      {/* R9 — demand-weighted, not a customer count: metrics.bandCoverage[].percent
          is computed from flow/demand, so the label says so explicitly. */}
      <p className="px-2 pt-2 text-xs text-muted-foreground flex-shrink-0">
        Percent of demand served within the selected distance bands
      </p>
      {bandCoverage.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground" data-testid="service-stats-no-bands">No band coverage data for this solve.</div>
      ) : (
        <div className="p-4 space-y-2">
          {/* jade-T14 / SCU-1.2 — exclusive rows: "0–200 mi", "200–400 mi", …,
              and a `band: -1` overflow row labelled "> {last boundary}". The
              sentinel itself is never converted — only real boundaries go
              through toDisplay (a converted -1 would render "-0.62"). */}
          {(() => {
            const labels = exclusiveBandLabels(
              bandCoverage.filter(b => b.band !== OVERFLOW_BAND).map(b => b.band),
              v => toDisplay(v, canonicalUnit),
              distanceUnit,
            );
            return bandCoverage.map((b, i) => (
              <div key={b.band} data-testid={`service-stats-band-${b.band}`} className="flex items-center gap-2 text-sm">
                <span className="w-28 flex-shrink-0 font-mono">{labels[i]}</span>
                <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                  <div className="bg-primary h-full" style={{ width: `${Math.min(b.percent, 100)}%` }} />
                </div>
                <span className="w-14 text-right font-mono">{b.percent}%</span>
              </div>
            ));
          })()}
        </div>
      )}

      {/* B4 (spec §6) — JADE-only Plant Production section: the full
          effective plants × products grid, left-joined to aggregated
          inbound production. */}
      {showPlantProduction && (
        <div className="mt-2 border-t flex-shrink-0 p-2" data-testid="plant-production-section">
          <DataTable<PlantProductionRow>
            rows={plantProductionRows}
            rowKey={r => `${r.plantId}|${r.productId}`}
            columns={plantProductionCols}
            ctx={{ readOnly: true, demandEditable: false }}
            testIds={{
              row: r => `row-plant-production-${r.plantId}-${r.productId}`,
              pager: "plant-production-pager",
              pagerPrev: "button-plant-production-prev",
              pagerNext: "button-plant-production-next",
              pageIndicator: "plant-production-page-indicator",
            }}
            toolbar={{ extra: <span className="text-sm font-medium">Plant Production</span> }}
          />
        </div>
      )}
    </div>
  );
}
