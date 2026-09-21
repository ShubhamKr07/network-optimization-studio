import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { OptimizationParametersTab } from "@/components/workspace/tabs/OptimizationParametersTab";
import { UnitProvider } from "@/contexts/UnitContext";

const baseProps = {
  p: 3,
  gap: 0,
  timeLimitSec: 120,
  distanceBands: [200, 400, 800, 1600],
  onChange: vi.fn(),
};

// chen-bands-units, T13 — every render in this file now goes through a
// `UnitProvider` ancestor via RTL's `wrapper` OPTION (not a wrapping
// element — a wrapping element is silently dropped by a later
// `rerender(...)` call). A `UnitProvider` ancestor is harmless for every
// pre-existing (legacy, `canonicalUnit`-omitting) test above — nothing in
// this file's legacy path calls `useDisplayUnit()`, so wrapping
// unconditionally costs nothing and lets every `render(...)` call in this
// file (old and new) stay textually unchanged.
function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) {
  return rtlRender(ui, { wrapper: UnitProvider, ...options });
}

const STORAGE_KEY = "nos:display-unit-pref";

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
  // chen-bands-units review Minor 2 — this used to assert a guessed "mi"
  // default. There is no fallback unit anywhere now: an omitted distanceUnit
  // renders the bare noun, never a unit the caller never supplied. Chen is
  // km-canonical, so a guess would render a CORRECT number under a WRONG unit.
  it("labels distance bands with NO unit when none is supplied (never a guessed mi)", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.getByText("Distance bands")).toBeInTheDocument();
    expect(screen.queryByText("Distance bands (mi)")).not.toBeInTheDocument();
    expect(screen.queryByText("Distance bands (km)")).not.toBeInTheDocument();
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

// chen-bands-units, T13, Part A + Part D — Chen's free band editor
// re-enabled, plus the display-unit draft contract on OptimizationParametersTab's
// own three distance fields (high-service, max, avg-cap) once a caller opts
// in via `canonicalUnit`. Every test above this point deliberately omits
// `canonicalUnit` and is unaffected by anything below.
describe("OptimizationParametersTab — Part D display-unit contract (canonicalUnit opt-in)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const chenUnitProps = {
    p: 3,
    pMax: 25,
    gap: 0,
    timeLimitSec: 120,
    distanceBands: [600, 5000],
    canonicalUnit: "km" as const,
    objective: "coverage" as const,
    highServiceDistKm: 600,
    maxDistKm: 5000,
    avgServiceDistCapKm: 1000,
    showBandEditor: true,
    onChange: vi.fn(),
  };

  it("renders a placeholder and disables editing until the Chen manifest resolves (canonicalUnit=null)", () => {
    render(<OptimizationParametersTab {...chenUnitProps} canonicalUnit={null} onChange={vi.fn()} />);
    expect(screen.getByTestId("input-high-service-dist")).toBeDisabled();
    expect(screen.getByTestId("input-high-service-dist")).toHaveValue("");
    expect(screen.getByTestId("input-max-dist")).toBeDisabled();
    expect(screen.getByTestId("input-avg-service-cap")).toBeDisabled();
    expect(screen.getByTestId("button-bands-plus")).toBeDisabled();
    expect(screen.getByTestId("bands-unit-pending")).toBeInTheDocument();
  });

  it("commits a value typed in mi as canonical km for Chen", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onServiceDistanceChange = vi.fn();
    render(
      <OptimizationParametersTab {...chenUnitProps} onServiceDistanceChange={onServiceDistanceChange} onChange={vi.fn()} />,
    );
    const input = screen.getByTestId("input-high-service-dist");
    // 600 km displayed in mi: 600 / 1.609344 = 372.8227 (rounded to 4dp).
    expect(input).toHaveValue("372.8227");
    fireEvent.change(input, { target: { value: "400" } });
    fireEvent.blur(input);
    // 400 mi -> km: 400 * 1.609344 = 643.7376.
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistKm", 643.7376);
  });

  it("p / gap / timeLimitSec / coverageFloorDemand are untouched by the toggle", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onChange = vi.fn();
    render(
      <OptimizationParametersTab
        {...chenUnitProps}
        objective="min_distance"
        avgServiceDistCapKm={undefined}
        coverageFloorDemand={131645389}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("3");
    expect(screen.getByTestId("input-gap")).toHaveValue(0);
    expect(screen.getByTestId("input-time-limit")).toHaveValue(120);
    const floor = screen.getByTestId("input-coverage-floor");
    expect(floor).toHaveValue(131645389);
    fireEvent.change(floor, { target: { value: "200000000" } });
    expect(onChange).toHaveBeenCalledWith("coverageFloorDemand", 200000000);
  });

  it("a high-service edit retargets a band equal to the OLD high, then dedupes and re-sorts", () => {
    const onChange = vi.fn();
    const onServiceDistanceChange = vi.fn();
    render(
      <OptimizationParametersTab
        {...chenUnitProps}
        distanceBands={[600, 1200, 2400, 5000]}
        onChange={onChange}
        onServiceDistanceChange={onServiceDistanceChange}
      />,
    );
    const input = screen.getByTestId("input-high-service-dist");
    fireEvent.change(input, { target: { value: "700" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("distanceBands", [700, 1200, 2400, 5000]);
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistKm", 700);
  });

  it("removing the high band first means a later high edit leaves bands untouched", () => {
    const onChange = vi.fn();
    const onServiceDistanceChange = vi.fn();
    // 600 already removed from bands — simulates the user having removed it.
    render(
      <OptimizationParametersTab
        {...chenUnitProps}
        distanceBands={[1200, 2400, 5000]}
        onChange={onChange}
        onServiceDistanceChange={onServiceDistanceChange}
      />,
    );
    const input = screen.getByTestId("input-high-service-dist");
    fireEvent.change(input, { target: { value: "700" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistKm", 700);
  });

  it("re-enables the free band chip editor for Chen (showBandEditor truthy) — add/remove works", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...chenUnitProps} onChange={onChange} />);
    expect(screen.getByTestId("button-bands-plus")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-remove-band-5000"));
    expect(onChange).toHaveBeenCalledWith("distanceBands", [600]);
  });

  it("blocks removing the last remaining Chen band", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...chenUnitProps} distanceBands={[600]} onChange={onChange} />);
    const removeBtn = screen.getByTestId("button-remove-band-600");
    expect(removeBtn).toBeDisabled();
    fireEvent.click(removeBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not render a distance-unit label or value for the band editor until canonicalUnit resolves", () => {
    render(<OptimizationParametersTab {...chenUnitProps} canonicalUnit={null} onChange={vi.fn()} />);
    expect(screen.queryByText("Distance bands (km)")).not.toBeInTheDocument();
    expect(screen.queryByText("Distance bands (mi)")).not.toBeInTheDocument();
  });
});
