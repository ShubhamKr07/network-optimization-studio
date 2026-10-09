import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { SolveDialog } from "@/components/workspace/SolveDialog";
import { UnitProvider } from "@/contexts/UnitContext";

// T4/R5 — standalone SolveDialog unit tests for the new distance-band
// editor: prefill, add/remove writes through the shared `onChange` (the
// exact same field/value shape p/gap/timeLimitSec already use) and unit
// label sourced from `distanceUnit`. Workspace.test.tsx
// covers the end-to-end "solve uses the edited bands" integration case; this
// file is the component's own contract in isolation.
//
// chen-bands-units, T13 — every render in this file now goes through a
// `UnitProvider` ancestor via RTL's `wrapper` OPTION (not a wrapping
// element — silently dropped by `rerender(...)`). Harmless for every
// pre-existing (legacy, `canonicalUnit`-omitting) test above.
const STORAGE_KEY = "nos:display-unit-pref";
function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) {
  return rtlRender(ui, { wrapper: UnitProvider, ...options });
}

function renderDialog(over: Partial<Parameters<typeof SolveDialog>[0]> = {}) {
  const onChange = vi.fn();
  const onSolve = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <SolveDialog
      open
      onOpenChange={onOpenChange}
      gap={0}
      timeLimitSec={120}
      distanceBands={[200, 400, 800]}
      onChange={onChange}
      onSolve={onSolve}
      {...over}
    />,
  );
  return { ...view, onChange, onSolve, onOpenChange };
}

describe("SolveDialog — R5 distance-band editor", () => {
  it("prefills the chips from the scenario's current distanceBands", () => {
    renderDialog({ distanceBands: [200, 400, 800] });
    expect(screen.getByTestId("solve-dialog-band-200")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-band-400")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-band-800")).toBeInTheDocument();
  });

  it("shows 'No bands configured.' when the draft has none", () => {
    renderDialog({ distanceBands: [] });
    expect(screen.getByTestId("solve-dialog-bands-empty")).toBeInTheDocument();
  });

  // chen-bands-units review Minor 2 — was "defaults the label unit to 'mi'".
  // That default is gone: no fallback unit anywhere. An omitted distanceUnit
  // renders the bare noun rather than a unit that was never supplied.
  it("labels distance bands with NO unit when distanceUnit is omitted", () => {
    renderDialog();
    expect(screen.getByText("Distance bands")).toBeInTheDocument();
    expect(screen.queryByText("Distance bands (mi)")).not.toBeInTheDocument();
  });

  it("shows the model's real unit (km) when distanceUnit is provided", () => {
    renderDialog({ distanceUnit: "km" });
    expect(screen.getByText("Distance bands (km)")).toBeInTheDocument();
  });

  it("adding a band calls onChange('distanceBands', ...) with the new value inserted in sorted order", () => {
    const { onChange } = renderDialog({ distanceBands: [200, 800] });
    fireEvent.click(screen.getByTestId("solve-dialog-button-bands-plus"));
    fireEvent.change(screen.getByTestId("solve-dialog-input-new-band"), { target: { value: "400" } });
    fireEvent.click(screen.getByTestId("solve-dialog-button-add-band-confirm"));

    expect(onChange).toHaveBeenCalledWith("distanceBands", [200, 400, 800]);
  });

  it("removing a band calls onChange('distanceBands', ...) without that value", () => {
    const { onChange } = renderDialog({ distanceBands: [200, 400, 800] });
    fireEvent.click(screen.getByTestId("solve-dialog-button-remove-band-400"));

    expect(onChange).toHaveBeenCalledWith("distanceBands", [200, 800]);
  });

  it("ignores a duplicate or non-positive band value", () => {
    const { onChange } = renderDialog({ distanceBands: [200, 400] });
    fireEvent.click(screen.getByTestId("solve-dialog-button-bands-plus"));
    fireEvent.change(screen.getByTestId("solve-dialog-input-new-band"), { target: { value: "200" } });
    fireEvent.click(screen.getByTestId("solve-dialog-button-add-band-confirm"));

    expect(onChange).not.toHaveBeenCalled();
  });

  // CH4UX-6 — "disables the add/remove band controls while busy
  // (saving/solving)" was deleted here: this dialog has no `phase`/`busy`
  // concept any more. It closes the instant Solve is pressed, so there is no
  // state in which these controls are mounted AND a solve is running.

  // item 7 (Codex plan-review P1) — the zero-band guard is shared across
  // every free-chip model (schema is `.min(1)`), not JADE-specific: disable
  // the LAST remaining band's × control so the array can never reach [].
  it("disables the remove control on the last remaining band (zero-band guard, item 7)", () => {
    renderDialog({ distanceBands: [500] });
    expect(screen.getByTestId("solve-dialog-button-remove-band-500")).toBeDisabled();
  });

  it("does not disable a remove control when more than one band remains", () => {
    renderDialog({ distanceBands: [200, 500] });
    expect(screen.getByTestId("solve-dialog-button-remove-band-200")).toBeEnabled();
    expect(screen.getByTestId("solve-dialog-button-remove-band-500")).toBeEnabled();
  });
});

