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

// C4.12 — Chen (chens-cosmetics-cn): the Solve dialog caps P at 25 (D27) and
// hides the band editor (D13/D19 — bands are derived [high, max]). Both are
// opt-in props (default 50 / true), so every other model's Solve dialog is
// unchanged.
describe("SolveDialog — Chen pMax + no band editor (C4.12)", () => {
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

// Chen objective-mode toggle in the Run Optimizer dialog — mirrors
// OptimizationParametersTab's own Chen block. Gated on `objective != null`
// (opt-in prop, default undefined), so every other model's dialog is
// unaffected.
describe("SolveDialog — Chen objective mode toggle", () => {
  it("shows the toggle + active-mode field for a Chen scenario (coverage)", () => {
    renderDialog({ objective: "coverage", avgServiceDistCapKm: 1000, distanceUnit: "km" });
    expect(screen.getByTestId("solve-dialog-chen-objective-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-avg-service-cap")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
  });

  it("shows the coverage-floor field in min-distance mode", () => {
    renderDialog({ objective: "min_distance", coverageFloorDemand: 131645389, distanceUnit: "km" });
    expect(screen.getByTestId("solve-dialog-input-coverage-floor")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-avg-service-cap")).not.toBeInTheDocument();
  });

  it("toggling Coverage → Min-distance calls the shared onObjectiveModeChange handler, which swaps the visible field and keeps only the active mode's field persisted", () => {
    const onObjectiveModeChange = vi.fn();
    // Simulates Workspace.tsx's real setChenObjectiveMode transition: it
    // clears the previous mode's field and seeds the new one atomically —
    // this test asserts the dialog calls the SAME handler (not a
    // reimplementation) and re-renders correctly once the parent applies it.
    const { rerender } = renderDialog({
      objective: "coverage",
      avgServiceDistCapKm: 1000,
      distanceUnit: "km",
      onObjectiveModeChange,
    });

    fireEvent.click(screen.getByTestId("solve-dialog-chen-objective-min_distance"));
    expect(onObjectiveModeChange).toHaveBeenCalledWith("min_distance");
    expect(onObjectiveModeChange).toHaveBeenCalledTimes(1);

    // Re-render as Workspace.tsx would after applying setChenObjectiveMode's
    // atomic update: objective flips, coverageFloorDemand is seeded,
    // avgServiceDistCapKm is gone (undefined) — only the active field shows.
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
        objective="min_distance"
        coverageFloorDemand={131645389}
        avgServiceDistCapKm={undefined}
        distanceUnit="km"
        onObjectiveModeChange={onObjectiveModeChange}
      />,
    );

    expect(screen.getByTestId("solve-dialog-input-coverage-floor")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-avg-service-cap")).not.toBeInTheDocument();
  });

  it("does not render the toggle for a non-Chen scenario (objective omitted)", () => {
    renderDialog({ p: 3 });
    expect(screen.queryByTestId("solve-dialog-chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-avg-service-cap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
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

  it("gap / timeLimitSec / coverageFloorDemand are untouched by the toggle", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onChange = vi.fn();
    renderDialog({
      canonicalUnit: "km",
      objective: "min_distance",
      coverageFloorDemand: 131645389,
      distanceBands: [600, 5000],
      gap: 0.02,
      timeLimitSec: 300,
      onChange,
    });
    expect(screen.getByTestId("solve-dialog-input-gap")).toHaveValue(0.02);
    expect(screen.getByTestId("solve-dialog-input-time-limit")).toHaveValue(300);
    const floor = screen.getByTestId("solve-dialog-input-coverage-floor");
    expect(floor).toHaveValue(131645389);
    fireEvent.change(floor, { target: { value: "200000000" } });
    expect(onChange).toHaveBeenCalledWith("coverageFloorDemand", 200000000);
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
