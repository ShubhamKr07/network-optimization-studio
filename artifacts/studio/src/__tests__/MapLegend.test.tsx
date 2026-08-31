import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { demandRadius } from "@/components/workspace/map/types";

describe("MapLegend", () => {
  it("renders the three status labels from the shared statusPresentation mapping", () => {
    const { getByText } = render(<MapLegend />);
    expect(getByText("Potential")).toBeInTheDocument();
    expect(getByText("Fixed-Open")).toBeInTheDocument();
    expect(getByText("Inactive")).toBeInTheDocument();
  });

  it("renders three demand reference bubbles sized by the exact same demandRadius scale EntityMarkers uses", () => {
    const { container } = render(<MapLegend />);
    for (const demand of [5000, 15000, 30000]) {
      const circle = container.querySelector(`[data-testid="legend-demand-${demand}"] circle`);
      expect(circle).not.toBeNull();
      expect(Number(circle?.getAttribute("r"))).toBeCloseTo(demandRadius(demand));
    }
  });

  it("shows the 5k/15k/30k reference labels", () => {
    const { getByText } = render(<MapLegend />);
    expect(getByText("5,000")).toBeInTheDocument();
    expect(getByText("15,000")).toBeInTheDocument();
    expect(getByText("30,000")).toBeInTheDocument();
  });
});
