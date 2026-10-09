import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { type CanonicalUnit, deriveMaxCoverageObjective } from "@workspace/units";
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
  // C4.12 — Chen's Cosmetics (max-coverage-us) mode-specific coverage
  // params, routed through the generic `onChange` (a plain single-field draft
  // update, no cross-field coupling). `highServiceDistMi`/`maxDistMi` are
  // NOT here — they need an atomic distanceBands resync (D13/D19) and so go
  // through a dedicated `onServiceDistanceChange` callback instead.
  | "avgServiceDistCapMi"
  | "coverageFloorDemand"
  // ch5-del-10 — delivery-teaching-us's Adjust Cost Table feature. Gated on
  // presence like every other model-specific field above, never on modelId.
  | "costAdjustEnabled"
  | "distanceThreshold"
  | "costPerMile"
  | "costPerMileOver";

// CH4UX-2 — exported because Workspace.tsx now builds ONE base prop object
// consumed by two renders (the tab itself and the Solve dialog's embedded
// copy). The annotation is documentation, not enforcement: most of this
// interface is optional, so a future added prop will NOT fail the build
// here. The real drift protection is the single base object.
export interface OptimizationParametersTabProps {
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
   * callers stay unchanged; every model including Chen (max-coverage-us) is
   * "mi" as of CH4O-8, but the caller still passes the manifest value. Ignored
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
  // ── C4.12/CH4O-7 — Chen's Cosmetics coverage model (max-coverage-us) ───
  // The whole Chen block is gated on `highServiceDistMi != null` (present
  // only for Chen), exactly like `p`/`bomRatio`/`capacityFactor` above — a
  // sibling model passing none of these renders none of it, so this stays
  // generic. CH4O-7 — there is no `objective` prop any more: the mode is
  // fully derived (both server- and client-side) from `coverageFloorDemand`
  // via `deriveMaxCoverageObjective`, and displayed, never chosen, by the
  // `derived-model-line` rendered below.
  /** Chen's two service-distance thresholds (both always visible in the
   * Chen block). Editing either re-derives `distanceBands` to `[high, max]`
   * via `onServiceDistanceChange` (D13/D19), so these do NOT flow through the
   * generic `onChange`. */
  highServiceDistMi?: number;
  maxDistMi?: number;
  /** CH4O-5 — the weighted-average service-distance cap. No longer
   * coverage-mode-only: it is a constraint in BOTH objectives (§2.4) and is
   * unconditionally required on `inputs`. CH4O-7 — it now renders
   * unconditionally too (the `objective === "coverage"` render gate that used
   * to hide it is gone). */
  avgServiceDistCapMi?: number;
  /** CH4O-5 — the demand-coverage floor, now a student-authored input and the
   * discriminator the server (and, via the same `deriveMaxCoverageObjective`
   * rule, this component) derives `objective` from (0 -> coverage, > 0 ->
   * min_distance, §2.3). CH4O-7 — this is the editable input rendered below,
   * via the generic `onChange`; NOT a distance, never unit-converted. */
  coverageFloorDemand?: number;
  /** Atomic service-distance edit — the caller re-derives `distanceBands` to
   * `[high, max]` in the SAME update (D13/D19). */
  onServiceDistanceChange?: (field: "highServiceDistMi" | "maxDistMi", value: number) => void;
  /** D13/D19 (superseded by chen-bands-units, T13 — see the render site's
   * own comment below): originally hid the free-edit distance-bands chip
   * editor for Chen, whose bands were then DERIVED (`[high, max]`), not
   * user-editable. That workflow is gone — max-coverage-us's `distanceBands`
   * is a free, user-editable reporting lens like every other model's
   * (`validation/inputs/maxCoverage.ts`), and Workspace.tsx now omits this
   * prop for max-coverage-us, so it defaults true and the band editor
   * renders. Kept as an opt-out seam for a future caller, not currently
   * exercised by any model. */
  showBandEditor?: boolean;
  // ── ch5-del-10 — delivery-teaching-us's Adjust Cost Table feature ──────
  /** Chapter 5 (modified) - present only for delivery-teaching-us. Gated on
   * presence like every other model-specific parameter in this component,
   * never on modelId. */
  costAdjustEnabled?: boolean;
  distanceThreshold?: number;
  costPerMile?: number;
  costPerMileOver?: number;
  /** A single (field, value) callback rather than per-field callbacks — this
   * composes directly with Workspace.tsx's `updateInputsField(key, value)`,
   * the same localInputs-draft mechanism WarehousesTab/CustomersTab already
   * write through (A1.1). This component holds no save state of its own;
   * every edit is just a draft update, exactly like a keystroke in the
   * Warehouses/Customers tables. */
  onChange: (field: OptimizationParametersField, value: number | number[] | boolean) => void;
  /** CH4UX-2 — instance namespace. The Solve dialog embeds a SECOND copy of
   * this component while the Optimization Parameters tab may still be mounted
   * behind it; without a namespace both copies emit the same DOM `id`s (which
   * breaks `<label htmlFor>` association) and the same `data-testid`s (which
   * makes every RTL and Playwright locator ambiguous). Defaults to "" so every
   * existing caller's ids are byte-identical to today's. */
  idPrefix?: string;
  /** See `idPrefix`. Forwarded to the nested `BandChipEditor`, which already
   * takes this exact prop. Defaults to "". */
  testIdPrefix?: string;
  /** WF-5 — required inputs this scenario's row is missing, as manifest key
   * names. Computed by the caller from the model's own `inputsSchema.required[]`
   * (Workspace.tsx) — NOT derived here from a field's presence, because
   * presence cannot distinguish "this model has no such field" from "this
   * model needs it and the row lacks it". Empty or omitted for every healthy
   * scenario of every model. */
  missingRequiredInputs?: string[];
}

