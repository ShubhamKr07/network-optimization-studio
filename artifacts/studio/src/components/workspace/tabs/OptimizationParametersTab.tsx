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
  | "bomRatio";

interface OptimizationParametersTabProps {
  /** Undefined when the active model has no P concept (transport-coal,
   * two-echelon-gold-au) — mirrors Studio.tsx's modelId-gated P section
   * (Studio.tsx:1155-1182), but gated here on the value's presence rather
   * than a hardcoded modelId check, so this stays generic across models. */
  p?: number;
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
  p,
  gap,
  timeLimitSec,
  distanceBands,
  capacityFactor,
  singleSource,
  capacityInactive,
  bomRatio,
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
            <span className="text-sm font-bold text-primary" data-testid="text-p-value">{p}</span>
          </div>
          <Slider
            min={1}
            max={50}
            step={1}
            value={[p]}
            onValueChange={([v]) => onChange("p", v)}
            data-testid="slider-p-value"
            className="my-1"
          />
          <div className="flex gap-1.5 flex-wrap">
            {[2, 3, 4, 10, 25].map(n => (
              <button
                key={n}
                type="button"
                data-testid={`button-p-quick-${n}`}
                onClick={() => onChange("p", n)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  p === n ? "bg-primary text-white border-primary" : "bg-white text-foreground border-border hover:border-primary"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
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
            className="h-8 text-sm mt-1"
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
            className="h-8 text-sm mt-1"
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground">Distance bands (miles)</Label>
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
            <span key={b} className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded px-2 py-1">
              {b.toLocaleString()}
              <button
                type="button"
                aria-label={`Remove band ${b}`}
                data-testid={`button-remove-band-${b}`}
                onClick={() => removeBand(b)}
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
              className="h-7 text-xs w-28"
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
    </div>
  );
}
