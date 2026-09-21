import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type CanonicalUnit, roundForFile } from "@workspace/units";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { isComplete } from "@/hooks/useDistanceDraft";

// T13 (chen-bands-units) — the ONE free-band add/remove chip editor, shared
// by OptimizationParametersTab and SolveDialog (plan-review #5: two parents
// used to hold their own copy of this add/remove logic; extracted here so
// they can never drift onto two different implementations again — the same
// bug class this codebase has hit 5+ times, see model-integration-precheck.md
// Gate 1).
//
// Free bands: add/remove any positive boundary; auto-sorted; duplicates
// rejected; removal blocked if it would empty the array (>=1 boundary
// always, matching the backend's `.min(1)` schema — spec Part A decision
// 1c). No maxDist coupling, no locked/non-removable chip, no prune-on-lower
// logic. The min-1 guard lives HERE (inside `removeBand`, not only on the
// button's `disabled` attribute) so the invariant travels with the
// component if either caller's JSX changes around it later.
export interface BandChipEditorProps {
  /** Canonical-unit boundary values. */
  bands: number[];
  onChange: (bands: number[]) => void;
  disabled?: boolean;
  /** Legacy label-only unit string, used ONLY when `canonicalUnit` is
   * omitted entirely (`undefined`) — every pre-chen-bands-units caller/test
   * keeps this exact behavior, zero `UnitProvider` dependency. Defaults
   * "mi" (unchanged default). */
  distanceUnit?: string;
  /**
   * Part D opt-in switch (three-state, deliberately not a plain boolean):
   * - `undefined` (omitted) -> LEGACY mode: raw numbers, `distanceUnit`
   *   label, `parseInt`-based add, no `UnitProvider` requirement at all.
   *   This is the safe default every existing (not-yet-migrated) caller
   *   keeps getting — adding this prop is additive, never breaking.
   * - `null` -> the caller HAS opted in, but the active model's canonical
   *   unit has not resolved yet (manifest still loading). No fallback: the
   *   editor renders disabled with a "Loading distance unit…" placeholder,
   *   never assumes mi/km.
   * - a resolved `CanonicalUnit` -> full display-unit-aware editing,
   *   converting through `@workspace/units`' pure functions (never
   *   re-implemented here).
   */
  canonicalUnit?: CanonicalUnit | null;
  /** Distinguishes OptimizationParametersTab's bare testids
   * (`button-bands-plus`, …) from SolveDialog's `solve-dialog-`-prefixed
   * ones, so both surfaces can render through this one component without
   * any testid collision or churn to either caller's existing tests.
   * Defaults to "" (OptimizationParametersTab's existing bare ids). */
  testIdPrefix?: string;
}

export function BandChipEditor(props: BandChipEditorProps) {
  const { canonicalUnit } = props;
  if (canonicalUnit !== undefined) {
    // Narrowed to `CanonicalUnit | null` here — the unit-aware branch is a
    // SEPARATE component instance, so calling `useDisplayUnit()` inside it
    // never affects a caller that never opted in (Rules of Hooks: hooks
    // live in whichever component actually mounts, not in a shared branch
    // of one component's own render).
    return <UnitAwareBandChipEditor {...props} canonicalUnit={canonicalUnit} />;
  }
  return <LegacyBandChipEditor {...props} />;
}

