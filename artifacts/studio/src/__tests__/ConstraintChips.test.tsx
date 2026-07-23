import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConstraintChips } from "@/components/ConstraintChips";

function baseProps() {
  return {
    pValue: 3,
    capacityMode: "none" as const,
    uniformCapacity: null,
    forcedOpenCount: 0,
    inactiveCount: 0,
    excludedCount: 0,
    demandEditedCount: 0,
    stale: false,
    onFocusP: vi.fn(),
    onFocusCapacity: vi.fn(),
    onFocusWarehouses: vi.fn(),
    onFocusCustomers: vi.fn(),
  };
}

describe("ConstraintChips", () => {
  it("always shows p and capacity chips", () => {
    render(<ConstraintChips {...baseProps()} />);
    expect(screen.getByTestId("chip-p")).toHaveTextContent("p = 3");
    expect(screen.getByTestId("chip-capacity")).toHaveTextContent("Capacity: none");
  });

  it("formats a uniform capacity in millions", () => {
    render(<ConstraintChips {...baseProps()} capacityMode="uniform" uniformCapacity={10_000_000} />);
    expect(screen.getByTestId("chip-capacity")).toHaveTextContent("Capacity: uniform 10M");
  });

  it("formats per-warehouse capacity mode", () => {
    render(<ConstraintChips {...baseProps()} capacityMode="per_wh" />);
    expect(screen.getByTestId("chip-capacity")).toHaveTextContent("Capacity: per-warehouse");
  });

  it("hides forced-open/inactive/excluded/demand-edited chips when their counts are 0", () => {
    render(<ConstraintChips {...baseProps()} />);
    expect(screen.queryByTestId("chip-forced-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chip-inactive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chip-excluded")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chip-demand-edited")).not.toBeInTheDocument();
  });

  it("shows chips for non-zero forced-open/inactive/excluded/demand-edited counts", () => {
    render(<ConstraintChips {...baseProps()} forcedOpenCount={2} inactiveCount={1} excludedCount={3} demandEditedCount={12} />);
    expect(screen.getByTestId("chip-forced-open")).toHaveTextContent("2 forced open");
    expect(screen.getByTestId("chip-inactive")).toHaveTextContent("1 inactive");
    expect(screen.getByTestId("chip-excluded")).toHaveTextContent("3 customers excluded");
    expect(screen.getByTestId("chip-demand-edited")).toHaveTextContent("demand edited (12)");
  });

  it("shows a Stale chip only when stale is true", () => {
    const { rerender } = render(<ConstraintChips {...baseProps()} stale={false} />);
    expect(screen.queryByTestId("chip-stale")).not.toBeInTheDocument();
    rerender(<ConstraintChips {...baseProps()} stale={true} />);
    expect(screen.getByTestId("chip-stale")).toBeInTheDocument();
  });

  it("clicking the p chip calls onFocusP", async () => {
    const props = baseProps();
    render(<ConstraintChips {...props} />);
    await userEvent.click(screen.getByTestId("chip-p"));
    expect(props.onFocusP).toHaveBeenCalled();
  });

  it("clicking the capacity chip calls onFocusCapacity", async () => {
    const props = baseProps();
    render(<ConstraintChips {...props} />);
    await userEvent.click(screen.getByTestId("chip-capacity"));
    expect(props.onFocusCapacity).toHaveBeenCalled();
  });

  it("clicking forced-open/inactive chips calls onFocusWarehouses", async () => {
    const props = baseProps();
    render(<ConstraintChips {...props} forcedOpenCount={2} inactiveCount={1} />);
    await userEvent.click(screen.getByTestId("chip-forced-open"));
    await userEvent.click(screen.getByTestId("chip-inactive"));
    expect(props.onFocusWarehouses).toHaveBeenCalledTimes(2);
  });

  it("clicking excluded/demand-edited chips calls onFocusCustomers", async () => {
    const props = baseProps();
    render(<ConstraintChips {...props} excludedCount={3} demandEditedCount={12} />);
    await userEvent.click(screen.getByTestId("chip-excluded"));
    await userEvent.click(screen.getByTestId("chip-demand-edited"));
    expect(props.onFocusCustomers).toHaveBeenCalledTimes(2);
  });
});
