import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { type CanonicalUnit } from "@workspace/units";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";
import { BandChipEditor } from "@/components/workspace/tabs/BandChipEditor";

export type OptimizationParametersField =
  | "p"
  | "gap"
  | "timeLimitSec"
  | "distanceBands"
  // A5.1/A5.3 — model-specific solve parameters, all gated on presence the
  // same way `p` already is: undefined when the active model's inputs shape
  // has no such field (mirrors Studio.tsx's modelId-gated sections,
  // Studio.tsx:1270-1392, but generic here rather than a hardcoded modelId
  // check).
  | "capacityFactor"
  | "singleSource"
  | "capacityInactive"
  | "bomRatio"
  // C4.12 — Chen's Cosmetics (chens-cosmetics-cn) mode-specific coverage
  // params, routed through the generic `onChange` (a plain single-field draft
  // update, no cross-field coupling). `highServiceDistKm`/`maxDistKm` are
  // NOT here — they need an atomic distanceBands resync (D13/D19) and so go
  // through a dedicated `onServiceDistanceChange` callback instead.
  | "avgServiceDistCapKm"
  | "coverageFloorDemand";

interface OptimizationParametersTabProps {
  /** Active model id. jade-INT (workspace-fixups-2, item 7) — JADE (Ch.9)
   * used to render a separate fixed-4-slot `JadeBandEditor` here, gated on
   * this prop; that editor is deleted and JADE now renders the SAME shared
   * free add/remove chip band editor as every other model (its schema was
   * relaxed to `.min(1)`, matching p-median/transport/gold-au). `modelId`
   * currently has no other reader in this component, but stays on the props
   * for parity with the other model-gated sections/callers. */
  modelId?: string;
  /** Undefined when the active model has no P concept (transport-coal,
   * two-echelon-gold-au) — mirrors Studio.tsx's modelId-gated P section
   * (Studio.tsx:1155-1182), but gated here on the value's presence rather
   * than a hardcoded modelId check, so this stays generic across models. */
  p?: number;
  /** T11 (Chapter 9 JADE) — the P slider's semantic maximum. JADE has no
   * static "P ≤ 50" limit (spec §5: "the UI maximum ... use[s] the effective
   * active warehouse count, including added warehouses; there is no stale
   * static maximum of 25") — the caller (Workspace.tsx, T15.5) computes this
   * from the effective active-warehouse projection and passes it through.
   * Defaults to 50, unaffected for every existing model/caller that omits
   * it (p-median-us/brazil's real static max). */
  pMax?: number;
  gap: number;
  timeLimitSec: number;
  distanceBands: number[];
  /** transport-coal only (Studio.tsx:1274-1305). Undefined for every other
   * model. */
  capacityFactor?: number;
  /** transport-coal AND p-median-brazil both have this concept
   * (Studio.tsx:1288-1292 / 1378-1382) — gated on presence, not a single
   * hardcoded modelId, so a future sibling model that also has it isn't
   * regressed the way model-integration-precheck.md's Gate 6 warns against. */
  singleSource?: boolean;
  /** transport-coal only (Studio.tsx:1296-1305). */
  capacityInactive?: boolean;
  /** two-echelon-gold-au only (Studio.tsx:1349-1371) — the plan's explicit
   * "BOM ratio in Optimization Parameters" requirement for A5.3. */
  bomRatio?: number;
  /** C4.11 — active model's distance unit (manifest ModelInfo.distanceUnit),
   * used in the distance-bands label. Optional/defaults to "mi" so existing
   * callers stay unchanged; Chen (chens-cosmetics-cn) passes "km". Ignored
   * once `canonicalUnit` (below) is supplied — that prop supersedes this
   * label-only string for any caller that has migrated to Part D. */
  distanceUnit?: string;
  /**
   * chen-bands-units, Part D — opt-in switch, three states:
   * - `undefined` (omitted): every existing/not-yet-migrated caller is
   *   completely unaffected — the band editor and Chen's distance fields
   *   stay on the pre-Part-D raw-number behavior above, no `UnitProvider`
   *   dependency at all.
   * - `null`: the caller has opted in, but the active model's manifest
   *   (canonical distance unit) hasn't resolved yet — every distance field
   *   this component owns (the band chip editor, Chen's high/max/avg-cap)
   *   renders a disabled placeholder. No fallback unit, ever.
   * - a resolved `CanonicalUnit`: full display-unit-aware editing via
   *   `useDistanceDraft` (converted through `@workspace/units`, the single
   *   authority for the math — never re-derived here).
   * `p` / `gap` / `timeLimitSec` / `coverageFloorDemand` are NOT distances
   * and are never gated or converted by this prop.
   */
  canonicalUnit?: CanonicalUnit | null;
  // ── C4.12 — Chen's Cosmetics coverage model (chens-cosmetics-cn) ──────────
  // The whole Chen block is gated on `objective != null` (present only for
  // Chen), exactly like `p`/`bomRatio`/`capacityFactor` above — a sibling
  // model passing none of these renders none of it, so this stays generic.
  /** Coverage vs min-distance objective mode. Presence gates the Chen block. */
  objective?: "coverage" | "min_distance";
  /** Chen's two service-distance thresholds (both always visible in the
   * Chen block). Editing either re-derives `distanceBands` to `[high, max]`
   * via `onServiceDistanceChange` (D13/D19), so these do NOT flow through the
   * generic `onChange`. */
  highServiceDistKm?: number;
  maxDistKm?: number;
  /** Coverage-mode-only cap (present when `objective === "coverage"`). */
  avgServiceDistCapKm?: number;
  /** Min-distance-mode-only floor (present when `objective === "min_distance"`). */
  coverageFloorDemand?: number;
  /** Atomic mode toggle — the caller (Workspace) seeds the newly-required
   * field and CLEARS the previous mode's field in one update, matching
   * C4.6's discriminated chensInputsSchema. */
  onObjectiveModeChange?: (mode: "coverage" | "min_distance") => void;
  /** Atomic service-distance edit — the caller re-derives `distanceBands` to
   * `[high, max]` in the SAME update (D13/D19). */
  onServiceDistanceChange?: (field: "highServiceDistKm" | "maxDistKm", value: number) => void;
  /** D13/D19 — hide the free-edit distance-bands chip editor. Chen's bands
   * are DERIVED (`[high, max]`), not user-editable, so Workspace passes
   * `false` for Chen; defaults true, so every other model is unchanged. */
  showBandEditor?: boolean;
  /** A single (field, value) callback rather than per-field callbacks — this
   * composes directly with Workspace.tsx's `updateInputsField(key, value)`,
   * the same localInputs-draft mechanism WarehousesTab/CustomersTab already
   * write through (A1.1). This component holds no save state of its own;
   * every edit is just a draft update, exactly like a keystroke in the
   * Warehouses/Customers tables. */
  onChange: (field: OptimizationParametersField, value: number | number[] | boolean) => void;
}

