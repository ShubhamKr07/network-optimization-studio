import { useMemo, useState, type ReactNode } from "react";
import type { GetDatasetParams, Scenario, SolveResult } from "@workspace/api-client-react";
import { getGetDatasetQueryKey, useGetDataset, useListModels } from "@workspace/api-client-react";
import { useExport } from "@/contexts/ExportContext";
import { formatChenObjective, formatObjective, objectiveModeOfDetails, scenarioObjectiveMode } from "@/lib/formatObjective";
import { buildEntityIdentityById } from "@/lib/entityIdentity";
import { classifyResultOutcome, hasIncumbent, resultQualityText } from "@/lib/resultOutcome";
import { FloorExceedsMaxAlert } from "@/components/workspace/FloorExceedsMaxAlert";
import { useDisplayUnit, type UnitApi } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
import { TEXTBOOK_TRANSPORT_COSTS, rateConversion, rateUnitLabel, type TransportCosts } from "@/lib/transportCosts";
import { OVERFLOW_BAND, bandDecimals, exclusiveBandLabels, frozenBandCoverageToExclusive, frozenBandShape } from "@/lib/bands";
import { Button } from "@/components/ui/button";
import { buildCompareCsv } from "@/lib/compareCsv";
import { downloadTextFile } from "@/lib/clientCsv";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";

// chen-bands-units, Part D "No fallback unit — reads". `formatDistance*`/
// `distanceUnitLabel` below are this file's single choke point for turning a
// CANONICAL distance number into display text — every call site routes
// through one of them instead of hand-rolling `${value} ${distanceUnit}`, so
// there is exactly one place that can ever render "—" instead of a guessed
// unit. `canonical` is `undefined` while GET /api/models hasn't resolved yet
// (or the active model id has no matching manifest entry) — in that window
// every one of these returns the placeholder, never a number under a
// guessed label.
function formatDistance(raw: number | null | undefined, canonical: CanonicalUnit | undefined, unit: UnitApi): string {
  if (raw == null || canonical == null) return "—";
  return `${unit.toDisplay(raw, canonical).toFixed(1)} ${unit.effectiveUnit(canonical)}`;
}

function formatDistanceValueOnly(raw: number | null | undefined, canonical: CanonicalUnit | undefined, unit: UnitApi): string {
  if (raw == null || canonical == null) return "—";
  return unit.toDisplay(raw, canonical).toFixed(1);
}

function formatBandList(boundaries: number[], canonical: CanonicalUnit | undefined, unit: UnitApi): string {
  if (boundaries.length === 0) return "no bands";
  if (canonical == null) return "—";
  const converted = boundaries.map(b => unit.toDisplay(b, canonical).toLocaleString()).join("/");
  return `${converted} ${unit.effectiveUnit(canonical)}`;
}

function distanceUnitLabel(canonical: CanonicalUnit | undefined, unit: UnitApi): string | null {
  return canonical == null ? null : unit.effectiveUnit(canonical);
}

// ch9-tc-9 (point 12) — the four rates a result was SOLVED AT. Read from the
// RESULT ENVELOPE's `metrics.transportRates`, never from the scenario's live
// `inputs` — for a stale scenario the inputs no longer match what the cached
// result was solved at, and sourcing from inputs would make this panel lie.
//
// Gated on `modelId`, deliberately NOT on presence — presence-only gating
// cannot render a fallback when EVERY selected envelope is a legacy one.
const JADE_MODEL_ID = "two-echelon-jade-us";
const MAX_COVERAGE_MODEL_ID = "max-coverage-us";

interface SolvedAtRates {
  rates: TransportCosts;
  legacy: boolean;
}

function solvedAtRates(result: { metrics?: { transportRates?: TransportCosts } } | null | undefined): SolvedAtRates {
  const stored = result?.metrics?.transportRates;
  return stored == null
    ? { rates: TEXTBOOK_TRANSPORT_COSTS, legacy: true }
    : { rates: stored, legacy: false };
}

const LEGACY_RATE_LABEL = "textbook default (legacy result)";

/** A rate renders in the active display unit (reciprocal conversion); a
 *  minimum charge is $/ton and never converts. Follows this file's existing
 *  no-fallback-unit convention: an unresolved canonical unit renders the
 *  shared "—" placeholder, never a guessed unit. */
