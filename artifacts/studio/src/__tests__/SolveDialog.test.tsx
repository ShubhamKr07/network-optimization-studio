import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act } from "@testing-library/react";
import { SolveDialog } from "@/components/workspace/SolveDialog";
import { UnitProvider } from "@/contexts/UnitContext";

// T4/R5 — standalone SolveDialog unit tests for the new distance-band
// editor: prefill, add/remove writes through the shared `onChange` (the
// exact same field/value shape p/gap/timeLimitSec already use), unit label
// sourced from `distanceUnit`, and disabled while busy. Workspace.test.tsx
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
      phase="idle"
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

  it("disables the add/remove band controls while busy (saving/solving)", () => {
    renderDialog({ distanceBands: [200, 400], phase: "solving" });
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeDisabled();
    expect(screen.getByTestId("solve-dialog-button-remove-band-200")).toBeDisabled();
  });

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

// C4.12 — max-coverage-us: the Solve dialog caps P at a model-specific
// maximum (D27, generically exercised here via the `pMax` prop) and hides
// the band editor (D13/D19 — bands are derived [high, max]). Both are
// opt-in props (default 50 / true), so every other model's Solve dialog is
// unchanged.
describe("SolveDialog — max-coverage-us pMax + no band editor (C4.12)", () => {
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
});

// CH4-17 — the free objective toggle (and its coverage-floor input) are
// gone from this dialog. `objective` stays a read-only display prop, gated
// on presence exactly like before, so every other model's dialog is
// unaffected.
describe("SolveDialog — Chen objective display (CH4-17: no toggle)", () => {
  it("no longer renders a free objective toggle or a coverage-floor input for a Chen scenario (coverage)", () => {
    renderDialog({ objective: "coverage", avgServiceDistCapKm: 1000, distanceUnit: "km" });
    expect(screen.queryByTestId("solve-dialog-chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-avg-service-cap")).toBeInTheDocument();
  });

  it("renders no avg-service-cap or coverage-floor input for a min_distance display (only the server can produce that objective)", () => {
    renderDialog({ objective: "min_distance", distanceUnit: "km" });
    expect(screen.queryByTestId("solve-dialog-chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-avg-service-cap")).not.toBeInTheDocument();
  });

  it("does not render the objective section for a non-Chen scenario (objective omitted)", () => {
    renderDialog({ p: 3 });
    expect(screen.queryByTestId("solve-dialog-chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-avg-service-cap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
  });
});

// R5 — for max-coverage-us the dialog becomes confirmation-only:
// `readOnlyParams=true` hides every editable parameter control (P slider,
// avg-service-cap, gap/time-limit, band editor) regardless of which step's
// objective is being displayed, replacing them with a read-only summary.
// The other five models never pass this prop, so their dialogs are
// unaffected (asserted below via p-median-us's own render).
//
// CH4UX-4 — the two Chapter-4 cases this block used to cover (Step 1
// coverage display, Step 2 min-distance display) are deleted: no real
// caller passes `readOnlyParams` any more (Workspace.tsx's SolveDialog call
// site now always supplies `paramsSlot` for max-coverage-us instead, which
// replaces this entire built-in region regardless of `readOnlyParams`).
// `readOnlyParams` itself is still a prop on SolveDialogProps at this point
// (Task 6 deletes it) — these two cases described behaviour no live caller
// exercises any more, so they're removed here rather than re-touching this
// file again in Task 6. The p-median-us case stays: it proves the other
// five models' dialogs are untouched by this task.
describe("SolveDialog — R5 readOnlyParams (max-coverage-us confirmation-only)", () => {
  it("p-median-us's dialog (readOnlyParams omitted) is unchanged — every editable control still renders", () => {
    renderDialog({ p: 3, distanceBands: [200, 400, 800] });
    expect(screen.getByTestId("solve-dialog-slider-p")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-gap")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-time-limit")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-readonly-summary")).not.toBeInTheDocument();
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

// jade B9 — running solve clock (spec §9). Fake timers so `Date.now()` and
// the underlying `useElapsed` 1s tick are both under test control.
describe("SolveDialog — running solve clock (B9)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders nothing timing-related when no timing props are supplied (every existing caller unaffected)", () => {
    renderDialog({ phase: "solving" });
    expect(screen.queryByTestId("solve-dialog-elapsed")).not.toBeInTheDocument();
  });

  it("queued-only shows 'Queued Xs'", () => {
    const t0 = Date.now();
    renderDialog({ phase: "solving", queuedAt: t0, jobStatus: "queued" });
    expect(screen.getByTestId("solve-dialog-elapsed")).toHaveTextContent("Queued 0s");

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByTestId("solve-dialog-elapsed")).toHaveTextContent("Queued 4s");
  });

  it("shows the 'Queued Xs · Solving Ys' split once startedAt is present", () => {
    const t0 = Date.now();
    const startedAt = t0 + 2000;
    renderDialog({ phase: "solving", queuedAt: t0, startedAt, jobStatus: "running" });

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByTestId("solve-dialog-elapsed")).toHaveTextContent("Queued 2s · Solving 3s");
  });

  it("freezes on a terminal status (succeeded) — further time does not change the displayed total", () => {
    const t0 = Date.now();
    const startedAt = t0 + 1000;
    const { rerender } = renderDialog({
      phase: "solving",
      queuedAt: t0,
      startedAt,
      jobStatus: "running",
    });

    act(() => vi.advanceTimersByTime(5000));
    const finishedAt = Date.now();
    rerender(
      <SolveDialog
        open
        onOpenChange={vi.fn()}
        gap={0}
        timeLimitSec={120}
        distanceBands={[200, 400, 800]}
        phase="idle"
        onChange={vi.fn()}
        onSolve={vi.fn()}
        queuedAt={t0}
        startedAt={startedAt}
        finishedAt={finishedAt}
        jobStatus="succeeded"
      />,
    );
    expect(screen.getByTestId("solve-dialog-elapsed")).toHaveTextContent("Queued 1s · Solving 4s");

    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByTestId("solve-dialog-elapsed")).toHaveTextContent("Queued 1s · Solving 4s");
  });

  it("failed shows the frozen total, alongside the error message", () => {
    const t0 = Date.now();
    const startedAt = t0 + 1000;
    const { rerender } = renderDialog({
      phase: "solving",
      queuedAt: t0,
      startedAt,
      jobStatus: "running",
    });

    act(() => vi.advanceTimersByTime(3000));
    const finishedAt = Date.now();
    rerender(
      <SolveDialog
        open
        onOpenChange={vi.fn()}
        gap={0}
        timeLimitSec={120}
        distanceBands={[200, 400, 800]}
        phase="failed"
        errorMessage="Solver crashed"
        onChange={vi.fn()}
        onSolve={vi.fn()}
        queuedAt={t0}
        startedAt={startedAt}
        finishedAt={finishedAt}
        jobStatus="failed"
      />,
    );
    expect(screen.getByTestId("solve-dialog-elapsed")).toHaveTextContent("Queued 1s · Solving 2s");
    expect(screen.getByTestId("solve-dialog-error")).toHaveTextContent("Solver crashed");

    // Frozen — further time passing must not change it.
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByTestId("solve-dialog-elapsed")).toHaveTextContent("Queued 1s · Solving 2s");
  });
});

