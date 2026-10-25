import { useMemo, useRef, useState } from "react";
import { formatChenObjective, formatObjective, objectiveModeOfDetails } from "@/lib/formatObjective";
import { formatDistanceDisplay } from "@/lib/formatDistanceDisplay";
import type { Dataset, Plant, SolveResult } from "@workspace/api-client-react";
import { useListModels } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { NetworkMap } from "@/components/NetworkMap";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import type { CountryBounds } from "@/lib/mapBounds";
import { copyMapToClipboard, downloadMapAsPng, isClipboardImageWriteSupported } from "@/lib/copyMapToClipboard";
import { toast } from "@/hooks/use-toast";
import { classifyResultOutcome, hasIncumbent, resultQualityText } from "@/lib/resultOutcome";
import { FloorExceedsMaxAlert } from "@/components/workspace/FloorExceedsMaxAlert";
import { buildResultNarrative, legLabel } from "@/lib/resultNarrative";
import { formatCityState } from "@/lib/formatLocation";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { OutputMapNarrative } from "@/components/workspace/tabs/OutputMapNarrative";
import { chapterForModelId } from "@/lib/chapters";
import { MINE_ROLE, PLANT_ROLE } from "@/components/workspace/map/types";
import { OpenSitesCaption } from "@/components/workspace/OpenSitesCaption";

// jade-B1 (#8 timing overlay, spec §9) — a frozen, per-history-entry solve
// timing. Optional/no default — when the caller (eventually INT) has no
// matching timing for the displayed result, the timing line is simply
// suppressed (renders nothing) rather than showing a mismatched value.
export interface SolveTiming {
  totalSec: number;
  queuedSec: number;
  activeSec: number;
}

// Local — mirrors NetworkMap's own (unexported) WarehouseStatusEntry shape;
// Studio.tsx derives the same inline shape at its call site rather than
// importing a type NetworkMap doesn't expose (D0.1: warehouseStatuses became
// a purely local rendering concept once Scenario.inputs went opaque).
interface WarehouseStatusEntry {
  warehouseId: string;
  status: "forced_open" | "inactive";
}

