import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

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
   * callers stay unchanged; Chen (chens-cosmetics-cn) passes "km". */
  distanceUnit?: string;
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
  distanceUnit = "mi",
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
  const [addingBand, setAddingBand] = useState(false);
  const [newBandValue, setNewBandValue] = useState("");

  function addBand() {
    const val = parseInt(newBandValue, 10);
    if (!isNaN(val) && val > 0 && !distanceBands.includes(val)) {
      onChange("distanceBands", [...distanceBands, val].sort((a, b) => a - b));
    }
    setNewBandValue("");
    setAddingBand(false);
  }

  function removeBand(band: number) {
    onChange("distanceBands", distanceBands.filter(b => b !== band));
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
            <div>
              <Label htmlFor="input-high-service-dist" className="text-xs text-muted-foreground">
                High-service distance ({distanceUnit})
              </Label>
              <Input
                id="input-high-service-dist"
                type="number"
                value={highServiceDistKm ?? ""}
                onChange={e => onServiceDistanceChange?.("highServiceDistKm", parseFloat(e.target.value) || 0)}
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
          </div>

          {objective === "coverage" && (
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
          SAME free add/remove chip editor as every other model now; the
          fixed-4-slot `JadeBandEditor` is deleted (JADE's `distanceBands`
          schema is `.min(1)` like p-median/transport/gold-au). */}
      {showBandEditor && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground">Distance bands ({distanceUnit})</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAddingBand(true)}
            data-testid="button-bands-plus"
            className="h-6 px-2 text-xs"
          >
            + Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {distanceBands.map(b => (
            <span key={b} className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded px-2 py-1 font-mono">
              {b.toLocaleString()}
              <button
                type="button"
                aria-label={`Remove band ${b}`}
                data-testid={`button-remove-band-${b}`}
                onClick={() => removeBand(b)}
                // item 7 (Codex plan-review P1) — never remove the LAST
                // remaining band: every free-chip model's schema is now
                // `.min(1)`, so emptying the array to [] would 422 on Save.
                disabled={distanceBands.length <= 1}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          {distanceBands.length === 0 && (
            <span className="text-xs text-muted-foreground" data-testid="distance-bands-empty">
              No bands configured.
            </span>
          )}
        </div>
        {addingBand && (
          <div className="flex gap-1.5">
            <Input
              type="number"
              autoFocus
              value={newBandValue}
              onChange={e => setNewBandValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") addBand();
                if (e.key === "Escape") {
                  setAddingBand(false);
                  setNewBandValue("");
                }
              }}
              className="h-7 text-xs w-28 font-mono"
              placeholder="e.g. 500"
              data-testid="input-new-band"
            />
            <Button type="button" size="sm" onClick={addBand} className="h-7 px-2 text-xs" data-testid="button-add-band-confirm">
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAddingBand(false);
                setNewBandValue("");
              }}
              className="h-7 px-2 text-xs"
              data-testid="button-add-band-cancel"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