// The dialog's two built-in opt-out seams, `pMax` (default 50) and
// `showBandEditor` (default true). Both are exercised here GENERICALLY, on
// arbitrary prop values — deliberately not tied to a model.
//
// CH4UX-6 review (Finding 4) — retitled: the old title claimed
// "max-coverage-us pMax + no band editor (C4.12)" and is now false on both
// counts. max-coverage-us passes no `pMax` at all (its cap lives in the
// single `optimizationParamsBaseProps` declaration that MIG-8 guards, and it
// renders its parameters through `paramsSlot`, so the built-in slider below
// never mounts for it), and its band editor is NOT hidden any more
// (chen-bands-units re-enabled it). No live caller passes either prop; these
// cases keep the seams honest for a future one.
describe("SolveDialog — built-in P slider cap (pMax) and band-editor seam", () => {
  it("defaults the P slider max to 50 when pMax is omitted (every existing model unaffected)", () => {
    renderDialog({ p: 3 });
    const thumb = screen.getByTestId("solve-dialog-slider-p").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemax", "50");
  });

  it("caps the P slider at 25 when pMax=25 (26 is unreachable from the Solve dialog)", () => {
    renderDialog({ p: 3, pMax: 25 });
    const thumb = screen.getByTestId("solve-dialog-slider-p").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemax", "25");
  });

  it("shows the band editor by default (showBandEditor omitted)", () => {
    renderDialog({ distanceBands: [200, 400] });
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeInTheDocument();
  });

  it("hides the band editor entirely when showBandEditor=false", () => {
    renderDialog({ distanceBands: [600, 5000], showBandEditor: false, distanceUnit: "km" });
    expect(screen.queryByTestId("solve-dialog-button-bands-plus")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-band-600")).not.toBeInTheDocument();
    expect(screen.queryByText("Distance bands (km)")).not.toBeInTheDocument();
  });

  // ch5-del-10 — delivery-teaching-us caps P at 33 (schema `.max(33)`) from
  // the Solve dialog too, exactly like max-coverage-us's 25/26 pair above.
  it("caps the P slider at 33 when pMax=33 (delivery-teaching-us; 34 is unreachable from the Solve dialog)", () => {
    renderDialog({ p: 3, pMax: 33 });
    const thumb = screen.getByTestId("solve-dialog-slider-p").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemax", "33");
  });
});

// CH4O-7 — the built-in Chen objective display (and its `objective` prop)
// is deleted entirely, not just its toggle: it was unreachable dead code —
// max-coverage-us always supplies `paramsSlot` (CH4UX-4/CH4UX-6), so this
// dialog's built-in region, including this section, never mounted for it.
// The real, editable avg-cap/coverage-floor fields now live on
// `OptimizationParametersTab`, covered by that component's own tests.
describe("SolveDialog — no built-in Chen objective display (CH4O-7)", () => {
  it("does not render an objective section, avg-cap, or coverage-floor for any built-in (non-slot) render", () => {
    renderDialog({ p: 3 });
    expect(screen.queryByTestId("solve-dialog-chen-objective-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-avg-service-cap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
  });
});

// CH4UX-6 (was the R5 confirmation-only block) — that read-only parameter
// mode is gone entirely: CH4UX-4 replaced it for max-coverage-us with a real
// `paramsSlot`, and CH4UX-6 deleted the prop. What survives here is the
// regression guard that matters for the OTHER five models — a caller that
// supplies no slot still gets every built-in editable control, unchanged.
describe("SolveDialog — built-in controls for non-slot callers", () => {
  it("p-median-us's dialog (no paramsSlot) is unchanged — every editable control still renders", () => {
    renderDialog({ p: 3, distanceBands: [200, 400, 800] });
    expect(screen.getByTestId("solve-dialog-slider-p")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-gap")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-time-limit")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeInTheDocument();
  });
});

// jade-INT (workspace-fixups-2, item 7) — SolveDialog used to render a
// separate fixed-4-slot JadeBandEditor for modelId==="two-echelon-jade-us";
// that editor is deleted and JADE now renders the SAME shared free chip
// editor as every other model (its schema was relaxed to `.min(1)`,
// matching p-median/transport/gold-au).
describe("SolveDialog — JADE uses the shared chip editor (item 7)", () => {
  it("renders the shared chip editor (not JadeBandEditor) for modelId two-echelon-jade-us", () => {
    renderDialog({ modelId: "two-echelon-jade-us", distanceBands: [200, 500, 800, 1600] });
    expect(screen.queryByTestId("jade-band-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-band-200")).toBeInTheDocument();
  });

  it("adding a 5th band for JADE calls the dialog's generic onChange('distanceBands', ...) sorted", () => {
    const { onChange } = renderDialog({
      modelId: "two-echelon-jade-us",
      distanceBands: [200, 500, 800, 1600],
    });
    fireEvent.click(screen.getByTestId("solve-dialog-button-bands-plus"));
    fireEvent.change(screen.getByTestId("solve-dialog-input-new-band"), { target: { value: "2000" } });
    fireEvent.click(screen.getByTestId("solve-dialog-button-add-band-confirm"));
    expect(onChange).toHaveBeenCalledWith("distanceBands", [200, 500, 800, 1600, 2000]);
  });

  it("disables the last remaining band's × control for JADE (zero-band guard, item 7)", () => {
    renderDialog({ modelId: "two-echelon-jade-us", distanceBands: [500] });
    expect(screen.getByTestId("solve-dialog-button-remove-band-500")).toBeDisabled();
  });

  it("hides the chip editor entirely when showBandEditor=false, even for JADE", () => {
    renderDialog({
      modelId: "two-echelon-jade-us",
      distanceBands: [200, 500, 800, 1600],
      showBandEditor: false,
    });
    expect(screen.queryByTestId("jade-band-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-button-bands-plus")).not.toBeInTheDocument();
  });
});

// CH4UX-6 — the "running solve clock (B9)" and "A9 errorCode-derived Retry
// action" describe blocks that used to sit here are DELETED, not moved:
//   - the live/frozen clock now belongs to SolveProgressOverlay, and
//     `SolveProgressOverlay.test.tsx` owns those cases;
//   - the two contracts the Retry block was really protecting (the permanent
//     `errorMessage` beats the deprecated `error` alias, and both known
//     errorCode values still yield a truthful safe message) moved to
//     `Workspace.test.tsx`'s CH4UX-6 block, where the failure now surfaces.
//     Nothing derives UI actions from `errorCode` any more — the overlay's
//     Adjust/Close are unconditional — so there is no errorCode-gated
//     affordance left to test anywhere.

// chen-bands-units, T13, Part D — SolveDialog's own band editor + avg-cap
// field adopt the identical `useDistanceDraft` contract OptimizationParametersTab
// uses (one state source, not a parallel copy — both call the same shared
// hook and the same `@workspace/units` conversion functions).
describe("SolveDialog — Part D display-unit contract (canonicalUnit opt-in)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // CH4O-7 — the built-in avg-cap/coverage-floor-specific placeholder and
  // commit-as-canonical tests that used to live here are deleted along with
  // the `objective`/`avgServiceDistCapMi` props themselves (dead,
  // unreachable code — see the "no built-in Chen objective display" describe
  // block above). The placeholder-under-canonicalUnit=null contract for the
  // band editor (the part of this still genuinely owned by THIS dialog) is
  // already covered below and in BandChipEditor.test.tsx/
  // OptimizationParametersTab.test.tsx, so nothing is lost.

  // CH4O-7 — gap/timeLimitSec are untouched regardless of canonicalUnit;
  // there is no `objective`-gated avg-cap/floor field in this dialog's
  // built-in region at all any more (not just in a "min_distance display").
  it("gap / timeLimitSec are untouched by canonicalUnit (no avg-cap/coverage-floor field exists in the built-in region)", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    renderDialog({
      canonicalUnit: "km",
      distanceBands: [600, 5000],
      gap: 0.02,
      timeLimitSec: 300,
    });
    expect(screen.getByTestId("solve-dialog-input-gap")).toHaveValue(0.02);
    expect(screen.getByTestId("solve-dialog-input-time-limit")).toHaveValue(300);
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-avg-service-cap")).not.toBeInTheDocument();
  });

  it("re-enables the free band chip editor for Chen and blocks removing the last boundary", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onChange = vi.fn();
    renderDialog({ canonicalUnit: "km", distanceBands: [600] });
    const removeBtn = screen.getByTestId("solve-dialog-button-remove-band-600");
    expect(removeBtn).toBeDisabled();
    fireEvent.click(removeBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("legacy mode (canonicalUnit omitted) is completely unaffected — no UnitProvider dependency triggered", () => {
    // No canonicalUnit at all — exercises the exact same code path as every
    // pre-existing test above, confirming the opt-in is additive.
    renderDialog({ distanceUnit: "mi", distanceBands: [200, 400] });
    expect(screen.getByText("Distance bands (mi)")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-band-200")).toHaveTextContent("200");
  });
});

describe("CH4UX-3 — paramsSlot", () => {
  it("renders the built-in controls when no slot is supplied", () => {
    renderDialog({ p: 5 });
    expect(screen.getByTestId("solve-dialog-slider-p")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-gap")).toBeInTheDocument();
  });

  it("replaces every built-in control with the slot's content when supplied", () => {
    // CH4UX-4 review Finding 1, still load-bearing after CH4UX-6 removed
    // the read-only-mode half of every gate: each assertion below
    // must name a block whose OWN remaining gate this render satisfies, or
    // it passes whether or not `paramsSlot` is supplied. Hence `p: 5` (the
    // slider block is gated `p != null`). CH4O-7 — the built-in Chen
    // objective section (and its `objective` prop) is deleted entirely, so
    // there is no longer a gate to exercise for it here; the gap/time-limit
    // grid and the band editor are unconditional inside the fallback, so
    // those two are real by construction.
    renderDialog({
      p: 5,
      paramsSlot: <div data-testid="slotted-params">slotted</div>,
    });
    expect(screen.getByTestId("slotted-params")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-slider-p")).toBeNull();
    expect(screen.queryByTestId("solve-dialog-input-gap")).toBeNull();
    expect(screen.queryByTestId("solve-dialog-input-time-limit")).toBeNull();
    expect(screen.queryByTestId("solve-dialog-band-200")).toBeNull();
    // review F5 — a `solve-dialog-chen-objective-section` assertion used to
    // sit here, but that testid has never existed anywhere in SolveDialog's
    // built-in (non-slot) region (CH4O-7 deleted that block entirely, not
    // just its toggle — see "SolveDialog — no built-in Chen objective
    // display" below). The assertion therefore passed whether or not
    // `paramsSlot` was supplied, which is exactly the failure mode the
    // comment above (CH4UX-4 review Finding 1) forbids — removed rather than
    // kept passing vacuously.
  });

  // CH4UX-6 — the sibling case "hides the read-only summary too when a slot
  // is supplied in the read-only branch" (added by CH4UX-4's review fix) is
  // deleted along with the confirmation-only prop itself: there is no
  // read-only summary left in this component to hide.

  it("keeps Solve and Close interactive with a slot supplied", () => {
    const { onSolve } = renderDialog({ paramsSlot: <div data-testid="slotted-params" /> });
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    expect(onSolve).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("solve-dialog-cancel")).toBeInTheDocument();
  });
});
