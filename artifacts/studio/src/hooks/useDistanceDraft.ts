import { useRef, useState } from "react";
import { roundForFile, type CanonicalUnit } from "@workspace/units";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { formatDistanceDisplay, stripGrouping } from "@/lib/formatDistanceDisplay";

// SCN chen-bands-units, Part D — the write-path draft contract. This is the
// SINGLE normative implementation; T12/T13's editors consume it verbatim,
// they do not re-implement any of this logic.
//
// A draft's text is ALWAYS in the current effective display unit — there is
// no per-field unit divergence and no `authoredUnit` field, because the
// toggle rule below makes a mismatch unrepresentable.

/**
 * Exact completeness grammar (spec Part D). Numeric parseability is NOT the
 * test — `parseFloat("5.")` returns `5`, yet `5.` is an editable partial
 * token that must not be treated as a committable/convertible value.
 */
export const COMPLETE_NUMBER = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

export const isComplete = (text: string): boolean => COMPLETE_NUMBER.test(text);

interface DraftState {
  /** Exactly what's rendered / what the user typed — verbatim, never
   *  reformatted while incomplete. */
  text: string;
  /**
   * Canonical-unit equivalent of `text`, fixed at the moment `text` was last
   * typed (converted via whichever unit was effective then). A unit TOGGLE
   * re-projects this single fixed anchor into the new unit — it never
   * re-derives from the previously *displayed* string — so N toggles are
   * idempotent, not cumulative: each toggle is a pure function of
   * (anchor, targetUnit), never chained off the last render's output.
   * `NaN` while `text` is incomplete (no canonical value exists yet).
   */
  anchor: number;
}

export interface UseDistanceDraftOptions {
  /** The active model's canonical unit for this field; `null` while it has
   *  not resolved yet (e.g. manifest still loading) — the hook fully
   *  disables itself. There is no fallback unit, ever. */
  canonicalUnit: CanonicalUnit | null;
  /** The current committed (canonical-unit) value. */
  value: number;
  /** Fired with the new CANONICAL value on a successful commit. Never fired
   *  for an incomplete draft, and never fired by a unit toggle. */
  onCommit: (canonicalValue: number) => void;
  /**
   * Identity of "what this draft belongs to" (e.g. scenario id, or a row
   * id for a grid of distance fields). Changing it discards any in-progress
   * draft and reseeds from `value` — the scenario-switch-discards-all-
   * drafts rule. Omit for a field whose identity never changes
   * independently of `value` itself.
   */
  resetKey?: unknown;
  /**
   * ch4-fixes item 4 — how the COMMITTED value renders while the field is
   * idle. Opt-in, default `"raw"`, so the five non-Distances-tab consumers
   * (SolveDialog, OptimizationParametersTab, WarehouseTable, CustomerTable,
   * BandChipEditor) are byte-for-byte unchanged.
   *
   * `"grouped"`: idle text is thousands-grouped at max 2 dp ("11,998.25").
   * The instant the field is FOCUSED it reverts to the full-precision raw
   * text ("11998.2461") — so a user who focuses a 4-dp override and commits
   * it cannot silently truncate the stored value to the 2 dp they were
   * shown. Grouping separators are stripped on input, so typing or pasting
   * "1,234.5" still parses.
   */
  presentation?: "raw" | "grouped";
}

export interface UseDistanceDraftResult {
  /** Render as the input's controlled value. Always in the CURRENT
   *  effective display unit. Empty string while `disabled`. */
  text: string;
  /** True while `canonicalUnit` is unresolved. Render the input disabled;
   *  no value or unit label should render alongside it either. */
  disabled: boolean;
  /** True while there is an uncommitted, in-progress edit. */
  isDirty: boolean;
  /** Call on every keystroke (the input's onChange/onInput). */
  onChange(text: string): void;
  /** Call on blur / Enter. Commits a complete draft to canonical via
   *  `onCommit`; an incomplete draft is discarded and the field reverts to
   *  the stored value. A no-op when there is no in-progress draft. */
  commit(): void;
  /** Call on Escape. Always discards, never commits. */
  discard(): void;
  /**
   * ch4-fixes item 4 — call on the input's `onFocus`. Under
   * `presentation: "grouped"` this is what swaps the idle formatted text for
   * the full-precision raw value before any keystroke can anchor off it.
   * A no-op under the default `"raw"` presentation.
   */
  onFocus(): void;
}

