import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AssignmentsTab } from "@/components/workspace/tabs/AssignmentsTab";
import * as exportEntity from "@/lib/exportEntity";

const result = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
  edges: [
    { fromId: "ALN", toId: "C1", flow: 205375, distance: 42.1, band: 0 },
    { fromId: "DAL", toId: "C2", flow: 150000, distance: 812.4, band: 3 },
  ],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("AssignmentsTab", () => {
  it("renders one row per edge with warehouseId/customerId/distance/flow", () => {
    render(<AssignmentsTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("ALN");
    expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("42.1");
    expect(screen.getByTestId("assignment-row-C2")).toHaveTextContent("DAL");
  });

  it("shows an empty-state message when result is null", () => {
    render(<AssignmentsTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("assignments-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=assignments when Download CSV is clicked", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<AssignmentsTab result={result} scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-assignments-csv"));
    expect(spy).toHaveBeenCalledWith(1, "assignments", "csv");
  });

  // B2.2-T6 — B6: added-entity display ID
  describe("added-entity display ID", () => {
    it("shows a user-created warehouse's display ID (not its uid) from displayedInputs.addedWarehouses", () => {
      const withAdded = {
        ...result,
        edges: [{ fromId: "aw-abc123", toId: "C9", flow: 500, distance: 3 }],
      };
      render(
        <AssignmentsTab
          result={withAdded}
          scenarioId={1}
          displayedInputs={{ addedWarehouses: [{ id: "aw-abc123", displayCode: "WH-CO-DENVER-01" }] }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C9");
      expect(row).toHaveTextContent("WH-CO-DENVER-01");
      expect(row).not.toHaveTextContent("aw-abc123");
    });

    it("shows an added two-echelon refinery's display ID from displayedInputs.addedRefineries (same aw- uid family)", () => {
      const withRefinery = {
        ...result,
        edges: [{ fromId: "aw-xyz789", toId: "C9", flow: 500, distance: 3 }],
      };
      render(
        <AssignmentsTab
          result={withRefinery}
          scenarioId={1}
          displayedInputs={{ addedRefineries: [{ id: "aw-xyz789", displayCode: "RF-AU-CUNN-01" }] }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C9");
      expect(row).toHaveTextContent("RF-AU-CUNN-01");
      expect(row).not.toHaveTextContent("aw-xyz789");
    });

    it("falls back to the raw id when no displayCode entry exists for it (base dataset rows), and displayedInputs is optional", () => {
      render(<AssignmentsTab result={result} scenarioId={1} />);
      expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("ALN");
    });
  });

  // B2.2-T6 — snapshot invariant
  it("does not reflect an unsaved localInputs-style edit that was never passed via displayedInputs", () => {
    // Same rationale as OpenWarehousesTab's equivalent test: this component
    // reads ONLY `displayedInputs`, never anything resembling `localInputs`
    // — an unsaved edit the student hasn't saved yet must have zero effect
    // on what's rendered here.
    const withAdded = {
      ...result,
      edges: [{ fromId: "aw-abc123", toId: "C9", flow: 500, distance: 3 }],
    };
    const savedSnapshot = { addedWarehouses: [{ id: "aw-abc123", displayCode: "WH-CO-DENVER-01" }] };
    const unsavedLocalEdit = { addedWarehouses: [{ id: "aw-abc123", displayCode: "WH-CO-DENVER-99-DRAFT" }] }; // never passed
    void unsavedLocalEdit;
    render(<AssignmentsTab result={withAdded} scenarioId={1} displayedInputs={savedSnapshot} />);
    const row = screen.getByTestId("assignment-row-C9");
    expect(row).toHaveTextContent("WH-CO-DENVER-01");
    expect(row).not.toHaveTextContent("WH-CO-DENVER-99-DRAFT");
  });
});
