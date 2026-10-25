// SCU-2.P4.9 — the Plant Capability Matrix on the shared DataTable (B2.1/B2.2,
// D2). No Upload / Download (spec scope). Pins the matrix testids (incl. the
// <td> plant testid with no wrapper, and the always-on count), the kept
// `plant` text + filter-only `state` select above 10 plants, history
// read-only on every checkbox, and one toggle round-trip.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CapabilityMatrixTab, type CapabilityOverride } from "@/components/workspace/tabs/CapabilityMatrixTab";

const products = [
  { id: "product-1", name: "Copper" },
  { id: "product-2", name: "Aluminum" },
];
const plants = Array.from({ length: 11 }, (_, i) => ({
  id: `plant-${i + 1}`,
  name: `Plant ${i + 1}`,
  city: `City ${i + 1}`,
  state: i === 10 ? "KY" : "OH",
  lat: 1,
  lng: 1,
}));
const baseCapabilities = plants.flatMap(p =>
  products.map(pr => ({ plantId: p.id, productId: pr.id, capacity: pr.id === "product-1" ? 1000 : 0 })),
);

const renderTab = (props: Partial<React.ComponentProps<typeof CapabilityMatrixTab>> = {}) =>
  render(
    <CapabilityMatrixTab
      plants={plants}
      products={products}
      baseCapabilities={baseCapabilities}
      overrides={[]}
      onChange={vi.fn()}
      {...props}
    />,
  );

describe("CapabilityMatrixTab on DataTable (SCU-2.P4.9)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of [
      "capability-matrix-tab",
      "text-capability-capacity-label",
      "text-capability-count",
      "button-filter-menu-trigger",
      "row-capability-plant-1",
      "text-capability-plant-plant-1",
      "checkbox-capability-plant-1-product-1",
      "text-capability-capacity-plant-1-product-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("text-capability-count")).toHaveTextContent("11 plants");
    const plantCell = screen.getByTestId("text-capability-plant-plant-1");
    expect(plantCell.tagName).toBe("TD");
    // e2e (workspace-fixups.spec.ts) counts the EntityIdCell's two spans inside the <td>.
    expect(plantCell.querySelectorAll(":scope > div > span")).toHaveLength(2);
    expect(
      within(screen.getByTestId("capability-matrix-tab"))
        .getAllByRole("columnheader")
        .map(h => h.textContent),
    ).toEqual(["Plant", "Copper (units)", "Aluminum (units)"]);
  });

  it("keeps the plant text filter and the filter-only state select (no rendered State column)", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-plant")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("checkbox-filter-state-KY"));
    expect(screen.getByTestId("text-capability-count")).toHaveTextContent("1 of 11 plants");
    expect(screen.getByTestId("row-capability-plant-11")).toBeInTheDocument();
    expect(screen.queryByTestId("row-capability-plant-1")).toBeNull();
    expect(screen.queryByTestId("filter-control-product:product-1")).toBeNull();
  });

  it("the no-match text is the matrix's own", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-plant"), { target: { value: "zzz" } });
    expect(screen.getByText("No plants match the current filter.")).toBeInTheDocument();
  });

  it("no filter menu at ≤ 10 plants (JADE ships 4)", () => {
    renderTab({ plants: plants.slice(0, 4) });
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
    expect(screen.getByTestId("text-capability-count")).toHaveTextContent("4 plants");
  });

  it("history read-only (D2): every checkbox is disabled", () => {
    renderTab({ readOnly: true });
    for (const p of plants)
      for (const pr of products) expect(screen.getByTestId(`checkbox-capability-${p.id}-${pr.id}`)).toBeDisabled();
  });

  it("toggle round-trip through a stateful parent", () => {
    function Parent() {
      const [o, setO] = useState<CapabilityOverride[]>([]);
      return (
        <CapabilityMatrixTab
          plants={plants.slice(0, 2)}
          products={products}
          baseCapabilities={baseCapabilities}
          overrides={o}
          onChange={setO}
        />
      );
    }
    render(<Parent />);
    const box = screen.getByTestId("checkbox-capability-plant-1-product-2");
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(screen.getByTestId("checkbox-capability-plant-1-product-2")).toHaveAttribute("aria-checked", "true");
  });
});
