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
