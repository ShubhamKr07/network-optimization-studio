import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { OpenWarehousesTab } from "@/components/workspace/tabs/OpenWarehousesTab";
import * as exportEntity from "@/lib/exportEntity";
import { ExportProvider } from "@/contexts/ExportContext";
import { exportProviderWrapper, makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";

// SCN chen-bands-units, Task 14b — OpenWarehousesTab now calls useExport()
// unconditionally, needing an ExportProvider ancestor for every render.
// Shadowing `render` (RTL's `wrapper` OPTION, not a JSX-wrapping element —
// see this repo's own documented rerender gotcha) keeps every pre-existing
// bare `render(<OpenWarehousesTab .../>)` call site byte-identical.
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: exportProviderWrapper() });
}

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
    // scenarioId/unit come from the ExportProvider context (default {scenarioId:1, unit:"mi"}),
    // NOT from this component's own `scenarioId` prop — toHaveBeenCalledWith
    // ignores the undefined `runId` key (vitest/jest equality semantics).
    expect(spy).toHaveBeenCalledWith(1, "openWarehouses", "csv", { unit: "mi" });
  });

  // Task 14b — production-control assertions the context-only ExportContext
  // tests (Task 11b) deliberately left to the real consumers.
  describe("useExport() disabled-reason wiring (Task 14b)", () => {
    it("is disabled with the reason surfaced when the displayed result has no runId (resultDisabledReason)", () => {
      rtlRender(
        <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "This result predates run history — export the latest result instead." })}>
          <OpenWarehousesTab result={result} scenarioId={1} />
        </ExportProvider>,
      );
      const button = screen.getByTestId("button-download-open-warehouses-csv");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "This result predates run history — export the latest result instead.");
    });

    it("forwards runId when an older history entry is displayed", () => {
      const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
      rtlRender(
        <ExportProvider value={makeExportProviderValue({ runId: 42 })}>
          <OpenWarehousesTab result={result} scenarioId={1} />
        </ExportProvider>,
      );
      fireEvent.click(screen.getByTestId("button-download-open-warehouses-csv"));
      expect(spy).toHaveBeenCalledWith(1, "openWarehouses", "csv", { unit: "mi", runId: 42 });
    });

    it("omits runId (undefined) when the latest result is displayed", () => {
      const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
      render(<OpenWarehousesTab result={result} scenarioId={1} />);
      fireEvent.click(screen.getByTestId("button-download-open-warehouses-csv"));
      const call = spy.mock.calls[0];
      expect(call[3]).toEqual({ unit: "mi", runId: undefined });
    });

    // Decision 1g's legacy latest->history transition, proven against a
    // REAL rendered control across a real rerender — not a fixed-value
    // snapshot, and not stubbed. Every render call below (initial AND every
    // rerender) explicitly includes the same <ExportProvider> ancestor at
    // the same tree position, so React reconciles in place rather than
    // remounting (the exact double-wrap/remount trap this suite's sibling
    // file, JadeAssignmentsTab.test.tsx, hit and fixed this same task).
    it("a real control disables when browsing to a legacy (no-runId) history entry, then re-enables back at the latest result", () => {
      const { rerender } = rtlRender(
        <ExportProvider value={makeExportProviderValue()}>
          <OpenWarehousesTab result={result} scenarioId={1} />
        </ExportProvider>,
      );
      const button = screen.getByTestId("button-download-open-warehouses-csv");
      expect(button).not.toBeDisabled();

      // Student steps the result-history stepper back to an entry that
      // predates run history (no runId was ever recorded for it) — a
      // server-side export at this point would silently return the LATEST
      // result instead of the one on screen (decision 1g), so the control
      // must disable.
      rerender(
        <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "This entry predates run history — export unavailable." })}>
          <OpenWarehousesTab result={result} scenarioId={1} />
        </ExportProvider>,
      );
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "This entry predates run history — export unavailable.");

      // Student steps forward again to the latest result — the control
      // re-enables, proving this isn't a one-way/sticky disable.
      rerender(
        <ExportProvider value={makeExportProviderValue()}>
          <OpenWarehousesTab result={result} scenarioId={1} />
        </ExportProvider>,
      );
      expect(button).not.toBeDisabled();
    });
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

  // jade-T14 — Chapter 9 JADE (uncapacitated, demand-served in tons)
  describe("Chapter 9 JADE — demand-served tons, zero-flow open facilities (capacityModes: [])", () => {
    const jadeResult = {
      status: "optimal" as const, objective: 254060828.6157, runTimeSec: 1.2, quality: "Proven optimal",
      edges: [
        { fromId: "plant-1", toId: "wh-11", flow: 900, distance: 200, leg: "plant_to_warehouse" as const, productId: "product-1" },
        { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 42.1, leg: "warehouse_to_customer" as const },
        { fromId: "wh-11", toId: "customer-2", flow: 400, distance: 60, leg: "warehouse_to_customer" as const },
      ],
      metrics: { openFacilityIds: ["wh-11", "wh-14"] },
      details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };

    it("shows a 'Demand Served' column instead of 'Total Flow'/'Utilization' when capacityModes is an empty array", () => {
      render(<OpenWarehousesTab result={jadeResult} scenarioId={1} displayedInputs={{ capacityModes: [] }} />);
      expect(screen.getByText("Demand Served")).toBeInTheDocument();
      expect(screen.queryByText("Total Flow")).not.toBeInTheDocument();
      expect(screen.queryByText("Utilization")).not.toBeInTheDocument();
      expect(screen.getByTestId("open-warehouse-row-wh-11")).not.toHaveTextContent("%");
    });

    it("lists a zero-flow open facility from metrics.openFacilityIds (a forced-open warehouse serving no one still counts as open)", () => {
      render(<OpenWarehousesTab result={jadeResult} scenarioId={1} displayedInputs={{ capacityModes: [] }} />);
      // wh-11 has outbound flow (500 + 400 = 900); wh-14 is open but has zero
      // outbound edges at all — it must still appear as a row.
      expect(screen.getByTestId("open-warehouse-row-wh-11")).toHaveTextContent("900");
      const zeroFlowRow = screen.getByTestId("open-warehouse-row-wh-14");
      expect(zeroFlowRow).toHaveTextContent("0");
    });

    it("excludes plant_to_warehouse edges from the warehouse flow sum (plant is not a warehouse row)", () => {
      render(<OpenWarehousesTab result={jadeResult} scenarioId={1} displayedInputs={{ capacityModes: [] }} />);
      expect(screen.queryByTestId("open-warehouse-row-plant-1")).not.toBeInTheDocument();
    });

    it("falls back to the pre-existing capacityMode gate when capacityModes is absent (back-compat, no regression)", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} />);
      expect(screen.getByText("Total Flow")).toBeInTheDocument();
      expect(screen.queryByText("Demand Served")).not.toBeInTheDocument();
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

  // JADE — "City, ST" primary label + id/displayCode mono sub-label
  describe("JADE City, ST label (locationById)", () => {
    it("shows 'City, ST' with the id kept as a sub-label when locationById has an entry", () => {
      render(
        <OpenWarehousesTab
          result={result}
          scenarioId={1}
          locationById={{ ALN: { city: "Allentown", state: "PA" } }}
        />,
      );
      const row = screen.getByTestId("open-warehouse-row-ALN");
      expect(row).toHaveTextContent("Allentown, PA");
      expect(row).toHaveTextContent("ALN");
    });

    it("falls back to ID-only rendering when locationById is absent (other-model default, no regression)", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} />);
      const row = screen.getByTestId("open-warehouse-row-ALN");
      expect(row).toHaveTextContent("ALN");
      expect(row).not.toHaveTextContent("Allentown");
    });
  });

  // ch4-tab-city-labels — Chen (state: "") city-only label, no trailing ", "
  describe("Chen city-only label (locationById, state: \"\")", () => {
    it("shows the city with the id kept as a sub-label, and no trailing comma/space", () => {
      render(
        <OpenWarehousesTab
          result={result}
          scenarioId={1}
          locationById={{ ALN: { city: "Guangzhou", state: "" } }}
        />,
      );
      const row = screen.getByTestId("open-warehouse-row-ALN");
      expect(row).toHaveTextContent("Guangzhou");
      expect(row).toHaveTextContent("ALN");
      expect(row.textContent).not.toMatch(/Guangzhou,/);
    });
  });

  // workspace-fixups-2, T10 (item 2) — identityById compat resolver. This
  // table is the item-2 REFERENCE (already stacked, unconditional on row
  // count) — `EntityIdCell` alignment only, no `>10` gate.
  describe("identityById (workspace-fixups-2, T10, item 2)", () => {
    it("prefers identityById over locationById/codeById", () => {
      render(
        <OpenWarehousesTab
          result={result}
          scenarioId={1}
          locationById={{ ALN: { city: "Old City", state: "OS" } }}
          displayedInputs={{ addedWarehouses: [{ id: "ALN", displayCode: "OLD-CODE" }] }}
          identityById={{ ALN: { city: "Allentown", state: "PA", displayId: "WH-ALN-NEW" } }}
        />,
      );
      const row = screen.getByTestId("open-warehouse-row-ALN");
      expect(row).toHaveTextContent("Allentown, PA");
      expect(row).toHaveTextContent("WH-ALN-NEW");
    });

    it("shows an added FACILITY's display code (not the canonical uid) via identityById", () => {
      const withAdded = {
        ...result,
        edges: [{ fromId: "aw-new1", toId: "C9", flow: 500, distance: 3 }],
      };
      render(
        <OpenWarehousesTab
          result={withAdded}
          scenarioId={1}
          identityById={{ "aw-new1": { city: "Denver", state: "CO", displayId: "WH-CO-DENVER-02" } }}
        />,
      );
      const row = screen.getByTestId("open-warehouse-row-aw-new1");
      expect(row).toHaveTextContent("WH-CO-DENVER-02");
      expect(row).not.toHaveTextContent("aw-new1");
    });

    it("falls back to displayId, then the canonical id, on a lookup miss", () => {
      render(
        <OpenWarehousesTab
          result={result}
          scenarioId={1}
          identityById={{ "some-other-id": { city: "X", state: "Y", displayId: "Z" } }}
        />,
      );
      expect(screen.getByTestId("open-warehouse-row-ALN")).toHaveTextContent("ALN");
    });

    it("with identityById unset, output is byte-unchanged from before this task (no-regression)", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} />);
      const row = screen.getByTestId("open-warehouse-row-ALN");
      expect(row).toHaveTextContent("ALN");
      expect(row).not.toHaveTextContent("Allentown");
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

  // B6 (spec §8) — audit confirmation. JADE's uncapacitated
  // (`capacityModes: []`) shape already renders "Demand Served" with no "%"
  // (covered above); this asserts no '10,000,000' literal anywhere either.
  it("JADE-shaped result (capacityModes: []) shows no '10,000,000' text anywhere", () => {
    const jadeResult = {
      status: "optimal" as const, objective: 254060828.6157, runTimeSec: 1.2, quality: "Proven optimal",
      edges: [{ fromId: "wh-11", toId: "customer-1", flow: 500, distance: 42.1, leg: "warehouse_to_customer" as const }],
      metrics: {},
      details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };
    render(<OpenWarehousesTab result={jadeResult} scenarioId={1} displayedInputs={{ capacityModes: [] }} />);
    expect(screen.queryByText(/10,000,000/)).not.toBeInTheDocument();
  });

  // B6 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in FilterMenu.
  describe("enableFilters (B6)", () => {
    const manyWarehousesResult = {
      status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
      edges: Array.from({ length: 11 }, (_, i) => ({ fromId: `WH${i}`, toId: `C${i}`, flow: 10, distance: 1 })),
      metrics: {},
      details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };

    it("defaults to false: no FilterMenu even with >10 rows (other-model behavior unchanged)", () => {
      render(<OpenWarehousesTab result={manyWarehousesResult} scenarioId={1} />);
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    });

    it("enableFilters=true with <=10 rows: FilterMenu stays hidden", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} enableFilters />);
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    });

    it("enableFilters=true with >10 rows: FilterMenu is shown", () => {
      render(<OpenWarehousesTab result={manyWarehousesResult} scenarioId={1} enableFilters />);
      expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    });

    it("filtering by Warehouse (text) narrows the rendered rows", async () => {
      render(<OpenWarehousesTab result={manyWarehousesResult} scenarioId={1} enableFilters />);
      await userEvent.click(screen.getByTestId("button-filter-menu-trigger"));
      await userEvent.type(screen.getByTestId("input-filter-warehouse"), "WH1");
      // "WH1" matches WH1 and WH10 (substring match).
      expect(screen.getByTestId("open-warehouse-row-WH1")).toBeInTheDocument();
      expect(screen.getByTestId("open-warehouse-row-WH10")).toBeInTheDocument();
      expect(screen.queryByTestId("open-warehouse-row-WH2")).not.toBeInTheDocument();
    });
  });
});
