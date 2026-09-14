import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FlowsTab } from "@/components/workspace/tabs/FlowsTab";
import * as exportEntity from "@/lib/exportEntity";

const transportResult = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "x",
  edges: [{ fromId: "KY", toId: "CHI", flow: 500, distance: 300 }],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

const twoEchelonResult = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "x",
  edges: [
    { fromId: "kalgoorlie", toId: "daggar-hills", flow: 100, distance: 293.66, leg: "mine_to_refinery" as const },
    { fromId: "daggar-hills", toId: "sydney", flow: 80, distance: 2381.79, leg: "refinery_to_customer" as const },
  ],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

const jadeResult = {
  status: "optimal" as const, objective: 254060828.6157, runTimeSec: 1.2, quality: "Proven optimal",
  edges: [
    { fromId: "plant-1", toId: "wh-11", flow: 1000, distance: 293.66, leg: "plant_to_warehouse" as const, productId: "product-1" },
    { fromId: "plant-1", toId: "wh-11", flow: 400, distance: 293.66, leg: "plant_to_warehouse" as const, productId: "product-2" },
    { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 42.1, leg: "warehouse_to_customer" as const },
  ],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("FlowsTab", () => {
  it("renders one row per edge for a transport-coal result (no leg field)", () => {
    render(<FlowsTab result={transportResult} scenarioId={1} />);
    expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("500");
  });

  it("shows only mine_to_refinery edges for a two-echelon result, excluding refinery_to_customer", () => {
    render(<FlowsTab result={twoEchelonResult} scenarioId={1} />);
    expect(screen.getByTestId("flow-row-kalgoorlie-daggar-hills")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-row-daggar-hills-sydney")).not.toBeInTheDocument();
  });

  // jade-T14 — Chapter 9 JADE
  describe("Chapter 9 JADE — plant_to_warehouse legs, per-product", () => {
    it("shows only plant_to_warehouse edges, excluding warehouse_to_customer", () => {
      render(<FlowsTab result={jadeResult} scenarioId={1} />);
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-1")).toBeInTheDocument();
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-2")).toBeInTheDocument();
      expect(screen.queryByTestId("flow-row-wh-11-customer-1")).not.toBeInTheDocument();
    });

    it("shows a Product column with each row's productId, one row per product (not collapsed)", () => {
      render(<FlowsTab result={jadeResult} scenarioId={1} />);
      expect(screen.getByText("Product")).toBeInTheDocument();
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-1")).toHaveTextContent("product-1");
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-2")).toHaveTextContent("product-2");
      const rows = screen.getAllByTestId(/^flow-row-/);
      expect(rows).toHaveLength(2);
    });

    it("does not show a Product column for a transport-coal result (no productId anywhere)", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} />);
      expect(screen.queryByText("Product")).not.toBeInTheDocument();
    });

    it("does not show a Product column for a two-echelon-gold-au result (no productId anywhere)", () => {
      render(<FlowsTab result={twoEchelonResult} scenarioId={1} />);
      expect(screen.queryByText("Product")).not.toBeInTheDocument();
    });
  });

  it("shows an empty-state message when result is null", () => {
    render(<FlowsTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("flows-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=flows when Download CSV is clicked", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<FlowsTab result={transportResult} scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-flows-csv"));
    expect(spy).toHaveBeenCalledWith(1, "flows", "csv");
  });

  // JADE — "City, ST" primary label + id mono sub-label
  describe("JADE City, ST label (locationById)", () => {
    it("shows 'City, ST' with the id kept as a sub-label for both From and To cells when locationById has entries", () => {
      render(
        <FlowsTab
          result={jadeResult}
          scenarioId={1}
          locationById={{
            "plant-1": { city: "Bethlehem", state: "PA" },
            "wh-11": { city: "Allentown", state: "PA" },
          }}
        />,
      );
      const row = screen.getByTestId("flow-row-plant-1-wh-11-product-1");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).toHaveTextContent("plant-1");
      expect(row).toHaveTextContent("Allentown, PA");
      expect(row).toHaveTextContent("wh-11");
    });

    it("falls back to ID-only rendering when locationById is absent (other-model default, no regression)", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} />);
      const row = screen.getByTestId("flow-row-KY-CHI");
      expect(row).toHaveTextContent("KY");
      expect(row).not.toHaveTextContent(",");
    });
  });
});
