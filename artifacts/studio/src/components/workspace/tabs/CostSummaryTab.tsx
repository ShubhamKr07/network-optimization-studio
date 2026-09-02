import { useState } from "react";
import type { GetDatasetParams, Scenario, SolveResult } from "@workspace/api-client-react";
import { getGetDatasetQueryKey, useGetDataset, useListModels } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface CostSummaryTabProps {
  result: SolveResult | null;
  scenarioId: number;
  // R6+R8 — `modelId` sources distanceUnit + the supportsP capability flag
  // off GET /api/models, same pattern T3 already established for
  // ServiceStatsTab (fetch useListModels internally, take modelId as a
  // prop) rather than threading a distanceUnit prop through Workspace.tsx a
  // second way. Optional so pre-existing call sites (and this file's own
  // pre-T5 tests) keep compiling unchanged, defaulting to "mi"/no
  // facility-location rows.
  modelId?: string;
  // R6+R8 — the active model's own scenarios (Workspace.tsx's existing
  // `useListScenarios({ modelId })` result, already same-model-scoped —
  // reused as-is rather than a new `POST /scenarios/compare` fetch: G2.1's
  // `toApiScenario` already puts the full `result`/`stale` envelope on every
  // list row, so there is nothing a per-scenario `getScenario` fetch would
  // add here beyond redundant round trips). Defaults to [] so callers that
  // don't pass it (older tests) render exactly like before this task.
  scenarios?: Scenario[];
  // R6+R8 — true while the result-history stepper (Workspace.tsx's
  // resultHistoryState) is parked on a non-latest entry. A historical
  // `displayedResult` must never silently become a compare column, so the
  // toggle list is disabled (not hidden) with a hint whenever this is true.
  isBrowsingHistory?: boolean;
}

const MAX_COMPARE = 4;

// Mirrors OpenWarehousesTab.tsx's/templates.ts's own `buildOpenWarehouseRows`
// derivation (distinct `fromId` across non-mine_to_refinery edges) so
// "open facility count" here never disagrees with the Open Warehouses tab.
function openFacilityIds(result: SolveResult): Set<string> {
  const ids = new Set<string>();
  for (const e of result.edges) {
    if (e.leg === "mine_to_refinery") continue;
    ids.add(e.fromId);
  }
  return ids;
}

// R6+R8 — aggregate utilization is the mean of utilizationByNode[].utilization
// over OPENED nodes only, never all nodes: transport-coal has no
// facility-location concept at all (every mine "opens"), and two-echelon's
// utilizationByNode carries closed refineries at a real 0 — averaging over
// every row would silently misrepresent both, which is exactly why this
// metric is gated on the supportsP capability at the call site below (never
// computed for those two models to begin with).
function aggregateUtilization(result: SolveResult): number | null {
  const opened = openFacilityIds(result);
  const relevant = (result.metrics.utilizationByNode ?? []).filter(u => opened.has(u.warehouseId));
  if (relevant.length === 0) return null;
  return relevant.reduce((sum, u) => sum + u.utilization, 0) / relevant.length;
}

function bandBoundaries(result: SolveResult): number[] {
  return (result.metrics.bandCoverage ?? []).map(b => b.band);
}

// T5 (B5) — a scenario's own scenario-local added facilities, read directly
// off the OPAQUE `Scenario.inputs` (never `localInputs` — compare columns
// are other scenarios' own persisted state, not the currently-open one).
// p-median models store these under `addedWarehouses`; two-echelon under
// `addedRefineries` (never `addedMines` — the mine is fixed, non-overridable,
// and never appears in `openFacilityIds()` since its only edges are the
// excluded `mine_to_refinery` leg). Both keys are checked unconditionally —
// a scenario only ever populates the one its own model actually uses.
interface AddedFacilityLike {
  id: string;
  city?: string;
  state?: string;
  displayCode?: string;
}