// T6/R7 — the minimal shape this tab needs from a scenario's
// addedWarehouses/addedCustomers (Workspace.tsx's own AddedWarehouse/
// AddedCustomer types carry extra fields — capacity/status/displayCode —
// this tab doesn't need any of them; a route/marker only needs id+coords,
// a customer marker also needs demand).
interface EffectiveAddedWarehouse {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

interface EffectiveAddedCustomer extends EffectiveAddedWarehouse {
  demand: number;
}

interface OutputMapTabProps {
  // T5 (Bundle 2) — required for every model now: p-median-brazil got its
  // own GET /dataset endpoint (T3) and migrated off the BrazilMap branch
  // this prop's own optionality used to carve out (see this file's own
  // NetworkMap-migration comment below). Workspace.tsx's call site still
  // waits on its own `!dataset` loading guard before rendering this tab.
  dataset: Dataset;
  warehouseStatuses: WarehouseStatusEntry[];
  // Null both pre-solve and whenever this tab isn't the active one — the
  // caller (Workspace.tsx) is responsible for that gating (mirrors Studio.
  // tsx's `activeTab === "output" ? result : null` pattern), so a stale
  // result never bleeds in from an unrelated tab even if this component were
  // ever kept mounted off-screen.
  result: SolveResult | null;
  // Reuses Workspace.tsx's distanceBandsFromInputs(localInputs) — same
  // source of truth as the Optimization Parameters tab, never recomputed a
  // second way. Empty when the scenario hasn't configured bands yet; DD-5's
  // 250/500/750 default is applied here, once, purely for lane-coloring
  // display — it is never written back onto the scenario.
  bands: number[];
  countryBounds?: CountryBounds;
  // T6/R7 (fast-followed to p-median-brazil by T5) — Workspace.tsx's own
  // addedWarehousesFromInputs/addedCustomersFromInputs applied to the
  // DISPLAYED solve's inputs snapshot (displayedInputs), never the editable
  // localInputs draft — so an unsaved add/move, or stepping the
  // result-history stepper to an older entry, always shows the geometry
  // that solve actually used. Unioned onto `dataset` below to build R7's
  // "effective output dataset" (base + added) — filtering `dataset` alone
  // would silently drop an opened added warehouse (and its route), since it
  // doesn't exist in the base dataset.
  addedWarehouses?: EffectiveAddedWarehouse[];
  addedCustomers?: EffectiveAddedCustomer[];
  // T6/R7 (fast-followed to p-median-brazil by T5) — when true, the map
  // renders only warehouses the solver actually opened; closed candidates
  // are omitted. Every other model's Output Map is unaffected (defaults to
  // false, same as NetworkMap's own prop).
  hideClosedWarehouses?: boolean;
  // B2.1-T2 (item 2) — resolves the metric overlay's distance unit via
  // useListModels(), same pattern as ServiceStatsTab's own optional
  // modelId prop. Optional/defaults to "mi" so any call site that hasn't
  // threaded it through yet keeps compiling unchanged.
  modelId?: string;
  // jade-B1 (#2) — Chapter 9 JADE's plant echelon. Optional, default `[]` —
  // every non-JADE caller (and every existing test literal) is unaffected.
  // Passed straight through to NetworkMap's own `plants` prop (INT is
  // responsible for supplying `effectivePlants = dataset.plants ∪
  // displayedInputs.addedPlants`, per spec §3's review R2-4 — this tab
  // itself has no opinion on where the array comes from).
  plants?: Plant[];
  // jade-B1 (#8 timing overlay) — optional frozen solve timing for the
  // DISPLAYED result/history entry. Suppressed entirely when absent (e.g.
  // no caller has wired it yet, or the displayed entry has no matching
  // timing — INT's job, per spec §9).
  timing?: SolveTiming;
  // T9 (workspace-fixups-2, item 4) — canonical id -> human display id,
  // forwarded verbatim to NetworkMap's own `displayIdById` prop (T5). This
  // tab has no opinion on where the map comes from — INT is responsible
  // for supplying it from the solved-snapshot `outputIdentityById` (which
  // already covers plants). Optional, default `{}` so every existing call
  // site that hasn't wired it yet renders unchanged raw-id tooltips.
  displayIdById?: Record<string, string>;
  // NAR-1 — the SOLVED snapshot's canonical id -> {city, state} identity
  // (Workspace's outputIdentityById); the narrative names sites "City, ST".
  identityById?: Record<string, EntityIdentity>;
  // NAR-1 — the newest EARLIER result-history entry of the same objective
  // (Workspace picks it from its in-memory history; no fetch), for the
  // narrative's "vs your previous run" parenthetical. Absent = no comparison.
  previousResult?: SolveResult | null;
}

// A3.1 — Output Map tab: re-homes NetworkMap with independent layer toggles
// (warehouses / customers / lanes) and a plain-vs-distance-band lane-coloring
// control (DD-5). NetworkMap itself is reused as-is aside from two minimal,
// justified prop additions (showWarehouseMarkers/showCustomerMarkers — see
// NetworkMap.tsx's own comment for why dataset-filtering couldn't achieve
// the same result for those two layers without also silently dropping
// routes). The "Lanes" toggle needs no NetworkMap change at all — it maps
// directly onto the existing showRoutes prop. "Plain" lane coloring needs no
// NetworkMap change either — passing an empty bands array makes
// assignBand()/getBandColor() resolve every edge to the same band-0 color,
// which NetworkMap already does unmodified.
export function OutputMapTab({
  dataset, warehouseStatuses, result, bands, countryBounds,
  addedWarehouses = [], addedCustomers = [], hideClosedWarehouses = false, modelId,
  plants = [], timing, displayIdById = {}, identityById = {}, previousResult = null,
}: OutputMapTabProps) {
  const unit = useDisplayUnit();
  const [showWarehouses, setShowWarehouses] = useState(true);
  const [showCustomers, setShowCustomers] = useState(true);
  const [showLanes, setShowLanes] = useState(true);
  const [showPlants, setShowPlants] = useState(true);
  const [laneColour, setLaneColour] = useState<"band" | "leg" | "none">("band");
  const mapRef = useRef<HTMLDivElement>(null);
  const [clipboardSupported] = useState(() => isClipboardImageWriteSupported());

  // jade-T15.6 — per-leg lane visibility. Two-echelon models (two-echelon-
  // gold-au, two-echelon-jade-us) tag each edge with a `leg`; every
  // single-echelon model's edges have no `leg` at all. Distinct legs are
  // derived from the RESULT itself (never a modelId check), in first-
  // appearance order (solve.py emits inbound edges before outbound ones, so
  // this naturally orders "Plant → Warehouse" before "Warehouse →
  // Customer" with no extra sort). A result with fewer than 2 distinct legs
  // (every single-echelon model, or pre-solve/no result) shows no per-leg
  // toggles at all — unchanged behavior, not a regression.
  const distinctLegs = useMemo(() => {
    if (!result) return [];
    const seen: string[] = [];
    for (const edge of result.edges) {
      if (edge.leg != null && !seen.includes(edge.leg)) seen.push(edge.leg);
    }
    return seen;
  }, [result]);
  const [hiddenLegs, setHiddenLegs] = useState<Set<string>>(new Set());
  const showLegToggles = distinctLegs.length >= 2;
  // undefined (show every leg, NetworkMap's own "no filtering" default) when
  // there's no multi-leg concept for this result — only meaningfully
  // restrict once real per-leg toggles are shown.
  const visibleLegs = showLegToggles
    ? distinctLegs.filter(leg => !hiddenLegs.has(leg))
    : undefined;

  function toggleLeg(leg: string, checked: boolean) {
    setHiddenLegs(prev => {
      const next = new Set(prev);
      if (checked) next.delete(leg);
      else next.add(leg);
      return next;
    });
  }

  // chen-bands-units, Part D "No fallback unit — reads": the canonical unit
  // comes from the active model's manifest (G1.1) via GET /api/models and is
  // `null` until it genuinely resolves. There is deliberately no
  // unconditional mi-defaulting fallback here: Chen is a km model, so a
  // fallback would not render a slightly-wrong label, it would render a
  // CORRECT number under a WRONG unit — which a student reads as fact.
  // Unresolved renders a placeholder instead.
  const { data: models } = useListModels();
  const activeModel = models?.find(m => m.id === modelId) as { distanceUnit?: string } | undefined;
  const distanceUnit: CanonicalUnit | null =
    activeModel?.distanceUnit === "km" || activeModel?.distanceUnit === "mi"
      ? activeModel.distanceUnit
      : null;
  /** A canonical distance rendered in the current display unit, or `—` while
   *  the canonical unit is unresolved. Never falls back to a unit. */
  const showDistance = (canonicalValue: number): string =>
    distanceUnit == null
      ? "—"
      : `${formatDistanceDisplay(unit.toDisplay(canonicalValue, distanceUnit))} ${unit.effectiveUnit(distanceUnit)}`;

  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;
  const otherLaneColour = modelId === "two-echelon-gold-au" || modelId === "two-echelon-jade-us" || modelId === "super-model" ? "leg" : "none";
  const mapBands = laneColour === "band" ? effectiveBands : [];

  // ch5-edit-12 — infeasible/no_solution/unbounded/error all carry a
  // meaningless `objective: 0`/`weightedAvgDistance: 0` sentinel from
  // solve.py (see resultOutcome.ts's own comment); rendering those as a
  // real "Objective: 0" reads as a $0-cost success to a student. Gated on
  // the shared classification, never on `result.objective === 0` (a
  // genuinely zero objective on a real incumbent must still render
  // normally) and never on modelId (every model shares this overlay).
  // resultQualityText is reused verbatim so this overlay and Solution
  // Summary's "Quality" row never disagree on wording.
  const outcome = result ? classifyResultOutcome(result) : null;
  const showIncumbent = result != null && outcome != null && hasIncumbent(outcome);

  // NAR-1 — the narrative reads the SAME band lens the lanes are coloured
  // with (effectiveBands, not mapBands: unticking "Color lanes" must not
  // change the sentence) and names sites "City, ST".
  const nameById = useMemo(
    () => Object.fromEntries(Object.entries(identityById).map(([id, i]) => [id, formatCityState(i.city, i.state)])),
    [identityById],
  );
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const narrative =
    result && modelId
      ? buildResultNarrative(modelId, result, {
          bands: effectiveBands,
          distance: distanceUnit == null
            ? null
            : { toDisplay: v => unit.toDisplay(v, distanceUnit), unit: unit.effectiveUnit(distanceUnit) },
          nameById,
          previous: previousResult,
          selectedWarehouseId,
          demandUnit: chapterForModelId(modelId)?.demandUnit,
          sourceRole: modelId === "two-echelon-gold-au" ? MINE_ROLE.label : PLANT_ROLE.label,
        })
      : null;

  async function handleCopy() {
    if (!mapRef.current) return;
    try {
      const outcome = await copyMapToClipboard(mapRef.current);
      toast({
        title: outcome === "copied" ? "Map copied to clipboard" : "Clipboard unavailable — downloaded as PNG instead",
      });
    } catch (err) {
      // Both the clipboard write AND its own download fallback failed
      // (e.g. the underlying capture itself threw) — surface it rather
      // than leaving an unhandled rejection.
      toast({
        title: "Copy failed",
        description: err instanceof Error ? err.message : "Could not capture the map.",
        variant: "destructive",
      });
    }
  }

  async function handleDownload() {
    if (!mapRef.current) return;
    try {
      await downloadMapAsPng(mapRef.current);
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Could not capture the map.",
        variant: "destructive",
      });
    }
  }

  const copyDownloadButtons = (
    <div className="flex items-center gap-2 ml-auto">
      <button
        type="button"
        data-testid="button-download-map-png"
        className="text-xs border rounded px-2 py-1 hover:bg-muted"
        onClick={handleDownload}
      >
        Download PNG
      </button>
      {clipboardSupported && (
        <button
          type="button"
          data-testid="button-copy-map-clipboard"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={handleCopy}
        >
          Copy to clipboard
        </button>
      )}
    </div>
  );

  // T6/R7 — effective output dataset: base dataset ∪ this solve snapshot's
  // added warehouses/customers, at THEIR solve-time coordinates
  // (addedWarehouses/addedCustomers are already sourced from
  // displayedInputs by the caller — see this prop's own comment). Both
  // default to [] for every model that doesn't pass them, so this is a
  // no-op merge (dataset unchanged) everywhere except p-median-us/
  // p-median-brazil.
  const effectiveDataset: Dataset = {
    warehouses: [
      ...dataset.warehouses,
      ...addedWarehouses.map(w => ({ id: w.id, city: w.city, state: w.state, lat: w.lat, lng: w.lng })),
    ],
    customers: [
      ...dataset.customers,
      ...addedCustomers.map(c => ({ id: c.id, city: c.city, state: c.state, lat: c.lat, lng: c.lng, demand: c.demand })),
    ],
  };

  return (
    <div className="h-full flex flex-col gap-3" data-testid="output-map-tab">
      <div className="flex items-center gap-5 flex-wrap flex-shrink-0" data-testid="output-map-toggles">
        <div className="flex items-center gap-1.5">
          <label className="inline-flex h-6 w-6 items-center justify-center">
            <Checkbox
              id="output-map-toggle-warehouses"
              checked={showWarehouses}
              onCheckedChange={checked => setShowWarehouses(checked === true)}
              data-testid="checkbox-toggle-warehouses"
            />
          </label>
          <Label htmlFor="output-map-toggle-warehouses" className="text-xs inline-flex min-h-6 items-center">Warehouses</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="inline-flex h-6 w-6 items-center justify-center">
            <Checkbox
              id="output-map-toggle-customers"
              checked={showCustomers}
              onCheckedChange={checked => setShowCustomers(checked === true)}
              data-testid="checkbox-toggle-customers"
            />
          </label>
          <Label htmlFor="output-map-toggle-customers" className="text-xs inline-flex min-h-6 items-center">Customers</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="inline-flex h-6 w-6 items-center justify-center">
            <Checkbox
              id="output-map-toggle-lanes"
              checked={showLanes}
              onCheckedChange={checked => setShowLanes(checked === true)}
              data-testid="checkbox-toggle-lanes"
            />
          </label>
          <Label htmlFor="output-map-toggle-lanes" className="text-xs inline-flex min-h-6 items-center">Lanes</Label>
        </div>
        {/* jade-B1 (#2) — only shown when there's a plant echelon to toggle
            at all (mirrors showLegToggles' distinctLegs.length>=2 gate), so
            no non-JADE model ever shows an irrelevant "Plants" checkbox. */}
        {plants.length > 0 && (
          <div className="flex items-center gap-1.5">
            <label className="inline-flex h-6 w-6 items-center justify-center">
              <Checkbox
                id="output-map-toggle-plants"
                checked={showPlants}
                onCheckedChange={checked => setShowPlants(checked === true)}
                data-testid="checkbox-toggle-plants"
              />
            </label>
            <Label htmlFor="output-map-toggle-plants" className="text-xs inline-flex min-h-6 items-center">Plants</Label>
          </div>
        )}
        <div role="group" aria-label="Lane colour" data-testid="segmented-lane-colour" className="flex items-center gap-1.5 pl-3 border-l">
          <span className="text-xs">Lane colour</span>
          <div className="inline-flex rounded-md border overflow-hidden">
            {([["band", "Distance band"], [otherLaneColour, otherLaneColour === "leg" ? "Leg" : "None"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={laneColour === value}
                disabled={!showLanes}
                onClick={() => setLaneColour(value)}
                data-testid={`segment-lane-colour-${value}`}
                className={`min-h-6 px-2 text-xs disabled:opacity-50 ${laneColour === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {showLegToggles && (
          <div className="flex items-center gap-3 pl-3 border-l" data-testid="output-map-leg-toggles">
            {distinctLegs.map(leg => (
              <div key={leg} className="flex items-center gap-1.5">
                <label className="inline-flex h-6 w-6 items-center justify-center">
                  <Checkbox
                    id={`output-map-toggle-leg-${leg}`}
                    checked={!hiddenLegs.has(leg)}
                    onCheckedChange={checked => toggleLeg(leg, checked === true)}
                    data-testid={`checkbox-toggle-leg-${leg}`}
                  />
                </label>
                <Label htmlFor={`output-map-toggle-leg-${leg}`} className="text-xs inline-flex min-h-6 items-center">{legLabel(leg)}</Label>
              </div>
            ))}
          </div>
        )}
        {copyDownloadButtons}
        {!result && (
          <span className="text-xs text-muted-foreground" data-testid="output-map-no-result">
            No solve result yet — showing the input network.
          </span>
        )}
      </div>

      {/* CH4OS (spec §6.3) — same alert as Solution Summary, above the map so
          it never covers it; self-gated, renders nothing otherwise. */}
      <FloorExceedsMaxAlert result={result} formatDistance={showDistance} className="mx-2 mt-2" />

      {/* QFX-8 — open-site caption directly above the map (outside mapRef, so
          the PNG/clipboard capture is unchanged). A failed result keeps stale
          ids in details on some envelopes, so only an incumbent is captioned. */}
      <OpenSitesCaption result={showIncumbent ? result : null} modelId={modelId} identityById={identityById} />

      <div className="flex-1 min-h-0 relative" ref={mapRef}>
        {/* B2.1-T2 (item 2) — floating objective/weighted-avg-distance card.
            `result` here is `displayedResult` at the Workspace.tsx call
            site, so this follows the result-history stepper automatically.
            pointer-events-none so it never blocks map pan/zoom/click;
            top-right is otherwise unused (NetworkMap's own legend is
            bottom-right, Leaflet's zoom control is top-left). */}
        {result && (
          <div
            data-testid="output-map-metric-overlay"
            className="absolute top-2 right-2 z-[1000] pointer-events-none bg-background/80 backdrop-blur rounded-md border shadow px-2.5 py-1.5 text-xs leading-tight"
          >
            {showIncumbent ? (
              <>
                <div>
                  <span className="text-muted-foreground">Objective: </span>
                  <span className="font-medium font-mono">{modelId != null && distanceUnit != null
                      ? formatObjective(modelId, objectiveModeOfDetails(result.details), result.objective, distanceUnit, unit)
                      : formatChenObjective(result.objective, objectiveModeOfDetails(result.details)) ?? result.objective.toLocaleString("en-US")}</span>
                </div>
                {/* jade-B1 (#3 three weighted-average distances, spec §4) — a
                    two-echelon result (>=2 avgDistanceByLeg entries) shows one
                    labelled line per leg PLUS an overall line; every other
                    (single-leg/no-leg) model keeps the single existing line.
                    Labels derive from the leg string itself via the same
                    legLabel() this file already uses for the leg-toggle
                    checkboxes above — never a hardcoded "Plant"/"Warehouse"
                    allowlist, so this generalizes to any two-echelon model. */}
                {result.metrics.avgDistanceByLeg && result.metrics.avgDistanceByLeg.length >= 2 ? (
                  <>
                    {result.metrics.avgDistanceByLeg.map(l => (
                      <div key={l.leg} data-testid={`output-map-leg-avg-${l.leg}`}>
                        <span className="text-muted-foreground">{legLabel(l.leg)} avg distance: </span>
                        <span className="font-medium font-mono">{showDistance(l.avgDistance)}</span>
                      </div>
                    ))}
                    <div data-testid="output-map-overall-avg">
                      <span className="text-muted-foreground">Overall avg distance: </span>
                      <span className="font-medium font-mono">
                        {result.metrics.weightedAvgDistance != null ? showDistance(result.metrics.weightedAvgDistance) : "—"}
                      </span>
                    </div>
                  </>
                ) : (
                  <div>
                    <span className="text-muted-foreground">Weighted avg distance: </span>
                    <span className="font-medium font-mono">
                      {result.metrics.weightedAvgDistance != null ? showDistance(result.metrics.weightedAvgDistance) : "—"}
                    </span>
                  </div>
                )}
              </>
            ) : (
              // ch5-edit-12 — no incumbent to report (infeasible/no_solution/
              // unbounded/error). Truthful text, not a 0/— number that reads
              // as a real result — matches resultQualityText's own wording
              // (CostSummaryTab's "Quality" row) so the two surfaces agree.
              <div data-testid="output-map-no-incumbent">
                <span className="text-muted-foreground">Objective: </span>
                <span className="font-medium text-warning">{resultQualityText(result!)}</span>
              </div>
            )}
            {/* jade-B1 (#8 timing overlay, spec §9) — suppressed entirely
                (no DOM at all) when the caller has no matching timing for
                the displayed result, per the spec's explicit "suppress
                rather than show a mismatched value" resolution. */}
            {timing && (
              <div data-testid="output-map-timing">
                <span className="text-muted-foreground">Solve time: </span>
                <span className="font-medium font-mono">{timing.totalSec.toFixed(1)}s</span>
                <span className="text-muted-foreground"> (queued {timing.queuedSec.toFixed(1)}s · active {timing.activeSec.toFixed(1)}s)</span>
              </div>
            )}
          </div>
        )}
        <NetworkMap
          dataset={effectiveDataset}
          warehouseStatuses={warehouseStatuses}
          result={result}
          showRoutes={showLanes}
          bands={mapBands}
          labelBands={effectiveBands}
          countryBounds={countryBounds}
          showWarehouseMarkers={showWarehouses}
          showCustomerMarkers={showCustomers}
          multiSelectedWarehouseIds={[]}
          multiSelectedCustomerIds={[]}
          onToggleWarehouseMultiSelect={() => {}}
          onToggleCustomerMultiSelect={() => {}}
          hideClosedWarehouses={hideClosedWarehouses}
          distanceUnit={distanceUnit}
          visibleLegs={visibleLegs}
          plants={plants}
          showPlantMarkers={showPlants}
          modelId={modelId}
          displayIdById={displayIdById}
          onWarehouseSelectionChange={setSelectedWarehouseId}
        />
      </div>
      {narrative && <OutputMapNarrative narrative={narrative} />}
    </div>
  );
}
