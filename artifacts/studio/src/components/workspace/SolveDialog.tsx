import { type ReactNode } from "react";
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
import { BandChipEditor } from "@/components/workspace/tabs/BandChipEditor";
import { type CanonicalUnit } from "@workspace/units";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";

interface SolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active model id. jade-INT (workspace-fixups-2, item 7) — JADE (Ch.9)
   * used to render a separate fixed-4-slot `JadeBandEditor` here, gated on
   * this prop; that editor is deleted and JADE now renders the SAME shared
   * free chip editor as every other model (JADE's `distanceBands` schema was
   * relaxed to `.min(1)`, matching p-median/transport/gold-au). `modelId` is
   * kept on the props for other model-specific sections in this dialog. */
  modelId?: string;
  /** Same `localInputs` draft A1.2's Optimization Parameters tab reads/writes
   * (Workspace.tsx passes both these values and `onChange` through
   * unchanged) — undefined for models with no P concept, mirroring that
   * tab's own convention. */
  p?: number;
  /** C4.12/D27 — the P slider's semantic maximum, defaulting to 50
   * (p-median-us/brazil's static max). CH4UX-6: max-coverage-us used to pass
   * 26 here, but its Solve dialog renders the real parameter tab through
   * `paramsSlot`, so the built-in slider below never mounts for it and that
   * arm was deleted at the call site — max-coverage-us's cap is declared once,
   * on `OptimizationParametersTab`'s own `pMax`, and is the `paramsSlot`
   * exception that never reaches this prop. The merge with Chapter 5
   * (`16021ec`) gave this prop a live caller again: `delivery-teaching-us`
   * supplies no `paramsSlot`, so its built-in slider below DOES mount, and
   * `Workspace.tsx` passes `33` here (validated server-side by
   * `delivery.ts`'s `.max(33)`) to keep the two surfaces in agreement. */
  pMax?: number;
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
   * predates this field, or before `useListModels` has resolved). Ignored
   * once `canonicalUnit` (below) is supplied. */
  distanceUnit?: string;
  /** chen-bands-units, Part D opt-in — identical three-state contract to
   * `OptimizationParametersTab`'s own `canonicalUnit` prop (see that file's
   * doc comment): `undefined` -> legacy, unconverted, no `UnitProvider`
   * dependency; `null` -> opted in but unresolved (disabled placeholder,
   * no fallback); a resolved `CanonicalUnit` -> full display-unit-aware
   * editing via `useDistanceDraft`, the SAME hook and math
   * `OptimizationParametersTab` uses — one state source, not a parallel
   * copy. `gap` / `timeLimitSec` are never gated or converted by this
   * prop. */
  canonicalUnit?: CanonicalUnit | null;
  /** C4.12/D13/D19 (superseded by chen-bands-units, T13): originally hid the
   * free-edit distance-bands chip editor for Chen, whose bands were then
   * DERIVED (`[high, max]`). That workflow is gone — max-coverage-us's
   * `distanceBands` is a free, user-editable reporting lens like every other
   * model's, and Workspace.tsx now omits this prop for max-coverage-us, so
   * it defaults true and the band editor renders in its Solve dialog too.
   * Kept as an opt-out seam for a future caller, not currently exercised by
   * any model. */
  showBandEditor?: boolean;
  /** CH4UX-3 — when supplied, replaces this dialog's ENTIRE built-in
   * parameter region (P slider, Chen objective section, gap/time-limit grid,
   * band editor). The caller owns what renders here. Chapter 4 passes the
   * real `OptimizationParametersTab` so the dialog and the tab can never
   * drift onto two different parameter editors; every other model omits it
   * and keeps the built-in controls verbatim. */
  paramsSlot?: ReactNode;
  // ── Chen's Cosmetics (max-coverage-us) objective display ──────────────
  // CH4-17 — no toggle any more: `objective` stays "coverage" for every
  // persisted Chapter 4 payload (only the server may produce a
  // "min_distance" payload, Task 3/4), so this section is read-only display
  // scoped to the active mode's field. Presence of `objective` gates it, the
  // same convention as `p`/`bomRatio` above.
  /** Coverage vs min-distance objective mode. Presence gates the section. */
  objective?: "coverage" | "min_distance";
  /** CH4O-5 — the weighted-average service-distance cap. No longer
   * coverage-mode-only: it is a constraint in BOTH objectives and is
   * unconditionally required on `inputs`. */
  avgServiceDistCapKm?: number;
  /** Writes directly into Workspace.tsx's `localInputs` draft via
   * `updateInputsField` — the exact same callback shape
   * OptimizationParametersTab uses, so there is exactly one source of
   * truth for these three values, never a second copy that could drift. */
  onChange: (field: OptimizationParametersField, value: number | number[]) => void;
  onSolve: () => void;
}