function extractAddedFacilities(inputs: unknown): AddedFacilityLike[] {
  if (!inputs || typeof inputs !== "object") return [];
  const obj = inputs as Record<string, unknown>;
  const addedWarehouses = Array.isArray(obj.addedWarehouses) ? (obj.addedWarehouses as AddedFacilityLike[]) : [];
  const addedRefineries = Array.isArray(obj.addedRefineries) ? (obj.addedRefineries as AddedFacilityLike[]) : [];
  return [...addedWarehouses, ...addedRefineries];
}

interface BaseFacilityLike {
  id: string;
  city?: string;
  state?: string;
}

// Base facility -> dataset city/state; added facility -> city/state from
// that column's OWN persisted inputs (added facilities never appear in the
// shared base dataset). Unknown/unresolvable id (or dataset not loaded yet)
// falls back to the raw id — never blank.
function facilityCityLabel(id: string, baseFacilities: BaseFacilityLike[], addedFacilities: AddedFacilityLike[]): string {
  const added = addedFacilities.find(f => f.id === id);
  if (added) {
    if (added.city) return added.state ? `${added.city}, ${added.state}` : added.city;
    return added.displayCode ?? id;
  }
  const base = baseFacilities.find(f => f.id === id);
  if (base?.city) return base.state ? `${base.city}, ${base.state}` : base.city;
  return id;
}

function openFacilityCityList(result: SolveResult, scenarioInputs: unknown, baseFacilities: BaseFacilityLike[]): string {
  const addedFacilities = extractAddedFacilities(scenarioInputs);
  const ids = [...openFacilityIds(result)].sort();
  if (ids.length === 0) return "—";
  return ids.map(id => facilityCityLabel(id, baseFacilities, addedFacilities)).join(", ");
}

// R6+R8 — per-band coverage is only shown when every selected scenario's
// SOLVED bands are identical (band-for-band); R5 makes bands a per-scenario
// solve input, so two scenarios can legitimately differ, and re-bucketing
// one onto another's axis would misrepresent the data. Reads each result's
// own `metrics.bandCoverage` (what that solve actually used), not a
// currently-edited draft's `inputs.distanceBands`.
function scenariosShareBands(results: SolveResult[]): boolean {
  if (results.length === 0) return false;
  const first = bandBoundaries(results[0]);
  if (first.length === 0) return false;
  const firstKey = JSON.stringify(first);
  return results.every(r => JSON.stringify(bandBoundaries(r)) === firstKey);
}

