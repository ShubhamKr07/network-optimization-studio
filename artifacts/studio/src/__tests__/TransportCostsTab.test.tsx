import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { TransportCostsTab } from "@/components/workspace/tabs/TransportCostsTab";
import { TEXTBOOK_TRANSPORT_COSTS } from "@/lib/transportCosts";

function renderTab(overrides: Partial<React.ComponentProps<typeof TransportCostsTab>> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const utils = render(
    <UnitProvider>
      <PrefSetter />
      <TransportCostsTab
        canonicalUnit="mi"
        transportCosts={TEXTBOOK_TRANSPORT_COSTS}
        isCustom={false}
        onChange={onChange}
        onReset={onReset}
        scenarioId={1}
        {...overrides}
      />
    </UnitProvider>,
  );
  return { ...utils, onChange, onReset };
}

/** Seeds the INITIAL preference only — UnitProvider reads localStorage on
 *  mount. Use the app's own storage key so this cannot drift from
 *  UnitContext. Never use this to simulate a toggle on a mounted tree: a
 *  remount re-derives the field from the stored value and therefore proves
 *  nothing about draft reprojection, which is the behaviour §2.4 is about. */
function setPref(pref: "auto" | "km" | "mi") {
  window.localStorage.setItem("nos:display-unit-pref", pref);
}

/** A LIVE toggle on the mounted tree — the same mechanism
 *  useDistanceDraft.test.ts uses (`unit.setPref`), reached here through a
 *  sibling component inside the same UnitProvider. */
function PrefSetter() {
  const unit = useDisplayUnit();
  return (
    <>
      <button data-testid="set-km" onClick={() => unit.setPref("km")}>km</button>
      <button data-testid="set-mi" onClick={() => unit.setPref("mi")}>mi</button>
    </>
  );
}

