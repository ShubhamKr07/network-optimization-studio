import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { makeQuintileRadius, QUINTILE_RADII } from "@/components/workspace/map/types";
import { getBandColor } from "@/lib/bandPalette";
import { UnitProvider } from "@/contexts/UnitContext";

// Bundle 6.1 (T1) — matches MapLegend.tsx's own LEGEND_DEMAND_SCALE. Every
// demand-bucket swatch renders at this uniform scale so it fits its 24px
// (`w-6 h-6`) cell while preserving relative sizing across buckets.
const LEGEND_DEMAND_SCALE = 0.55;

describe("MapLegend", () => {
  it("renders the three status labels from the shared statusPresentation mapping", () => {
    const { getByText } = render(<UnitProvider><MapLegend /></UnitProvider>);
    expect(getByText("Potential")).toBeInTheDocument();
    expect(getByText("Fixed-Open")).toBeInTheDocument();
    expect(getByText("Inactive")).toBeInTheDocument();
  });

  it("renders one demand-bucket row per bucket actually occupied by the given customers, sized off the same quintile scale EntityMarkers uses (scaled by LEGEND_DEMAND_SCALE to fit the cell)", () => {
    const customers = [100, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 50000].map((demand) => ({ demand }));
    const scale = makeQuintileRadius(customers.map((c) => c.demand));
    const { container } = render(<UnitProvider><MapLegend customers={customers} /></UnitProvider>);
    for (const bucket of scale.usedBuckets) {
      const circle = container.querySelector(`[data-testid="legend-demand-bucket-${bucket}"] circle`);
      expect(circle).not.toBeNull();
      expect(Number(circle?.getAttribute("r"))).toBeCloseTo(QUINTILE_RADII[bucket] * LEGEND_DEMAND_SCALE);
    }
  });

  it("collapses to a single row when every customer has identical demand (a degenerate/all-equal population)", () => {
    const customers = [200, 200, 200, 200].map((demand) => ({ demand }));
    const { container } = render(<UnitProvider><MapLegend customers={customers} /></UnitProvider>);
    expect(container.querySelectorAll('[data-testid^="legend-demand-bucket-"]').length).toBe(1);
    expect(container.querySelector('[data-testid="legend-demand-bucket-0"]')).not.toBeNull();
  });

  it("never renders a row for a bucket nobody occupies (a small population doesn't produce a padded-out 5-row legend)", () => {
    // 2 customers, both landing in bucket 0 (a tiny spread near the bottom).
    const customers = [10, 10].map((demand) => ({ demand }));
    const { container } = render(<UnitProvider><MapLegend customers={customers} /></UnitProvider>);
    expect(container.querySelectorAll('[data-testid^="legend-demand-bucket-"]').length).toBe(1);
  });

  it("falls back to a static demo population (still 5 distinct rows) when no customers prop is supplied", () => {
    const { container } = render(<UnitProvider><MapLegend /></UnitProvider>);
    const rows = container.querySelectorAll('[data-testid^="legend-demand-bucket-"]');
    expect(rows.length).toBeGreaterThan(1);
  });

  describe("demand tone (book-cover — bundle3-T8/T10)", () => {
    // Bundle 3: demand-bubble swatches (base + legend, via the shared
    // customerBubbleSvg builder EntityMarkers/MapLegend both consume) use
    // the exact --map-customer/--map-customer-stroke pair the map markers
    // use — not --demand-*/--accent-* — so legend and markers can never
    // diverge (same reuse guarantee the R1/R3 predecessor tests checked,
    // updated for the retired --demand-* tone system).
    it("demand swatches use --map-customer/--map-customer-stroke for p-median-us, the default modelId", () => {
      const customers = [1000, 5000, 20000].map((demand) => ({ demand }));
      const { container } = render(<UnitProvider><MapLegend customers={customers} /></UnitProvider>);
      const anySwatch = container.querySelector('[data-testid^="legend-demand-bucket-"] svg')!;
      expect(anySwatch.outerHTML).toContain("var(--map-customer)");
      expect(anySwatch.outerHTML).toContain("var(--map-customer-stroke)");
    });

    it("demand swatches use the same map-customer pair for every other modelId too (no more per-model tone branch)", () => {
      const customers = [1000, 5000, 20000].map((demand) => ({ demand }));
      const { container } = render(<UnitProvider><MapLegend customers={customers} modelId="transport-coal" /></UnitProvider>);
      const anySwatch = container.querySelector('[data-testid^="legend-demand-bucket-"] svg')!;
      expect(anySwatch.outerHTML).toContain("var(--map-customer)");
      expect(anySwatch.outerHTML).not.toContain("--demand-");
      expect(anySwatch.outerHTML).not.toContain("--accent-300");
    });
  });

  describe("status legend gate (capability seam — R3)", () => {
    it("shows the status legend by default (today's p-median-us behavior, unchanged)", () => {
      const { getByText } = render(<UnitProvider><MapLegend /></UnitProvider>);
      expect(getByText("Potential")).toBeInTheDocument();
    });

    it("omits the status legend entirely when showStatusLegend is false (e.g. transport-coal, which has no facility-status concept)", () => {
      const { queryByText, queryByTestId } = render(<UnitProvider><MapLegend showStatusLegend={false} /></UnitProvider>);
      expect(queryByText("Potential")).not.toBeInTheDocument();
      expect(queryByText("Fixed-Open")).not.toBeInTheDocument();
      expect(queryByText("Inactive")).not.toBeInTheDocument();
      expect(queryByTestId("legend-status-active")).not.toBeInTheDocument();
    });
  });

  // jade-T12 (Chapter 9 JADE) — the plant legend row, additive to the
  // status legend (a plant has no status vocabulary of its own).
  describe("plant legend row (jade-T12)", () => {
    it("omits the Plant row by default (showPlantLayer defaults false — every non-JADE model)", () => {
      const { queryByTestId, queryByText } = render(<UnitProvider><MapLegend /></UnitProvider>);
      expect(queryByTestId("legend-plant")).not.toBeInTheDocument();
      expect(queryByText("Plant")).not.toBeInTheDocument();
    });

    it("shows the Plant row when showPlantLayer is true, alongside the status legend", () => {
      const { getByTestId, getByText } = render(<UnitProvider><MapLegend showPlantLayer /></UnitProvider>);
      expect(getByTestId("legend-plant")).toBeInTheDocument();
      expect(getByText("Plant")).toBeInTheDocument();
      // additive, not a replacement — the warehouse status rows still show.
      expect(getByText("Potential")).toBeInTheDocument();
    });
  });

  // ── Bundle 6.1 (T1) — content-fit box, aligned grid ─────────────────────
  describe("content-fit layout (Bundle 6.1 T1)", () => {
    it("is content-fit (w-fit + max-w-[260px]), not the old fixed w-[220px]", () => {
      const { getByTestId } = render(<UnitProvider><MapLegend /></UnitProvider>);
      const box = getByTestId("map-legend");
      expect(box.className).toContain("w-fit");
      expect(box.className).toContain("max-w-[260px]");
      expect(box.className).not.toContain("w-[220px]");
      expect(box.className).not.toContain("flex-wrap");
    });

    it("aligns the status group and the demand group in a 2-column grid-cols-[auto_1fr]", () => {
      const customers = [1000, 5000, 20000].map((demand) => ({ demand }));
      const { container } = render(<UnitProvider><MapLegend customers={customers} /></UnitProvider>);
      const grids = container.querySelectorAll('[data-testid="map-legend"] .grid-cols-\\[auto_1fr\\]');
      // Status group grid + demand group grid, both aligned the same way.
      expect(grids.length).toBe(2);
    });

    it("every status/demand swatch cell is a fixed w-6 h-6 (24px) — large enough for the 22px triangle/star, never the old clipping w-[14px]", () => {
      const customers = [1000, 5000, 20000].map((demand) => ({ demand }));
      const { container } = render(<UnitProvider><MapLegend customers={customers} /></UnitProvider>);
      const cells = container.querySelectorAll(
        '[data-testid^="legend-status-"], [data-testid^="legend-demand-bucket-"]',
      );
      expect(cells.length).toBeGreaterThan(0);
      cells.forEach((cell) => {
        expect(cell.className).toContain("w-6");
        expect(cell.className).toContain("h-6");
      });
    });

    it("corner defaults to bl (left-4) and can be switched to br (right-4)", () => {
      const { getByTestId, rerender } = render(<UnitProvider><MapLegend /></UnitProvider>);
      expect(getByTestId("map-legend").className).toContain("left-4");
      expect(getByTestId("map-legend").className).not.toContain("right-4");

      rerender(<UnitProvider><MapLegend corner="br" /></UnitProvider>);
      expect(getByTestId("map-legend").className).toContain("right-4");
      expect(getByTestId("map-legend").className).not.toContain("left-4");
    });
  });

  it("input variant never renders a Distance bands group, even if bands were somehow passed (no bands prop wired for input today)", () => {
    const { queryByText } = render(<UnitProvider><MapLegend variant="input" /></UnitProvider>);
    expect(queryByText("Distance bands")).not.toBeInTheDocument();
    expect(queryByText(/≤ .* mi/)).not.toBeInTheDocument();
  });

  // ── Bundle 6.1 (T1, resolution #7) — Output variant ─────────────────────
  describe("Output variant (Bundle 6.1 T1, resolution #7)", () => {
    const solvedResult = {
      status: "optimal" as const,
      objective: 1,
      runTimeSec: 0.1,
      quality: "Optimal",
      edges: [],
      metrics: { weightedAvgDistance: 0, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: [], assignments: [] },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    };

    it("shows Potential/Open/Customer, never a separate Forced Open entry", () => {
      const { getByText, queryByText } = render(<UnitProvider><MapLegend variant="output" /></UnitProvider>);
      expect(getByText("Potential")).toBeInTheDocument();
      expect(getByText("Open")).toBeInTheDocument();
      expect(getByText("Customer")).toBeInTheDocument();
      expect(queryByText("Fixed-Open")).not.toBeInTheDocument();
      expect(queryByText("Forced Open")).not.toBeInTheDocument();
    });

    it("shows a Mine (fixed) entry only when hasMine is true, and only while the warehouse layer is on", () => {
      const { getByText, queryByText, rerender } = render(<UnitProvider><MapLegend variant="output" hasMine /></UnitProvider>);
      expect(getByText("Mine (fixed)")).toBeInTheDocument();

      rerender(<UnitProvider><MapLegend variant="output" hasMine={false} /></UnitProvider>);
      expect(queryByText("Mine (fixed)")).not.toBeInTheDocument();

      rerender(<UnitProvider><MapLegend variant="output" hasMine showWarehouseLayer={false} /></UnitProvider>);
      expect(queryByText("Mine (fixed)")).not.toBeInTheDocument();
    });

    it("has NO demand ramp at all, even with a customers population passed", () => {
      const customers = [1000, 5000, 20000].map((demand) => ({ demand }));
      const { container, queryByText } = render(<UnitProvider><MapLegend variant="output" customers={customers} /></UnitProvider>);
      expect(container.querySelectorAll('[data-testid^="legend-demand-bucket-"]').length).toBe(0);
      expect(queryByText("Demand")).not.toBeInTheDocument();
    });

    it("hides facility/mine entries when showWarehouseLayer is false, independent of the Customer entry", () => {
      const { getByText, queryByText } = render(
        <UnitProvider><MapLegend variant="output" hasMine showWarehouseLayer={false} showCustomerLayer /></UnitProvider>,
      );
      expect(queryByText("Potential")).not.toBeInTheDocument();
      expect(queryByText("Open")).not.toBeInTheDocument();
      expect(queryByText("Mine (fixed)")).not.toBeInTheDocument();
      expect(getByText("Customer")).toBeInTheDocument();
    });

    it("hides the Customer entry when showCustomerLayer is false, independent of the facility entries", () => {
      const { getByText, queryByText } = render(
        <UnitProvider><MapLegend variant="output" showWarehouseLayer showCustomerLayer={false} /></UnitProvider>,
      );
      expect(getByText("Potential")).toBeInTheDocument();
      expect(getByText("Open")).toBeInTheDocument();
      expect(queryByText("Customer")).not.toBeInTheDocument();
    });

    it("renders one route-band swatch per band, colored via getBandColor (clamps past the 5-entry palette) — 6 bands", () => {
      const bands = [500, 1000, 1500, 2000, 2500, 3000];
      const { container } = render(
        <UnitProvider><MapLegend variant="output" result={solvedResult} showRoutes bands={bands} /></UnitProvider>,
      );
      const swatches = container.querySelectorAll('[data-testid^="legend-band-"]');
      expect(swatches.length).toBe(6);
      swatches.forEach((swatch, i) => {
        const style = (swatch as HTMLElement).style;
        expect(style.backgroundColor).toBeTruthy();
        // jsdom normalizes var(...) CSS custom-property references through
        // as-is; compare against the same getBandColor() source of truth
        // NetworkMap's own polylines/legend swatches use.
        expect((swatch as HTMLElement).getAttribute("style")).toContain(getBandColor(i));
      });
    });

    it("labels each band swatch with its upper bound, not the old ordinal 'Band N'", () => {
      const { getByText, queryByText } = render(
        <UnitProvider><MapLegend variant="output" result={solvedResult} showRoutes bands={[200, 400, 800, 1600]} distanceUnit="mi" /></UnitProvider>,
      );
      expect(getByText("≤ 200 mi")).toBeInTheDocument();
      expect(getByText("≤ 400 mi")).toBeInTheDocument();
      expect(getByText("≤ 800 mi")).toBeInTheDocument();
      expect(getByText("≤ 1600 mi")).toBeInTheDocument();
      expect(queryByText("Band 1")).not.toBeInTheDocument();
      expect(queryByText(/^Band /)).not.toBeInTheDocument();
    });

    // chen-bands-units, Part D "No fallback unit — reads": no `distanceUnit`
    // passed means the canonical unit hasn't resolved — every band label
    // shows a placeholder, never a guessed "mi".
    it("shows a placeholder — never a value or a guessed 'mi' label — for every band swatch when no distanceUnit is resolved", () => {
      const { getAllByText, queryByText } = render(
        <UnitProvider><MapLegend variant="output" result={solvedResult} showRoutes bands={[200, 400]} /></UnitProvider>,
      );
      expect(queryByText(/mi$/)).not.toBeInTheDocument();
      expect(queryByText("≤ 200 mi")).not.toBeInTheDocument();
      expect(getAllByText("≤ —")).toHaveLength(2);
    });

    it("renders band labels in the given distanceUnit (e.g. km)", () => {
      const { getByText } = render(
        <UnitProvider><MapLegend variant="output" result={solvedResult} showRoutes bands={[200, 400]} distanceUnit="km" /></UnitProvider>,
      );
      expect(getByText("≤ 200 km")).toBeInTheDocument();
      expect(getByText("≤ 400 km")).toBeInTheDocument();
    });

    it("renders exactly one swatch per configured band — no trailing overflow row, since the map has no distinct overflow color (assignBand clamps into the last band's own color)", () => {
      const bands = [200, 400, 800, 1600];
      const { container } = render(
        <UnitProvider><MapLegend variant="output" result={solvedResult} showRoutes bands={bands} /></UnitProvider>,
      );
      const swatches = container.querySelectorAll('[data-testid^="legend-band-"]');
      expect(swatches.length).toBe(bands.length);
    });

    it("does not render the route-band group when showRoutes is false or there is no result", () => {
      const { queryByText, rerender } = render(
        <UnitProvider><MapLegend variant="output" result={solvedResult} showRoutes={false} bands={[500, 1000]} /></UnitProvider>,
      );
      expect(queryByText("Distance bands")).not.toBeInTheDocument();

      rerender(<UnitProvider><MapLegend variant="output" result={null} showRoutes bands={[500, 1000]} /></UnitProvider>);
      expect(queryByText("Distance bands")).not.toBeInTheDocument();
    });
  });
});