// WF-5 — label map for the missing-required-inputs notice. Module-level
// (not inside the component) because it holds no per-instance state and
// every key here is one of this component's own field names.
//
// Review fold-in (WF-3, final whole-branch review) — this used to cover only
// Chapter 4 + the shared p-median/gap/timeLimitSec/capacityMode/distanceBands
// keys, leaving EIGHT keys that appear in some model's own
// `inputsSchema.required[]` with no entry at all: capacityFactor,
// singleSource, capacityInactive (transport-coal); costAdjustEnabled,
// distanceThreshold, costPerMile, costPerMileOver (delivery-teaching-us);
// bomRatio (two-echelon-gold-au). A row of one of those models missing a
// required field would have rendered the raw camelCase key to a student
// instead of a label. Verified against every manifest's own required[]
// (`solvers/*/manifest.json`), not guessed — see this file's own test
// coverage (`OptimizationParametersTab — MISSING_INPUT_LABELS completeness`
// in the sibling test file), which iterates every model's required[] in
// both directions, following the server's `INPUT_FIELD_LABELS` test shape
// (artifacts/api-server/src/validation/__tests__/formatInputIssues.test.ts).
// Wording below is taken verbatim from this component's own existing UI
// copy for each field where it has one (the Label text / button text
// rendered further down), not invented fresh.
export const MISSING_INPUT_LABELS: Record<string, string> = {
  p: "Number of warehouses",
  highServiceDistMi: "High-service distance",
  maxDistMi: "Max distance",
  avgServiceDistCapMi: "Average service distance cap",
  coverageFloorDemand: "Coverage floor",
  gap: "MIP gap",
  timeLimitSec: "Time limit",
  capacityMode: "Capacity mode",
  distanceBands: "Distance bands",
  // transport-coal
  capacityFactor: "Mine capacity factor",
  singleSource: "Single-source",
  capacityInactive: "Ignore capacity",
  // delivery-teaching-us
  costAdjustEnabled: "Adjust Cost Table",
  distanceThreshold: "Distance threshold",
  costPerMile: "Cost per mile",
  costPerMileOver: "Cost per mile over the threshold",
  // two-echelon-gold-au
  bomRatio: "BOM ratio",
};

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
  highServiceDistMi,
  maxDistMi,
  avgServiceDistCapMi,
  coverageFloorDemand,
  onServiceDistanceChange,
  showBandEditor = true,
  costAdjustEnabled,
  distanceThreshold,
  costPerMile,
  costPerMileOver,
  onChange,
  idPrefix = "",
  testIdPrefix = "",
  missingRequiredInputs,
}: OptimizationParametersTabProps) {
  // CH4UX-2 — one helper per namespace so a missed call site is a visible
  // bare string literal in review rather than a silent collision at runtime.
  const pid = (s: string) => `${idPrefix}${s}`;
  const tid = (s: string) => `${testIdPrefix}${s}`;
  // CH4O-7 — unconditional call (Rules of Hooks). `useDisplayUnit()` THROWS
  // without a `UnitProvider` ancestor (UnitContext.tsx) — this is therefore
  // a hard contract on every caller of this component, for every model, not
  // a cheap/free no-op for callers that never render the Chapter 4 block.
  // Safe today because every real caller already satisfies it: production
  // (`main.tsx` wraps the whole `<App>`), and every test file that renders
  // this component wraps with `{ wrapper: UnitProvider }` (see
  // `BandChipEditor.tsx`'s own comment for the same warning on that sibling
  // component).
  const { format } = useDisplayUnit();
  // chen-bands-units, Part A — the conditionally-linked high boundary: on a
  // highServiceDistMi edit oldHigh -> newHigh, retarget a band EQUAL TO
  // oldHigh to newHigh, but ONLY if such a band is present (the user may
  // have already removed it — in which case bands stay untouched and later
  // high edits never touch them again). Dedupe + re-sort after. This is a
  // pure business-logic wrapper around `onServiceDistanceChange`, and
  // applies identically regardless of legacy vs unit-aware mode below.
  function handleHighServiceDistChange(newHigh: number) {
    const oldHigh = highServiceDistMi;
    if (oldHigh != null && oldHigh !== newHigh && distanceBands.includes(oldHigh)) {
      const nextBands = Array.from(
        new Set(distanceBands.map(b => (b === oldHigh ? newHigh : b))),
      )
        .filter(b => b > 0)
        .sort((a, b) => a - b);
      onChange("distanceBands", nextBands);
    }
    onServiceDistanceChange?.("highServiceDistMi", newHigh);
  }

  return (
    <div className="max-w-md space-y-6" data-testid={tid("optimization-parameters-tab")}>
      {/* WF-5 — a scenario row the Chapter 4 km->mi migration (or any future
          migration) left with required inputs missing. The notice is driven
          entirely by `missingRequiredInputs` (computed in Workspace.tsx from
          the active model's own manifest `inputsSchema.required[]`) — never
          by a field's presence here, since presence alone cannot distinguish
          "this model has no such field" from "this model needs it and the
          row lacks it". */}
      {missingRequiredInputs !== undefined && missingRequiredInputs.length > 0 && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          data-testid={tid("missing-required-inputs")}
        >
          <p className="font-medium text-destructive">This scenario is missing required values</p>
          <p className="mt-1 text-muted-foreground">
            {missingRequiredInputs.map(k => MISSING_INPUT_LABELS[k] ?? k).join(", ")}
            {" "}— it cannot be saved or solved until they are restored. Contact your instructor.
          </p>
        </div>
      )}

      {p != null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-foreground">Warehouses to open (P)</Label>
            <span className="text-sm font-bold text-primary font-mono" data-testid={tid("text-p-value")}>{p}</span>
          </div>
          <Slider
            min={1}
            max={pMax}
            step={1}
            value={[p]}
            onValueChange={([v]) => onChange("p", v)}
            data-testid={tid("slider-p-value")}
            className="my-1"
          />
          <div className="flex gap-1.5 flex-wrap">
            {[2, 3, 4, 10, 25].filter(n => n <= pMax).map(n => (
              <button
                key={n}
                type="button"
                data-testid={tid(`button-p-quick-${n}`)}
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

      {/* C4.12/CH4O-7 — max-coverage-us coverage model (formerly Chen's
          Cosmetics), rebuilt as ONE always-editable surface: the two
          service-distance thresholds, the avg-service-cap (now
          unconditional in both modes, §2.4), and the coverage-floor input +
          derived-model-line below. No capacity concept (capacityMode "none"
          is persisted, so the Warehouses table never shows a Capacity
          column). The distance-band editor IS rendered for this model
          (chen-bands-units, T13, superseding D13/D19's derived-only bands)
          — `showBandEditor` defaults true and Workspace.tsx deliberately
          omits the prop for max-coverage-us; see the `{showBandEditor &&
          ...}` render below. Gated on `highServiceDistMi != null` (present
          only for Chen) rather than the deleted `objective` prop. */}
      {highServiceDistMi != null && (
        <div className="space-y-4" data-testid={tid("chen-objective-section")}>
          <div className="grid grid-cols-2 gap-3">
            {canonicalUnit !== undefined ? (
              <>
                <ChenDistanceInput
                  id={pid("input-high-service-dist")}
                  testId={tid("input-high-service-dist")}
                  labelPrefix="High-service distance"
                  canonicalUnit={canonicalUnit}
                  value={highServiceDistMi ?? 0}
                  onCommit={handleHighServiceDistChange}
                />
                <ChenDistanceInput
                  id={pid("input-max-dist")}
                  testId={tid("input-max-dist")}
                  labelPrefix="Max distance"
                  canonicalUnit={canonicalUnit}
                  value={maxDistMi ?? 0}
                  onCommit={v => onServiceDistanceChange?.("maxDistMi", v)}
                />
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor={pid("input-high-service-dist")} className="text-xs text-muted-foreground">
                    High-service distance ({distanceUnit})
                  </Label>
                  <Input
                    id={pid("input-high-service-dist")}
                    type="number"
                    value={highServiceDistMi ?? ""}
                    onChange={e => handleHighServiceDistChange(parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm mt-1 font-mono"
                    data-testid={tid("input-high-service-dist")}
                  />
                </div>
                <div>
                  <Label htmlFor={pid("input-max-dist")} className="text-xs text-muted-foreground">
                    Max distance ({distanceUnit})
                  </Label>
                  <Input
                    id={pid("input-max-dist")}
                    type="number"
                    value={maxDistMi ?? ""}
                    onChange={e => onServiceDistanceChange?.("maxDistMi", parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm mt-1 font-mono"
                    data-testid={tid("input-max-dist")}
                  />
                </div>
              </>
            )}
          </div>

          {/* CH4O-7 — no longer gated on `objective === "coverage"`: the cap
              is a constraint in BOTH modes (§2.4) and must render always. */}
          {canonicalUnit !== undefined ? (
            <ChenDistanceInput
              id={pid("input-avg-service-cap")}
              testId={tid("input-avg-service-cap")}
              labelPrefix="Avg service distance cap"
              canonicalUnit={canonicalUnit}
              value={avgServiceDistCapMi ?? 0}
              onCommit={v => onChange("avgServiceDistCapMi", v)}
            />
          ) : (
            <div>
              <Label htmlFor={pid("input-avg-service-cap")} className="text-xs text-muted-foreground">
                Avg service distance cap ({distanceUnit})
              </Label>
              <Input
                id={pid("input-avg-service-cap")}
                type="number"
                value={avgServiceDistCapMi ?? ""}
                onChange={e => onChange("avgServiceDistCapMi", parseFloat(e.target.value) || 0)}
                className="h-8 text-sm mt-1 font-mono"
                data-testid={tid("input-avg-service-cap")}
              />
            </div>
          )}

          <div>
            <Label htmlFor={pid("input-coverage-floor")} className="text-xs text-muted-foreground">
              Coverage floor (demand)
            </Label>
            {/* NOT a distance -- never routed through ChenDistanceInput /
                useDistanceDraft, and never unit-converted. A demand count has
                no distance dimension. */}
            <Input
              id={pid("input-coverage-floor")}
              type="number"
              min={0}
              step={1}
              value={coverageFloorDemand ?? 0}
              onChange={e => onChange("coverageFloorDemand", parseInt(e.target.value, 10) || 0)}
              className="h-8 text-sm mt-1 font-mono"
              data-testid={tid("input-coverage-floor")}
            />
            {(() => {
              // Reads the SAME derivation the server uses, so the label and the
              // solve that runs cannot disagree. `UnitApi.format` converts AND
              // labels a distance in one call, so the number and the unit can
              // never drift apart -- printing canonical numbers under a
              // display-unit label is the trap this guards against.
              if (canonicalUnit == null) return null;
              const fmt = (v: number) => format(v, canonicalUnit, { maximumFractionDigits: 1 });
              const floor = coverageFloorDemand ?? 0;
              // CH4O-5 requires avgServiceDistCapMi unconditionally on a real
              // Chen scenario (§2.4), but a legacy row saved before that
              // requirement existed can still have it absent. `highServiceDistMi!`
              // is safe (gated by the enclosing block's `highServiceDistMi !=
              // null`); `avgServiceDistCapMi` is NOT gated by anything, so omit
              // the clause entirely when it's absent rather than assert a false
              // "at or under 0" cap that the model being solved won't actually
              // have.
              //
              // CH4O-P1 — the clause goes on BOTH lines. The avg-service cap
              // used to be a Model-2-only constraint; this branch made it
              // unconditional in both objectives (which is why its field
              // renders unconditionally), and the Model 2 string was the one
              // that still omitted it. A student who sets a positive floor and
              // a tight cap, gets INFEASIBLE, and reads a Model 2 line naming
              // only the floor has no on-screen statement of the constraint
              // that actually caused it — while the Model 1 line they saw a
              // minute earlier did name it.
              const capClause =
                avgServiceDistCapMi != null
                  ? `, holding average distance at or under ${fmt(avgServiceDistCapMi)}`
                  : "";
              return (
                <p className="mt-1 text-[11px] text-muted-foreground" data-testid={tid("derived-model-line")}>
                  {deriveMaxCoverageObjective(floor) === "coverage"
                    ? `Model 1 — maximize demand within ${fmt(highServiceDistMi!)}${capClause}`
                    : `Model 2 — minimize average distance, covering at least ${floor.toLocaleString()} demand within ${fmt(highServiceDistMi!)}${capClause}`}
                </p>
              );
            })()}
          </div>

        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={pid("input-gap")} className="text-xs text-muted-foreground">Optimization gap (%)</Label>
          <Input
            id={pid("input-gap")}
            type="number"
            step="0.01"
            value={gap}
            onChange={e => onChange("gap", parseFloat(e.target.value) || 0)}
            className="h-8 text-sm mt-1 font-mono"
            data-testid={tid("input-gap")}
          />
        </div>
        <div>
          <Label htmlFor={pid("input-time-limit")} className="text-xs text-muted-foreground">Max time (seconds)</Label>
          <Input
            id={pid("input-time-limit")}
            type="number"
            value={timeLimitSec}
            onChange={e => onChange("timeLimitSec", parseInt(e.target.value, 10) || 120)}
            className="h-8 text-sm mt-1 font-mono"
            data-testid={tid("input-time-limit")}
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
            data-testid={tid("slider-capacity-factor")}
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
            data-testid={tid("switch-single-source")}
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
            data-testid={tid("switch-capacity-inactive")}
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
            <span className="text-xs font-mono w-10 text-right" data-testid={tid("text-bom-ratio")}>{bomRatio.toFixed(2)}×</span>
          </div>
          <Slider
            min={1.05}
            max={2.0}
            step={0.05}
            value={[bomRatio]}
            onValueChange={([v]) => onChange("bomRatio", Math.round(v * 20) / 20)}
            data-testid={tid("slider-bom-ratio")}
            className="my-1"
          />
          <p className="text-[10px] text-muted-foreground">1.1 favors the customer-adjacent refinery. 2.0 favors the mine-adjacent one — watch which refinery gets selected as you sweep this.</p>
        </div>
      )}

      {/* ch5-del-10 — delivery-teaching-us's Adjust Cost Table control.
          Gated on `costAdjustEnabled != null` like every other
          model-specific field above (never on modelId). CH4O-7 — the
          two-step workflow's `step` guards this comment used to reference
          are gone entirely now; this control was never affected by them.
          Joins the capacityFactor/singleSource/capacityInactive/bomRatio
          family of unguarded, presence-gated sections. */}
      {costAdjustEnabled != null && (
        <div className="space-y-2" data-testid={tid("cost-adjust-section")}>
          <Button
            variant={costAdjustEnabled ? "secondary" : "outline"}
            className="h-8 w-full text-sm"
            data-testid={tid("button-adjust-cost-table")}
            onClick={() => onChange("costAdjustEnabled", !costAdjustEnabled)}
          >
            Adjust Cost Table
          </Button>
          {costAdjustEnabled && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Each lane is repriced from its distance: at or under the threshold it
                bills at the first rate, beyond it at the second. Distances are never
                changed.
              </p>
              <div>
                <Label htmlFor={pid("input-distance-threshold")} className="text-xs text-muted-foreground">
                  Distance threshold (mi)
                </Label>
                <Input id={pid("input-distance-threshold")} type="number" value={distanceThreshold}
                       data-testid={tid("input-distance-threshold")}
                       className="h-8 text-sm mt-1 font-mono"
                       onChange={e => onChange("distanceThreshold", parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label htmlFor={pid("input-cost-per-mile")} className="text-xs text-muted-foreground">
                  Cost per mile
                </Label>
                <Input id={pid("input-cost-per-mile")} type="number" value={costPerMile}
                       data-testid={tid("input-cost-per-mile")}
                       className="h-8 text-sm mt-1 font-mono"
                       onChange={e => onChange("costPerMile", parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label htmlFor={pid("input-cost-per-mile-over")} className="text-xs text-muted-foreground">
                  Cost per mile over the threshold
                </Label>
                <Input id={pid("input-cost-per-mile-over")} type="number" value={costPerMileOver}
                       data-testid={tid("input-cost-per-mile-over")}
                       className="h-8 text-sm mt-1 font-mono"
                       onChange={e => onChange("costPerMileOver", parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          )}
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
          testIdPrefix={testIdPrefix}
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
