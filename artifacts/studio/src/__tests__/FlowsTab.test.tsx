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
});