function LegacyBandChipEditor({
  bands,
  onChange,
  disabled,
  distanceUnit,
  testIdPrefix = "",
}: BandChipEditorProps) {
  const [addingBand, setAddingBand] = useState(false);
  const [newBandValue, setNewBandValue] = useState("");

  function addBand() {
    const val = parseInt(newBandValue, 10);
    if (!isNaN(val) && val > 0 && !bands.includes(val)) {
      onChange([...bands, val].sort((a, b) => a - b));
    }
    setNewBandValue("");
    setAddingBand(false);
  }

  function removeBand(band: number) {
    // Internal invariant guard (backend `.min(1)`) — travels with the
    // component regardless of what the caller's button `disabled` does.
    if (bands.length <= 1) return;
    onChange(bands.filter((b) => b !== band));
  }

  const emptyTestId = testIdPrefix ? `${testIdPrefix}bands-empty` : "distance-bands-empty";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {/* No `?? "mi"`: an unmigrated caller shows a bare noun rather than a
            guessed unit. Chen is km-canonical, so guessing renders a CORRECT
            number under a WRONG unit — the defect this bundle exists to remove.
            The unit-aware branch always has a real unit; this one may not. */}
        <Label className="text-xs font-semibold text-foreground">
          Distance bands{distanceUnit ? ` (${distanceUnit})` : ""}
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAddingBand(true)}
          disabled={disabled}
          data-testid={`${testIdPrefix}button-bands-plus`}
          className="h-6 px-2 text-xs"
        >
          + Add
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {bands.map((b) => (
          <span
            key={b}
            data-testid={`${testIdPrefix}band-${b}`}
            className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded px-2 py-1 font-mono"
          >
            {b.toLocaleString()}
            <button
              type="button"
              aria-label={`Remove band ${b}`}
              data-testid={`${testIdPrefix}button-remove-band-${b}`}
              onClick={() => removeBand(b)}
              disabled={disabled || bands.length <= 1}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        {bands.length === 0 && (
          <span className="text-xs text-muted-foreground" data-testid={emptyTestId}>
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
            disabled={disabled}
            onChange={(e) => setNewBandValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addBand();
              if (e.key === "Escape") {
                setAddingBand(false);
                setNewBandValue("");
              }
            }}
            className="h-7 text-xs w-28 font-mono"
            placeholder="e.g. 500"
            data-testid={`${testIdPrefix}input-new-band`}
          />
          <Button type="button" size="sm" onClick={addBand} disabled={disabled} className="h-7 px-2 text-xs" data-testid={`${testIdPrefix}button-add-band-confirm`}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setAddingBand(false);
              setNewBandValue("");
            }}
            className="h-7 px-2 text-xs"
            data-testid={`${testIdPrefix}button-add-band-cancel`}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function UnitAwareBandChipEditor({
  bands,
  onChange,
  disabled,
  canonicalUnit,
  testIdPrefix = "",
}: BandChipEditorProps & { canonicalUnit: CanonicalUnit | null }) {
  const { effectiveUnit, toDisplay, fromDisplay } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const gated = unit == null;

  // The "add a new band" field is a CREATE, not an edit of an existing
  // committed value — `useDistanceDraft` models the latter (it always has a
  // real canonical `value` to seed/anchor from), so it doesn't fit this
  // field cleanly (there is no pre-existing value to show while idle, only
  // ever blank). This reuses the SAME shared completeness grammar
  // (`isComplete`) and the SAME shared conversion math (`fromDisplay`,
  // `roundForFile`) the hook itself is built on — no re-implementation,
  // just a plain local text draft instead of the hook's stateful contract.
  const [addingBand, setAddingBand] = useState(false);
  const [newBandText, setNewBandText] = useState("");
  const prevUnitRef = useRef(unit);
  if (unit !== prevUnitRef.current) {
    prevUnitRef.current = unit;
    // Discard-on-toggle: an in-progress, never-yet-committed "new band"
    // draft has no canonical anchor to re-project (unlike a committed
    // field's fixed anchor) — matches useDistanceDraft's own
    // incomplete-draft-discarded-on-toggle rule, applied here because this
    // field is never "complete" in the anchor sense until it's added.
    if (addingBand) {
      setAddingBand(false);
      setNewBandText("");
    }
  }

  function addBand() {
    if (gated || canonicalUnit == null || !isComplete(newBandText)) {
      setNewBandText("");
      setAddingBand(false);
      return;
    }
    const canonicalVal = roundForFile(fromDisplay(parseFloat(newBandText), canonicalUnit));
    if (canonicalVal > 0 && !bands.some((b) => b === canonicalVal)) {
      onChange([...bands, canonicalVal].sort((a, b) => a - b));
    }
    setNewBandText("");
    setAddingBand(false);
  }

  function removeBand(band: number) {
    if (bands.length <= 1) return;
    onChange(bands.filter((b) => b !== band));
  }

  const emptyTestId = testIdPrefix ? `${testIdPrefix}bands-empty` : "distance-bands-empty";
  const label = gated ? "Distance bands" : `Distance bands (${unit})`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-foreground">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAddingBand(true)}
          disabled={disabled || gated}
          data-testid={`${testIdPrefix}button-bands-plus`}
          className="h-6 px-2 text-xs"
        >
          + Add
        </Button>
      </div>
      {gated ? (
        <p className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}bands-unit-pending`}>
          Loading distance unit…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {bands.map((b) => (
              <span
                key={b}
                data-testid={`${testIdPrefix}band-${b}`}
                className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded px-2 py-1 font-mono"
              >
                {toDisplay(b, canonicalUnit!).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                <button
                  type="button"
                  aria-label={`Remove band ${b}`}
                  data-testid={`${testIdPrefix}button-remove-band-${b}`}
                  onClick={() => removeBand(b)}
                  disabled={disabled || bands.length <= 1}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            {bands.length === 0 && (
              <span className="text-xs text-muted-foreground" data-testid={emptyTestId}>
                No bands configured.
              </span>
            )}
          </div>
          {addingBand && (
            <div className="flex gap-1.5">
              <Input
                type="text"
                inputMode="decimal"
                autoFocus
                value={newBandText}
                disabled={disabled}
                onChange={(e) => setNewBandText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addBand();
                  if (e.key === "Escape") {
                    setAddingBand(false);
                    setNewBandText("");
                  }
                }}
                className="h-7 text-xs w-28 font-mono"
                placeholder="e.g. 500"
                data-testid={`${testIdPrefix}input-new-band`}
              />
              <Button type="button" size="sm" onClick={addBand} disabled={disabled} className="h-7 px-2 text-xs" data-testid={`${testIdPrefix}button-add-band-confirm`}>
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  setAddingBand(false);
                  setNewBandText("");
                }}
                className="h-7 px-2 text-xs"
                data-testid={`${testIdPrefix}button-add-band-cancel`}
              >
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
