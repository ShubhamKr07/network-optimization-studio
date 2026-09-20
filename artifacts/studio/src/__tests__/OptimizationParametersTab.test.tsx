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

  // C4.11 — the distance-bands label follows the active model's unit.
  it("labels distance bands (mi) by default", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.getByText("Distance bands (mi)")).toBeInTheDocument();
  });

  it("labels distance bands (km), never mi, for a Chen scenario (distanceUnit=km)", () => {
    render(<OptimizationParametersTab {...baseProps} distanceUnit="km" onChange={vi.fn()} />);
    expect(screen.getByText("Distance bands (km)")).toBeInTheDocument();
    expect(screen.queryByText("Distance bands (mi)")).not.toBeInTheDocument();
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

// T11 (Chapter 9 JADE) — the P slider's semantic maximum tracks the
// effective active-warehouse count (spec §5: "there is no stale static
// maximum of 25"), not a fixed 50, when the caller (Workspace.tsx, T15.5)
// wires `pMax`.
describe("OptimizationParametersTab — pMax (Chapter 9 JADE, T11)", () => {
  it("defaults to a max of 50 when pMax is omitted (every existing model unaffected)", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    const thumb = screen.getByTestId("slider-p-value").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemax", "50");
    // Quick-select 25 still renders (25 <= 50).
    expect(screen.getByTestId("button-p-quick-25")).toBeInTheDocument();
  });

  it("clamps the slider's max to the supplied pMax (tracks effective active warehouse count)", () => {
    render(<OptimizationParametersTab {...baseProps} pMax={5} onChange={vi.fn()} />);
    const thumb = screen.getByTestId("slider-p-value").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemax", "5");
  });

  it("hides quick-select values above pMax", () => {
    render(<OptimizationParametersTab {...baseProps} pMax={5} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-p-quick-2")).toBeInTheDocument();
    expect(screen.getByTestId("button-p-quick-3")).toBeInTheDocument();
    expect(screen.getByTestId("button-p-quick-4")).toBeInTheDocument();
    expect(screen.queryByTestId("button-p-quick-10")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-p-quick-25")).not.toBeInTheDocument();
  });
});

// C4.12 — Chen's Cosmetics (chens-cosmetics-cn) coverage model: objective
// mode toggle, the two service-distance thresholds, the mode-specific field,
// pMax=25 (D27), and NO band editor (D13/D19). The whole block is gated on
// `objective != null` (present only for Chen) — a sibling model passing none
// of these renders none of it.
const chenCoverageProps = {
  p: 3,
  pMax: 25,
  gap: 0,
  timeLimitSec: 120,
  distanceBands: [600, 5000],
  distanceUnit: "km",
  objective: "coverage" as const,
  highServiceDistKm: 600,
  maxDistKm: 5000,
  avgServiceDistCapKm: 1000,
  showBandEditor: false,
  onChange: vi.fn(),
};

describe("OptimizationParametersTab — Chen coverage model (C4.12)", () => {
  it("renders the objective toggle only when `objective` is set (not for other models)", () => {
    const { rerender } = render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.queryByTestId("chen-objective-toggle")).not.toBeInTheDocument();
    rerender(<OptimizationParametersTab {...chenCoverageProps} onChange={vi.fn()} />);
    expect(screen.getByTestId("chen-objective-toggle")).toBeInTheDocument();
  });

  it("coverage mode shows the avg-service-cap field and HIDES the coverage-floor field", () => {
    render(<OptimizationParametersTab {...chenCoverageProps} onChange={vi.fn()} />);
    expect(screen.getByTestId("input-avg-service-cap")).toBeInTheDocument();
    expect(screen.queryByTestId("input-coverage-floor")).not.toBeInTheDocument();
    // Both thresholds are always visible in either mode.
    expect(screen.getByTestId("input-high-service-dist")).toHaveValue(600);
    expect(screen.getByTestId("input-max-dist")).toHaveValue(5000);
  });

  it("min-distance mode shows the coverage-floor field and HIDES avg-service-cap", () => {
    render(
      <OptimizationParametersTab
        {...chenCoverageProps}
        objective="min_distance"
        avgServiceDistCapKm={undefined}
        coverageFloorDemand={131645389}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("input-coverage-floor")).toHaveValue(131645389);
    expect(screen.queryByTestId("input-avg-service-cap")).not.toBeInTheDocument();
  });

  it("clicking a mode button calls onObjectiveModeChange with that mode (the atomic toggle lives in Workspace)", () => {
    const onObjectiveModeChange = vi.fn();
    render(<OptimizationParametersTab {...chenCoverageProps} onObjectiveModeChange={onObjectiveModeChange} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("chen-objective-min_distance"));
    expect(onObjectiveModeChange).toHaveBeenCalledWith("min_distance");
    fireEvent.click(screen.getByTestId("chen-objective-coverage"));
    expect(onObjectiveModeChange).toHaveBeenCalledWith("coverage");
  });

  it("editing a service-distance threshold calls onServiceDistanceChange (NOT the generic onChange — bands resync there)", () => {
    const onServiceDistanceChange = vi.fn();
    const onChange = vi.fn();
    render(
      <OptimizationParametersTab
        {...chenCoverageProps}
        onServiceDistanceChange={onServiceDistanceChange}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-high-service-dist"), { target: { value: "700" } });
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistKm", 700);
    fireEvent.change(screen.getByTestId("input-max-dist"), { target: { value: "4000" } });
    expect(onServiceDistanceChange).toHaveBeenCalledWith("maxDistKm", 4000);
    // The generic onChange never fired for the thresholds.
    expect(onChange).not.toHaveBeenCalledWith("highServiceDistKm", expect.anything());
    expect(onChange).not.toHaveBeenCalledWith("maxDistKm", expect.anything());
  });

  it("editing the avg-service-cap calls the generic onChange('avgServiceDistCapKm', value)", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...chenCoverageProps} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-avg-service-cap"), { target: { value: "1200" } });
    expect(onChange).toHaveBeenCalledWith("avgServiceDistCapKm", 1200);
  });

  // D27 — the P slider caps at 25 (26 cannot be authored), and the 25
  // quick-select still renders (25 <= 25).
  it("caps the P slider at 25 (26 is unreachable)", () => {
    render(<OptimizationParametersTab {...chenCoverageProps} onChange={vi.fn()} />);
    const thumb = screen.getByTestId("slider-p-value").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemax", "25");
    expect(screen.getByTestId("button-p-quick-25")).toBeInTheDocument();
  });

  // D13/D19 — Chen's bands are derived [high, max]; the free-edit band editor
  // is hidden (showBandEditor={false}).
  it("hides the distance-band editor entirely (showBandEditor=false)", () => {
    render(<OptimizationParametersTab {...chenCoverageProps} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-bands-plus")).not.toBeInTheDocument();
    // The label "Distance bands (km)" belongs only to the (now-hidden) editor.
    expect(screen.queryByText("Distance bands (km)")).not.toBeInTheDocument();
  });

  it("still shows the band editor for a normal model (showBandEditor defaults true)", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-bands-plus")).toBeInTheDocument();
  });
});

// jade-INT (workspace-fixups-2, item 7) — OptimizationParametersTab used to
// render a separate fixed-4-slot JadeBandEditor for modelId===
// "two-echelon-jade-us"; that editor is deleted and JADE now renders the
// SAME shared free add/remove chip editor as every other model (its schema
// was relaxed to `.min(1)`, matching p-median/transport/gold-au).
describe("OptimizationParametersTab — JADE uses the shared chip editor (item 7)", () => {
  it("renders the shared chip editor (not JadeBandEditor) for modelId two-echelon-jade-us", () => {
    render(<OptimizationParametersTab {...baseProps} modelId="two-echelon-jade-us" onChange={vi.fn()} />);
    expect(screen.queryByTestId("jade-band-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-bands-plus")).toBeInTheDocument();
    expect(screen.getByTestId("button-remove-band-200")).toBeInTheDocument();
  });

  it("adding a 5th band for JADE calls the tab's generic onChange('distanceBands', ...) sorted", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...baseProps} modelId="two-echelon-jade-us" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "3000" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    expect(onChange).toHaveBeenCalledWith("distanceBands", [200, 400, 800, 1600, 3000]);
  });

  it("disables the last remaining band's × control for JADE (zero-band guard, item 7)", () => {
    render(<OptimizationParametersTab {...baseProps} modelId="two-echelon-jade-us" distanceBands={[500]} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-remove-band-500")).toBeDisabled();
  });

  it("does not disable a remove control for JADE when more than one band remains", () => {
    render(<OptimizationParametersTab {...baseProps} modelId="two-echelon-jade-us" distanceBands={[200, 500]} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-remove-band-200")).toBeEnabled();
    expect(screen.getByTestId("button-remove-band-500")).toBeEnabled();
  });
});

// item 7 (Codex plan-review P1) — the zero-band guard is SHARED, not
// JADE-specific: every free-chip model's schema is now `.min(1)`, so the
// last remaining band's × control must be disabled for any model.
describe("OptimizationParametersTab — zero-band guard (item 7, any model)", () => {
  it("disables the last remaining band's × control regardless of modelId", () => {
    render(<OptimizationParametersTab {...baseProps} distanceBands={[500]} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-remove-band-500")).toBeDisabled();
  });

  it("does not disable a remove control when more than one band remains", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-remove-band-200")).toBeEnabled();
  });
});
