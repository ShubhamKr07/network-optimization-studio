import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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