export function useDistanceDraft({
  canonicalUnit,
  value,
  onCommit,
  resetKey,
  presentation = "raw",
}: UseDistanceDraftOptions): UseDistanceDraftResult {
  const { effectiveUnit, toDisplay, fromDisplay } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);

  const [draft, setDraft] = useState<DraftState | null>(null);
  // ch4-fixes item 4 — only ever read under `presentation: "grouped"`.
  const [focused, setFocused] = useState(false);

  // React-sanctioned "adjust state during render in response to a prop
  // change" pattern (no effect, no extra paint) — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const prevUnitRef = useRef<CanonicalUnit | null>(unit);
  const prevResetKeyRef = useRef(resetKey);

  if (resetKey !== prevResetKeyRef.current) {
    // Scenario/row switch — discard unconditionally, no reprojection.
    prevResetKeyRef.current = resetKey;
    prevUnitRef.current = unit;
    if (draft !== null) setDraft(null);
  } else if (unit !== prevUnitRef.current) {
    const prevUnit = prevUnitRef.current;
    prevUnitRef.current = unit;
    if (draft !== null) {
      if (isComplete(draft.text) && prevUnit != null && unit != null && canonicalUnit != null) {
        // Complete draft: re-project the FIXED anchor into the new unit.
        // Never touches draft.text as an input to the conversion, so
        // repeated toggles cannot accumulate floating-point drift.
        const nextText = String(roundForFile(toDisplay(draft.anchor, canonicalUnit)));
        setDraft({ text: nextText, anchor: draft.anchor });
      } else {
        // Incomplete draft (or the unit just became unresolved): discard,
        // visibly — the field reverts to the stored value in the new unit.
        setDraft(null);
      }
    }
  }

  const disabled = canonicalUnit == null || unit == null;

  // The committed value's raw, full-precision display text. This is what a
  // draft anchors off and what `"grouped"` reverts to on focus — the
  // formatted form below is never an input to any conversion.
  const committedRawText = disabled ? "" : String(roundForFile(toDisplay(value, canonicalUnit!)));

  const text = disabled
    ? ""
    : draft !== null
      ? draft.text
      : presentation === "grouped" && !focused
        ? formatDistanceDisplay(toDisplay(value, canonicalUnit!))
        : committedRawText;

  function onChange(next: string): void {
    if (disabled || canonicalUnit == null) return;
    // ch4-fixes item 4 — a pasted/typed grouped value ("1,234.5") must still
    // satisfy the completeness grammar. Stripping is unconditional: a comma
    // is never valid in a raw draft either, so this cannot change `"raw"`
    // behavior for any input a user could previously commit.
    const cleaned = stripGrouping(next);
    const anchor = isComplete(cleaned) ? fromDisplay(parseFloat(cleaned), canonicalUnit) : Number.NaN;
    setDraft({ text: cleaned, anchor });
  }

  function onFocus(): void {
    if (presentation === "grouped") setFocused(true);
  }

  function commit(): void {
    // ch4-fixes item 4 — `commit` IS the blur handler at every call site (and
    // the Enter handler, which is also a natural "done editing" signal), so
    // it is where the grouped presentation resumes. Cleared before the
    // early return so blurring an untouched field still re-formats it.
    setFocused(false);
    if (disabled || draft === null) return;
    if (isComplete(draft.text) && !Number.isNaN(draft.anchor)) {
      onCommit(draft.anchor);
    }
    setDraft(null);
  }

  function discard(): void {
    setFocused(false);
    setDraft(null);
  }

  return { text, disabled, isDirty: draft !== null, onChange, commit, discard, onFocus };
}
