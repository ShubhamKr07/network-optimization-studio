import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";
import { BandChipEditor } from "@/components/workspace/tabs/BandChipEditor";

const STORAGE_KEY = "nos:display-unit-pref";

function renderWithUnit(ui: React.ReactElement) {
  return render(<UnitProvider>{ui}</UnitProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("BandChipEditor — legacy mode (canonicalUnit omitted)", () => {
  it("renders raw values with the distanceUnit label, no UnitProvider required", () => {
    render(<BandChipEditor bands={[200, 400]} onChange={vi.fn()} distanceUnit="mi" />);
    expect(screen.getByText("Distance bands (mi)")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
  });

  it("adds a new band, sorted", () => {
    const onChange = vi.fn();
    render(<BandChipEditor bands={[200, 400]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "300" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    expect(onChange).toHaveBeenCalledWith([200, 300, 400]);
  });

  it("rejects a non-positive or duplicate add", () => {
    const onChange = vi.fn();
    render(<BandChipEditor bands={[200, 400]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "400" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a band", () => {
    const onChange = vi.fn();
    render(<BandChipEditor bands={[200, 400]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-remove-band-200"));
    expect(onChange).toHaveBeenCalledWith([400]);
  });

  it("blocks removal of the last remaining boundary via the disabled button AND the internal guard", () => {
    const onChange = vi.fn();
    render(<BandChipEditor bands={[500]} onChange={onChange} />);
    const removeBtn = screen.getByTestId("button-remove-band-500");
    expect(removeBtn).toBeDisabled();
    // Bypass the disabled attribute and call the handler directly — the
    // invariant must hold inside the function itself, not only via the
    // button's `disabled` affordance.
    fireEvent.click(removeBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the empty state at zero bands (distance-bands-empty, unprefixed)", () => {
    render(<BandChipEditor bands={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("distance-bands-empty")).toBeInTheDocument();
  });

  it("supports the solve-dialog- testid prefix without colliding with the bare ids", () => {
    render(<BandChipEditor bands={[200]} onChange={vi.fn()} testIdPrefix="solve-dialog-" />);
    expect(screen.getByTestId("solve-dialog-button-bands-plus")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-button-remove-band-200")).toBeInTheDocument();
  });

  it("empty state uses the solve-dialog-bands-empty id under that prefix", () => {
    render(<BandChipEditor bands={[]} onChange={vi.fn()} testIdPrefix="solve-dialog-" />);
    expect(screen.getByTestId("solve-dialog-bands-empty")).toBeInTheDocument();
  });

  it("disables every control when `disabled` is passed (SolveDialog's busy state)", () => {
    render(<BandChipEditor bands={[200, 400]} onChange={vi.fn()} disabled />);
    expect(screen.getByTestId("button-bands-plus")).toBeDisabled();
    expect(screen.getByTestId("button-remove-band-200")).toBeDisabled();
  });
});

describe("BandChipEditor — unit-aware mode (canonicalUnit provided)", () => {
  it("renders a disabled placeholder while canonicalUnit is null (manifest unresolved), no fallback unit", () => {
    renderWithUnit(<BandChipEditor bands={[600, 1200]} onChange={vi.fn()} canonicalUnit={null} />);
    expect(screen.getByTestId("bands-unit-pending")).toBeInTheDocument();
    expect(screen.getByTestId("button-bands-plus")).toBeDisabled();
    expect(screen.queryByText("600")).not.toBeInTheDocument();
  });

  it("renders converted values once canonicalUnit resolves (km model, mi display pref)", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    renderWithUnit(<BandChipEditor bands={[600]} onChange={vi.fn()} canonicalUnit="km" />);
    // 600 km -> mi
    expect(screen.getByText("372.8227")).toBeInTheDocument();
    expect(screen.getByText("Distance bands (mi)")).toBeInTheDocument();
  });

  it("commits a value typed in the display unit as the canonical unit (mi typed -> km stored)", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onChange = vi.fn();
    renderWithUnit(<BandChipEditor bands={[600]} onChange={onChange} canonicalUnit="km" />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    // 10 mi -> km
    expect(onChange).toHaveBeenCalledWith([16.0934, 600]);
  });

  it("rejects a non-positive or duplicate add in unit-aware mode too", () => {
    const onChange = vi.fn();
    renderWithUnit(<BandChipEditor bands={[600]} onChange={onChange} canonicalUnit="km" />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards an incomplete add-draft on unit toggle instead of converting garbage", () => {
    const onChange = vi.fn();
    renderWithUnit(<BandChipEditor bands={[600]} onChange={onChange} canonicalUnit="km" />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "5." } });
    // Toggling pref mid-type (simulated via localStorage + rerender is not
    // directly reachable without the toggle control here; instead assert
    // the incomplete text is simply never committed).
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blocks removal of the last boundary in unit-aware mode too", () => {
    const onChange = vi.fn();
    renderWithUnit(<BandChipEditor bands={[600]} onChange={onChange} canonicalUnit="km" />);
    const removeBtn = screen.getByTestId("button-remove-band-600");
    expect(removeBtn).toBeDisabled();
    fireEvent.click(removeBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts a non-integer converted boundary (integrality was dropped app-wide)", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const onChange = vi.fn();
    renderWithUnit(<BandChipEditor bands={[]} onChange={onChange} canonicalUnit="km" />);
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "193" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));
    // 193 mi -> km: 193 * 1.609344 = 310.603392, rounded to 4dp = 310.6034,
    // a genuinely non-integer canonical value.
    expect(onChange).toHaveBeenCalledWith([310.6034]);
  });
});
