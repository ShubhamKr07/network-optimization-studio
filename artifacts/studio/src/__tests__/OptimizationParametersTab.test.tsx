import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import {
  OptimizationParametersTab,
  type OptimizationParametersTabProps,
} from "@/components/workspace/tabs/OptimizationParametersTab";
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
// `rerender(...)` call). CH4O-7 review F4 — this is now LOAD-BEARING, not
// free: `OptimizationParametersTab` calls `useDisplayUnit()` unconditionally
// at the top of its body (Rules of Hooks), so every render in this file —
// including every legacy, `canonicalUnit`-omitting test above — throws
// without this wrapper. The `wrapper` option lets every `render(...)` call
// in this file (old and new) stay textually unchanged, but it is required,
// not merely harmless.
function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) {
  return rtlRender(ui, { wrapper: UnitProvider, ...options });
}

const STORAGE_KEY = "nos:display-unit-pref";

// WF-5 — this file's render helper for the missing-required-inputs notice
// tests below: `baseProps` plus whatever a given test wants to override,
// same pattern as `renderMaxCoverageTab` further down this file.
function renderTab(overrides: Partial<OptimizationParametersTabProps> = {}) {
  return render(<OptimizationParametersTab {...baseProps} {...overrides} />);
}

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

  it("labels distance bands from the distanceUnit prop, never a hardcoded mi — driven by a synthetic km unit (CH4O-8: no real model is km-canonical any more, and passing mi would make this unable to fail)", () => {
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

// C4.12/CH4O-7 — Chen's Cosmetics (max-coverage-us) coverage model: the two
// service-distance thresholds, the avg-cap (now unconditional), the editable
// coverage-floor input, and NO band editor (D13/D19). The whole block is
// gated on `highServiceDistMi != null` (present only for Chen) — a sibling
// model passing none of these renders none of it. There is no `objective`
// prop any more — `coverageFloorDemand: 0` is this fixture's equivalent of
// the old "coverage" mode.
const chenCoverageProps = {
  p: 3,
  pMax: 25,
  gap: 0,
  timeLimitSec: 120,
  distanceBands: [600, 5000],
  distanceUnit: "km",
  highServiceDistMi: 600,
  maxDistMi: 5000,
  avgServiceDistCapMi: 1000,
  coverageFloorDemand: 0,
  showBandEditor: false,
  onChange: vi.fn(),
};

// CH4-17/CH4O-7 — the only way to build a max-coverage-us render for this
// describe block now; there is no `onObjectiveModeChange` prop, and
// `coverageFloorDemand` is varied directly rather than through a toggle.
function renderMaxCoverageTab(overrides: Partial<typeof chenCoverageProps> = {}) {
  return render(<OptimizationParametersTab {...chenCoverageProps} {...overrides} onChange={overrides.onChange ?? vi.fn()} />);
}

describe("OptimizationParametersTab — Chen coverage model (C4.12)", () => {
  // CH4O-7 — superseded (was "no longer renders a free objective toggle ...
  // and NO input-coverage-floor"): the floor is editable again, now that the
  // objective is derived from it rather than the reverse. The toggle itself
  // (never built) stays absent.
  it("no longer renders a free objective toggle for max-coverage-us, and the coverage floor IS editable", () => {
    renderMaxCoverageTab();
    expect(screen.queryByTestId("chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-coverage-floor")).toBeEnabled();
    // The section itself stays — it still renders the service-distance fields.
    expect(screen.getByTestId("chen-objective-section")).toBeInTheDocument();
  });

  it("does not render the objective section at all for other models (`highServiceDistMi` is undefined)", () => {
    render(<OptimizationParametersTab {...baseProps} onChange={vi.fn()} />);
    expect(screen.queryByTestId("chen-objective-section")).not.toBeInTheDocument();
  });

  it("coverage mode shows the avg-service-cap field", () => {
    renderMaxCoverageTab();
    expect(screen.getByTestId("input-avg-service-cap")).toBeInTheDocument();
    // Both thresholds are always visible.
    expect(screen.getByTestId("input-high-service-dist")).toHaveValue(600);
    expect(screen.getByTestId("input-max-dist")).toHaveValue(5000);
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
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistMi", 700);
    fireEvent.change(screen.getByTestId("input-max-dist"), { target: { value: "4000" } });
    expect(onServiceDistanceChange).toHaveBeenCalledWith("maxDistMi", 4000);
    // The generic onChange never fired for the thresholds.
    expect(onChange).not.toHaveBeenCalledWith("highServiceDistMi", expect.anything());
    expect(onChange).not.toHaveBeenCalledWith("maxDistMi", expect.anything());
  });

  it("editing the avg-service-cap calls the generic onChange('avgServiceDistCapMi', value)", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...chenCoverageProps} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-avg-service-cap"), { target: { value: "1200" } });
    expect(onChange).toHaveBeenCalledWith("avgServiceDistCapMi", 1200);
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

  // `canonicalUnit: "km"` paired with a `...Mi`-named field is deliberate,
  // not a mismatch: no real model is km-canonical any more (CH4O-8), so this
  // is a synthetic km fixture used purely to exercise the display-conversion
  // path. Passing "mi" here would make the km->mi conversion an identity and
  // leave the conversion assertions below unable to fail.
  const chenUnitProps = {
    p: 3,
    pMax: 25,
    gap: 0,
    timeLimitSec: 120,
    distanceBands: [600, 5000],
    canonicalUnit: "km" as const,
    highServiceDistMi: 600,
    maxDistMi: 5000,
    avgServiceDistCapMi: 1000,
    coverageFloorDemand: 0,
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
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistMi", 643.7376);
  });

  // CH4O-7 — superseded (was "... no floor field exists"): the floor and the
  // avg-cap now BOTH render unconditionally, in either derived mode. This
  // keeps the one assertion that's still this describe block's own concern —
  // p/gap/timeLimitSec are untouched by a positive (min_distance-deriving)
  // coverage floor.
  it("p / gap / timeLimitSec are untouched by a positive (min_distance-deriving) coverage floor", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    render(
      <OptimizationParametersTab
        {...chenUnitProps}
        coverageFloorDemand={500}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("3");
    expect(screen.getByTestId("input-gap")).toHaveValue(0);
    expect(screen.getByTestId("input-time-limit")).toHaveValue(120);
    expect(screen.getByTestId("input-coverage-floor")).toBeEnabled();
    expect(screen.getByTestId("input-avg-service-cap")).toBeInTheDocument();
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
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistMi", 700);
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
    expect(onServiceDistanceChange).toHaveBeenCalledWith("highServiceDistMi", 700);
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

// CH4UX-2 — instance namespace so CH4UX-4's Solve dialog can embed a SECOND
// copy of this component while the Optimization Parameters tab may still be
// mounted behind it, with no DOM id or data-testid collision between them.
describe("CH4UX-2 — instance namespacing", () => {
  const chenProps = {
    modelId: "max-coverage-us",
    p: 5,
    pMax: 26,
    gap: 0,
    timeLimitSec: 120,
    distanceBands: [200, 400],
    canonicalUnit: "km" as const,
    highServiceDistMi: 200,
    maxDistMi: 400,
    avgServiceDistCapMi: 300,
    coverageFloorDemand: 0,
    onServiceDistanceChange: vi.fn(),
    onChange: vi.fn(),
    // whole-branch review, M2 — the merge (16021ec) namespaced Chapter 5's
    // cost-adjust block (cost-adjust-section, button-adjust-cost-table,
    // input-distance-threshold, input-cost-per-mile,
    // input-cost-per-mile-over) by hand, but that block only renders its
    // three numeric fields when `costAdjustEnabled` is true — the
    // duplicate-id/duplicate-testid tests below (`renderTwoInstances`) never
    // exercised them without these props, so the hand-applied namespacing
    // had zero coverage.
    costAdjustEnabled: true,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
  };

  it("emits today's bare ids when no prefix is supplied", () => {
    render(<OptimizationParametersTab {...chenProps} />, { wrapper: UnitProvider });
    expect(screen.getByTestId("optimization-parameters-tab")).toBeInTheDocument();
    expect(screen.getByTestId("input-gap")).toHaveAttribute("id", "input-gap");
    expect(screen.getByTestId("input-high-service-dist")).toBeInTheDocument();
    expect(screen.getByTestId("band-200")).toBeInTheDocument();
  });

  it("prefixes every emitted id and test id when both prefixes are supplied", () => {
    render(
      <OptimizationParametersTab {...chenProps} idPrefix="solve-dialog-" testIdPrefix="solve-dialog-" />,
      { wrapper: UnitProvider },
    );
    expect(screen.getByTestId("solve-dialog-optimization-parameters-tab")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-input-gap")).toHaveAttribute("id", "solve-dialog-input-gap");
    expect(screen.getByTestId("solve-dialog-input-high-service-dist")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-band-200")).toBeInTheDocument();
    expect(screen.queryByTestId("optimization-parameters-tab")).toBeNull();
    expect(screen.queryByTestId("input-gap")).toBeNull();
  });

  // CH4O-7 — supersedes the deleted "prefixes the Step 2 panel too" test:
  // the coverage-floor input and the derived-model-line are this task's own
  // new elements, and they go through the same `pid`/`tid` namespacing.
  it("prefixes the coverage-floor input and the derived-model-line too", () => {
    render(
      <OptimizationParametersTab
        {...chenProps}
        idPrefix="solve-dialog-"
        testIdPrefix="solve-dialog-"
      />,
      { wrapper: UnitProvider },
    );
    expect(screen.getByTestId("solve-dialog-input-coverage-floor")).toHaveAttribute("id", "solve-dialog-input-coverage-floor");
    expect(screen.getByTestId("solve-dialog-derived-model-line")).toBeInTheDocument();
    expect(screen.queryByTestId("input-coverage-floor")).toBeNull();
    expect(screen.queryByTestId("derived-model-line")).toBeNull();
  });

  // Two SEPARATE assertions, deliberately: the requirement covers both
  // namespaces (DOM `id` drives <label htmlFor>; `data-testid` drives every
  // RTL and Playwright locator), and one combined assertion would not say
  // which namespace regressed.
  it("mounting two instances with different prefixes produces no duplicate DOM id", () => {
    const { container } = renderTwoInstances();
    const ids = Array.from(container.querySelectorAll<HTMLElement>("[id]"), el => el.id).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mounting two instances with different prefixes produces no duplicate data-testid", () => {
    const { container } = renderTwoInstances();
    const testIds = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid]"),
      el => el.dataset.testid!,
    );
    expect(testIds.length).toBeGreaterThan(0);
    expect(new Set(testIds).size).toBe(testIds.length);
  });

  function renderTwoInstances() {
    return render(
      <>
        <OptimizationParametersTab {...chenProps} />
        <OptimizationParametersTab {...chenProps} idPrefix="solve-dialog-" testIdPrefix="solve-dialog-" />
      </>,
      { wrapper: UnitProvider },
    );
  }
});
// ch5-del-10 — delivery-teaching-us's "Adjust Cost Table" control. Gated on
// prop presence like every other model-specific field in this component
// (never on modelId), and deliberately placed outside all four `step`
// guards (226/272/356/411) since this model has no step concept — its
// control must render regardless of whether a Chapter-4 sibling's `step` is
// 1, 2, or omitted.
describe("Adjust Cost Table (delivery-teaching-us)", () => {
  const deliveryProps = {
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    gap: 0,
    timeLimitSec: 120,
    p: 3,
    pMax: 33,
    distanceBands: [400, 800, 1200, 1600],
    onChange: vi.fn(),
  };

  it("renders the button and hides the three fields when the toggle is off", () => {
    render(<OptimizationParametersTab {...deliveryProps} />);
    expect(screen.getByTestId("button-adjust-cost-table")).toBeInTheDocument();
    expect(screen.queryByTestId("input-distance-threshold")).toBeNull();
    expect(screen.queryByTestId("input-cost-per-mile")).toBeNull();
    expect(screen.queryByTestId("input-cost-per-mile-over")).toBeNull();
  });

  it("reveals the three fields when the toggle is on", () => {
    render(<OptimizationParametersTab {...deliveryProps} costAdjustEnabled />);
    expect(screen.getByTestId("input-distance-threshold")).toHaveValue(800);
    expect(screen.getByTestId("input-cost-per-mile")).toHaveValue(1);
    expect(screen.getByTestId("input-cost-per-mile-over")).toHaveValue(10);
  });

  it("emits costAdjustEnabled through the generic onChange", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...deliveryProps} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-adjust-cost-table"));
    expect(onChange).toHaveBeenCalledWith("costAdjustEnabled", true);
  });

  // Values persist across the toggle: the schema always carries all three, so
  // turning the feature off and on again must not reset a student's rates.
  it("does not clear the rate values when toggled off", () => {
    const onChange = vi.fn();
    render(<OptimizationParametersTab {...deliveryProps} costAdjustEnabled onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-adjust-cost-table"));
    expect(onChange).toHaveBeenCalledWith("costAdjustEnabled", false);
    expect(onChange).not.toHaveBeenCalledWith("costPerMile", expect.anything());
    expect(onChange).not.toHaveBeenCalledWith("distanceThreshold", expect.anything());
  });

  it("renders nothing of the sort for a model that passes none of these props", () => {
    render(<OptimizationParametersTab gap={0} timeLimitSec={120} distanceBands={[500]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-adjust-cost-table")).toBeNull();
  });

  // The component default is pMax = 50 against a schema cap of 33. P is a
  // Radix <Slider data-testid="slider-p-value" max={pMax}> whose max lives as
  // aria-valuemax on the child [role="slider"] thumb, plus quick-pick
  // buttons [2,3,4,10,25] filtered by n <= pMax. There is no "input-p".
  it("caps the P slider at 33 and keeps every quick-pick (all five are <= 33)", () => {
    render(<OptimizationParametersTab {...deliveryProps} />);
    const thumb = screen.getByTestId("slider-p-value").querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute("aria-valuemax", "33");
    for (const n of [2, 3, 4, 10, 25]) expect(screen.getByTestId(`button-p-quick-${n}`)).toBeInTheDocument();
  });
});

// CH4O-7 — the Optimization Parameters form rebuilt as ONE editable surface:
// no `step`/`objective` concept any more, the avg-cap field unconditional in
// both modes, and a new editable coverage-floor input plus a derived-model
// line that reads the SAME `deriveMaxCoverageObjective` rule the server uses.
// Same deliberate synthetic-km choice as chenUnitProps above: `canonicalUnit:
// "km"` next to `...Mi`-named values is intentional, not a leftover mismatch
// — it's what makes the display-conversion test below (~435 mi) able to
// fail if the conversion ever broke. Passing "mi" would make it an identity.
const ch4Props = {
  p: 3, pMax: 26, gap: 0, timeLimitSec: 120,
  distanceBands: [700, 1400, 2800, 5500],
  highServiceDistMi: 700, maxDistMi: 5500, avgServiceDistCapMi: 1000,
  coverageFloorDemand: 0,
  canonicalUnit: "km" as const,
  onChange: vi.fn(), onServiceDistanceChange: vi.fn(),
};

describe("OptimizationParametersTab — Chapter 4 single form", () => {
  it("renders the avg service cap unconditionally, with no objective prop", () => {
    render(<OptimizationParametersTab {...ch4Props} />);
    expect(screen.getByTestId("input-avg-service-cap")).toBeInTheDocument();
  });

  it("renders an editable coverage floor", () => {
    render(<OptimizationParametersTab {...ch4Props} />);
    const floor = screen.getByTestId("input-coverage-floor");
    expect(floor).toBeEnabled();
    fireEvent.change(floor, { target: { value: "500" } });
    expect(ch4Props.onChange).toHaveBeenCalledWith("coverageFloorDemand", 500);
  });

  it("names Model 1 when the floor is zero", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={0} />);
    expect(screen.getByTestId("derived-model-line")).toHaveTextContent(/Model 1/);
  });

  // CH4O-P1 (whole-branch review, Minor 4) — the cap clause used to be
  // appended to the Model 1 string ONLY, but this branch made the
  // average-distance cap an unconditional constraint in BOTH objectives
  // (spec §2.4: "applies in BOTH modes now" — it is why the field renders
  // unconditionally). A student who set a positive floor and a tight cap,
  // solved, and got INFEASIBLE read a Model 2 line naming only the floor, with
  // no on-screen statement of the constraint that actually caused it — while
  // the Model 1 line they saw a minute earlier did name it. Both clauses are
  // asserted in full, not just /Model 2/, so dropping either can't pass.
  it("names Model 2 when the floor is positive, and states BOTH the floor and the avg-distance cap", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={500} />);
    const line = screen.getByTestId("derived-model-line");
    expect(line).toHaveTextContent(/Model 2/);
    expect(line).toHaveTextContent("covering at least 500 demand within 700 km");
    expect(line).toHaveTextContent("holding average distance at or under 1,000 km");
  });

  // CH4O-P1 — the absent-cap handling the Model 1 branch already had (review
  // F1) must hold for Model 2 too: OMIT the clause, never render a fabricated
  // `?? 0`, which would be a false statement about the model being solved.
  it("omits the cap clause from the Model 2 line when avgServiceDistCapMi is absent", () => {
    const { avgServiceDistCapMi: _absent, ...propsWithoutCap } = ch4Props;
    void _absent;
    render(<OptimizationParametersTab {...propsWithoutCap} coverageFloorDemand={500} />);
    const line = screen.getByTestId("derived-model-line");
    expect(line).toHaveTextContent(/Model 2/);
    expect(line).toHaveTextContent("covering at least 500 demand within 700 km");
    expect(line).not.toHaveTextContent("at or under");
    expect(line).not.toHaveTextContent("holding average distance");
  });

  // The line shows DISTANCES. It must CONVERT them for display, not print
  // canonical values under a converted label -- the failure a naive
  // unit-suffix implementation produces.
  it("renders the line's distances in the DISPLAY unit, not the canonical one", () => {
    // UnitProvider takes NO `initialPref` prop — it reads the persisted
    // preference from localStorage on mount. This file already has a STORAGE_KEY
    // constant and a `render` helper that passes `{ wrapper: UnitProvider }`;
    // use them rather than inventing a prop.
    window.localStorage.setItem(STORAGE_KEY, "mi");
    render(<OptimizationParametersTab {...ch4Props} canonicalUnit="km" highServiceDistMi={700} />);
    const line = screen.getByTestId("derived-model-line");
    // Tightened (review F2): both branch strings contain "maxi**mi**ze" /
    // "**mi**nimize", so a bare /mi/ match passes no matter what -- it is
    // non-vacuous only in combination with the `not.toHaveTextContent("700")`
    // assertion below. Assert the actual converted-and-labelled value instead,
    // so the inverse regression (correct numbers under a wrong/canonical-km
    // label) can no longer slip through.
    expect(line).toHaveTextContent("435 mi");   // 700 km converts to ~435 mi
    expect(line).not.toHaveTextContent("700");   // 700 km displays as ~435 mi
  });

  // review F1 — `avgServiceDistCapMi!` used to be an unchecked non-null
  // assertion on a prop gated by nothing: a legacy row with the cap absent
  // threw a TypeError during render (km-canonical/km-display path) or printed
  // a false "at or under NaN"/"at or under 0" (mi path / `?? 0` path). Must
  // render cleanly and must not claim a cap that doesn't exist.
  it("omits the cap clause (never throws, never claims a false cap) when avgServiceDistCapMi is absent", () => {
    const { avgServiceDistCapMi, ...propsWithoutCap } = ch4Props;
    expect(() =>
      render(<OptimizationParametersTab {...propsWithoutCap} coverageFloorDemand={0} />),
    ).not.toThrow();
    const line = screen.getByTestId("derived-model-line");
    expect(line).not.toHaveTextContent("at or under");
    expect(line).toHaveTextContent(/Model 1/);
  });

  it("renders no Chapter 4 block for a model without the thresholds", () => {
    render(<OptimizationParametersTab p={3} gap={0} timeLimitSec={120} distanceBands={[200]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("chen-objective-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("derived-model-line")).not.toBeInTheDocument();
  });

  it("renders no step 2 panel", () => {
    render(<OptimizationParametersTab {...ch4Props} />);
    expect(screen.queryByTestId("step2-parameters")).not.toBeInTheDocument();
  });
});

// WF-5 — a scenario row the Chapter 4 km->mi migration (or any future
// migration) classified as `skipped` and left with required inputs missing.
// `missingRequiredInputs` is computed by the CALLER (Workspace.tsx) from the
// active model's manifest `inputsSchema.required[]`, never derived here from
// a field's presence — that's what the Workspace-level regression test
// (Workspace.test.tsx) guards against.
describe("OptimizationParametersTab — missing required inputs", () => {
  it("explains the problem when required inputs are absent", () => {
    renderTab({ missingRequiredInputs: ["highServiceDistMi", "coverageFloorDemand"] });
    const notice = screen.getByTestId("missing-required-inputs");
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent(/cannot be saved or solved/i);
    expect(notice).toHaveTextContent("High-service distance");
    expect(notice).toHaveTextContent("Coverage floor");
  });

  it("renders nothing when the array is empty", () => {
    renderTab({ missingRequiredInputs: [] });
    expect(screen.queryByTestId("missing-required-inputs")).not.toBeInTheDocument();
  });

  it("renders nothing when the prop is omitted — every other model's case", () => {
    renderTab({});
    expect(screen.queryByTestId("missing-required-inputs")).not.toBeInTheDocument();
  });

  it("still renders the fields that ARE intact", () => {
    renderTab({ missingRequiredInputs: ["highServiceDistMi"], gap: 0, timeLimitSec: 120 });
    expect(screen.getByTestId("missing-required-inputs")).toBeVisible();
    expect(screen.getByTestId("input-gap")).toBeInTheDocument();
  });
});
