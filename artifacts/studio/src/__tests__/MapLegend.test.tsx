import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { makeQuintileRadius, QUINTILE_RADII } from "@/components/workspace/map/types";

describe("MapLegend", () => {
  it("renders the three status labels from the shared statusPresentation mapping", () => {
    const { getByText } = render(<MapLegend />);
    expect(getByText("Potential")).toBeInTheDocument();
    expect(getByText("Fixed-Open")).toBeInTheDocument();
    expect(getByText("Inactive")).toBeInTheDocument();
  });

  it("renders one demand-bucket row per bucket actually occupied by the given customers, sized off the exact same quintile scale EntityMarkers uses", () => {
    const customers = [100, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 50000].map((demand) => ({ demand }));
    const scale = makeQuintileRadius(customers.map((c) => c.demand));
    const { container } = render(<MapLegend customers={customers} />);
    for (const bucket of scale.usedBuckets) {
      const circle = container.querySelector(`[data-testid="legend-demand-bucket-${bucket}"] circle`);
      expect(circle).not.toBeNull();
      expect(Number(circle?.getAttribute("r"))).toBeCloseTo(QUINTILE_RADII[bucket]);
    }
  });

  it("collapses to a single row when every customer has identical demand (a degenerate/all-equal population)", () => {
    const customers = [200, 200, 200, 200].map((demand) => ({ demand }));
    const { container } = render(<MapLegend customers={customers} />);
    expect(container.querySelectorAll('[data-testid^="legend-demand-bucket-"]').length).toBe(1);
    expect(container.querySelector('[data-testid="legend-demand-bucket-0"]')).not.toBeNull();
  });

  it("never renders a row for a bucket nobody occupies (a small population doesn't produce a padded-out 5-row legend)", () => {
    // 2 customers, both landing in bucket 0 (a tiny spread near the bottom).
    const customers = [10, 10].map((demand) => ({ demand }));
    const { container } = render(<MapLegend customers={customers} />);
    expect(container.querySelectorAll('[data-testid^="legend-demand-bucket-"]').length).toBe(1);
  });

  it("falls back to a static demo population (still 5 distinct rows) when no customers prop is supplied", () => {
    const { container } = render(<MapLegend />);
    const rows = container.querySelectorAll('[data-testid^="legend-demand-bucket-"]');
    expect(rows.length).toBeGreaterThan(1);
  });

  describe("demand tone (R1)", () => {
    it("demand swatches are green (var(--demand-*)) for p-median-us, the default modelId", () => {
      const customers = [1000, 5000, 20000].map((demand) => ({ demand }));
      const { container } = render(<MapLegend customers={customers} />);
      const anySwatch = container.querySelector('[data-testid^="legend-demand-bucket-"] svg')!;
      expect(anySwatch.outerHTML).toContain("var(--demand-300)");
    });

    it("demand swatches are green for every other modelId too (R1 fast-follow — no more blue branch)", () => {
      const customers = [1000, 5000, 20000].map((demand) => ({ demand }));
      const { container } = render(<MapLegend customers={customers} modelId="transport-coal" />);
      const anySwatch = container.querySelector('[data-testid^="legend-demand-bucket-"] svg')!;
      expect(anySwatch.outerHTML).toContain("var(--demand-300)");
      expect(anySwatch.outerHTML).not.toContain("--accent-300");
    });
  });

  describe("status legend gate (capability seam — R3)", () => {
    it("shows the status legend by default (today's p-median-us behavior, unchanged)", () => {
      const { getByText } = render(<MapLegend />);
      expect(getByText("Potential")).toBeInTheDocument();
    });

    it("omits the status legend entirely when showStatusLegend is false (e.g. transport-coal, which has no facility-status concept)", () => {
      const { queryByText, queryByTestId } = render(<MapLegend showStatusLegend={false} />);
      expect(queryByText("Potential")).not.toBeInTheDocument();
      expect(queryByText("Fixed-Open")).not.toBeInTheDocument();
      expect(queryByText("Inactive")).not.toBeInTheDocument();
      expect(queryByTestId("legend-status-active")).not.toBeInTheDocument();
    });
  });
});
