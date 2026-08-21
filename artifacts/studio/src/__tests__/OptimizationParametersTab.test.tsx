import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OptimizationParametersTab } from "@/components/workspace/tabs/OptimizationParametersTab";

const baseProps = {
  p: 3,
  gap: 0,
  timeLimitSec: 120,
  distanceBands: [200, 400, 800, 1600],
  onChange: vi.fn(),
};

describe("OptimizationParametersTab", () => {
  it("renders the real form (not a placeholder), with current values", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("3");
    expect(screen.getByTestId("input-gap")).toHaveValue(0);
    expect(screen.getByTestId("input-time-limit")).toHaveValue(120);
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getByText("800")).toBeInTheDocument();
    expect(screen.getByText("1,600")).toBeInTheDocument();
  });

  it("omits the P section entirely when the model has no P concept (p is undefined)", () => {
    render(<OptimizationParametersTab {...baseProps} p={undefined} onChange={vi.fn()} />);
    expect(screen.queryByTestId("text-p-value")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider-p-value")).not.toBeInTheDocument();
  });

  it("clicking a P quick-select button calls onChange('p', n) — not a solve, just a draft edit", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    expect(onChange).toHaveBeenCalledWith("p", 10);
  });

  it("editing the gap input calls onChange('gap', value) on every keystroke (the draft, not a save)", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-gap"), { target: { value: "0.05" } });
    expect(onChange).toHaveBeenCalledWith("gap", 0.05);
  });

  it("editing the time-limit input calls onChange('timeLimitSec', value)", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-time-limit"), { target: { value: "300" } });
    expect(onChange).toHaveBeenCalledWith("timeLimitSec", 300);
  });

  it("removing a distance band calls onChange('distanceBands', ...) without that value", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-remove-band-400"));
    expect(onChange).toHaveBeenCalledWith("distanceBands", [200, 800, 1600]);
  });

  it("adding a distance band calls onChange('distanceBands', ...) sorted, deduped, with the new value", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "600" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    expect(onChange).toHaveBeenCalledWith("distanceBands", [200, 400, 600, 800, 1600]);
  });

  it("does not add a duplicate or non-positive band value", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "400" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no distance bands configured", () => {
    render(<OptimizationParametersTab {...baseProps} distanceBands={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("distance-bands-empty")).toBeInTheDocument();
  });
});

// A5.1/A5.3 — model-specific solve parameters (transport-coal's
// capacityFactor/singleSource/capacityInactive, p-median-brazil's
// singleSource, two-echelon-gold-au's bomRatio), all gated on presence
// exactly like `p` already is.
describe("OptimizationParametersTab — model-specific fields", () => {
  it("omits every model-specific field when undefined (p-median-us has none of them)", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.queryByTestId("slider-capacity-factor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-single-source")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-capacity-inactive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider-bom-ratio")).not.toBeInTheDocument();
  });

  it("shows bomRatio ONLY for two-echelon (bomRatio defined), not the others", () => {
    render(<OptimizationParametersTab {...baseProps} p={undefined} bomRatio={1.1} onChange={vi.fn()} />);
    expect(screen.getByTestId("slider-bom-ratio")).toBeInTheDocument();
    expect(screen.getByTestId("text-bom-ratio")).toHaveTextContent("1.10");
    expect(screen.queryByTestId("slider-capacity-factor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-single-source")).not.toBeInTheDocument();
  });

  // Regression, mirroring Studio.tsx's own equivalent test (Studio.test.tsx):
  // twoEchelonInputsSchema requires bomRatio strictly > 1 — the slider must
  // never allow exactly 1.0, which the backend would 422 on.
  it("bomRatio slider spans 1.05-2.0, never exactly 1.0", () => {
    render(<OptimizationParametersTab {...baseProps} p={undefined} bomRatio={1.1} onChange={vi.fn()} />);
    const thumb = screen.getByTestId("slider-bom-ratio").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemin", "1.05");
    expect(thumb).toHaveAttribute("aria-valuemax", "2");
  });

  it("shows capacityFactor/singleSource/capacityInactive for transport-coal", () => {
    render(
      <OptimizationParametersTab
        {...baseProps}
        p={undefined}
        capacityFactor={1.0}
        singleSource={false}
        capacityInactive={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("slider-capacity-factor")).toBeInTheDocument();
    expect(screen.getByTestId("switch-single-source")).toBeInTheDocument();
    expect(screen.getByTestId("switch-capacity-inactive")).toBeInTheDocument();
    expect(screen.queryByTestId("slider-bom-ratio")).not.toBeInTheDocument();
  });

  it("shows ONLY singleSource for p-median-brazil (capacityFactor/capacityInactive stay undefined)", () => {
    render(<OptimizationParametersTab {...baseProps} singleSource={true} onChange={vi.fn()} />);
    expect(screen.getByTestId("switch-single-source")).toBeInTheDocument();
    expect(screen.queryByTestId("slider-capacity-factor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-capacity-inactive")).not.toBeInTheDocument();
  });

  it("toggling singleSource calls onChange('singleSource', value)", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} singleSource={false} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("switch-single-source"));
    expect(onChange).toHaveBeenCalledWith("singleSource", true);
  });
});
