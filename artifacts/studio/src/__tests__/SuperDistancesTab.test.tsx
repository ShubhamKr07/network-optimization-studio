import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuperDistancesTab, type SuperDistancesTabProps } from "@/components/workspace/super/SuperDistancesTab";
import type { SuperInputsLike } from "@/lib/superNetwork";

type Method = SuperDistancesTabProps["distanceMethod"];

// QFX-6 made `network` a required prop; an empty draft is enough for these tests.
const NET = { products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [] } as unknown as SuperInputsLike;

// Stateful host: the real parent (Workspace) merges each patch into the draft
// and feeds distanceMethod/circuityFactor back as props.
function setup(over: Partial<SuperDistancesTabProps> = {}, initial: { method?: Method; factor?: number } = {}) {
  const onChange = vi.fn();
  const onFetchRoad = vi.fn();
  function Host() {
    const [method, setMethod] = useState<Method>(initial.method ?? "circuity");
    const [factor, setFactor] = useState(initial.factor ?? 1.17);
    return <SuperDistancesTab distanceMethod={method} circuityFactor={factor} overrides={[]}
      onChange={patch => {
        onChange(patch);
        if (typeof patch.circuityFactor === "number") setFactor(patch.circuityFactor);
        if (typeof patch.distanceMethod === "string") setMethod(patch.distanceMethod as Method);
      }}
      onFetchRoad={onFetchRoad} fetchDisabledReason={null}
      readOnly={false} plantIds={[]} warehouseIds={[]} customerIds={[]} network={NET} {...over} />;
  }
  render(<Host />);
  return Object.assign(onChange, { onFetchRoad });
}

const radio = (name: string) => screen.getByRole("radio", { name });
const ERROR = "Use a number from 1 to 3 with up to 3 decimals.";

describe("SuperDistancesTab method segmented control (QFX-9)", () => {
  it("is a radiogroup named 'Distance method' with Haversine | Circuity | Road; only the checked segment is tabbable", () => {
    setup({}, { method: "circuity" });
    const group = screen.getByRole("radiogroup", { name: "Distance method" });
    expect(group).toHaveAttribute("data-testid", "super-distance-method");
    expect(screen.getAllByRole("radio").map(r => r.textContent)).toEqual(["Haversine", "Circuity", "Road"]);
    expect(radio("Circuity")).toHaveAttribute("aria-checked", "true");
    expect(radio("Circuity")).toHaveAttribute("tabindex", "0");
    expect(radio("Haversine")).toHaveAttribute("aria-checked", "false");
    expect(radio("Haversine")).toHaveAttribute("tabindex", "-1");
    expect(radio("Road")).toHaveAttribute("tabindex", "-1");
    expect(group.querySelector("select")).toBeNull();
  });

  it("clicking a segment writes distanceMethod to the draft immediately", async () => {
    const onChange = setup({}, { method: "haversine" });
    await userEvent.click(radio("Road"));
    expect(onChange).toHaveBeenCalledWith({ distanceMethod: "road" });
    expect(radio("Road")).toHaveAttribute("aria-checked", "true");
  });

  it("clicking the already-checked segment writes nothing", async () => {
    const onChange = setup({}, { method: "road" });
    await userEvent.click(radio("Road"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("→/↓ move to and select the next segment, wrapping; ←/↑ the previous, wrapping", async () => {
    const onChange = setup({}, { method: "haversine" });
    radio("Haversine").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "circuity" });
    expect(radio("Circuity")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "haversine" });
    expect(radio("Haversine")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    expect(radio("Road")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "circuity" });
    expect(radio("Circuity")).toHaveAttribute("aria-checked", "true");
    expect(radio("Circuity")).toHaveAttribute("tabindex", "0");
  });

  it("Home and End go to the first and last segment", async () => {
    const onChange = setup({}, { method: "circuity" });
    radio("Circuity").focus();
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    expect(radio("Road")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "haversine" });
    expect(radio("Haversine")).toHaveFocus();
  });

  it("Space and Enter select the focused segment", async () => {
    const onChange = setup({}, { method: "haversine" });
    radio("Road").focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "road" });
    radio("Circuity").focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ distanceMethod: "circuity" });
  });

  it("read-only (history) disables every segment", () => {
    setup({ readOnly: true });
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();
  });
});