function formatRate(rate: number, canonical: CanonicalUnit | undefined, unit: UnitApi): string {
  if (canonical == null) return "—";
  return rateConversion(unit).toDisplay(rate, canonical).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

interface CostSummaryTabProps {
  result: SolveResult | null;
  scenarioId: number;
  // R6+R8 — `modelId` sources the canonical distance unit + the
  // supportsFacilityStatus capability flag off GET /api/models, same pattern
  // T3 already established for ServiceStatsTab (fetch useListModels
  // internally, take modelId as a prop) rather than threading a distanceUnit
  // prop through Workspace.tsx a second way. Optional so pre-existing call
  // sites (and this file's own pre-T5 tests) keep compiling unchanged;
  // chen-bands-units, Part D — an absent/unresolved modelId means every
  // distance-bearing cell shows a loading placeholder ("—"), NEVER a
  // guessed "mi" (see `formatDistance`/`distanceUnitLabel` above).
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
   * `jadeLocationMapFromInputs`. When present (truthy, even `{}`), the
   * compare mode's "Open facilities" row switches into the per-id chip
   * layout with a mono id sub-label (mirrors JadeDistancesTab.tsx), instead
   * of the plain comma-joined `facilityCityLabel` string every other model
   * uses. Absent (undefined, back-compat default) -> unchanged rendering.
   *
   * T11 (workspace-fixups-2, item 2, "CostSummary compare is per-scenario" —
   * Codex round-3 P1, CRITICAL): this prop's VALUES are no longer read for
   * lookups — only its truthy/falsy PRESENCE still selects the rendering
   * layout (the gate itself still lives in Workspace.tsx, per that call
   * site's own "the gate lives HERE, never inside the shared components"
   * comment). Each compare COLUMN instead resolves its own city/state/
   * displayId from ITS OWN `s.inputs` via `buildEntityIdentityById` below —
   * two compare columns can share an added-facility canonical id (e.g.
   * cloned scenarios) while storing DIFFERENT locations/display codes on
   * that id, and the single active-scenario map this prop used to carry
   * would show one column's data in another column's cell. */
  locationById?: Record<string, { city: string; state: string }>;
}

const MAX_COMPARE = 4;

// SCU-1.3 (spec B1.3) — ONE row model drives both the compare <table> and its
// CSV, so the two can never disagree. `display` is the on-screen cell
// (formatted, may be JSX); `raw` is the CSV value (unformatted number or
// string; null -> empty cell, the on-screen "—" is display-only).
interface CompareCell {
  raw: number | string | null;
  display: ReactNode;
}

interface CompareRow {
  key: string;
  label: ReactNode;
  /** The CSV metric label — carries the unit when the value has one. */
  csvLabel: string | null;
  labelClassName?: string;
  cellClassName: string;
  testId: (scenarioId: number) => string;
  cells: CompareCell[];
}

// SCU-2.P3.7 (spec B2.1) — the single-scenario Solution Summary is a
// TRANSPOSED table: one row per metric, one value column (the open
// scenario). Values arrive pre-formatted; `testId` is the value cell's
// literal testid (explicit override, else the slug of the label). No column
// is filterable, so the shell never shows a filter menu here (spec B2.2).
interface SummaryRow {
  label: string;
  value: string;
  mono: boolean;
  testId: string;
}

function summaryColumns(ownName: string): ColumnDef<SummaryRow>[] {
  return [
    {
      id: "metric",
      header: "",
      kind: "text",
      // Metric tables are never filtered (user decision 2026-10-17, spec B2.2 exception).
      filter: false,
      cellClassName: "text-muted-foreground",
      value: r => r.label,
      cell: r => r.label,
    },
    {
      id: "value",
      header: ownName,
      headerTestId: "cost-summary-single-column",
      // Numbers are centred (B2.1); never filtered (spec B2.2 exception).
      kind: "number",
      filter: false,
      cellTestId: r => r.testId,
      value: r => r.value,
      cell: r => (r.mono ? <span className="font-mono">{r.value}</span> : r.value),
    },
  ];
}

const DOWNLOAD_BUTTON_CLASS =
  "text-xs border rounded px-2 py-1 hover:bg-muted disabled:opacity-50 disabled:pointer-events-none";

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

// SCU-1.2 (deviation 5) — REAL boundaries only. A `-1` overflow row is not a
// boundary: comparing it would make two scenarios with identical boundaries
// "different" whenever only one had overflow, and print "-1 mi" in the note.
function bandBoundaries(result: SolveResult): number[] {
  return (result.metrics.bandCoverage ?? []).filter(b => b.band !== OVERFLOW_BAND).map(b => b.band);
}

// C4.14 (D14) — a solved scenario's objective MODE, read off its own envelope
// `details.objective` ("coverage" | "min_distance" for Chen; null for every
// other model, which has no such discriminator). Used both to LABEL the
// objective mode-aware and to block comparing two Chen scenarios solved under
// different modes (their objectives are in different units — a coverage % and
// a demand-mi total can't share a column).
// CH4O-2 — the CH4-12-aware adapter this comment used to describe
// (`scenarioObjectiveModeCh4Aware`, which preferred `steps.*.summary` over
// `scenario.result` for max-coverage-us) is deleted along with the rest of
// the two-step machinery it supported. `scenarioObjectiveMode` (imported
// above, from `@/lib/formatObjective`) now reads `result.details.objective`
// directly, uniformly for every model including max-coverage-us — there is
// no longer a `steps`-aware branch to be byte-identical relative to.
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
  const unit = useDisplayUnit();
  const { download, disabledReasonFor } = useExport();
  // R9/R6+R8 — same lookup ServiceStatsTab.tsx already does: GET /api/models
  // is independent of everything else on this page. chen-bands-units, Part D
  // "No fallback unit — reads": `canonicalDistanceUnit` is `undefined` while
  // this hasn't resolved yet (or `modelId` has no manifest entry) — every
  // distance-bearing cell below routes through `formatDistance*`, which
  // renders "—" in that window rather than ever guessing "mi".
  const { data: models } = useListModels();
  const activeModel = models?.find(m => m.id === modelId) as
    | { distanceUnit?: CanonicalUnit; capabilities?: { supportsFacilityStatus?: boolean } }
    | undefined;
  const canonicalDistanceUnit = activeModel?.distanceUnit;
  const unitLabel = distanceUnitLabel(canonicalDistanceUnit, unit);
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

  // SCU-1.3 (spec B1.3, deviation 9) — the picker starts hidden and opens on
  // its own when 2+ scenarios are already selected at mount. Today the
  // selection always starts at [scenarioId], so that branch is unreachable;
  // it is the spec's rule written down, not a code path anything exercises.
  const [pickerOpen, setPickerOpen] = useState(() => selectedIds.length >= 2);
  // SCU-2.P3.7 — the single-mode value column is headed by the open scenario's name.
  const ownName = sameModelScenarios.find(s => s.id === scenarioId)?.name ?? "Current";
  const summaryCols = useMemo(() => summaryColumns(ownName), [ownName]);

  // CH4O-10 (decision 10) — cross-mode compare is now ALLOWED. The
  // objective-mode lock this used to enforce (C4.14/D14: a coverage-mode
  // Chapter 4 scenario and a min_distance-mode one couldn't be selected
  // together) is removed wholesale — derivation, the toggleScenario
  // refusal, the checkbox `disabled` clause, and the "(different
  // objective)" hint are all gone. This is Chapter-4-only IN EFFECT with
  // no per-model gate needed: `scenarioObjectiveMode` is `null` whenever
  // no selected scenario carries an objective mode, and only Chapter 4's
  // envelopes ever carry one — every other model is byte-for-byte
  // unaffected by the removal.
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
    <div id="cost-summary-compare-toggles" className="p-2 border-b flex-shrink-0" data-testid="cost-summary-compare-toggles">
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

  // SCU-1.3 (spec B1.3) — the bar replaces both titles: Compare toggle left,
  // Download right (null = no download in this state), picker beneath.
  const summaryBar = (download: ReactNode) => (
    <>
      <div className="flex items-center justify-between gap-2 p-2 border-b flex-shrink-0" data-testid="cost-summary-bar">
        {sameModelScenarios.length > 0 ? (
          <Button
            type="button"
            size="sm"
            data-testid="button-toggle-compare"
            aria-expanded={pickerOpen}
            aria-controls="cost-summary-compare-toggles"
            onClick={() => setPickerOpen(open => !open)}
          >
            Compare Scenario
          </Button>
        ) : (
          <span />
        )}
        {download}
      </div>
      {pickerOpen && toggleList}
    </>
  );

  if (!compareMode) {
    if (!result) {
      return (
        <div className="flex flex-col h-full overflow-hidden">
          {summaryBar(null)}
          <div className="p-4 text-sm text-muted-foreground" data-testid="cost-summary-empty">No solved result yet.</div>
        </div>
      );
    }

    // jade-T14 — Chapter 9 JADE inbound/outbound cost split. Purely additive:
    // gated on the presence of each optional metric, never on modelId — the
    // fields are simply absent for every pre-existing model's envelope, so
    // these two rows never appear for them (byte-identical row set to before
    // this task).
    // C4.14 (D14) — mode-aware objective (coverage % / min-distance demand-mi).
    // chen-bands-units, Part D decision 6 — `formatObjective` (the six-model,
    // unit-aware contract) is used ONLY once BOTH `modelId` and the model's
    // canonical distance unit are genuinely resolved; a wrong/guessed
    // `modelId` or unit would silently mislabel the objective's DIMENSION
    // (not just its number), which is worse than briefly keeping the
    // pre-existing Chen-only/no-unit formatting while the manifest loads.
    // CH4OS (spec §6.2) — a max-coverage result with no incumbent (infeasible/
    // no_solution/unbounded/error) carries solve.py's sentinel objective 0 /
    // weightedAvgDistance 0; show "No incumbent"/"—", never a fake 0. Scoped
    // to max-coverage-us (spec §11: no change to other models).
    const noIncumbent = modelId === MAX_COVERAGE_MODEL_ID && !hasIncumbent(classifyResultOutcome(result));
    const objectiveMode = objectiveModeOfDetails(result.details);
    const objectiveText = noIncumbent
      ? resultQualityText(result)
      : modelId != null && canonicalDistanceUnit != null
        ? formatObjective(modelId, objectiveMode, result.objective, canonicalDistanceUnit, unit)
        : formatChenObjective(result.objective, objectiveMode) ?? result.objective.toLocaleString();
    const rows: Array<[string, string, boolean, string?]> = [["Objective", objectiveText, true]];
    // CH4O-10 (decisions 5-8) — Chapter 4's high-service-cutoff/coverage%/
    // covered-demand rows, moved here from Service Stats. Envelope-shape
    // gate, not a modelId check -- the convention this codebase already
    // uses (supportsFacilityStatus/supportsReferenceDistances/
    // supportsPlantProductCapability are all capability/shape checks), and
    // the same test that selects the avg-distance label below.
    const ch4 = result.details as {
      coveragePct?: number; coveredDemand?: number; highServiceDistMi?: number;
      maxCoverableDemand?: number; model1?: { optimal?: boolean };
    } | undefined;
    const showCoverageRows = typeof ch4?.coveragePct === "number" || noIncumbent;
    if (showCoverageRows) {
      rows.push(
        // The SOLVED SNAPSHOT's cutoff, never localInputs: a student who
        // edits the cutoff without re-solving must still see which cutoff
        // produced the numbers beside it.
        ["High service cutoff", formatDistance(ch4?.highServiceDistMi, canonicalDistanceUnit, unit), true, "cost-summary-high-service-cutoff"],
        ["% of demand within high service", noIncumbent || ch4?.coveragePct == null ? "—" : `${ch4.coveragePct.toFixed(2)} %`, true, "cost-summary-coverage-pct"],
        ["Total demand within high service", noIncumbent ? "—" : (ch4?.coveredDemand ?? 0).toLocaleString(), true, "cost-summary-covered-demand"],
      );
    }
    // CH4OS — Model 1's result rides along on a sequential run, including an
    // infeasible one (it comes from Model 1, not Model 2).
    if (typeof ch4?.maxCoverableDemand === "number") {
      rows.push([
        ch4.model1?.optimal === false ? "Best coverable demand found (Model 1)" : "Max coverable demand (Model 1)",
        ch4.maxCoverableDemand.toLocaleString(),
        true,
        "cost-summary-max-coverable-demand",
      ]);
    }
    if (result.metrics.inboundCost != null) {
      rows.push(["Inbound cost", result.metrics.inboundCost.toLocaleString(), true]);
    }
    if (result.metrics.outboundCost != null) {
      rows.push(["Outbound cost", result.metrics.outboundCost.toLocaleString(), true]);
    }
    rows.push(
      [showCoverageRows ? "Avg distance to customers" : "Weighted avg. distance",
       noIncumbent ? "—" : formatDistance(result.metrics.weightedAvgDistance, canonicalDistanceUnit, unit), true],
      ["Runtime", `${result.runTimeSec.toFixed(2)}s`, true],
      // B4.1 — the truthful outcome (never the raw solver `result.quality`,
      // which was hardcoded "optimal" pre-B2 regardless of a gap/time-limit
      // stop). This is the live, reachable rendering path — every chapter
      // routes through Workspace.tsx, never Studio.tsx.
      ["Quality", resultQualityText(result), false],
      ["Solver", result.solverUsed, false],
    );
    // ch9-tc-9 (point 12) — the four rates this result was SOLVED AT. Gated
    // on modelId, not metric presence (see solvedAtRates' own comment).
    if (modelId === JADE_MODEL_ID) {
      const { rates, legacy } = solvedAtRates(result);
      const suffix = legacy ? ` ${LEGACY_RATE_LABEL}` : "";
      const rl = rateUnitLabel(canonicalDistanceUnit, unit);
      rows.push(
        [`Inbound rate${rl ? ` (${rl})` : ""}`, `${formatRate(rates.icTransCost, canonicalDistanceUnit, unit)}${suffix}`, true, "cost-summary-rate-ic"],
        [`Inbound min ($/ton)`, `${rates.icMinTrans.toLocaleString()}${suffix}`, true, "cost-summary-min-ic"],
        [`Outbound rate${rl ? ` (${rl})` : ""}`, `${formatRate(rates.obTransCost, canonicalDistanceUnit, unit)}${suffix}`, true, "cost-summary-rate-ob"],
        [`Outbound min ($/ton)`, `${rates.obMinTrans.toLocaleString()}${suffix}`, true, "cost-summary-min-ob"],
      );
    }

    // ch4-fixes item 3 — single-scenario now renders the SAME <table> shell
    // compare mode uses (metric column + one column per scenario), so
    // selecting a 2nd scenario only ADDS a column instead of swapping the
    // whole layout from a <dl> to a table. Applies to every model.
    //
    // The ROW SET still differs per mode by explicit decision: this mode
    // keeps "Solver" (compare has no room for it and it's near-constant),
    // and compare keeps its Open-facilities + per-band rows. Only the shell
    // and typography are shared.
    const summaryRows: SummaryRow[] = rows.map(([label, value, mono, testId]) => ({
      label,
      value,
      mono,
      testId: testId ?? `cost-summary-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    }));

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {summaryBar(
          <DownloadMenu
            testId="button-download-cost-summary"
            itemTestIds={{ csv: "button-download-cost-summary-csv", json: "button-download-cost-summary-json" }}
            onDownload={format => download("costSummary", format)}
            disabledReason={disabledReasonFor("costSummary")}
          />,
        )}
        <div className="overflow-auto flex-1 p-2">
          <FloorExceedsMaxAlert
            result={result}
            formatDistance={v => formatDistance(v, canonicalDistanceUnit, unit)}
          />
          <DataTable<SummaryRow>
            rows={summaryRows}
            rowKey={r => r.label}
            columns={summaryCols}
            ctx={{ readOnly: true, demandEditable: false }}
            testIds={{ table: "cost-summary-list" }}
          />
        </div>
      </div>
    );
  }

  // Compare mode: 2-4 solved, non-stale, same-model scenarios selected.
  // SCU-1.3 — Download CSV now exports this table (spec B1.3).
  const results = compareScenarios.map(s => s.result!);
  const sharedBands = scenariosShareBands(results);
  // CH4OS — same no-incumbent rule as the single view, per column.
  const noIncumbentFor = (s: Scenario) =>
    modelId === MAX_COVERAGE_MODEL_ID && !hasIncumbent(classifyResultOutcome(s.result!));
  // CH4O-10 (decisions 5-8/10) — same envelope-shape gate as the
  // single-scenario view, evaluated across the WHOLE selection: a selected
  // column without `details.coveragePct` renders "—" rather than dropping the
  // row for every column.
  const compareShowCoverageRows = compareScenarios.some(
    s => typeof (s.result!.details as { coveragePct?: number } | undefined)?.coveragePct === "number" || noIncumbentFor(s),
  );

  // Raw CSV values for distance-bearing rows are in the DISPLAY unit, named
  // in the label (deviation 11). null while the canonical unit is unresolved.
  const toDisplayOrNull = (v: number | null | undefined): number | null =>
    v == null || canonicalDistanceUnit == null ? null : unit.toDisplay(v, canonicalDistanceUnit);
  const unitSuffix = unitLabel ? ` (${unitLabel})` : "";
  const rateLabel = rateUnitLabel(canonicalDistanceUnit, unit);
  const rateSuffix = rateLabel ? ` (${rateLabel})` : "";
  const MONO = "p-2 font-mono";
  const legacyNote = <span className="ml-1 text-[10px] font-sans text-muted-foreground">{LEGACY_RATE_LABEL}</span>;
  const EMPTY: CompareCell = { raw: null, display: "—" };

  const compareRows: CompareRow[] = [];
  const pushRow = (row: Omit<CompareRow, "cells">, cell: (s: Scenario) => CompareCell) =>
    compareRows.push({ ...row, cells: compareScenarios.map(cell) });

  // Asymmetric conversion is CORRECT, not a bug: objectiveDimension maps
  // coverage to "percent" (non-converting) and min_distance to
  // "demand-distance" (converting), so toggling the display unit changes one
  // column and leaves its neighbour frozen. Do not "fix" this. The CSV takes
  // the solver's raw objective (deviation 11).
  pushRow(
    { key: "objective", label: "Objective", csvLabel: "Objective", cellClassName: MONO, testId: id => `cost-summary-compare-objective-${id}` },
    s => noIncumbentFor(s)
      ? { raw: null, display: resultQualityText(s.result!) }
      : {
          raw: s.result!.objective,
          display: modelId != null && canonicalDistanceUnit != null
            ? formatObjective(modelId, scenarioObjectiveMode(s), s.result!.objective, canonicalDistanceUnit, unit)
            : formatChenObjective(s.result!.objective, scenarioObjectiveMode(s)) ?? s.result!.objective.toLocaleString(),
        },
  );

  // CH4O-10 (decisions 5-8) — Chapter 4's coverage rows; decision 10 is what
  // lets a cross-mode (coverage + min_distance) selection reach them.
  if (compareShowCoverageRows) {
    pushRow(
      { key: "high-service-cutoff", label: "High service cutoff", csvLabel: `High service cutoff${unitSuffix}`, cellClassName: MONO, testId: id => `cost-summary-compare-high-service-cutoff-${id}` },
      s => {
        const v = (s.result!.details as { highServiceDistMi?: number } | undefined)?.highServiceDistMi;
        return typeof v === "number" ? { raw: toDisplayOrNull(v), display: formatDistance(v, canonicalDistanceUnit, unit) } : EMPTY;
      },
    );
    pushRow(
      { key: "coverage-pct", label: "% of demand within high service", csvLabel: "% of demand within high service", cellClassName: MONO, testId: id => `cost-summary-compare-coverage-pct-${id}` },
      s => {
        const v = (s.result!.details as { coveragePct?: number } | undefined)?.coveragePct;
        return typeof v === "number" && !noIncumbentFor(s) ? { raw: v, display: `${v.toFixed(2)} %` } : EMPTY;
      },
    );
    pushRow(
      { key: "covered-demand", label: "Total demand within high service", csvLabel: "Total demand within high service", cellClassName: MONO, testId: id => `cost-summary-compare-covered-demand-${id}` },
      s => {
        const v = (s.result!.details as { coveredDemand?: number } | undefined)?.coveredDemand;
        return typeof v === "number" && !noIncumbentFor(s) ? { raw: v, display: v.toLocaleString() } : EMPTY;
      },
    );
  }

  // CH4OS (spec §6.2) — Model 1's max coverable demand; blank for scenarios
  // whose envelope does not carry it. A not-proven value is a lower bound,
  // never "the maximum" (spec §5) — the "(best found)" suffix is display-only.
  if (compareScenarios.some(s => typeof (s.result!.details as { maxCoverableDemand?: unknown } | undefined)?.maxCoverableDemand === "number")) {
    pushRow(
      { key: "max-coverable-demand", label: "Max coverable demand (Model 1)", csvLabel: "Max coverable demand (Model 1)", cellClassName: MONO, testId: id => `cost-summary-compare-max-coverable-demand-${id}` },
      s => {
        const d = s.result!.details as { maxCoverableDemand?: number; model1?: { optimal?: boolean } } | undefined;
        return typeof d?.maxCoverableDemand === "number"
          ? { raw: d.maxCoverableDemand, display: `${d.maxCoverableDemand.toLocaleString()}${d.model1?.optimal === false ? " (best found)" : ""}` }
          : { raw: null, display: "" };
      },
    );
  }

  // ch4-fixes item 3 — JADE inbound/outbound cost split, gated on PRESENCE
  // across the selection, never on modelId; a column lacking it shows "—".
  if (compareScenarios.some(s => s.result!.metrics.inboundCost != null)) {
    pushRow(
      { key: "inbound", label: "Inbound cost", csvLabel: "Inbound cost", cellClassName: MONO, testId: id => `cost-summary-compare-inbound-${id}` },
      s => s.result!.metrics.inboundCost != null ? { raw: s.result!.metrics.inboundCost, display: s.result!.metrics.inboundCost.toLocaleString() } : EMPTY,
    );
  }
  if (compareScenarios.some(s => s.result!.metrics.outboundCost != null)) {
    pushRow(
      { key: "outbound", label: "Outbound cost", csvLabel: "Outbound cost", cellClassName: MONO, testId: id => `cost-summary-compare-outbound-${id}` },
      s => s.result!.metrics.outboundCost != null ? { raw: s.result!.metrics.outboundCost, display: s.result!.metrics.outboundCost.toLocaleString() } : EMPTY,
    );
  }

  // ch9-tc-9 (point 12) — the four rates EACH column's own result was SOLVED
  // AT. Gated on modelId, not metric presence — an all-legacy selection still
  // renders these rows with a labelled fallback.
  if (modelId === JADE_MODEL_ID) {
    const rateRaw = (rate: number) =>
      canonicalDistanceUnit == null ? null : rateConversion(unit).toDisplay(rate, canonicalDistanceUnit);
    pushRow(
      { key: "rate-ic", label: `Inbound rate${rateSuffix}`, csvLabel: `Inbound rate${rateSuffix}`, cellClassName: MONO, testId: id => `cost-summary-compare-rate-ic-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rateRaw(rates.icTransCost), display: <>{formatRate(rates.icTransCost, canonicalDistanceUnit, unit)}{legacy && legacyNote}</> };
      },
    );
    pushRow(
      { key: "min-ic", label: "Inbound min ($/ton)", csvLabel: "Inbound min ($/ton)", cellClassName: MONO, testId: id => `cost-summary-compare-min-ic-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rates.icMinTrans, display: <>{rates.icMinTrans.toLocaleString()}{legacy && legacyNote}</> };
      },
    );
    pushRow(
      { key: "rate-ob", label: `Outbound rate${rateSuffix}`, csvLabel: `Outbound rate${rateSuffix}`, cellClassName: MONO, testId: id => `cost-summary-compare-rate-ob-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rateRaw(rates.obTransCost), display: <>{formatRate(rates.obTransCost, canonicalDistanceUnit, unit)}{legacy && legacyNote}</> };
      },
    );
    pushRow(
      { key: "min-ob", label: "Outbound min ($/ton)", csvLabel: "Outbound min ($/ton)", cellClassName: MONO, testId: id => `cost-summary-compare-min-ob-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rates.obMinTrans, display: <>{rates.obMinTrans.toLocaleString()}{legacy && legacyNote}</> };
      },
    );
  }

  const distanceLabel = `${compareShowCoverageRows ? "Avg distance to customers" : "Weighted avg. distance"}${unitSuffix}`;
  pushRow(
    { key: "distance", label: distanceLabel, csvLabel: distanceLabel, cellClassName: MONO, testId: id => `cost-summary-compare-distance-${id}` },
    s => noIncumbentFor(s)
      ? EMPTY
      : { raw: toDisplayOrNull(s.result!.metrics.weightedAvgDistance), display: formatDistanceValueOnly(s.result!.metrics.weightedAvgDistance, canonicalDistanceUnit, unit) },
  );

  // T5 (B5) — open-facility set by city, gated on supportsFacilityStatus.
  // T11 (critical fix) — PER-SCENARIO identity, resolved from THIS column's
  // own `s.inputs`; `locationById`'s mere presence selects the layout (its
  // VALUES are ignored). CSV value (review fold 1): the SAME labels the cell
  // shows — never raw ids — so the export reads like the table.
  if (supportsFacilityStatus) {
    pushRow(
      { key: "open-facilities", label: "Open facilities", csvLabel: "Open facilities", cellClassName: "p-2", testId: id => `cost-summary-compare-open-facilities-cities-${id}` },
      s => {
        const ids = [...openFacilityIds(s.result!)].sort();
        const identity = locationById ? buildEntityIdentityById(modelId, dataset, s.inputs) : null;
        if (!identity) {
          const text = openFacilityCityList(s.result!, s.inputs, baseFacilities); // "—" when none
          return { raw: text === "—" ? null : text, display: text };
        }
        const labels = ids.map(id => {
          const entry = identity[id];
          return entry && (entry.city || entry.state)
            ? `${entry.city}, ${entry.state}`
            : facilityCityLabel(id, baseFacilities, extractAddedFacilities(s.inputs));
        });
        const display = (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {ids.map((id, i) => (
              <span key={id} className="flex flex-col" data-testid={`cost-summary-compare-open-facility-${s.id}-${id}`}>
                <span>{labels[i]}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{identity[id]?.displayId ?? id}</span>
              </span>
            ))}
            {ids.length === 0 && "—"}
          </div>
        );
        return { raw: labels.length > 0 ? labels.join("; ") : null, display };
      },
    );
  }

  pushRow(
    { key: "runtime", label: "Runtime", csvLabel: "Runtime (s)", cellClassName: MONO, testId: id => `cost-summary-compare-runtime-${id}` },
    s => ({ raw: s.result!.runTimeSec, display: `${s.result!.runTimeSec.toFixed(2)}s` }),
  );
  pushRow(
    { key: "quality", label: "Quality", csvLabel: "Quality", cellClassName: "p-2", testId: id => `cost-summary-compare-quality-${id}` },
    s => ({ raw: resultQualityText(s.result!), display: resultQualityText(s.result!) }),
  );

  // SCU-1.2/1.3 (spec B1.9) — EXCLUSIVE band rows + overflow, only when every
  // column shares the same real boundaries.
  if (sharedBands) {
    const boundaries = bandBoundaries(results[0]);
    const fmt = (v: number) =>
      unit.toDisplay(v, canonicalDistanceUnit!).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });
    const labels = unitLabel == null
      ? [...boundaries, OVERFLOW_BAND].map(() => "—")
      : exclusiveBandLabels(boundaries, fmt, unitLabel);
    const exclusiveByColumn = compareScenarios.map(s =>
      frozenBandCoverageToExclusive(s.result!.metrics.bandCoverage, bandDecimals(modelId), frozenBandShape(modelId)),
    );
    [...boundaries, OVERFLOW_BAND].forEach((band, i) => {
      compareRows.push({
        key: `band-${band}`,
        label: labels[i],
        // Unit unresolved -> every label is "—"; omit rather than emit duplicate metric cells.
        csvLabel: unitLabel == null ? null : `${labels[i]} (%)`,
        labelClassName: "font-mono",
        cellClassName: MONO,
        testId: id => `cost-summary-compare-band-${band}-${id}`,
        cells: exclusiveByColumn.map(rows => {
          const coverage = rows?.find(b => b.band === band);
          return coverage ? { raw: coverage.percent, display: `${coverage.percent}%` } : EMPTY;
        }),
      });
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {summaryBar(
        <button
          type="button"
          data-testid="button-download-cost-summary-csv"
          className={DOWNLOAD_BUTTON_CLASS}
          onClick={() => downloadTextFile("cost-summary-compare.csv", buildCompareCsv(compareRows, compareScenarios), "text/csv")}
        >
          Download CSV
        </button>,
      )}
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
            {compareRows.map(row => (
              <tr key={row.key}>
                <td className={`p-2 text-muted-foreground${row.labelClassName ? ` ${row.labelClassName}` : ""}`}>{row.label}</td>
                {compareScenarios.map((s, col) => (
                  <td key={s.id} className={row.cellClassName} data-testid={row.testId(s.id)}>
                    {row.cells[col].display}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!sharedBands && (
          <p className="text-xs text-muted-foreground p-2" data-testid="cost-summary-compare-bands-note">
            Selected scenarios use different distance bands — band coverage isn't shown side by side.{" "}
            {compareScenarios.map(s => `${s.name}: ${formatBandList(bandBoundaries(s.result!), canonicalDistanceUnit, unit)}`).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