export function CostSummaryTab({ result, scenarioId, modelId, scenarios = [], isBrowsingHistory = false }: CostSummaryTabProps) {
  // R9/R6+R8 — same lookup ServiceStatsTab.tsx already does: GET /api/models
  // is independent of everything else on this page, defaulting absent ->
  // "mi"/no facility rows rather than blocking render on it resolving.
  const { data: models } = useListModels();
  const activeModel = models?.find(m => m.id === modelId) as
    | { distanceUnit?: string; capabilities?: { supportsP?: boolean; supportsFacilityStatus?: boolean } }
    | undefined;
  const distanceUnit = activeModel?.distanceUnit ?? "mi";
  const supportsP = activeModel?.capabilities?.supportsP ?? false;
  // T5 (B5) — the open-facility-by-city row is gated independently of
  // supportsP: two-echelon has no P (openFacilities/aggregate-utilization
  // rows below stay hidden for it) but DOES have a real open/closed
  // facility-status concept, so it still gets the city list.
  const supportsFacilityStatus = activeModel?.capabilities?.supportsFacilityStatus ?? false;

  // T5 (B5) — base facility id -> city/state, single fetch (compare is
  // single-model by construction — cross-model selection is impossible, see
  // `sameModelScenarios` below). Shares its query cache key with
  // Workspace.tsx's own `useGetDataset` fetch for the same modelId, so this
  // never causes a redundant network round trip in real usage.
  const datasetParams: GetDatasetParams = { modelId: modelId as GetDatasetParams["modelId"] };
  const { data: dataset } = useGetDataset(datasetParams, {
    query: { queryKey: getGetDatasetQueryKey(datasetParams) },
  });
  const baseFacilities: BaseFacilityLike[] = dataset?.warehouses ?? [];

  // R6+R8 — cross-model compare is impossible BY CONSTRUCTION here, not just
  // by caller convention: even if `scenarios` ever carried a mixed-model
  // list, only rows matching the active model are ever offered as toggles or
  // eligible for `compareScenarios` below.
  const sameModelScenarios = scenarios.filter(s => s.modelId === modelId);

  const [selectedIds, setSelectedIds] = useState<number[]>(() => [scenarioId]);

  function toggleScenario(id: number, checked: boolean) {
    setSelectedIds(prev => {
      if (checked) {
        if (prev.includes(id) || prev.length >= MAX_COMPARE) return prev;
        return [...prev, id];
      }
      if (prev.length <= 1) return prev; // at least one scenario always stays selected
      return prev.filter(x => x !== id);
    });
  }

  // Selection order (not sameModelScenarios order) drives column order —
  // "columns = scenarios, selection order, no baseline" per R6+R8.
  const compareScenarios = selectedIds
    .map(id => sameModelScenarios.find(s => s.id === id))
    .filter((s): s is Scenario => !!s && s.result != null);
  const compareMode = !isBrowsingHistory && compareScenarios.length >= 2;

  const toggleList = sameModelScenarios.length > 0 && (
    <div className="p-2 border-b flex-shrink-0" data-testid="cost-summary-compare-toggles">
      <div className="text-xs font-medium mb-1">Compare scenarios (2–4)</div>
      {isBrowsingHistory && (
        <p className="text-xs text-muted-foreground mb-1" data-testid="cost-summary-history-hint">
          Return to the latest result to compare scenarios.
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {sameModelScenarios.map(s => {
          const checked = selectedIds.includes(s.id);
          const eligible = s.result != null && !s.stale;
          const disabled =
            isBrowsingHistory ||
            (!checked && (!eligible || selectedIds.length >= MAX_COMPARE)) ||
            (checked && selectedIds.length <= 1);
          return (
            <label key={s.id} className="flex items-center gap-1 text-xs" data-testid={`cost-summary-compare-toggle-${s.id}`}>
              <input type="checkbox" checked={checked} disabled={disabled} onChange={e => toggleScenario(s.id, e.target.checked)} />
              {s.name}
              {!eligible && (
                <span className="text-muted-foreground" data-testid={`cost-summary-compare-hint-${s.id}`}>
                  (solve first)
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );

  if (!compareMode) {
    if (!result) {
      return (
        <div className="flex flex-col h-full overflow-hidden">
          {toggleList}
          <div className="p-4 text-sm text-muted-foreground" data-testid="cost-summary-empty">No solved result yet.</div>
        </div>
      );
    }

    const rows: Array<[string, string]> = [
      ["Objective", result.objective.toLocaleString()],
      ["Weighted avg. distance", result.metrics.weightedAvgDistance != null ? `${result.metrics.weightedAvgDistance.toFixed(1)} ${distanceUnit}` : "—"],
      ["Runtime", `${result.runTimeSec.toFixed(2)}s`],
      ["Quality", result.quality],
      ["Solver", result.solverUsed],
    ];

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {toggleList}
        <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
          <span className="text-sm font-medium">Solution Summary</span>
          <button
            type="button"
            data-testid="button-download-cost-summary-csv"
            className="text-xs border rounded px-2 py-1 hover:bg-muted"
            onClick={() => downloadEntityExport(scenarioId, "costSummary", "csv")}
          >
            Download CSV
          </button>
        </div>
        <dl className="p-4 space-y-2 text-sm" data-testid="cost-summary-list">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between border-b pb-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium" data-testid={`cost-summary-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  // Compare mode: 2-4 solved, non-stale, same-model scenarios selected.
  // Download CSV is hidden here (compare is a read-only side-by-side; a
  // combined compare export is a later follow-up, not this bundle).
  const results = compareScenarios.map(s => s.result!);
  const sharedBands = scenariosShareBands(results);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {toggleList}
      <div className="p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Solution Summary — Compare</span>
      </div>
      <div className="overflow-auto flex-1 p-2" data-testid="cost-summary-compare-table">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left p-2 border-b"></th>
              {compareScenarios.map(s => (
                <th key={s.id} className="text-left p-2 border-b" data-testid={`cost-summary-compare-column-${s.id}`}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-2 text-muted-foreground">Objective</td>
              {compareScenarios.map(s => (
                <td key={s.id} className="p-2" data-testid={`cost-summary-compare-objective-${s.id}`}>
                  {s.result!.objective.toLocaleString()}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-2 text-muted-foreground">Weighted avg. distance ({distanceUnit})</td>
              {compareScenarios.map(s => (
                <td key={s.id} className="p-2" data-testid={`cost-summary-compare-distance-${s.id}`}>
                  {s.result!.metrics.weightedAvgDistance != null ? s.result!.metrics.weightedAvgDistance.toFixed(1) : "—"}
                </td>
              ))}
            </tr>
            {/* T5 (B5) — open-facility set by city, gated independently on
                supportsFacilityStatus (present for p-median-us/brazil AND
                two-echelon, absent for transport-coal — no facility-location
                concept there). Replaces the old "Open facilities" COUNT row
                that used to live inside the supportsP fragment below; not
                duplicated alongside it. */}
            {supportsFacilityStatus && (
              <tr>
                <td className="p-2 text-muted-foreground">Open facilities</td>
                {compareScenarios.map(s => (
                  <td key={s.id} className="p-2" data-testid={`cost-summary-compare-open-facilities-cities-${s.id}`}>
                    {openFacilityCityList(s.result!, s.inputs, baseFacilities)}
                  </td>
                ))}
              </tr>
            )}
            <tr>
              <td className="p-2 text-muted-foreground">Runtime</td>
              {compareScenarios.map(s => (
                <td key={s.id} className="p-2" data-testid={`cost-summary-compare-runtime-${s.id}`}>
                  {s.result!.runTimeSec.toFixed(2)}s
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-2 text-muted-foreground">Quality</td>
              {compareScenarios.map(s => (
                <td key={s.id} className="p-2" data-testid={`cost-summary-compare-quality-${s.id}`}>
                  {s.result!.quality}
                </td>
              ))}
            </tr>
            {/* R6+R8 — aggregate utilization is omitted entirely (not just an
                N/A cell) for models without a real facility-location
                concept, per capabilities.supportsP — transport-coal (every
                mine "open") and two-echelon-gold-au (utilizationByNode holds
                closed refineries at 0) never get this row. (The former
                "Open facilities" COUNT row that used to live here is gone —
                T5 replaced it with the city-list row above, gated
                independently on supportsFacilityStatus.) */}
            {supportsP && (
              <tr>
                <td className="p-2 text-muted-foreground">Aggregate utilization</td>
                {compareScenarios.map(s => {
                  const util = aggregateUtilization(s.result!);
                  return (
                    <td key={s.id} className="p-2" data-testid={`cost-summary-compare-utilization-${s.id}`}>
                      {util != null ? `${Math.round(util)}%` : "N/A"}
                    </td>
                  );
                })}
              </tr>
            )}
            {sharedBands &&
              bandBoundaries(results[0]).map(band => (
                <tr key={band}>
                  <td className="p-2 text-muted-foreground">
                    ≤ {band} {distanceUnit}
                  </td>
                  {compareScenarios.map(s => {
                    const coverage = (s.result!.metrics.bandCoverage ?? []).find(b => b.band === band);
                    return (
                      <td key={s.id} className="p-2" data-testid={`cost-summary-compare-band-${band}-${s.id}`}>
                        {coverage ? `${coverage.percent}%` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
        {!sharedBands && (
          <p className="text-xs text-muted-foreground p-2" data-testid="cost-summary-compare-bands-note">
            Selected scenarios use different distance bands — band coverage isn't shown side by side.{" "}
            {compareScenarios.map(s => `${s.name}: ${bandBoundaries(s.result!).join("/") || "no bands"} ${distanceUnit}`).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
