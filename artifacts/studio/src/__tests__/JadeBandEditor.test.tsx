import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JadeBandEditor } from "@/components/workspace/tabs/JadeBandEditor";

// jade B8 — fixed-4-slot band editor enforcing jadeInputsSchema's full
// invariant client-side (exactly 4, positive integers, strictly ascending).
// Spec §2 R3-1 + R6-1, plan review R-plan-2 (this component can only
// surface validity — never disable Save itself, since Save lives in
// Workspace.tsx, outside this component's ownership).

const validBands = [200, 400, 800, 1600];

describe("JadeBandEditor", () => {
  it("renders exactly 4 slots, no add/remove controls", () => {
    render(<JadeBandEditor bands={validBands} onChange={vi.fn()} />);
    expect(screen.getByTestId("jade-band-slot-0")).toHaveValue(200);
    expect(screen.getByTestId("jade-band-slot-1")).toHaveValue(400);
    expect(screen.getByTestId("jade-band-slot-2")).toHaveValue(800);
    expect(screen.getByTestId("jade-band-slot-3")).toHaveValue(1600);
    expect(screen.queryByTestId("jade-band-slot-4")).not.toBeInTheDocument();
    expect(screen.queryByText(/\+ Add/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("a valid 4-tuple fires onValidityChange(true) on mount and publishes nothing extra (already valid)", () => {
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={vi.fn()} onValidityChange={onValidityChange} />);
    expect(onValidityChange).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("jade-band-error")).not.toBeInTheDocument();
  });

  it("editing a slot to a valid new value publishes the valid 4-tuple", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={onChange} onValidityChange={onValidityChange} />);
    fireEvent.change(screen.getByTestId("jade-band-slot-1"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith([200, 500, 800, 1600]);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByTestId("jade-band-error")).not.toBeInTheDocument();
  });

  // (a) zero/negative
  it("zero value: shows inline error, fires onValidityChange(false), does not publish", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={onChange} onValidityChange={onValidityChange} />);
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("jade-band-slot-0"), { target: { value: "0" } });
    expect(screen.getByTestId("jade-band-error")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("negative value: shows inline error, fires onValidityChange(false), does not publish", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={onChange} onValidityChange={onValidityChange} />);
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("jade-band-slot-0"), { target: { value: "-50" } });
    expect(screen.getByTestId("jade-band-error")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  // (b) duplicate
  it("duplicate value: shows inline error, fires onValidityChange(false), does not publish", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={onChange} onValidityChange={onValidityChange} />);
    onChange.mockClear();
    // Slot 1 (400) -> 200, duplicating slot 0.
    fireEvent.change(screen.getByTestId("jade-band-slot-1"), { target: { value: "200" } });
    expect(screen.getByTestId("jade-band-error")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  // (c) descending
  it("descending value: shows inline error, fires onValidityChange(false), does not publish", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={onChange} onValidityChange={onValidityChange} />);
    onChange.mockClear();
    // Slot 2 (800) -> 300, less than slot 1 (400) -> non-ascending.
    fireEvent.change(screen.getByTestId("jade-band-slot-2"), { target: { value: "300" } });
    expect(screen.getByTestId("jade-band-error")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("non-integer (decimal) value: shows inline error, does not publish", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={onChange} onValidityChange={onValidityChange} />);
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("jade-band-slot-0"), { target: { value: "1.5" } });
    expect(screen.getByTestId("jade-band-error")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("recovering from invalid to valid fires onValidityChange(true) again and publishes", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<JadeBandEditor bands={validBands} onChange={onChange} onValidityChange={onValidityChange} />);
    fireEvent.change(screen.getByTestId("jade-band-slot-2"), { target: { value: "300" } }); // invalid (descending)
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("jade-band-slot-2"), { target: { value: "700" } }); // valid again
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenCalledWith([200, 400, 700, 1600]);
    expect(screen.queryByTestId("jade-band-error")).not.toBeInTheDocument();
  });

  it("the editor cannot produce a set with fewer or more than 4 bands (always exactly 4 slots)", () => {
    render(<JadeBandEditor bands={[100, 200]} onChange={vi.fn()} />);
    // Renders exactly 4 slots regardless of an under-length bands prop
    // (defensive padding on mount — no path exists to add/remove a slot).
    expect(screen.getByTestId("jade-band-slot-0")).toBeInTheDocument();
    expect(screen.getByTestId("jade-band-slot-1")).toBeInTheDocument();
    expect(screen.getByTestId("jade-band-slot-2")).toBeInTheDocument();
    expect(screen.getByTestId("jade-band-slot-3")).toBeInTheDocument();
    expect(screen.queryByTestId("jade-band-slot-4")).not.toBeInTheDocument();
  });
});
