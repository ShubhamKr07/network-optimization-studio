import { useState } from "react";
import type { GetDatasetParams, Scenario, SolveResult } from "@workspace/api-client-react";
import { getGetDatasetQueryKey, useGetDataset, useListModels } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import { formatChenObjective, objectiveModeOfDetails } from "@/lib/formatObjective";

interface CostSummaryTabProps {
  result: SolveResult | null;
  scenarioId: number;
  // R6+R8 — `modelId` sources distanceUnit + the supportsFacilityStatus
  // capability flag off GET /api/models, same pattern T3 already established
  // for ServiceStatsTab (fetch useListModels internally, take modelId as a
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
  /** JADE-only — id -> {city, state}, built by Workspace.tsx's
   * `jadeLocationMapFromInputs`. When present, the compare mode's
   * "Open facilities" row shows each facility as "City, ST" with the raw id
   * as a mono sub-label (mirrors JadeDistancesTab.tsx), instead of the
   * existing comma-joined `facilityCityLabel` string. Absent (undefined,
   * back-compat default) -> unchanged rendering for every other model. */
  locationById?: Record<string, { city: string; state: string }>;
}

const MAX_COMPARE = 4;

// Mirrors OpenWarehousesTab.tsx's/templates.ts's own `buildOpenWarehouseRows`
// derivation (distinct `fromId` across non-source->facility-leg edges) so
// "open facility count" here never disagrees with the Open Warehouses tab.
//
// jade-T14 — prefers the authoritative `metrics.openFacilityIds` (Chapter 9
// JADE) when present, which correctly includes a forced-open warehouse
// serving zero outbound flow (never derivable from edges alone, since a
// zero-flow warehouse never appears as a `fromId`). Falls back to the
// edge-derived Set when the field is absent — every pre-existing model never
// populates it, so this is byte-identical to before this task for them.
function openFacilityIds(result: SolveResult): Set<string> {
  if (result.metrics.openFacilityIds) return new Set(result.metrics.openFacilityIds);
  const ids = new Set<string>();
  for (const e of result.edges) {
    if (e.leg === "mine_to_refinery" || e.leg === "plant_to_warehouse") continue;
    ids.add(e.fromId);
  }
  return ids;
}

function bandBoundaries(result: SolveResult): number[] {
  return (result.metrics.bandCoverage ?? []).map(b => b.band);
}

// C4.14 (D14) — a solved scenario's objective MODE, read off its own envelope
// `details.objective` ("coverage" | "min_distance" for Chen; null for every
// other model, which has no such discriminator). Used both to LABEL the
// objective mode-aware and to block comparing two Chen scenarios solved under
// different modes (their objectives are in different units — a coverage % and
// a demand-km total can't share a column).
function scenarioObjectiveMode(s: Scenario | undefined): string | null {
  return objectiveModeOfDetails(s?.result?.details);
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
    if (added.city) return added.state ? `${added.city} - ${added.state}` : added.city;
    return added.displayCode ?? id;
  }
  const base = baseFacilities.find(f => f.id === id);
  if (base?.city) return base.state ? `${base.city} - ${base.state}` : base.city;
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