describe("TransportCostsTab (ch9-tc)", () => {
  beforeEach(() => window.localStorage.clear());

  it("seeds the four fields from the textbook defaults when inputs carry no rates", () => {
    renderTab();
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");
    expect(screen.getByTestId("input-transport-ic-min")).toHaveValue("10");
    expect(screen.getByTestId("input-transport-ob-rate")).toHaveValue("0.12");
    expect(screen.getByTestId("input-transport-ob-min")).toHaveValue("10");
  });

  it("seeds from the scenario's own rates when present", () => {
    renderTab({
      transportCosts: { icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0 },
      isCustom: true,
    });
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.09");
    expect(screen.getByTestId("input-transport-ob-min")).toHaveValue("0");
  });

  it("commits all four fields on blur, never a partial object", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.09" } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      ...TEXTBOOK_TRANSPORT_COSTS, icTransCost: 0.09,
    });
  });

  // THE most important test in this spec (§6).
  it("km -> mi -> km toggling on the MOUNTED tab leaves the stored canonical rate exactly 0.07", () => {
    setPref("km");
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    expect(field).toHaveValue("0.0435");

    // Live toggles on one mounted instance — a remount would re-derive the
    // field from the stored value and prove nothing about reprojection.
    fireEvent.click(screen.getByTestId("set-mi"));
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");

    fireEvent.click(screen.getByTestId("set-km"));
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.0435");

    fireEvent.click(screen.getByTestId("set-mi"));
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");

    // No toggle may ever write: the stored canonical value is untouched.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-projects a complete dirty rate draft across a live toggle without writing", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.14" } });
    fireEvent.click(screen.getByTestId("set-km"));
    // 0.14 / 1.609344 = 0.086991… -> 0.087 at the field's 4 dp.
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.087");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the reciprocal conversion in km mode, not the multiplicative one", () => {
    setPref("km");
    renderTab();
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.0435");
    expect(screen.getByTestId("input-transport-ic-rate")).not.toHaveValue("0.1127");
  });

  it("labels rates in the active display unit and minimum charges in $/ton", () => {
    setPref("km");
    renderTab();
    expect(screen.getByTestId("label-transport-rate-unit-ic")).toHaveTextContent("$/ton-km");
    expect(screen.getByTestId("label-transport-min-unit-ic")).toHaveTextContent("$/ton");
  });

  it("leaves a minimum charge unconverted by the display toggle", () => {
    setPref("km");
    renderTab();
    expect(screen.getByTestId("input-transport-ic-min")).toHaveValue("10");
  });

  it("treats an equivalent spelling as a semantic no-op", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.0700" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats a cross-unit round trip as a semantic no-op", () => {
    setPref("km");
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    // Retype exactly what is displayed; fromDisplay lands on 0.070006..., so
    // only a DISPLAY-space comparison catches this as unchanged.
    fireEvent.change(field, { target: { value: "0.0435" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards an in-progress draft when the scenario changes (resetKey)", () => {
    const { rerender, onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.09" } });
    expect(field).toHaveValue("0.09");
    rerender(
      <UnitProvider>
        <TransportCostsTab
          canonicalUnit="mi"
          transportCosts={TEXTBOOK_TRANSPORT_COSTS}
          isCustom={false}
          onChange={onChange}
          onReset={vi.fn()}
          scenarioId={2}
        />
      </UnitProvider>,
    );
    // One scenario's unfinished text can never be committed into another.
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards an incomplete draft on a live unit toggle rather than committing it", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0." } });
    fireEvent.click(screen.getByTestId("set-km"));
    // Visibly discarded: back to the stored value in the new unit.
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.0435");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a negative value inline and never writes", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "-1" } });
    expect(screen.getByTestId("error-transport-ic-rate")).toBeInTheDocument();
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a rate above 10 and a minimum charge above 10000 inline", () => {
    const { onChange } = renderTab();
    const rate = screen.getByTestId("input-transport-ob-rate");
    fireEvent.change(rate, { target: { value: "10.5" } });
    expect(screen.getByTestId("error-transport-ob-rate")).toBeInTheDocument();
    fireEvent.blur(rate);

    const min = screen.getByTestId("input-transport-ob-min");
    fireEvent.change(min, { target: { value: "10001" } });
    expect(screen.getByTestId("error-transport-ob-min")).toBeInTheDocument();
    fireEvent.blur(min);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("validates a km-displayed rate against the converted maximum", () => {
    setPref("km");
    const { onChange } = renderTab();
    const rate = screen.getByTestId("input-transport-ob-rate");
    // Canonical max 10 $/ton-mi = 6.2137 $/ton-km at the field's 4 dp.
    fireEvent.change(rate, { target: { value: "6.2137" } });
    expect(screen.queryByTestId("error-transport-ob-rate")).not.toBeInTheDocument();
    fireEvent.blur(rate);
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.change(rate, { target: { value: "6.2138" } });
    expect(screen.getByTestId("error-transport-ob-rate")).toHaveTextContent("6.2137");
    fireEvent.blur(rate);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("accepts zero for a minimum charge", () => {
    const { onChange } = renderTab();
    const min = screen.getByTestId("input-transport-ob-min");
    fireEvent.change(min, { target: { value: "0" } });
    fireEvent.blur(min);
    expect(onChange.mock.calls[0][0]).toEqual({ ...TEXTBOOK_TRANSPORT_COSTS, obMinTrans: 0 });
  });

  it("offers Reset only when the scenario carries custom rates, and clears rather than writing defaults", () => {
    const bare = renderTab();
    expect(bare.getByTestId("button-transport-reset")).toBeDisabled();
    bare.unmount();

    const custom = renderTab({ isCustom: true, transportCosts: { ...TEXTBOOK_TRANSPORT_COSTS, icTransCost: 0.09 } });
    fireEvent.click(custom.getByTestId("button-transport-reset"));
    expect(custom.onReset).toHaveBeenCalledTimes(1);
    expect(custom.onChange).not.toHaveBeenCalled();
  });

  it("disables every field and Reset while browsing history", () => {
    const { onChange } = renderTab({ disabled: true, isCustom: true });
    for (const id of ["ic-rate", "ic-min", "ob-rate", "ob-min"]) {
      expect(screen.getByTestId(`input-transport-${id}`)).toBeDisabled();
    }
    expect(screen.getByTestId("button-transport-reset")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains the pricing formula", () => {
    renderTab();
    expect(screen.getByTestId("text-transport-formula")).toHaveTextContent(
      "cost per ton = max(rate × distance, min)",
    );
  });
});
