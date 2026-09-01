import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OptimizationParametersField } from "@/components/workspace/tabs/OptimizationParametersTab";

/**
 * `"idle"` — dialog just opened / previous run finished cleanly.
 * `"saving"` — a dirty localInputs draft is being persisted before solve
 *   (see the save-before-solve note below).
 * `"solving"` — the solve job has been enqueued and/or is being polled.
 * `"failed"` — either the save or the solve itself ended in an error;
 *   `errorMessage` carries the reason.
 */
export type SolveDialogPhase = "idle" | "saving" | "solving" | "failed";

interface SolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Same `localInputs` draft A1.2's Optimization Parameters tab reads/writes
   * (Workspace.tsx passes both these values and `onChange` through
   * unchanged) — undefined for models with no P concept, mirroring that
   * tab's own convention. */
  p?: number;
  gap: number;
  timeLimitSec: number;
  /** R5 — persisted solve-input distance bands, two-way synced with the
   * DRAFT `inputs.distanceBands` (same mechanism as p/gap/timeLimitSec) and
   * prefilled from the scenario's current bands. This is a solve INPUT, not
   * a post-solve reporting lens — the bands edited here are what the NEXT
   * solve uses; they persist via the existing save-then-solve path and only
   * become part of `displayedInputs` once that solve completes. Editing
   * here must never recolor/re-band the CURRENTLY displayed (older)
   * result — Workspace.tsx's output surfaces read `displayedInputs`, never
   * this draft. */
  distanceBands: number[];
  /** T2's per-model `ModelInfo.distanceUnit` ("mi" | "km"), so the bands
   * editor's label shows the right unit. Optional — defaults to "mi" (the
   * same default the public API boundary itself applies when a manifest
   * predates this field, or before `useListModels` has resolved). */
  distanceUnit?: string;
  /** Writes directly into Workspace.tsx's `localInputs` draft via
   * `updateInputsField` — the exact same callback shape
   * OptimizationParametersTab uses, so there is exactly one source of
   * truth for these three values, never a second copy that could drift. */
  onChange: (field: OptimizationParametersField, value: number | number[]) => void;
  phase: SolveDialogPhase;
  errorMessage?: string | null;
  onSolve: () => void;
}

// A2.1 — "Run Optimizer" dialog: p / gap / max runtime, two-way synced with
// A1.2's Optimization Parameters tab (both read/write the same
// scenario.inputs draft — see Workspace.tsx). Save-before-solve orchestration
// (CLAUDE.md's documented Round-2 bug: Studio.tsx's `handleSolve` used to
// fire against whatever was already persisted, silently discarding a dirty
// unsaved edit) lives in Workspace.tsx, not here — this component only
// triggers `onSolve` and reflects `phase`/`errorMessage` back as a
// progress/error state.
export function SolveDialog({
  open,
  onOpenChange,
  p,
  gap,
  timeLimitSec,
  distanceBands,
  distanceUnit,
  onChange,
  phase,
  errorMessage,
  onSolve,
}: SolveDialogProps) {
  const busy = phase === "saving" || phase === "solving";
  const [addingBand, setAddingBand] = useState(false);
  const [newBandValue, setNewBandValue] = useState("");

  // R5 — same add/remove logic as OptimizationParametersTab's own bands
  // editor (dedupe, sort ascending), writing through the shared `onChange`
  // so this dialog and that tab can never drift onto two different copies.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="solve-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Run Optimizer</DialogTitle>
          <DialogDescription>
            Same values as the Optimization Parameters tab — editing here or there updates the same scenario.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {p != null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground">Warehouses to open (P)</Label>
                <span className="text-sm font-bold text-primary" data-testid="solve-dialog-p-value">
                  {p}
                </span>
              </div>
              <Slider
                min={1}
                max={50}
                step={1}
                value={[p]}
                onValueChange={([v]) => onChange("p", v)}
                disabled={busy}
                data-testid="solve-dialog-slider-p"
                className="my-1"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="solve-dialog-gap" className="text-xs text-muted-foreground">
                Optimization gap (%)
              </Label>
              <Input
                id="solve-dialog-gap"
                type="number"
                step="0.01"
                value={gap}
                disabled={busy}
                onChange={e => onChange("gap", parseFloat(e.target.value) || 0)}
                className="h-8 text-sm mt-1"
                data-testid="solve-dialog-input-gap"
              />
            </div>
            <div>
              <Label htmlFor="solve-dialog-time-limit" className="text-xs text-muted-foreground">
                Max time (seconds)
              </Label>
              <Input
                id="solve-dialog-time-limit"
                type="number"
                value={timeLimitSec}
                disabled={busy}
                onChange={e => onChange("timeLimitSec", parseInt(e.target.value, 10) || 120)}
                className="h-8 text-sm mt-1"
                data-testid="solve-dialog-input-time-limit"
              />
            </div>
          </div>

          {/* R5 — distance-band range editor, prefilled from the scenario's
              current `inputs.distanceBands` and two-way synced with the same
              draft `onChange` as p/gap/timeLimitSec above. Mirrors
              OptimizationParametersTab's own bands chip editor exactly (same
              add/dedupe/sort/remove behavior) so the two surfaces can never
              show conflicting values for the same field. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">
                Distance bands ({distanceUnit ?? "mi"})
              </Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAddingBand(true)}
                disabled={busy}
                data-testid="solve-dialog-button-bands-plus"
                className="h-6 px-2 text-xs"
              >
                + Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {distanceBands.map(b => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded px-2 py-1"
                  data-testid={`solve-dialog-band-${b}`}
                >
                  {b.toLocaleString()}
                  <button
                    type="button"
                    aria-label={`Remove band ${b}`}
                    data-testid={`solve-dialog-button-remove-band-${b}`}
                    onClick={() => removeBand(b)}
                    disabled={busy}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              {distanceBands.length === 0 && (
                <span className="text-xs text-muted-foreground" data-testid="solve-dialog-bands-empty">
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
                  data-testid="solve-dialog-input-new-band"
                />
                <Button type="button" size="sm" onClick={addBand} className="h-7 px-2 text-xs" data-testid="solve-dialog-button-add-band-confirm">
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
                  data-testid="solve-dialog-button-add-band-cancel"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="solve-dialog-progress">
              <Loader2 className="w-4 h-4 animate-spin" />
              {phase === "saving" ? "Saving changes…" : "Solving…"}
            </div>
          )}

          {phase === "failed" && errorMessage && (
            <p className="text-sm text-destructive" data-testid="solve-dialog-error">
              {errorMessage}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="solve-dialog-cancel"
          >
            Close
          </Button>
          <Button type="button" onClick={onSolve} disabled={busy} data-testid="solve-dialog-solve">
            {busy ? (phase === "saving" ? "Saving…" : "Solving…") : "Solve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