// A1.2 — grid-style editor over the scalar solve-parameter fields
// (p/gap/timeLimitSec/distanceBands) that live in the same scenario.inputs
// blob as the Warehouses/Customers overrides. Re-homes Studio.tsx's left
// panel P slider + quick-select (Studio.tsx:1155-1182), gap/time-limit
// inputs (1184-1211), and distance-bands chip editor (1688-1744) as a
// Workspace tab — same validation (P 1-50, band values > 0/deduped/sorted,
// gap as a percentage), but as a dumb controlled form with no local
// persistence: Workspace.tsx owns localInputs/isDirty/handleSaveInputs
// (the standing manual-Save pattern from A1.1), this component only calls
// `onChange`.
export function OptimizationParametersTab({
  // modelId is intentionally NOT destructured (item 7 — JADE renders the
  // same shared chip band editor as every other model now, so nothing in
  // this component reads it); it stays on `OptimizationParametersTabProps`
  // so callers are unaffected.
  p,
  pMax = 50,
  gap,
  timeLimitSec,
  distanceBands,
  capacityFactor,
  singleSource,
  capacityInactive,
  bomRatio,
  distanceUnit,
  canonicalUnit,
  objective,
  highServiceDistKm,
  maxDistKm,
  avgServiceDistCapKm,
  coverageFloorDemand,
  onObjectiveModeChange,
  onServiceDistanceChange,
  showBandEditor = true,
  onChange,
}: OptimizationParametersTabProps) {
  // chen-bands-units, Part A — the conditionally-linked high boundary: on a
  // highServiceDistKm edit oldHigh -> newHigh, retarget a band EQUAL TO
  // oldHigh to newHigh, but ONLY if such a band is present (the user may
  // have already removed it — in which case bands stay untouched and later
  // high edits never touch them again). Dedupe + re-sort after. This is a
  // pure business-logic wrapper around `onServiceDistanceChange`, and
  // applies identically regardless of legacy vs unit-aware mode below.
  function handleHighServiceDistChange(newHigh: number) {
    const oldHigh = highServiceDistKm;
    if (oldHigh != null && oldHigh !== newHigh && distanceBands.includes(oldHigh)) {
      const nextBands = Array.from(
        new Set(distanceBands.map(b => (b === oldHigh ? newHigh : b))),
      )
        .filter(b => b > 0)
        .sort((a, b) => a - b);
      onChange("distanceBands", nextBands);
    }
    onServiceDistanceChange?.("highServiceDistKm", newHigh);
  }

  return (
    <div className="max-w-md space-y-6" data-testid="optimization-parameters-tab">
      {p != null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-foreground">Warehouses to open (P)</Label>
            <span className="text-sm font-bold text-primary font-mono" data-testid="text-p-value">{p}</span>
          </div>
          <Slider
            min={1}
            max={pMax}
            step={1}
            value={[p]}
            onValueChange={([v]) => onChange("p", v)}
            data-testid="slider-p-value"
            className="my-1"
          />
          <div className="flex gap-1.5 flex-wrap">
            {[2, 3, 4, 10, 25].filter(n => n <= pMax).map(n => (
              <button
                key={n}
                type="button"
                data-testid={`button-p-quick-${n}`}
                onClick={() => onChange("p", n)}
                className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
                  p === n ? "bg-primary text-white border-primary" : "bg-white text-foreground border-border hover:border-primary"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* C4.12 — Chen's Cosmetics coverage model. Mode toggle (objective) +
          the two always-visible service-distance thresholds + the one
          mode-specific field. No capacity concept (capacityMode "none" is
          persisted, so the Warehouses table never shows a Capacity column);
          no distance-band editor (bands are derived [high, max], D13). */}
      {objective != null && (
        <div className="space-y-4" data-testid="chen-objective-section">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground">Objective</Label>
            <div
              className="inline-flex rounded border border-border overflow-hidden"
              role="group"
              aria-label="Objective mode"
              data-testid="chen-objective-toggle"
            >
              {(["coverage", "min_distance"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  data-testid={`chen-objective-${mode}`}
                  aria-pressed={objective === mode}
                  onClick={() => onObjectiveModeChange?.(mode)}
                  className={`text-xs px-3 py-1 transition-colors ${
                    objective === mode
                      ? "bg-primary text-white"
                      : "bg-white text-foreground hover:bg-muted"
                  }`}
                >
                  {mode === "coverage" ? "Coverage" : "Min-distance"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {canonicalUnit !== undefined ? (
              <>
                <ChenDistanceInput
                  id="input-high-service-dist"
                  testId="input-high-service-dist"
                  labelPrefix="High-service distance"
                  canonicalUnit={canonicalUnit}
                  value={highServiceDistKm ?? 0}
                  onCommit={handleHighServiceDistChange}
                />
                <ChenDistanceInput
                  id="input-max-dist"
                  testId="input-max-dist"
                  labelPrefix="Max distance"
                  canonicalUnit={canonicalUnit}
                  value={maxDistKm ?? 0}
                  onCommit={v => onServiceDistanceChange?.("maxDistKm", v)}
                />
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="input-high-service-dist" className="text-xs text-muted-foreground">
                    High-service distance ({distanceUnit})
                  </Label>
                  <Input
                    id="input-high-service-dist"
                    type="number"
                    value={highServiceDistKm ?? ""}
                    onChange={e => handleHighServiceDistChange(parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm mt-1 font-mono"
                    data-testid="input-high-service-dist"
                  />
                </div>
                <div>
                  <Label htmlFor="input-max-dist" className="text-xs text-muted-foreground">
                    Max distance ({distanceUnit})
                  </Label>
                  <Input
                    id="input-max-dist"
                    type="number"
                    value={maxDistKm ?? ""}
                    onChange={e => onServiceDistanceChange?.("maxDistKm", parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm mt-1 font-mono"
                    data-testid="input-max-dist"
                  />
                </div>
              </>
            )}
          </div>

          {objective === "coverage" && (
            canonicalUnit !== undefined ? (
              <ChenDistanceInput
                id="input-avg-service-cap"
                testId="input-avg-service-cap"
                labelPrefix="Avg service distance cap"
                canonicalUnit={canonicalUnit}
                value={avgServiceDistCapKm ?? 0}
                onCommit={v => onChange("avgServiceDistCapKm", v)}
              />
            ) : (
              <div>
                <Label htmlFor="input-avg-service-cap" className="text-xs text-muted-foreground">
                  Avg service distance cap ({distanceUnit})
                </Label>
                <Input
                  id="input-avg-service-cap"
                  type="number"
                  value={avgServiceDistCapKm ?? ""}
                  onChange={e => onChange("avgServiceDistCapKm", parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm mt-1 font-mono"
                  data-testid="input-avg-service-cap"
                />
              </div>
            )
          )}

          {objective === "min_distance" && (
            <div>
              <Label htmlFor="input-coverage-floor" className="text-xs text-muted-foreground">
                Coverage floor (demand)
              </Label>
              <Input
                id="input-coverage-floor"
                type="number"
                value={coverageFloorDemand ?? ""}
                onChange={e => onChange("coverageFloorDemand", parseFloat(e.target.value) || 0)}
                className="h-8 text-sm mt-1 font-mono"
                data-testid="input-coverage-floor"
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="input-gap" className="text-xs text-muted-foreground">Optimization gap (%)</Label>
          <Input
            id="input-gap"
            type="number"
            step="0.01"
            value={gap}
            onChange={e => onChange("gap", parseFloat(e.target.value) || 0)}
            className="h-8 text-sm mt-1 font-mono"
            data-testid="input-gap"
          />
        </div>
        <div>
          <Label htmlFor="input-time-limit" className="text-xs text-muted-foreground">Max time (seconds)</Label>
          <Input
            id="input-time-limit"
            type="number"
            value={timeLimitSec}
            onChange={e => onChange("timeLimitSec", parseInt(e.target.value, 10) || 120)}
            className="h-8 text-sm mt-1 font-mono"
            data-testid="input-time-limit"
          />
        </div>
      </div>

      {/* A5.1 — transport-coal's mine capacity factor (Studio.tsx:1273-1285). */}
      {capacityFactor != null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-foreground">Mine capacity factor</Label>
            <span className="text-xs font-mono w-10 text-right">{capacityFactor.toFixed(2)}×</span>
          </div>
          <Slider
            min={0.5}
            max={2.0}
            step={0.05}
            value={[capacityFactor]}
            onValueChange={([v]) => onChange("capacityFactor", v)}
            data-testid="slider-capacity-factor"
            className="my-1"
          />
          <p className="text-[10px] text-muted-foreground">1.0 = base capacity. 1.1 = +10% slack allows cheaper routing.</p>
        </div>
      )}

      {/* A5.1/A5.2 — transport-coal's "force each station/DC to a single
          source" toggle AND p-median-brazil's identical concept
          (Studio.tsx:1286-1295 / 1376-1390) — gated on presence, shared by
          both models rather than a single hardcoded modelId check. */}
      {singleSource != null && (
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground">Single-source</Label>
          <Switch
            checked={singleSource}
            onCheckedChange={v => onChange("singleSource", v)}
            data-testid="switch-single-source"
          />
        </div>
      )}

      {/* A5.1 — transport-coal's "ignore mine capacity" toggle (Studio.tsx:1296-1305). */}
      {capacityInactive != null && (
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground">Ignore capacity</Label>
          <Switch
            checked={capacityInactive}
            onCheckedChange={v => onChange("capacityInactive", v)}
            data-testid="switch-capacity-inactive"
          />
        </div>
      )}

      {/* A5.3 — two-echelon-gold-au's BOM ratio slider (Studio.tsx:1349-1371).
          min=1.05, not 1.0: twoEchelonInputsSchema requires bomRatio strictly
          > 1 (see Studio.tsx's own comment on this same constant) — hitting
          exactly 1.0 would 422 on save. */}
      {bomRatio != null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-foreground">BOM ratio (raw kg per refined kg)</Label>
            <span className="text-xs font-mono w-10 text-right" data-testid="text-bom-ratio">{bomRatio.toFixed(2)}×</span>
          </div>
          <Slider
            min={1.05}
            max={2.0}
            step={0.05}
            value={[bomRatio]}
            onValueChange={([v]) => onChange("bomRatio", Math.round(v * 20) / 20)}
            data-testid="slider-bom-ratio"
            className="my-1"
          />
          <p className="text-[10px] text-muted-foreground">1.1 favors the customer-adjacent refinery. 2.0 favors the mine-adjacent one — watch which refinery gets selected as you sweep this.</p>
        </div>
      )}

      {/* jade-INT (workspace-fixups-2, item 7) — JADE (Ch.9) renders this
          SAME shared editor as every other model now (fixed-4-slot
          `JadeBandEditor` deleted upstream — its schema is `.min(1)` like
          p-median/transport/gold-au). chen-bands-units, T13 — re-enabled
          for Chen too (`showBandEditor` truthy) via the ONE shared
          `BandChipEditor`, which OptimizationParametersTab and SolveDialog
          both render now instead of each holding its own copy. */}
      {showBandEditor && (
        <BandChipEditor
          bands={distanceBands}
          onChange={bands => onChange("distanceBands", bands)}
          distanceUnit={distanceUnit}
          canonicalUnit={canonicalUnit}
        />
      )}
    </div>
  );
}

// chen-bands-units, T13, Step 3b — Chen's high/max/avg-cap distance fields
// adopt `useDistanceDraft` verbatim once the caller opts into `canonicalUnit`
// (see the prop doc above). This is its own component, not an inline branch
// inside `OptimizationParametersTab` itself, specifically so that hook is
// only ever called by an instance that actually mounts — a legacy caller
// that never passes `canonicalUnit` therefore never triggers `useDisplayUnit()`
// and needs no `UnitProvider` ancestor (Rules of Hooks: the hook lives in
// whichever component mounts, never in a runtime branch of one component's
// own body).
function ChenDistanceInput({
  id,
  testId,
  labelPrefix,
  canonicalUnit,
  value,
  onCommit,
}: {
  id: string;
  testId: string;
  labelPrefix: string;
  canonicalUnit: CanonicalUnit | null;
  value: number;
  onCommit: (canonicalValue: number) => void;
}) {
  const { effectiveUnit } = useDisplayUnit();
  const draft = useDistanceDraft({ canonicalUnit, value, onCommit });
  const unitLabel = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  return (
    <div>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {labelPrefix}
        {unitLabel ? ` (${unitLabel})` : ""}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft.text}
        disabled={draft.disabled}
        onChange={e => draft.onChange(e.target.value)}
        onBlur={draft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") draft.commit();
          if (e.key === "Escape") draft.discard();
        }}
        className="h-8 text-sm mt-1 font-mono"
        data-testid={testId}
      />
    </div>
  );
}
