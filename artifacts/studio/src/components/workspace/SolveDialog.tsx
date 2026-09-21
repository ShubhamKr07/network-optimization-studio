import { Loader2 } from "lucide-react";
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
import { useElapsed, type ElapsedJobStatus } from "@/lib/useElapsed";
import { type CanonicalUnit } from "@workspace/units";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";

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
  /** C4.12/D27 — the P slider's semantic maximum. Defaults to 50 (every
   * existing caller that omits it is unchanged — p-median-us/brazil's static
   * max); Chen (chens-cosmetics-cn) passes 25 so 26 can't be authored from
   * the Solve dialog either, matching OptimizationParametersTab's own pMax. */
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
   * copy. `gap` / `timeLimitSec` / `coverageFloorDemand` are never gated
   * or converted by this prop. */
  canonicalUnit?: CanonicalUnit | null;
  /** C4.12/D13/D19 — hide the free-edit distance-bands chip editor. Chen's
   * bands are DERIVED (`[high, max]`), so Workspace passes `false` for Chen;
   * defaults true, so every other model's Solve dialog is unchanged. */
  showBandEditor?: boolean;
  // ── jade B9 — running solve clock (spec §9) ───────────────────────────────
  // All four OPTIONAL, default undefined: with none supplied the dialog
  // renders nothing timing-related (every existing caller is unaffected).
  // INT threads the real polled `GET solve-job` timestamps/status through.
  /** When the current job was enqueued. */
  queuedAt?: Date | string | number | null;
  /** When the solver actually started running (null while still queued). */
  startedAt?: Date | string | number | null;
  /** When the job reached a terminal state (null while queued/running). */
  finishedAt?: Date | string | number | null;
  /** The polled job's own lifecycle status — distinct from this dialog's
   * `phase` below (which also covers the save-before-solve step). An
   * infeasible result still arrives as `"succeeded"` (the solver never
   * throws) — "terminal" here is a job-lifecycle concept, not an
   * optimal/infeasible one. */
  jobStatus?: ElapsedJobStatus;
  // ── Chen's Cosmetics (chens-cosmetics-cn) objective mode toggle ──────────
  // Mirrors OptimizationParametersTab's own Chen block (same props, same
  // gate: presence of `objective`), but scoped down to just the toggle +
  // the active mode's field — the two always-visible service-distance
  // thresholds stay tab-only, this dialog doesn't need them to run a solve.
  /** Coverage vs min-distance objective mode. Presence gates the section. */
  objective?: "coverage" | "min_distance";
  /** Coverage-mode-only cap (present when `objective === "coverage"`). */
  avgServiceDistCapKm?: number;
  /** Min-distance-mode-only floor (present when `objective === "min_distance"`). */
  coverageFloorDemand?: number;
  /** Atomic mode toggle — same `setChenObjectiveMode` handler Workspace.tsx
   * passes to OptimizationParametersTab (single source of truth for the
   * clear-other-field transition logic; this dialog never reimplements it). */
  onObjectiveModeChange?: (mode: "coverage" | "min_distance") => void;
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
  queuedAt,
  startedAt,
  finishedAt,
  jobStatus,
  objective,
  avgServiceDistCapKm,
  coverageFloorDemand,
  onObjectiveModeChange,
  onChange,
  phase,
  errorMessage,
  onSolve,
}: SolveDialogProps) {
  const busy = phase === "saving" || phase === "solving";

  // jade B9 — live solve clock (spec §9). All four inputs are optional and
  // default to undefined; with none supplied `elapsed.label` is null and
  // nothing timing-related renders (every existing caller is unaffected).
  const elapsed = useElapsed({ queuedAt, startedAt, finishedAt, status: jobStatus });

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
                disabled={busy}
                data-testid="solve-dialog-slider-p"
                className="my-1"
              />
            </div>
          )}

          {/* Chen's Cosmetics coverage/min-distance mode toggle — mirrors
              OptimizationParametersTab's own Chen block, scoped to just the
              toggle + the active mode's field. */}
          {objective != null && (
            <div className="space-y-2" data-testid="solve-dialog-chen-objective-section">
              <Label className="text-xs font-semibold text-foreground">Objective</Label>
              <div
                className="inline-flex rounded border border-border overflow-hidden"
                role="group"
                aria-label="Objective mode"
                data-testid="solve-dialog-chen-objective-toggle"
              >
                {(["coverage", "min_distance"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`solve-dialog-chen-objective-${mode}`}
                    aria-pressed={objective === mode}
                    disabled={busy}
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

              {objective === "coverage" && (
                canonicalUnit !== undefined ? (
                  <SolveDialogDistanceInput
                    id="solve-dialog-input-avg-service-cap"
                    testId="solve-dialog-input-avg-service-cap"
                    labelPrefix="Avg service distance cap"
                    canonicalUnit={canonicalUnit}
                    value={avgServiceDistCapKm ?? 0}
                    disabled={busy}
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
                      disabled={busy}
                      onChange={e => onChange("avgServiceDistCapKm", parseFloat(e.target.value) || 0)}
                      className="h-8 text-sm mt-1 font-mono"
                      data-testid="solve-dialog-input-avg-service-cap"
                    />
                  </div>
                )
              )}

              {objective === "min_distance" && (
                <div>
                  <Label htmlFor="solve-dialog-input-coverage-floor" className="text-xs text-muted-foreground">
                    Coverage floor (demand)
                  </Label>
                  <Input
                    id="solve-dialog-input-coverage-floor"
                    type="number"
                    value={coverageFloorDemand ?? ""}
                    disabled={busy}
                    onChange={e => onChange("coverageFloorDemand", parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm mt-1 font-mono"
                    data-testid="solve-dialog-input-coverage-floor"
                  />
                </div>
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
                disabled={busy}
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
                disabled={busy}
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
              like every other model). */}
          {showBandEditor && (
            <BandChipEditor
              bands={distanceBands}
              onChange={bands => onChange("distanceBands", bands)}
              disabled={busy}
              distanceUnit={distanceUnit}
              canonicalUnit={canonicalUnit}
              testIdPrefix="solve-dialog-"
            />
          )}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="solve-dialog-progress">
              <Loader2 className="w-4 h-4 animate-spin" />
              {phase === "saving" ? "Saving changes…" : "Solving…"}
            </div>
          )}

          {/* jade B9 — live solve clock (spec §9). Renders whenever a
              `queuedAt` was supplied, regardless of `phase` — so the frozen
              total is still visible on a `"failed"` job (the dialog stays
              open showing the error, per spec §9's terminal-time
              visibility note), not just while `busy`. Nothing renders when
              no timing props were supplied (elapsed.label is null). */}
          {elapsed.label && (
            <p
              className="text-xs font-mono text-muted-foreground"
              data-testid="solve-dialog-elapsed"
              aria-live="polite"
            >
              {elapsed.label}
            </p>
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
  disabled,
}: {
  id: string;
  testId: string;
  labelPrefix: string;
  canonicalUnit: CanonicalUnit | null;
  value: number;
  onCommit: (canonicalValue: number) => void;
  disabled?: boolean;
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
        disabled={disabled || draft.disabled}
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
