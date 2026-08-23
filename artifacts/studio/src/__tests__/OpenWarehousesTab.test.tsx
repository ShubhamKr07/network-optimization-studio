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
  metrics: { utilizationByNode: [{ warehouseId: "ALN", city: "Allentown", utilization: 0.41 }] },
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
});