// A2.1 — "Run Optimizer" dialog: p / gap / max runtime, two-way synced with
// A1.2's Optimization Parameters tab (both read/write the same
// scenario.inputs draft — see Workspace.tsx). Save-before-solve orchestration
// (CLAUDE.md's documented Round-2 bug: Studio.tsx's `handleSolve` used to
// fire against whatever was already persisted, silently discarding a dirty
// unsaved edit) lives in Workspace.tsx, not here — this component only
// triggers `onSolve`.
//
// CH4UX-6 — this dialog is now exactly its name: parameters plus
// Solve/Close. It has NO progress concept at all; the whole
// saving/solving/failed lifecycle (spinner, clock, error card, Adjust &
// re-solve) belongs to `SolveProgressOverlay`, which Workspace.tsx mounts
// alongside this one and which takes over the instant Solve is pressed.
export function SolveDialog({
  open,
  onOpenChange,
  // modelId is unused for the band editor now (item 7 — JADE renders the
  // same shared chip editor as every other model); kept in the destructure
  // for parity with the other model-specific sections below, even though
  // none of them currently read it either.
  p,
  pMax = 50,
  gap,
  timeLimitSec,
  distanceBands,
  distanceUnit,
  canonicalUnit,
  showBandEditor = true,
  paramsSlot,
  objective,
  avgServiceDistCapKm,
  onChange,
  onSolve,
}: SolveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="solve-dialog"
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        <DialogHeader>
          <DialogTitle className="font-heading">Run Optimizer</DialogTitle>
          <DialogDescription>
            Same values as the Optimization Parameters tab — editing here or there updates the same scenario.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto min-h-0">
          {paramsSlot ?? (
            <>
            {p != null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">Warehouses to open (P)</Label>
                  <span className="text-sm font-bold text-primary font-mono" data-testid="solve-dialog-p-value">
                    {p}
                  </span>
                </div>
                <Slider
                  min={1}
                  max={pMax}
                  step={1}
                  value={[p]}
                  onValueChange={([v]) => onChange("p", v)}
                  data-testid="solve-dialog-slider-p"
                  className="my-1"
                />
              </div>
            )}

            {/* Chen's Cosmetics objective display — CH4-17: no toggle, no
                floor input. `objective` is always "coverage" for a persisted
                Chapter 4 payload; this is read-only display of the one
                mode-specific field, scoped exactly like
                OptimizationParametersTab's surviving `chen-objective-section`. */}
            {objective != null && (
              <div className="space-y-2" data-testid="solve-dialog-chen-objective-section">
                {objective === "coverage" && (
                  canonicalUnit !== undefined ? (
                    <SolveDialogDistanceInput
                      id="solve-dialog-input-avg-service-cap"
                      testId="solve-dialog-input-avg-service-cap"
                      labelPrefix="Avg service distance cap"
                      canonicalUnit={canonicalUnit}
                      value={avgServiceDistCapKm ?? 0}
                      onCommit={v => onChange("avgServiceDistCapKm", v)}
                    />
                  ) : (
                    <div>
                      <Label htmlFor="solve-dialog-input-avg-service-cap" className="text-xs text-muted-foreground">
                        Avg service distance cap{distanceUnit ? ` (${distanceUnit})` : ""}
                      </Label>
                      <Input
                        id="solve-dialog-input-avg-service-cap"
                        type="number"
                        value={avgServiceDistCapKm ?? ""}
                        onChange={e => onChange("avgServiceDistCapKm", parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm mt-1 font-mono"
                        data-testid="solve-dialog-input-avg-service-cap"
                      />
                    </div>
                  )
                )}
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
                  onChange={e => onChange("gap", parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm mt-1 font-mono"
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
                  onChange={e => onChange("timeLimitSec", parseInt(e.target.value, 10) || 120)}
                  className="h-8 text-sm mt-1 font-mono"
                  data-testid="solve-dialog-input-time-limit"
                />
              </div>
            </div>

            {/* R5 — distance-band range editor, prefilled from the scenario's
                current `inputs.distanceBands` and two-way synced with the same
                draft `onChange` as p/gap/timeLimitSec above. chen-bands-units,
                T13 — now the SAME shared `BandChipEditor` OptimizationParametersTab
                renders, so the two surfaces can never drift onto two different
                add/remove implementations again. jade-INT (workspace-fixups-2,
                item 7) — JADE renders this too (fixed-4-slot `JadeBandEditor`
                deleted upstream; JADE's `distanceBands` schema is `.min(1)`
                like every other model). CH4UX-3/CH4UX-6 — max-coverage-us
                does not reach this block at all: it supplies `paramsSlot`,
                which replaces this whole built-in region. */}
            {showBandEditor && (
              <BandChipEditor
                bands={distanceBands}
                onChange={bands => onChange("distanceBands", bands)}
                distanceUnit={distanceUnit}
                canonicalUnit={canonicalUnit}
                testIdPrefix="solve-dialog-"
              />
            )}
            </>
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
          {/* CH4UX-6 — no busy state: pressing this closes the dialog and
              hands the run to SolveProgressOverlay, so there is no moment at
              which this button is mounted AND a solve is in flight. */}
          <Button type="button" onClick={onSolve} data-testid="solve-dialog-solve">
            Solve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// chen-bands-units, T13, Step 3b — mirrors OptimizationParametersTab's own
// `ChenDistanceInput`: adopts `useDistanceDraft` verbatim, only mounted once
// the caller opts into `canonicalUnit` (undefined callers never trigger
// `useDisplayUnit()` and need no `UnitProvider`). "One state source, not a
// parallel copy" is satisfied by both call sites routing through the SAME
// hook + the SAME `@workspace/units` conversion functions — not by sharing
// this small presentational wrapper itself.
function SolveDialogDistanceInput({
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
        // CH4UX-6 — the caller's `disabled` seam is gone with `busy`; the
        // only remaining reason to disable is an unresolved canonicalUnit.
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