export function CostSummaryTab({ result, scenarioId, modelId, scenarios = [], isBrowsingHistory = false, locationById }: CostSummaryTabProps) {
  // R9/R6+R8 — same lookup ServiceStatsTab.tsx already does: GET /api/models
  // is independent of everything else on this page, defaulting absent ->
  // "mi"/no facility rows rather than blocking render on it resolving.
  const { data: models } = useListModels();
  const activeModel = models?.find(m => m.id === modelId) as
    | { distanceUnit?: string; capabilities?: { supportsFacilityStatus?: boolean } }
    | undefined;
  const distanceUnit = activeModel?.distanceUnit ?? "mi";
  // T5 (B5) — the open-facility-by-city row is gated independently: two-echelon
  // has no P but DOES have a real open/closed facility-status concept, so it
  // still gets the city list.
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

  // C4.14 (D14) — the objective mode the current selection is LOCKED to: the
  // mode of the first already-selected scenario that carries one. While a Chen
  // coverage scenario is selected, only other coverage scenarios can join (and
  // vice-versa for min_distance) — a different-mode scenario's objective is in
  // an incompatible unit. Null (no selected scenario carries a mode — every
  // non-Chen model) imposes NO restriction, so every existing model is
  // byte-for-byte unaffected.
  const lockedObjectiveMode =
    selectedIds
      .map(id => scenarioObjectiveMode(sameModelScenarios.find(x => x.id === id)))
      .find((m): m is string => m != null) ?? null;

  function toggleScenario(id: number, checked: boolean) {
    setSelectedIds(prev => {
      if (checked) {
        if (prev.includes(id) || prev.length >= MAX_COMPARE) return prev;
        // Defense in depth — the checkbox is already `disabled` for a
        // mode-mismatched scenario, but never let one slip into the selection.
        const candidateMode = scenarioObjectiveMode(sameModelScenarios.find(x => x.id === id));
        const anchorMode =
          prev.map(pid => scenarioObjectiveMode(sameModelScenarios.find(x => x.id === pid))).find((m): m is string => m != null) ?? null;
        if (anchorMode != null && candidateMode != null && candidateMode !== anchorMode) return prev;
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
          // C4.14 (D14) — a solved scenario of the WRONG objective mode can't
          // be added to a selection already locked to another mode. Only ever
          // fires for Chen (the only model with a mode discriminator); the
          // currently-selected anchor stays checked and un-disabled.
          const modeMismatch =
            !checked &&
            lockedObjectiveMode != null &&
            scenarioObjectiveMode(s) != null &&
            scenarioObjectiveMode(s) !== lockedObjectiveMode;
          const disabled =
            isBrowsingHistory ||
            (!checked && (!eligible || modeMismatch || selectedIds.length >= MAX_COMPARE)) ||
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
              {eligible && modeMismatch && (
                <span className="text-muted-foreground" data-testid={`cost-summary-compare-mode-hint-${s.id}`}>
                  (different objective)
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

    // jade-T14 — Chapter 9 JADE inbound/outbound cost split. Purely additive:
    // gated on the presence of each optional metric, never on modelId — the
    // fields are simply absent for every pre-existing model's envelope, so
    // these two rows never appear for them (byte-identical row set to before
    // this task).
    // C4.14 (D14) — mode-aware objective (coverage % / min-distance demand-km);
    // formatChenObjective returns null for every non-Chen model, keeping the
    // plain toLocaleString format unchanged there.
    const objectiveText =
      formatChenObjective(result.objective, objectiveModeOfDetails(result.details))
      ?? result.objective.toLocaleString();
    const rows: Array<[string, string, boolean]> = [["Objective", objectiveText, true]];
    if (result.metrics.inboundCost != null) {
      rows.push(["Inbound cost", result.metrics.inboundCost.toLocaleString(), true]);
    }
    if (result.metrics.outboundCost != null) {
      rows.push(["Outbound cost", result.metrics.outboundCost.toLocaleString(), true]);
    }
    rows.push(
      ["Weighted avg. distance", result.metrics.weightedAvgDistance != null ? `${result.metrics.weightedAvgDistance.toFixed(1)} ${distanceUnit}` : "—", true],
      ["Runtime", `${result.runTimeSec.toFixed(2)}s`, true],
      ["Quality", result.quality, false],
      ["Solver", result.solverUsed, false],
    );

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
          {rows.map(([label, value, mono]) => (
            <div key={label} className="flex justify-between border-b pb-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={`font-medium${mono ? " font-mono" : ""}`} data-testid={`cost-summary-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{value}</dd>
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
                <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-objective-${s.id}`}>
                  {formatChenObjective(s.result!.objective, scenarioObjectiveMode(s)) ?? s.result!.objective.toLocaleString()}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-2 text-muted-foreground">Weighted avg. distance ({distanceUnit})</td>
              {compareScenarios.map(s => (
                <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-distance-${s.id}`}>
                  {s.result!.metrics.weightedAvgDistance != null ? s.result!.metrics.weightedAvgDistance.toFixed(1) : "—"}
                </td>
              ))}
            </tr>
            {/* T5 (B5) — open-facility set by city, gated on
                supportsFacilityStatus (present for p-median-us/brazil AND
                two-echelon, absent for transport-coal — no facility-location
                concept there). */}
            {supportsFacilityStatus && (
              <tr>
                <td className="p-2 text-muted-foreground">Open facilities</td>
                {compareScenarios.map(s => (
                  <td key={s.id} className="p-2" data-testid={`cost-summary-compare-open-facilities-cities-${s.id}`}>
                    {locationById ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {[...openFacilityIds(s.result!)].sort().map(id => {
                          const loc = locationById[id];
                          return (
                            <span key={id} className="flex flex-col">
                              <span>{loc ? `${loc.city}, ${loc.state}` : facilityCityLabel(id, baseFacilities, extractAddedFacilities(s.inputs))}</span>
                              <span className="font-mono text-[10px] text-muted-foreground">{id}</span>
                            </span>
                          );
                        })}
                        {openFacilityIds(s.result!).size === 0 && "—"}
                      </div>
                    ) : (
                      openFacilityCityList(s.result!, s.inputs, baseFacilities)
                    )}
                  </td>
                ))}
              </tr>
            )}
            <tr>
              <td className="p-2 text-muted-foreground">Runtime</td>
              {compareScenarios.map(s => (
                <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-runtime-${s.id}`}>
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
            {sharedBands &&
              bandBoundaries(results[0]).map(band => (
                <tr key={band}>
                  <td className="p-2 text-muted-foreground font-mono">
                    ≤ {band} {distanceUnit}
                  </td>
                  {compareScenarios.map(s => {
                    const coverage = (s.result!.metrics.bandCoverage ?? []).find(b => b.band === band);
                    return (
                      <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-band-${band}-${s.id}`}>
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
