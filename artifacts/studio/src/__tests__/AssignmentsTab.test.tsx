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
});
