import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import {
  useDistanceDraft,
  isComplete,
  type UseDistanceDraftOptions,
} from "@/hooks/useDistanceDraft";

// Plain `.ts` (no JSX) per the plan's file list — build the wrapper element
// via `createElement` instead of a `.tsx`-only JSX literal.
function wrapper({ children }: { children: ReactNode }) {
  return createElement(UnitProvider, null, children);
}

/** Renders both `useDisplayUnit()` (to drive the global pref) and
 *  `useDistanceDraft()` (the thing under test) inside one shared
 *  `UnitProvider`, so a test can toggle the unit and observe the draft. */
function renderDraft(initialProps: UseDistanceDraftOptions) {
  return renderHook(
    (props: UseDistanceDraftOptions) => ({
      unit: useDisplayUnit(),
      draft: useDistanceDraft(props),
    }),
    { wrapper, initialProps },
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("isComplete / COMPLETE_NUMBER grammar", () => {
  it.each(["5", "-5.5", ".5", "5e3", "5e-3"])("%s is COMPLETE", (t) => {
    expect(isComplete(t)).toBe(true);
  });

  it.each(["", "-", ".", "5.", "5e", "5e+", "--5"])("%s is INCOMPLETE", (t) => {
    expect(isComplete(t)).toBe(false);
  });
});

describe("useDistanceDraft", () => {
  it("seeds the draft from the canonical value rendered in the effective display unit", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 500, onCommit });
    expect(result.current.draft.text).toBe("500");

    act(() => result.current.unit.setPref("mi"));
    // No edit was ever made — this is a fresh re-derivation from the stored
    // canonical value in the newly effective unit, not a toggle-projection.
    expect(result.current.draft.text).toBe("310.6856");
  });

  it("commits a display-unit entry back to canonical (500 mi -> 804.672 km)", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 0, onCommit });
    act(() => result.current.unit.setPref("mi"));

    act(() => result.current.draft.onChange("500"));
    act(() => result.current.draft.commit());

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(804.672);
  });

  it("converts a COMPLETE draft in place on a unit toggle", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 0, onCommit });

    act(() => result.current.draft.onChange("500")); // typed while effective unit is km (pref "auto")
    expect(result.current.draft.text).toBe("500");

    act(() => result.current.unit.setPref("mi"));
    expect(result.current.draft.text).toBe("310.6856");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("DISCARDS an incomplete draft on toggle and reseeds from the stored value in the new unit", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 500, onCommit });

    act(() => result.current.draft.onChange("5."));
    expect(result.current.draft.text).toBe("5.");
    expect(result.current.draft.isDirty).toBe(true);

    act(() => result.current.unit.setPref("mi"));
    // Discarded, visibly: reverted to the STORED value (500), not the
    // half-typed "5.", rendered fresh in the new unit.
    expect(result.current.draft.text).toBe("310.6856");
    expect(result.current.draft.isDirty).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each(["", "-", ".", "5.", "5e", "5e+", "--5"])(
    "%s is incomplete and never commits",
    (token) => {
      const onCommit = vi.fn();
      const { result } = renderDraft({ canonicalUnit: "km", value: 42, onCommit });

      act(() => result.current.draft.onChange(token));
      act(() => result.current.draft.commit());

      expect(onCommit).not.toHaveBeenCalled();
      // Reverted to the stored value — never left showing the bad token.
      expect(result.current.draft.text).toBe("42");
    },
  );

  it("is disabled / commits nothing while the canonical unit is unresolved", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: null, value: 500, onCommit });

    expect(result.current.draft.disabled).toBe(true);
    expect(result.current.draft.text).toBe("");

    act(() => result.current.draft.onChange("999"));
    act(() => result.current.draft.commit());

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.draft.text).toBe("");
  });

  it("Esc (discard()) always discards without committing", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 500, onCommit });

    act(() => result.current.draft.onChange("999"));
    act(() => result.current.draft.discard());

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.draft.text).toBe("500");
    expect(result.current.draft.isDirty).toBe(false);
  });

  it("a resetKey change (e.g. scenario switch) discards any in-progress draft", () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderDraft({
      canonicalUnit: "km",
      value: 500,
      onCommit,
      resetKey: "scenario-1",
    });

    act(() => result.current.draft.onChange("999"));
    expect(result.current.draft.isDirty).toBe(true);

    rerender({ canonicalUnit: "km", value: 500, onCommit, resetKey: "scenario-2" });

    expect(result.current.draft.isDirty).toBe(false);
    expect(result.current.draft.text).toBe("500");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("repeated toggling introduces no drift — an uncommitted complete draft round-trips bit-identically", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 0, onCommit });

    act(() => result.current.draft.onChange("500")); // effective unit: km
    act(() => result.current.unit.setPref("mi"));
    act(() => result.current.unit.setPref("km"));
    act(() => result.current.unit.setPref("mi"));
    act(() => result.current.unit.setPref("km"));

    expect(result.current.draft.text).toBe("500");

    act(() => result.current.draft.commit());
    // The anchor was never re-derived from the displayed (rounded) string at
    // any intermediate toggle, so the committed canonical value is exactly
    // what was originally typed — not a float-drifted approximation.
    expect(onCommit).toHaveBeenCalledWith(500);
  });

  it("repeated toggling introduces no drift — a stored (non-draft) value never mutates and re-renders identically", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 500, onCommit });

    act(() => result.current.unit.setPref("mi"));
    act(() => result.current.unit.setPref("km"));
    act(() => result.current.unit.setPref("mi"));
    act(() => result.current.unit.setPref("km"));

    expect(result.current.draft.text).toBe("500");
    // Toggling never calls onCommit — storage is never re-quantized by it.
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("toggling never marks a draft dirty on its own and never fires onCommit", () => {
    const onCommit = vi.fn();
    const { result } = renderDraft({ canonicalUnit: "km", value: 500, onCommit });

    act(() => result.current.unit.setPref("mi"));
    expect(result.current.draft.isDirty).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
