import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
