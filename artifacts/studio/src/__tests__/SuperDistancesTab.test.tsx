import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuperDistancesTab } from "@/components/workspace/super/SuperDistancesTab";

// Stateful host: the real parent feeds the committed value back as a prop.
function setup(over: Partial<Parameters<typeof SuperDistancesTab>[0]> = {}) {
  const onChange = vi.fn();
  const onFetchRoad = vi.fn();
  function Host() {
    const [f, setF] = useState(1);
    return <SuperDistancesTab distanceMethod="circuity" circuityFactor={f} overrides={[]}
      onChange={patch => { onChange(patch); if (typeof patch.circuityFactor === "number") setF(patch.circuityFactor); }}
      onFetchRoad={onFetchRoad} fetchDisabledReason={null}
      readOnly={false} plantIds={[]} warehouseIds={[]} customerIds={[]} {...over} />;
  }
  render(<Host />);
  return Object.assign(onChange, { onFetchRoad });
}

describe("SuperDistancesTab circuity factor", () => {
  it("typing 1.25 commits 1.25", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "1.25");
    expect(onChange).toHaveBeenLastCalledWith({ circuityFactor: 1.25 });
  });
  it("out-of-range does not commit", async () => {
    const onChange = setup();
    const el = screen.getByTestId("super-circuity-factor");
    await userEvent.clear(el);
    await userEvent.type(el, "5");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("is disabled under haversine", () => {
    setup({ distanceMethod: "haversine" });
    expect(screen.getByTestId("super-circuity-factor")).toBeDisabled();
  });
});

describe("SuperDistancesTab road method", () => {
  it("offers a road option", () => {
    setup();
    expect(screen.getByTestId("super-distance-method").querySelector('option[value="road"]')).not.toBeNull();
  });
  it("under road the fetch button renders and calls onFetchRoad", async () => {
    const h = setup({ distanceMethod: "road" });
    await userEvent.click(screen.getByTestId("super-road-fetch"));
    expect(h.onFetchRoad).toHaveBeenCalled();
  });
  it("is disabled with the reason as title", () => {
    setup({ distanceMethod: "road", fetchDisabledReason: "Save your changes first" });
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
    expect(screen.getByTestId("super-road-fetch")).toHaveAttribute("title", "Save your changes first");
  });
  it("is disabled read-only (history)", () => {
    setup({ distanceMethod: "road", readOnly: true });
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
  });
  it("no fetch button under haversine", () => {
    setup({ distanceMethod: "haversine" });
    expect(screen.queryByTestId("super-road-fetch")).toBeNull();
  });
});