describe("SuperDistancesTab circuity factor + Apply (QFX-9)", () => {
  it("is shown only under Circuity", () => {
    setup({}, { method: "haversine" });
    expect(screen.queryByTestId("super-circuity-factor")).toBeNull();
    expect(screen.queryByTestId("super-circuity-apply")).toBeNull();
  });

  it("is a compact decimal text input showing the stored value", () => {
    setup();
    const el = screen.getByTestId("super-circuity-factor");
    expect(el).toHaveAttribute("type", "text");
    expect(el).toHaveAttribute("inputmode", "decimal");
    expect(el).toHaveValue("1.17");
  });

  it("typing never touches the draft; Apply writes the parsed number", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "1.25");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("super-circuity-apply"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: 1.25 });
  });

  it("Enter applies", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "2.5{Enter}");
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: 2.5 });
  });

  it("blur does nothing", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "2.5");
    await userEvent.tab();
    expect(el).not.toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    expect(el).toHaveValue("2.5");
  });

  it.each(["1.2345", "3.5", "0.99", "abc", "", "1.", "-1"])("'%s' is invalid: message shown, Apply disabled, Enter does nothing", async raw => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    if (raw) await userEvent.type(el, raw);
    expect(screen.getByTestId("super-circuity-error")).toHaveTextContent(ERROR);
    expect(el).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
    await userEvent.type(el, "{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  // Object rows (not tuples): this .test.tsx is in the studio typecheck, and
  // mixed-type tuple rows infer `string | number` for each argument.
  it.each([{ raw: "1", n: 1 }, { raw: "3", n: 3 }, { raw: "1.175", n: 1.175 }, { raw: "2.5", n: 2.5 }])("'$raw' is valid and applies $n", async ({ raw, n }) => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, raw);
    expect(screen.queryByTestId("super-circuity-error")).toBeNull();
    await userEvent.click(screen.getByTestId("super-circuity-apply"));
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: n });
  });

  it("Apply is disabled while the input equals the stored value (including '1.170')", async () => {
    setup();
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "1.170");
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
    expect(screen.queryByTestId("super-circuity-error")).toBeNull();
  });

  it("re-syncs to the stored value when the draft changes from elsewhere (import, history restore)", async () => {
    const props: SuperDistancesTabProps = {
      distanceMethod: "circuity", circuityFactor: 1.17, overrides: [], onChange: vi.fn(), onFetchRoad: vi.fn(),
      fetchDisabledReason: null, readOnly: false, plantIds: [], warehouseIds: [], customerIds: [], network: NET,
    };
    const { rerender } = render(<SuperDistancesTab {...props} />);
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "2.9");
    rerender(<SuperDistancesTab {...props} circuityFactor={1.5} />);
    expect(screen.getByTestId("super-circuity-factor")).toHaveValue("1.5");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("read-only disables the input and Apply", () => {
    setup({ readOnly: true });
    expect(screen.getByTestId("super-circuity-factor")).toBeDisabled();
    expect(screen.getByTestId("super-circuity-apply")).toBeDisabled();
  });
});

describe("SuperDistancesTab road method", () => {
  it("under road the fetch button renders and calls onFetchRoad; no factor field", async () => {
    const h = setup({}, { method: "road" });
    expect(screen.queryByTestId("super-circuity-factor")).toBeNull();
    await userEvent.click(screen.getByTestId("super-road-fetch"));
    expect(h.onFetchRoad).toHaveBeenCalled();
  });
  it("is disabled with the reason as title", () => {
    setup({ fetchDisabledReason: "Save your changes first" }, { method: "road" });
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
    expect(screen.getByTestId("super-road-fetch")).toHaveAttribute("title", "Save your changes first");
  });
  it("is disabled read-only (history)", () => {
    setup({ readOnly: true }, { method: "road" });
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
  });
  it("haversine shows no extra controls", () => {
    setup({}, { method: "haversine" });
    expect(screen.queryByTestId("super-road-fetch")).toBeNull();
    expect(screen.queryByTestId("super-circuity-factor")).toBeNull();
  });
});