// A9 (SCND correctness, §2.11/A-R47) — every terminal async solve failure
// (SOLVE_FAILED and TIMEOUT alike) renders an explicit Retry action, decided
// from `errorCode` ALONE — never by parsing `errorMessage` text.
describe("SolveDialog — A9 errorCode-derived Retry action", () => {
  it("shows Retry for a SOLVE_FAILED job and clicking it calls onSolve again", () => {
    const { onSolve } = renderDialog({
      phase: "failed",
      errorMessage: "Solve failed",
      errorCode: "SOLVE_FAILED",
    });
    const retry = screen.getByTestId("solve-dialog-retry");
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it("shows Retry for a TIMEOUT job too (both known errorCode values are retryable)", () => {
    renderDialog({ phase: "failed", errorMessage: "Solve timed out", errorCode: "TIMEOUT" });
    expect(screen.getByTestId("solve-dialog-retry")).toBeInTheDocument();
  });

  it("still shows Retry for a synchronous (pre-job) failure with no errorCode at all", () => {
    renderDialog({ phase: "failed", errorMessage: "Could not enqueue the solve. Try again.", errorCode: undefined });
    expect(screen.getByTestId("solve-dialog-retry")).toBeInTheDocument();
  });

  it("does not show Retry outside the failed phase", () => {
    renderDialog({ phase: "solving", errorCode: "SOLVE_FAILED" });
    expect(screen.queryByTestId("solve-dialog-retry")).not.toBeInTheDocument();
  });

  // The load-bearing invariant: Retry's presence tracks errorCode, NOT the
  // co-located errorMessage text. Same errorCode, a deliberately misleading
  // errorMessage that reads like a dead end — Retry still renders, because
  // the errorMessage is never inspected to decide this.
  it("renders Retry even when errorMessage's TEXT reads as non-retryable — only errorCode decides this", () => {
    renderDialog({
      phase: "failed",
      errorMessage: "This failure is permanent and cannot be retried.",
      errorCode: "SOLVE_FAILED",
    });
    expect(screen.getByTestId("solve-dialog-retry")).toBeInTheDocument();
  });
});

// chen-bands-units, T13, Part D — SolveDialog's own band editor + avg-cap
// field adopt the identical `useDistanceDraft` contract OptimizationParametersTab
// uses (one state source, not a parallel copy — both call the same shared
// hook and the same `@workspace/units` conversion functions).
describe("SolveDialog — Part D display-unit contract (canonicalUnit opt-in)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders a placeholder and disables editing until the Chen manifest resolves (canonicalUnit=null)", () => {
    renderDialog({
      canonicalUnit: null,
      objective: "coverage",
      avgServiceDistCapKm: 1000,
      distanceBands: [600, 5000],
    });
    expect(screen.getByTestId("solve-dialog-input-avg-service-cap")).toBeDisabled();
    expect(screen.getByTestId("solve-dialog-input-avg-service-cap")).toHaveValue("");
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeDisabled();
    expect(screen.getByTestId("solve-dialog-bands-unit-pending")).toBeInTheDocument();
  });

  it("does the same commit-as-canonical conversion as OptimizationParametersTab, through the identical hook", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onChange = vi.fn();
    renderDialog({
      canonicalUnit: "km",
      objective: "coverage",
      avgServiceDistCapKm: 1000,
      distanceBands: [600, 5000],
      onChange,
    });
    const input = screen.getByTestId("solve-dialog-input-avg-service-cap");
    // 1000 km displayed in mi: 1000 / 1.609344 = 621.3712 (rounded to 4dp).
    expect(input).toHaveValue("621.3712");
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    // 500 mi -> km: 500 * 1.609344 = 804.672.
    expect(onChange).toHaveBeenCalledWith("avgServiceDistCapKm", 804.672);
  });

  // CH4-17 — there is no coverageFloorDemand field any more; a
  // min_distance display renders no avg-service-cap and no floor field,
  // leaving gap/timeLimitSec untouched.
  it("gap / timeLimitSec are untouched by a min_distance display (no floor field exists)", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    renderDialog({
      canonicalUnit: "km",
      objective: "min_distance",
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
    // CH4UX-4 review Finding 1 — this test must NOT set `readOnlyParams`:
    // every built-in block it asserts absent below is gated
    // `!readOnlyParams && …`, so setting that flag would make all four
    // assertions pass whether or not `paramsSlot` is supplied — vacuous.
    // Instead it supplies `objective: "coverage"` so the
    // chen-objective-section assertion is real too (that block is gated
    // `!readOnlyParams && objective != null`, and `renderDialog`'s
    // defaults never pass `objective`).
    renderDialog({
      p: 5,
      objective: "coverage",
      paramsSlot: <div data-testid="slotted-params">slotted</div>,
    });
    expect(screen.getByTestId("slotted-params")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-slider-p")).toBeNull();
    expect(screen.queryByTestId("solve-dialog-input-gap")).toBeNull();
    expect(screen.queryByTestId("solve-dialog-input-time-limit")).toBeNull();
    expect(screen.queryByTestId("solve-dialog-band-200")).toBeNull();
    // The two Chapter-4-specific built-in blocks, precisely the ones a
    // Chapter 4 paramsSlot must displace. The original test asserted
    // absence for only 3 of the 5 built-in blocks; this was missing.
    expect(screen.queryByTestId("solve-dialog-chen-objective-section")).toBeNull();
  });

  it("hides the read-only summary too when a slot is supplied in the read-only branch", () => {
    // CH4UX-4 review Finding 1 — separate test for the `readOnlyParams`
    // branch: `solve-dialog-readonly-summary` is gated
    // `readOnlyParams && (…)`, nested inside the same `paramsSlot ?? (…)`
    // fallback as every other built-in block, so it never renders once a
    // slot is supplied, regardless of `readOnlyParams`. Proven
    // non-vacuous: without `paramsSlot`, this exact prop combination
    // (`readOnlyParams: true`) DOES render `solve-dialog-readonly-summary`.
    renderDialog({
      p: 5,
      readOnlyParams: true,
      paramsSlot: <div data-testid="slotted-params" />,
    });
    expect(screen.queryByTestId("solve-dialog-readonly-summary")).toBeNull();
    expect(screen.getByTestId("slotted-params")).toBeInTheDocument();
  });

  it("keeps Solve and Close interactive with a slot supplied", () => {
    const { onSolve } = renderDialog({ paramsSlot: <div data-testid="slotted-params" /> });
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    expect(onSolve).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("solve-dialog-cancel")).toBeInTheDocument();
  });
});
