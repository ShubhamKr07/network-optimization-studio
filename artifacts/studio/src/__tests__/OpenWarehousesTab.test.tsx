import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OpenWarehousesTab } from "@/components/workspace/tabs/OpenWarehousesTab";
import * as exportEntity from "@/lib/exportEntity";

const result = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
  edges: [
    { fromId: "ALN", toId: "C1", flow: 100, distance: 1 },
    { fromId: "ALN", toId: "C2", flow: 50, distance: 2 },
  ],
  metrics: { utilizationByNode: [{ warehouseId: "ALN", city: "Allentown", utilization: 41 }] },
  details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("OpenWarehousesTab", () => {
  it("sums flow across edges from the same warehouse and shows utilization as a percent", () => {
    render(<OpenWarehousesTab result={result} scenarioId={1} />);
    const row = screen.getByTestId("open-warehouse-row-ALN");
    expect(row).toHaveTextContent("150");
    expect(row).toHaveTextContent("41%");
  });

  it("shows an em dash when utilization is unknown", () => {
    render(<OpenWarehousesTab result={{ ...result, metrics: {} }} scenarioId={1} />);
    expect(screen.getByTestId("open-warehouse-row-ALN")).toHaveTextContent("—");
  });

  it("shows empty state when result is null", () => {
    render(<OpenWarehousesTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("open-warehouses-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=openWarehouses on Download click", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<OpenWarehousesTab result={result} scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-open-warehouses-csv"));
    expect(spy).toHaveBeenCalledWith(1, "openWarehouses", "csv");
  });

  // B2.2-T6 — B1: utilization column gate
  describe("utilization column gate (capacityMode)", () => {
    it("hides the Utilization column when capacityMode is 'none'", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} displayedInputs={{ capacityMode: "none" }} />);
      expect(screen.queryByText("Utilization")).not.toBeInTheDocument();
      expect(screen.getByTestId("open-warehouse-row-ALN")).not.toHaveTextContent("41%");
    });

    it.each(["uniform", "per_wh"])("shows the Utilization column when capacityMode is '%s'", (capacityMode) => {
      render(<OpenWarehousesTab result={result} scenarioId={1} displayedInputs={{ capacityMode }} />);
      expect(screen.getByText("Utilization")).toBeInTheDocument();
      expect(screen.getByTestId("open-warehouse-row-ALN")).toHaveTextContent("41%");
    });

    it("shows the Utilization column for a two-echelon-style capacityMode value", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} displayedInputs={{ capacityMode: "two_echelon" }} />);
      expect(screen.getByText("Utilization")).toBeInTheDocument();
    });

    it("shows the Utilization column when displayedInputs is absent (back-compat)", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} />);
      expect(screen.getByText("Utilization")).toBeInTheDocument();
      expect(screen.getByTestId("open-warehouse-row-ALN")).toHaveTextContent("41%");
    });
  });

  // B2.2-T6 — B6: added-entity display ID
  describe("added-entity display ID", () => {
    it("shows a user-created warehouse's display ID (not its uid) from displayedInputs.addedWarehouses", () => {
      const withAdded = {
        ...result,
        edges: [{ fromId: "aw-abc123", toId: "C9", flow: 500, distance: 3 }],
        metrics: { utilizationByNode: [{ warehouseId: "aw-abc123", city: "Denver", utilization: 60 }] },
      };
      render(
        <OpenWarehousesTab
          result={withAdded}
          scenarioId={1}
          displayedInputs={{ addedWarehouses: [{ id: "aw-abc123", displayCode: "WH-CO-DENVER-01" }] }}
        />,
      );
      const row = screen.getByTestId("open-warehouse-row-aw-abc123");
      expect(row).toHaveTextContent("WH-CO-DENVER-01");
      expect(row).not.toHaveTextContent("aw-abc123");
    });

    it("shows an added two-echelon refinery's display ID from displayedInputs.addedRefineries (same aw- uid family)", () => {
      const withRefinery = {
        ...result,
        edges: [{ fromId: "aw-xyz789", toId: "C9", flow: 500, distance: 3 }],
        metrics: { utilizationByNode: [{ warehouseId: "aw-xyz789", city: "Cunnamulla", utilization: 70 }] },
      };
      render(
        <OpenWarehousesTab
          result={withRefinery}
          scenarioId={1}
          displayedInputs={{ addedRefineries: [{ id: "aw-xyz789", displayCode: "RF-AU-CUNN-01" }] }}
        />,
      );
      const row = screen.getByTestId("open-warehouse-row-aw-xyz789");
      expect(row).toHaveTextContent("RF-AU-CUNN-01");
      expect(row).not.toHaveTextContent("aw-xyz789");
    });

    it("falls back to the raw id when no displayCode entry exists for it (base dataset rows)", () => {
      render(
        <OpenWarehousesTab
          result={result}
          scenarioId={1}
          displayedInputs={{ addedWarehouses: [{ id: "aw-someone-else", displayCode: "WH-XX-OTHER-01" }] }}
        />,
      );
      expect(screen.getByTestId("open-warehouse-row-ALN")).toHaveTextContent("ALN");
    });
  });

  // B2.2-T6 — snapshot invariant
  it("does not reflect an unsaved localInputs-style edit that was never passed via displayedInputs", () => {
    // The component has no `localInputs` prop at all — `displayedInputs` is
    // the ONLY source of truth for capacityMode/display-code. An "unsaved
    // edit" the student hasn't saved yet (what Workspace.tsx calls
    // `localInputs`) must never reach this component; only the last-SAVED
    // snapshot (`displayedInputs`) may. Simulate by holding an "unsaved"
    // value in a local variable that is deliberately never wired into the
    // render, then asserting the rendered output reflects only the saved
    // snapshot.
    const savedSnapshot = { capacityMode: "uniform" };
    const unsavedLocalEdit = { capacityMode: "none" }; // never passed as a prop
    void unsavedLocalEdit;
    render(<OpenWarehousesTab result={result} scenarioId={1} displayedInputs={savedSnapshot} />);
    expect(screen.getByText("Utilization")).toBeInTheDocument();
    expect(screen.getByTestId("open-warehouse-row-ALN")).toHaveTextContent("41%");
  });
});
