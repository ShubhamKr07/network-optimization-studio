import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// Capture every <Tooltip> child rendered by NetworkMap so we can assert that a
// Tooltip (hover label) is rendered for each customer/station marker with the
// expected city/state/demand content. react-leaflet's non-permanent Tooltip
// does not attach its React children to the jsdom document until the marker is
// hovered in a real browser, so we can't read it from container.textContent;
// spying on the Tooltip component verifies the same thing (that NetworkMap
// emits a Tooltip with the right children) without depending on Leaflet DOM
// behavior under jsdom.
const tooltipChildren: React.ReactNode[] = [];
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  return {
    ...actual,
    Tooltip: (props: { children?: React.ReactNode }) => {
      if (props.children) tooltipChildren.push(props.children);
      return null;
    },
  };
});

const { NetworkMap } = await import("@/components/NetworkMap");

const dataset = {
  warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
  customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
};

describe("NetworkMap customer/station hover tooltip", () => {
  it("renders a Tooltip for every customer/station marker", () => {
    render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );

    // The dataset has one customer (no solved result, so no warehouse tooltip is
    // emitted either) -> exactly one Tooltip should have been rendered, and its
    // content should include the customer's city/state and demand, matching the
    // existing warehouse Tooltip's content style (NetworkMap.tsx:372-378).
    expect(tooltipChildren).toHaveLength(1);
    const { container } = render(<>{tooltipChildren[0]}</>);
    const text = container.textContent ?? "";
    expect(text).toContain("Sampleburg, SB");
    expect(text).toContain("5,000");
  });
});

describe("NetworkMap multi-select", () => {
  it("calls onToggleWarehouseMultiSelect on shift-click without triggering the single-select filter", () => {
    const onToggleWarehouseMultiSelect = vi.fn();
    const dataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [],
    };
    render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={onToggleWarehouseMultiSelect}
        onToggleCustomerMultiSelect={vi.fn()}
      />,
    );
    const marker = document.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.click(marker, { shiftKey: true });
    expect(onToggleWarehouseMultiSelect).toHaveBeenCalledWith("W1");
  });

  it("renders a distinct highlight ring for warehouses in multiSelectedWarehouseIds", () => {
    const dataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [],
    };
    const { container } = render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={["W1"]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={vi.fn()}
        onToggleCustomerMultiSelect={vi.fn()}
      />,
    );
    // The multi-select ring uses a distinct stroke color (#7C3AED, violet) from
    // the existing single-select highlight ring (#FCD34D, amber) so a student
    // can tell the two selection modes apart at a glance.
    expect(container.innerHTML).toContain("#7C3AED");
  });
});
