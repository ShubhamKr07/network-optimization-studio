import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SolveDialog } from "@/components/workspace/SolveDialog";

// T4/R5 — standalone SolveDialog unit tests for the new distance-band
// editor: prefill, add/remove writes through the shared `onChange` (the
// exact same field/value shape p/gap/timeLimitSec already use), unit label
// sourced from `distanceUnit`, and disabled while busy. Workspace.test.tsx
// covers the end-to-end "solve uses the edited bands" integration case; this
// file is the component's own contract in isolation.

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

  it("defaults the label unit to 'mi' when distanceUnit is omitted", () => {
    renderDialog();
    expect(screen.getByText("Distance bands (mi)")).toBeInTheDocument();
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
    renderDialog({ distanceBands: [200], phase: "solving" });
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeDisabled();
    expect(screen.getByTestId("solve-dialog-button-remove-band-200")).toBeDisabled();
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

  it("shows the coverage-floor field (with the infeasibility hint) in min-distance mode", () => {
    renderDialog({ objective: "min_distance", coverageFloorDemand: 131645389, distanceUnit: "km" });
    expect(screen.getByTestId("solve-dialog-input-coverage-floor")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-coverage-floor-hint")).toHaveTextContent("> total demand 199M = infeasible");
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

// jade B9 — SolveDialog renders JadeBandEditor (fixed-4-slot, fully
// validated) only for modelId==="two-echelon-jade-us"; every other modelId
// (including undefined) keeps the existing chip editor unchanged. Mirrors
// OptimizationParametersTab's (B8) own modelId-gated wiring test exactly.
describe("SolveDialog — JADE band editor wiring (B9)", () => {
  it("renders the chip editor (not JadeBandEditor) when modelId is undefined", () => {
    renderDialog({ distanceBands: [200, 400, 800] });
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeInTheDocument();
    expect(screen.queryByTestId("jade-band-editor")).not.toBeInTheDocument();
  });

  it("renders the chip editor (not JadeBandEditor) for a non-JADE modelId", () => {
    renderDialog({ modelId: "p-median-us", distanceBands: [200, 400, 800] });
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeInTheDocument();
    expect(screen.queryByTestId("jade-band-editor")).not.toBeInTheDocument();
  });

  it("renders JadeBandEditor (not the chip editor) for modelId two-echelon-jade-us", () => {
    renderDialog({ modelId: "two-echelon-jade-us", distanceBands: [200, 500, 800, 1600] });
    expect(screen.getByTestId("jade-band-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-button-bands-plus")).not.toBeInTheDocument();
  });

  it("JadeBandEditor edits flow through the dialog's generic onChange('distanceBands', ...)", () => {
    const { onChange } = renderDialog({
      modelId: "two-echelon-jade-us",
      distanceBands: [200, 500, 800, 1600],
    });
    fireEvent.change(screen.getByTestId("jade-band-slot-1"), { target: { value: "600" } });
    expect(onChange).toHaveBeenCalledWith("distanceBands", [200, 600, 800, 1600]);
  });

  it("an invalid JADE band edit does not call onChange, and surfaces onDistanceBandsValidityChange(false)", () => {
    const onDistanceBandsValidityChange = vi.fn();
    const { onChange } = renderDialog({
      modelId: "two-echelon-jade-us",
      distanceBands: [200, 500, 800, 1600],
      onDistanceBandsValidityChange,
    });
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("jade-band-slot-0"), { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onDistanceBandsValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("jade-band-error")).toBeInTheDocument();
  });

  it("a valid JADE band set surfaces onDistanceBandsValidityChange(true)", () => {
    const onDistanceBandsValidityChange = vi.fn();
    renderDialog({
      modelId: "two-echelon-jade-us",
      distanceBands: [200, 500, 800, 1600],
      onDistanceBandsValidityChange,
    });
    expect(onDistanceBandsValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("hides JadeBandEditor entirely when showBandEditor=false, even for JADE", () => {
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
