import { useMemo } from "react";
import type { Edge, Plant, PlantProductCapability, Product, SolveResult } from "@workspace/api-client-react";
import { useListModels } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import { plantIdCityState } from "@/lib/formatLocation";
import { computeCumulativeBandCoverage } from "@/lib/bands";
import { isOutboundLeg } from "@/lib/legPalette";
import { cellCapacity, isCellEnabled, type CapabilityOverride } from "@/lib/jadeCapability";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  // except `chens-cosmetics-cn`, whose "coverage" is a distinct
  // min-distance concept, not a distance-band recompute) — this prop is
  // no longer gated on `supportsPlantProductCapability` internally.
  presentationBands?: number[];
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

const PLANT_PRODUCTION_FILTER_DESCRIPTORS: ColumnFilterDescriptor<PlantProductionRow>[] = [
  { key: "plant", label: "Plant", type: "select", accessor: (r) => r.plantLabel },
  { key: "product", label: "Product", type: "select", accessor: (r) => r.productLabel },
  { key: "actual", label: "Actual production", type: "number", accessor: (r) => r.actual },
  { key: "capacity", label: "Enabled capacity", type: "number", accessor: (r) => r.capacity },
];

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
// `chens-cosmetics-cn` (a distinct min-distance coverage concept) stays
// frozen: gated both by the caller (Workspace.tsx never wires
// `presentationBands` for it) and, belt-and-suspenders, here on the
// envelope's own `showCoverageKpis` shape (see below) — never a
// `modelId` check.
// Workspace.tsx wires this for every distance-band model EXCEPT
// `chens-cosmetics-cn` (a distinct min-distance coverage concept, stays
// frozen) — model selection lives entirely in the caller now.
export function ServiceStatsTab({
  result,
  scenarioId,
  modelId,
  effectivePlants,
  products,
  baseCapabilities,
  capabilityOverrides = [],
  presentationBands,
}: ServiceStatsTabProps) {
  // R9 — distanceUnit is sourced from the model manifest (G1.1) via
  // GET /api/models, defaulting to "mi" both when the manifest field is
  // absent (T2's ModelInfo.distanceUnit may not have landed yet, or the
  // model simply hasn't set one — the public boundary already defaults
  // absent -> "mi") and while models/modelId haven't resolved yet. Cast
  // rather than a hard type dependency on ModelInfo.distanceUnit so this
  // compiles independent of T2's landing order (see plan Task T3 note).
  const { data: models } = useListModels();
  const activeModel = models?.find((m) => m.id === modelId) as
    | { distanceUnit?: string; capabilities?: { supportsPlantProductCapability?: boolean } }
    | undefined;
  const distanceUnit = activeModel?.distanceUnit ?? "mi";
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

  const plantProductionFilters = useTableFilters(plantProductionRows, PLANT_PRODUCTION_FILTER_DESCRIPTORS);

  const showPlantProduction =
    supportsPlantProductCapability && effectivePlants != null && products != null && baseCapabilities != null;

  // SSC-T1 (spec §4a) — live coverage recompute, generalized off the
  // original JADE-only gate. Model selection lives in the caller
  // (Workspace.tsx never passes this for chens-cosmetics-cn), so here the
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

  // C4.14 (D14) — Chen's Cosmetics coverage KPIs, read off the envelope's
  // `details`. Gated on the presence of `coveragePct` (a Chen-only field —
  // absent for every other model's envelope), NOT a `modelId` ternary, so
  // this block is purely additive and never appears for a non-Chen solve.
  const details = result.details as
    | { coveragePct?: number; coveredDemand?: number; uncoveredPct?: number }
    | undefined;
  const showCoverageKpis = typeof details?.coveragePct === "number";

  // SSC-T1 (spec §5d) — belt-and-suspenders: chens-cosmetics-cn's
  // "coverage" is a distinct min-distance concept the distance-band
  // recompute doesn't apply to. Workspace.tsx never passes
  // `presentationBands` for it, but gate on the envelope's own shape here
  // too (`showCoverageKpis`, the same Chen-only signal the KPI block
  // above uses — never a `modelId` ternary) so a chens result stays on
  // the frozen `result.metrics.bandCoverage` even if a future caller
  // mistakenly wired `presentationBands` for it.
  const bandCoverage = useLiveCoverage && !showCoverageKpis
    ? computeCumulativeBandCoverage(serviceEdges, presentationBands as number[])
    : (result.metrics.bandCoverage ?? []);
  const avgServiceDistance = result.metrics.weightedAvgDistance;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Service Stats</span>
        <button
          type="button"
          data-testid="button-download-service-stats-csv"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={() => downloadEntityExport(scenarioId, "serviceStats", "csv")}
        >
          Download CSV
        </button>
      </div>
      {/* C4.14 (D14) — Chen coverage KPI summary above the band bars: coverage
          %, covered demand (exact integer), uncovered %, and the achieved
          demand-weighted average service distance in the model's unit (km).
          Additive; only rendered when the envelope carries coverage details. */}
      {showCoverageKpis && (
        <dl className="p-2 border-b flex-shrink-0 space-y-1 text-sm" data-testid="service-stats-coverage-kpis">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Coverage</dt>
            <dd className="font-medium font-mono" data-testid="service-stats-coverage-pct">{details!.coveragePct!.toFixed(2)} %</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Covered demand</dt>
            <dd className="font-medium font-mono" data-testid="service-stats-covered-demand">
              {typeof details!.coveredDemand === "number" ? details!.coveredDemand.toLocaleString() : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Uncovered</dt>
            <dd className="font-medium font-mono" data-testid="service-stats-uncovered-pct">
              {typeof details!.uncoveredPct === "number" ? `${details!.uncoveredPct.toFixed(2)} %` : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Avg service distance</dt>
            <dd className="font-medium font-mono" data-testid="service-stats-avg-service-distance">
              {avgServiceDistance != null ? `${avgServiceDistance.toFixed(1)} ${distanceUnit}` : "—"}
            </dd>
          </div>
        </dl>
      )}
      {/* R9 — demand-weighted, not a customer count: metrics.bandCoverage[].percent
          is computed from flow/demand, so the label says so explicitly. */}
      <p className="px-2 pt-2 text-xs text-muted-foreground flex-shrink-0">
        Percent of demand served within the selected distance bands
      </p>
      {bandCoverage.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground" data-testid="service-stats-no-bands">No band coverage data for this solve.</div>
      ) : (
        <div className="p-4 space-y-2">
          {/* jade-T14 — model-integration-precheck.md Gate 4: a `band: -1`
              entry (Ch10's own existing overflow convention, extended to
              Chapter 9 JADE) is flow beyond every configured boundary and
              gets a distinct "> {last boundary}" label — never rendered as
              "≤ -1", and never folded into the last real boundary's row. The
              boundary shown is derived from the OTHER rows in this same
              array (not hardcoded to 1600), so this works for any model's
              band configuration. */}
          {(() => {
            const maxBoundary = bandCoverage.reduce((max, b) => (b.band !== -1 && b.band > max ? b.band : max), 0);
            return bandCoverage.map(b => {
              const isOverflow = b.band === -1;
              const label = isOverflow ? `> ${maxBoundary} ${distanceUnit}` : `≤ ${b.band} ${distanceUnit}`;
              return (
                <div key={b.band} data-testid={`service-stats-band-${b.band}`} className="flex items-center gap-2 text-sm">
                  <span className="w-24 flex-shrink-0 font-mono">{label}</span>
                  <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                    <div className="bg-primary h-full" style={{ width: `${Math.min(b.percent, 100)}%` }} />
                  </div>
                  <span className="w-10 text-right font-mono">{b.percent}%</span>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* B4 (spec §6) — JADE-only Plant Production section: the full
          effective plants × products grid, left-joined to aggregated
          inbound production. */}
      {showPlantProduction && (
        <div className="mt-2 border-t flex-shrink-0" data-testid="plant-production-section">
          <div className="flex items-center justify-between p-2">
            <span className="text-sm font-medium">Plant Production</span>
            {plantProductionFilters.totalCount > 10 && (
              <FilterMenu descriptors={PLANT_PRODUCTION_FILTER_DESCRIPTORS} tableFilters={plantProductionFilters} />
            )}
          </div>
          <div className="px-2 pb-2 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plant</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Actual production</TableHead>
                  <TableHead>Enabled capacity</TableHead>
                  <TableHead>Remaining capacity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plantProductionFilters.filteredRows.map((row) => (
                  <TableRow
                    key={`${row.plantId}|${row.productId}`}
                    data-testid={`row-plant-production-${row.plantId}-${row.productId}`}
                  >
                    <TableCell className="text-xs">{row.plantLabel}</TableCell>
                    <TableCell className="text-xs">{row.productLabel}</TableCell>
                    <TableCell className="text-xs font-mono">{row.actual.toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-mono">{row.capacity.toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {row.remaining === null ? "—" : row.remaining.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
