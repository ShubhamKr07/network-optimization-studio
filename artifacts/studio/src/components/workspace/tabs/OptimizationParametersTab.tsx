import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

export type OptimizationParametersField = "p" | "gap" | "timeLimitSec" | "distanceBands";

interface OptimizationParametersTabProps {
  /** Undefined when the active model has no P concept (transport-coal,
   * two-echelon-gold-au) — mirrors Studio.tsx's modelId-gated P section
   * (Studio.tsx:1155-1182), but gated here on the value's presence rather
   * than a hardcoded modelId check, so this stays generic across models. */
  p?: number;
  gap: number;
  timeLimitSec: number;
  distanceBands: number[];
  /** A single (field, value) callback rather than per-field callbacks — this
   * composes directly with Workspace.tsx's `updateInputsField(key, value)`,
   * the same localInputs-draft mechanism WarehousesTab/CustomersTab already
   * write through (A1.1). This component holds no save state of its own;
   * every edit is just a draft update, exactly like a keystroke in the
   * Warehouses/Customers tables. */
  onChange: (field: OptimizationParametersField, value: number | number[]) => void;
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
export function OptimizationParametersTab({ p, gap, timeLimitSec, distanceBands, onChange }: OptimizationParametersTabProps) {
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
