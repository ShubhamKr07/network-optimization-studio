import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CapabilityMatrixTab } from "@/components/workspace/tabs/CapabilityMatrixTab";

// T11 (Chapter 9 JADE) — the Capability Matrix tab: an effective-plants ×
// 4-products checkbox grid. Base cells default from the 16-cell matrix
// (diagonal on per spec §2.7's ground truth); added-plant rows default off
// (no base-matrix entry at all).
const plants = [
  { id: "plant-1", name: "Plant One", city: "A", state: "QLD", lat: 1, lng: 1 },
  { id: "plant-2", name: "Plant Two", city: "B", state: "QLD", lat: 2, lng: 2 },
];
const products = [
  { id: "product-1", name: "Copper" },
  { id: "product-2", name: "Aluminum" },
];
// Diagonal-on base matrix: plant-1 makes product-1 only, plant-2 makes
// product-2 only — matches spec §2.2's "4 at 210000000, 12 at 0" shape at
// this smaller 2x2 scale.
const baseCapabilities = [
  { plantId: "plant-1", productId: "product-1", capacity: 210000000 },
  { plantId: "plant-1", productId: "product-2", capacity: 0 },
  { plantId: "plant-2", productId: "product-1", capacity: 0 },
  { plantId: "plant-2", productId: "product-2", capacity: 210000000 },
];

describe("CapabilityMatrixTab", () => {
  it("renders effective plants × 4 products with the base diagonal checked", () => {
    render(
      <CapabilityMatrixTab
        plants={plants}
        products={products}
        baseCapabilities={baseCapabilities}
        overrides={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("capability-matrix-tab")).toBeInTheDocument();
    expect(screen.getByText("Copper")).toBeInTheDocument();
    expect(screen.getByText("Aluminum")).toBeInTheDocument();
    // Diagonal on.
    expect(screen.getByTestId("checkbox-capability-plant-1-product-1")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("checkbox-capability-plant-2-product-2")).toHaveAttribute("aria-checked", "true");
    // Off-diagonal off.
    expect(screen.getByTestId("checkbox-capability-plant-1-product-2")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("checkbox-capability-plant-2-product-1")).toHaveAttribute("aria-checked", "false");
  });

  it("toggling a cell writes an override entry", async () => {
    const onChange = vi.fn();
    render(
      <CapabilityMatrixTab
        plants={plants}
        products={products}
        baseCapabilities={baseCapabilities}
        overrides={[]}
        onChange={onChange}
      />,
    );
    // plant-1/product-2 is off by base default; toggle it on.
    await userEvent.click(screen.getByTestId("checkbox-capability-plant-1-product-2"));
    expect(onChange).toHaveBeenCalledWith([{ plantId: "plant-1", productId: "product-2", enabled: true }]);
  });

  it("toggling a cell back to its base default REMOVES the override (no-op state)", async () => {
    const onChange = vi.fn();
    render(
      <CapabilityMatrixTab
        plants={plants}
        products={products}
        baseCapabilities={baseCapabilities}
        overrides={[{ plantId: "plant-1", productId: "product-2", enabled: true }]}
        onChange={onChange}
      />,
    );
    // Base default for plant-1/product-2 is off; an override currently
    // turns it on. Toggling again should revert to "off" and REMOVE the
    // override entirely, not store {enabled:false}.
    await userEvent.click(screen.getByTestId("checkbox-capability-plant-1-product-2"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("an added-plant row (no base capability entry at all) defaults every cell to off", () => {
    const plantsWithAdded = [...plants, { id: "ap-new-1", name: undefined, city: "C", state: "QLD", lat: 3, lng: 3 }];
    render(
      <CapabilityMatrixTab
        plants={plantsWithAdded}
        products={products}
        baseCapabilities={baseCapabilities}
        overrides={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("checkbox-capability-ap-new-1-product-1")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("checkbox-capability-ap-new-1-product-2")).toHaveAttribute("aria-checked", "false");
  });

  it("toggling a cell on an added plant (no base entry) writes an override", async () => {
    const onChange = vi.fn();
    const plantsWithAdded = [...plants, { id: "ap-new-1", city: "C", state: "QLD", lat: 3, lng: 3 }];
    render(
      <CapabilityMatrixTab
        plants={plantsWithAdded}
        products={products}
        baseCapabilities={baseCapabilities}
        overrides={[]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("checkbox-capability-ap-new-1-product-1"));
    expect(onChange).toHaveBeenCalledWith([{ plantId: "ap-new-1", productId: "product-1", enabled: true }]);
  });

  it("shows an empty state when there are no plants or products", () => {
    render(
      <CapabilityMatrixTab plants={[]} products={products} baseCapabilities={[]} overrides={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("capability-matrix-empty")).toBeInTheDocument();
  });
});
